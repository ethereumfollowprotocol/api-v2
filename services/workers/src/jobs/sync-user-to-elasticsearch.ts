import type PgBoss from 'pg-boss';
import { query, getElasticsearch, ES_INDICES, createLogger } from '@efp/shared';

const logger = createLogger('sync-user-to-elasticsearch');

interface SyncUserToElasticsearchJob {
  address: string;
}

export async function handleSyncUserToElasticsearch(
  job: PgBoss.Job<SyncUserToElasticsearchJob>
): Promise<void> {
  const { address } = job.data;
  const es = getElasticsearch();

  // Fetch user data from PostgreSQL
  const result = await query<{
    address: string;
    primary_list_id: string | null;
    followers_count: number;
    following_count: number;
    mutuals_count: number;
    name: string | null;
    avatar: string | null;
    header: string | null;
    followers_rank: number | null;
    following_rank: number | null;
    mutuals_rank: number | null;
    blocks_rank: number | null;
    top8_rank: number | null;
  }>(
    `
    SELECT
      us.address,
      us.primary_list_id::TEXT,
      us.followers_count,
      us.following_count,
      us.mutuals_count,
      em.name,
      em.avatar,
      em.header,
      lb.followers_rank,
      lb.following_rank,
      lb.mutuals_rank,
      lb.blocks_rank,
      lb.top8_rank
    FROM efp_user_stats us
    LEFT JOIN ens_metadata em ON em.address = us.address
    LEFT JOIN efp_leaderboard lb ON lb.address = us.address
    WHERE us.address = $1
  `,
    [address]
  );

  if (result.rows.length === 0) {
    logger.debug({ address }, 'No user stats found, skipping ES sync');
    return;
  }

  const user = result.rows[0];

  // Upsert to Elasticsearch
  await es.update({
    index: ES_INDICES.users,
    id: address,
    doc: {
      address: user.address,
      ens_name: user.name || null,
      ens_name_keyword: user.name || null,
      avatar: user.avatar || null,
      header: user.header || null,
      primary_list_id: user.primary_list_id ? parseInt(user.primary_list_id, 10) : null,
      followers_count: user.followers_count,
      following_count: user.following_count,
      mutuals_count: user.mutuals_count,
      followers_rank: user.followers_rank,
      following_rank: user.following_rank,
      mutuals_rank: user.mutuals_rank,
      blocks_rank: user.blocks_rank,
      top8_rank: user.top8_rank,
      has_primary_list: user.primary_list_id !== null,
      updated_at: new Date().toISOString(),
    },
    upsert: {
      address: user.address,
      ens_name: user.name || null,
      ens_name_keyword: user.name || null,
      avatar: user.avatar || null,
      header: user.header || null,
      primary_list_id: user.primary_list_id ? parseInt(user.primary_list_id, 10) : null,
      followers_count: user.followers_count,
      following_count: user.following_count,
      mutuals_count: user.mutuals_count,
      followers_rank: user.followers_rank,
      following_rank: user.following_rank,
      mutuals_rank: user.mutuals_rank,
      blocks_rank: user.blocks_rank,
      top8_rank: user.top8_rank,
      has_primary_list: user.primary_list_id !== null,
      updated_at: new Date().toISOString(),
    },
  });

  logger.debug({ address }, 'Synced user to Elasticsearch');
}
