import type { FastifyInstance } from 'fastify';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('export-routes');

interface TokenParams {
  tokenId: string;
}

export async function exportRoutes(app: FastifyInstance) {
  // GET /exportState/:tokenId (P3)
  // Export list records - response shape: { following: [...] }
  app.get<{ Params: TokenParams }>(
    '/exportState/:tokenId',
    async (request, reply) => {
      const { tokenId } = request.params;

      // Get list storage location
      const listResult = await query<{
        list_storage_location_chain_id: number;
        list_storage_location_contract_address: string;
        list_storage_location_slot: string;
      }>(
        `
        SELECT list_storage_location_chain_id,
               list_storage_location_contract_address,
               list_storage_location_slot
        FROM efp_lists
        WHERE token_id = $1
      `,
        [tokenId]
      );

      if (listResult.rows.length === 0) {
        return reply.status(404).send({ response: 'List not found' });
      }

      const list = listResult.rows[0];

      // Get all records with their tags
      const recordsResult = await query<{
        record_version: number;
        record_type: number;
        record_data: string;
        tags: string[] | null;
      }>(
        `
        SELECT r.record_version, r.record_type, r.record_data,
               array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL) as tags
        FROM efp_list_records r
        LEFT JOIN efp_list_record_tags t ON
          t.chain_id = r.chain_id AND
          t.contract_address = r.contract_address AND
          t.slot = r.slot AND
          t.record = r.record
        WHERE r.chain_id = $1 AND r.contract_address = $2 AND r.slot = $3
        GROUP BY r.record_version, r.record_type, r.record_data, r.record
        ORDER BY r.record
      `,
        [
          list.list_storage_location_chain_id,
          list.list_storage_location_contract_address,
          list.list_storage_location_slot,
        ]
      );

      const recordTypeMap: Record<number, string> = {
        1: 'address',
        2: 'nft',
        3: 'list',
      };

      const following = recordsResult.rows.map((row) => ({
        version: row.record_version,
        record_type: recordTypeMap[row.record_type] || 'unknown',
        data: row.record_data,
        tags: row.tags,
      }));

      return { following };
    }
  );
}
