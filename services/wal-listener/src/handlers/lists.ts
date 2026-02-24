import { query, convertHexToBigInt, createLogger } from '@efp/shared';
import { publishEnsureUserStats, publishJob, publishResyncUserRelationships } from './jobs.js';

const logger = createLogger('lists-handler');

interface ListsData {
  token_id: number;
  user: string;
  manager: string;
}

export async function handleListsChange(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const list = data as unknown as ListsData;

  if (operation === 'INSERT' && list.user) {
    // New list created, ensure user has stats entry
    await publishEnsureUserStats(list.user.toLowerCase());
    logger.info({ tokenId: list.token_id, user: list.user }, 'New list created');
  } else if (operation === 'UPDATE') {
    // Always queue resync-list-relationships as a safety net
    await publishJob(
      'resync-list-relationships',
      { tokenId: list.token_id },
      { singletonKey: `resync-list:${list.token_id}`, singletonSeconds: 30 }
    );

    // If the list now has a user, check if it's their primary list for immediate recovery
    if (list.user) {
      const userAddress = list.user.toLowerCase();
      await publishEnsureUserStats(userAddress);

      try {
        const metadataResult = await query<{ value: string }>(
          `SELECT value FROM efp_account_metadata WHERE address = $1 AND key = 'primary-list'`,
          [userAddress]
        );

        if (metadataResult.rows.length > 0) {
          const primaryListId = convertHexToBigInt(metadataResult.rows[0].value);
          if (primaryListId !== null && primaryListId.toString() === list.token_id.toString()) {
            // This is the user's primary list — trigger immediate relationship resync
            await publishResyncUserRelationships(userAddress, list.token_id);
            logger.info(
              { tokenId: list.token_id, user: userAddress },
              'List updated with user set, triggered primary list resync'
            );
          }
        }
      } catch (err) {
        // Don't fail the handler — the resync-list-relationships job will catch this
        logger.error({ err, tokenId: list.token_id, user: userAddress }, 'Failed to check primary list for immediate resync');
      }
    }

    logger.info({ tokenId: list.token_id, user: list.user }, 'List updated, queued resync');
  }
}
