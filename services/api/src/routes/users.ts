import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger, query, convertHexToBigInt, type Address } from '@efp/shared';
import { isAddress } from 'viem';
import qrcode from 'qr-image';
import { resolveAddressOrENS, isENSName, normalizeAddress } from '../services/address.js';
import { getUserAccount, getUserDetails, getUserStats, getUserLists } from '../services/users.js';
import { getENSProfile, getENSProfiles } from '../services/ens.js';
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
import { getNotifications } from '../services/notifications.js';

const logger = createLogger('users-routes');

// QR code SVG elements for EFP branding
const efplogoSVG = `
<rect width="12" height="12" rx="2" x="14" y="14" fill="#333333" />
<rect width="10" height="10" rx="2" x="15" y="15" fill="url(#grad-logo)" />
<rect width="10" height="10" rx="2" x="15" y="15" fill="white" fill-opacity="0.5" />
<path d="M3.62302 5.58664L5.4049995 2.4337845L7.398153 5.58664L5.4049995 6.73439175L3.62302 5.58664Z" fill="url(#paint1_linear_564_124)" transform="translate(14.5, 14.5)"/>
<path d="M3.62302 5.58664L5.4049995 2.4337845L7.398153 5.58664L5.4049995 6.73439175L3.62302 5.58664Z" fill="#333333" transform="translate(14.5, 14.5)"/>
<path d="M5.4049995 7.08007725L3.62302 5.932326L5.4049995 8.6012145L7.398153 5.932326L5.4049995 7.08007725Z" fill="url(#paint2_linear_564_124)" transform="translate(14.5, 14.5)"/>
<path d="M5.4049995 7.08007725L3.62302 5.932326L5.4049995 8.6012145L7.398153 5.932326L5.4049995 7.08007725Z" fill="#333333" transform="translate(14.5, 14.5)"/>
<path d="M7.9374555 7.49682225H7.398153V8.223864H6.651423H6.651423V8.7312105H7.398153V9.62638425H7.9374555V8.7312105H8.833887V8.223864H7.9374555V7.49682225Z" fill="url(#paint3_linear_564_124)" transform="translate(14.5, 14.5)"/>
<path d="M7.9374555 7.49682225H7.398153V8.223864H6.651423H6.651423V8.7312105H7.398153V9.62638425H7.9374555V8.7312105H8.833887V8.223864H7.9374555V7.49682225Z" fill="#333333" transform="translate(14.5, 14.5)"/>
`;

function getGradientText(nameOrAddress: string): string {
  const displayText = isAddress(nameOrAddress)
    ? `${nameOrAddress.slice(0, 6)}…${nameOrAddress.slice(38, 42)}`
    : nameOrAddress.length > 18
      ? `${nameOrAddress.slice(0, 18)}…`
      : nameOrAddress;
  return `<text width="100" height="5" y="41" x="50%" fill="#eeeeee">${displayText}</text>`;
}

async function getProfileImage(ensAvatar: string): Promise<string> {
  try {
    const res = await fetch(ensAvatar);
    if (!res.ok) {
      return '';
    }
    return `<rect x="14.5" y="14.5" width="11" height="11" rx="2" fill="#333333" /><image width="10" height="10" x="15" rx="1" y="15" href="${ensAvatar}" /><rect x="14.5" y="14.5" width="11" height="11" rx="2" fill="transparent" stroke="#333333" stroke-width="1" />`;
  } catch {
    return '';
  }
}

interface AddressParams {
  addressOrENS: string;
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
  sort?: string;
  tags?: string;
  include?: string | string[];
  cache?: string;
}

// Helper to parse include parameter (can be string or array)
// Accepts: ?include=ens&include=mutuals or ?include=ens,mutuals
function parseIncludeParam(include?: string | string[]): Set<string> {
  if (!include) return new Set();
  if (Array.isArray(include)) {
    // Multiple query params: ?include=ens&include=mutuals
    return new Set(include.flatMap((v) => v.split(',')).map((v) => v.trim().toLowerCase()));
  }
  // Single param: ?include=ens,mutuals or ?include=ens
  return new Set(include.split(',').map((v) => v.trim().toLowerCase()));
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
  // POST /users/ens/avatar/batch - must be registered BEFORE parameterized routes
  app.post<{ Body: string[] }>(
    '/users/ens/avatar/batch',
    async (request, reply) => {
      const input = request.body;

      if (!Array.isArray(input)) {
        return reply.status(400).send({ response: 'Invalid input: expected array' });
      }

      // Resolve all addresses
      const addressMap = new Map<string, Address>();
      for (const item of input) {
        if (isAddress(item)) {
          addressMap.set(item, item.toLowerCase() as Address);
        } else {
          const resolved = await resolveAddressOrENS(item);
          if (resolved) {
            addressMap.set(item, resolved);
          }
        }
      }

      // Get ENS profiles for all resolved addresses
      const addresses = Array.from(new Set(addressMap.values()));
      const profiles = await getENSProfiles(addresses);

      // Build result object mapping input -> avatar URL
      const result: Record<string, string> = {};
      for (const item of input) {
        const address = addressMap.get(item);
        if (address) {
          const profile = profiles.get(address);
          result[item] = profile?.avatar || '';
        }
      }

      return result;
    }
  );

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
      const includeSet = parseIncludeParam(include);

      const followers = await getFollowers(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: includeSet.has('ens'),
        includeMutuals: includeSet.has('mutuals'),
        includeBlocked: includeSet.has('blocked'),
        includeMuted: includeSet.has('muted'),
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
      const includeSet = parseIncludeParam(include);

      const following = await getFollowing(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: includeSet.has('ens'),
        includeMutuals: includeSet.has('mutuals'),
        includeBlocked: includeSet.has('blocked'),
        includeMuted: includeSet.has('muted'),
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
      const includeSet = parseIncludeParam(include);

      // If limit is provided, use it; otherwise return all (up to 10000)
      const effectiveLimit = limit ? Math.min(parseInt(limit, 10) || 10000, 10000) : 10000;

      const followers = await getFollowers(address, {
        limit: effectiveLimit,
        offset: parseInt(offset, 10) || 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: includeSet.has('ens'),
        includeMutuals: includeSet.has('mutuals'),
        includeBlocked: includeSet.has('blocked'),
        includeMuted: includeSet.has('muted'),
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
      const includeSet = parseIncludeParam(include);

      // If limit is provided, use it; otherwise return all (up to 10000)
      const effectiveLimit = limit ? Math.min(parseInt(limit, 10) || 10000, 10000) : 10000;

      const following = await getFollowing(address, {
        limit: effectiveLimit,
        offset: parseInt(offset, 10) || 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: includeSet.has('ens'),
        includeMutuals: includeSet.has('mutuals'),
        includeBlocked: includeSet.has('blocked'),
        includeMuted: includeSet.has('muted'),
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

  // GET /users/:addressOrENS/ens/avatar - redirect to avatar URL
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/ens/avatar',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      const profile = await getENSProfile(address);
      if (profile?.avatar) {
        return reply.redirect(302, profile.avatar);
      }

      // No avatar found - return 404
      return reply.status(404).send({ response: 'No avatar found' });
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
      const includeSet = parseIncludeParam(include);

      const followers = await getFollowers(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        sort: 'latest',
        includeENS: includeSet.has('ens'),
        includeMutuals: includeSet.has('mutuals'),
        includeBlocked: includeSet.has('blocked'),
        includeMuted: includeSet.has('muted'),
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
      const { tag, limit = '100', offset = '0' } = request.query;
      let { direction } = request.query;

      // Map shorthand values: 'in' → 'incoming', 'out' → 'outgoing'
      if (direction === 'in') direction = 'incoming';
      if (direction === 'out') direction = 'outgoing';

      if (!tag || !direction) {
        return reply.status(400).send({
          message: 'Both "tag" and "direction" query parameters are required',
        });
      }

      // Validate direction
      if (direction !== 'incoming' && direction !== 'outgoing') {
        return reply.status(400).send({
          message: 'The "direction" parameter must be "incoming", "outgoing", "in", or "out"',
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
      const { leader, limit = '10', offset = '0' } = request.query;

      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      // Leader is optional - fallback to the user's own address
      const leaderAddress = leader
        ? await resolveAddressOrENS(leader)
        : address;

      if (!leaderAddress) {
        return reply.status(404).send({ response: 'ENS name not valid or does not exist' });
      }

      const limitNum = Math.min(parseInt(limit, 10) || 10, 100);
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
          name: r.name || '',
          avatar: r.avatar || '',
          header: r.header || '',
          mutuals_rank: parseInt(String(r.mutuals_rank), 10) || 0,
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
  app.get<{
    Params: AddressParams;
    Querystring: {
      limit?: string;
      offset?: string;
      interval?: string;
      opcode?: string;
      tag?: string;
      start?: string;
    };
  }>('/users/:addressOrENS/notifications', async (request, reply) => {
    const address = await resolveAddress(request.params.addressOrENS, reply);
    if (!address) return;

    const {
      limit = '10',
      offset = '0',
      interval = 'week',
      opcode = '0',
      tag = 'p_tag_empty',
      start,
    } = request.query;

    // Default start to current time (Unix timestamp in seconds) if not provided
    const startTimestamp = start && start !== ''
      ? parseInt(start, 10)
      : Math.floor(Date.now() / 1000);

    // Convert interval keyword to PostgreSQL interval
    const intervalMap: Record<string, string> = {
      hour: '1 hour',
      day: '24 hours',
      week: '168 hours',
      month: '720 hours',
      all: '999999 hours',
    };
    const pgInterval = intervalMap[interval] || interval;

    const result = await getNotifications(address, {
      limit: Math.min(parseInt(limit, 10) || 10, 100),
      offset: parseInt(offset, 10) || 0,
      opcode: parseInt(opcode, 10) || 0,
      interval: pgInterval,
      tag,
      start: startTimestamp,
    });

    return result;
  });

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

  // GET /users/:addressOrENS/qr - QR code with EFP branding
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/qr',
    async (request, reply) => {
      const { addressOrENS } = request.params;

      let address: Address;
      let ensName: string | null = null;
      let ensAvatar: string | undefined;

      if (isAddress(addressOrENS)) {
        address = addressOrENS.toLowerCase() as Address;
        const profile = await getENSProfile(address);
        ensName = profile?.name || null;
        ensAvatar = profile?.avatar || undefined;
      } else {
        const resolved = await resolveAddressOrENS(addressOrENS);
        if (!resolved) {
          return reply.status(404).send({ response: 'ENS name not valid or does not exist' });
        }
        address = resolved;
        ensName = addressOrENS;
        const profile = await getENSProfile(address);
        ensAvatar = profile?.avatar || undefined;
      }

      const profileImageSVG = ensAvatar ? await getProfileImage(ensAvatar) : '';

      let image = qrcode.imageSync(`https://ethfollow.xyz/${address}`, { type: 'svg' }).toString('utf-8');
      image = image
        .replace(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 39 39">',
          `<svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 39 44">
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#FFE067;stop-opacity:1" />
                <stop offset="80%" style="stop-color:#FFF7D9;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="grad-logo" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:#FFE067;stop-opacity:1" />
              <stop offset="80%" style="stop-color:#FFF7D9;stop-opacity:1" />
            </linearGradient>
          </defs>
          <style>
            text {
              font-family: sans-serif;
              font-size: 3.5px;
              font-weight: bold;
              text-anchor: middle;
              dominant-baseline: middle;
            }
          </style>
        <rect width="100%" height="100%" fill="#333333"/>`
        )
        .replace(/<path/g, '<path fill="url(#grad1)" ');

      const svgWithLogo = image.replace(
        '</svg>',
        `${efplogoSVG}${profileImageSVG}${getGradientText(ensName || address)}</svg>`
      );

      reply.type('image/svg+xml;charset=utf-8').send(svgWithLogo);
    }
  );

  // GET /users/:addressOrENS/poap - POAP claim link
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS/poap',
    async (request, reply) => {
      const address = await resolveAddress(request.params.addressOrENS, reply);
      if (!address) return;

      // Check if user has an existing claim
      const existingResult = await query<{ link: string }>(
        `SELECT link FROM efp_poap_links WHERE claimant = $1 LIMIT 1`,
        [address]
      );
      if (existingResult.rows.length > 0) {
        return { link: existingResult.rows[0].link };
      }

      // Get an unclaimed link
      const unclaimedResult = await query<{ link: string }>(
        `SELECT link FROM efp_poap_links WHERE claimed = false LIMIT 1`,
        []
      );
      if (unclaimedResult.rows.length === 0) {
        return { link: '' };
      }

      const link = unclaimedResult.rows[0].link;

      // Claim the link
      await query(
        `UPDATE efp_poap_links SET claimant = $1, claimed = true WHERE link = $2`,
        [address, link]
      );

      return { link };
    }
  );

  // GET /users/:addressOrENS - Base path returns 501 with available subpaths
  // MUST be registered LAST to avoid catching other routes
  app.get<{ Params: AddressParams }>(
    '/users/:addressOrENS',
    async (request, reply) => {
      return reply.status(501).send({
        message:
          'Not a valid endpoint. Available subpaths: /account, /allFollowers, /commonFollowers, /allFollowing, /details, /ens, /followers, /followerState, /following, /lists, /poap, /primary-list, /profile, /qr, /recommended, /relationships, /searchFollowers, /searchFollowing, /stats, /taggedAs, /tags',
      });
    }
  );
}
