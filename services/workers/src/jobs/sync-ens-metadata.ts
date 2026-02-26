import type PgBoss from 'pg-boss';
import { createPublicClient, http, namehash } from 'viem';
import { normalize } from 'viem/ens';
import { mainnet } from 'viem/chains';
import { query, env, createLogger, decodeContentHash, contenthashAbi } from '@efp/shared';

const logger = createLogger('sync-ens-metadata');

interface SyncENSMetadataJob {
  address: string;
  force?: boolean;
}

// Viem client for ENS resolution
const client = createPublicClient({
  chain: mainnet,
  transport: http(env.PRIMARY_RPC_ETH),
});

export async function handleSyncENSMetadata(
  job: PgBoss.Job<SyncENSMetadataJob>
): Promise<void> {
  const { address, force } = job.data;

  // Check if we have recent data (skip if fresh with actual name and not forced)
  if (!force) {
    const existing = await query<{ updated_at: Date }>(
      `
      SELECT updated_at FROM ens_metadata
      WHERE address = $1
        AND updated_at > NOW() - INTERVAL '4 hours'
        AND name IS NOT NULL AND name != ''
    `,
      [address]
    );

    if (existing.rows.length > 0) {
      logger.debug({ address }, 'ENS metadata is fresh, skipping');
      return;
    }
  }

  logger.debug({ address }, 'Fetching ENS metadata');

  try {
    // Reverse resolve address to ENS name
    const name = await client.getEnsName({ address: address as `0x${string}` });

    if (!name) {
      // No ENS name, store empty record
      await query(
        `
        INSERT INTO ens_metadata (address, name, resolved_at, updated_at)
        VALUES ($1, NULL, NOW(), NOW())
        ON CONFLICT (address) DO UPDATE SET
          name = NULL,
          resolved_at = NOW(),
          updated_at = NOW()
      `,
        [address]
      );
      return;
    }

    // Validate that the name is properly normalized (e.g., reject "MetaMask.eth")
    let normalizedName: string;
    try {
      normalizedName = normalize(name);
    } catch {
      // Normalization failed, treat as no ENS name
      logger.warn({ address, name }, 'ENS name failed normalization, treating as no name');
      await query(
        `
        INSERT INTO ens_metadata (address, name, resolved_at, updated_at)
        VALUES ($1, NULL, NOW(), NOW())
        ON CONFLICT (address) DO UPDATE SET
          name = NULL,
          resolved_at = NOW(),
          updated_at = NOW()
      `,
        [address]
      );
      return;
    }

    if (name !== normalizedName) {
      logger.warn({ address, name, normalizedName }, 'Invalid unnormalized ENS name detected, treating as no name');
      await query(
        `
        INSERT INTO ens_metadata (address, name, resolved_at, updated_at)
        VALUES ($1, NULL, NOW(), NOW())
        ON CONFLICT (address) DO UPDATE SET
          name = NULL,
          resolved_at = NOW(),
          updated_at = NOW()
      `,
        [address]
      );
      return;
    }

    // All ENS text record keys to fetch
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

    // Fetch avatar, contenthash, and all text records in parallel (normalizedName already validated above)
    const [avatar, rawContenthash, ...textRecordValues] = await Promise.all([
      client.getEnsAvatar({ name: normalizedName }).catch(() => null),
      client
        .getEnsResolver({ name: normalizedName })
        .then((resolver) =>
          resolver
            ? client.readContract({
                address: resolver,
                abi: contenthashAbi,
                functionName: 'contenthash',
                args: [namehash(normalizedName)],
              })
            : null
        )
        .catch(() => null),
      ...textRecordKeys.map((key) =>
        client.getEnsText({ name: normalizedName, key }).catch(() => null)
      ),
    ]);

    // Build records object
    const records: Record<string, string> = {};
    if (avatar) records.avatar = avatar;
    const contenthash = decodeContentHash(rawContenthash as string | null);
    if (contenthash) records.contenthash = contenthash;

    // Add all text records that have values
    textRecordKeys.forEach((key, index) => {
      const value = textRecordValues[index];
      if (value) records[key] = value;
    });

    // Extract header from records for the dedicated column
    const header = records.header || null;

    // Store in database
    await query(
      `
      INSERT INTO ens_metadata (address, name, avatar, header, records, resolved_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (address) DO UPDATE SET
        name = EXCLUDED.name,
        avatar = EXCLUDED.avatar,
        header = EXCLUDED.header,
        records = EXCLUDED.records,
        resolved_at = NOW(),
        updated_at = NOW()
    `,
      [address, name, avatar, header, Object.keys(records).length > 0 ? JSON.stringify(records) : null]
    );

    logger.info({ address, name, hasAvatar: !!avatar }, 'Updated ENS metadata');
  } catch (err) {
    logger.error({ err, address }, 'Failed to fetch ENS metadata');
    throw err; // Will trigger retry
  }
}
