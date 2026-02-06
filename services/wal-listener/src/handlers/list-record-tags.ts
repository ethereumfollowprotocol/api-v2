import { query, convertHexToBigInt, createLogger, type Address } from '@efp/shared';
import { publishUserStatsJob, publishMutualsJob } from './jobs.js';

const logger = createLogger('list-record-tags-handler');

interface ListRecordTagData {
  chain_id: number;
  contract_address: string;
  slot: Buffer | string;
  record: Buffer | string;
  tag: string;
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

export async function handleListRecordTagsChange(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const tagData = data as unknown as ListRecordTagData;

  // Convert PostgreSQL BYTEA fields to Buffer (handles \x prefix from row_to_json)
  const slotBuffer = pgByteaToBuffer(tagData.slot);
  const recordBuffer = pgByteaToBuffer(tagData.record);

  // Get record details
  const recordResult = await query<{ record_data: Buffer; record_type: number }>(
    `
    SELECT record_data, record_type
    FROM efp_list_records
    WHERE chain_id = $1
      AND contract_address = $2
      AND slot = $3
      AND record = $4
  `,
    [tagData.chain_id, tagData.contract_address, slotBuffer, recordBuffer]
  );

  if (recordResult.rows.length === 0 || recordResult.rows[0].record_type !== 1) {
    return;
  }

  // record_data stores addresses as UTF-8 text (e.g., "0x1234..."), not raw binary
  const followedAddress = recordResult.rows[0].record_data.toString('utf8').toLowerCase() as Address;

  // Validate address length (must be exactly 42 chars: 0x + 40 hex)
  if (followedAddress.length !== 42) {
    logger.debug({ address: followedAddress, length: followedAddress.length }, 'Skipping invalid address length');
    return;
  }

  // Find the list and follower
  const listResult = await query<{ user: string }>(
    `
    SELECT l."user"
    FROM efp_lists l
    INNER JOIN efp_account_metadata am ON
      am.address = l."user"
      AND am."key" = 'primary-list'
      AND convert_hex_to_bigint(am.value::text) = l.token_id
    WHERE l.list_storage_location_chain_id = $1
      AND l.list_storage_location_contract_address = $2
      AND l.list_storage_location_slot = $3
  `,
    [tagData.chain_id, tagData.contract_address, slotBuffer]
  );

  if (listResult.rows.length === 0) return;

  const followerAddress = listResult.rows[0].user?.toLowerCase() as Address;

  // Get updated tags list
  const tagsResult = await query<{ tags: string[] }>(
    `
    SELECT array_agg(tag ORDER BY tag) as tags
    FROM efp_list_record_tags
    WHERE chain_id = $1
      AND contract_address = $2
      AND slot = $3
      AND record = $4
  `,
    [tagData.chain_id, tagData.contract_address, slotBuffer, recordBuffer]
  );

  const tags = tagsResult.rows[0]?.tags || [];
  const isBlocked = tags.includes('block');
  const isMuted = tags.includes('mute');

  // Update derived tables with new tag state
  await query(
    `
    UPDATE efp_followers
    SET is_blocked = $3, is_muted = $4, tags = $5, updated_at = NOW()
    WHERE address = $1 AND follower_address = $2
  `,
    [followedAddress, followerAddress, isBlocked, isMuted, tags]
  );

  await query(
    `
    UPDATE efp_following
    SET is_blocked = $3, is_muted = $4, tags = $5, updated_at = NOW()
    WHERE address = $1 AND following_address = $2
  `,
    [followerAddress, followedAddress, isBlocked, isMuted, tags]
  );

  // Queue stats update
  await publishUserStatsJob(followedAddress);
  await publishUserStatsJob(followerAddress);

  // Recalculate mutuals if block/mute changed
  if (tagData.tag === 'block' || tagData.tag === 'mute') {
    await publishMutualsJob(followerAddress, followedAddress);
  }

  logger.info(
    { operation, tag: tagData.tag, follower: followerAddress, followed: followedAddress },
    'Processed tag change'
  );
}
