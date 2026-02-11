import { normalize } from 'viem/ens';
import { query, type Address, type ENSProfile, createLogger } from '@efp/shared';

const logger = createLogger('ens-service');

// Get ENS profile from database cache
export async function getENSProfile(address: Address): Promise<ENSProfile | undefined> {
  const result = await query<{
    name: string | null;
    avatar: string | null;
    header: string | null;
    records: Record<string, string> | null;
    updated_at: Date | null;
  }>(
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

  // Defense in depth: validate stored name is normalized
  // This catches any invalid names stored before the sync-ens-metadata fix
  try {
    if (row.name !== normalize(row.name)) {
      return undefined;
    }
  } catch {
    // Normalization failed, invalid name
    return undefined;
  }

  // Build records object with all available text records
  const records: Record<string, string> = {};

  // Add stored records
  if (row.records) {
    Object.assign(records, row.records);
  }

  // Add avatar to records if present
  if (row.avatar) {
    records.avatar = row.avatar;
  }

  // Add header to records if present
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

// Batch get ENS profiles for multiple addresses
export async function getENSProfiles(
  addresses: Address[]
): Promise<Map<Address, ENSProfile | undefined>> {
  if (addresses.length === 0) {
    return new Map();
  }

  const result = await query<{
    address: string;
    name: string | null;
    avatar: string | null;
    header: string | null;
    records: Record<string, string> | null;
    updated_at: Date | null;
  }>(
    `
    SELECT address, name, avatar, header, records, updated_at
    FROM ens_metadata
    WHERE address = ANY($1)
  `,
    [addresses]
  );

  const profiles = new Map<Address, ENSProfile | undefined>();

  for (const row of result.rows) {
    const addr = row.address.toLowerCase() as Address;

    if (!row.name) {
      profiles.set(addr, undefined);
      continue;
    }

    // Defense in depth: validate stored name is normalized
    let isValidName = true;
    try {
      if (row.name !== normalize(row.name)) {
        isValidName = false;
      }
    } catch {
      isValidName = false;
    }

    if (!isValidName) {
      profiles.set(addr, undefined);
      continue;
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

    profiles.set(addr, {
      name: row.name,
      avatar: row.avatar,
      records: Object.keys(records).length > 0 ? records : undefined,
      updated_at: row.updated_at?.toISOString(),
    });
  }

  // Fill in missing addresses with undefined
  for (const addr of addresses) {
    if (!profiles.has(addr)) {
      profiles.set(addr, undefined);
    }
  }

  return profiles;
}
