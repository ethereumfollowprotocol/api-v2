import { Redis } from 'ioredis';
import { env } from '../config/index.js';
import { logger } from '../logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (redis) return redis;

  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    logger.error({ err }, 'Redis connection error');
  });

  client.on('connect', () => {
    logger.debug('Redis connected');
  });

  client.on('ready', () => {
    logger.info('Redis ready');
  });

  redis = client;
  return client;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis connection closed');
  }
}

// Cache helpers
export async function getCache<T>(key: string): Promise<T | null> {
  const client = getRedis();
  const value = await client.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const client = getRedis();
  await client.setex(key, ttlSeconds, JSON.stringify(value));
}

// Set a key only if it does not already exist (with TTL).
// Returns true if this caller set it (i.e. "won" the right to act), false if it already existed.
// Useful as a combined dedup lock + short negative-cache for on-demand work.
export async function setCacheNX(key: string, ttlSeconds: number): Promise<boolean> {
  const client = getRedis();
  const res = await client.set(key, '1', 'EX', ttlSeconds, 'NX');
  return res === 'OK';
}

export async function deleteCache(key: string): Promise<void> {
  const client = getRedis();
  await client.del(key);
}

export async function deleteCachePattern(pattern: string): Promise<number> {
  const client = getRedis();
  const keys = await client.keys(pattern);
  if (keys.length === 0) return 0;
  return client.del(...keys);
}

export type { Redis } from 'ioredis';
