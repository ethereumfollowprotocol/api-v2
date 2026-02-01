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
  // Response shape: { latestFollows: [{ address, name, avatar, header, followers, following }] }
  app.get<{ Querystring: { limit?: string } }>(
    '/discover',
    async (request) => {
      const { limit = '20' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 20, 50);

      // Get recent unique users who were followed
      const result = await query<{
        address: string;
        name: string | null;
        avatar: string | null;
        header: string | null;
        followers_count: number;
        following_count: number;
      }>(
        `
        WITH recent_follows AS (
          SELECT DISTINCT ON (address) address, updated_at
          FROM efp_followers
          WHERE is_blocked = FALSE AND is_muted = FALSE
          ORDER BY address, updated_at DESC
        )
        SELECT
          rf.address,
          e.name,
          e.avatar,
          e.header,
          COALESCE(us.followers_count, 0) as followers_count,
          COALESCE(us.following_count, 0) as following_count
        FROM recent_follows rf
        LEFT JOIN ens_metadata e ON e.address = rf.address
        LEFT JOIN efp_user_stats us ON us.address = rf.address
        ORDER BY rf.updated_at DESC
        LIMIT $1
      `,
        [limitNum]
      );

      return {
        latestFollows: result.rows.map((row) => ({
          address: row.address.toLowerCase(),
          name: row.name || null,
          avatar: row.avatar || null,
          header: row.header || null,
          followers: row.followers_count.toString(),
          following: row.following_count.toString(),
        })),
      };
    }
  );

  // GET /minters (P3)
  // Response shape: { minters: [{ address, name, avatar, list }] }
  app.get<{ Querystring: { limit?: string } }>(
    '/minters',
    async (request) => {
      const { limit = '50' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

      const result = await query<{
        owner: string;
        token_id: string;
        name: string | null;
        avatar: string | null;
      }>(
        `
        SELECT l.owner, l.token_id::TEXT, e.name, e.avatar
        FROM efp_lists l
        LEFT JOIN ens_metadata e ON e.address = l.owner
        ORDER BY l.token_id DESC
        LIMIT $1
      `,
        [limitNum]
      );

      return {
        minters: result.rows.map((row) => ({
          address: row.owner.toLowerCase(),
          name: row.name || null,
          avatar: row.avatar || null,
          list: row.token_id,
        })),
      };
    }
  );
}
