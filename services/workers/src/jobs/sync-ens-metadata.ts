import type PgBoss from 'pg-boss';
import {
  query,
  createLogger,
  fetchENSProfileByAddress,
  toENSMetadataRow,
  upsertENSMetadata,
} from '@efp/shared';

const logger = createLogger('sync-ens-metadata');

interface SyncENSMetadataJob {
  address: string;
  force?: boolean;
}

export async function handleSyncENSMetadata(
  job: PgBoss.Job<SyncENSMetadataJob>
): Promise<void> {
  const { address, force } = job.data;

  // Check if we have recent data (skip if fresh with actual name and not forced)
  if (!force) {
    const existing = await query<{ updated_at: Date }>(
      `
      SELECT updated_at FROM ens_metadata
      WHERE address = $1
        AND updated_at > NOW() - INTERVAL '4 hours'
        AND name IS NOT NULL AND name != ''
    `,
      [address]
    );

    if (existing.rows.length > 0) {
      logger.debug({ address }, 'ENS metadata is fresh, skipping');
      return;
    }
  }

  logger.debug({ address }, 'Fetching ENS metadata');

  try {
    // The worker returns only verified, normalized primary names (404 → null otherwise).
    // force=true bypasses the worker's own cache.
    const profile = await fetchENSProfileByAddress(address, force);
    const row = profile ? toENSMetadataRow(profile) : null;
    await upsertENSMetadata(address, row);

    if (row) logger.info({ address, name: row.name, hasAvatar: !!row.avatar }, 'Updated ENS metadata');
  } catch (err) {
    logger.error({ err, address }, 'Failed to fetch ENS metadata');
    throw err; // Will trigger retry
  }
}
