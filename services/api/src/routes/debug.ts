import type { FastifyInstance } from 'fastify';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('debug-routes');

export async function debugRoutes(app: FastifyInstance) {
  // GET /debug/num-events (P3)
  // Response shape: { num_events: number }
  // Note: efp_events table may not exist in all deployments
  app.get('/debug/num-events', async () => {
    try {
      const result = await query<{ count: string }>(
        `SELECT COUNT(*)::TEXT as count FROM efp_events`
      );
      return {
        num_events: parseInt(result.rows[0]?.count || '0', 10),
      };
    } catch {
      // Fallback: count list records as a proxy for events
      const result = await query<{ count: string }>(
        `SELECT COUNT(*)::TEXT as count FROM efp_list_records`
      );
      return {
        num_events: parseInt(result.rows[0]?.count || '0', 10),
      };
    }
  });

  // GET /debug/num-list-ops (P3)
  // Response shape: { num_list_ops: number }
  app.get('/debug/num-list-ops', async () => {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::TEXT as count FROM efp_list_records`
    );

    return {
      num_list_ops: parseInt(result.rows[0]?.count || '0', 10),
    };
  });

  // GET /debug/total-supply (P3)
  // Response shape: { total_supply: number }
  app.get('/debug/total-supply', async () => {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::TEXT as count FROM efp_lists`
    );

    return {
      total_supply: parseInt(result.rows[0]?.count || '0', 10),
    };
  });
}
