import type { Client } from 'pg';
import type { Address, StatsResponse } from '@efp/shared-core';
import { query } from '../../db/query.js';

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
