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
