import { contentJson, OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types.js';
import { query, SPIKE_QUERIES } from '../db/query.js';

const TEST_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

/**
 * Hyperdrive spike endpoint — validates parameterized queries, ANY($1), and convert_hex_to_bigint.
 * Bypasses phase middleware. Remove or protect before production cutover.
 */
export class HyperdriveSpike extends OpenAPIRoute {
  schema = {
    tags: ['Spike'],
    summary: 'Hyperdrive SQL compatibility spike',
    responses: {
      '200': {
        description: 'Spike results',
        ...contentJson(
          z.object({
            parameterized: z.object({ ok: z.boolean(), rowCount: z.number().optional() }),
            anyArray: z.object({ ok: z.boolean(), rowCount: z.number().optional() }),
            convertHexToBigInt: z.object({
              ok: z.boolean(),
              tokenId: z.string().nullable().optional(),
            }),
          })
        ),
      },
    },
  };

  async handle(c: AppContext) {
    const client = c.get('db');
    const results: Record<string, { ok: boolean; rowCount?: number; tokenId?: string | null }> = {};

    for (const [name, spec] of Object.entries(SPIKE_QUERIES)) {
      try {
        const params =
          name === 'anyArray'
            ? spec.params([TEST_ADDRESS])
            : spec.params(TEST_ADDRESS);
        const result = await query<{ token_id?: string }>(client, spec.sql, params);
        results[name] = {
          ok: true,
          rowCount: result.rowCount ?? 0,
          ...(name === 'convertHexToBigInt'
            ? { tokenId: (result.rows[0] as { token_id?: string })?.token_id ?? null }
            : {}),
        };
      } catch (err) {
        results[name] = { ok: false };
        console.error(JSON.stringify({ message: 'spike query failed', name, error: String(err) }));
      }
    }

    return c.json(results);
  }
}
