import { describe, it, expect } from 'vitest';
import { connectClient, disconnectClient } from '../src/db/client.js';
import { query } from '../src/db/query.js';
import { SPIKE_QUERIES } from '../src/db/spike-queries.js';

const TEST_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const RUN_LIVE = process.env.RUN_HYPERDRIVE_SPIKE === 'true';
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!RUN_LIVE || !DATABASE_URL)('Hyperdrive spike (live Postgres)', () => {
  it('runs parameterized, ANY($1), and convert_hex_to_bigint queries', async () => {
    const client = await connectClient(DATABASE_URL!);

    try {
      const parameterized = await query(client, SPIKE_QUERIES.parameterized.sql, [
        TEST_ADDRESS,
      ]);
      expect(parameterized.rowCount).toBeGreaterThanOrEqual(0);

      const anyArray = await query(client, SPIKE_QUERIES.anyArray.sql, [[TEST_ADDRESS]]);
      expect(anyArray.rowCount).toBeGreaterThanOrEqual(0);

      const hexConvert = await query<{ token_id: string }>(
        client,
        SPIKE_QUERIES.convertHexToBigInt.sql,
        [TEST_ADDRESS]
      );
      expect(hexConvert.rowCount).toBeGreaterThanOrEqual(0);
    } finally {
      await disconnectClient(client);
    }
  });
});

describe('Hyperdrive spike (SQL definitions)', () => {
  it('defines all three spike query shapes', () => {
    expect(SPIKE_QUERIES.parameterized.sql).toContain('$1');
    expect(SPIKE_QUERIES.anyArray.sql).toContain('ANY($1)');
    expect(SPIKE_QUERIES.convertHexToBigInt.sql).toContain('convert_hex_to_bigint');
  });
});
