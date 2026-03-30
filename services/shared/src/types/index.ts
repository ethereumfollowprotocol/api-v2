import { z } from 'zod';

// Address type - always lowercase with 0x prefix
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((val) => val.toLowerCase() as `0x${string}`);

export type Address = `0x${string}`;

// ENS Profile
export const ensProfileSchema = z.object({
  name: z.string().nullable(),
  avatar: z.string().nullable(),
  records: z.record(z.string()).optional(),
  updated_at: z.string().optional(),
});

export type ENSProfile = z.infer<typeof ensProfileSchema>;

// User stats
export interface UserStats {
  followers_count: number;
  following_count: number;
}

// User ranks
export interface UserRanks {
  mutuals_rank: string | null;
  followers_rank: string | null;
  following_rank: string | null;
  top8_rank: string | null;
  blocks_rank: string | number | null;
}

// Account response
export interface AccountResponse {
  address: Address;
  ens?: ENSProfile;
}

// Details response
export interface DetailsResponse {
  address: Address;
  ens?: ENSProfile;
  followers_count: number;
  following_count: number;
  ranks: UserRanks;
  primary_list: string | null;
}

// Stats response
export interface StatsResponse {
  followers_count: number;
  following_count: number;
}

// Follower entry
export interface FollowerEntry {
  efp_list_nft_token_id: string;
  address: Address;
  tags: string[];
  is_following: boolean;
  is_blocked: boolean;
  is_muted: boolean;
  updated_at: string;
  ens?: ENSProfile;
}

// Following entry
export interface FollowingEntry {
  version: number;
  record_type: string;
  data: Address;
  address: Address;
  tags: string[];
  ens?: ENSProfile;
}

// Followers response
export interface FollowersResponse {
  followers: FollowerEntry[];
}

// Following response
export interface FollowingResponse {
  following: FollowingEntry[];
}

// Leaderboard entry
export interface LeaderboardEntry {
  address: Address;
  name: string | undefined;
  avatar: string | undefined;
  header: string | undefined;
  mutuals_rank: string | null;
  followers_rank: string | null;
  following_rank: string | null;
  blocks_rank: string | null;
  top8_rank: string | null;
  mutuals: string;
  following: string;
  followers: string;
  blocks: string;
  top8: string;
  updated_at: string;
}

// Leaderboard response
export interface LeaderboardResponse {
  last_updated: string;
  results: LeaderboardEntry[];
}

// Error response
export interface ErrorResponse {
  response?: string;
  error?: string;
  message?: string;
}

// Query params
export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface FollowersQueryParams extends PaginationParams {
  sort: 'latest' | 'followers' | 'earliest';
  tags?: string;
  include?: string;
}

export interface LeaderboardQueryParams extends PaginationParams {
  sort: 'mutuals' | 'followers' | 'following' | 'blocks' | 'top8';
  direction: 'DESC' | 'ASC';
}

// Utility for converting hex to bigint (matching production function)
export function convertHexToBigInt(hex: string): bigint {
  if (!hex || hex === '0x') return 0n;
  // Remove 0x prefix if present
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return BigInt('0x' + cleanHex);
}

// Convert bigint/number to string for API response
export function toStringOrNull(value: bigint | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}
