import type { FastifyInstance } from 'fastify';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('stats-routes');

export async function statsRoutes(app: FastifyInstance) {
  // GET /stats (P1)
  // Response shape must match production: { stats: { address_count, list_count, list_op_count, user_count } }
  app.get('/stats', async () => {
    const result = await query<{
      address_count: string;
      list_count: string;
      list_op_count: string;
      user_count: string;
    }>(
      `
      SELECT
        (SELECT COUNT(DISTINCT address)::TEXT FROM efp_user_stats) as address_count,
        (SELECT COUNT(*)::TEXT FROM efp_lists) as list_count,
        (SELECT COUNT(*)::TEXT FROM efp_list_records) as list_op_count,
        (SELECT COUNT(DISTINCT owner)::TEXT FROM efp_lists) as user_count
    `
    );

    const row = result.rows[0];

    return {
      stats: {
        address_count: row?.address_count || '0',
        list_count: row?.list_count || '0',
        list_op_count: row?.list_op_count || '0',
        user_count: row?.user_count || '0',
      },
    };
  });

  // GET /discover (P2)
  app.get<{ Querystring: { limit?: string } }>(
    '/discover',
    async (request) => {
      const { limit = '20' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 20, 50);

      // Get recent followers activity
      const result = await query<{
        address: string;
        follower_address: string;
        updated_at: Date;
      }>(
        `
        SELECT address, follower_address, updated_at
        FROM efp_followers
        WHERE is_blocked = FALSE AND is_muted = FALSE
        ORDER BY updated_at DESC
        LIMIT $1
      `,
        [limitNum]
      );

      // Response shape must match production: { latestFollows: [...] }
      return {
        latestFollows: result.rows.map((row) => ({
          followed: row.address,
          follower: row.follower_address,
          timestamp: row.updated_at.toISOString(),
        })),
      };
    }
  );

  // GET /minters (P3)
  app.get<{ Querystring: { limit?: string } }>(
    '/minters',
    async (request) => {
      const { limit = '50' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

      const result = await query<{
        owner: string;
        token_id: string;
        created_at: Date;
      }>(
        `
        SELECT owner, token_id::TEXT, created_at
        FROM efp_lists
        ORDER BY token_id DESC
        LIMIT $1
      `,
        [limitNum]
      );

      return {
        minters: result.rows.map((row) => ({
          address: row.owner,
          token_id: row.token_id,
          minted_at: row.created_at.toISOString(),
        })),
      };
    }
  );
}
