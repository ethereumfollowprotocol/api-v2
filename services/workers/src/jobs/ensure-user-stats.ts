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
  const result = await query(
    `
    INSERT INTO efp_user_stats (address, created_at, updated_at)
    VALUES ($1, NOW(), NOW())
    ON CONFLICT (address) DO NOTHING
    RETURNING address
  `,
    [address]
  );

  // If we inserted a new user, queue ENS sync
  if (result.rows.length > 0) {
    const boss = (job as unknown as { boss: PgBoss }).boss;
    if (boss) {
      await boss.send(
        'sync-ens-metadata',
        { address },
        { singletonKey: `ens:${address}`, singletonSeconds: 3600 }
      );
      logger.debug({ address }, 'Queued ENS sync for new user');
    }
  }

  logger.debug({ address }, 'User stats ensured');
}
