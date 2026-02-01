import type { FastifyInstance } from 'fastify';
import { query, convertHexToBigInt, toStringOrNull, type Address, createLogger } from '@efp/shared';
import { getENSProfile } from '../services/ens.js';
import { getFollowers, getFollowing, getFollowerState, searchFollowers, searchFollowing } from '../services/followers.js';
import { getListTags, getListTaggedAs } from '../services/tags.js';
import { getRecommendations, getRecommendationsWithDetails } from '../services/recommendations.js';
import { getPOAPBadges } from '../services/poap.js';
import { resolveAddressOrENS } from '../services/address.js';

const logger = createLogger('lists-routes');

interface TokenParams {
  tokenId: string;
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
  sort?: string;
  tags?: string;
  include?: string;
}

// Get list info by token ID
async function getListInfo(
  tokenId: string
): Promise<{
  token_id: string;
  owner: Address;
  manager: Address | null;
  user: Address | null;
} | null> {
  const result = await query<{
    token_id: string;
    owner: string;
    manager: string | null;
    user: string | null;
  }>(
    `
    SELECT token_id::TEXT, owner, manager, "user"
    FROM efp_lists
    WHERE token_id = $1
  `,
    [tokenId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    token_id: row.token_id,
    owner: row.owner.toLowerCase() as Address,
    manager: row.manager?.toLowerCase() as Address | null,
    user: row.user?.toLowerCase() as Address | null,
  };
}

export async function listsRoutes(app: FastifyInstance) {
  // GET /lists/:tokenId/account (P1)
  // Response shape must match production: { address, ens, is_primary_list, primary_list }
  app.get<{ Params: TokenParams }>(
    '/lists/:tokenId/account',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      // Get ENS for user or owner
      const address = list.user || list.owner;

      // Get primary list for the address
      const [ens, primaryListResult] = await Promise.all([
        getENSProfile(address),
        query<{ value: string }>(
          `SELECT value FROM efp_account_metadata WHERE address = $1 AND key = 'primary-list'`,
          [address]
        ),
      ]);

      let primaryList: string | null = null;
      if (primaryListResult.rows[0]?.value) {
        primaryList = convertHexToBigInt(primaryListResult.rows[0].value).toString();
      }

      const isPrimaryList = primaryList === tokenId;

      return {
        address,
        ens: ens || null,
        is_primary_list: isPrimaryList,
        primary_list: primaryList,
      };
    }
  );

  // GET /lists/:tokenId/details (P1)
  // Response shape must match production: { address, ens, ranks, primary_list }
  app.get<{ Params: TokenParams }>(
    '/lists/:tokenId/details',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;

      // Get ENS and ranks
      const [ens, ranksResult] = await Promise.all([
        getENSProfile(address),
        query<{
          followers_rank: number | null;
          following_rank: number | null;
          mutuals_rank: number | null;
          blocks_rank: number | null;
          top8_rank: number | null;
        }>(
          `SELECT followers_rank, following_rank, mutuals_rank, blocks_rank, top8_rank
           FROM efp_leaderboard WHERE address = $1`,
          [address]
        ),
      ]);

      return {
        address,
        ens: ens || null,
        ranks: {
          mutuals_rank: toStringOrNull(ranksResult.rows[0]?.mutuals_rank),
          followers_rank: toStringOrNull(ranksResult.rows[0]?.followers_rank),
          following_rank: toStringOrNull(ranksResult.rows[0]?.following_rank),
          top8_rank: toStringOrNull(ranksResult.rows[0]?.top8_rank),
          blocks_rank: ranksResult.rows[0]?.blocks_rank ?? 0,
        },
        primary_list: tokenId,
      };
    }
  );

  // GET /lists/:tokenId/stats (P1)
  app.get<{ Params: TokenParams }>(
    '/lists/:tokenId/stats',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;

      const result = await query<{
        followers_count: number;
        following_count: number;
      }>(
        `SELECT followers_count, following_count FROM efp_user_stats WHERE address = $1`,
        [address]
      );

      return {
        followers_count: result.rows[0]?.followers_count ?? 0,
        following_count: result.rows[0]?.following_count ?? 0,
      };
    }
  );

  // GET /lists/:tokenId/followers (P1)
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/followers',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
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

  // GET /lists/:tokenId/following (P1)
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/following',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
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

  // GET /lists/:tokenId/allFollowers (P1)
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/allFollowers',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
      const { sort = 'latest', tags, include } = request.query;

      const followers = await getFollowers(address, {
        limit: 10000,
        offset: 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: include?.includes('ens'),
      });

      return { followers };
    }
  );

  // GET /lists/:tokenId/allFollowing (P1)
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/allFollowing',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
      const { sort = 'latest', tags, include } = request.query;

      const following = await getFollowing(address, {
        limit: 10000,
        offset: 0,
        sort: sort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: include?.includes('ens'),
      });

      return { following };
    }
  );

  // GET /lists/:tokenId/records (P2)
  // Response shape must match production: { records: [{ version, record_type: "address", data, tags }] }
  app.get<{ Params: TokenParams }>(
    '/lists/:tokenId/records',
    async (request, reply) => {
      const { tokenId } = request.params;

      // Get list storage location
      const listResult = await query<{
        list_storage_location_chain_id: number;
        list_storage_location_contract_address: string;
        list_storage_location_slot: string;
      }>(
        `SELECT list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot
         FROM efp_lists WHERE token_id = $1`,
        [tokenId]
      );

      if (listResult.rows.length === 0) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const { list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot } =
        listResult.rows[0];

      // Get records with their tags
      const recordsResult = await query<{
        record_version: number;
        record_type: number;
        record_data: string;
        tags: string[] | null;
      }>(
        `SELECT r.record_version, r.record_type, '0x' || encode(r.record_data, 'hex') as record_data,
                array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL) as tags
         FROM efp_list_records r
         LEFT JOIN efp_list_record_tags t ON
           t.chain_id = r.chain_id AND
           t.contract_address = r.contract_address AND
           t.slot = r.slot AND
           t.record = r.record
         WHERE r.chain_id = $1 AND r.contract_address = $2 AND r.slot = $3
         GROUP BY r.record_version, r.record_type, r.record_data, r.record`,
        [list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot]
      );

      // Map record_type number to string
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

  // GET /lists/:tokenId/latestFollowers (P2)
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/latestFollowers',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
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

  // GET /lists/:tokenId/allFollowingAddresses (P2)
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/allFollowingAddresses',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;

      const following = await getFollowing(address, {
        limit: 100000,
        offset: 0,
        sort: 'latest',
      });

      // Return just the addresses as an array
      return following.map((f: { address: string }) => f.address);
    }
  );

  // GET /lists/:tokenId/recommended (P3)
  app.get<{ Params: TokenParams; Querystring: { limit?: string; offset?: string; seed?: string } }>(
    '/lists/:tokenId/recommended',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
      const { limit = '10', offset = '0', seed } = request.query;

      const recommended = await getRecommendations(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        seed: seed ? parseInt(seed, 10) : undefined,
      });

      return { recommended };
    }
  );

  // GET /lists/:tokenId/recommended/details (P3)
  app.get<{ Params: TokenParams; Querystring: { limit?: string; offset?: string } }>(
    '/lists/:tokenId/recommended/details',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
      const { limit = '10', offset = '0' } = request.query;

      const recommended = await getRecommendationsWithDetails(address, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
      });

      return { recommended };
    }
  );

  // GET /lists/:tokenId/searchFollowers (P3)
  app.get<{ Params: TokenParams; Querystring: { term?: string; limit?: string; offset?: string; include?: string } }>(
    '/lists/:tokenId/searchFollowers',
    async (request, reply) => {
      const { tokenId } = request.params;
      const { term = '', limit = '10', offset = '0', include } = request.query;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      if (!term || term.length < 2) {
        return { followers: [] };
      }

      const address = list.user || list.owner;
      const followers = await searchFollowers(address, term, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        includeENS: include?.includes('ens'),
      });

      return { followers };
    }
  );

  // GET /lists/:tokenId/searchFollowing (P3)
  app.get<{ Params: TokenParams; Querystring: { term?: string; limit?: string; offset?: string; include?: string } }>(
    '/lists/:tokenId/searchFollowing',
    async (request, reply) => {
      const { tokenId } = request.params;
      const { term = '', limit = '10', offset = '0', include } = request.query;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      if (!term || term.length < 2) {
        return { following: [] };
      }

      const address = list.user || list.owner;
      const following = await searchFollowing(address, term, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        includeENS: include?.includes('ens'),
      });

      return { following };
    }
  );

  // GET /lists/:tokenId/tags (P2)
  app.get<{ Params: TokenParams }>(
    '/lists/:tokenId/tags',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      // Get all tags used by this list
      const listResult = await query<{
        list_storage_location_chain_id: number;
        list_storage_location_contract_address: string;
        list_storage_location_slot: string;
      }>(
        `SELECT list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot
         FROM efp_lists WHERE token_id = $1`,
        [tokenId]
      );

      if (listResult.rows.length === 0) {
        return { token_id: tokenId, tags: [], tagCounts: {}, taggedAddresses: {} };
      }

      const { list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot } =
        listResult.rows[0];

      const tagsResult = await query<{ tag: string; count: string }>(
        `SELECT tag, COUNT(*)::TEXT as count
         FROM efp_list_record_tags
         WHERE chain_id = $1 AND contract_address = $2 AND slot = $3
         GROUP BY tag`,
        [list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot]
      );

      const tags = tagsResult.rows.map((r) => r.tag);
      const tagCounts: Record<string, string> = {};
      tagsResult.rows.forEach((r) => {
        tagCounts[r.tag] = r.count;
      });

      // Get taggedAddresses
      const taggedAddressesResult = await query<{ tag: string; record_data: string }>(
        `SELECT t.tag, '0x' || encode(r.record_data, 'hex') as record_data
         FROM efp_list_record_tags t
         JOIN efp_list_records r ON
           r.chain_id = t.chain_id AND
           r.contract_address = t.contract_address AND
           r.slot = t.slot AND
           r.record = t.record
         WHERE t.chain_id = $1 AND t.contract_address = $2 AND t.slot = $3`,
        [list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot]
      );

      const taggedAddresses = taggedAddressesResult.rows.map((r) => ({
        address: r.record_data.toLowerCase(),
        tag: r.tag,
      }));

      return {
        token_id: tokenId,
        tags,
        tagCounts: tagsResult.rows.map((r) => ({ tag: r.tag, count: parseInt(r.count, 10) })),
        taggedAddresses,
      };
    }
  );

  // GET /lists/:tokenId/taggedAs (P3)
  app.get<{ Params: TokenParams }>(
    '/lists/:tokenId/taggedAs',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
      return await getListTaggedAs(tokenId, address);
    }
  );

  // GET /lists/:tokenId/badges (P3)
  app.get<{ Params: TokenParams }>(
    '/lists/:tokenId/badges',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
      const poaps = await getPOAPBadges(address);
      return { poaps };
    }
  );

  // GET /lists/:tokenId/:addressOrENS/followerState (P2)
  app.get<{ Params: TokenParams & { addressOrENS: string } }>(
    '/lists/:tokenId/:addressOrENS/followerState',
    async (request, reply) => {
      const { tokenId, addressOrENS } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      // Resolve address
      const targetAddress = await resolveAddressOrENS(addressOrENS);
      if (!targetAddress) {
        return reply.status(400).send({ response: 'ENS name not valid or does not exist' });
      }

      const state = await getFollowerState(tokenId, targetAddress);

      return {
        token_id: tokenId,
        address: targetAddress,
        state,
      };
    }
  );
}
