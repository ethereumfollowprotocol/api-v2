import { deleteCache, getElasticsearch, ES_INDICES, createLogger } from '@efp/shared';

const logger = createLogger('ens-metadata-handler');

interface ENSMetadataData {
  address: string;
  name: string;
  avatar: string;
  header: string;
}

export async function handleENSMetadataChange(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const ens = data as unknown as ENSMetadataData;

  // Invalidate cache
  await deleteCache(`efp:/users/${ens.address}/account`);
  await deleteCache(`efp:/users/${ens.address}/details`);
  await deleteCache(`efp:/users/${ens.address}/ens`);

  // Update Elasticsearch
  try {
    const es = getElasticsearch();
    await es.update({
      index: ES_INDICES.users,
      id: ens.address,
      doc: {
        ens_name: ens.name || null,
        ens_name_keyword: ens.name || null,
        avatar: ens.avatar || null,
        header: ens.header || null,
        updated_at: new Date().toISOString(),
      },
      upsert: {
        address: ens.address,
        ens_name: ens.name || null,
        ens_name_keyword: ens.name || null,
        avatar: ens.avatar || null,
        header: ens.header || null,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.warn({ err, address: ens.address }, 'Failed to update Elasticsearch');
  }
}
