import { Client, type QueryResult, type QueryResultRow } from 'pg';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('db');

/**
 * Thin logging wrapper around `client.query()` — mirrors `@efp/shared` query().
 * Hyperdrive does not provide its own query API; use the pg Client directly.
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
