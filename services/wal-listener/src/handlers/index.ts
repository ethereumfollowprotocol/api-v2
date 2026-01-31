import { createLogger } from '@efp/shared';
import { handleListRecordsChange } from './list-records.js';
import { handleListRecordTagsChange } from './list-record-tags.js';
import { handleAccountMetadataChange } from './account-metadata.js';
import { handleListsChange } from './lists.js';
import { handleFollowersChange, handleFollowingChange } from './derived.js';
import { handleUserStatsChange } from './user-stats.js';
import { handleENSMetadataChange } from './ens-metadata.js';

const logger = createLogger('wal-handlers');

export interface WALEvent {
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  data: Record<string, unknown>;
}

type EventHandler = (operation: string, data: Record<string, unknown>) => Promise<void>;

// Map table names to handlers
const eventHandlers: Record<string, EventHandler> = {
  efp_list_records: handleListRecordsChange,
  efp_list_record_tags: handleListRecordTagsChange,
  efp_lists: handleListsChange,
  efp_account_metadata: handleAccountMetadataChange,
  efp_followers: handleFollowersChange,
  efp_following: handleFollowingChange,
  efp_user_stats: handleUserStatsChange,
  ens_metadata: handleENSMetadataChange,
};

export async function handleEvent(event: WALEvent): Promise<void> {
  const handler = eventHandlers[event.table];

  if (!handler) {
    logger.debug({ table: event.table }, 'No handler for table, skipping');
    return;
  }

  try {
    await handler(event.operation, event.data);
    logger.debug({ table: event.table, operation: event.operation }, 'Event handled');
  } catch (err) {
    logger.error({ err, event }, 'Error handling event');
    throw err;
  }
}
