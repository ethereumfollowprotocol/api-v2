import { query, type Address, type FollowerEntry, type FollowingEntry, createLogger } from '@efp/shared';
import { getENSProfiles } from './ens.js';

const logger = createLogger('followers-service');

interface FollowersOptions {
  limit: number;
  offset: number;
  sort: 'latest' | 'followers' | 'earliest';
  tags?: string[];
  includeENS?: boolean;
}

interface AllFollowersOptions {
  sort: 'latest' | 'followers' | 'earliest';
  tags?: string[];
  includeENS?: boolean;
}

// Map sort option to SQL ORDER BY
function getSortClause(sort: string): string {
  switch (sort) {
    case 'latest':
      return 'ORDER BY f.updated_at DESC';
    case 'earliest':
      return 'ORDER BY f.updated_at ASC';
    case 'followers':
      return 'ORDER BY COALESCE(us.followers_count, 0) DESC';
    default:
      return 'ORDER BY f.updated_at DESC';
  }
}

// Get paginated followers
export async function getFollowers(
  address: Address,
  options: FollowersOptions
): Promise<FollowerEntry[]> {
  const { limit, offset, sort, tags, includeENS } = options;

  let tagFilter = '';
  const params: unknown[] = [address, limit, offset];

  if (tags && tags.length > 0) {
    tagFilter = 'AND f.tags && $4';
    params.push(tags);
  }

  const sortClause = getSortClause(sort);

  const result = await query<{
    follower_address: string;
    follower_list_id: string;
    tags: string[];
    is_blocked: boolean;
    is_muted: boolean;
    updated_at: Date;
    is_following: boolean;
  }>(
    `
    SELECT
      f.follower_address,
      f.follower_list_id::TEXT,
      f.tags,
      f.is_blocked,
      f.is_muted,
      f.updated_at,
      EXISTS (
        SELECT 1 FROM efp_following fw
        WHERE fw.address = $1 AND fw.following_address = f.follower_address
          AND fw.is_blocked = FALSE AND fw.is_muted = FALSE
      ) as is_following
    FROM efp_followers f
    LEFT JOIN efp_user_stats us ON us.address = f.follower_address
    WHERE f.address = $1 ${tagFilter}
    ${sortClause}
    LIMIT $2 OFFSET $3
  `,
    params
  );

  const followers: FollowerEntry[] = result.rows.map((row) => ({
    efp_list_nft_token_id: row.follower_list_id,
    address: row.follower_address.toLowerCase() as Address,
    tags: row.tags || [],
    is_following: row.is_following,
    is_blocked: row.is_blocked,
    is_muted: row.is_muted,
    updated_at: row.updated_at.toISOString(),
  }));

  // Add ENS data if requested
  if (includeENS && followers.length > 0) {
    const addresses = followers.map((f) => f.address);
    const ensProfiles = await getENSProfiles(addresses);

    for (const follower of followers) {
      const profile = ensProfiles.get(follower.address);
      if (profile) {
        follower.ens = profile;
      }
    }
  }

  return followers;
}

// Get all followers (no pagination)
export async function getAllFollowers(
  address: Address,
  options: AllFollowersOptions
): Promise<FollowerEntry[]> {
  return getFollowers(address, {
    ...options,
    limit: 10000, // Reasonable max
    offset: 0,
  });
}

// Get paginated following
export async function getFollowing(
  address: Address,
  options: FollowersOptions
): Promise<FollowingEntry[]> {
  const { limit, offset, sort, tags, includeENS } = options;

  let tagFilter = '';
  const params: unknown[] = [address, limit, offset];

  if (tags && tags.length > 0) {
    tagFilter = 'AND f.tags && $4';
    params.push(tags);
  }

  const sortClause = sort === 'followers'
    ? 'ORDER BY COALESCE(us.followers_count, 0) DESC'
    : sort === 'earliest'
    ? 'ORDER BY f.created_at ASC'
    : 'ORDER BY f.created_at DESC';

  const result = await query<{
    following_address: string;
    tags: string[];
  }>(
    `
    SELECT
      f.following_address,
      f.tags
    FROM efp_following f
    LEFT JOIN efp_user_stats us ON us.address = f.following_address
    WHERE f.address = $1
      AND f.is_blocked = FALSE
      AND f.is_muted = FALSE
      ${tagFilter}
    ${sortClause}
    LIMIT $2 OFFSET $3
  `,
    params
  );

  const following: FollowingEntry[] = result.rows.map((row) => ({
    version: 1,
    record_type: 'address',
    data: row.following_address.toLowerCase() as Address,
    address: row.following_address.toLowerCase() as Address,
    tags: row.tags || [],
  }));

  // Add ENS data if requested
  if (includeENS && following.length > 0) {
    const addresses = following.map((f) => f.address);
    const ensProfiles = await getENSProfiles(addresses);

    for (const entry of following) {
      const profile = ensProfiles.get(entry.address);
      if (profile) {
        entry.ens = profile;
      }
    }
  }

  return following;
}

// Get all following (no pagination)
export async function getAllFollowing(
  address: Address,
  options: AllFollowersOptions
): Promise<FollowingEntry[]> {
  return getFollowing(address, {
    ...options,
    limit: 10000,
    offset: 0,
  });
}

// Check if user A follows user B
export async function isFollowing(
  followerAddress: Address,
  targetAddress: Address
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1 FROM efp_following
      WHERE address = $1 AND following_address = $2
        AND is_blocked = FALSE AND is_muted = FALSE
    ) as exists
  `,
    [followerAddress, targetAddress]
  );

  return result.rows[0]?.exists ?? false;
}

// Check if users are mutuals
export async function areMutuals(
  addressA: Address,
  addressB: Address
): Promise<boolean> {
  const [a, b] = [addressA, addressB].sort();

  const result = await query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1 FROM efp_mutuals
      WHERE address_a = $1 AND address_b = $2
    ) as exists
  `,
    [a, b]
  );

  return result.rows[0]?.exists ?? false;
}
