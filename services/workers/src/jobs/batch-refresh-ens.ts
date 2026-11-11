import type PgBoss from 'pg-boss';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('batch-refresh-ens');

export async function handleBatchRefreshENS(
  _job: PgBoss.Job<Record<string, never>>,
  boss: PgBoss
): Promise<void> {
  logger.info('Starting batch ENS refresh');

  // Find addresses with stale ENS data (older than 1 day)
  const staleAddresses = await query<{ address: string }>(
    `
    SELECT address
    FROM ens_metadata
    WHERE updated_at < NOW() - INTERVAL '1 day'
      OR updated_at IS NULL
    ORDER BY updated_at ASC NULLS FIRST
    LIMIT 500
  `
  );

  logger.info({ count: staleAddresses.rows.length }, 'Found stale ENS records');

  for (const row of staleAddresses.rows) {
    await boss.send('sync-ens-metadata', {
      address: row.address,
      force: true,
    });
  }

  logger.info({ count: staleAddresses.rows.length }, 'Queued ENS refresh jobs');
}
