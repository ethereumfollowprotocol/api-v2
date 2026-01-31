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
  handleUpdateUser,
  handleUpdateManager,
  handleUpdateAccountMetadata,
  handleListOp,
} from './handlers.js';

const logger = createLogger('indexer');

// Configuration
const POLL_INTERVAL = 2000; // 2 seconds
const BATCH_SIZE = 100; // blocks per batch (keep small to avoid memory issues with large log responses)
const CONFIRMATIONS = 2; // wait for confirmations

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
    });
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

  // UpdateUser events
  const userLogs = await baseClient.getLogs({
    address: contractAddress,
    event: {
      type: 'event',
      name: 'UpdateUser',
      inputs: [
        { indexed: true, name: 'tokenId', type: 'uint256' },
        { indexed: true, name: 'user', type: 'address' },
      ],
    },
    fromBlock,
    toBlock,
  });

  for (const log of userLogs) {
    await handleUpdateUser(log as Log, {
      tokenId: log.args.tokenId!,
      user: log.args.user!,
    });
  }

  // UpdateManager events
  const managerLogs = await baseClient.getLogs({
    address: contractAddress,
    event: {
      type: 'event',
      name: 'UpdateManager',
      inputs: [
        { indexed: true, name: 'tokenId', type: 'uint256' },
        { indexed: true, name: 'manager', type: 'address' },
      ],
    },
    fromBlock,
    toBlock,
  });

  for (const log of managerLogs) {
    await handleUpdateManager(log as Log, {
      tokenId: log.args.tokenId!,
      manager: log.args.manager!,
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
        { indexed: false, name: 'value', type: 'string' },
      ],
    },
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    await handleUpdateAccountMetadata(
      log as Log,
      { addr: log.args.addr!, key: log.args.key!, value: log.args.value! },
      8453,
      contractAddress
    );
  }

  await setIndexerState(8453, contractAddress, toBlock);
}

async function indexBaseListRecords(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const contractAddress = CONTRACTS.ListRecords.base.address as `0x${string}`;

  const logs = await baseClient.getLogs({
    address: contractAddress,
    event: {
      type: 'event',
      name: 'ListOp',
      inputs: [
        { indexed: true, name: 'slot', type: 'bytes32' },
        { indexed: false, name: 'op', type: 'bytes' },
      ],
    },
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    await handleListOp(
      log as Log,
      { slot: log.args.slot! as `0x${string}`, op: log.args.op! as `0x${string}` },
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

  const logs = await optimismClient.getLogs({
    address: contractAddress,
    event: {
      type: 'event',
      name: 'ListOp',
      inputs: [
        { indexed: true, name: 'slot', type: 'bytes32' },
        { indexed: false, name: 'op', type: 'bytes' },
      ],
    },
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    await handleListOp(
      log as Log,
      { slot: log.args.slot! as `0x${string}`, op: log.args.op! as `0x${string}` },
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

  const logs = await mainnetClient.getLogs({
    address: contractAddress,
    event: {
      type: 'event',
      name: 'ListOp',
      inputs: [
        { indexed: true, name: 'slot', type: 'bytes32' },
        { indexed: false, name: 'op', type: 'bytes' },
      ],
    },
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    await handleListOp(
      log as Log,
      { slot: log.args.slot! as `0x${string}`, op: log.args.op! as `0x${string}` },
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
