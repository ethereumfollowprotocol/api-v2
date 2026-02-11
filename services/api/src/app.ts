import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createLogger, env, getRedis } from '@efp/shared';
import { phaseMiddleware } from './middleware/phase.js';
import { cacheMiddleware } from './middleware/cache.js';
import { usersRoutes } from './routes/users.js';
import { healthRoutes } from './routes/health.js';
import { listsRoutes } from './routes/lists.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { statsRoutes } from './routes/stats.js';
import { tokenRoutes } from './routes/token.js';
import { debugRoutes } from './routes/debug.js';
import { slotsRoutes } from './routes/slots.js';
import { exportRoutes } from './routes/export.js';

const logger = createLogger('api');

export async function buildApp() {
  const app = Fastify({
    logger: false, // We use pino separately
    requestIdHeader: 'x-request-id',
  });

  // CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });

  // Rate limiting (IP-based)
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    redis: getRedis(),
    keyGenerator: (request) => {
      return request.ip || 'unknown';
    },
    errorResponseBuilder: () => ({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down.',
    }),
  });

  // Request logging
  app.addHook('onRequest', async (request) => {
    logger.debug({ method: request.method, url: request.url }, 'Incoming request');
  });

  // Response timing
  app.addHook('onResponse', async (request, reply) => {
    logger.debug(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed'
    );
  });

  // Phase check middleware (except health endpoints)
  app.addHook('preHandler', phaseMiddleware);

  // Cache middleware
  app.addHook('preHandler', cacheMiddleware);

  // Routes
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(usersRoutes, { prefix: '/api/v1' });
  await app.register(listsRoutes, { prefix: '/api/v1' });
  await app.register(leaderboardRoutes, { prefix: '/api/v1' });
  await app.register(statsRoutes, { prefix: '/api/v1' });
  await app.register(tokenRoutes, { prefix: '/api/v1' });
  await app.register(debugRoutes, { prefix: '/api/v1' });
  await app.register(slotsRoutes, { prefix: '/api/v1' });
  await app.register(exportRoutes, { prefix: '/api/v1' });

  // Also register health routes at root for backwards compat
  await app.register(healthRoutes);

  // API info endpoint
  app.get('/api/v1', async () => {
    return {
      name: 'efp-public-api',
      version: 'v1',
      docs: 'https://docs.ethfollow.xyz/api',
      source: 'https://github.com/ethereumfollowprotocol/api',
    };
  });

  // Root redirect to /api/v1
  app.get('/', async (request, reply) => {
    return reply.redirect(301, '/api/v1');
  });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, url: request.url }, 'Request error');

    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: error.name || 'Error',
      message: error.message,
    });
  });

  // 404 handler
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      response: 'Not Found',
    });
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
