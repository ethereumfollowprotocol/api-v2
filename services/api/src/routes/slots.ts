import type { FastifyInstance } from 'fastify';
import { query, createLogger, type Address } from '@efp/shared';
import { getENSProfile } from '../services/ens.js';

const logger = createLogger('slots-routes');

interface SlotParams {
  chainId: string;
  contract: string;
  '*': string;
}

export async function slotsRoutes(app: FastifyInstance) {
  // GET /slots/:chainId/:contract/:slot/details (P3)
  // Get list details by storage location
  // Use wildcard for slot since it can be a long hex string
  app.get<{ Params: SlotParams }>(
    '/slots/:chainId/:contract/*',
    async (request, reply) => {
      const { chainId, contract } = request.params;
      const slotPath = request.params['*'];
      // Extract slot from path (remove /details suffix if present)
      const slot = slotPath.replace(/\/details$/, '');

      // Find the list by storage location
      const result = await query<{
        token_id: string;
        owner: string;
        manager: string | null;
        user: string | null;
      }>(
        `
        SELECT token_id::TEXT, owner, manager, "user"
        FROM efp_lists
        WHERE list_storage_location_chain_id = $1
          AND LOWER(list_storage_location_contract_address) = LOWER($2)
          AND list_storage_location_slot = $3
      `,
        [chainId, contract, slot]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ response: 'List not found for this storage location' });
      }

      const row = result.rows[0];
      const address = (row.user || row.owner).toLowerCase() as Address;

      // Get ENS and stats
      const [ens, statsResult, ranksResult] = await Promise.all([
        getENSProfile(address),
        query<{ followers_count: number; following_count: number }>(
          `SELECT followers_count, following_count FROM efp_user_stats WHERE address = $1`,
          [address]
        ),
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
        token_id: row.token_id,
        address,
        ens: ens || null,
        owner: row.owner.toLowerCase(),
        manager: row.manager?.toLowerCase() || null,
        user: row.user?.toLowerCase() || null,
        stats: {
          followers_count: statsResult.rows[0]?.followers_count ?? 0,
          following_count: statsResult.rows[0]?.following_count ?? 0,
        },
        ranks: {
          mutuals_rank: ranksResult.rows[0]?.mutuals_rank?.toString() || null,
          followers_rank: ranksResult.rows[0]?.followers_rank?.toString() || null,
          following_rank: ranksResult.rows[0]?.following_rank?.toString() || null,
          top8_rank: ranksResult.rows[0]?.top8_rank?.toString() || null,
          blocks_rank: ranksResult.rows[0]?.blocks_rank ?? 0,
        },
      };
    }
  );
}
