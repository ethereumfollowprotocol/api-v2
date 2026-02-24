import type PgBoss from 'pg-boss';
import { query, convertHexToBigInt, createLogger } from '@efp/shared';

const logger = createLogger('resync-list-relationships');

interface ResyncListRelationshipsJob {
  tokenId: number;
}

export async function handleResyncListRelationships(
  job: PgBoss.Job<ResyncListRelationshipsJob>
): Promise<void> {
  const { tokenId } = job.data;

  logger.info({ tokenId }, 'Resyncing list relationships');

  // Look up the list to get its user
  const listResult = await query<{ user: string | null }>(
    `SELECT "user" FROM efp_lists WHERE token_id = $1`,
    [tokenId]
  );

  if (listResult.rows.length === 0) {
    logger.warn({ tokenId }, 'List not found, skipping resync');
    return;
  }

  const user = listResult.rows[0].user?.toLowerCase();
  if (!user) {
    logger.warn({ tokenId }, 'List has no user, skipping resync');
    return;
  }

  // Check if this is the user's primary list
  const metadataResult = await query<{ value: string }>(
    `SELECT value FROM efp_account_metadata WHERE address = $1 AND key = 'primary-list'`,
    [user]
  );

  if (metadataResult.rows.length === 0) {
    logger.debug({ tokenId, user }, 'User has no primary list set, skipping derived table resync');
    return;
  }

  const primaryListId = convertHexToBigInt(metadataResult.rows[0].value);
  if (primaryListId === null || primaryListId.toString() !== tokenId.toString()) {
    logger.debug({ tokenId, user, primaryListId: primaryListId?.toString() }, 'Not primary list, skipping derived table resync');
    return;
  }

  // This IS the user's primary list — delegate to resync-user-relationships for full rebuild
  const boss = (job as unknown as { boss: PgBoss }).boss;
  if (boss) {
    await boss.send(
      'resync-user-relationships',
      { address: user, newPrimaryList: tokenId },
      { singletonKey: `resync:${user}`, singletonSeconds: 30 }
    );
    logger.info({ tokenId, user }, 'Delegated to resync-user-relationships (primary list)');
  } else {
    logger.warn({ tokenId, user }, 'No boss instance available to delegate resync');
  }
}
