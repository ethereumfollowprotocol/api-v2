import { normalize } from 'viem/ens';
import {
  query,
  setCacheNX,
  type Address,
  type ENSProfile,
  createLogger,
  fetchENSProfileByAddress,
  toENSMetadataRow,
  upsertENSMetadata,
} from '@efp/shared';

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

// On-demand ENS refresh via the ENS worker: resolve, upsert into DB, return fresh profile.
// `fresh` bypasses the worker's own cache (use for explicit ?cache=fresh requests).
export async function refreshENSProfile(
  address: Address,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<ENSProfile | undefined> {
  logger.info({ address, fresh }, 'Refreshing ENS profile on-demand');

  try {
    const profile = await fetchENSProfileByAddress(address, fresh);
    const row = profile ? toENSMetadataRow(profile) : null;
    await upsertENSMetadata(address, row);
    if (!row) return undefined;

    logger.info({ address, name: row.name, hasAvatar: !!row.avatar }, 'Refreshed ENS profile');

    return {
      name: row.name,
      avatar: row.avatar,
      records: row.records ?? undefined,
      updated_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err, address }, 'Failed to refresh ENS profile on-demand');
    // Fall back to cached data
    return getENSProfile(address);
  }
}

// How often we'll attempt a live resolution for an address that is missing/unresolved in the DB.
// Bounds worker load: each address is resolved on-demand at most once per this window.
const ENS_ONDEMAND_TTL = 600; // 10 minutes

// Read ENS from the DB cache, falling back to a single guarded on-demand live
// resolution when the address has no row (or a NULL-name row). This lets addresses
// with a valid on-chain name resolve on the normal request path even if they were
// never seeded into ens_metadata (e.g. addresses with no EFP social-graph presence).
export async function getENSProfileOrResolve(address: Address): Promise<ENSProfile | undefined> {
  const profile = await getENSProfile(address);
  if (profile) return profile; // row exists with a valid, normalized name → done, no lookup

  // No row, or a NULL-name row. Attempt a live resolution at most once per TTL window.
  // The Redis key doubles as a dedup lock (NX) and a short negative cache: concurrent
  // and repeat requests within the window serve the current (empty) value without a lookup.
  const won = await setCacheNX(`ens:attempt:${address}`, ENS_ONDEMAND_TTL);
  if (!won) return profile;

  // refreshENSProfile resolves via the ENS worker, upserts ens_metadata, and handles its own
  // errors (returning cached data on failure), so subsequent reads hit the DB.
  return (await refreshENSProfile(address)) ?? profile;
}
