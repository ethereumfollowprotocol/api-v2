import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger, type Address } from '@efp/shared';
import { resolveAddressOrENS, isENSName } from '../services/address.js';
import { getUserAccount, getUserDetails, getUserStats, getUserLists } from '../services/users.js';
import {
  getFollowers,
  getFollowing,
  getAllFollowers,
  getAllFollowing,
} from '../services/followers.js';

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
  app.get<{ Params: AddressParams; Querystring: PaginationQuery }>(
    '/users/:addressOrENS/allFollowers',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { sort = 'latest', tags, include } = request.query;

      const followers = await getAllFollowers(address, {
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: include?.includes('ens'),
      });

      return { followers };
    }
  );

  // GET /users/:addressOrENS/allFollowing (P1)
  app.get<{ Params: AddressParams; Querystring: PaginationQuery }>(
    '/users/:addressOrENS/allFollowing',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { sort = 'latest', tags, include } = request.query;

      const following = await getAllFollowing(address, {
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: include?.includes('ens'),
      });

      return { following };
    }
  );

  // GET /users/:addressOrENS/mutuals (P1)
  app.get<{ Params: AddressParams; Querystring: PaginationQuery }>(
    '/users/:addressOrENS/mutuals',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      // TODO: Implement mutuals endpoint
      return { mutuals: [] };
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

      const { limit = '10', include } = request.query;

      const followers = await getFollowers(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: 0,
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

      // TODO: Implement recommendation algorithm
      return { recommended: [] };
    }
  );

  // GET /users/:addressOrENS/recommended/details (P3)
  app.get<{ Params: AddressParams; Querystring: { limit?: string; offset?: string } }>(
    '/users/:addressOrENS/recommended/details',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      // TODO: Implement recommendation algorithm with details
      return { recommended: [] };
    }
  );

  // GET /users/:addressOrENS/searchFollowers (P3)
  app.get<{ Params: AddressParams; Querystring: { term?: string; limit?: string; offset?: string; include?: string } }>(
    '/users/:addressOrENS/searchFollowers',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { term = '' } = request.query;

      if (!term || term.length < 2) {
        return { followers: [] };
      }

      // TODO: Implement search in Elasticsearch
      return { followers: [] };
    }
  );

  // GET /users/:addressOrENS/searchFollowing (P3)
  app.get<{ Params: AddressParams; Querystring: { term?: string; limit?: string; offset?: string; include?: string } }>(
    '/users/:addressOrENS/searchFollowing',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const { term = '' } = request.query;

      if (!term || term.length < 2) {
        return { following: [] };
      }

      // TODO: Implement search in Elasticsearch
      return { following: [] };
    }
  );

  // GET /users/:addressOrENS/tags (P2)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/tags',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      // TODO: Implement - get all tags this user has applied
      return {
        address,
        tags: [],
        tagCounts: {},
        taggedAddresses: {},
      };
    }
  );

  // GET /users/:addressOrENS/taggedAs (P3)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/taggedAs',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      // TODO: Implement - find what tags others have assigned to this user
      return {
        address,
        tags: [],
        tagCounts: {},
        taggedAddresses: {},
      };
    }
  );

  // GET /users/:addressOrENS/badges (P3)
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/badges',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      // TODO: Implement POAP badges lookup
      return { poaps: [] };
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

      // TODO: Implement relationship lookup
      return {
        source: address,
        target: targetAddress,
        state: {
          is_following: false,
          is_followed_by: false,
          is_blocked: false,
          is_blocked_by: false,
          is_muted: false,
          is_muted_by: false,
        },
      };
    }
  );
}
