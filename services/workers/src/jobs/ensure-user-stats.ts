import type PgBoss from 'pg-boss';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('ensure-user-stats');

interface EnsureUserStatsJob {
  address: string;
}

export async function handleEnsureUserStats(
  job: PgBoss.Job<EnsureUserStatsJob>
): Promise<void> {
  const { address } = job.data;

  logger.debug({ address }, 'Ensuring user stats exist');

  // Insert if not exists
  await query(
    `
    INSERT INTO efp_user_stats (address, created_at, updated_at)
    VALUES ($1, NOW(), NOW())
    ON CONFLICT (address) DO NOTHING
  `,
    [address]
  );

  logger.debug({ address }, 'User stats ensured');
}
