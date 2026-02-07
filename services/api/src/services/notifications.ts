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

  // Build opcode filter condition
  // Opcode is at position 5-6 in the hex string (0x + version(2) + opcode(2))
  // In SQL: substring(op, 5, 2) gives us the opcode hex
  let opcodeFilter = '';
  if (opcode !== 0) {
    const opcodeHex = opcode.toString(16).padStart(2, '0');
    opcodeFilter = `AND substring(le.op, 5, 2) = '${opcodeHex}'`;
  }


  const result = await query<{
    user_address: string;
    token_id: string;
    op: string;
    opcode: number;
    block_timestamp: Date;
    name: string | null;
    avatar: string | null;
  }>(
    `
    WITH listop_events AS (
      SELECT
        e.slot,
        e.event_args->>'op' as op,
        e.chain_id,
        e.contract_address,
        e.block_timestamp,
        -- Extract opcode: position 5-6 (after 0x and version)
        ('x' || substring(e.event_args->>'op', 5, 2))::bit(8)::int as opcode
      FROM events e
      WHERE e.event_name = 'ListOp'
        AND e.block_timestamp >= NOW() - $3::interval
        -- Use indexed target_address column
        AND e.target_address = $4
    )
    SELECT
      el."user" as user_address,
      el.token_id::text as token_id,
      le.op,
      le.opcode,
      le.block_timestamp,
      em.name,
      em.avatar
    FROM listop_events le
    JOIN efp_lists el ON
      el.list_storage_location_chain_id = le.chain_id
      AND el.list_storage_location_contract_address = le.contract_address
      AND convert_from(el.list_storage_location_slot, 'UTF8') = le.slot
    JOIN efp_account_metadata am ON
      am.address = el."user"
      AND am.key = 'primary-list'
      AND convert_hex_to_bigint(am.value) = el.token_id
    LEFT JOIN ens_metadata em ON em.address = el."user"
    WHERE el."user" IS NOT NULL
      ${opcodeFilter}
    ORDER BY le.block_timestamp DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset, interval, targetAddress.toLowerCase()]
  );

  // Process results
  const notifications: Notification[] = result.rows
    .map((row) => {
      const parsedTag = parseTagFromOp(row.op);

      // Skip if tag filter doesn't match (unless 'p_tag_empty' which means all)
      if (tag !== 'p_tag_empty' && parsedTag !== tag) return null;

      return {
        address: row.user_address.toLowerCase(),
        name: row.name,
        avatar: row.avatar,
        token_id: row.token_id,
        action: opcodeToAction(row.opcode),
        opcode: row.opcode,
        op: row.op,
        tag: parsedTag,
        updated_at: row.block_timestamp.toISOString(),
      };
    })
    .filter((n): n is Notification => n !== null);

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
