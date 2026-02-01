/**
 * Integration tests for the API
 *
 * These tests run against a local API instance.
 * Start the API with: npm run dev:api
 *
 * Run these tests with:
 *   RUN_INTEGRATION_TESTS=true npm run test -- integration/api.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LOCAL_API, TEST_ADDRESSES, TEST_ENS_NAMES, TEST_LIST_IDS, fetchAPI, waitForAPI } from './setup.js';

// Skip if no local API URL is provided or API is not running
const runIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;

describe.skipIf(!runIntegrationTests)('API Integration Tests', () => {
  beforeAll(async () => {
    const isReady = await waitForAPI(LOCAL_API, 5, 500);
    if (!isReady) {
      throw new Error(`API at ${LOCAL_API} is not responding`);
    }
  });

  describe('Health Endpoints', () => {
    it('GET /health should return ok', async () => {
      const response = await fetchAPI(LOCAL_API, '/health');
      expect(response.ok).toBe(true);
      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('status');
    });
  });

  describe('Users Endpoints', () => {
    it('GET /users/:address/account should return user account', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/account`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('address');
      expect(data.address.toLowerCase()).toBe(TEST_ADDRESSES.vitalik);
    });

    it('GET /users/:ens/account should resolve ENS and return account', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ENS_NAMES.vitalik}/account`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data.address.toLowerCase()).toBe(TEST_ADDRESSES.vitalik);
    });

    it('GET /users/:address/details should return user details with ranks', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/details`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('ranks');
      expect(data).toHaveProperty('primary_list');
    });

    it('GET /users/:address/stats should return follower/following counts', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/stats`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('followers_count');
      expect(data).toHaveProperty('following_count');
      expect(typeof data.followers_count).toBe('number');
      expect(typeof data.following_count).toBe('number');
    });

    it('GET /users/:address/followers should return paginated followers', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/followers?limit=5`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('followers');
      expect(Array.isArray(data.followers)).toBe(true);
      expect(data.followers.length).toBeLessThanOrEqual(5);
    });

    it('GET /users/:address/following should return paginated following', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/following?limit=5`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('following');
      expect(Array.isArray(data.following)).toBe(true);
    });

    it('GET /users/:address/ens should return ENS profile wrapped in ens key', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/ens`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('ens');
      expect(data.ens).toHaveProperty('name');
      expect(data.ens).toHaveProperty('address');
    });

    it('GET /users/:address/lists should return primary_list and lists array', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/lists`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('primary_list');
      expect(data).toHaveProperty('lists');
      expect(Array.isArray(data.lists)).toBe(true);
    });

    it('should return 400 for invalid address', async () => {
      const response = await fetchAPI(LOCAL_API, '/users/invalid/account');
      expect(response.status).toBe(400);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('response');
    });

    it('should return 400 for non-existent ENS', async () => {
      const response = await fetchAPI(LOCAL_API, '/users/thisdoesnotexist123456789.eth/account');
      expect(response.status).toBe(400);
    });

    it('GET /users/:address/latestFollowers should return latest followers', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/latestFollowers?limit=5`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('followers');
      expect(Array.isArray(data.followers)).toBe(true);
    });

    it('GET /users/:address/allFollowingAddresses should return address array', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/allFollowingAddresses`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('GET /users/:address/recommended should return recommended array', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/recommended`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('recommended');
      expect(Array.isArray(data.recommended)).toBe(true);
    });

    it('GET /users/:address/tags should return tag info', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/tags`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('tags');
      expect(Array.isArray(data.tags)).toBe(true);
    });

    it('GET /users/:address/badges should return badges', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/badges`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('poaps');
      expect(Array.isArray(data.poaps)).toBe(true);
    });

    it('GET /users/:address/mutuals should return mutuals array', async () => {
      const response = await fetchAPI(LOCAL_API, `/users/${TEST_ADDRESSES.vitalik}/mutuals?limit=5`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('mutuals');
      expect(Array.isArray(data.mutuals)).toBe(true);
    });
  });

  describe('Lists Endpoints', () => {
    it('GET /lists/:tokenId/account should return list account', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/account`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('ens');
      expect(data).toHaveProperty('is_primary_list');
      expect(data).toHaveProperty('primary_list');
    });

    it('GET /lists/:tokenId/details should return list details', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/details`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('ranks');
    });

    it('GET /lists/:tokenId/stats should return stats', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/stats`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('followers_count');
      expect(data).toHaveProperty('following_count');
    });

    it('GET /lists/:tokenId/followers should return followers', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/followers?limit=5`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('followers');
      expect(Array.isArray(data.followers)).toBe(true);
    });

    it('GET /lists/:tokenId/following should return following', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/following?limit=5`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('following');
      expect(Array.isArray(data.following)).toBe(true);
    });

    it('GET /lists/:tokenId/allFollowers should return all followers', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/allFollowers`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('followers');
      expect(Array.isArray(data.followers)).toBe(true);
    });

    it('GET /lists/:tokenId/allFollowing should return all following', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/allFollowing`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('following');
      expect(Array.isArray(data.following)).toBe(true);
    });

    it('GET /lists/:tokenId/records should return list records with tags', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/records`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('records');
      expect(Array.isArray(data.records)).toBe(true);

      if (data.records.length > 0) {
        expect(data.records[0]).toHaveProperty('version');
        expect(data.records[0]).toHaveProperty('record_type');
        expect(typeof data.records[0].record_type).toBe('string');
        expect(data.records[0]).toHaveProperty('data');
        expect(data.records[0]).toHaveProperty('tags');
      }
    });

    it('should return 404 for non-existent list', async () => {
      const response = await fetchAPI(LOCAL_API, '/lists/99999999/account');
      expect(response.status).toBe(404);
    });

    it('GET /lists/:tokenId/latestFollowers should return latest followers', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/latestFollowers?limit=5`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('followers');
      expect(Array.isArray(data.followers)).toBe(true);
    });

    it('GET /lists/:tokenId/allFollowingAddresses should return address array', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/allFollowingAddresses`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('GET /lists/:tokenId/recommended should return recommended array', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/recommended`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('recommended');
      expect(Array.isArray(data.recommended)).toBe(true);
    });

    it('GET /lists/:tokenId/tags should return tag info', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/tags`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('token_id');
      expect(data).toHaveProperty('tags');
      expect(Array.isArray(data.tags)).toBe(true);
    });

    it('GET /lists/:tokenId/searchFollowers should return search results', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/searchFollowers?term=vi`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('followers');
      expect(Array.isArray(data.followers)).toBe(true);
    });

    it('GET /lists/:tokenId/badges should return badges', async () => {
      const response = await fetchAPI(LOCAL_API, `/lists/${TEST_LIST_IDS.brantly}/badges`);
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('poaps');
      expect(Array.isArray(data.poaps)).toBe(true);
    });
  });

  describe('Leaderboard Endpoints', () => {
    it('GET /leaderboard/ranked should return ranked entries', async () => {
      const response = await fetchAPI(LOCAL_API, '/leaderboard/ranked?limit=5');
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('last_updated');
      expect(data).toHaveProperty('results');
      expect(Array.isArray(data.results)).toBe(true);
    });

    it('GET /leaderboard/count should return leaderboardCount as string', async () => {
      const response = await fetchAPI(LOCAL_API, '/leaderboard/count');
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('leaderboardCount');
      expect(typeof data.leaderboardCount).toBe('string');
    });

    it('GET /leaderboard/followers should return array with string counts', async () => {
      const response = await fetchAPI(LOCAL_API, '/leaderboard/followers?limit=2');
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(Array.isArray(data)).toBe(true);

      if (data.length > 0) {
        expect(data[0]).toHaveProperty('rank');
        expect(data[0]).toHaveProperty('address');
        expect(data[0]).toHaveProperty('followers_count');
        expect(typeof data[0].followers_count).toBe('string');
      }
    });

    it('GET /leaderboard/following should return array with string counts', async () => {
      const response = await fetchAPI(LOCAL_API, '/leaderboard/following?limit=2');
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(Array.isArray(data)).toBe(true);

      if (data.length > 0) {
        expect(data[0]).toHaveProperty('following_count');
        expect(typeof data[0].following_count).toBe('string');
      }
    });

    it('GET /leaderboard/blocks should return array with string counts', async () => {
      const response = await fetchAPI(LOCAL_API, '/leaderboard/blocks?limit=2');
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Stats Endpoints', () => {
    it('GET /stats should return stats wrapped in stats key', async () => {
      const response = await fetchAPI(LOCAL_API, '/stats');
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('stats');
      expect(data.stats).toHaveProperty('address_count');
      expect(data.stats).toHaveProperty('list_count');
      expect(data.stats).toHaveProperty('list_op_count');
      expect(data.stats).toHaveProperty('user_count');
      // All values should be strings
      expect(typeof data.stats.address_count).toBe('string');
    });

    it('GET /discover should return latestFollows', async () => {
      const response = await fetchAPI(LOCAL_API, '/discover?limit=5');
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('latestFollows');
      expect(Array.isArray(data.latestFollows)).toBe(true);
    });

    it('GET /minters should return minters array', async () => {
      const response = await fetchAPI(LOCAL_API, '/minters?limit=5');
      expect(response.ok).toBe(true);

      const data: AnyJson = await response.json();
      expect(data).toHaveProperty('minters');
      expect(Array.isArray(data.minters)).toBe(true);
    });
  });
});
