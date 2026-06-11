import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PublicClient } from 'viem';

vi.mock('@efp/shared', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  query: vi.fn(),
}));

vi.mock('../handlers.js', () => ({
  handleTransfer: vi.fn(),
  handleUpdateListStorageLocation: vi.fn(),
  handleUpdateListMetadata: vi.fn(),
  handleUpdateAccountMetadata: vi.fn(),
  parseListOpsBatch: vi.fn(() => ({
    recordInserts: [],
    tagInserts: [],
    recordDeletes: [],
    tagDeletes: [],
  })),
  batchInsertRecords: vi.fn(),
  batchInsertTags: vi.fn(),
  batchDeleteRecords: vi.fn(),
  batchDeleteTags: vi.fn(),
  batchInsertEvents: vi.fn(),
}));

import {
  processChainLogs,
  getLogsRange,
  isResponseCapError,
  extractTargetAddress,
  clearTimestampCaches,
  type DecodedLog,
} from '../processor.js';
import type { ChainConfig } from '../events.js';
import {
  handleTransfer,
  handleUpdateListStorageLocation,
  handleUpdateListMetadata,
  handleUpdateAccountMetadata,
  parseListOpsBatch,
  batchInsertRecords,
  batchInsertEvents,
  batchDeleteRecords,
} from '../handlers.js';

// Same address deployed as AccountMetadata on Base and ListRecords on mainnet
const SHARED_ADDRESS = '0x5289fE5daBC021D02FDDf23d4a4DF96F4E0F17EF' as `0x${string}`;
const REGISTRY_ADDRESS = '0x0E688f5DCa4a0a4729946ACbC44C792341714e08' as `0x${string}`;
const LIST_RECORDS_BASE = '0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33' as `0x${string}`;

function makeConfig(overrides: Partial<ChainConfig> = {}): ChainConfig {
  return {
    chainId: 8453,
    name: 'base',
    addresses: [REGISTRY_ADDRESS, SHARED_ADDRESS, LIST_RECORDS_BASE],
    events: [],
    startBlock: BigInt(20180000),
    listRecordsAddress: LIST_RECORDS_BASE,
    pollInterval: 4000,
    idlePollInterval: 10000,
    ...overrides,
  };
}

function makeLog(overrides: Partial<DecodedLog>): DecodedLog {
  return {
    address: REGISTRY_ADDRESS,
    blockNumber: BigInt(100),
    logIndex: 0,
    transactionIndex: 0,
    blockHash: '0xblockhash',
    transactionHash: '0xtxhash',
    data: '0x',
    topics: [],
    removed: false,
    transactionLogIndex: 0,
    ...overrides,
  } as unknown as DecodedLog;
}

function makeClient(): PublicClient {
  return {
    getLogs: vi.fn(),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      timestamp: BigInt(1700000000),
    })),
  } as unknown as PublicClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearTimestampCaches();
});

describe('processChainLogs dispatch', () => {
  it('processes logs in (blockNumber, logIndex) order — Transfer before UpdateListStorageLocation', async () => {
    const config = makeConfig();
    // Deliberately out of order: LSL has a higher logIndex in the same block
    const logs = [
      makeLog({
        eventName: 'UpdateListStorageLocation',
        logIndex: 2,
        args: { tokenId: BigInt(1), listStorageLocation: '0xdeadbeef' },
      }),
      makeLog({
        eventName: 'Transfer',
        logIndex: 1,
        args: { from: '0x0', to: '0xabc', tokenId: BigInt(1) },
      }),
    ];

    await processChainLogs(config, makeClient(), logs);

    expect(handleTransfer).toHaveBeenCalledTimes(1);
    expect(handleUpdateListStorageLocation).toHaveBeenCalledTimes(1);
    const transferOrder = vi.mocked(handleTransfer).mock.invocationCallOrder[0];
    const lslOrder = vi.mocked(handleUpdateListStorageLocation).mock.invocationCallOrder[0];
    expect(transferOrder).toBeLessThan(lslOrder);
  });

  it('orders across blocks even when input is reversed', async () => {
    const config = makeConfig();
    const logs = [
      makeLog({
        eventName: 'Transfer',
        blockNumber: BigInt(200),
        args: { from: '0x0', to: '0xlater', tokenId: BigInt(2) },
      }),
      makeLog({
        eventName: 'Transfer',
        blockNumber: BigInt(100),
        args: { from: '0x0', to: '0xearlier', tokenId: BigInt(1) },
      }),
    ];

    await processChainLogs(config, makeClient(), logs);

    const calls = vi.mocked(handleTransfer).mock.calls;
    expect(calls[0][1].to).toBe('0xearlier');
    expect(calls[1][1].to).toBe('0xlater');
  });

  it('routes events by per-chain address: UpdateAccountMetadata on Base for the address shared with mainnet ListRecords', async () => {
    const config = makeConfig();
    const logs = [
      makeLog({
        eventName: 'UpdateAccountMetadata',
        address: SHARED_ADDRESS,
        args: { addr: '0xuser', key: 'primary-list', value: '0x01' },
      }),
    ];

    await processChainLogs(config, makeClient(), logs);

    expect(handleUpdateAccountMetadata).toHaveBeenCalledWith(
      expect.anything(),
      { addr: '0xuser', key: 'primary-list', value: '0x01' },
      8453,
      SHARED_ADDRESS
    );
    expect(parseListOpsBatch).not.toHaveBeenCalled();
  });

  it('routes ListOps from the same shared address to the batch path on mainnet', async () => {
    const config = makeConfig({
      chainId: 1,
      name: 'ethereum',
      addresses: [SHARED_ADDRESS],
      listRecordsAddress: SHARED_ADDRESS,
    });
    const op = ('0x01010101' + '22'.repeat(20)) as `0x${string}`;
    const logs = [
      makeLog({
        eventName: 'ListOp',
        address: SHARED_ADDRESS,
        args: { slot: BigInt(5), op },
      }),
    ];

    await processChainLogs(config, makeClient(), logs);

    expect(parseListOpsBatch).toHaveBeenCalledWith(
      [{ slot: '0x' + '5'.padStart(64, '0'), op }],
      1,
      SHARED_ADDRESS
    );
    expect(handleUpdateAccountMetadata).not.toHaveBeenCalled();
  });

  it('dedupes getBlock calls for ListOps in the same block and inserts before deleting', async () => {
    const config = makeConfig();
    const client = makeClient();
    const op = ('0x01010101' + '33'.repeat(20)) as `0x${string}`;
    const logs = [
      makeLog({ eventName: 'ListOp', address: LIST_RECORDS_BASE, blockNumber: BigInt(50), logIndex: 0, args: { slot: BigInt(1), op } }),
      makeLog({ eventName: 'ListOp', address: LIST_RECORDS_BASE, blockNumber: BigInt(50), logIndex: 1, args: { slot: BigInt(2), op } }),
    ];

    await processChainLogs(config, client, logs);

    expect(client.getBlock).toHaveBeenCalledTimes(1);
    const events = vi.mocked(batchInsertEvents).mock.calls[0][0];
    expect(events).toHaveLength(2);
    expect(events[0].blockTimestamp).toEqual(new Date(1700000000 * 1000));
    expect(events[0].targetAddress).toBe('0x' + '33'.repeat(20));

    const insertOrder = vi.mocked(batchInsertRecords).mock.invocationCallOrder[0];
    const deleteOrder = vi.mocked(batchDeleteRecords).mock.invocationCallOrder[0];
    expect(insertOrder).toBeLessThan(deleteOrder);
  });

  it('skips ListOps from unexpected addresses', async () => {
    const config = makeConfig();
    const logs = [
      makeLog({
        eventName: 'ListOp',
        address: REGISTRY_ADDRESS,
        args: { slot: BigInt(1), op: '0x01010101' },
      }),
    ];

    await processChainLogs(config, makeClient(), logs);

    expect(parseListOpsBatch).not.toHaveBeenCalled();
  });

  it('skips undecodable logs without throwing', async () => {
    const config = makeConfig();
    const logs = [
      makeLog({ eventName: undefined, args: undefined }),
      makeLog({
        eventName: 'Transfer',
        args: { from: '0x0', to: '0xabc', tokenId: BigInt(1) },
      }),
    ];

    await processChainLogs(config, makeClient(), logs);

    expect(handleTransfer).toHaveBeenCalledTimes(1);
  });

  it('converts UpdateListMetadata slot from bigint to padded hex', async () => {
    const config = makeConfig();
    const logs = [
      makeLog({
        eventName: 'UpdateListMetadata',
        address: LIST_RECORDS_BASE,
        args: { slot: BigInt(1), key: 'user', value: '0xabc' },
      }),
    ];

    await processChainLogs(config, makeClient(), logs);

    expect(handleUpdateListMetadata).toHaveBeenCalledWith(
      expect.anything(),
      { slot: '0x' + '1'.padStart(64, '0'), key: 'user', value: '0xabc' },
      8453,
      LIST_RECORDS_BASE
    );
  });
});

describe('isResponseCapError', () => {
  it('matches known provider response-cap messages', () => {
    expect(isResponseCapError(new Error('query returned more than 10000 results'))).toBe(true);
    expect(isResponseCapError(new Error('Log response size exceeded'))).toBe(true);
    expect(isResponseCapError(new Error('Query timeout: result is too large'))).toBe(true);
    expect(
      isResponseCapError(
        new Error('You can make eth_getLogs requests with up to a 2K block range')
      )
    ).toBe(true);
  });

  it('walks the cause chain', () => {
    const inner = new Error('query returned more than 10000 results');
    const outer = new Error('HTTP request failed', { cause: inner });
    expect(isResponseCapError(outer)).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isResponseCapError(new Error('connection refused'))).toBe(false);
    expect(isResponseCapError('not an error')).toBe(false);
  });

  it('rejects generic block-range errors that bisection cannot fix', () => {
    expect(isResponseCapError(new Error('invalid block range'))).toBe(false);
    expect(isResponseCapError(new Error('block range too small'))).toBe(false);
    expect(isResponseCapError(new Error('fromBlock is after toBlock in block range'))).toBe(false);
  });
});

describe('getLogsRange', () => {
  it('bisects the range on response-cap errors', async () => {
    const config = makeConfig();
    const client = makeClient();
    vi.mocked(client.getLogs)
      .mockRejectedValueOnce(new Error('Log response size exceeded'))
      .mockResolvedValue([]);

    const logs = await getLogsRange(client, config, BigInt(100), BigInt(199));

    expect(logs).toEqual([]);
    expect(client.getLogs).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(client.getLogs).mock.calls;
    expect(calls[1][0]).toMatchObject({ fromBlock: BigInt(100), toBlock: BigInt(149) });
    expect(calls[2][0]).toMatchObject({ fromBlock: BigInt(150), toBlock: BigInt(199) });
  });

  it('rethrows non-cap errors', async () => {
    const config = makeConfig();
    const client = makeClient();
    vi.mocked(client.getLogs).mockRejectedValue(new Error('connection refused'));

    await expect(getLogsRange(client, config, BigInt(100), BigInt(199))).rejects.toThrow('connection refused');
    expect(client.getLogs).toHaveBeenCalledTimes(1);
  });

  it('rethrows cap errors on a single-block range instead of recursing forever', async () => {
    const config = makeConfig();
    const client = makeClient();
    vi.mocked(client.getLogs).mockRejectedValue(new Error('Log response size exceeded'));

    await expect(getLogsRange(client, config, BigInt(100), BigInt(100))).rejects.toThrow();
    expect(client.getLogs).toHaveBeenCalledTimes(1);
  });
});

describe('extractTargetAddress', () => {
  it('extracts the 20-byte address from a ListOp', () => {
    const op = '0x01010101' + 'AB'.repeat(20);
    expect(extractTargetAddress(op)).toBe('0x' + 'ab'.repeat(20));
  });

  it('returns empty string for short ops', () => {
    expect(extractTargetAddress('0x0101')).toBe('');
  });
});
