import { deleteCachePattern, createLogger } from '@efp/shared';
import { publishESUserSync } from './jobs.js';

const logger = createLogger('derived-handlers');

interface FollowersData {
  address: string;
  follower_address: string;
  is_blocked: boolean;
  is_muted: boolean;
}

interface FollowingData {
  address: string;
  following_address: string;
}

export async function handleFollowersChange(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const followers = data as unknown as FollowersData;

  // Invalidate cache for both addresses
  const patterns = [
    `efp:/users/${followers.address}/*`,
    `efp:/users/${followers.follower_address}/*`,
  ];

  for (const pattern of patterns) {
    const deleted = await deleteCachePattern(pattern);
    if (deleted > 0) {
      logger.debug({ pattern, count: deleted }, 'Invalidated cache keys');
    }
  }

  // Queue ES sync for affected addresses
  await publishESUserSync(followers.address);
  await publishESUserSync(followers.follower_address);
}

export async function handleFollowingChange(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const following = data as unknown as FollowingData;

  // Invalidate cache
  const patterns = [
    `efp:/users/${following.address}/*`,
    `efp:/users/${following.following_address}/*`,
  ];

  for (const pattern of patterns) {
    const deleted = await deleteCachePattern(pattern);
    if (deleted > 0) {
      logger.debug({ pattern, count: deleted }, 'Invalidated cache keys');
    }
  }
}
