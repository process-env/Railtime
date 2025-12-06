/**
 * In-memory rate limiter using sliding window algorithm
 * Simple implementation with no external dependencies (no Redis required)
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

// In-memory storage for rate limit data
// Key format: `${identifier}:${routePattern}`
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup interval to prevent memory leaks
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the cleanup interval to remove expired entries
 */
function startCleanupInterval(): void {
  if (cleanupInterval) return;

  // Run cleanup every minute
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key);
      }
    }
  }, 60_000);

  // Don't prevent Node from exiting
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }
}

/**
 * Stop the cleanup interval (for testing)
 */
export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Clear all rate limit data (for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Get current store size (for monitoring)
 */
export function getRateLimitStoreSize(): number {
  return rateLimitStore.size;
}

/**
 * Rate limit configurations by route pattern
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Static data routes - generous limits
  '/api/v1/stops': { limit: 100, windowMs: 60_000 },
  '/api/v1/routes': { limit: 100, windowMs: 60_000 },

  // Real-time data routes
  '/api/v1/alerts': { limit: 60, windowMs: 60_000 },
  '/api/v1/arrivals': { limit: 120, windowMs: 60_000 },
  '/api/v1/feed': { limit: 200, windowMs: 60_000 }, // 8 feeds * ~4 polls/min * safety margin

  // Analytics routes
  '/api/v1/analytics': { limit: 30, windowMs: 60_000 },

  // Admin routes - strict limits
  '/api/v1/collect': { limit: 10, windowMs: 60_000 },
  '/api/cron': { limit: 5, windowMs: 60_000 },

  // Default for any other API routes
  default: { limit: 60, windowMs: 60_000 },
};

/**
 * Get the rate limit config for a given path
 */
export function getRateLimitConfig(pathname: string): RateLimitConfig {
  // Check exact matches first
  for (const [pattern, config] of Object.entries(RATE_LIMITS)) {
    if (pattern === 'default') continue;
    if (pathname.startsWith(pattern)) {
      return config;
    }
  }
  return RATE_LIMITS.default;
}

/**
 * Check if a request should be rate limited
 * Returns null if allowed, or the number of seconds until reset if limited
 */
export function checkRateLimit(
  identifier: string,
  pathname: string
): { allowed: boolean; remaining: number; resetIn: number } {
  // Start cleanup if not running
  startCleanupInterval();

  const config = getRateLimitConfig(pathname);
  const key = `${identifier}:${pathname.split('/').slice(0, 4).join('/')}`;
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  // Create new entry if none exists or if window has passed
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 1,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
    return {
      allowed: true,
      remaining: config.limit - 1,
      resetIn: Math.ceil(config.windowMs / 1000),
    };
  }

  // Check if limit exceeded
  if (entry.count >= config.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  // Increment counter
  entry.count += 1;
  rateLimitStore.set(key, entry);

  return {
    allowed: true,
    remaining: config.limit - entry.count,
    resetIn: Math.ceil((entry.resetAt - now) / 1000),
  };
}

/**
 * Get client identifier from request
 * Uses X-Forwarded-For header if behind a proxy, otherwise falls back to IP
 */
export function getClientIdentifier(request: Request): string {
  // Try X-Forwarded-For first (for proxied requests)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    return forwardedFor.split(',')[0].trim();
  }

  // Try X-Real-IP
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fall back to a default identifier for local development
  return 'local-dev';
}

/**
 * Create rate limit headers for response
 */
export function createRateLimitHeaders(
  allowed: boolean,
  remaining: number,
  resetIn: number,
  pathname: string
): Record<string, string> {
  const config = getRateLimitConfig(pathname);

  return {
    'X-RateLimit-Limit': String(config.limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(resetIn),
    ...(allowed ? {} : { 'Retry-After': String(resetIn) }),
  };
}
