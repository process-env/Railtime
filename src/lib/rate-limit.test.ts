import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkRateLimit,
  getRateLimitConfig,
  getClientIdentifier,
  createRateLimitHeaders,
  clearRateLimitStore,
  stopCleanupInterval,
  getRateLimitStoreSize,
  RATE_LIMITS,
} from './rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    // Clear store between tests
    clearRateLimitStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopCleanupInterval();
    vi.useRealTimers();
  });

  describe('getRateLimitConfig', () => {
    it('returns correct config for /api/v1/stops', () => {
      const config = getRateLimitConfig('/api/v1/stops');
      expect(config.limit).toBe(100);
      expect(config.windowMs).toBe(60_000);
    });

    it('returns correct config for /api/v1/stops/{stopId}', () => {
      const config = getRateLimitConfig('/api/v1/stops/123');
      expect(config.limit).toBe(100);
      expect(config.windowMs).toBe(60_000);
    });

    it('returns correct config for /api/v1/alerts', () => {
      const config = getRateLimitConfig('/api/v1/alerts');
      expect(config.limit).toBe(60);
    });

    it('returns correct config for /api/v1/arrivals', () => {
      const config = getRateLimitConfig('/api/v1/arrivals/ACE/101N');
      expect(config.limit).toBe(120);
    });

    it('returns correct config for /api/v1/feed', () => {
      const config = getRateLimitConfig('/api/v1/feed/ACE');
      expect(config.limit).toBe(200); // 8 feeds * ~4 polls/min * safety margin
    });

    it('returns correct config for /api/v1/analytics', () => {
      const config = getRateLimitConfig('/api/v1/analytics/historical');
      expect(config.limit).toBe(30);
    });

    it('returns correct config for /api/v1/collect', () => {
      const config = getRateLimitConfig('/api/v1/collect');
      expect(config.limit).toBe(10);
    });

    it('returns correct config for /api/cron', () => {
      const config = getRateLimitConfig('/api/cron/cleanup');
      expect(config.limit).toBe(5);
    });

    it('returns default config for unknown routes', () => {
      const config = getRateLimitConfig('/api/v2/unknown');
      expect(config.limit).toBe(60);
    });
  });

  describe('checkRateLimit', () => {
    it('allows first request', () => {
      const result = checkRateLimit('127.0.0.1', '/api/v1/stops');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99); // 100 - 1
    });

    it('tracks remaining requests correctly', () => {
      const identifier = '127.0.0.1';
      const path = '/api/v1/stops';

      // First request
      let result = checkRateLimit(identifier, path);
      expect(result.remaining).toBe(99);

      // Second request
      result = checkRateLimit(identifier, path);
      expect(result.remaining).toBe(98);

      // Third request
      result = checkRateLimit(identifier, path);
      expect(result.remaining).toBe(97);
    });

    it('blocks requests when limit is exceeded', () => {
      const identifier = '127.0.0.1';
      const path = '/api/v1/collect'; // 10 req/min limit

      // Make 10 requests (limit)
      for (let i = 0; i < 10; i++) {
        const result = checkRateLimit(identifier, path);
        expect(result.allowed).toBe(true);
      }

      // 11th request should be blocked
      const result = checkRateLimit(identifier, path);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('resets after window expires', () => {
      const identifier = '127.0.0.1';
      const path = '/api/v1/collect'; // 10 req/min limit

      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        checkRateLimit(identifier, path);
      }

      // Should be blocked
      let result = checkRateLimit(identifier, path);
      expect(result.allowed).toBe(false);

      // Advance time past the window (60 seconds)
      vi.advanceTimersByTime(61_000);

      // Should be allowed again
      result = checkRateLimit(identifier, path);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('tracks different identifiers separately', () => {
      const path = '/api/v1/collect';

      // User 1 makes 10 requests
      for (let i = 0; i < 10; i++) {
        checkRateLimit('user1', path);
      }

      // User 1 should be blocked
      expect(checkRateLimit('user1', path).allowed).toBe(false);

      // User 2 should still be allowed
      expect(checkRateLimit('user2', path).allowed).toBe(true);
    });

    it('tracks different routes separately', () => {
      const identifier = '127.0.0.1';

      // Exhaust /api/v1/collect (10 limit)
      for (let i = 0; i < 10; i++) {
        checkRateLimit(identifier, '/api/v1/collect');
      }
      expect(checkRateLimit(identifier, '/api/v1/collect').allowed).toBe(false);

      // /api/v1/alerts should still be allowed
      expect(checkRateLimit(identifier, '/api/v1/alerts').allowed).toBe(true);
    });

    it('returns correct resetIn time', () => {
      const result = checkRateLimit('127.0.0.1', '/api/v1/stops');
      expect(result.resetIn).toBe(60); // 60 seconds

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30_000);

      const result2 = checkRateLimit('127.0.0.1', '/api/v1/stops');
      expect(result2.resetIn).toBe(30); // 30 seconds remaining
    });
  });

  describe('getClientIdentifier', () => {
    it('returns x-forwarded-for header value', () => {
      const request = new Request('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        },
      });
      expect(getClientIdentifier(request)).toBe('1.2.3.4');
    });

    it('returns x-real-ip header value when no x-forwarded-for', () => {
      const request = new Request('http://localhost/api/test', {
        headers: {
          'x-real-ip': '1.2.3.4',
        },
      });
      expect(getClientIdentifier(request)).toBe('1.2.3.4');
    });

    it('returns local-dev when no IP headers present', () => {
      const request = new Request('http://localhost/api/test');
      expect(getClientIdentifier(request)).toBe('local-dev');
    });

    it('prefers x-forwarded-for over x-real-ip', () => {
      const request = new Request('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '1.2.3.4',
          'x-real-ip': '5.6.7.8',
        },
      });
      expect(getClientIdentifier(request)).toBe('1.2.3.4');
    });
  });

  describe('createRateLimitHeaders', () => {
    it('creates correct headers when allowed', () => {
      const headers = createRateLimitHeaders(true, 50, 30, '/api/v1/stops');
      expect(headers['X-RateLimit-Limit']).toBe('100');
      expect(headers['X-RateLimit-Remaining']).toBe('50');
      expect(headers['X-RateLimit-Reset']).toBe('30');
      expect(headers['Retry-After']).toBeUndefined();
    });

    it('includes Retry-After when not allowed', () => {
      const headers = createRateLimitHeaders(false, 0, 30, '/api/v1/stops');
      expect(headers['X-RateLimit-Remaining']).toBe('0');
      expect(headers['Retry-After']).toBe('30');
    });

    it('uses correct limit for route', () => {
      const headers = createRateLimitHeaders(true, 5, 30, '/api/v1/collect');
      expect(headers['X-RateLimit-Limit']).toBe('10');
    });
  });

  describe('store management', () => {
    it('clearRateLimitStore clears all entries', () => {
      // Add some entries
      checkRateLimit('user1', '/api/v1/stops');
      checkRateLimit('user2', '/api/v1/alerts');
      expect(getRateLimitStoreSize()).toBe(2);

      // Clear
      clearRateLimitStore();
      expect(getRateLimitStoreSize()).toBe(0);
    });

    it('getRateLimitStoreSize returns correct count', () => {
      expect(getRateLimitStoreSize()).toBe(0);

      checkRateLimit('user1', '/api/v1/stops');
      expect(getRateLimitStoreSize()).toBe(1);

      checkRateLimit('user2', '/api/v1/stops');
      expect(getRateLimitStoreSize()).toBe(2);

      // Same user, same route should not add new entry
      checkRateLimit('user1', '/api/v1/stops');
      expect(getRateLimitStoreSize()).toBe(2);
    });
  });

  describe('RATE_LIMITS configuration', () => {
    it('has expected routes configured', () => {
      expect(RATE_LIMITS['/api/v1/stops']).toBeDefined();
      expect(RATE_LIMITS['/api/v1/routes']).toBeDefined();
      expect(RATE_LIMITS['/api/v1/alerts']).toBeDefined();
      expect(RATE_LIMITS['/api/v1/arrivals']).toBeDefined();
      expect(RATE_LIMITS['/api/v1/feed']).toBeDefined();
      expect(RATE_LIMITS['/api/v1/analytics']).toBeDefined();
      expect(RATE_LIMITS['/api/v1/collect']).toBeDefined();
      expect(RATE_LIMITS['/api/cron']).toBeDefined();
      expect(RATE_LIMITS.default).toBeDefined();
    });

    it('all limits are reasonable', () => {
      for (const [, config] of Object.entries(RATE_LIMITS)) {
        expect(config.limit).toBeGreaterThan(0);
        expect(config.limit).toBeLessThanOrEqual(1000);
        expect(config.windowMs).toBeGreaterThanOrEqual(1000);
        expect(config.windowMs).toBeLessThanOrEqual(3600_000);
      }
    });
  });
});
