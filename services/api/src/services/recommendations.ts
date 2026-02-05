import { query, type Address, createLogger } from '@efp/shared';
import { getENSProfiles } from './ens.js';

const logger = createLogger('recommendations-service');

interface RecommendedUser {
  address: string;
  name: string;
  avatar: string;
  header: string | undefined;
  class: string;
}

interface RecommendedUserDetails {
  address: string;
  ens: {
    name: string | null;
    avatar: string | null;
    records: string;  // JSON.stringify'd, NOT object
  };
  stats: {
    followers_count: number;  // NUMBER not string
    following_count: number;  // NUMBER not string
  };
  ranks: {
    mutuals_rank: number;     // NUMBER not string
    followers_rank: number;
    following_rank: number;
    top8_rank: number;
    blocks_rank: number;
  };
}

// Get recommended users from efp_recommended table (populated by services repo)
export async function getRecommendations(
  address: Address,
  options: { limit: number; offset: number; seed?: number }
): Promise<RecommendedUser[]> {
  const { limit, offset } = options;

  // Read from efp_recommended table - shuffled ENS profiles populated by services repo
  // Filter out accounts the user is already following
  const result = await query<{
    address: string;
    name: string | null;
    avatar: string | null;
    header: string | null;
    class: string | null;
  }>(
    `
    SELECT address, name, avatar, header, class
    FROM efp_recommended r
    WHERE NOT EXISTS (
      SELECT 1 FROM efp_following f
      WHERE f.address = $1
        AND f.following_address = r.address
    )
    ORDER BY r.index
    LIMIT $2 OFFSET $3
    `,
    [address, limit, offset]
  );

  return result.rows.map((row) => ({
    address: row.address.toLowerCase(),
    name: row.name || '',
    avatar: row.avatar || '',
    header: row.header || undefined,
    class: row.class || 'A',
  }));
}

// Get recommended users with full details (stats and ranks)
export async function getRecommendationsWithDetails(
  address: Address,
  options: { limit: number; offset: number }
): Promise<RecommendedUserDetails[]> {
  const { limit, offset } = options;

  // Read from efp_recommended and join with ENS, stats, and ranks
  // Filter out accounts the user is already following
  const result = await query<{
    address: string;
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
    SELECT r.address,
           em.name, em.avatar, em.records,
           COALESCE(us.followers_count, 0) as followers_count,
           COALESCE(us.following_count, 0) as following_count,
           lb.mutuals_rank, lb.followers_rank, lb.following_rank,
           lb.top8_rank, lb.blocks_rank
    FROM efp_recommended r
    LEFT JOIN ens_metadata em ON em.address = r.address
    LEFT JOIN efp_user_stats us ON us.address = r.address
    LEFT JOIN efp_leaderboard lb ON lb.address = r.address
    WHERE NOT EXISTS (
      SELECT 1 FROM efp_following f
      WHERE f.address = $1
        AND f.following_address = r.address
    )
    ORDER BY r.index
    LIMIT $2 OFFSET $3
    `,
    [address, limit, offset]
  );

  return result.rows.map((row) => ({
    address: row.address.toLowerCase(),
    ens: {
      name: row.name || null,
      avatar: row.avatar || null,
      records: JSON.stringify(row.records || {}),  // Must be stringified
    },
    stats: {
      followers_count: parseInt(String(row.followers_count), 10) || 0,
      following_count: parseInt(String(row.following_count), 10) || 0,
    },
    ranks: {
      mutuals_rank: parseInt(String(row.mutuals_rank), 10) || 0,
      followers_rank: parseInt(String(row.followers_rank), 10) || 0,
      following_rank: parseInt(String(row.following_rank), 10) || 0,
      top8_rank: parseInt(String(row.top8_rank), 10) || 0,
      blocks_rank: parseInt(String(row.blocks_rank), 10) || 0,
    },
  }));
}
