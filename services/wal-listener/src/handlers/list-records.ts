import {
  query,
  convertHexToBigInt,
  createLogger,
  type Address,
} from '@efp/shared';
import { publishUserStatsJob, publishMutualsJob } from './jobs.js';

const logger = createLogger('list-records-handler');

interface ListRecordData {
  chain_id: number;
  contract_address: string;
  slot: Buffer | string;
  record: Buffer | string;
  record_type: number;
  record_data: Buffer | string;
}

/**
 * Convert PostgreSQL BYTEA (which comes as '\x...' hex string in JSON) to Buffer.
 * PostgreSQL's row_to_json() encodes BYTEA as hex with '\x' prefix.
 */
function pgByteaToBuffer(value: Buffer | string): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  // PostgreSQL hex format: \x followed by hex chars
  const hexStr = typeof value === 'string' && value.startsWith('\\x')
    ? value.slice(2)
    : String(value);
  return Buffer.from(hexStr, 'hex');
}

export async function handleListRecordsChange(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const record = data as unknown as ListRecordData;

  // Only handle address records (type 1)
  if (record.record_type !== 1) return;

  // Convert PostgreSQL BYTEA fields to Buffer (handles \x prefix from row_to_json)
  const recordDataBuffer = pgByteaToBuffer(record.record_data);
  const slotBuffer = pgByteaToBuffer(record.slot);
  const recordBuffer = pgByteaToBuffer(record.record);

  // record_data stores addresses as UTF-8 text (e.g., "0x1234..."), not raw binary
  const followedAddress = recordDataBuffer.toString('utf8').toLowerCase() as Address;

  // Validate address length (must be exactly 42 chars: 0x + 40 hex)
  if (followedAddress.length !== 42) {
    logger.debug({ address: followedAddress, length: followedAddress.length }, 'Skipping invalid address length');
    return;
  }

  // Find the list this record belongs to
  const listResult = await query<{
    token_id: string;
    user: string;
    primary_list_value: string | null;
  }>(
    `
    SELECT l.token_id::TEXT, l."user", am.value as primary_list_value
    FROM efp_lists l
    LEFT JOIN efp_account_metadata am ON
      am.address = l."user"
      AND am."key" = 'primary-list'
    WHERE l.list_storage_location_chain_id = $1
      AND l.list_storage_location_contract_address = $2
      AND l.list_storage_location_slot = $3
  `,
    [record.chain_id, record.contract_address, slotBuffer]
  );

  if (listResult.rows.length === 0) {
    logger.warn(
      { chain_id: record.chain_id, contract_address: record.contract_address },
      'No list found for record, skipping'
    );
    return;
  }

  const list = listResult.rows[0];
  const followerAddress = list.user?.toLowerCase() as Address;

  if (!followerAddress) {
    logger.warn(
      { token_id: list.token_id, chain_id: record.chain_id, contract_address: record.contract_address },
      'List has no user, skipping'
    );
    return;
  }

  // Check if this is the user's primary list
  const primaryListId = list.primary_list_value
    ? convertHexToBigInt(list.primary_list_value)
    : null;
  const isPrimaryList = primaryListId !== null && primaryListId.toString() === list.token_id;

  if (!isPrimaryList) {
    logger.debug({ tokenId: list.token_id }, 'Skipping non-primary list record');
    return;
  }

  // Get tags for this record
  const tagsResult = await query<{ tags: string[] }>(
    `
    SELECT array_agg(tag ORDER BY tag) as tags
    FROM efp_list_record_tags
    WHERE chain_id = $1
      AND contract_address = $2
      AND slot = $3
      AND record = $4
  `,
    [record.chain_id, record.contract_address, slotBuffer, recordBuffer]
  );

  const tags = tagsResult.rows[0]?.tags || [];
  const isBlocked = tags.includes('block');
  const isMuted = tags.includes('mute');

  if (operation === 'INSERT') {
    // Add to efp_followers
    await query(
      `
      INSERT INTO efp_followers (address, follower_address, follower_list_id, is_blocked, is_muted, tags)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (address, follower_address) DO UPDATE SET
        follower_list_id = EXCLUDED.follower_list_id,
        is_blocked = EXCLUDED.is_blocked,
        is_muted = EXCLUDED.is_muted,
        tags = EXCLUDED.tags,
        updated_at = NOW()
    `,
      [followedAddress, followerAddress, list.token_id, isBlocked, isMuted, tags]
    );

    // Add to efp_following
    await query(
      `
      INSERT INTO efp_following (address, list_id, following_address, is_blocked, is_muted, tags)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (address, following_address) DO UPDATE SET
        list_id = EXCLUDED.list_id,
        is_blocked = EXCLUDED.is_blocked,
        is_muted = EXCLUDED.is_muted,
        tags = EXCLUDED.tags,
        updated_at = NOW()
    `,
      [followerAddress, list.token_id, followedAddress, isBlocked, isMuted, tags]
    );
  } else if (operation === 'DELETE') {
    // Remove from derived tables
    await query(
      `DELETE FROM efp_followers WHERE address = $1 AND follower_address = $2`,
      [followedAddress, followerAddress]
    );

    await query(
      `DELETE FROM efp_following WHERE address = $1 AND following_address = $2`,
      [followerAddress, followedAddress]
    );
  }

  // Queue stats update jobs
  await publishUserStatsJob(followedAddress);
  await publishUserStatsJob(followerAddress);

  // Queue mutuals recalculation
  await publishMutualsJob(followerAddress, followedAddress);

  logger.info(
    { operation, follower: followerAddress, followed: followedAddress },
    'Processed list record change'
  );
}
