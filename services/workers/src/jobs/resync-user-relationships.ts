import type PgBoss from 'pg-boss';
import { getClient, createLogger } from '@efp/shared';

const logger = createLogger('resync-user-relationships');

interface ResyncUserRelationshipsJob {
  address: string;
  newPrimaryList: number | null;
}

export async function handleResyncUserRelationships(
  job: PgBoss.Job<ResyncUserRelationshipsJob>
): Promise<void> {
  const { address, newPrimaryList } = job.data;

  logger.info({ address, newPrimaryList }, 'Resyncing user relationships');

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Remove all existing follower relationships where this user is the follower
    await client.query(
      `DELETE FROM efp_followers WHERE follower_address = $1`,
      [address]
    );

    // Remove all existing following relationships for this user
    await client.query(
      `DELETE FROM efp_following WHERE address = $1`,
      [address]
    );

    // Remove all mutuals involving this user
    await client.query(
      `DELETE FROM efp_mutuals WHERE address_a = $1 OR address_b = $1`,
      [address]
    );

    // If they have a new primary list, repopulate relationships
    if (newPrimaryList !== null) {
      // Get the list's storage location
      const listResult = await client.query<{
        chain_id: number;
        contract_address: string;
        slot: Buffer;
      }>(
        `
        SELECT
          list_storage_location_chain_id as chain_id,
          list_storage_location_contract_address as contract_address,
          list_storage_location_slot as slot
        FROM efp_lists
        WHERE token_id = $1 AND "user" = $2
      `,
        [newPrimaryList, address]
      );

      if (listResult.rows.length > 0) {
        const { chain_id, contract_address, slot } = listResult.rows[0];

        // Repopulate efp_followers
        await client.query(
          `
          INSERT INTO efp_followers (address, follower_address, follower_list_id, is_blocked, is_muted, tags)
          SELECT
            '0x' || encode(r.record_data, 'hex'),
            $4,
            $1,
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'block'),
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'mute'),
            COALESCE((SELECT array_agg(DISTINCT t.tag ORDER BY t.tag) FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record), '{}')
          FROM efp_list_records r
          WHERE r.chain_id = $2
            AND r.contract_address = $3
            AND r.slot = $5
            AND r.record_type = 1
          ON CONFLICT (address, follower_address) DO UPDATE SET
            follower_list_id = EXCLUDED.follower_list_id,
            is_blocked = EXCLUDED.is_blocked,
            is_muted = EXCLUDED.is_muted,
            tags = EXCLUDED.tags,
            updated_at = NOW()
        `,
          [newPrimaryList, chain_id, contract_address, address, slot]
        );

        // Repopulate efp_following
        await client.query(
          `
          INSERT INTO efp_following (address, list_id, following_address, is_blocked, is_muted, tags)
          SELECT
            $4,
            $1,
            '0x' || encode(r.record_data, 'hex'),
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'block'),
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'mute'),
            COALESCE((SELECT array_agg(DISTINCT t.tag ORDER BY t.tag) FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record), '{}')
          FROM efp_list_records r
          WHERE r.chain_id = $2
            AND r.contract_address = $3
            AND r.slot = $5
            AND r.record_type = 1
          ON CONFLICT (address, following_address) DO UPDATE SET
            list_id = EXCLUDED.list_id,
            is_blocked = EXCLUDED.is_blocked,
            is_muted = EXCLUDED.is_muted,
            tags = EXCLUDED.tags,
            updated_at = NOW()
        `,
          [newPrimaryList, chain_id, contract_address, address, slot]
        );
      }
    }

    await client.query('COMMIT');

    logger.info({ address, newPrimaryList }, 'Completed user relationship resync');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
