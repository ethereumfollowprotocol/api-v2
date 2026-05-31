import { createMiddleware } from 'hono/factory';
import type { AppBindings, AppVariables } from '../types.js';

function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Cloudflare Rate Limiting binding — replaces @fastify/rate-limit + Redis.
 * Falls through when binding is unavailable (local dev without rate_limits configured).
 */
export const rateLimitMiddleware = createMiddleware<{ Bindings: AppBindings; Variables: AppVariables }>(
  async (c, next) => {
    const limiter = c.env.API_RATE_LIMITER;
    if (!limiter) {
      return next();
    }

    const ip = getClientIp(c.req.raw);
    const { success } = await limiter.limit({ key: ip });

    if (!success) {
      return c.json(
        {
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please slow down.',
        },
        429
      );
    }

    return next();
  }
);
