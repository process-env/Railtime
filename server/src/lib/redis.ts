import { Redis } from 'ioredis';

let redis: Redis | null = null;
let pubClient: Redis | null = null;
let subClient: Redis | null = null;

/**
 * Creates a new Redis connection with standard options.
 * Returns null if REDIS_URL is not set.
 */
function createClient(label: string): Redis | null {
  try {
    const url = process.env.REDIS_URL;
    if (!url) return null;

    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    client.on('error', (err) => {
      console.error(`[redis:${label}] connection error:`, err.message);
    });

    return client;
  } catch {
    return null;
  }
}

/**
 * Returns the main Redis client singleton (for cache reads/writes).
 * Reads REDIS_URL from env. Returns null if not set.
 */
export function getRedisClient(): Redis | null {
  if (redis) return redis;
  redis = createClient('main');
  return redis;
}

/**
 * Returns a dedicated Redis client for Socket.IO adapter publish.
 * Creates a separate connection because the Socket.IO Redis adapter
 * requires independent pub/sub clients.
 */
export function getPubClient(): Redis | null {
  if (pubClient) return pubClient;
  pubClient = createClient('pub');
  return pubClient;
}

/**
 * Returns a dedicated Redis client for Socket.IO adapter subscribe.
 * Creates a separate connection because the Socket.IO Redis adapter
 * requires independent pub/sub clients.
 */
export function getSubClient(): Redis | null {
  if (subClient) return subClient;
  subClient = createClient('sub');
  return subClient;
}

// ---------------------------------------------------------------------------
// Cache utilities - gracefully degrade without Redis
// ---------------------------------------------------------------------------

/**
 * Get a cached value. Returns null on miss or error.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient();
    if (!client) return null;

    const data = await client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Set a cache value with TTL.
 */
export async function setCache<T>(
  key: string,
  data: T,
  ttlSeconds: number,
): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) return;

    await client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch {
    // Ignore cache errors
  }
}

/**
 * Delete a cache key.
 */
export async function deleteCache(key: string): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) return;

    await client.del(key);
  } catch {
    // Ignore cache errors
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Gracefully close all Redis connections (main, pub, sub) and reset singletons.
 * Safe to call multiple times. Used during server shutdown.
 */
export async function closeAll(): Promise<void> {
  const clients: Array<{ ref: Redis | null; label: string }> = [
    { ref: redis, label: 'main' },
    { ref: pubClient, label: 'pub' },
    { ref: subClient, label: 'sub' },
  ];

  await Promise.allSettled(
    clients.map(async ({ ref, label }) => {
      if (!ref) return;
      try {
        await ref.quit();
      } catch {
        console.warn(`[redis:${label}] forced disconnect during shutdown`);
        ref.disconnect();
      }
    }),
  );

  redis = null;
  pubClient = null;
  subClient = null;
}
