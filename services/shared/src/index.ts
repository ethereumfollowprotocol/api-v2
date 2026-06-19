// Config
export { env, getEnv, CONTRACTS, CACHE_TTL, type Env } from './config/index.js';

// Database clients
export {
  getPool,
  closePool,
  query,
  getClient,
  ensureSchema,
  getRedis,
  closeRedis,
  getCache,
  setCache,
  setCacheNX,
  deleteCache,
  deleteCachePattern,
} from './db/index.js';

// Logger
export { logger, createLogger } from './logger.js';

// ENS contenthash
export { decodeContentHash, contenthashAbi } from './contenthash.js';

// Phase management
export {
  getSystemState,
  getPhase,
  setPhase,
  isIndexerCaughtUp,
  isMigrationComplete,
  setMigrationComplete,
  isSchemaMigrationsComplete,
  setSchemaMigrationsComplete,
  resetDataMigrations,
  waitForIndexerCatchUp,
  waitForMigrationComplete,
  type Phase,
  type SystemState,
} from './phase.js';

// Types
export {
  addressSchema,
  ensProfileSchema,
  convertHexToBigInt,
  toStringOrNull,
  type Address,
  type ENSProfile,
  type UserStats,
  type UserRanks,
  type AccountResponse,
  type DetailsResponse,
  type StatsResponse,
  type FollowerEntry,
  type FollowingEntry,
  type FollowersResponse,
  type FollowingResponse,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type ErrorResponse,
  type PaginationParams,
  type FollowersQueryParams,
  type LeaderboardQueryParams,
} from './types/index.js';
