import { describe, it, expect } from 'vitest';

// Keep in sync with src/middleware/phase.ts — Cloudflare KV rejects expirationTtl below 60.
const KV_MIN_EXPIRATION_TTL_SEC = 60;

describe('Phase KV cache TTL', () => {
  it('uses at least the Cloudflare KV minimum expirationTtl', async () => {
    const { PHASE_CACHE_TTL_SEC } = await import('../src/middleware/phase.js');
    expect(PHASE_CACHE_TTL_SEC).toBeGreaterThanOrEqual(KV_MIN_EXPIRATION_TTL_SEC);
  });
});
