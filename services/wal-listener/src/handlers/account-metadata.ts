import { convertHexToBigInt, createLogger } from '@efp/shared';
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

  const newPrimaryList = metadata.value ? Number(convertHexToBigInt(metadata.value)) : null;

  // Queue a full resync job for this user
  await publishResyncUserRelationships(metadata.address.toLowerCase(), newPrimaryList);

  logger.info(
    { address: metadata.address, operation, newPrimaryList },
    'Primary list changed, queued resync'
  );
}
