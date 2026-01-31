import { createLogger } from '@efp/shared';
import { publishEnsureUserStats, publishJob } from './jobs.js';

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
    // User assignment changed, may need to resync
    await publishJob(
      'resync-list-relationships',
      { tokenId: list.token_id },
      { singletonKey: `resync-list:${list.token_id}`, singletonSeconds: 30 }
    );
    logger.info({ tokenId: list.token_id }, 'List updated, queued resync');
  }
}
