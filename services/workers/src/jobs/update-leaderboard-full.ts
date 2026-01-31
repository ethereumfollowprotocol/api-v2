import type PgBoss from 'pg-boss';
import { getClient, createLogger } from '@efp/shared';

const logger = createLogger('update-leaderboard-full');

export async function handleUpdateLeaderboardFull(
  job: PgBoss.Job<Record<string, never>>
): Promise<void> {
  const startTime = Date.now();

  logger.info('Starting full leaderboard update');

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Truncate and repopulate with fresh rankings
    await client.query(`
      -- Clear existing leaderboard
      TRUNCATE efp_leaderboard;

      -- Repopulate with fresh rankings
      INSERT INTO efp_leaderboard (
        address,
        followers_count,
        following_count,
        mutuals_count,
        blocks_count,
        top8_count,
        followers_rank,
        following_rank,
        mutuals_rank,
        blocks_rank,
        top8_rank,
        updated_at
      )
      SELECT
        address,
        followers_count,
        following_count,
        mutuals_count,
        blocks_count,
        top8_count,
        RANK() OVER (ORDER BY followers_count DESC) as followers_rank,
        RANK() OVER (ORDER BY following_count DESC) as following_rank,
        RANK() OVER (ORDER BY mutuals_count DESC) as mutuals_rank,
        RANK() OVER (ORDER BY blocks_count DESC) as blocks_rank,
        RANK() OVER (ORDER BY top8_count DESC) as top8_rank,
        NOW() as updated_at
      FROM efp_user_stats
      WHERE followers_count > 0 OR following_count > 0;
    `);

    await client.query('COMMIT');

    const duration = Date.now() - startTime;
    logger.info({ duration }, 'Completed full leaderboard update');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
