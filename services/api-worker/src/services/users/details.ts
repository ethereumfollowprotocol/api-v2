import type { Client } from 'pg';
import {
  convertHexToBigInt,
  toStringOrNull,
  type Address,
  type DetailsResponse,
  type UserRanks,
} from '@efp/shared-core';
import { query } from '../../db/query.js';
import { getENSProfile } from '../ens.js';

export async function getUserDetails(client: Client, address: Address): Promise<DetailsResponse> {
  // pg.Client serializes queries on one connection; await sequentially.
  const primaryListResult = await query<{ value: string }>(
    client,
    `SELECT value FROM efp_account_metadata WHERE address = $1 AND key = 'primary-list'`,
    [address]
  );
  const ranksResult = await query<{
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
  );
  const statsResult = await query<{ followers_count: number; following_count: number }>(
    client,
    `SELECT followers_count, following_count FROM efp_user_stats WHERE address = $1`,
    [address]
  );
  const ens = await getENSProfile(client, address);

  let primaryList: string | null = null;
  if (primaryListResult.rows[0]?.value) {
    primaryList = convertHexToBigInt(primaryListResult.rows[0].value).toString();
  }

  const ranks: UserRanks = {
    mutuals_rank: toStringOrNull(ranksResult.rows[0]?.mutuals_rank),
    followers_rank: toStringOrNull(ranksResult.rows[0]?.followers_rank),
    following_rank: toStringOrNull(ranksResult.rows[0]?.following_rank),
    top8_rank: toStringOrNull(ranksResult.rows[0]?.top8_rank),
    blocks_rank: toStringOrNull(ranksResult.rows[0]?.blocks_rank),
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
