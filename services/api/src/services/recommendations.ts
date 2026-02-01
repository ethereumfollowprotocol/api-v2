import { query, type Address, createLogger } from '@efp/shared';
import { getENSProfiles } from './ens.js';

const logger = createLogger('recommendations-service');

interface RecommendedUser {
  name: string | null;
  address: string;
  avatar: string | null;
  header: string | null;
  class: string;
  created_at: string;
}

interface RecommendedUserDetails {
  address: string;
  ens: {
    name: string | null;
    avatar: string | null;
    records: Record<string, string>;
  };
  stats: {
    followers_count: string;
    following_count: string;
  };
  ranks: {
    mutuals_rank: string | null;
    followers_rank: string | null;
    following_rank: string | null;
    top8_rank: string | null;
    blocks_rank: string | null;
  };
}

// Get recommended users to follow (2nd degree connections)
export async function getRecommendations(
  address: Address,
  options: { limit: number; offset: number; seed?: number }
): Promise<RecommendedUser[]> {
  const { limit, offset, seed } = options;

  // Find users followed by people you follow, that you don't follow
  // Rank by number of mutual connections (score)
  const result = await query<{
    address: string;
    score: string;
    name: string | null;
    avatar: string | null;
    header: string | null;
  }>(
    `
    WITH my_following AS (
      SELECT following_address FROM efp_following
      WHERE address = $1 AND is_blocked = FALSE AND is_muted = FALSE
    ),
    second_degree AS (
      SELECT f2.following_address as address, COUNT(*)::INTEGER as score
      FROM my_following mf
      JOIN efp_following f2 ON f2.address = mf.following_address
        AND f2.is_blocked = FALSE AND f2.is_muted = FALSE
      WHERE f2.following_address != $1
        AND f2.following_address NOT IN (SELECT following_address FROM my_following)
      GROUP BY f2.following_address
    )
    SELECT sd.address, sd.score::TEXT,
           em.name, em.avatar, em.header
    FROM second_degree sd
    LEFT JOIN ens_metadata em ON em.address = sd.address
    ORDER BY sd.score DESC, sd.address
    LIMIT $2 OFFSET $3
    `,
    [address, limit, offset]
  );

  const now = new Date().toISOString();

  return result.rows.map((row) => ({
    name: row.name,
    address: row.address.toLowerCase(),
    avatar: row.avatar,
    header: row.header,
    class: 'A', // Default class
    created_at: now,
  }));
}

// Get recommended users with full details (stats and ranks)
export async function getRecommendationsWithDetails(
  address: Address,
  options: { limit: number; offset: number }
): Promise<RecommendedUserDetails[]> {
  const { limit, offset } = options;

  // Same 2nd degree query but join with stats and ranks
  const result = await query<{
    address: string;
    score: string;
    name: string | null;
    avatar: string | null;
    records: Record<string, string> | null;
    followers_count: number;
    following_count: number;
    mutuals_rank: number | null;
    followers_rank: number | null;
    following_rank: number | null;
    top8_rank: number | null;
    blocks_rank: number | null;
  }>(
    `
    WITH my_following AS (
      SELECT following_address FROM efp_following
      WHERE address = $1 AND is_blocked = FALSE AND is_muted = FALSE
    ),
    second_degree AS (
      SELECT f2.following_address as address, COUNT(*)::INTEGER as score
      FROM my_following mf
      JOIN efp_following f2 ON f2.address = mf.following_address
        AND f2.is_blocked = FALSE AND f2.is_muted = FALSE
      WHERE f2.following_address != $1
        AND f2.following_address NOT IN (SELECT following_address FROM my_following)
      GROUP BY f2.following_address
    )
    SELECT sd.address, sd.score::TEXT,
           em.name, em.avatar, em.records,
           COALESCE(us.followers_count, 0) as followers_count,
           COALESCE(us.following_count, 0) as following_count,
           lb.mutuals_rank, lb.followers_rank, lb.following_rank,
           lb.top8_rank, lb.blocks_rank
    FROM second_degree sd
    LEFT JOIN ens_metadata em ON em.address = sd.address
    LEFT JOIN efp_user_stats us ON us.address = sd.address
    LEFT JOIN efp_leaderboard lb ON lb.address = sd.address
    ORDER BY sd.score DESC, sd.address
    LIMIT $2 OFFSET $3
    `,
    [address, limit, offset]
  );

  return result.rows.map((row) => ({
    address: row.address.toLowerCase(),
    ens: {
      name: row.name,
      avatar: row.avatar,
      records: row.records || {},
    },
    stats: {
      followers_count: String(row.followers_count),
      following_count: String(row.following_count),
    },
    ranks: {
      mutuals_rank: row.mutuals_rank ? String(row.mutuals_rank) : null,
      followers_rank: row.followers_rank ? String(row.followers_rank) : null,
      following_rank: row.following_rank ? String(row.following_rank) : null,
      top8_rank: row.top8_rank ? String(row.top8_rank) : null,
      blocks_rank: row.blocks_rank ? String(row.blocks_rank) : null,
    },
  }));
}
