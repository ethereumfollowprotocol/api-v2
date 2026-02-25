import { createPublicClient, http } from 'viem';
import { normalize } from 'viem/ens';
import { mainnet } from 'viem/chains';
import { query, env, type Address, type ENSProfile, createLogger } from '@efp/shared';

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

// Viem client for on-demand ENS resolution (lazy-initialized)
let _client: ReturnType<typeof createPublicClient> | null = null;
function getClient() {
  if (!_client) {
    _client = createPublicClient({
      chain: mainnet,
      transport: http(env.PRIMARY_RPC_ETH),
    });
  }
  return _client;
}

// All ENS text record keys to fetch (same set as sync-ens-metadata worker)
const textRecordKeys = [
  'url',
  'name',
  'mail',
  'email',
  'header',
  'display',
  'location',
  'status',
  'timezone',
  'language',
  'com.github',
  'org.matrix',
  'io.keybase',
  'description',
  'com.twitter',
  'com.discord',
  'social.bsky',
  'org.telegram',
  'social.mastodon',
  'network.dm3.profile',
  'network.dm3.deliveryService',
];

// On-demand ENS refresh: resolve name, fetch all records, upsert into DB, return fresh profile
export async function refreshENSProfile(address: Address): Promise<ENSProfile | undefined> {
  const client = getClient();

  logger.info({ address }, 'Refreshing ENS profile on-demand');

  try {
    const name = await client.getEnsName({ address: address as `0x${string}` });

    if (!name) {
      await query(
        `INSERT INTO ens_metadata (address, name, resolved_at, updated_at)
         VALUES ($1, NULL, NOW(), NOW())
         ON CONFLICT (address) DO UPDATE SET
           name = NULL, resolved_at = NOW(), updated_at = NOW()`,
        [address]
      );
      return undefined;
    }

    // Validate normalization
    let normalizedName: string;
    try {
      normalizedName = normalize(name);
    } catch {
      await query(
        `INSERT INTO ens_metadata (address, name, resolved_at, updated_at)
         VALUES ($1, NULL, NOW(), NOW())
         ON CONFLICT (address) DO UPDATE SET
           name = NULL, resolved_at = NOW(), updated_at = NOW()`,
        [address]
      );
      return undefined;
    }

    if (name !== normalizedName) {
      await query(
        `INSERT INTO ens_metadata (address, name, resolved_at, updated_at)
         VALUES ($1, NULL, NOW(), NOW())
         ON CONFLICT (address) DO UPDATE SET
           name = NULL, resolved_at = NOW(), updated_at = NOW()`,
        [address]
      );
      return undefined;
    }

    // Fetch avatar and all text records in parallel
    const [avatar, ...textRecordValues] = await Promise.all([
      client.getEnsAvatar({ name: normalizedName }).catch(() => null),
      ...textRecordKeys.map((key) =>
        client.getEnsText({ name: normalizedName, key }).catch(() => null)
      ),
    ]);

    // Build records object
    const records: Record<string, string> = {};
    if (avatar) records.avatar = avatar;
    textRecordKeys.forEach((key, index) => {
      const value = textRecordValues[index];
      if (value) records[key] = value;
    });

    const header = records.header || null;

    // Upsert into database
    await query(
      `INSERT INTO ens_metadata (address, name, avatar, header, records, resolved_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (address) DO UPDATE SET
         name = EXCLUDED.name,
         avatar = EXCLUDED.avatar,
         header = EXCLUDED.header,
         records = EXCLUDED.records,
         resolved_at = NOW(),
         updated_at = NOW()`,
      [address, name, avatar, header, Object.keys(records).length > 0 ? JSON.stringify(records) : null]
    );

    logger.info({ address, name, hasAvatar: !!avatar }, 'Refreshed ENS profile');

    return {
      name,
      avatar: avatar ?? null,
      records: Object.keys(records).length > 0 ? records : undefined,
      updated_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err, address }, 'Failed to refresh ENS profile on-demand');
    // Fall back to cached data
    return getENSProfile(address);
  }
}
