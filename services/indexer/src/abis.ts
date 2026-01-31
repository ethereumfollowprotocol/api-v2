// EFP Contract ABIs

export const ListRegistryABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: true, name: 'tokenId', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'UpdateListStorageLocation',
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'listStorageLocation', type: 'bytes' },
    ],
  },
  {
    type: 'event',
    name: 'UpdateUser',
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: true, name: 'user', type: 'address' },
    ],
  },
  {
    type: 'event',
    name: 'UpdateManager',
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: true, name: 'manager', type: 'address' },
    ],
  },
] as const;

export const AccountMetadataABI = [
  {
    type: 'event',
    name: 'UpdateAccountMetadata',
    inputs: [
      { indexed: true, name: 'addr', type: 'address' },
      { indexed: false, name: 'key', type: 'string' },
      { indexed: false, name: 'value', type: 'string' },
    ],
  },
] as const;

export const ListRecordsABI = [
  {
    type: 'event',
    name: 'ListOp',
    inputs: [
      { indexed: true, name: 'slot', type: 'bytes32' },
      { indexed: false, name: 'op', type: 'bytes' },
    ],
  },
] as const;
