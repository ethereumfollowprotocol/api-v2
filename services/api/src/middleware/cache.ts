import type { FastifyRequest, FastifyReply } from 'fastify';
import { getCache, setCache, CACHE_TTL, createLogger } from '@efp/shared';

const logger = createLogger('cache');

// Route patterns to TTL mapping
const ROUTE_TTL: Record<string, number> = {
  '/users/:addressOrENS/account': CACHE_TTL.account,
  '/users/:addressOrENS/details': CACHE_TTL.details,
  '/users/:addressOrENS/stats': CACHE_TTL.stats,
  '/users/:addressOrENS/followers': CACHE_TTL.followers,
  '/users/:addressOrENS/following': CACHE_TTL.following,
  '/users/:addressOrENS/allFollowers': CACHE_TTL.followers,
  '/users/:addressOrENS/allFollowing': CACHE_TTL.following,
  '/users/:addressOrENS/mutuals': CACHE_TTL.mutuals,
  '/lists/:tokenId/account': CACHE_TTL.account,
  '/lists/:tokenId/details': CACHE_TTL.details,
  '/lists/:tokenId/stats': CACHE_TTL.stats,
  '/lists/:tokenId/followers': CACHE_TTL.followers,
  '/lists/:tokenId/following': CACHE_TTL.following,
  '/leaderboard/ranked': CACHE_TTL.leaderboard,
  '/leaderboard/followers': CACHE_TTL.leaderboard,
  '/leaderboard/following': CACHE_TTL.leaderboard,
  '/leaderboard/mutuals': CACHE_TTL.leaderboard,
  '/stats': CACHE_TTL.globalStats,
  '/discover': CACHE_TTL.discover,
};

function getCacheKey(request: FastifyRequest): string {
  // Include query params in cache key
  const url = new URL(request.url, 'http://localhost');
  const params = new URLSearchParams(url.search);
  // Remove cache bypass params from key
  params.delete('cache');
  params.delete('live');
  const search = params.toString();
  return `efp:${url.pathname}${search ? '?' + search : ''}`;
}

function getTTLForRoute(routerPath: string | undefined): number | null {
  if (!routerPath) return null;

  // Try exact match first
  if (ROUTE_TTL[routerPath]) {
    return ROUTE_TTL[routerPath];
  }

  // Try prefix matching
  for (const [pattern, ttl] of Object.entries(ROUTE_TTL)) {
    if (routerPath.startsWith(pattern.split(':')[0])) {
      return ttl;
    }
  }

  return null;
}

export async function cacheMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip for non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip if cache=fresh or live=true is set
  const url = new URL(request.url, 'http://localhost');
  if (url.searchParams.get('cache') === 'fresh' || url.searchParams.get('live') === 'true') {
    reply.header('X-Cache', 'BYPASS');
    return;
  }

  const cacheKey = getCacheKey(request);

  try {
    const cached = await getCache<unknown>(cacheKey);

    if (cached) {
      logger.debug({ cacheKey }, 'Cache hit');
      reply.header('X-Cache', 'HIT');
      return reply.send(cached);
    }
  } catch (err) {
    logger.warn({ err, cacheKey }, 'Cache read error');
  }

  reply.header('X-Cache', 'MISS');

  // Store original send to intercept response
  const originalSend = reply.send.bind(reply);
  const routerPath = request.routeOptions.url;
  const ttl = getTTLForRoute(routerPath);

  reply.send = function (payload: unknown) {
    // Only cache successful responses
    if (reply.statusCode >= 200 && reply.statusCode < 300 && ttl) {
      // Cache asynchronously, don't block response
      setCache(cacheKey, payload, ttl).catch((err) => {
        logger.warn({ err, cacheKey }, 'Cache write error');
      });
    }
    return originalSend(payload);
  };
}
