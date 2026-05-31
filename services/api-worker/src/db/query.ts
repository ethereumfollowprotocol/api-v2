import { Client, type QueryResult, type QueryResultRow } from 'pg';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('db');

/**
 * Per-request query helper. The Client is created once per HTTP request
 * by dbMiddleware and stored on Hono context — never as module-global state.
 */
export async function query<T extends QueryResultRow>(
  client: Client,
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await client.query<T>(text, params);
  logger.debug(
    { query: text.substring(0, 100), duration: Date.now() - start, rows: result.rowCount },
    'Query executed'
  );
  return result;
}

export async function connectClient(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

export async function disconnectClient(client: Client): Promise<void> {
  await client.end();
}

/**
 * Hyperdrive spike queries — validates SQL features used by the API.
 */
export const SPIKE_QUERIES = {
  parameterized: {
    sql: `SELECT followers_count, following_count FROM efp_user_stats WHERE address = $1 LIMIT 1`,
    params: (address: string) => [address],
  },
  anyArray: {
    sql: `SELECT address, name FROM ens_metadata WHERE address = ANY($1) LIMIT 5`,
    params: (addresses: string[]) => [addresses],
  },
  convertHexToBigInt: {
    sql: `
      SELECT l.token_id::TEXT
      FROM efp_account_metadata am
      JOIN efp_lists l ON l.token_id = convert_hex_to_bigint(am.value)
      WHERE am.address = $1 AND am.key = 'primary-list'
      LIMIT 1
    `,
    params: (address: string) => [address],
  },
} as const;
