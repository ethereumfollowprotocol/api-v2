import { createMiddleware } from 'hono/factory';
import { CACHE_TTL } from '@efp/shared-core';
import type { AppBindings, AppVariables } from '../types.js';

const ROUTE_TTL: Record<string, number> = {
  '/api/v1/users/:addressOrENS/account': CACHE_TTL.account,
  '/api/v1/users/:addressOrENS/details': CACHE_TTL.details,
  '/api/v1/users/:addressOrENS/stats': CACHE_TTL.stats,
  '/api/v1/users/:addressOrENS/followers': CACHE_TTL.followers,
  '/api/v1/users/:addressOrENS/following': CACHE_TTL.following,
  '/api/v1/users/:addressOrENS/allFollowers': CACHE_TTL.followers,
  '/api/v1/users/:addressOrENS/allFollowing': CACHE_TTL.following,
  '/api/v1/users/:addressOrENS/mutuals': CACHE_TTL.mutuals,
  '/api/v1/users/:addressOrENS/simple-profile': CACHE_TTL.profileSimple,
  '/api/v1/leaderboard/ranked': CACHE_TTL.leaderboard,
  '/api/v1/stats': CACHE_TTL.globalStats,
};

function getCacheKey(request: Request): string {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  params.delete('cache');
  params.delete('live');
  const search = params.toString();
  return `efp:${url.pathname}${search ? '?' + search : ''}`;
}

function getTTLForPath(pathname: string): number | null {
  for (const [pattern, ttl] of Object.entries(ROUTE_TTL)) {
    const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$');
    if (regex.test(pathname)) {
      return ttl;
    }
  }
  return null;
}

export const cacheMiddleware = createMiddleware<{ Bindings: AppBindings; Variables: AppVariables }>(
  async (c, next) => {
    if (c.req.method !== 'GET') {
      return next();
    }

    const url = new URL(c.req.url);
    if (url.searchParams.get('cache') === 'fresh' || url.searchParams.get('live') === 'true') {
      c.header('X-Cache', 'BYPASS');
      return next();
    }

    const ttl = getTTLForPath(url.pathname);
    if (!ttl) {
      return next();
    }

    const cacheKey = getCacheKey(c.req.raw);
    const cache = caches.default;

    try {
      const cached = await cache.match(new Request(`https://cache.internal/${cacheKey}`));
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('X-Cache', 'HIT');
        return new Response(cached.body, { status: cached.status, headers });
      }
    } catch {
      // Cache read failure — proceed without cache
    }

    c.header('X-Cache', 'MISS');
    await next();

    if (c.res.status >= 200 && c.res.status < 300) {
      const responseClone = c.res.clone();
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const body = await responseClone.text();
            await cache.put(
              new Request(`https://cache.internal/${cacheKey}`),
              new Response(body, {
                status: responseClone.status,
                headers: {
                  'Content-Type': responseClone.headers.get('Content-Type') || 'application/json',
                  'Cache-Control': `max-age=${ttl}`,
                },
              })
            );
          } catch {
            // Cache write failure is non-fatal
          }
        })()
      );
    }
  }
);
