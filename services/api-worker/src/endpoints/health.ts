import { contentJson, OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types.js';
import { ensureDb } from '../middleware/db.js';
import { query } from '../db/query.js';

export class HealthCheck extends OpenAPIRoute {
  schema = {
    tags: ['Health'],
    summary: 'Health check',
    responses: {
      '200': {
        description: 'Service healthy',
        ...contentJson(
          z.object({
            status: z.string(),
            database: z.string(),
          })
        ),
      },
      '503': {
        description: 'Service unhealthy',
        ...contentJson(
          z.object({
            status: z.string(),
            database: z.string(),
            error: z.string().optional(),
          })
        ),
      },
    },
  };

  async handle(c: AppContext) {
    try {
      await query(await ensureDb(c), 'SELECT 1 AS ok');
      return c.json({ status: 'ok', database: 'connected' });
    } catch (err) {
      return c.json(
        {
          status: 'error',
          database: 'disconnected',
          error: err instanceof Error ? err.message : String(err),
        },
        503
      );
    }
  }
}
