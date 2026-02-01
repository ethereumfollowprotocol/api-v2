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

interface MutualEntry extends FollowerEntry {}

// Get paginated mutuals for a user
export async function getMutuals(
  address: Address,
  options: FollowersOptions
): Promise<MutualEntry[]> {
  const { limit, offset, sort, includeENS } = options;

  const sortClause = sort === 'earliest'
    ? 'ORDER BY m.created_at ASC'
    : 'ORDER BY m.created_at DESC';

  const result = await query<{
    mutual_address: string;
    mutual_list_id: string;
    tags: string[];
    is_blocked: boolean;
    is_muted: boolean;
    updated_at: Date;
  }>(
    `
    SELECT
      CASE WHEN m.address_a = $1 THEN m.address_b ELSE m.address_a END as mutual_address,
      CASE WHEN m.address_a = $1 THEN m.list_id_b ELSE m.list_id_a END as mutual_list_id,
      f.tags,
      f.is_blocked,
      f.is_muted,
      m.created_at as updated_at
    FROM efp_mutuals m
    LEFT JOIN efp_followers f ON
      f.address = $1 AND f.follower_address = CASE WHEN m.address_a = $1 THEN m.address_b ELSE m.address_a END
    WHERE m.address_a = $1 OR m.address_b = $1
    ${sortClause}
    LIMIT $2 OFFSET $3
    `,
    [address, limit, offset]
  );

  const mutuals: MutualEntry[] = result.rows.map((row) => ({
    efp_list_nft_token_id: row.mutual_list_id,
    address: row.mutual_address.toLowerCase() as Address,
    tags: row.tags || [],
    is_following: true, // mutuals are always following each other
    is_blocked: row.is_blocked || false,
    is_muted: row.is_muted || false,
    updated_at: row.updated_at.toISOString(),
  }));

  // Add ENS data if requested
  if (includeENS && mutuals.length > 0) {
    const addresses = mutuals.map((m) => m.address);
    const ensProfiles = await getENSProfiles(addresses);

    for (const mutual of mutuals) {
      const profile = ensProfiles.get(mutual.address);
      if (profile) {
        mutual.ens = profile;
      }
    }
  }

  return mutuals;
}

interface RelationshipState {
  is_following: boolean;
  is_followed_by: boolean;
  is_blocked: boolean;
  is_blocked_by: boolean;
  is_muted: boolean;
  is_muted_by: boolean;
}

// Get relationship between two users
export async function getRelationship(
  source: Address,
  target: Address
): Promise<RelationshipState> {
  const result = await query<{
    is_following: boolean;
    is_blocked: boolean;
    is_muted: boolean;
    is_followed_by: boolean;
    is_blocked_by: boolean;
    is_muted_by: boolean;
  }>(
    `
    SELECT
      EXISTS (
        SELECT 1 FROM efp_following
        WHERE address = $1 AND following_address = $2
          AND is_blocked = FALSE AND is_muted = FALSE
      ) as is_following,
      EXISTS (
        SELECT 1 FROM efp_following
        WHERE address = $1 AND following_address = $2
          AND is_blocked = TRUE
      ) as is_blocked,
      EXISTS (
        SELECT 1 FROM efp_following
        WHERE address = $1 AND following_address = $2
          AND is_muted = TRUE
      ) as is_muted,
      EXISTS (
        SELECT 1 FROM efp_following
        WHERE address = $2 AND following_address = $1
          AND is_blocked = FALSE AND is_muted = FALSE
      ) as is_followed_by,
      EXISTS (
        SELECT 1 FROM efp_following
        WHERE address = $2 AND following_address = $1
          AND is_blocked = TRUE
      ) as is_blocked_by,
      EXISTS (
        SELECT 1 FROM efp_following
        WHERE address = $2 AND following_address = $1
          AND is_muted = TRUE
      ) as is_muted_by
    `,
    [source, target]
  );

  const row = result.rows[0];
  return {
    is_following: row?.is_following ?? false,
    is_followed_by: row?.is_followed_by ?? false,
    is_blocked: row?.is_blocked ?? false,
    is_blocked_by: row?.is_blocked_by ?? false,
    is_muted: row?.is_muted ?? false,
    is_muted_by: row?.is_muted_by ?? false,
  };
}

// Get follower state for a specific address on a list
export async function getFollowerState(
  listTokenId: string,
  targetAddress: Address
): Promise<{ follow: boolean; block: boolean; mute: boolean }> {
  // Get list info first
  const listResult = await query<{
    list_storage_location_chain_id: number;
    list_storage_location_contract_address: string;
    list_storage_location_slot: string;
  }>(
    `
    SELECT list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot
    FROM efp_lists WHERE token_id = $1
    `,
    [listTokenId]
  );

  if (listResult.rows.length === 0) {
    return { follow: false, block: false, mute: false };
  }

  const { list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot } =
    listResult.rows[0];

  // Check if address is in list records
  const recordResult = await query<{
    record_data: string;
    tags: string[] | null;
  }>(
    `
    SELECT r.record_data,
           array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL) as tags
    FROM efp_list_records r
    LEFT JOIN efp_list_record_tags t ON
      t.chain_id = r.chain_id AND
      t.contract_address = r.contract_address AND
      t.slot = r.slot AND
      t.record = r.record
    WHERE r.chain_id = $1 AND r.contract_address = $2 AND r.slot = $3
      AND LOWER('0x' || encode(r.record_data, 'hex')) = LOWER($4)
    GROUP BY r.record_data
    `,
    [list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot, targetAddress]
  );

  if (recordResult.rows.length === 0) {
    return { follow: false, block: false, mute: false };
  }

  const tags = recordResult.rows[0].tags || [];
  const isBlocked = tags.includes('block');
  const isMuted = tags.includes('mute');

  return {
    follow: !isBlocked && !isMuted,
    block: isBlocked,
    mute: isMuted,
  };
}

// Search followers by address or ENS name
export async function searchFollowers(
  address: Address,
  term: string,
  options: { limit: number; offset: number; includeENS?: boolean }
): Promise<FollowerEntry[]> {
  const { limit, offset, includeENS } = options;
  const searchTerm = `%${term.toLowerCase()}%`;

  const result = await query<{
    follower_address: string;
    follower_list_id: string;
    tags: string[];
    is_blocked: boolean;
    is_muted: boolean;
    updated_at: Date;
    is_following: boolean;
    ens_name: string | null;
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
      ) as is_following,
      em.name as ens_name
    FROM efp_followers f
    LEFT JOIN ens_metadata em ON em.address = f.follower_address
    WHERE f.address = $1
      AND (
        LOWER(f.follower_address) LIKE $2
        OR LOWER(em.name) LIKE $2
      )
    ORDER BY f.updated_at DESC
    LIMIT $3 OFFSET $4
    `,
    [address, searchTerm, limit, offset]
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

// Search following by address or ENS name
export async function searchFollowing(
  address: Address,
  term: string,
  options: { limit: number; offset: number; includeENS?: boolean }
): Promise<FollowingEntry[]> {
  const { limit, offset, includeENS } = options;
  const searchTerm = `%${term.toLowerCase()}%`;

  const result = await query<{
    following_address: string;
    tags: string[];
    ens_name: string | null;
  }>(
    `
    SELECT
      f.following_address,
      f.tags,
      em.name as ens_name
    FROM efp_following f
    LEFT JOIN ens_metadata em ON em.address = f.following_address
    WHERE f.address = $1
      AND f.is_blocked = FALSE
      AND f.is_muted = FALSE
      AND (
        LOWER(f.following_address) LIKE $2
        OR LOWER(em.name) LIKE $2
      )
    ORDER BY f.created_at DESC
    LIMIT $3 OFFSET $4
    `,
    [address, searchTerm, limit, offset]
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
