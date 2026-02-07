import { deleteCache } from '@efp/shared';

interface ENSMetadataNotification {
  address: string;
}

export async function handleENSMetadataChange(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const notification = data as unknown as ENSMetadataNotification;
  const address = notification.address;

  // Invalidate cache
  await deleteCache(`efp:/users/${address}/account`);
  await deleteCache(`efp:/users/${address}/details`);
  await deleteCache(`efp:/users/${address}/ens`);
}
