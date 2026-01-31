import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger, type Address } from '@efp/shared';
import { resolveAddressOrENS, isENSName } from '../services/address.js';
import { getUserAccount, getUserDetails, getUserStats } from '../services/users.js';
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
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/ens',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const account = await getUserAccount(address);
      return account.ens || { name: null, avatar: null };
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
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/lists',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      // TODO: Implement lists endpoint
      return { lists: [] };
    }
  );
}
