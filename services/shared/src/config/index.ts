export { env, getEnv, type Env } from './env.js';

// Contract addresses
export const CONTRACTS = {
  ListRegistry: {
    chainId: 8453,
    address: '0x0E688f5DCa4a0a4729946ACbC44C792341714e08',
  },
  AccountMetadata: {
    chainId: 8453,
    address: '0x5289fE5daBC021D02FDDf23d4a4DF96F4E0F17EF',
  },
  ListRecords: {
    base: {
      chainId: 8453,
      address: '0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33',
    },
    optimism: {
      chainId: 10,
      address: '0x4Ca00413d850DcFa3516E14d21DAE2772F2aCb85',
    },
    ethereum: {
      chainId: 1,
      address: '0x5289fE5daBC021D02FDDf23d4a4DF96F4E0F17EF',
    },
  },
  ListMinter: {
    chainId: 8453,
    address: '0xDb17Bfc64aBf7B7F080a49f0Bbbf799dDbb48Ce5',
  },
} as const;

// Cache TTLs in seconds
export const CACHE_TTL = {
  account: 60,
  details: 60,
  stats: 30,
  followers: 30,
  following: 30,
  mutuals: 60,
  leaderboard: 300,
  globalStats: 300,
  discover: 30,
  recommended: 300,
  tags: 60,
  search: 30,
} as const;
