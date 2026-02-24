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

  // Clean up pending_list_metadata rows that have already been applied to their lists.
  // Only delete rows where the list has the metadata set — rows for lists that haven't
  // been fully created yet are preserved indefinitely.
  const cleanupResult = await query(
    `
    DELETE FROM pending_list_metadata p
    WHERE EXISTS (
      SELECT 1 FROM efp_lists l
      WHERE l.list_storage_location_chain_id = p.chain_id
        AND l.list_storage_location_contract_address = p.contract_address
        AND l.list_storage_location_slot = p.slot
        AND (
          (p.key = 'user' AND l."user" IS NOT NULL)
          OR (p.key = 'manager' AND l.manager IS NOT NULL)
        )
    )
  `
  );

  if (cleanupResult.rowCount && cleanupResult.rowCount > 0) {
    logger.info({ cleaned: cleanupResult.rowCount }, 'Cleaned up resolved pending_list_metadata rows');
  }

  const duration = Date.now() - startTime;
  logger.info({ duration, reconciled: staleUsers.rows.length }, 'Completed batch stats reconciliation');
}
