import { createMiddleware } from 'hono/factory';
import { CACHE_TTL, type Phase } from '@efp/shared-core';
import { query } from '../db/query.js';
import type { AppBindings, AppVariables } from '../types.js';

const PHASE_CACHE_KEY = 'efp:system:phase';
const PHASE_CACHE_TTL_SEC = 10;

async function getPhaseFromDb(client: Parameters<typeof query>[0]): Promise<Phase> {
  const result = await query<{ value: string }>(
    client,
    `SELECT value FROM efp_system_state WHERE key = 'phase'`
  );
  return (result.rows[0]?.value as Phase) || 'historical';
}

async function getCachedPhase(kv: KVNamespace, client: Parameters<typeof query>[0]): Promise<Phase> {
  const cached = await kv.get(PHASE_CACHE_KEY);
  if (cached) {
    return cached as Phase;
  }

  const phase = await getPhaseFromDb(client);
  await kv.put(PHASE_CACHE_KEY, phase, { expirationTtl: PHASE_CACHE_TTL_SEC });
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
      phase = await getCachedPhase(c.env.PHASE_CACHE, c.get('db'));
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

export { CACHE_TTL };
