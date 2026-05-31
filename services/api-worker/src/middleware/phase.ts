import { createMiddleware } from 'hono/factory';
import { CACHE_TTL, type Phase } from '@efp/shared-core';
import { query } from '../db/query.js';
import { ensureDb } from './db.js';
import type { AppBindings, AppVariables } from '../types.js';

const PHASE_CACHE_KEY = 'efp:system:phase';
// Cloudflare KV minimum expirationTtl is 60 seconds.
const PHASE_CACHE_TTL_SEC = 60;

async function getPhaseFromDb(client: Parameters<typeof query>[0]): Promise<Phase> {
  const result = await query<{ value: string }>(
    client,
    `SELECT value FROM efp_system_state WHERE key = 'phase'`
  );
  return (result.rows[0]?.value as Phase) || 'historical';
}

async function getCachedPhase(
  kv: KVNamespace,
  loadPhaseFromDb: () => Promise<Phase>
): Promise<Phase> {
  const cached = await kv.get(PHASE_CACHE_KEY);
  if (cached) {
    return cached as Phase;
  }

  const phase = await loadPhaseFromDb();
  try {
    await kv.put(PHASE_CACHE_KEY, phase, { expirationTtl: PHASE_CACHE_TTL_SEC });
  } catch (err) {
    // Cache write failure must not discard a valid phase from the DB.
    console.warn(JSON.stringify({ message: 'phase cache write failed', error: String(err) }));
  }
  return phase;
}

export const phaseMiddleware = createMiddleware<{ Bindings: AppBindings; Variables: AppVariables }>(
  async (c, next) => {
    const url = new URL(c.req.url);
    if (
      url.pathname.startsWith('/health') ||
      url.pathname.startsWith('/api/v1/health') ||
      url.pathname.startsWith('/api/v1/serviceHealth') ||
      url.pathname.startsWith('/api/v1/spike')
    ) {
      return next();
    }

    let phase: Phase;
    try {
      phase = await getCachedPhase(c.env.PHASE_CACHE, async () => {
        const client = await ensureDb(c);
        return getPhaseFromDb(client);
      });
    } catch {
      phase = 'historical';
    }

    c.header('X-EFP-Phase', phase);

    if (c.env.SERVE_DURING_SYNC === 'true') {
      return next();
    }

    if (phase !== 'listening') {
      return c.json(
        {
          error: 'Service initializing',
          phase,
          message: 'System is syncing blockchain data. Please retry shortly.',
        },
        503,
        { 'Retry-After': '60' }
      );
    }

    return next();
  }
);

export { CACHE_TTL, PHASE_CACHE_TTL_SEC };
