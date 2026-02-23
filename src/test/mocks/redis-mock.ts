import { vi } from 'vitest';

// In-memory cache storage for testing
const cacheStore = new Map<string, { value: string; expiresAt: number }>();

/**
 * Mock Redis client for testing
 */
export const createMockRedisClient = () => ({
  get: vi.fn(async (key: string) => {
    const entry = cacheStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      cacheStore.delete(key);
      return null;
    }
    return entry.value;
  }),

  set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
    let ttlSeconds: number | null = null;
    // Handle ioredis v5 call signatures:
    //   set(key, value, 'EX', seconds)  — positional args
    //   set(key, value, { EX: seconds }) — options object
    if (args[0] === 'EX' && typeof args[1] === 'number') {
      ttlSeconds = args[1];
    } else if (args[0] === 'PX' && typeof args[1] === 'number') {
      ttlSeconds = args[1] / 1000;
    } else if (typeof args[0] === 'object' && args[0] !== null) {
      const opts = args[0] as Record<string, unknown>;
      if (typeof opts.EX === 'number') ttlSeconds = opts.EX;
      else if (typeof opts.PX === 'number') ttlSeconds = opts.PX / 1000;
      else if (typeof opts.ex === 'number') ttlSeconds = opts.ex;
      else if (typeof opts.px === 'number') ttlSeconds = opts.px / 1000;
    }
    const expiresAt = ttlSeconds != null
      ? Date.now() + (ttlSeconds * 1000)
      : Date.now() + (3600 * 1000); // default 1 hour
    cacheStore.set(key, { value, expiresAt });
    return 'OK';
  }),

  del: vi.fn(async (key: string) => {
    const existed = cacheStore.has(key);
    cacheStore.delete(key);
    return existed ? 1 : 0;
  }),

  on: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  quit: vi.fn(),
});

/**
 * Clear all cached data
 */
export function clearRedisCache(): void {
  cacheStore.clear();
}

/**
 * Set a cache entry directly for testing
 */
export function setMockCacheEntry<T>(key: string, value: T, ttlSeconds = 3600): void {
  cacheStore.set(key, {
    value: JSON.stringify(value),
    expiresAt: Date.now() + (ttlSeconds * 1000),
  });
}

/**
 * Get a cache entry directly for testing
 */
export function getMockCacheEntry<T>(key: string): T | null {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cacheStore.delete(key);
    return null;
  }
  return JSON.parse(entry.value) as T;
}

/**
 * Mock the redis module
 */
export const mockRedisModule = {
  getCache: vi.fn(async <T>(key: string): Promise<T | null> => {
    const entry = cacheStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      cacheStore.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }),

  setCache: vi.fn(async <T>(key: string, data: T, ttlSeconds: number): Promise<void> => {
    cacheStore.set(key, {
      value: JSON.stringify(data),
      expiresAt: Date.now() + (ttlSeconds * 1000),
    });
  }),

  deleteCache: vi.fn(async (key: string): Promise<void> => {
    cacheStore.delete(key);
  }),
};

/**
 * Setup redis mock for tests
 */
export function setupRedisMock() {
  clearRedisCache();
  return mockRedisModule;
}
