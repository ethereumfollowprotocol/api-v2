import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger, query, convertHexToBigInt, type Address } from '@efp/shared';
import { resolveAddressOrENS, isENSName } from '../services/address.js';
import { getUserAccount, getUserDetails, getUserStats, getUserLists } from '../services/users.js';
import { getENSProfiles } from '../services/ens.js';
import {
  getFollowers,
  getFollowing,
  getAllFollowers,
  getAllFollowing,
  getMutuals,
  getRelationship,
  getFollowerState,
  searchFollowers,
  searchFollowing,
} from '../services/followers.js';
import { getUserTags, getUserTaggedAs } from '../services/tags.js';
import { getRecommendations, getRecommendationsWithDetails } from '../services/recommendations.js';
import { getPOAPBadges } from '../services/poap.js';

const logger = createLogger('users-routes');

interface AddressParams {
  addressOrENS: string;
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
  sort?: string;
  tags?: string;
  include?: string;
  cache?: string;
}

// Helper to resolve address or return 400
async function resolveAddress(
  addressOrENS: string,
  reply: FastifyReply
): Promise<Address | null> {
  const address = await resolveAddressOrENS(addressOrENS);

  if (!address) {
    const errorMessage = isENSName(addressOrENS)
      ? 'ENS name not valid or does not exist'
      : 'Invalid address format';

    reply.status(400).send({
      response: errorMessage,
    });
    return null;
  }

  return address;
}

export async function usersRoutes(app: FastifyInstance) {
  // GET /users/:addressOrENS/account (P0)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/account',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const account = await getUserAccount(address);
      return account;
    }
  );

  // GET /users/:addressOrENS/details (P0)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/details',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const details = await getUserDetails(address);
      return details;
    }
  );

  // GET /users/:addressOrENS/stats (P0)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/stats',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const stats = await getUserStats(address);
      return stats;
    }
  );

  // GET /users/:addressOrENS/followers (P1)
  app.get<{ Params: AddressParams; Querystring: PaginationQuery }>(
    '/users/:addressOrENS/followers',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { limit = '10', offset = '0', sort = 'latest', tags, include } = request.query;

      const followers = await getFollowers(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: include?.includes('ens'),
      });

      return { followers };
    }
  );

  // GET /users/:addressOrENS/following (P1)
  app.get<{ Params: AddressParams; Querystring: PaginationQuery }>(
    '/users/:addressOrENS/following',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { limit = '10', offset = '0', sort = 'latest', tags, include } = request.query;

      const following = await getFollowing(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: include?.includes('ens'),
      });

      return { following };
    }
  );

  // GET /users/:addressOrENS/allFollowers (P1)
  // Returns all followers, but respects limit/offset if provided
  app.get<{ Params: AddressParams; Querystring: PaginationQuery }>(
    '/users/:addressOrENS/allFollowers',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { limit, offset = '0', sort = 'latest', tags, include } = request.query;

      // If limit is provided, use it; otherwise return all (up to 10000)
      const effectiveLimit = limit ? Math.min(parseInt(limit, 10) || 10000, 10000) : 10000;

      const followers = await getFollowers(address, {
        limit: effectiveLimit,
        offset: parseInt(offset, 10) || 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: include?.includes('ens'),
      });

      return { followers };
    }
  );

  // GET /users/:addressOrENS/allFollowing (P1)
  // Returns all following, but respects limit/offset if provided
  app.get<{ Params: AddressParams; Querystring: PaginationQuery }>(
    '/users/:addressOrENS/allFollowing',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { limit, offset = '0', sort = 'latest', tags, include } = request.query;

      // If limit is provided, use it; otherwise return all (up to 10000)
      const effectiveLimit = limit ? Math.min(parseInt(limit, 10) || 10000, 10000) : 10000;

      const following = await getFollowing(address, {
        limit: effectiveLimit,
        offset: parseInt(offset, 10) || 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: include?.includes('ens'),
      });

      return { following };
    }
  );

  // GET /users/:addressOrENS/mutuals (P1)
  // Note: Production returns 501 "Not implemented" - matching for compatibility
  app.get<{ Params: AddressParams; Querystring: PaginationQuery }>(
    '/users/:addressOrENS/mutuals',
    async (request, reply) => {
      return reply.status(501).send('Not implemented');
    }
  );

  // GET /users/:addressOrENS/ens (P2)
  // Response shape must match production: { ens: { name, address, avatar, records, updated_at } }
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/ens',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const account = await getUserAccount(address);
      return {
        ens: {
          name: account.ens?.name || null,
          address,
          avatar: account.ens?.avatar || null,
          records: account.ens?.records || {},
          updated_at: account.ens?.updated_at || new Date().toISOString(),
        },
      };
    }
  );

  // GET /users/:addressOrENS/primary-list (P2)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/primary-list',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const details = await getUserDetails(address);
      return { primary_list: details.primary_list };
    }
  );

  // GET /users/:addressOrENS/lists (P2)
  // Response shape must match production: { primary_list: "str"|null, lists: ["tokenId1", ...] }
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/lists',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const [userLists, details] = await Promise.all([
        getUserLists(address),
        getUserDetails(address),
      ]);

      return {
        primary_list: details.primary_list,
        lists: userLists.map((l) => l.token_id),
      };
    }
  );

  // GET /users/:addressOrENS/latestFollowers (P2)
  app.get<{ Params: AddressParams; Querystring: PaginationQuery }>(
    '/users/:addressOrENS/latestFollowers',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { limit = '10', offset = '0', include } = request.query;

      const followers = await getFollowers(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        sort: 'latest',
        includeENS: include?.includes('ens'),
      });

      return { followers };
    }
  );

  // GET /users/:addressOrENS/allFollowingAddresses (P2)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/allFollowingAddresses',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const following = await getAllFollowing(address, {
        sort: 'latest',
      });

      return following.map((f: { address: string }) => f.address);
    }
  );

  // GET /users/:addressOrENS/recommended (P3)
  app.get<{ Params: AddressParams; Querystring: { limit?: string; offset?: string; seed?: string } }>(
    '/users/:addressOrENS/recommended',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { limit = '10', offset = '0', seed } = request.query;

      const recommended = await getRecommendations(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        seed: seed ? parseInt(seed, 10) : undefined,
      });

      return { recommended };
    }
  );

  // GET /users/:addressOrENS/recommended/details (P3)
  app.get<{ Params: AddressParams; Querystring: { limit?: string; offset?: string } }>(
    '/users/:addressOrENS/recommended/details',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { limit = '10', offset = '0' } = request.query;

      const recommended = await getRecommendationsWithDetails(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
      });

      return { recommended };
    }
  );

  // GET /users/:addressOrENS/searchFollowers (P3)
  app.get<{ Params: AddressParams; Querystring: { term?: string; limit?: string; offset?: string; include?: string } }>(
    '/users/:addressOrENS/searchFollowers',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { term = '', limit = '10', offset = '0', include } = request.query;

      if (!term || term.length < 2) {
        return { followers: [] };
      }

      const followers = await searchFollowers(address, term, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        includeENS: include?.includes('ens'),
      });

      return { followers };
    }
  );

  // GET /users/:addressOrENS/searchFollowing (P3)
  app.get<{ Params: AddressParams; Querystring: { term?: string; limit?: string; offset?: string; include?: string } }>(
    '/users/:addressOrENS/searchFollowing',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { term = '', limit = '10', offset = '0', include } = request.query;

      if (!term || term.length < 2) {
        return { following: [] };
      }

      const following = await searchFollowing(address, term, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        includeENS: include?.includes('ens'),
      });

      return { following };
    }
  );

  // GET /users/:addressOrENS/tags (P2)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/tags',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      return await getUserTags(address);
    }
  );

  // GET /users/:addressOrENS/taggedAs (P3)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/taggedAs',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      return await getUserTaggedAs(address);
    }
  );

  // GET /users/:addressOrENS/badges (P3)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/badges',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const poaps = await getPOAPBadges(address);
      return { poaps };
    }
  );

  // GET /users/:addressOrENS/:targetAddressOrENS/relationship (P2)
  app.get<{ Params: AddressParams & { targetAddressOrENS: string } }>(
    '/users/:addressOrENS/:targetAddressOrENS/relationship',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const targetAddress = await resolveAddressOrENS(request.params.targetAddressOrENS);
      if (!targetAddress) {
        return reply.status(400).send({ response: 'Invalid target address' });
      }

      const state = await getRelationship(address, targetAddress);

      return {
        source: address,
        target: targetAddress,
        state,
      };
    }
  );

  // GET /users/:addressOrENS/:targetAddressOrENS/followerState (P2)
  // Response: { addressUser, addressFollower, state: { follow, block, mute } }
  app.get<{ Params: AddressParams & { targetAddressOrENS: string } }>(
    '/users/:addressOrENS/:targetAddressOrENS/followerState',
    async (request, reply) => {
      const userAddress = await resolveAddress(request.params.addressOrENS, reply);
      if (!userAddress) return;

      const followerAddress = await resolveAddressOrENS(request.params.targetAddressOrENS);
      if (!followerAddress) {
        return reply.status(400).send({ response: 'Invalid follower address' });
      }

      // Get user's primary list token ID
      const primaryListResult = await query<{ token_id: string }>(
        `
        SELECT l.token_id::TEXT
        FROM efp_account_metadata am
        JOIN efp_lists l ON l.token_id = convert_hex_to_bigint(am.value)
        WHERE am.address = $1 AND am.key = 'primary-list'
        `,
        [userAddress]
      );

      if (primaryListResult.rows.length === 0) {
        return {
          addressUser: userAddress,
          addressFollower: followerAddress,
          state: { follow: false, block: false, mute: false },
        };
      }

      const tokenId = primaryListResult.rows[0].token_id;
      const state = await getFollowerState(tokenId, followerAddress);

      return {
        addressUser: userAddress,
        addressFollower: followerAddress,
        state,
      };
    }
  );

  // GET /users/:addressOrENS/relationships (P2)
  // Response: relationships filtered by tag and direction
  app.get<{ Params: AddressParams; Querystring: { tag?: string; direction?: string; limit?: string; offset?: string } }>(
    '/users/:addressOrENS/relationships',
    async (request, reply) => {
      const { tag, direction, limit = '100', offset = '0' } = request.query;

      if (!tag || !direction) {
        return reply.status(400).send({
          message: 'Both "tag" and "direction" query parameters are required',
        });
      }

      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const limitNum = Math.min(parseInt(limit, 10) || 100, 1000);
      const offsetNum = parseInt(offset, 10) || 0;

      let results: { address: string; tags: string[] }[] = [];

      if (direction === 'incoming') {
        // Tags FROM others who follow this user
        const result = await query<{ follower_address: string; tags: string[] }>(
          `
          SELECT follower_address, tags
          FROM efp_followers
          WHERE address = $1 AND $2 = ANY(tags)
          LIMIT $3 OFFSET $4
          `,
          [address, tag, limitNum, offsetNum]
        );
        results = result.rows.map((r) => ({ address: r.follower_address.toLowerCase(), tags: r.tags }));
      } else if (direction === 'outgoing') {
        // Tags TO others this user follows
        const result = await query<{ following_address: string; tags: string[] }>(
          `
          SELECT following_address, tags
          FROM efp_following
          WHERE address = $1 AND $2 = ANY(tags)
          LIMIT $3 OFFSET $4
          `,
          [address, tag, limitNum, offsetNum]
        );
        results = result.rows.map((r) => ({ address: r.following_address.toLowerCase(), tags: r.tags }));
      }

      return { relationships: results };
    }
  );

  // GET /users/:addressOrENS/commonFollowers (P3)
  // Response: { results: [{ address, name, avatar, header, mutuals_rank }], length }
  app.get<{ Params: AddressParams; Querystring: { leader?: string; limit?: string; offset?: string } }>(
    '/users/:addressOrENS/commonFollowers',
    async (request, reply) => {
      const { leader, limit = '20', offset = '0' } = request.query;

      if (!leader) {
        return reply.status(400).send({ message: '"leader" query parameter is required' });
      }

      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const leaderAddress = await resolveAddressOrENS(leader);
      if (!leaderAddress) {
        return reply.status(400).send({ response: 'Invalid leader address' });
      }

      const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      // Find users that both follow the leader and are followed by address
      const result = await query<{
        address: string;
        name: string | null;
        avatar: string | null;
        header: string | null;
        mutuals_rank: number | null;
      }>(
        `
        SELECT
          f1.following_address as address,
          e.name,
          e.avatar,
          e.header,
          l.mutuals_rank
        FROM efp_following f1
        JOIN efp_following f2 ON f2.following_address = f1.following_address
        LEFT JOIN ens_metadata e ON e.address = f1.following_address
        LEFT JOIN efp_leaderboard l ON l.address = f1.following_address
        WHERE f1.address = $1
          AND f2.address = $2
          AND f1.is_blocked = FALSE AND f1.is_muted = FALSE
          AND f2.is_blocked = FALSE AND f2.is_muted = FALSE
        ORDER BY l.mutuals_rank ASC NULLS LAST
        LIMIT $3 OFFSET $4
        `,
        [address, leaderAddress, limitNum, offsetNum]
      );

      return {
        results: result.rows.map((r) => ({
          address: r.address.toLowerCase(),
          name: r.name || null,
          avatar: r.avatar || null,
          header: r.header || null,
          mutuals_rank: r.mutuals_rank?.toString() || null,
        })),
        length: result.rows.length,
      };
    }
  );

  // GET /users/:addressOrENS/list-records (P3)
  // Response: { records: [{ version, record_type, data, tags }] }
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/list-records',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      // Get user's primary list storage location
      const primaryListResult = await query<{
        list_storage_location_chain_id: number;
        list_storage_location_contract_address: string;
        list_storage_location_slot: string;
      }>(
        `
        SELECT l.list_storage_location_chain_id, l.list_storage_location_contract_address, l.list_storage_location_slot
        FROM efp_account_metadata am
        JOIN efp_lists l ON l.token_id = convert_hex_to_bigint(am.value)
        WHERE am.address = $1 AND am.key = 'primary-list'
        `,
        [address]
      );

      if (primaryListResult.rows.length === 0) {
        return { records: [] };
      }

      const { list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot } =
        primaryListResult.rows[0];

      // Get records with tags
      const recordsResult = await query<{
        record_version: number;
        record_type: number;
        record_data: string;
        tags: string[] | null;
      }>(
        `
        SELECT r.record_version, r.record_type, convert_from(r.record_data, 'UTF8') as record_data,
               array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL) as tags
        FROM efp_list_records r
        LEFT JOIN efp_list_record_tags t ON
          t.chain_id = r.chain_id AND
          t.contract_address = r.contract_address AND
          t.slot = r.slot AND
          t.record = r.record
        WHERE r.chain_id = $1 AND r.contract_address = $2 AND r.slot = $3
        GROUP BY r.record_version, r.record_type, r.record_data, r.record
        `,
        [list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot]
      );

      const recordTypeMap: Record<number, string> = {
        1: 'address',
        2: 'nft',
        3: 'list',
      };

      const records = recordsResult.rows.map((row) => ({
        version: row.record_version,
        record_type: recordTypeMap[row.record_type] || 'unknown',
        data: row.record_data,
        tags: row.tags,
      }));

      return { records };
    }
  );

  // GET /users/:addressOrENS/notifications (P3)
  // Response: { summary: {...}, notifications: [...] }
  app.get<{ Params: AddressParams; Querystring: { limit?: string; offset?: string; interval?: string } }>(
    '/users/:addressOrENS/notifications',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { limit = '50', offset = '0', interval = '168:00:00' } = request.query;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const offsetNum = parseInt(offset, 10) || 0;

      // Get recent follow/unfollow activity for this user
      const result = await query<{
        follower_address: string;
        is_blocked: boolean;
        is_muted: boolean;
        updated_at: Date;
      }>(
        `
        SELECT follower_address, is_blocked, is_muted, updated_at
        FROM efp_followers
        WHERE address = $1
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3
        `,
        [address, limitNum, offsetNum]
      );

      // For now, return minimal notification structure
      // Full implementation would track opcode history
      return {
        summary: {
          interval: interval + '(hrs)',
          opcode: 'all',
          total: result.rows.length,
          total_follows: result.rows.filter((r) => !r.is_blocked && !r.is_muted).length,
          total_unfollows: 0,
          total_tags: 0,
          total_untags: 0,
        },
        notifications: [],
      };
    }
  );

  // GET /users/:addressOrENS/blocks (P3)
  // Not implemented - returns 501
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/blocks',
    async (request, reply: FastifyReply) => {
      reply.status(501).type('text/plain').send('Not implemented');
    }
  );

  // GET /users/:addressOrENS/mutes (P3)
  // Not implemented - returns 501
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/mutes',
    async (request, reply: FastifyReply) => {
      reply.status(501).type('text/plain').send('Not implemented');
    }
  );
}
