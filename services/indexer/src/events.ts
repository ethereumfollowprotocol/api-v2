import type { AbiEvent } from 'viem';
import { CONTRACTS, env } from '@efp/shared';

export const transferEvent: AbiEvent = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true, name: 'from', type: 'address' },
    { indexed: true, name: 'to', type: 'address' },
    { indexed: true, name: 'tokenId', type: 'uint256' },
  ],
};

export const updateListStorageLocationEvent: AbiEvent = {
  type: 'event',
  name: 'UpdateListStorageLocation',
  inputs: [
    { indexed: true, name: 'tokenId', type: 'uint256' },
    { indexed: false, name: 'listStorageLocation', type: 'bytes' },
  ],
};

export const updateAccountMetadataEvent: AbiEvent = {
  type: 'event',
  name: 'UpdateAccountMetadata',
  inputs: [
    { indexed: true, name: 'addr', type: 'address' },
    { indexed: false, name: 'key', type: 'string' },
    { indexed: false, name: 'value', type: 'bytes' },
  ],
};

export const listOpEvent: AbiEvent = {
  type: 'event',
  name: 'ListOp',
  inputs: [
    { indexed: true, name: 'slot', type: 'uint256' },
    { indexed: false, name: 'op', type: 'bytes' },
  ],
};

export const updateListMetadataEvent: AbiEvent = {
  type: 'event',
  name: 'UpdateListMetadata',
  inputs: [
    { indexed: true, name: 'slot', type: 'uint256' },
    { indexed: false, name: 'key', type: 'string' },
    { indexed: false, name: 'value', type: 'bytes' },
  ],
};

export interface ChainConfig {
  chainId: number;
  name: string;
  // All contracts watched on this chain, fetched in a single getLogs call
  addresses: `0x${string}`[];
  events: AbiEvent[];
  startBlock: bigint;
  // ListOp events from this address take the batch-processing path
  listRecordsAddress: `0x${string}`;
  pollInterval: number;
  idlePollInterval: number;
}

export const CHAIN_CONFIGS: ChainConfig[] = [
  {
    chainId: 8453,
    name: 'base',
    addresses: [
      CONTRACTS.ListRegistry.address as `0x${string}`,
      CONTRACTS.AccountMetadata.address as `0x${string}`,
      CONTRACTS.ListRecords.base.address as `0x${string}`,
    ],
    events: [
      transferEvent,
      updateListStorageLocationEvent,
      updateAccountMetadataEvent,
      listOpEvent,
      updateListMetadataEvent,
    ],
    startBlock: BigInt(20180000),
    listRecordsAddress: CONTRACTS.ListRecords.base.address as `0x${string}`,
    pollInterval: env.INDEXER_POLL_INTERVAL_BASE,
    idlePollInterval: env.INDEXER_IDLE_POLL_INTERVAL_BASE,
  },
  {
    chainId: 10,
    name: 'optimism',
    addresses: [CONTRACTS.ListRecords.optimism.address as `0x${string}`],
    events: [listOpEvent, updateListMetadataEvent],
    startBlock: BigInt(125792000),
    listRecordsAddress: CONTRACTS.ListRecords.optimism.address as `0x${string}`,
    pollInterval: env.INDEXER_POLL_INTERVAL_OP,
    idlePollInterval: env.INDEXER_IDLE_POLL_INTERVAL_OP,
  },
  {
    chainId: 1,
    name: 'ethereum',
    addresses: [CONTRACTS.ListRecords.ethereum.address as `0x${string}`],
    events: [listOpEvent, updateListMetadataEvent],
    startBlock: BigInt(20820000),
    listRecordsAddress: CONTRACTS.ListRecords.ethereum.address as `0x${string}`,
    pollInterval: env.INDEXER_POLL_INTERVAL_ETH,
    idlePollInterval: env.INDEXER_IDLE_POLL_INTERVAL_ETH,
  },
];
