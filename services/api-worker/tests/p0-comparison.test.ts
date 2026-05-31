/**
 * P0 endpoint response-shape comparison against production API.
 *
 * Run against a deployed/local Worker:
 *   WORKER_API_URL=http://localhost:8787/api/v1 npm run test:p0 -w @efp/api-worker
 *
 * Run against production for baseline documentation:
 *   WORKER_API_URL=https://api.ethfollow.xyz/api/v1 npm run test:p0 -w @efp/api-worker
 */

import { describe, it, expect } from 'vitest';

const PRODUCTION_API = 'https://api.ethfollow.xyz/api/v1';
const WORKER_API = process.env.WORKER_API_URL || 'http://localhost:8787/api/v1';
const TEST_ENS = 'vitalik.eth';
const COMPARE_TO_PRODUCTION = process.env.COMPARE_TO_PRODUCTION === 'true';

async function fetchJson(base: string, path: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) {
    throw new Error(`${base}${path} returned ${response.status}`);
  }
  return response.json();
}

function shapeKeys(obj: unknown): string[] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.keys(obj).sort();
  }
  return [];
}

describe.skipIf(!process.env.WORKER_API_URL)('P0 Worker endpoints', () => {
  it('GET /users/:ens/account matches production top-level shape', async () => {
    const worker = (await fetchJson(WORKER_API, `/users/${TEST_ENS}/account`)) as Record<string, unknown>;
    expect(worker).toMatchObject({
      address: expect.any(String),
    });
    expect(shapeKeys(worker)).toEqual(expect.arrayContaining(['address']));

    if (COMPARE_TO_PRODUCTION) {
      const prod = (await fetchJson(PRODUCTION_API, `/users/${TEST_ENS}/account`)) as Record<string, unknown>;
      expect(shapeKeys(worker)).toEqual(shapeKeys(prod));
      if (worker.ens && prod.ens) {
        expect(shapeKeys(worker.ens)).toEqual(shapeKeys(prod.ens as object));
      }
    }
  });

  it('GET /users/:ens/details matches production top-level shape', async () => {
    const worker = (await fetchJson(WORKER_API, `/users/${TEST_ENS}/details`)) as Record<string, unknown>;
    expect(worker).toMatchObject({
      address: expect.any(String),
      ranks: expect.any(Object),
      primary_list: expect.anything(),
    });

    if (COMPARE_TO_PRODUCTION) {
      const prod = (await fetchJson(PRODUCTION_API, `/users/${TEST_ENS}/details`)) as Record<string, unknown>;
      expect(shapeKeys(worker)).toEqual(shapeKeys(prod));
    }
  });

  it('GET /users/:ens/stats matches production shape', async () => {
    const worker = (await fetchJson(WORKER_API, `/users/${TEST_ENS}/stats`)) as Record<string, unknown>;
    expect(worker).toMatchObject({
      followers_count: expect.any(Number),
      following_count: expect.any(Number),
    });

    if (COMPARE_TO_PRODUCTION) {
      const prod = (await fetchJson(PRODUCTION_API, `/users/${TEST_ENS}/stats`)) as Record<string, unknown>;
      expect(worker.followers_count).toBe(prod.followers_count);
      expect(worker.following_count).toBe(prod.following_count);
    }
  });
});

describe('P0 schema expectations (offline)', () => {
  it('documents required account response fields', () => {
    const required = ['address'];
    expect(required).toContain('address');
  });

  it('documents required details response fields', () => {
    const required = ['address', 'followers_count', 'following_count', 'ranks', 'primary_list'];
    expect(required.length).toBe(5);
  });

  it('documents required stats response fields', () => {
    const required = ['followers_count', 'following_count'];
    expect(required).toEqual(['followers_count', 'following_count']);
  });
});
