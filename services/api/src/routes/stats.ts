import type { FastifyInstance } from 'fastify';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('stats-routes');

export async function statsRoutes(app: FastifyInstance) {
  // GET /stats (P1)
  app.get('/stats', async () => {
    const result = await query<{
      total_users: string;
      total_lists: string;
      total_follows: string;
      total_blocks: string;
      total_mutes: string;
    }>(
      `
      SELECT
        (SELECT COUNT(DISTINCT address)::TEXT FROM efp_user_stats) as total_users,
        (SELECT COUNT(*)::TEXT FROM efp_lists) as total_lists,
        (SELECT COUNT(*)::TEXT FROM efp_followers WHERE is_blocked = FALSE AND is_muted = FALSE) as total_follows,
        (SELECT COUNT(*)::TEXT FROM efp_followers WHERE is_blocked = TRUE) as total_blocks,
        (SELECT COUNT(*)::TEXT FROM efp_followers WHERE is_muted = TRUE) as total_mutes
    `
    );

    const row = result.rows[0];

    return {
      total_users: parseInt(row?.total_users || '0', 10),
      total_lists: parseInt(row?.total_lists || '0', 10),
      total_follows: parseInt(row?.total_follows || '0', 10),
      total_blocks: parseInt(row?.total_blocks || '0', 10),
      total_mutes: parseInt(row?.total_mutes || '0', 10),
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

      return {
        recent_follows: result.rows.map((row) => ({
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
