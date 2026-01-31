export {
  getPool,
  closePool,
  query,
  getClient,
  ensureSchema,
  type Pool,
  type PoolClient,
  type QueryResult,
} from './postgres.js';

export {
  getRedis,
  closeRedis,
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern,
  type Redis,
} from './redis.js';

export {
  getElasticsearch,
  closeElasticsearch,
  ensureUsersIndex,
  ES_INDICES,
  type Client,
} from './elasticsearch.js';
