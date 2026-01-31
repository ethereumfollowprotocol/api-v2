import type PgBoss from 'pg-boss';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('batch-reconcile-stats');

export async function handleBatchReconcileStats(
  job: PgBoss.Job<Record<string, never>>
): Promise<void> {
  const startTime = Date.now();

  logger.info('Starting batch stats reconciliation');

  // Find users with potentially stale stats
  const staleUsers = await query<{ address: string }>(
    `
    SELECT DISTINCT us.address
    FROM efp_user_stats us
    WHERE us.updated_at < NOW() - INTERVAL '1 hour'
      AND (
        EXISTS (
          SELECT 1 FROM efp_followers f
          WHERE f.address = us.address
            AND f.updated_at > us.updated_at
        )
        OR EXISTS (
          SELECT 1 FROM efp_following f
          WHERE f.address = us.address
            AND f.updated_at > us.updated_at
        )
      )
    LIMIT 1000
  `
  );

  logger.info({ count: staleUsers.rows.length }, 'Found stale user stats');

  // Update stats in batches
  for (const row of staleUsers.rows) {
    await query(
      `
      UPDATE efp_user_stats us
      SET
        followers_count = COALESCE((SELECT COUNT(*) FROM efp_followers WHERE address = us.address AND is_blocked = FALSE AND is_muted = FALSE), 0),
        following_count = COALESCE((SELECT COUNT(*) FROM efp_following WHERE address = us.address AND is_blocked = FALSE AND is_muted = FALSE), 0),
        mutuals_count = COALESCE((SELECT COUNT(*) FROM efp_mutuals WHERE address_a = us.address OR address_b = us.address), 0),
        updated_at = NOW()
      WHERE us.address = $1
    `,
      [row.address]
    );
  }

  const duration = Date.now() - startTime;
  logger.info({ duration, reconciled: staleUsers.rows.length }, 'Completed batch stats reconciliation');
}
