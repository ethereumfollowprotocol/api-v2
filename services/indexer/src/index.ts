import { createPublicClient, http, type PublicClient } from 'viem';
import { base, optimism, mainnet } from 'viem/chains';
import { createLogger, env, query, closePool, ensureSchema } from '@efp/shared';
import { CHAIN_CONFIGS, type ChainConfig } from './events.js';
import { getLogsRange, processChainLogs } from './processor.js';
import {
  getChainCursor,
  setChainCursor,
  ensureIndexerStateTable,
  setIndexerCaughtUp,
} from './state.js';

const logger = createLogger('indexer');

// Configuration
const BATCH_SIZE = env.INDEXER_BATCH_SIZE; // blocks per getLogs range
const CONFIRMATIONS = 0; // no confirmation wait needed
const IDLE_THRESHOLD = env.INDEXER_IDLE_THRESHOLD; // empty cycles before idle polling
const ERROR_RETRY_DELAY = 5000;

// Per-chain, per-method RPC call counts, logged hourly to verify usage against
// the provider dashboard
const rpcCallCounts = new Map<string, number>();

function countingHttp(url: string | undefined, chainName: string) {
  return http(url, {
    onFetchRequest: (request) => {
      // Fire-and-forget: count from a clone without delaying the request
      void request
        .clone()
        .json()
        .then((body) => {
          const calls = Array.isArray(body) ? body : [body];
          for (const call of calls) {
            const key = `${chainName}:${call?.method ?? 'unknown'}`;
            rpcCallCounts.set(key, (rpcCallCounts.get(key) ?? 0) + 1);
          }
        })
        .catch(() => {
          // accounting only — never interfere with the request
        });
    },
  });
}

function logAndResetRpcCounts(): void {
  if (rpcCallCounts.size === 0) return;
  logger.info(Object.fromEntries(rpcCallCounts), 'RPC calls in the last hour');
  rpcCallCounts.clear();
}

const clients: Record<number, PublicClient> = {
  8453: createPublicClient({ chain: base, transport: countingHttp(env.PRIMARY_RPC_BASE, 'base') }) as PublicClient,
  10: createPublicClient({ chain: optimism, transport: countingHttp(env.PRIMARY_RPC_OP, 'optimism') }) as PublicClient,
  1: createPublicClient({ chain: mainnet, transport: countingHttp(env.PRIMARY_RPC_ETH, 'ethereum') }) as PublicClient,
};

// Latest block per chain, refreshed by each polling cycle so the periodic
// caught-up check doesn't need its own getBlockNumber calls
const latestBlockCache = new Map<number, { block: bigint; fetchedAt: number }>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Chain indexer loop
// ============================================================

async function runChainIndexer(config: ChainConfig): Promise<void> {
  const client = clients[config.chainId];
  logger.info(
    { chain: config.name, startBlock: config.startBlock.toString(), pollInterval: config.pollInterval },
    'Starting chain indexer'
  );

  let consecutiveEmpty = 0;

  while (true) {
    try {
      const currentBlock = await client.getBlockNumber();
      latestBlockCache.set(config.chainId, { block: currentBlock, fetchedAt: Date.now() });
      const safeBlock = currentBlock - BigInt(CONFIRMATIONS);

      const lastBlock = await getChainCursor(config.chainId, config.addresses);
      const fromBlock = lastBlock > BigInt(0) ? lastBlock + BigInt(1) : config.startBlock;

      if (fromBlock <= safeBlock) {
        const toBlock = fromBlock + BigInt(BATCH_SIZE) > safeBlock
          ? safeBlock
          : fromBlock + BigInt(BATCH_SIZE);

        logger.debug(
          { chain: config.name, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() },
          'Indexing'
        );

        const logs = await getLogsRange(client, config, fromBlock, toBlock);
        if (logs.length > 0) {
          await processChainLogs(config, client, logs);
          consecutiveEmpty = 0;
        } else {
          consecutiveEmpty++;
        }

        await setChainCursor(config.chainId, config.addresses, toBlock);
        logger.info({ chain: config.name, toBlock: toBlock.toString(), logs: logs.length }, 'Indexed blocks');

        // Still catching up — keep going without sleeping
        if (toBlock < safeBlock) {
          continue;
        }
      } else {
        consecutiveEmpty++;
      }

      const interval = consecutiveEmpty >= IDLE_THRESHOLD ? config.idlePollInterval : config.pollInterval;
      await sleep(interval);
    } catch (err) {
      logger.error({ err, chain: config.name }, 'Error in chain indexer');
      await sleep(ERROR_RETRY_DELAY);
    }
  }
}

// ============================================================
// Main
// ============================================================

async function checkAndSetCaughtUp(): Promise<void> {
  // Check if all chains are caught up, reusing block numbers from the polling
  // loops when fresh enough
  for (const config of CHAIN_CONFIGS) {
    const cached = latestBlockCache.get(config.chainId);
    const block =
      cached && Date.now() - cached.fetchedAt < 60000
        ? cached.block
        : await clients[config.chainId].getBlockNumber();

    const cursor = await getChainCursor(config.chainId, config.addresses);
    if (block - cursor >= BigInt(100)) return;
  }

  await setIndexerCaughtUp(true);
  logger.info('Indexer caught up on all chains');
}

async function main() {
  logger.info('Indexer starting...');

  try {
    await ensureSchema();
    await ensureIndexerStateTable();
    logger.info('Database schema ready');

    // Reset flags on indexer startup - this signals orchestrator that data migrations need to run
    await query(`
      UPDATE efp_system_state
      SET value = 'false', updated_at = NOW()
      WHERE key IN ('indexer_caught_up', 'migration_complete')
    `);
    logger.info('Reset indexer_caught_up and migration_complete flags');

    // Periodically check if caught up
    setInterval(() => checkAndSetCaughtUp().catch((e) => logger.error(e, 'Error checking caught up')), 30000);

    // Hourly RPC usage accounting
    setInterval(() => logAndResetRpcCounts(), 3600000);

    // Run all chain indexers concurrently
    await Promise.all(CHAIN_CONFIGS.map((config) => runChainIndexer(config)));
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
