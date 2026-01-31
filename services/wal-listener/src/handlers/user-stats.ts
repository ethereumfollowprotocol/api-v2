import { deleteCache, getElasticsearch, ES_INDICES, createLogger } from '@efp/shared';
import { publishLeaderboardEntry } from './jobs.js';

const logger = createLogger('user-stats-handler');

interface UserStatsData {
  address: string;
  followers_count: number;
  following_count: number;
  mutuals_count: number;
}

export async function handleUserStatsChange(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const stats = data as unknown as UserStatsData;

  // Invalidate cache
  await deleteCache(`efp:/users/${stats.address}/stats`);
  await deleteCache(`efp:/users/${stats.address}/details`);

  // Update Elasticsearch
  try {
    const es = getElasticsearch();
    await es.update({
      index: ES_INDICES.users,
      id: stats.address,
      doc: {
        followers_count: stats.followers_count,
        following_count: stats.following_count,
        mutuals_count: stats.mutuals_count,
        updated_at: new Date().toISOString(),
      },
      upsert: {
        address: stats.address,
        followers_count: stats.followers_count,
        following_count: stats.following_count,
        mutuals_count: stats.mutuals_count,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.warn({ err, address: stats.address }, 'Failed to update Elasticsearch');
  }

  // Queue leaderboard update
  await publishLeaderboardEntry(stats.address);
}
