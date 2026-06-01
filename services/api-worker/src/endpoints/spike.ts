import { contentJson, OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types.js';
import { ensureDb } from '../middleware/db.js';
import { isSpikeAuthorized, isSpikeEndpointEnabled } from '../middleware/spike-auth.js';
import { query } from '../db/query.js';
import { SPIKE_QUERIES } from '../db/spike-queries.js';

const TEST_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

/**
 * Hyperdrive spike — validates SQL features used by the API.
 * Off unless SPIKE_ENDPOINT_ENABLED=true; then requires SPIKE_SECRET, SPIKE_ALLOWED_IPS, or CF Access.
 */
export class HyperdriveSpike extends OpenAPIRoute {
  schema = {
    tags: ['Spike'],
    summary: 'Hyperdrive SQL compatibility spike',
    request: {
      query: z.object({
        spike_key: z.string().optional().describe('Must match SPIKE_SECRET binding'),
      }),
    },
    responses: {
      '404': {
        description: 'Spike endpoint disabled (SPIKE_ENDPOINT_ENABLED is not true)',
      },
      '403': {
        description: 'Missing or invalid spike credentials',
        ...contentJson(z.object({ error: z.string() })),
      },
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
    if (!isSpikeEndpointEnabled(c.env)) {
      return c.notFound();
    }
    if (!isSpikeAuthorized(c.req.raw, c.env)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const client = await ensureDb(c);
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
