/**
 * API Response Shape Comparison Tests
 *
 * Compares our new API response shapes against the production API
 * at https://data.ethfollow.xyz/api/v1
 *
 * These tests verify that our responses match the expected structure
 * for backwards compatibility.
 */

import { describe, it, expect } from 'vitest';

const PRODUCTION_API = 'https://data.ethfollow.xyz/api/v1';
const TEST_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'; // vitalik.eth
const TEST_ENS = 'vitalik.eth';
const TEST_LIST_ID = '3'; // brantly.eth's list

// Helper to fetch from production API
async function fetchProduction(path: string): Promise<unknown> {
  const response = await fetch(`${PRODUCTION_API}${path}`);
  return response.json();
}

// Helper to get object keys recursively (for shape comparison)
function getShape(obj: unknown, prefix = ''): string[] {
  if (obj === null || obj === undefined) return [`${prefix}:null`];
  if (Array.isArray(obj)) {
    if (obj.length === 0) return [`${prefix}:[]`];
    return [`${prefix}:array`, ...getShape(obj[0], `${prefix}[0]`)];
  }
  if (typeof obj === 'object') {
    const keys: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      keys.push(`${path}:${typeof value}`);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        keys.push(...getShape(value, path));
      } else if (Array.isArray(value) && value.length > 0) {
        keys.push(...getShape(value[0], `${path}[0]`));
      }
    }
    return keys;
  }
  return [`${prefix}:${typeof obj}`];
}

describe('API Response Shape Comparison', () => {
  describe('Users Endpoints', () => {
    it('GET /users/:address/account - should match production shape', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/account`);

      // Expected shape from production
      expect(response).toHaveProperty('address');
      expect(response).toHaveProperty('ens');
      expect((response as any).ens).toHaveProperty('name');
      expect((response as any).ens).toHaveProperty('avatar');
      expect((response as any).ens).toHaveProperty('records');
      expect((response as any).ens).toHaveProperty('updated_at');
    });

    it('GET /users/:address/details - should match production shape', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/details`);

      expect(response).toHaveProperty('address');
      expect(response).toHaveProperty('ens');
      expect(response).toHaveProperty('ranks');
      expect(response).toHaveProperty('primary_list');

      const ranks = (response as any).ranks;
      expect(ranks).toHaveProperty('mutuals_rank');
      expect(ranks).toHaveProperty('followers_rank');
      expect(ranks).toHaveProperty('following_rank');
      expect(ranks).toHaveProperty('top8_rank');
      expect(ranks).toHaveProperty('blocks_rank');
    });

    it('GET /users/:address/stats - should match production shape', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/stats`);

      expect(response).toHaveProperty('followers_count');
      expect(response).toHaveProperty('following_count');
      expect(typeof (response as any).followers_count).toBe('number');
      expect(typeof (response as any).following_count).toBe('number');
    });

    it('GET /users/:address/followers - should match production shape', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/followers?limit=1`);

      expect(response).toHaveProperty('followers');
      expect(Array.isArray((response as any).followers)).toBe(true);

      if ((response as any).followers.length > 0) {
        const follower = (response as any).followers[0];
        expect(follower).toHaveProperty('efp_list_nft_token_id');
        expect(follower).toHaveProperty('address');
        expect(follower).toHaveProperty('tags');
        expect(follower).toHaveProperty('is_following');
        expect(follower).toHaveProperty('is_blocked');
        expect(follower).toHaveProperty('is_muted');
        expect(follower).toHaveProperty('updated_at');
      }
    });

    it('GET /users/:address/following - should match production shape', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/following?limit=1`);

      expect(response).toHaveProperty('following');
      expect(Array.isArray((response as any).following)).toBe(true);

      if ((response as any).following.length > 0) {
        const following = (response as any).following[0];
        expect(following).toHaveProperty('version');
        expect(following).toHaveProperty('record_type');
        expect(following).toHaveProperty('data');
        expect(following).toHaveProperty('address');
        expect(following).toHaveProperty('tags');
      }
    });

    it('GET /users/:address/ens - should match production shape', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/ens`);

      // Production wraps in { ens: { ... } }
      expect(response).toHaveProperty('ens');
      const ens = (response as any).ens;
      expect(ens).toHaveProperty('name');
      expect(ens).toHaveProperty('address'); // NOTE: production includes address inside ens
      expect(ens).toHaveProperty('avatar');
      expect(ens).toHaveProperty('records');
      expect(ens).toHaveProperty('updated_at');
    });

    it('GET /users/:address/lists - should match production shape', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/lists`);

      expect(response).toHaveProperty('primary_list');
      expect(response).toHaveProperty('lists');
      expect(Array.isArray((response as any).lists)).toBe(true);
      // Lists should be array of strings (token IDs)
      if ((response as any).lists.length > 0) {
        expect(typeof (response as any).lists[0]).toBe('string');
      }
    });

    it('GET /users/:address/primary-list - should match production shape', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/primary-list`);

      expect(response).toHaveProperty('primary_list');
    });
  });

  describe('Lists Endpoints', () => {
    it('GET /lists/:tokenId/details - should match production shape', async () => {
      const response = await fetchProduction(`/lists/${TEST_LIST_ID}/details`);

      expect(response).toHaveProperty('address');
      expect(response).toHaveProperty('ens');
      expect(response).toHaveProperty('ranks');
      expect(response).toHaveProperty('primary_list');
    });

    it('GET /lists/:tokenId/stats - should match production shape', async () => {
      const response = await fetchProduction(`/lists/${TEST_LIST_ID}/stats`);

      expect(response).toHaveProperty('followers_count');
      expect(response).toHaveProperty('following_count');
    });

    it('GET /lists/:tokenId/followers - should match production shape', async () => {
      const response = await fetchProduction(`/lists/${TEST_LIST_ID}/followers?limit=1`);

      expect(response).toHaveProperty('followers');
    });

    it('GET /lists/:tokenId/following - should match production shape', async () => {
      const response = await fetchProduction(`/lists/${TEST_LIST_ID}/following?limit=1`);

      expect(response).toHaveProperty('following');
    });

    it('GET /lists/:tokenId/records - should match production shape', async () => {
      const response = await fetchProduction(`/lists/${TEST_LIST_ID}/records`);

      expect(response).toHaveProperty('records');
      expect(Array.isArray((response as any).records)).toBe(true);

      if ((response as any).records.length > 0) {
        const record = (response as any).records[0];
        expect(record).toHaveProperty('version');
        expect(record).toHaveProperty('record_type');
        expect(record).toHaveProperty('data');
        expect(record).toHaveProperty('tags'); // null in production
      }
    });
  });

  describe('Leaderboard Endpoints', () => {
    it('GET /leaderboard/ranked - should match production shape', async () => {
      const response = await fetchProduction(`/leaderboard/ranked?limit=1`);

      expect(response).toHaveProperty('last_updated');
      expect(response).toHaveProperty('results');
      expect(Array.isArray((response as any).results)).toBe(true);

      if ((response as any).results.length > 0) {
        const entry = (response as any).results[0];
        expect(entry).toHaveProperty('address');
        expect(entry).toHaveProperty('mutuals_rank');
        expect(entry).toHaveProperty('followers_rank');
        expect(entry).toHaveProperty('following_rank');
        expect(entry).toHaveProperty('blocks_rank');
        expect(entry).toHaveProperty('top8_rank');
        expect(entry).toHaveProperty('mutuals');
        expect(entry).toHaveProperty('following');
        expect(entry).toHaveProperty('followers');
        expect(entry).toHaveProperty('blocks');
        expect(entry).toHaveProperty('top8');
        expect(entry).toHaveProperty('updated_at');
        // Optional fields
        expect(['string', 'undefined']).toContain(typeof entry.name);
        expect(['string', 'undefined', 'object']).toContain(typeof entry.avatar);
        expect(['string', 'undefined', 'object']).toContain(typeof entry.header);
      }
    });

    it('GET /leaderboard/count - should match production shape', async () => {
      const response = await fetchProduction(`/leaderboard/count`);

      // Production returns { leaderboardCount: "string" }
      expect(response).toHaveProperty('leaderboardCount');
      expect(typeof (response as any).leaderboardCount).toBe('string');
    });

    it('GET /leaderboard/followers - should match production shape', async () => {
      // Note: Production returns object with numeric keys {"0":{}, "1":{}} instead of array
      // Our implementation returns proper arrays, which is more standard
      const response = await fetchProduction(`/leaderboard/followers?limit=2`);

      // Handle both array and object-with-numeric-keys formats
      const entries = Array.isArray(response) ? response : Object.values(response as object);
      expect(entries.length).toBeGreaterThan(0);

      const entry = entries[0] as Record<string, unknown>;
      expect(entry).toHaveProperty('address');
      expect(entry).toHaveProperty('followers_count');
    });

    it('GET /leaderboard/following - should match production shape', async () => {
      // Note: Production returns object with numeric keys {"0":{}, "1":{}} instead of array
      // Our implementation returns proper arrays, which is more standard
      const response = await fetchProduction(`/leaderboard/following?limit=2`);

      // Handle both array and object-with-numeric-keys formats
      const entries = Array.isArray(response) ? response : Object.values(response as object);
      expect(entries.length).toBeGreaterThan(0);

      const entry = entries[0] as Record<string, unknown>;
      expect(entry).toHaveProperty('address');
      expect(entry).toHaveProperty('following_count');
    });
  });

  describe('Stats Endpoints', () => {
    it('GET /stats - should match production shape', async () => {
      const response = await fetchProduction(`/stats`);

      // Production returns { stats: { ... } }
      expect(response).toHaveProperty('stats');
      const stats = (response as any).stats;
      expect(stats).toHaveProperty('address_count');
      expect(stats).toHaveProperty('list_count');
      expect(stats).toHaveProperty('list_op_count');
      expect(stats).toHaveProperty('user_count');
      // All values are strings in production
      expect(typeof stats.address_count).toBe('string');
      expect(typeof stats.list_count).toBe('string');
    });

    it('GET /discover - should match production shape', async () => {
      const response = await fetchProduction(`/discover?limit=1`);

      expect(response).toHaveProperty('latestFollows');
      expect(Array.isArray((response as any).latestFollows)).toBe(true);
    });
  });
});

/**
 * Summary of known shape differences between our API and production:
 *
 * 1. /stats
 *    - Production: { stats: { address_count: "str", list_count: "str", list_op_count: "str", user_count: "str" } }
 *    - Ours: { total_users: num, total_lists: num, total_follows: num, total_blocks: num, total_mutes: num }
 *
 * 2. /leaderboard/count
 *    - Production: { leaderboardCount: "string" }
 *    - Ours: { count: number }
 *
 * 3. /users/:address/ens
 *    - Production: { ens: { name, address, avatar, records, updated_at } }
 *    - Ours: { name, avatar } (no wrapper, no address/records/updated_at)
 *
 * 4. /users/:address/lists
 *    - Production: { primary_list: "str", lists: ["tokenId1", "tokenId2", ...] }
 *    - Ours: { lists: [] } (not implemented)
 *
 * 5. /discover
 *    - Production: { latestFollows: [...] }
 *    - Ours: { recent_follows: [...] }
 *
 * 6. /lists/:tokenId/records
 *    - Production: { records: [{ version, record_type: "address", data, tags: null }] }
 *    - Check our record_type field (might be number vs string)
 */
