import { deleteCache, getElasticsearch, ES_INDICES, createLogger, query } from '@efp/shared';

const logger = createLogger('ens-metadata-handler');

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

  // For deletes, just remove from Elasticsearch
  if (operation === 'DELETE') {
    try {
      const es = getElasticsearch();
      await es.update({
        index: ES_INDICES.users,
        id: address,
        doc: {
          ens_name: null,
          ens_name_keyword: null,
          avatar: null,
          header: null,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.warn({ err, address }, 'Failed to update Elasticsearch on delete');
    }
    return;
  }

  // Fetch the full data from the database
  const result = await query<{ name: string | null; avatar: string | null; header: string | null }>(
    `SELECT name, avatar, header FROM ens_metadata WHERE address = $1`,
    [address]
  );

  if (result.rows.length === 0) {
    logger.debug({ address }, 'ENS metadata not found in database');
    return;
  }

  const ens = result.rows[0];

  // Update Elasticsearch
  try {
    const es = getElasticsearch();
    await es.update({
      index: ES_INDICES.users,
      id: address,
      doc: {
        ens_name: ens.name || null,
        ens_name_keyword: ens.name || null,
        avatar: ens.avatar || null,
        header: ens.header || null,
        updated_at: new Date().toISOString(),
      },
      upsert: {
        address: address,
        ens_name: ens.name || null,
        ens_name_keyword: ens.name || null,
        avatar: ens.avatar || null,
        header: ens.header || null,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.warn({ err, address }, 'Failed to update Elasticsearch');
  }
}
