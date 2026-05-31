import type { Client } from 'pg';
import {
  convertHexToBigInt,
  toStringOrNull,
  type Address,
  type AccountResponse,
  type DetailsResponse,
  type StatsResponse,
  type UserRanks,
} from '@efp/shared-core';
import { query } from '../db/query.js';
import { getENSProfile } from './ens.js';

export async function getUserAccount(client: Client, address: Address): Promise<AccountResponse> {
  const ens = await getENSProfile(client, address);
  return { address, ens };
}

export async function getUserDetails(client: Client, address: Address): Promise<DetailsResponse> {
  const [primaryListResult, ranksResult, statsResult, ens] = await Promise.all([
    query<{ value: string }>(
      client,
      `SELECT value FROM efp_account_metadata WHERE address = $1 AND key = 'primary-list'`,
      [address]
    ),
    query<{
      followers_rank: number | null;
      following_rank: number | null;
      mutuals_rank: number | null;
      blocks_rank: number | null;
      top8_rank: number | null;
    }>(
      client,
      `SELECT followers_rank, following_rank, mutuals_rank, blocks_rank, top8_rank
       FROM efp_leaderboard WHERE address = $1`,
      [address]
    ),
    query<{ followers_count: number; following_count: number }>(
      client,
      `SELECT followers_count, following_count FROM efp_user_stats WHERE address = $1`,
      [address]
    ),
    getENSProfile(client, address),
  ]);

  let primaryList: string | null = null;
  if (primaryListResult.rows[0]?.value) {
    primaryList = convertHexToBigInt(primaryListResult.rows[0].value).toString();
  }

  const ranks: UserRanks = {
    mutuals_rank: toStringOrNull(ranksResult.rows[0]?.mutuals_rank),
    followers_rank: toStringOrNull(ranksResult.rows[0]?.followers_rank),
    following_rank: toStringOrNull(ranksResult.rows[0]?.following_rank),
    top8_rank: toStringOrNull(ranksResult.rows[0]?.top8_rank),
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

export async function getUserStats(client: Client, address: Address): Promise<StatsResponse> {
  const result = await query<{ followers_count: number; following_count: number }>(
    client,
    `SELECT followers_count, following_count FROM efp_user_stats WHERE address = $1`,
    [address]
  );

  const row = result.rows[0];
  return {
    followers_count: row?.followers_count ?? 0,
    following_count: row?.following_count ?? 0,
  };
}
