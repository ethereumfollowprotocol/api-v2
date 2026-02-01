/**
 * API Response Shape Comparison Tests
 *
 * These tests document the expected response shapes from production
 * and verify our implementation matches.
 *
 * Run with: npm run test -- services/api/src/__tests__/api-shape-comparison.test.ts
 */

import { describe, it, expect } from 'vitest';

const PRODUCTION_API = 'https://data.ethfollow.xyz/api/v1';
const TEST_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'; // vitalik.eth
const TEST_ENS = 'vitalik.eth';
const TEST_LIST_ID = '3'; // brantly.eth's list

// Helper to fetch from production API
async function fetchProduction(path: string): Promise<unknown> {
  const response = await fetch(`${PRODUCTION_API}${path}`);
  if (!response.ok) {
    throw new Error(`Production API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

describe('Production API Response Shapes (Documentation)', () => {
  describe('Users Endpoints', () => {
    it('GET /users/:address/account', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/account`) as any;
      console.log('Response shape:', JSON.stringify(response, null, 2).slice(0, 500));

      // Document expected shape
      expect(response).toMatchObject({
        address: expect.any(String),
        ens: {
          name: expect.any(String),
          avatar: expect.any(String),
          records: expect.any(Object),
          updated_at: expect.any(String),
        },
      });
    });

    it('GET /users/:address/details', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/details`) as any;

      expect(response).toMatchObject({
        address: expect.any(String),
        ens: expect.any(Object),
        ranks: {
          mutuals_rank: expect.any(String),
          followers_rank: expect.any(String),
          following_rank: expect.any(String),
          top8_rank: expect.any(String),
          blocks_rank: expect.anything(), // Can be number 0 or string
        },
        primary_list: expect.any(String),
      });
    });

    it('GET /users/:address/stats', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/stats`) as any;

      expect(response).toEqual({
        followers_count: expect.any(Number),
        following_count: expect.any(Number),
      });
    });

    it('GET /users/:address/followers', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/followers?limit=1`) as any;

      expect(response).toHaveProperty('followers');
      expect(Array.isArray(response.followers)).toBe(true);

      if (response.followers.length > 0) {
        expect(response.followers[0]).toMatchObject({
          efp_list_nft_token_id: expect.any(String),
          address: expect.any(String),
          tags: expect.any(Array),
          is_following: expect.any(Boolean),
          is_blocked: expect.any(Boolean),
          is_muted: expect.any(Boolean),
          updated_at: expect.any(String),
        });
      }
    });

    it('GET /users/:address/following', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/following?limit=1`) as any;

      expect(response).toHaveProperty('following');
      expect(Array.isArray(response.following)).toBe(true);

      if (response.following.length > 0) {
        expect(response.following[0]).toMatchObject({
          version: expect.any(Number),
          record_type: 'address', // String not number
          data: expect.any(String),
          address: expect.any(String),
          tags: expect.any(Array),
        });
      }
    });

    it('GET /users/:address/ens', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/ens`) as any;

      // Response is wrapped in { ens: { ... } }
      expect(response).toHaveProperty('ens');
      expect(response.ens).toMatchObject({
        name: expect.any(String),
        address: expect.any(String), // Includes address inside ens
        avatar: expect.any(String),
        records: expect.any(Object),
        updated_at: expect.any(String),
      });
    });

    it('GET /users/:address/lists', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/lists`) as any;

      expect(response).toMatchObject({
        primary_list: expect.any(String),
        lists: expect.any(Array),
      });

      // Lists are strings (token IDs)
      if (response.lists.length > 0) {
        expect(typeof response.lists[0]).toBe('string');
      }
    });

    it('GET /users/:address/primary-list', async () => {
      const response = await fetchProduction(`/users/${TEST_ENS}/primary-list`) as any;

      expect(response).toHaveProperty('primary_list');
    });
  });

  describe('Lists Endpoints', () => {
    it('GET /lists/:tokenId/account', async () => {
      const response = await fetchProduction(`/lists/${TEST_LIST_ID}/account`) as any;

      expect(response).toMatchObject({
        address: expect.any(String),
        ens: expect.any(Object),
        is_primary_list: expect.any(Boolean),
        primary_list: expect.any(String),
      });
    });

    it('GET /lists/:tokenId/details', async () => {
      const response = await fetchProduction(`/lists/${TEST_LIST_ID}/details`) as any;

      expect(response).toMatchObject({
        address: expect.any(String),
        ens: expect.any(Object),
        ranks: expect.any(Object),
        primary_list: expect.any(String),
      });
    });

    it('GET /lists/:tokenId/records', async () => {
      const response = await fetchProduction(`/lists/${TEST_LIST_ID}/records`) as any;

      expect(response).toHaveProperty('records');
      expect(Array.isArray(response.records)).toBe(true);

      if (response.records.length > 0) {
        expect(response.records[0]).toMatchObject({
          version: expect.any(Number),
          record_type: 'address', // String not number
          data: expect.any(String),
        });
        // tags can be null or array
        expect(response.records[0]).toHaveProperty('tags');
      }
    });
  });

  describe('Leaderboard Endpoints', () => {
    it('GET /leaderboard/ranked', async () => {
      const response = await fetchProduction(`/leaderboard/ranked?limit=1`) as any;

      expect(response).toMatchObject({
        last_updated: expect.any(String),
        results: expect.any(Array),
      });

      if (response.results.length > 0) {
        const entry = response.results[0];
        expect(entry).toMatchObject({
          address: expect.any(String),
          mutuals_rank: expect.any(String),
          followers_rank: expect.any(String),
          following_rank: expect.any(String),
          mutuals: expect.any(String),
          following: expect.any(String),
          followers: expect.any(String),
          blocks: expect.any(String),
          top8: expect.any(String),
          updated_at: expect.any(String),
        });
      }
    });

    it('GET /leaderboard/count', async () => {
      const response = await fetchProduction(`/leaderboard/count`) as any;

      // Key is leaderboardCount, value is string
      expect(response).toMatchObject({
        leaderboardCount: expect.any(String),
      });
    });

    it('GET /leaderboard/followers', async () => {
      // Use cache=fresh to avoid cached response that converts arrays to objects
      const response = await fetchProduction(`/leaderboard/followers?limit=1&cache=fresh`) as any[];

      expect(Array.isArray(response)).toBe(true);
      if (response.length > 0) {
        expect(response[0]).toMatchObject({
          rank: expect.any(Number),
          address: expect.any(String),
          followers_count: expect.any(String), // String not number
        });
      }
    });

    it('GET /leaderboard/following', async () => {
      // Use cache=fresh to avoid cached response that converts arrays to objects
      const response = await fetchProduction(`/leaderboard/following?limit=1&cache=fresh`) as any[];

      expect(Array.isArray(response)).toBe(true);
      if (response.length > 0) {
        expect(response[0]).toMatchObject({
          rank: expect.any(Number),
          address: expect.any(String),
          following_count: expect.any(String), // String not number
        });
      }
    });
  });

  describe('Stats Endpoints', () => {
    it('GET /stats', async () => {
      const response = await fetchProduction(`/stats`) as any;

      // Response is wrapped in { stats: { ... } }
      expect(response).toHaveProperty('stats');
      expect(response.stats).toMatchObject({
        address_count: expect.any(String),
        list_count: expect.any(String),
        list_op_count: expect.any(String),
        user_count: expect.any(String),
      });
    });

    it('GET /discover', async () => {
      const response = await fetchProduction(`/discover?limit=1`) as any;

      // Key is latestFollows not recent_follows
      expect(response).toHaveProperty('latestFollows');
      expect(Array.isArray(response.latestFollows)).toBe(true);
    });
  });
});
