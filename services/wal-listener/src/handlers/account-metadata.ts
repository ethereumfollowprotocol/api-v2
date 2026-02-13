import { convertHexToBigInt, createLogger, deleteCache } from '@efp/shared';
import { publishResyncUserRelationships } from './jobs.js';

const logger = createLogger('account-metadata-handler');

interface AccountMetadataData {
  address: string;
  key: string;
  value: string;
}

export async function handleAccountMetadataChange(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const metadata = data as unknown as AccountMetadataData;

  // Only care about primary-list changes
  if (metadata.key !== 'primary-list') return;

  const address = metadata.address.toLowerCase();
  const newPrimaryList = metadata.value ? Number(convertHexToBigInt(metadata.value)) : null;

  // Invalidate cache immediately so users see the new primary list
  await deleteCache(`efp:/users/${address}/details`);
  await deleteCache(`efp:/users/${address}/stats`);

  // Queue a full resync job for this user's relationships
  await publishResyncUserRelationships(address, newPrimaryList);

  logger.info(
    { address, operation, newPrimaryList },
    'Primary list changed, invalidated cache and queued resync'
  );
}
