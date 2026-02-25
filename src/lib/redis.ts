import Redis from 'ioredis';

let redis: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redis) return redis;

  try {
    const url = process.env.REDIS_URL;
    if (!url) return null;

    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    redis.on('error', (err) => {
      console.error('[Redis]', err.message);
    });

    return redis;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// In-memory LRU cache tier (avoids Redis round-trip on warm Vercel invocations)
// ---------------------------------------------------------------------------

interface MemEntry<T> { data: T; expiresAt: number }
const memCache = new Map<string, MemEntry<unknown>>();
const MEM_TTL_MS = 10_000; // 10 seconds

function memGet<T>(key: string): T | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function memSet<T>(key: string, data: T, ttlMs: number = MEM_TTL_MS): void {
  memCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  // Evict expired entries when map grows (cheap amortized cleanup)
  if (memCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of memCache) {
      if (now > v.expiresAt) memCache.delete(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Cache utilities - gracefully degrade without Redis
// Two-tier: in-memory (0ms) → Redis (~1ms) on reads
// ---------------------------------------------------------------------------

export async function getCache<T>(key: string): Promise<T | null> {
  // Tier 1: in-memory
  const mem = memGet<T>(key);
  if (mem !== null) return mem;

  // Tier 2: Redis
  try {
    const client = getRedisClient();
    if (!client) return null;

    const data = await client.get(key);
    if (!data) return null;
    const parsed = JSON.parse(data) as T;
    memSet(key, parsed); // Promote to memory
    return parsed;
  } catch {
    return null;
  }
}

export async function setCache<T>(
  key: string,
  data: T,
  ttlSeconds: number
): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) return; // No Redis → no caching at all

    await client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
    // Only populate in-memory tier after successful Redis write
    memSet(key, data, Math.min(ttlSeconds * 1000, MEM_TTL_MS));
  } catch {
    // Ignore cache errors
  }
}

// ---------------------------------------------------------------------------
// Pipeline batch reads (8 keys in 1 round-trip instead of 8)
// ---------------------------------------------------------------------------

export async function pipelineGet<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];

  // Check memory first
  const results: (T | null)[] = new Array(keys.length).fill(null);
  const missingIndices: number[] = [];

  for (let i = 0; i < keys.length; i++) {
    const mem = memGet<T>(keys[i]);
    if (mem !== null) {
      results[i] = mem;
    } else {
      missingIndices.push(i);
    }
  }

  if (missingIndices.length === 0) return results;

  try {
    const client = getRedisClient();
    if (!client) return results;

    const pipeline = client.pipeline();
    for (const idx of missingIndices) {
      pipeline.get(keys[idx]);
    }
    const pipeResults = await pipeline.exec();
    if (!pipeResults) return results;

    for (let i = 0; i < missingIndices.length; i++) {
      const [err, val] = pipeResults[i] ?? [null, null];
      if (!err && typeof val === 'string') {
        const parsed = JSON.parse(val) as T;
        results[missingIndices[i]] = parsed;
        memSet(keys[missingIndices[i]], parsed);
      }
    }
  } catch {
    // Graceful degradation
  }

  return results;
}

// ---------------------------------------------------------------------------
// Distributed lock (SETNX) for cache stampede protection
// ---------------------------------------------------------------------------

export async function acquireLock(
  lockKey: string,
  ttlSeconds: number = 10
): Promise<boolean> {
  try {
    const client = getRedisClient();
    if (!client) return true; // No Redis → let the caller proceed (no lock needed)

    const result = await client.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch {
    return true; // On error, let caller proceed
  }
}

export async function releaseLock(lockKey: string): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) return;
    await client.del(lockKey);
  } catch {
    // Ignore
  }
}

export async function deleteCache(key: string): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) return;

    await client.del(key);
  } catch {
    // Ignore cache errors
  }
}

// Sorted set utilities - used by newsroom library index

export async function zaddToSet(
  key: string,
  score: number,
  member: string
): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) return;

    await client.zadd(key, score, member);
  } catch {
    // Ignore cache errors
  }
}

export async function zrangeFromSet(
  key: string,
  start: number,
  stop: number
): Promise<string[]> {
  try {
    const client = getRedisClient();
    if (!client) return [];

    return await client.zrange(key, start, stop);
  } catch {
    return [];
  }
}

export async function zcardOfSet(key: string): Promise<number> {
  try {
    const client = getRedisClient();
    if (!client) return 0;

    return await client.zcard(key);
  } catch {
    return 0;
  }
}
