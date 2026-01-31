import type PgBoss from 'pg-boss';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('update-leaderboard-entry');

interface UpdateLeaderboardEntryJob {
  address: string;
}

export async function handleUpdateLeaderboardEntry(
  job: PgBoss.Job<UpdateLeaderboardEntryJob>
): Promise<void> {
  const { address } = job.data;

  logger.debug({ address }, 'Updating leaderboard entry');

  // Get user stats
  const statsResult = await query<{
    followers_count: number;
    following_count: number;
    mutuals_count: number;
    blocks_count: number;
    top8_count: number;
  }>(
    `SELECT followers_count, following_count, mutuals_count, blocks_count, top8_count
     FROM efp_user_stats WHERE address = $1`,
    [address]
  );

  if (statsResult.rows.length === 0) {
    logger.debug({ address }, 'No stats found, skipping leaderboard update');
    return;
  }

  const stats = statsResult.rows[0];

  // Skip if no activity
  if (stats.followers_count === 0 && stats.following_count === 0) {
    // Remove from leaderboard if exists
    await query(`DELETE FROM efp_leaderboard WHERE address = $1`, [address]);
    return;
  }

  // Calculate ranks (this is expensive, so we do partial updates)
  // Full ranking is done by the scheduled update-leaderboard-full job
  await query(
    `
    INSERT INTO efp_leaderboard (
      address, followers_count, following_count, mutuals_count, blocks_count, top8_count, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (address) DO UPDATE SET
      followers_count = EXCLUDED.followers_count,
      following_count = EXCLUDED.following_count,
      mutuals_count = EXCLUDED.mutuals_count,
      blocks_count = EXCLUDED.blocks_count,
      top8_count = EXCLUDED.top8_count,
      updated_at = NOW()
  `,
    [
      address,
      stats.followers_count,
      stats.following_count,
      stats.mutuals_count,
      stats.blocks_count,
      stats.top8_count,
    ]
  );

  logger.info({ address }, 'Updated leaderboard entry');
}
