import type { Log, PublicClient } from 'viem';
import { createLogger } from '@efp/shared';
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
import type { ChainConfig } from './events.js';

const logger = createLogger('indexer');

// A log returned by getLogs({ events: [...] }) — decoded with eventName/args,
// either of which may be missing if decoding failed
export type DecodedLog = Log & {
  eventName?: string;
  args?: Record<string, unknown>;
};

// Extract target address from ListOp hex
// Format: 0x + version(2) + opcode(2) + recordVersion(2) + recordType(2) + address(40)
export function extractTargetAddress(op: string): string {
  if (!op || op.length < 50) return '';
  return '0x' + op.slice(10, 50).toLowerCase();
}

// ============================================================
// Log fetching
// ============================================================

// Provider errors indicating the combined query returned too much data for
// one response — recoverable by halving the block range
export function isResponseCapError(err: unknown): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    const msg = current.message;
    if (
      /query returned more than/i.test(msg) ||
      /response size exceeded/i.test(msg) ||
      /log response size/i.test(msg) ||
      /result is too large/i.test(msg) ||
      /block range/i.test(msg)
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

export async function getLogsRange(
  client: PublicClient,
  config: ChainConfig,
  fromBlock: bigint,
  toBlock: bigint
): Promise<DecodedLog[]> {
  try {
    const logs = await client.getLogs({
      address: config.addresses,
      events: config.events,
      fromBlock,
      toBlock,
    });
    return logs as unknown as DecodedLog[];
  } catch (err) {
    if (fromBlock < toBlock && isResponseCapError(err)) {
      const mid = fromBlock + (toBlock - fromBlock) / BigInt(2);
      logger.warn(
        { chain: config.name, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() },
        'getLogs response too large, bisecting range'
      );
      const lower = await getLogsRange(client, config, fromBlock, mid);
      const upper = await getLogsRange(client, config, mid + BigInt(1), toBlock);
      return [...lower, ...upper];
    }
    throw err;
  }
}

// ============================================================
// Block timestamps
// ============================================================

const TIMESTAMP_CACHE_MAX = 1024;
const TIMESTAMP_FETCH_CONCURRENCY = 10;
const timestampCaches = new Map<number, Map<bigint, Date>>();

export async function fetchBlockTimestamps(
  chainId: number,
  client: PublicClient,
  blockNumbers: bigint[]
): Promise<Map<bigint, Date>> {
  let cache = timestampCaches.get(chainId);
  if (!cache) {
    cache = new Map();
    timestampCaches.set(chainId, cache);
  }

  const result = new Map<bigint, Date>();
  const missing: bigint[] = [];
  for (const blockNumber of blockNumbers) {
    const cached = cache.get(blockNumber);
    if (cached) {
      result.set(blockNumber, cached);
    } else {
      missing.push(blockNumber);
    }
  }

  for (let i = 0; i < missing.length; i += TIMESTAMP_FETCH_CONCURRENCY) {
    const chunk = missing.slice(i, i + TIMESTAMP_FETCH_CONCURRENCY);
    const blocks = await Promise.all(
      chunk.map((blockNumber) => client.getBlock({ blockNumber }))
    );
    for (const block of blocks) {
      const timestamp = new Date(Number(block.timestamp) * 1000);
      result.set(block.number, timestamp);
      cache.set(block.number, timestamp);
    }
  }

  while (cache.size > TIMESTAMP_CACHE_MAX) {
    cache.delete(cache.keys().next().value!);
  }

  return result;
}

// ============================================================
// Log processing
// ============================================================

async function processListOps(
  config: ChainConfig,
  client: PublicClient,
  listOpLogs: DecodedLog[]
): Promise<void> {
  const contractAddress = config.listRecordsAddress;

  const uniqueBlocks = [...new Set(listOpLogs.map((log) => log.blockNumber!))];
  const blockTimestamps = await fetchBlockTimestamps(config.chainId, client, uniqueBlocks);

  const parsedOps = listOpLogs.map((log) => ({
    slot: ('0x' + (log.args!.slot as bigint).toString(16).padStart(64, '0')) as `0x${string}`,
    op: log.args!.op as `0x${string}`,
  }));

  const { recordInserts, tagInserts, recordDeletes, tagDeletes } = parseListOpsBatch(
    parsedOps,
    config.chainId,
    contractAddress
  );

  // Collect events for notification history
  const events = listOpLogs.map((log) => {
    const op = log.args!.op as `0x${string}`;
    const slot = ('0x' + (log.args!.slot as bigint).toString(16).padStart(64, '0')) as `0x${string}`;
    return {
      chainId: config.chainId,
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

  // Deletes need to happen after inserts to handle edge cases
  await batchDeleteRecords(recordDeletes);
  await batchDeleteTags(tagDeletes);

  logger.info(
    { chain: config.name, listOps: listOpLogs.length, inserts: recordInserts.length, deletes: recordDeletes.length },
    'Processed ListOps'
  );
}

export async function processChainLogs(
  config: ChainConfig,
  client: PublicClient,
  logs: DecodedLog[]
): Promise<void> {
  // Nodes return logs ordered by (block, logIndex); sort defensively since
  // ordering carries semantics (e.g. Transfer mint before UpdateListStorageLocation)
  const sorted = [...logs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber! < b.blockNumber! ? -1 : 1;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  const listRecordsAddress = config.listRecordsAddress.toLowerCase();
  const listOpLogs: DecodedLog[] = [];

  for (const log of sorted) {
    if (!log.eventName || !log.args) {
      logger.warn(
        { chain: config.name, address: log.address, blockNumber: log.blockNumber?.toString(), logIndex: log.logIndex },
        'Skipping undecodable log'
      );
      continue;
    }

    const address = log.address.toLowerCase();

    switch (log.eventName) {
      case 'ListOp':
        if (address === listRecordsAddress) {
          listOpLogs.push(log);
        } else {
          logger.warn({ chain: config.name, address }, 'ListOp from unexpected address, skipping');
        }
        break;

      case 'Transfer':
        await handleTransfer(
          log as Log,
          log.args as { from: string; to: string; tokenId: bigint },
          log.address
        );
        break;

      case 'UpdateListStorageLocation':
        await handleUpdateListStorageLocation(
          log as Log,
          log.args as { tokenId: bigint; listStorageLocation: `0x${string}` }
        );
        break;

      case 'UpdateAccountMetadata':
        await handleUpdateAccountMetadata(
          log as Log,
          log.args as { addr: string; key: string; value: `0x${string}` },
          config.chainId,
          log.address
        );
        break;

      case 'UpdateListMetadata':
        await handleUpdateListMetadata(
          log as Log,
          {
            slot: ('0x' + (log.args.slot as bigint).toString(16).padStart(64, '0')) as `0x${string}`,
            key: log.args.key as string,
            value: log.args.value as `0x${string}`,
          },
          config.chainId,
          log.address
        );
        break;

      default:
        logger.warn({ chain: config.name, eventName: log.eventName }, 'Unhandled event, skipping');
    }
  }

  // ListOps only touch record/tag/event tables keyed by slot — independent of
  // the list-row updates above, so batch processing after is safe
  if (listOpLogs.length > 0) {
    await processListOps(config, client, listOpLogs);
  }
}
