import {
  query,
  convertHexToBigInt,
  toStringOrNull,
  type Address,
  type AccountResponse,
  type DetailsResponse,
  type StatsResponse,
  type UserRanks,
  createLogger,
} from '@efp/shared';
import { getENSProfileOrResolve } from './ens.js';

const logger = createLogger('users-service');

// Get user account (P0 endpoint)
export async function getUserAccount(address: Address): Promise<AccountResponse> {
  const ens = await getENSProfileOrResolve(address);

  return {
    address,
    ens,
  };
}

// Get user details (P0 endpoint)
export async function getUserDetails(address: Address): Promise<DetailsResponse> {
  // Get primary list, ranks, stats, and ENS in parallel
  const [primaryListResult, ranksResult, statsResult, ens] = await Promise.all([
    query<{ value: string }>(
      `
      SELECT value FROM efp_account_metadata
      WHERE address = $1 AND key = 'primary-list'
    `,
      [address]
    ),
    query<{
      followers_rank: number | null;
      following_rank: number | null;
      mutuals_rank: number | null;
      blocks_rank: number | null;
      top8_rank: number | null;
    }>(
      `
      SELECT followers_rank, following_rank, mutuals_rank, blocks_rank, top8_rank
      FROM efp_leaderboard
      WHERE address = $1
    `,
      [address]
    ),
    query<{ followers_count: number; following_count: number }>(
      `
      SELECT followers_count, following_count
      FROM efp_user_stats
      WHERE address = $1
    `,
      [address]
    ),
    getENSProfileOrResolve(address),
  ]);

  // Get primary list ID
  let primaryList: string | null = null;
  if (primaryListResult.rows[0]?.value) {
    const bigintValue = convertHexToBigInt(primaryListResult.rows[0].value);
    primaryList = bigintValue.toString();
  }

  // Get ranks (convert to strings to match production)
  const ranks: UserRanks = {
    mutuals_rank: toStringOrNull(ranksResult.rows[0]?.mutuals_rank),
    followers_rank: toStringOrNull(ranksResult.rows[0]?.followers_rank),
    following_rank: toStringOrNull(ranksResult.rows[0]?.following_rank),
    top8_rank: toStringOrNull(ranksResult.rows[0]?.top8_rank),
    // blocks_rank can be 0 (number) when others are strings - matching production
    blocks_rank: ranksResult.rows[0]?.blocks_rank ?? 0,
  };

  return {
    address,
    ens,
    followers_count: statsResult.rows[0]?.followers_count ?? 0,
    following_count: statsResult.rows[0]?.following_count ?? 0,
    ranks,
    primary_list: primaryList,
  };
}

// Get user stats (P0 endpoint)
export async function getUserStats(address: Address): Promise<StatsResponse> {
  const result = await query<{
    followers_count: number;
    following_count: number;
  }>(
    `
    SELECT followers_count, following_count
    FROM efp_user_stats
    WHERE address = $1
  `,
    [address]
  );

  const row = result.rows[0];

  return {
    followers_count: row?.followers_count ?? 0,
    following_count: row?.following_count ?? 0,
  };
}

// Check if user exists (has any EFP activity)
export async function userExists(address: Address): Promise<boolean> {
  // Check if they have a list or are followed by someone
  const result = await query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1 FROM efp_lists WHERE "user" = $1 OR owner = $1
      UNION ALL
      SELECT 1 FROM efp_followers WHERE address = $1 OR follower_address = $1
      UNION ALL
      SELECT 1 FROM efp_user_stats WHERE address = $1
    ) as exists
  `,
    [address]
  );

  return result.rows[0]?.exists ?? false;
}

// Get user's primary list ID
export async function getPrimaryListId(address: Address): Promise<bigint | null> {
  const result = await query<{ value: string }>(
    `
    SELECT value FROM efp_account_metadata
    WHERE address = $1 AND key = 'primary-list'
  `,
    [address]
  );

  if (!result.rows[0]?.value) {
    return null;
  }

  return convertHexToBigInt(result.rows[0].value);
}

// Get user's lists
export async function getUserLists(
  address: Address
): Promise<Array<{ token_id: string; is_primary: boolean }>> {
  const [listsResult, primaryListId] = await Promise.all([
    query<{ token_id: string }>(
      `
      SELECT token_id::TEXT FROM efp_lists
      WHERE "user" = $1 OR owner = $1
      ORDER BY token_id
    `,
      [address]
    ),
    getPrimaryListId(address),
  ]);

  return listsResult.rows.map((row) => ({
    token_id: row.token_id,
    is_primary: primaryListId !== null && row.token_id === primaryListId.toString(),
  }));
}
