import type PgBoss from 'pg-boss';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('update-user-stats');

interface UpdateUserStatsJob {
  address: string;
}

export async function handleUpdateUserStats(
  job: PgBoss.Job<UpdateUserStatsJob>
): Promise<void> {
  const { address } = job.data;

  logger.debug({ address }, 'Updating user stats');

  // Calculate all stats in a single query
  const result = await query(
    `
    WITH stats AS (
      SELECT
        COALESCE((
          SELECT COUNT(*) FROM efp_followers
          WHERE address = $1 AND is_blocked = FALSE AND is_muted = FALSE
        ), 0) as followers_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_following
          WHERE address = $1 AND is_blocked = FALSE AND is_muted = FALSE
        ), 0) as following_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_mutuals
          WHERE address_a = $1 OR address_b = $1
        ), 0) as mutuals_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_following
          WHERE address = $1 AND is_blocked = TRUE
        ), 0) as blocks_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_followers
          WHERE address = $1 AND is_blocked = TRUE
        ), 0) as blocked_by_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_following
          WHERE address = $1 AND is_muted = TRUE
        ), 0) as mutes_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_followers
          WHERE address = $1 AND is_muted = TRUE
        ), 0) as muted_by_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_followers
          WHERE address = $1 AND 'top8' = ANY(tags)
        ), 0) as top8_count
    )
    INSERT INTO efp_user_stats (
      address, followers_count, following_count, mutuals_count,
      blocks_count, blocked_by_count, mutes_count, muted_by_count, top8_count
    )
    SELECT $1, followers_count, following_count, mutuals_count,
           blocks_count, blocked_by_count, mutes_count, muted_by_count, top8_count
    FROM stats
    ON CONFLICT (address) DO UPDATE SET
      followers_count = EXCLUDED.followers_count,
      following_count = EXCLUDED.following_count,
      mutuals_count = EXCLUDED.mutuals_count,
      blocks_count = EXCLUDED.blocks_count,
      blocked_by_count = EXCLUDED.blocked_by_count,
      mutes_count = EXCLUDED.mutes_count,
      muted_by_count = EXCLUDED.muted_by_count,
      top8_count = EXCLUDED.top8_count,
      updated_at = NOW()
    RETURNING *
  `,
    [address]
  );

  logger.info({ address, stats: result.rows[0] }, 'Updated user stats');
}
