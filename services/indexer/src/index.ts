import { createPublicClient, http, type Log } from 'viem';
import { base, optimism, mainnet } from 'viem/chains';
import {
  createLogger,
  env,
  CONTRACTS,
  query,
  closePool,
  ensureSchema,
} from '@efp/shared';
import {
  handleTransfer,
  handleUpdateListStorageLocation,
  handleUpdateListMetadata,
  handleUpdateAccountMetadata,
  parseListOpsBatch,
  batchInsertRecords,
  batchInsertTags,
  batchDeleteRecords,
  batchDeleteTags,
  batchInsertEvents,
} from './handlers.js';

const logger = createLogger('indexer');

// Configuration
const POLL_INTERVAL = 2000; // 2 seconds
const BATCH_SIZE = 5000; // blocks per batch (increased for faster catchup)
const CONFIRMATIONS = 0; // no confirmation wait needed

// Create clients for each chain
const baseClient = createPublicClient({
  chain: base,
  transport: http(env.PRIMARY_RPC_BASE),
});

const optimismClient = createPublicClient({
  chain: optimism,
  transport: http(env.PRIMARY_RPC_OP),
});

const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(env.PRIMARY_RPC_ETH),
});

async function getIndexerState(chainId: number, contractAddress: string): Promise<bigint> {
  const result = await query<{ last_block: string }>(
    `SELECT last_block FROM indexer_state WHERE chain_id = $1 AND contract_address = $2`,
    [chainId, contractAddress.toLowerCase()]
  );
  return result.rows.length > 0 ? BigInt(result.rows[0].last_block) : BigInt(0);
}

async function setIndexerState(
  chainId: number,
  contractAddress: string,
  lastBlock: bigint
): Promise<void> {
  await query(
    `INSERT INTO indexer_state (chain_id, contract_address, last_block, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (chain_id, contract_address) DO UPDATE SET
       last_block = EXCLUDED.last_block, updated_at = NOW()`,
    [chainId, contractAddress.toLowerCase(), lastBlock.toString()]
  );
}

async function ensureIndexerStateTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS indexer_state (
      chain_id BIGINT NOT NULL,
      contract_address VARCHAR(42) NOT NULL,
      last_block BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chain_id, contract_address)
    )
  `);
}

async function setIndexerCaughtUp(caughtUp: boolean): Promise<void> {
  await query(
    `UPDATE efp_system_state SET value = $1, updated_at = NOW() WHERE key = 'indexer_caught_up'`,
    [caughtUp.toString()]
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Extract target address from ListOp hex
// Format: 0x + version(2) + opcode(2) + recordVersion(2) + recordType(2) + address(40)
function extractTargetAddress(op: string): string {
  if (!op || op.length < 50) return '';
  return '0x' + op.slice(10, 50).toLowerCase();
}

// ============================================================
// Base Chain Indexer
// ============================================================

async function indexBaseListRegistry(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const contractAddress = CONTRACTS.ListRegistry.address as `0x${string}`;

  // Transfer events
  const transferLogs = await baseClient.getLogs({
    address: contractAddress,
    event: {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { indexed: true, name: 'from', type: 'address' },
        { indexed: true, name: 'to', type: 'address' },
        { indexed: true, name: 'tokenId', type: 'uint256' },
      ],
    },
    fromBlock,
    toBlock,
  });

  for (const log of transferLogs) {
    await handleTransfer(log as Log, {
      from: log.args.from!,
      to: log.args.to!,
      tokenId: log.args.tokenId!,
    }, contractAddress);
  }

  // UpdateListStorageLocation events
  const lslLogs = await baseClient.getLogs({
    address: contractAddress,
    event: {
      type: 'event',
      name: 'UpdateListStorageLocation',
      inputs: [
        { indexed: true, name: 'tokenId', type: 'uint256' },
        { indexed: false, name: 'listStorageLocation', type: 'bytes' },
      ],
    },
    fromBlock,
    toBlock,
  });

  for (const log of lslLogs) {
    await handleUpdateListStorageLocation(log as Log, {
      tokenId: log.args.tokenId!,
      listStorageLocation: log.args.listStorageLocation! as `0x${string}`,
    });
  }

  await setIndexerState(8453, contractAddress, toBlock);
}

async function indexBaseAccountMetadata(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const contractAddress = CONTRACTS.AccountMetadata.address as `0x${string}`;

  const logs = await baseClient.getLogs({
    address: contractAddress,
    event: {
      type: 'event',
      name: 'UpdateAccountMetadata',
      inputs: [
        { indexed: true, name: 'addr', type: 'address' },
        { indexed: false, name: 'key', type: 'string' },
        { indexed: false, name: 'value', type: 'bytes' },
      ],
    },
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    await handleUpdateAccountMetadata(
      log as Log,
      { addr: log.args.addr!, key: log.args.key!, value: log.args.value! as `0x${string}` },
      8453,
      contractAddress
    );
  }

  await setIndexerState(8453, contractAddress, toBlock);
}

async function indexBaseListRecords(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const contractAddress = CONTRACTS.ListRecords.base.address as `0x${string}`;

  // Fetch ListOp and UpdateListMetadata events in parallel
  const [listOpLogs, metadataLogs] = await Promise.all([
    baseClient.getLogs({
      address: contractAddress,
      event: {
        type: 'event',
        name: 'ListOp',
        inputs: [
          { indexed: true, name: 'slot', type: 'uint256' },
          { indexed: false, name: 'op', type: 'bytes' },
        ],
      },
      fromBlock,
      toBlock,
    }),
    baseClient.getLogs({
      address: contractAddress,
      event: {
        type: 'event',
        name: 'UpdateListMetadata',
        inputs: [
          { indexed: true, name: 'slot', type: 'uint256' },
          { indexed: false, name: 'key', type: 'string' },
          { indexed: false, name: 'value', type: 'bytes' },
        ],
      },
      fromBlock,
      toBlock,
    }),
  ]);

  // Batch process ListOp events
  if (listOpLogs.length > 0) {
    // Get unique blocks and fetch their timestamps
    const uniqueBlocks = [...new Set(listOpLogs.map(log => log.blockNumber!))];
    const blockTimestamps = new Map<bigint, Date>();

    for (const blockNum of uniqueBlocks) {
      const block = await baseClient.getBlock({ blockNumber: blockNum });
      blockTimestamps.set(blockNum, new Date(Number(block.timestamp) * 1000));
    }

    const parsedOps = listOpLogs.map(log => ({
      slot: ('0x' + log.args.slot!.toString(16).padStart(64, '0')) as `0x${string}`,
      op: log.args.op! as `0x${string}`,
    }));

    const { recordInserts, tagInserts, recordDeletes, tagDeletes } = parseListOpsBatch(parsedOps, 8453, contractAddress);

    // Collect events for notification history
    const events = listOpLogs.map(log => {
      const op = log.args.op! as `0x${string}`;
      const slot = ('0x' + log.args.slot!.toString(16).padStart(64, '0')) as `0x${string}`;
      return {
        chainId: 8453,
        blockNumber: log.blockNumber!.toString(),
        transactionIndex: log.transactionIndex!,
        logIndex: log.logIndex!,
        contractAddress: contractAddress.toLowerCase(),
        slot,
        op,
        targetAddress: extractTargetAddress(op),
        blockHash: log.blockHash!,
        transactionHash: log.transactionHash!,
        blockTimestamp: blockTimestamps.get(log.blockNumber!)!,
      };
    });

    // Execute batch operations
    await Promise.all([
      batchInsertRecords(recordInserts),
      batchInsertTags(tagInserts),
      batchInsertEvents(events),
    ]);

    // Deletes need to happen after inserts to handle edge cases
    await batchDeleteRecords(recordDeletes);
    await batchDeleteTags(tagDeletes);

    logger.info({ chain: 'base', listOps: listOpLogs.length, inserts: recordInserts.length, deletes: recordDeletes.length }, 'Processed ListOps');
  }

  // Process metadata events (these are less frequent, keep sequential)
  for (const log of metadataLogs) {
    await handleUpdateListMetadata(
      log as Log,
      {
        slot: ('0x' + log.args.slot!.toString(16).padStart(64, '0')) as `0x${string}`,
        key: log.args.key!,
        value: log.args.value! as `0x${string}`,
      },
      8453,
      contractAddress
    );
  }

  await setIndexerState(8453, contractAddress, toBlock);
}

async function runBaseIndexer(startBlock: bigint): Promise<void> {
  logger.info({ chain: 'base', startBlock: startBlock.toString() }, 'Starting Base indexer');

  const contracts = [
    { address: CONTRACTS.ListRegistry.address, indexFn: indexBaseListRegistry },
    { address: CONTRACTS.AccountMetadata.address, indexFn: indexBaseAccountMetadata },
    { address: CONTRACTS.ListRecords.base.address, indexFn: indexBaseListRecords },
  ];

  while (true) {
    try {
      const currentBlock = await baseClient.getBlockNumber();
      const safeBlock = currentBlock - BigInt(CONFIRMATIONS);

      for (const contract of contracts) {
        const lastBlock = await getIndexerState(8453, contract.address);
        const fromBlock = lastBlock > BigInt(0) ? lastBlock + BigInt(1) : startBlock;

        if (fromBlock > safeBlock) continue;

        const toBlock = fromBlock + BigInt(BATCH_SIZE) > safeBlock
          ? safeBlock
          : fromBlock + BigInt(BATCH_SIZE);

        logger.debug({ chain: 'base', contract: contract.address, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, 'Indexing');
        await contract.indexFn(fromBlock, toBlock);
        logger.info({ chain: 'base', contract: contract.address, toBlock: toBlock.toString() }, 'Indexed blocks');
      }

      await sleep(POLL_INTERVAL);
    } catch (err) {
      logger.error({ err, chain: 'base' }, 'Error in Base indexer');
      await sleep(5000);
    }
  }
}

// ============================================================
// Optimism Chain Indexer
// ============================================================

async function indexOptimismListRecords(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const contractAddress = CONTRACTS.ListRecords.optimism.address as `0x${string}`;

  // Fetch ListOp and UpdateListMetadata events in parallel
  const [listOpLogs, metadataLogs] = await Promise.all([
    optimismClient.getLogs({
      address: contractAddress,
      event: {
        type: 'event',
        name: 'ListOp',
        inputs: [
          { indexed: true, name: 'slot', type: 'uint256' },
          { indexed: false, name: 'op', type: 'bytes' },
        ],
      },
      fromBlock,
      toBlock,
    }),
    optimismClient.getLogs({
      address: contractAddress,
      event: {
        type: 'event',
        name: 'UpdateListMetadata',
        inputs: [
          { indexed: true, name: 'slot', type: 'uint256' },
          { indexed: false, name: 'key', type: 'string' },
          { indexed: false, name: 'value', type: 'bytes' },
        ],
      },
      fromBlock,
      toBlock,
    }),
  ]);

  // Batch process ListOp events
  if (listOpLogs.length > 0) {
    // Get unique blocks and fetch their timestamps
    const uniqueBlocks = [...new Set(listOpLogs.map(log => log.blockNumber!))];
    const blockTimestamps = new Map<bigint, Date>();

    for (const blockNum of uniqueBlocks) {
      const block = await optimismClient.getBlock({ blockNumber: blockNum });
      blockTimestamps.set(blockNum, new Date(Number(block.timestamp) * 1000));
    }

    const parsedOps = listOpLogs.map(log => ({
      slot: ('0x' + log.args.slot!.toString(16).padStart(64, '0')) as `0x${string}`,
      op: log.args.op! as `0x${string}`,
    }));

    const { recordInserts, tagInserts, recordDeletes, tagDeletes } = parseListOpsBatch(parsedOps, 10, contractAddress);

    // Collect events for notification history
    const events = listOpLogs.map(log => {
      const op = log.args.op! as `0x${string}`;
      const slot = ('0x' + log.args.slot!.toString(16).padStart(64, '0')) as `0x${string}`;
      return {
        chainId: 10,
        blockNumber: log.blockNumber!.toString(),
        transactionIndex: log.transactionIndex!,
        logIndex: log.logIndex!,
        contractAddress: contractAddress.toLowerCase(),
        slot,
        op,
        targetAddress: extractTargetAddress(op),
        blockHash: log.blockHash!,
        transactionHash: log.transactionHash!,
        blockTimestamp: blockTimestamps.get(log.blockNumber!)!,
      };
    });

    await Promise.all([
      batchInsertRecords(recordInserts),
      batchInsertTags(tagInserts),
      batchInsertEvents(events),
    ]);

    await batchDeleteRecords(recordDeletes);
    await batchDeleteTags(tagDeletes);

    logger.info({ chain: 'optimism', listOps: listOpLogs.length, inserts: recordInserts.length, deletes: recordDeletes.length }, 'Processed ListOps');
  }

  for (const log of metadataLogs) {
    await handleUpdateListMetadata(
      log as Log,
      {
        slot: ('0x' + log.args.slot!.toString(16).padStart(64, '0')) as `0x${string}`,
        key: log.args.key!,
        value: log.args.value! as `0x${string}`,
      },
      10,
      contractAddress
    );
  }

  await setIndexerState(10, contractAddress, toBlock);
}

async function runOptimismIndexer(startBlock: bigint): Promise<void> {
  logger.info({ chain: 'optimism', startBlock: startBlock.toString() }, 'Starting Optimism indexer');

  while (true) {
    try {
      const currentBlock = await optimismClient.getBlockNumber();
      const safeBlock = currentBlock - BigInt(CONFIRMATIONS);
      const contractAddress = CONTRACTS.ListRecords.optimism.address;

      const lastBlock = await getIndexerState(10, contractAddress);
      const fromBlock = lastBlock > BigInt(0) ? lastBlock + BigInt(1) : startBlock;

      if (fromBlock <= safeBlock) {
        const toBlock = fromBlock + BigInt(BATCH_SIZE) > safeBlock
          ? safeBlock
          : fromBlock + BigInt(BATCH_SIZE);

        logger.debug({ chain: 'optimism', fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, 'Indexing');
        await indexOptimismListRecords(fromBlock, toBlock);
        logger.info({ chain: 'optimism', toBlock: toBlock.toString() }, 'Indexed blocks');
      }

      await sleep(POLL_INTERVAL);
    } catch (err) {
      logger.error({ err, chain: 'optimism' }, 'Error in Optimism indexer');
      await sleep(5000);
    }
  }
}

// ============================================================
// Ethereum Mainnet Indexer
// ============================================================

async function indexEthereumListRecords(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const contractAddress = CONTRACTS.ListRecords.ethereum.address as `0x${string}`;

  // Fetch ListOp and UpdateListMetadata events in parallel
  const [listOpLogs, metadataLogs] = await Promise.all([
    mainnetClient.getLogs({
      address: contractAddress,
      event: {
        type: 'event',
        name: 'ListOp',
        inputs: [
          { indexed: true, name: 'slot', type: 'uint256' },
          { indexed: false, name: 'op', type: 'bytes' },
        ],
      },
      fromBlock,
      toBlock,
    }),
    mainnetClient.getLogs({
      address: contractAddress,
      event: {
        type: 'event',
        name: 'UpdateListMetadata',
        inputs: [
          { indexed: true, name: 'slot', type: 'uint256' },
          { indexed: false, name: 'key', type: 'string' },
          { indexed: false, name: 'value', type: 'bytes' },
        ],
      },
      fromBlock,
      toBlock,
    }),
  ]);

  // Batch process ListOp events
  if (listOpLogs.length > 0) {
    // Get unique blocks and fetch their timestamps
    const uniqueBlocks = [...new Set(listOpLogs.map(log => log.blockNumber!))];
    const blockTimestamps = new Map<bigint, Date>();

    for (const blockNum of uniqueBlocks) {
      const block = await mainnetClient.getBlock({ blockNumber: blockNum });
      blockTimestamps.set(blockNum, new Date(Number(block.timestamp) * 1000));
    }

    const parsedOps = listOpLogs.map(log => ({
      slot: ('0x' + log.args.slot!.toString(16).padStart(64, '0')) as `0x${string}`,
      op: log.args.op! as `0x${string}`,
    }));

    const { recordInserts, tagInserts, recordDeletes, tagDeletes } = parseListOpsBatch(parsedOps, 1, contractAddress);

    // Collect events for notification history
    const events = listOpLogs.map(log => {
      const op = log.args.op! as `0x${string}`;
      const slot = ('0x' + log.args.slot!.toString(16).padStart(64, '0')) as `0x${string}`;
      return {
        chainId: 1,
        blockNumber: log.blockNumber!.toString(),
        transactionIndex: log.transactionIndex!,
        logIndex: log.logIndex!,
        contractAddress: contractAddress.toLowerCase(),
        slot,
        op,
        targetAddress: extractTargetAddress(op),
        blockHash: log.blockHash!,
        transactionHash: log.transactionHash!,
        blockTimestamp: blockTimestamps.get(log.blockNumber!)!,
      };
    });

    await Promise.all([
      batchInsertRecords(recordInserts),
      batchInsertTags(tagInserts),
      batchInsertEvents(events),
    ]);

    await batchDeleteRecords(recordDeletes);
    await batchDeleteTags(tagDeletes);

    logger.info({ chain: 'ethereum', listOps: listOpLogs.length, inserts: recordInserts.length, deletes: recordDeletes.length }, 'Processed ListOps');
  }

  for (const log of metadataLogs) {
    await handleUpdateListMetadata(
      log as Log,
      {
        slot: ('0x' + log.args.slot!.toString(16).padStart(64, '0')) as `0x${string}`,
        key: log.args.key!,
        value: log.args.value! as `0x${string}`,
      },
      1,
      contractAddress
    );
  }

  await setIndexerState(1, contractAddress, toBlock);
}

async function runEthereumIndexer(startBlock: bigint): Promise<void> {
  logger.info({ chain: 'ethereum', startBlock: startBlock.toString() }, 'Starting Ethereum indexer');

  while (true) {
    try {
      const currentBlock = await mainnetClient.getBlockNumber();
      const safeBlock = currentBlock - BigInt(CONFIRMATIONS);
      const contractAddress = CONTRACTS.ListRecords.ethereum.address;

      const lastBlock = await getIndexerState(1, contractAddress);
      const fromBlock = lastBlock > BigInt(0) ? lastBlock + BigInt(1) : startBlock;

      if (fromBlock <= safeBlock) {
        const toBlock = fromBlock + BigInt(BATCH_SIZE) > safeBlock
          ? safeBlock
          : fromBlock + BigInt(BATCH_SIZE);

        logger.debug({ chain: 'ethereum', fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, 'Indexing');
        await indexEthereumListRecords(fromBlock, toBlock);
        logger.info({ chain: 'ethereum', toBlock: toBlock.toString() }, 'Indexed blocks');
      }

      await sleep(POLL_INTERVAL);
    } catch (err) {
      logger.error({ err, chain: 'ethereum' }, 'Error in Ethereum indexer');
      await sleep(5000);
    }
  }
}

// ============================================================
// Main
// ============================================================

async function checkAndSetCaughtUp(): Promise<void> {
  // Check if all chains are caught up
  const baseBlock = await baseClient.getBlockNumber();
  const opBlock = await optimismClient.getBlockNumber();
  const ethBlock = await mainnetClient.getBlockNumber();

  const baseState = await getIndexerState(8453, CONTRACTS.ListRecords.base.address);
  const opState = await getIndexerState(10, CONTRACTS.ListRecords.optimism.address);
  const ethState = await getIndexerState(1, CONTRACTS.ListRecords.ethereum.address);

  const baseGap = baseBlock - baseState;
  const opGap = opBlock - opState;
  const ethGap = ethBlock - ethState;

  if (baseGap < BigInt(100) && opGap < BigInt(100) && ethGap < BigInt(100)) {
    await setIndexerCaughtUp(true);
    logger.info('Indexer caught up on all chains');
  }
}

async function main() {
  logger.info('Indexer starting...');

  try {
    await ensureSchema();
    await ensureIndexerStateTable();
    logger.info('Database schema ready');

    // Start blocks (EFP deployment blocks)
    const baseStartBlock = BigInt(20180000);
    const opStartBlock = BigInt(125792000);
    const ethStartBlock = BigInt(20820000);

    // Periodically check if caught up
    setInterval(() => checkAndSetCaughtUp().catch((e) => logger.error(e, 'Error checking caught up')), 30000);

    // Run all indexers concurrently
    await Promise.all([
      runBaseIndexer(baseStartBlock),
      runOptimismIndexer(opStartBlock),
      runEthereumIndexer(ethStartBlock),
    ]);
  } catch (err) {
    logger.error(err, 'Indexer fatal error');
    await closePool();
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
