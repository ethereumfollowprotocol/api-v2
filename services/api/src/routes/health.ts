import type { FastifyInstance, FastifyReply } from 'fastify';
import { getPool, getRedis, getElasticsearch, getSystemState } from '@efp/shared';

export async function healthRoutes(app: FastifyInstance) {
  // Basic health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Database health check - returns plain text "ok" to match production
  app.get('/database/health', async (request, reply: FastifyReply) => {
    try {
      await getPool().query('SELECT 1');
      reply.type('text/plain').send('ok');
    } catch {
      reply.status(503).type('text/plain').send('error');
    }
  });

  // Service health with dependencies
  app.get('/serviceHealth', async (request, reply) => {
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

    // Check PostgreSQL
    try {
      const start = Date.now();
      await getPool().query('SELECT 1');
      checks.postgres = { status: 'ok', latency: Date.now() - start };
    } catch (err) {
      checks.postgres = { status: 'error', error: (err as Error).message };
    }

    // Check Redis
    try {
      const start = Date.now();
      await getRedis().ping();
      checks.redis = { status: 'ok', latency: Date.now() - start };
    } catch (err) {
      checks.redis = { status: 'error', error: (err as Error).message };
    }

    // Check Elasticsearch
    try {
      const start = Date.now();
      await getElasticsearch().ping();
      checks.elasticsearch = { status: 'ok', latency: Date.now() - start };
    } catch (err) {
      checks.elasticsearch = { status: 'error', error: (err as Error).message };
    }

    // Get system state
    let systemState;
    try {
      systemState = await getSystemState();
    } catch {
      systemState = { phase: 'unknown', indexerCaughtUp: false, migrationComplete: false };
    }

    const allHealthy = Object.values(checks).every((c) => c.status === 'ok');

    reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
      system: systemState,
    });
  });
}
