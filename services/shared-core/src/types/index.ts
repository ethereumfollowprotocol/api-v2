import { z } from 'zod';

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((val) => val.toLowerCase() as `0x${string}`);

export type Address = `0x${string}`;

export const ensProfileSchema = z.object({
  name: z.string().nullable(),
  avatar: z.string().nullable(),
  records: z.record(z.string()).optional(),
  updated_at: z.string().optional(),
});

export type ENSProfile = z.infer<typeof ensProfileSchema>;

export interface UserStats {
  followers_count: number;
  following_count: number;
}

export interface UserRanks {
  mutuals_rank: string | null;
  followers_rank: string | null;
  following_rank: string | null;
  top8_rank: string | null;
  blocks_rank: string | number | null;
}

export interface AccountResponse {
  address: Address;
  ens?: ENSProfile;
}

export interface DetailsResponse {
  address: Address;
  ens?: ENSProfile;
  followers_count: number;
  following_count: number;
  ranks: UserRanks;
  primary_list: string | null;
}

export interface StatsResponse {
  followers_count: number;
  following_count: number;
}

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

export interface FollowingEntry {
  version: number;
  record_type: string;
  data: Address;
  address: Address;
  tags: string[];
  ens?: ENSProfile;
}

export interface FollowersResponse {
  followers: FollowerEntry[];
}

export interface FollowingResponse {
  following: FollowingEntry[];
}

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

export interface LeaderboardResponse {
  last_updated: string;
  results: LeaderboardEntry[];
}

export interface ErrorResponse {
  response?: string;
  error?: string;
  message?: string;
}

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

export function convertHexToBigInt(hex: string): bigint {
  if (!hex || hex === '0x') return 0n;
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return BigInt('0x' + cleanHex);
}

export function toStringOrNull(value: bigint | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}
