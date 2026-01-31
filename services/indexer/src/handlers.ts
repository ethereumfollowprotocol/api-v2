import { query, createLogger, CONTRACTS } from '@efp/shared';
import type { Log } from 'viem';

const logger = createLogger('indexer-handlers');

// Parse List Storage Location (86 bytes)
// Format: version (1) + locationType (1) + chainId (32) + contractAddress (20) + slot (32)
function parseListStorageLocation(lsl: `0x${string}`): {
  version: number;
  locationType: number;
  chainId: bigint;
  contractAddress: string;
  slot: `0x${string}`;
} | null {
  if (!lsl || lsl.length < 172) return null; // 2 + 2 + 64 + 40 + 64 = 172 chars

  const bytes = lsl.slice(2); // remove 0x
  return {
    version: parseInt(bytes.slice(0, 2), 16),
    locationType: parseInt(bytes.slice(2, 4), 16),
    chainId: BigInt('0x' + bytes.slice(4, 68)),
    contractAddress: '0x' + bytes.slice(68, 108).toLowerCase(),
    slot: ('0x' + bytes.slice(108)) as `0x${string}`,
  };
}

// Parse ListOp
// Format: version (1) + opcode (1) + data (variable)
function parseListOp(op: `0x${string}`): {
  version: number;
  opcode: number;
  data: `0x${string}`;
} | null {
  if (!op || op.length < 6) return null;

  const bytes = op.slice(2);
  return {
    version: parseInt(bytes.slice(0, 2), 16),
    opcode: parseInt(bytes.slice(2, 4), 16),
    data: ('0x' + bytes.slice(4)) as `0x${string}`,
  };
}

// Parse record from ListOp data
// For address records: recordVersion (1) + recordType (1) + address (20)
function parseRecord(data: `0x${string}`): {
  version: number;
  recordType: number;
  recordData: `0x${string}`;
} | null {
  if (!data || data.length < 6) return null;

  const bytes = data.slice(2);
  return {
    version: parseInt(bytes.slice(0, 2), 16),
    recordType: parseInt(bytes.slice(2, 4), 16),
    recordData: ('0x' + bytes.slice(4)) as `0x${string}`,
  };
}

export async function handleTransfer(
  log: Log,
  args: { from: string; to: string; tokenId: bigint },
  contractAddress: string
): Promise<void> {
  const { from, to, tokenId } = args;

  logger.debug({ tokenId: tokenId.toString(), from, to }, 'Processing Transfer');

  // Insert or update list
  // nft_chain_id is always Base (8453) since ListRegistry is only on Base
  await query(
    `
    INSERT INTO efp_lists (token_id, owner, nft_chain_id, nft_contract_address, created_at, updated_at)
    VALUES ($1, $2, 8453, $3, NOW(), NOW())
    ON CONFLICT (token_id) DO UPDATE SET
      owner = EXCLUDED.owner,
      updated_at = NOW()
  `,
    [tokenId.toString(), to.toLowerCase(), contractAddress.toLowerCase()]
  );
}

export async function handleUpdateListStorageLocation(
  log: Log,
  args: { tokenId: bigint; listStorageLocation: `0x${string}` }
): Promise<void> {
  const { tokenId, listStorageLocation } = args;

  const parsed = parseListStorageLocation(listStorageLocation);
  if (!parsed) {
    logger.warn({ tokenId: tokenId.toString() }, 'Failed to parse LSL');
    return;
  }

  logger.debug(
    {
      tokenId: tokenId.toString(),
      chainId: parsed.chainId.toString(),
      contractAddress: parsed.contractAddress,
    },
    'Processing UpdateListStorageLocation'
  );

  await query(
    `
    UPDATE efp_lists SET
      list_storage_location = $2,
      list_storage_location_chain_id = $3,
      list_storage_location_contract_address = $4,
      list_storage_location_slot = $5,
      updated_at = NOW()
    WHERE token_id = $1
  `,
    [
      tokenId.toString(),
      listStorageLocation,
      parsed.chainId.toString(),
      parsed.contractAddress,
      parsed.slot,
    ]
  );
}

export async function handleUpdateListMetadata(
  log: Log,
  args: { slot: `0x${string}`; key: string; value: `0x${string}` },
  chainId: number,
  contractAddress: string
): Promise<void> {
  const { slot, key, value } = args;

  logger.debug({ slot, key, chainId }, 'Processing UpdateListMetadata');

  // The slot corresponds to list_storage_location_slot in efp_lists
  // We need to find the list by its storage location and update the metadata

  if (key === 'user') {
    // Value is a 20-byte address (40 hex chars after 0x)
    const userAddress = '0x' + value.slice(2, 42).toLowerCase();

    await query(
      `
      UPDATE efp_lists SET
        "user" = $4,
        updated_at = NOW()
      WHERE list_storage_location_chain_id = $1
        AND list_storage_location_contract_address = $2
        AND list_storage_location_slot = $3
    `,
      [chainId, contractAddress.toLowerCase(), slot, userAddress]
    );

    logger.info({ slot, user: userAddress, chainId }, 'Updated list user');
  } else if (key === 'manager') {
    // Value is a 20-byte address (40 hex chars after 0x)
    const managerAddress = '0x' + value.slice(2, 42).toLowerCase();

    await query(
      `
      UPDATE efp_lists SET
        manager = $4,
        updated_at = NOW()
      WHERE list_storage_location_chain_id = $1
        AND list_storage_location_contract_address = $2
        AND list_storage_location_slot = $3
    `,
      [chainId, contractAddress.toLowerCase(), slot, managerAddress]
    );

    logger.info({ slot, manager: managerAddress, chainId }, 'Updated list manager');
  }
}

export async function handleUpdateAccountMetadata(
  log: Log,
  args: { addr: string; key: string; value: `0x${string}` },
  chainId: number,
  contractAddress: string
): Promise<void> {
  const { addr, key, value } = args;

  // Convert bytes to string - for primary-list, this is a hex-encoded token ID
  const valueStr = value;

  logger.debug({ address: addr, key, value: valueStr }, 'Processing UpdateAccountMetadata');

  await query(
    `
    INSERT INTO efp_account_metadata (chain_id, contract_address, address, key, value, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (address, key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW()
  `,
    [chainId, contractAddress.toLowerCase(), addr.toLowerCase(), key, valueStr]
  );
}

export async function handleListOp(
  log: Log,
  args: { slot: `0x${string}`; op: `0x${string}` },
  chainId: number,
  contractAddress: string
): Promise<void> {
  const { slot, op } = args;

  const parsed = parseListOp(op);
  if (!parsed) {
    logger.warn({ slot }, 'Failed to parse ListOp');
    return;
  }

  const { version, opcode, data } = parsed;

  // Opcode 1: Add record (follow)
  // Opcode 2: Remove record (unfollow)
  // Opcode 3: Add tag
  // Opcode 4: Remove tag

  if (opcode === 1) {
    // Add record
    const record = parseRecord(data);
    if (!record) {
      logger.warn({ slot, opcode }, 'Failed to parse record');
      return;
    }

    logger.debug(
      {
        slot,
        recordType: record.recordType,
        chainId,
      },
      'Processing ListOp Add'
    );

    await query(
      `
      INSERT INTO efp_list_records (chain_id, contract_address, slot, record, record_version, record_type, record_data, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (chain_id, contract_address, slot, record) DO NOTHING
    `,
      [
        chainId,
        contractAddress.toLowerCase(),
        slot,
        data,
        record.version,
        record.recordType,
        record.recordData,
      ]
    );
  } else if (opcode === 2) {
    // Remove record
    logger.debug({ slot, chainId }, 'Processing ListOp Remove');

    await query(
      `
      DELETE FROM efp_list_records
      WHERE chain_id = $1
        AND contract_address = $2
        AND slot = $3
        AND record = $4
    `,
      [chainId, contractAddress.toLowerCase(), slot, data]
    );

    // Also remove any tags for this record
    await query(
      `
      DELETE FROM efp_list_record_tags
      WHERE chain_id = $1
        AND contract_address = $2
        AND slot = $3
        AND record = $4
    `,
      [chainId, contractAddress.toLowerCase(), slot, data]
    );
  } else if (opcode === 3) {
    // Add tag
    // Data format: record (variable) + tag (string at end)
    // For simplicity, assume record is first 44 chars (22 bytes) and rest is tag
    const recordHex = data.slice(0, 46) as `0x${string}`; // 0x + 44 chars
    const tagHex = data.slice(46);
    const tag = Buffer.from(tagHex, 'hex').toString('utf8').replace(/\0/g, '');

    logger.debug({ slot, tag, chainId }, 'Processing ListOp AddTag');

    await query(
      `
      INSERT INTO efp_list_record_tags (chain_id, contract_address, slot, record, tag, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (chain_id, contract_address, slot, record, tag) DO NOTHING
    `,
      [chainId, contractAddress.toLowerCase(), slot, recordHex, tag]
    );
  } else if (opcode === 4) {
    // Remove tag
    const recordHex = data.slice(0, 46) as `0x${string}`;
    const tagHex = data.slice(46);
    const tag = Buffer.from(tagHex, 'hex').toString('utf8').replace(/\0/g, '');

    logger.debug({ slot, tag, chainId }, 'Processing ListOp RemoveTag');

    await query(
      `
      DELETE FROM efp_list_record_tags
      WHERE chain_id = $1
        AND contract_address = $2
        AND slot = $3
        AND record = $4
        AND tag = $5
    `,
      [chainId, contractAddress.toLowerCase(), slot, recordHex, tag]
    );
  }
}
