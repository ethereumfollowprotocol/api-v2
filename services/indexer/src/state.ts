import { query } from '@efp/shared';

// One cursor per (chain, contract) row. All of a chain's rows are advanced in
// lockstep; MIN keeps a safe fromBlock if rows are ever skewed (e.g. first
// deploy over a DB written by the old per-contract indexer).
export async function getChainCursor(
  chainId: number,
  addresses: `0x${string}`[]
): Promise<bigint> {
  const result = await query<{ last_block: string | null }>(
    `SELECT MIN(last_block) AS last_block FROM indexer_state
     WHERE chain_id = $1 AND contract_address = ANY($2)`,
    [chainId, addresses.map((a) => a.toLowerCase())]
  );
  const lastBlock = result.rows[0]?.last_block;
  return lastBlock != null ? BigInt(lastBlock) : BigInt(0);
}

export async function setChainCursor(
  chainId: number,
  addresses: `0x${string}`[],
  lastBlock: bigint
): Promise<void> {
  await query(
    `INSERT INTO indexer_state (chain_id, contract_address, last_block, updated_at)
     SELECT $1, unnest($2::text[]), $3, NOW()
     ON CONFLICT (chain_id, contract_address) DO UPDATE SET
       last_block = EXCLUDED.last_block, updated_at = NOW()`,
    [chainId, addresses.map((a) => a.toLowerCase()), lastBlock.toString()]
  );
}

export async function ensureIndexerStateTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS indexer_state (
      chain_id BIGINT NOT NULL,
      contract_address VARCHAR(42) NOT NULL,
      last_block BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chain_id, contract_address)
    )
  `);
}

export async function setIndexerCaughtUp(caughtUp: boolean): Promise<void> {
  await query(
    `UPDATE efp_system_state SET value = $1, updated_at = NOW() WHERE key = 'indexer_caught_up'`,
    [caughtUp.toString()]
  );
}
