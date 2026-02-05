import { query, type Address } from '@efp/shared';

export interface Notification {
  address: string;
  name: string | null;
  avatar: string | null;
  token_id: string;
  action: string;
  opcode: number;
  op: string;
  tag: string;
  updated_at: string;
}

export interface NotificationSummary {
  interval: string;
  opcode: string;
  total: number;
  total_follows: number;
  total_unfollows: number;
  total_tags: number;
  total_untags: number;
}

export interface NotificationsResult {
  summary: NotificationSummary;
  notifications: Notification[];
}

interface NotificationsOptions {
  limit: number;
  offset: number;
  opcode: number; // 0=all, 1=follow, 2=unfollow, 3=tag, 4=untag
  interval: string; // PostgreSQL interval e.g. '168 hours'
  tag: string; // 'p_tag_empty' for all, or specific tag
}

function opcodeToAction(opcode: number): string {
  switch (opcode) {
    case 1:
      return 'follow';
    case 2:
      return 'unfollow';
    case 3:
      return 'tag';
    case 4:
      return 'untag';
    default:
      return 'unknown';
  }
}

/**
 * Parse opcode from ListOp hex data
 * Format: 0x + version (2 hex) + opcode (2 hex) + data
 * Example: 0x0101... means version=1, opcode=1 (follow)
 */
function parseOpcodeFromOp(op: string): number {
  if (!op || op.length < 6) return 0;
  // Remove 0x, then chars 2-3 are the opcode (bytes[1])
  return parseInt(op.slice(4, 6), 16);
}

/**
 * Parse target address from ListOp data
 * For address records: 0x + version(2) + opcode(2) + recordVersion(2) + recordType(2) + address(40)
 */
function parseTargetAddressFromOp(op: string): string | null {
  if (!op || op.length < 50) return null;
  // Skip: 0x(2) + version(2) + opcode(2) + recordVersion(2) + recordType(2) = 10 chars
  // Then take 40 chars for address
  const addressHex = op.slice(10, 50);
  return '0x' + addressHex.toLowerCase();
}

/**
 * Parse tag from ListOp data (for tag/untag operations)
 * For tag ops: 0x + version(2) + opcode(2) + record(44) + tag(variable)
 */
function parseTagFromOp(op: string): string {
  if (!op || op.length <= 50) return '';
  // Skip: 0x(2) + version(2) + opcode(2) + record(44) = 50 chars
  const tagHex = op.slice(50);
  if (!tagHex) return '';
  try {
    return Buffer.from(tagHex, 'hex').toString('utf8').replace(/\0/g, '');
  } catch {
    return '';
  }
}

export async function getNotifications(
  targetAddress: Address,
  options: NotificationsOptions
): Promise<NotificationsResult> {
  const { limit, offset, opcode, interval, tag } = options;

  // Query events table for ListOp events where the target address matches
  // We need to:
  // 1. Parse the op hex to extract opcode and target address
  // 2. Join with efp_lists to find the list owner (the person who did the action)
  // 3. Join with ens_metadata for names/avatars
  // 4. Only include ops from users' primary lists

  const result = await query<{
    user_address: string;
    token_id: string;
    op: string;
    created_at: Date;
    name: string | null;
    avatar: string | null;
  }>(
    `
    WITH listop_events AS (
      SELECT
        e.event_args->>'slot' as slot,
        e.event_args->>'op' as op,
        e.chain_id,
        e.contract_address,
        e.created_at
      FROM events e
      WHERE e.event_name = 'ListOp'
        AND e.created_at >= NOW() - $3::interval
    )
    SELECT
      el."user" as user_address,
      el.token_id::text as token_id,
      le.op,
      le.created_at,
      em.name,
      em.avatar
    FROM listop_events le
    JOIN efp_lists el ON
      el.list_storage_location_chain_id = le.chain_id
      AND el.list_storage_location_contract_address = le.contract_address
      AND encode(el.list_storage_location_slot, 'hex') = substring(le.slot from 3)
    JOIN efp_account_metadata am ON
      am.address = el."user"
      AND am.key = 'primary-list'
      AND convert_hex_to_bigint(am.value) = el.token_id
    LEFT JOIN ens_metadata em ON em.address = el."user"
    WHERE el."user" IS NOT NULL
    ORDER BY le.created_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit * 10, 0, interval] // Fetch more rows since we filter in app
  );

  // Filter notifications where the target address matches
  const targetLower = targetAddress.toLowerCase();
  let notifications: Notification[] = [];

  for (const row of result.rows) {
    const op = row.op;
    const parsedOpcode = parseOpcodeFromOp(op);
    const parsedTarget = parseTargetAddressFromOp(op);
    const parsedTag = parseTagFromOp(op);

    // Skip if opcode filter doesn't match
    if (opcode !== 0 && parsedOpcode !== opcode) continue;

    // Skip if target address doesn't match
    if (!parsedTarget || parsedTarget.toLowerCase() !== targetLower) continue;

    // Skip if tag filter doesn't match (unless 'p_tag_empty' which means all)
    if (tag !== 'p_tag_empty' && parsedTag !== tag) continue;

    notifications.push({
      address: row.user_address.toLowerCase(),
      name: row.name,
      avatar: row.avatar,
      token_id: row.token_id,
      action: opcodeToAction(parsedOpcode),
      opcode: parsedOpcode,
      op: op,
      tag: parsedTag,
      updated_at: row.created_at.toISOString(),
    });

    // Stop if we have enough
    if (notifications.length >= limit + offset) break;
  }

  // Apply offset
  notifications = notifications.slice(offset, offset + limit);

  // Calculate summary counts
  const counts = notifications.reduce(
    (acc, n) => {
      if (n.opcode === 1) acc.follows++;
      else if (n.opcode === 2) acc.unfollows++;
      else if (n.opcode === 3) acc.tags++;
      else if (n.opcode === 4) acc.untags++;
      return acc;
    },
    { follows: 0, unfollows: 0, tags: 0, untags: 0 }
  );

  // Format interval for response (e.g., "168 hours" -> "168:00:00(hrs)")
  const intervalMatch = interval.match(/(\d+)\s*hours?/i);
  const formattedInterval = intervalMatch
    ? `${intervalMatch[1]}:00:00(hrs)`
    : interval + '(hrs)';

  return {
    summary: {
      interval: formattedInterval,
      opcode: opcode === 0 ? 'all' : String(opcode),
      total: notifications.length,
      total_follows: counts.follows,
      total_unfollows: counts.unfollows,
      total_tags: counts.tags,
      total_untags: counts.untags,
    },
    notifications,
  };
}
