import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { env } from '../config/index.js';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected PostgreSQL pool error');
  });

  pool.on('connect', () => {
    logger.debug('New PostgreSQL connection established');
  });

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const result = await getPool().query<T>(text, params);
  const duration = Date.now() - start;

  logger.debug({ query: text.substring(0, 100), duration, rows: result.rowCount }, 'Query executed');

  return result;
}

export async function getClient(): Promise<pg.PoolClient> {
  return getPool().connect();
}

export type { Pool, PoolClient, QueryResult } from 'pg';

export async function ensureSchema(): Promise<void> {
  const schemaPath = resolve(__dirname, 'schema.sql');
  logger.info({ schemaPath }, 'Loading database schema');

  try {
    const schemaSql = readFileSync(schemaPath, 'utf-8');
    const client = await getClient();

    try {
      await client.query(schemaSql);
      logger.info('Database schema ensured');
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to ensure database schema');
    throw err;
  }
}
