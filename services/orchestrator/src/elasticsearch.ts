import { query, getElasticsearch, ES_INDICES, createLogger } from '@efp/shared';

const logger = createLogger('elasticsearch');

interface UserDocument {
  address: string;
  ens_name: string | null;
  ens_name_keyword: string | null;
  avatar: string | null;
  header: string | null;
  primary_list_id: number | null;
  followers_count: number;
  following_count: number;
  mutuals_count: number;
  followers_rank: number | null;
  following_rank: number | null;
  mutuals_rank: number | null;
  blocks_rank: number | null;
  top8_rank: number | null;
  has_primary_list: boolean;
  updated_at: string;
}

export async function indexUsersToElasticsearch(): Promise<void> {
  logger.info('Starting Elasticsearch indexing');

  const es = getElasticsearch();
  const BATCH_SIZE = 500;
  let offset = 0;
  let totalIndexed = 0;

  while (true) {
    // Fetch users in batches
    const result = await query<{
      address: string;
      name: string | null;
      avatar: string | null;
      header: string | null;
      primary_list_id: string | null;
      followers_count: number;
      following_count: number;
      mutuals_count: number;
      followers_rank: number | null;
      following_rank: number | null;
      mutuals_rank: number | null;
      blocks_rank: number | null;
      top8_rank: number | null;
      updated_at: Date;
    }>(
      `
      SELECT
        us.address,
        em.name,
        em.avatar,
        em.header,
        us.primary_list_id::TEXT,
        us.followers_count,
        us.following_count,
        us.mutuals_count,
        lb.followers_rank,
        lb.following_rank,
        lb.mutuals_rank,
        lb.blocks_rank,
        lb.top8_rank,
        us.updated_at
      FROM efp_user_stats us
      LEFT JOIN ens_metadata em ON em.address = us.address
      LEFT JOIN efp_leaderboard lb ON lb.address = us.address
      WHERE us.followers_count > 0 OR us.following_count > 0
      ORDER BY us.address
      LIMIT $1 OFFSET $2
    `,
      [BATCH_SIZE, offset]
    );

    if (result.rows.length === 0) {
      break;
    }

    // Prepare bulk operations
    const operations: object[] = [];

    for (const row of result.rows) {
      operations.push({ index: { _index: ES_INDICES.users, _id: row.address } });
      operations.push({
        address: row.address,
        ens_name: row.name || null,
        ens_name_keyword: row.name || null,
        avatar: row.avatar || null,
        header: row.header || null,
        primary_list_id: row.primary_list_id ? parseInt(row.primary_list_id, 10) : null,
        followers_count: row.followers_count,
        following_count: row.following_count,
        mutuals_count: row.mutuals_count,
        followers_rank: row.followers_rank,
        following_rank: row.following_rank,
        mutuals_rank: row.mutuals_rank,
        blocks_rank: row.blocks_rank,
        top8_rank: row.top8_rank,
        has_primary_list: row.primary_list_id !== null,
        updated_at: row.updated_at.toISOString(),
      } as UserDocument);
    }

    // Bulk index
    const bulkResponse = await es.bulk({ operations });

    if (bulkResponse.errors) {
      const erroredDocuments: string[] = [];
      bulkResponse.items.forEach((action, i) => {
        const operation = action.index;
        if (operation?.error) {
          erroredDocuments.push(operation._id || 'unknown');
        }
      });
      logger.warn({ count: erroredDocuments.length }, 'Some documents failed to index');
    }

    totalIndexed += result.rows.length;
    offset += BATCH_SIZE;

    logger.info({ indexed: totalIndexed, batch: result.rows.length }, 'Indexed batch');
  }

  // Refresh index to make documents searchable
  await es.indices.refresh({ index: ES_INDICES.users });

  logger.info({ total: totalIndexed }, 'Elasticsearch indexing complete');
}
