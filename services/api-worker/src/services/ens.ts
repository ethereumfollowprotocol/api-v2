import type { Client } from 'pg';
import type { Address, ENSProfile } from '@efp/shared-core';
import { query } from '../db/query.js';

export async function getENSProfile(client: Client, address: Address): Promise<ENSProfile | undefined> {
  const result = await query<{
    name: string | null;
    avatar: string | null;
    header: string | null;
    records: Record<string, string> | null;
    updated_at: Date | null;
  }>(
    client,
    `
    SELECT name, avatar, header, records, updated_at
    FROM ens_metadata
    WHERE address = $1
  `,
    [address]
  );

  const row = result.rows[0];
  if (!row || !row.name) {
    return undefined;
  }

  const records: Record<string, string> = {};
  if (row.records) {
    Object.assign(records, row.records);
  }
  if (row.avatar) {
    records.avatar = row.avatar;
  }
  if (row.header) {
    records.header = row.header;
  }

  return {
    name: row.name,
    avatar: row.avatar,
    records: Object.keys(records).length > 0 ? records : undefined,
    updated_at: row.updated_at?.toISOString(),
  };
}
