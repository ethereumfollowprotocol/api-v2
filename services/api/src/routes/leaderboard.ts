import type { FastifyInstance } from 'fastify';
import { query, type Address, type LeaderboardEntry, createLogger } from '@efp/shared';

const logger = createLogger('leaderboard-routes');

interface LeaderboardQuery {
  limit?: string;
  offset?: string;
  sort?: string;
  direction?: string;
}

// Get last updated time for leaderboard
async function getLastUpdated(): Promise<string> {
  const result = await query<{ updated_at: Date }>(
    `SELECT MAX(updated_at) as updated_at FROM efp_leaderboard`
  );
  return result.rows[0]?.updated_at?.toISOString() || new Date().toISOString();
}

export async function leaderboardRoutes(app: FastifyInstance) {
  // GET /leaderboard/ranked (P1)
  app.get<{ Querystring: LeaderboardQuery }>(
    '/leaderboard/ranked',
    async (request) => {
      const {
        limit = '50',
        offset = '0',
        sort = 'mutuals',
        direction = 'DESC',
      } = request.query;

      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const offsetNum = parseInt(offset, 10) || 0;
      const dir = direction.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Map sort field to column
      const sortColumn =
        {
          mutuals: 'l.mutuals_count',
          followers: 'l.followers_count',
          following: 'l.following_count',
          blocks: 'l.blocks_count',
          top8: 'l.top8_count',
        }[sort] || 'l.mutuals_count';

      const result = await query<{
        address: string;
        name: string | null;
        avatar: string | null;
        header: string | null;
        mutuals_rank: number | null;
        followers_rank: number | null;
        following_rank: number | null;
        blocks_rank: number | null;
        top8_rank: number | null;
        mutuals_count: number;
        following_count: number;
        followers_count: number;
        blocks_count: number;
        top8_count: number;
        updated_at: Date;
      }>(
        `
        SELECT
          l.address,
          e.name,
          e.avatar,
          e.header,
          l.mutuals_rank,
          l.followers_rank,
          l.following_rank,
          l.blocks_rank,
          l.top8_rank,
          l.mutuals_count,
          l.following_count,
          l.followers_count,
          COALESCE(us.blocks_count, 0) as blocks_count,
          COALESCE(us.top8_count, 0) as top8_count,
          l.updated_at
        FROM efp_leaderboard l
        LEFT JOIN ens_metadata e ON e.address = l.address
        LEFT JOIN efp_user_stats us ON us.address = l.address
        ORDER BY ${sortColumn} ${dir}
        LIMIT $1 OFFSET $2
      `,
        [limitNum, offsetNum]
      );

      const lastUpdated = await getLastUpdated();

      const results: LeaderboardEntry[] = result.rows.map((row) => ({
        address: row.address.toLowerCase() as Address,
        name: row.name || undefined,
        avatar: row.avatar || undefined,
        header: row.header || undefined,
        mutuals_rank: row.mutuals_rank?.toString() || null,
        followers_rank: row.followers_rank?.toString() || null,
        following_rank: row.following_rank?.toString() || null,
        blocks_rank: row.blocks_rank?.toString() || null,
        top8_rank: row.top8_rank?.toString() || null,
        mutuals: row.mutuals_count.toString(),
        following: row.following_count.toString(),
        followers: row.followers_count.toString(),
        blocks: row.blocks_count.toString(),
        top8: row.top8_count.toString(),
        updated_at: row.updated_at.toISOString(),
      }));

      return {
        last_updated: lastUpdated,
        results,
      };
    }
  );

  // GET /leaderboard/followers (P1)
  // Response shape must match production: [{ rank, address, followers_count: "string" }]
  app.get<{ Querystring: LeaderboardQuery }>(
    '/leaderboard/followers',
    async (request) => {
      const { limit = '50', offset = '0' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      const result = await query<{
        address: string;
        followers_count: number;
        followers_rank: number;
      }>(
        `
        SELECT address, followers_count, followers_rank
        FROM efp_leaderboard
        ORDER BY followers_rank ASC
        LIMIT $1 OFFSET $2
      `,
        [limitNum, offsetNum]
      );

      return result.rows.map((row) => ({
        rank: row.followers_rank,
        address: row.address.toLowerCase() as Address,
        followers_count: row.followers_count.toString(),
      }));
    }
  );

  // GET /leaderboard/following (P1)
  // Response shape must match production: [{ rank, address, following_count: "string" }]
  app.get<{ Querystring: LeaderboardQuery }>(
    '/leaderboard/following',
    async (request) => {
      const { limit = '50', offset = '0' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      const result = await query<{
        address: string;
        following_count: number;
        following_rank: number;
      }>(
        `
        SELECT address, following_count, following_rank
        FROM efp_leaderboard
        ORDER BY following_rank ASC
        LIMIT $1 OFFSET $2
      `,
        [limitNum, offsetNum]
      );

      return result.rows.map((row) => ({
        rank: row.following_rank,
        address: row.address.toLowerCase() as Address,
        following_count: row.following_count.toString(),
      }));
    }
  );

  // GET /leaderboard/blocks (P2)
  // Response shape must match production: [{ rank, address, blocks_count: "string" }]
  app.get<{ Querystring: LeaderboardQuery }>(
    '/leaderboard/blocks',
    async (request) => {
      const { limit = '50', offset = '0' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      const result = await query<{
        address: string;
        blocks_count: number;
        blocks_rank: number;
      }>(
        `
        SELECT l.address, COALESCE(us.blocks_count, 0) as blocks_count, l.blocks_rank
        FROM efp_leaderboard l
        LEFT JOIN efp_user_stats us ON us.address = l.address
        WHERE l.blocks_rank IS NOT NULL
        ORDER BY l.blocks_rank ASC
        LIMIT $1 OFFSET $2
      `,
        [limitNum, offsetNum]
      );

      return result.rows.map((row) => ({
        rank: row.blocks_rank,
        address: row.address.toLowerCase() as Address,
        blocks_count: row.blocks_count.toString(),
      }));
    }
  );

  // GET /leaderboard/mutuals (P1)
  // Response shape must match production: [{ rank, address, mutuals_count: "string" }]
  app.get<{ Querystring: LeaderboardQuery }>(
    '/leaderboard/mutuals',
    async (request) => {
      const { limit = '50', offset = '0' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      const result = await query<{
        address: string;
        mutuals_count: number;
        mutuals_rank: number;
      }>(
        `
        SELECT address, mutuals_count, mutuals_rank
        FROM efp_leaderboard
        WHERE mutuals_rank IS NOT NULL
        ORDER BY mutuals_rank ASC
        LIMIT $1 OFFSET $2
      `,
        [limitNum, offsetNum]
      );

      return result.rows.map((row) => ({
        rank: row.mutuals_rank,
        address: row.address.toLowerCase() as Address,
        mutuals_count: row.mutuals_count.toString(),
      }));
    }
  );

  // GET /leaderboard/blocked (P2) - users who are most blocked by others
  // Response shape must match production: [{ rank, address, blocked_count: "string" }]
  app.get<{ Querystring: LeaderboardQuery }>(
    '/leaderboard/blocked',
    async (request) => {
      const { limit = '50', offset = '0' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      const result = await query<{
        address: string;
        blocked_count: number;
      }>(
        `
        SELECT address, COUNT(*) as blocked_count
        FROM efp_followers
        WHERE is_blocked = TRUE
        GROUP BY address
        ORDER BY blocked_count DESC
        LIMIT $1 OFFSET $2
      `,
        [limitNum, offsetNum]
      );

      return result.rows.map((row, idx) => ({
        rank: offsetNum + idx + 1,
        address: row.address.toLowerCase() as Address,
        blocked_count: row.blocked_count.toString(),
      }));
    }
  );

  // GET /leaderboard/muted (P2) - users who are most muted by others
  // Response shape must match production: [{ rank, address, muted_count: "string" }]
  app.get<{ Querystring: LeaderboardQuery }>(
    '/leaderboard/muted',
    async (request) => {
      const { limit = '50', offset = '0' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      const result = await query<{
        address: string;
        muted_count: number;
      }>(
        `
        SELECT address, COUNT(*) as muted_count
        FROM efp_followers
        WHERE is_muted = TRUE
        GROUP BY address
        ORDER BY muted_count DESC
        LIMIT $1 OFFSET $2
      `,
        [limitNum, offsetNum]
      );

      return result.rows.map((row, idx) => ({
        rank: offsetNum + idx + 1,
        address: row.address.toLowerCase() as Address,
        muted_count: row.muted_count.toString(),
      }));
    }
  );

  // GET /leaderboard/mutes (P2) - users with most mutes given
  // Response shape must match production: [{ rank, address, mutes_count: "string" }]
  app.get<{ Querystring: LeaderboardQuery }>(
    '/leaderboard/mutes',
    async (request) => {
      const { limit = '50', offset = '0' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      const result = await query<{
        address: string;
        mutes_count: number;
      }>(
        `
        SELECT address, COUNT(*) as mutes_count
        FROM efp_following
        WHERE is_muted = TRUE
        GROUP BY address
        ORDER BY mutes_count DESC
        LIMIT $1 OFFSET $2
      `,
        [limitNum, offsetNum]
      );

      return result.rows.map((row, idx) => ({
        rank: offsetNum + idx + 1,
        address: row.address.toLowerCase() as Address,
        mutes_count: row.mutes_count.toString(),
      }));
    }
  );

  // GET /leaderboard/count (P2)
  // Response shape must match production: { leaderboardCount: "string" }
  app.get('/leaderboard/count', async () => {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::TEXT as count FROM efp_leaderboard`
    );

    return {
      leaderboardCount: result.rows[0]?.count || '0',
    };
  });

  // GET /leaderboard/search (P2)
  // Response shape must match production: { last_updated, results: [{ address, name, avatar, header, mutuals_rank, ... }] }
  app.get<{ Querystring: { term?: string; limit?: string } }>(
    '/leaderboard/search',
    async (request) => {
      const { term = '', limit = '20' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 20, 50);

      if (!term || term.length < 2) {
        return { last_updated: new Date().toISOString(), results: [] };
      }

      const result = await query<{
        address: string;
        name: string | null;
        avatar: string | null;
        header: string | null;
        mutuals_rank: number | null;
        followers_rank: number | null;
        following_rank: number | null;
        blocks_rank: number | null;
        top8_rank: number | null;
        mutuals_count: number;
        following_count: number;
        followers_count: number;
        blocks_count: number;
        top8_count: number;
        updated_at: Date;
      }>(
        `
        SELECT
          l.address,
          e.name,
          e.avatar,
          e.header,
          l.mutuals_rank,
          l.followers_rank,
          l.following_rank,
          l.blocks_rank,
          l.top8_rank,
          l.mutuals_count,
          l.following_count,
          l.followers_count,
          COALESCE(us.blocks_count, 0) as blocks_count,
          COALESCE(us.top8_count, 0) as top8_count,
          l.updated_at
        FROM efp_leaderboard l
        LEFT JOIN ens_metadata e ON e.address = l.address
        LEFT JOIN efp_user_stats us ON us.address = l.address
        WHERE e.name ILIKE $1 OR l.address ILIKE $1
        ORDER BY l.followers_count DESC
        LIMIT $2
      `,
        [`%${term}%`, limitNum]
      );

      const lastUpdated = await getLastUpdated();

      return {
        last_updated: lastUpdated,
        results: result.rows.map((row) => ({
          address: row.address.toLowerCase() as Address,
          name: row.name || null,
          avatar: row.avatar || null,
          header: row.header || null,
          mutuals_rank: row.mutuals_rank?.toString() || null,
          followers_rank: row.followers_rank?.toString() || null,
          following_rank: row.following_rank?.toString() || null,
          blocks_rank: row.blocks_rank?.toString() || null,
          top8_rank: row.top8_rank?.toString() || null,
          mutuals: row.mutuals_count.toString(),
          following: row.following_count.toString(),
          followers: row.followers_count.toString(),
          blocks: row.blocks_count.toString(),
          top8: row.top8_count.toString(),
          updated_at: row.updated_at.toISOString(),
        })),
      };
    }
  );

  // GET /leaderboard/all (P2) - alias for ranked
  app.get<{ Querystring: LeaderboardQuery }>(
    '/leaderboard/all',
    async (request, reply) => {
      // Redirect to ranked
      return reply.redirect('/api/v1/leaderboard/ranked' + (request.url.includes('?') ? '?' + request.url.split('?')[1] : ''));
    }
  );
}
