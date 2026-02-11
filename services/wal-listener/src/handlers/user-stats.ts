import { deleteCache } from '@efp/shared';
import { publishLeaderboardEntry } from './jobs.js';

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

  // Queue leaderboard update
  await publishLeaderboardEntry(stats.address);
}
