import type { FastifyInstance } from 'fastify';
import { query, convertHexToBigInt, toStringOrNull, type Address, createLogger } from '@efp/shared';
import { getENSProfile } from '../services/ens.js';
import { getFollowers, getFollowing } from '../services/followers.js';

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
        ens,
        is_primary_list: isPrimaryList,
        primary_list: primaryList,
      };
    }
  );

  // GET /lists/:tokenId/details (P1)
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
        token_id: list.token_id,
        address,
        ens,
        owner: list.owner,
        manager: list.manager,
        user: list.user,
        ranks: {
          mutuals_rank: toStringOrNull(ranksResult.rows[0]?.mutuals_rank),
          followers_rank: toStringOrNull(ranksResult.rows[0]?.followers_rank),
          following_rank: toStringOrNull(ranksResult.rows[0]?.following_rank),
          top8_rank: toStringOrNull(ranksResult.rows[0]?.top8_rank),
          blocks_rank: ranksResult.rows[0]?.blocks_rank ?? 0,
        },
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
        `SELECT r.record_version, r.record_type, r.record_data,
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
}
