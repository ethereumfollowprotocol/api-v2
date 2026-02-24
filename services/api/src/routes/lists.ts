import type { FastifyInstance } from 'fastify';
import { query, convertHexToBigInt, toStringOrNull, type Address, createLogger } from '@efp/shared';
import { getENSProfile, getENSProfiles } from '../services/ens.js';
import { getFollowers, getListFollowing, getListFollowingCount, searchListFollowing, getListFollowerState, getListFollowingState, getListFollowingStateBatch, searchFollowers } from '../services/followers.js';
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
  include?: string | string[];
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

      // Get ENS, ranks, and primary list
      const [ens, ranksResult, primaryListResult] = await Promise.all([
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
        query<{ value: string }>(
          `SELECT value FROM efp_account_metadata WHERE address = $1 AND key = 'primary-list'`,
          [address]
        ),
      ]);

      let primaryList: string | null = null;
      if (primaryListResult.rows[0]?.value) {
        primaryList = convertHexToBigInt(primaryListResult.rows[0].value).toString();
      }

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
        primary_list: primaryList,
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

      const [statsResult, listFollowingCount] = await Promise.all([
        query<{ followers_count: number }>(
          `SELECT followers_count FROM efp_user_stats WHERE address = $1`,
          [address]
        ),
        getListFollowingCount(tokenId),
      ]);

      return {
        followers_count: statsResult.rows[0]?.followers_count ?? 0,
        following_count: listFollowingCount,
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

  // GET /lists/:tokenId/following (P1)
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/following',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const { limit = '10', offset = '0', sort = 'latest', tags, include } = request.query;
      const includeSet = parseIncludeParam(include);

      const following = await getListFollowing(tokenId, {
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

  // GET /lists/:tokenId/allFollowers (P1)
  // Returns all followers, but respects limit/offset if provided
  // NOTE: Old API uses 2-option sort (latest=DESC, else=ASC), not 3-option like other endpoints
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/allFollowers',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const address = list.user || list.owner;
      const { limit, offset = '0', sort = 'latest', tags, include } = request.query;
      const includeSet = parseIncludeParam(include);

      // If limit is provided, use it; otherwise return all (up to 10000)
      const effectiveLimit = limit ? Math.min(parseInt(limit, 10) || 10000, 10000) : 10000;
      const effectiveOffset = parseInt(offset, 10) || 0;

      // Old API uses 2-option sort: latest=DESC, anything else=ASC
      const sortDirection = sort === 'latest' ? 'DESC' : 'ASC';

      let tagFilter = '';
      const params: unknown[] = [address, effectiveLimit, effectiveOffset];

      if (tags) {
        const tagList = tags.split(',').filter(Boolean);
        if (tagList.length > 0) {
          tagFilter = 'AND f.tags && $4';
          params.push(tagList);
        }
      }

      // By default, exclude blocked/muted entries unless explicitly requested
      let blockedMutedFilter = '';
      if (!includeSet.has('blocked') && !includeSet.has('muted')) {
        blockedMutedFilter = 'AND f.is_blocked = FALSE AND f.is_muted = FALSE';
      } else if (!includeSet.has('blocked')) {
        blockedMutedFilter = 'AND f.is_blocked = FALSE';
      } else if (!includeSet.has('muted')) {
        blockedMutedFilter = 'AND f.is_muted = FALSE';
      }

      // Include is_mutual in query if requested
      const mutualSelect = includeSet.has('mutuals')
        ? `, EXISTS (
            SELECT 1 FROM efp_mutuals m
            WHERE (m.address_a = $1 AND m.address_b = f.follower_address)
               OR (m.address_b = $1 AND m.address_a = f.follower_address)
          ) as is_mutual`
        : '';

      const result = await query<{
        follower_address: string;
        follower_list_id: string;
        tags: string[];
        is_blocked: boolean;
        is_muted: boolean;
        updated_at: Date;
        is_following: boolean;
        is_mutual?: boolean;
      }>(
        `
        SELECT
          f.follower_address,
          f.follower_list_id::TEXT,
          f.tags,
          f.is_blocked,
          f.is_muted,
          f.updated_at,
          EXISTS (
            SELECT 1 FROM efp_following fw
            WHERE fw.address = $1 AND fw.following_address = f.follower_address
              AND fw.is_blocked = FALSE AND fw.is_muted = FALSE
          ) as is_following
          ${mutualSelect}
        FROM efp_followers f
        WHERE f.address = $1 ${tagFilter} ${blockedMutedFilter}
        ORDER BY f.updated_at ${sortDirection}
        LIMIT $2 OFFSET $3
        `,
        params
      );

      const followers = result.rows.map((row) => {
        const entry: Record<string, unknown> = {
          efp_list_nft_token_id: row.follower_list_id,
          address: row.follower_address.toLowerCase() as Address,
          tags: row.tags || [],
          is_following: row.is_following,
          is_blocked: row.is_blocked,
          is_muted: row.is_muted,
          updated_at: row.updated_at.toISOString(),
        };
        if (includeSet.has('mutuals') && row.is_mutual !== undefined) {
          entry.is_mutual = row.is_mutual;
        }
        return entry;
      });

      // Add ENS data if requested
      if (includeSet.has('ens') && followers.length > 0) {
        const addresses = followers.map((f) => f.address as Address);
        const ensProfiles = await getENSProfiles(addresses);

        for (const follower of followers) {
          const profile = ensProfiles.get(follower.address as Address);
          if (profile) {
            follower.ens = profile;
          }
        }
      }

      return { followers };
    }
  );

  // GET /lists/:tokenId/allFollowing (P1)
  // Returns all following, but respects limit/offset if provided
  // NOTE: Old API uses 2-option sort (latest=DESC, else=ASC), not 3-option like other endpoints
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/allFollowing',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const { limit, offset = '0', sort = 'latest', tags, include } = request.query;
      const includeSet = parseIncludeParam(include);

      // If limit is provided, use it; otherwise return all (up to 10000)
      const effectiveLimit = limit ? Math.min(parseInt(limit, 10) || 10000, 10000) : 10000;
      const effectiveOffset = parseInt(offset, 10) || 0;

      // Old API uses 2-option sort: latest=DESC, anything else=ASC
      const effectiveSort = sort === 'latest' ? 'latest' : 'earliest';

      const following = await getListFollowing(tokenId, {
        limit: effectiveLimit,
        offset: effectiveOffset,
        sort: effectiveSort as 'latest' | 'followers' | 'earliest',
        tags: tags?.split(',').filter(Boolean),
        includeENS: includeSet.has('ens'),
        includeMutuals: includeSet.has('mutuals'),
        includeBlocked: includeSet.has('blocked'),
        includeMuted: includeSet.has('muted'),
      });

      return { following };
    }
  );

  // GET /lists/:tokenId/records (P2)
  // Response shape must match production: { records: [{ version, record_type: "address", data, tags }] }
  // Optional `includeTags=false` to skip tag fetching for optimization
  app.get<{ Params: TokenParams; Querystring: { includeTags?: string } }>(
    '/lists/:tokenId/records',
    async (request, reply) => {
      const { tokenId } = request.params;
      const { includeTags } = request.query;

      // Default to true, only skip if explicitly set to 'false'
      const shouldIncludeTags = includeTags !== 'false';

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

      // Map record_type number to string
      const recordTypeMap: Record<number, string> = {
        1: 'address',
        2: 'nft',
        3: 'list',
      };

      if (shouldIncludeTags) {
        // Get records with their tags (default behavior)
        const recordsResult = await query<{
          record_version: number;
          record_type: number;
          record_data: string;
          tags: string[] | null;
        }>(
          `SELECT r.record_version, r.record_type, convert_from(r.record_data, 'UTF8') as record_data,
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

        const records = recordsResult.rows.map((row) => ({
          version: row.record_version,
          record_type: recordTypeMap[row.record_type] || 'unknown',
          data: row.record_data,
          tags: row.tags,
        }));

        return { records };
      } else {
        // Get records without tags (optimized)
        const recordsResult = await query<{
          record_version: number;
          record_type: number;
          record_data: string;
        }>(
          `SELECT r.record_version, r.record_type, convert_from(r.record_data, 'UTF8') as record_data
           FROM efp_list_records r
           WHERE r.chain_id = $1 AND r.contract_address = $2 AND r.slot = $3`,
          [list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot]
        );

        const records = recordsResult.rows.map((row) => ({
          version: row.record_version,
          record_type: recordTypeMap[row.record_type] || 'unknown',
          data: row.record_data,
        }));

        return { records };
      }
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

  // GET /lists/:tokenId/allFollowingAddresses (P2)
  app.get<{ Params: TokenParams; Querystring: PaginationQuery }>(
    '/lists/:tokenId/allFollowingAddresses',
    async (request, reply) => {
      const { tokenId } = request.params;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const following = await getListFollowing(tokenId, {
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
        includeENS: true,
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

      const following = await searchListFollowing(tokenId, term, {
        limit: Math.min(parseInt(limit, 10) || 10, 100),
        offset: parseInt(offset, 10) || 0,
        includeENS: true,
      });

      return { following };
    }
  );

  // GET /lists/:tokenId/tags (P2)
  // When `include` param is provided (comma-separated tags), returns filtered results
  // with different response shape: { token_id, tagsToSearch, taggedAddresses }
  app.get<{ Params: TokenParams; Querystring: { include?: string; cache?: string } }>(
    '/lists/:tokenId/tags',
    async (request, reply) => {
      const { tokenId } = request.params;
      const { include } = request.query;
      const list = await getListInfo(tokenId);

      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

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
        return { token_id: tokenId, tags: [], tagCounts: {}, taggedAddresses: {} };
      }

      const { list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot } =
        listResult.rows[0];

      // Parse and validate include filter (only letters allowed, like V1)
      const onlyLettersPattern = /^[A-Za-z]+$/;
      let tagsToSearch: string[] = [];
      if (include) {
        tagsToSearch = include.split(',').filter((tag) => tag.match(onlyLettersPattern));
      }

      // If filtering by specific tags, return filtered response
      if (tagsToSearch.length > 0) {
        const taggedAddressesResult = await query<{ tag: string; record_data: string }>(
          `SELECT t.tag, convert_from(r.record_data, 'UTF8') as record_data
           FROM efp_list_record_tags t
           JOIN efp_list_records r ON
             r.chain_id = t.chain_id AND
             r.contract_address = t.contract_address AND
             r.slot = t.slot AND
             r.record = t.record
           WHERE t.chain_id = $1 AND t.contract_address = $2 AND t.slot = $3
             AND t.tag = ANY($4)`,
          [list_storage_location_chain_id, list_storage_location_contract_address, list_storage_location_slot, tagsToSearch]
        );

        const taggedAddresses = taggedAddressesResult.rows.map((r) => ({
          address: r.record_data.toLowerCase(),
          tag: r.tag,
        }));

        return {
          token_id: tokenId,
          tagsToSearch,
          taggedAddresses,
        };
      }

      // Default behavior: return all tags
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
        `SELECT t.tag, convert_from(r.record_data, 'UTF8') as record_data
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

  // POST /lists/:tokenId/buttonStateBatch (P2)
  // Batch version of buttonState - accepts up to 50 addresses/ENS names
  app.post<{ Params: TokenParams }>(
    '/lists/:tokenId/buttonStateBatch',
    async (request, reply) => {
      const { tokenId } = request.params;
      const body = request.body;

      // Validate input
      if (!Array.isArray(body)) {
        return reply.status(400).send({ error: 'Request body must be a JSON array of addresses or ENS names' });
      }
      if (body.length === 0 || body.length > 50) {
        return reply.status(400).send({ error: 'Array must contain between 1 and 50 items' });
      }
      if (!body.every((item: unknown) => typeof item === 'string' && item.length > 0)) {
        return reply.status(400).send({ error: 'Each item must be a non-empty string' });
      }

      const list = await getListInfo(tokenId);
      if (!list) {
        return reply.status(404).send({ response: 'List not found' });
      }

      // Resolve all addresses in parallel
      const resolutions = await Promise.allSettled(
        (body as string[]).map(async (input) => {
          const address = await resolveAddressOrENS(input);
          if (!address) throw new Error('ENS name not valid or does not exist');
          return address;
        })
      );

      // Collect successfully resolved addresses
      const validAddresses: Address[] = [];
      for (const result of resolutions) {
        if (result.status === 'fulfilled') {
          validAddresses.push(result.value);
        }
      }

      // Batch query for all valid addresses
      const stateMap = validAddresses.length > 0
        ? await getListFollowingStateBatch(tokenId, validAddresses)
        : new Map();

      // Build response preserving input order
      const response = (body as string[]).map((input, i) => {
        const resolution = resolutions[i];
        if (resolution.status === 'rejected') {
          return {
            token_id: tokenId,
            address: input,
            state: null,
            error: resolution.reason?.message || 'ENS name not valid or does not exist',
          };
        }
        const address = resolution.value;
        const state = stateMap.get(address.toLowerCase() as Address) || { follow: false, block: false, mute: false };
        return {
          token_id: tokenId,
          address,
          state,
        };
      });

      return response;
    }
  );

  // GET /lists/:tokenId/:addressOrENS/followerState (P2)
  // Checks: Is the ADDRESS following the LIST's user?
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

      const state = await getListFollowerState(tokenId, targetAddress);

      return {
        token_id: tokenId,
        address: targetAddress,
        state,
      };
    }
  );

  // GET /lists/:tokenId/:addressOrENS/buttonState (P2)
  // Checks: Is the LIST following this ADDRESS? (for follow button UI state)
  app.get<{ Params: TokenParams & { addressOrENS: string } }>(
    '/lists/:tokenId/:addressOrENS/buttonState',
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

      const state = await getListFollowingState(tokenId, targetAddress);

      return {
        token_id: tokenId,
        address: targetAddress,
        state,
      };
    }
  );
}
