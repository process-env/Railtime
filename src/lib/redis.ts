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

// Cache utilities - gracefully degrade without Redis
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

export async function setCache<T>(
  key: string,
  data: T,
  ttlSeconds: number
): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) return;

    await client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch {
    // Ignore cache errors
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
