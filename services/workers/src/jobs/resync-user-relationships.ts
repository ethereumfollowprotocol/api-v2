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

  // Track addresses for stats updates
  let oldFollowedAddresses: string[] = [];
  let oldMutualAddresses: string[] = [];
  let newFollowedAddresses: string[] = [];

  try {
    await client.query('BEGIN');

    // 1. Capture addresses this user was following BEFORE deletion
    const oldFollowingResult = await client.query<{ following_address: string }>(
      `SELECT following_address FROM efp_following
       WHERE address = $1 AND is_blocked = FALSE AND is_muted = FALSE`,
      [address]
    );
    oldFollowedAddresses = oldFollowingResult.rows.map((r) => r.following_address);

    // 2. Capture mutual addresses BEFORE deletion
    const oldMutualsResult = await client.query<{ other: string }>(
      `SELECT CASE
         WHEN address_a = $1 THEN address_b
         ELSE address_a
       END as other
       FROM efp_mutuals
       WHERE address_a = $1 OR address_b = $1`,
      [address]
    );
    oldMutualAddresses = oldMutualsResult.rows.map((r) => r.other);

    // 3. Remove all existing follower relationships where this user is the follower
    await client.query(`DELETE FROM efp_followers WHERE follower_address = $1`, [address]);

    // 4. Remove all existing following relationships for this user
    await client.query(`DELETE FROM efp_following WHERE address = $1`, [address]);

    // 5. Remove all mutuals involving this user
    await client.query(`DELETE FROM efp_mutuals WHERE address_a = $1 OR address_b = $1`, [address]);

    // 6. If they have a new primary list, repopulate relationships
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
        WHERE token_id = $1 AND ("user" = $2 OR owner = $2)
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
            convert_from(r.record_data, 'UTF8'),
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
            AND length(convert_from(r.record_data, 'UTF8')) = 42
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
            convert_from(r.record_data, 'UTF8'),
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'block'),
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'mute'),
            COALESCE((SELECT array_agg(DISTINCT t.tag ORDER BY t.tag) FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record), '{}')
          FROM efp_list_records r
          WHERE r.chain_id = $2
            AND r.contract_address = $3
            AND r.slot = $5
            AND r.record_type = 1
            AND length(convert_from(r.record_data, 'UTF8')) = 42
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

    // 7. Capture NEW followed addresses (non-blocked, non-muted)
    const newFollowingResult = await client.query<{ following_address: string }>(
      `SELECT following_address FROM efp_following
       WHERE address = $1 AND is_blocked = FALSE AND is_muted = FALSE`,
      [address]
    );
    newFollowedAddresses = newFollowingResult.rows.map((r) => r.following_address);

    // 8. Compute delta: who lost this user as a follower, who gained
    const oldSet = new Set(oldFollowedAddresses);
    const newSet = new Set(newFollowedAddresses);

    const lostFollower = oldFollowedAddresses.filter((a) => !newSet.has(a));
    const gainedFollower = newFollowedAddresses.filter((a) => !oldSet.has(a));

    logger.info(
      {
        address,
        oldCount: oldFollowedAddresses.length,
        newCount: newFollowedAddresses.length,
        lostFollowerCount: lostFollower.length,
        gainedFollowerCount: gainedFollower.length,
      },
      'Computed follower delta'
    );

    // 9. Direct SQL update: decrement followers_count for those who lost this user
    if (lostFollower.length > 0) {
      await client.query(
        `UPDATE efp_user_stats
         SET followers_count = GREATEST(0, followers_count - 1)
         WHERE address = ANY($1)`,
        [lostFollower]
      );
      logger.debug({ count: lostFollower.length }, 'Decremented followers_count');
    }

    // 10. Direct SQL update: increment followers_count for those who gained this user
    if (gainedFollower.length > 0) {
      await client.query(
        `UPDATE efp_user_stats
         SET followers_count = followers_count + 1
         WHERE address = ANY($1)`,
        [gainedFollower]
      );

      // Ensure stats rows exist for new followers (insert if missing)
      await client.query(
        `INSERT INTO efp_user_stats (address, followers_count)
         SELECT unnest($1::varchar[]), 1
         ON CONFLICT (address) DO NOTHING`,
        [gainedFollower]
      );
      logger.debug({ count: gainedFollower.length }, 'Incremented followers_count');
    }

    // 11. Decrement mutuals_count for previously mutual users
    if (oldMutualAddresses.length > 0) {
      await client.query(
        `UPDATE efp_user_stats
         SET mutuals_count = GREATEST(0, mutuals_count - 1)
         WHERE address = ANY($1)`,
        [oldMutualAddresses]
      );
      logger.debug({ count: oldMutualAddresses.length }, 'Decremented mutuals_count for old mutuals');
    }

    // 12. Update the user's own stats: following_count and primary_list_id
    await client.query(
      `INSERT INTO efp_user_stats (address, primary_list_id, following_count, mutuals_count)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (address) DO UPDATE SET
         primary_list_id = $2,
         following_count = $3,
         mutuals_count = 0,
         updated_at = NOW()`,
      [address, newPrimaryList, newFollowedAddresses.length]
    );

    await client.query('COMMIT');

    logger.info({ address, newPrimaryList }, 'Completed user relationship resync');

    // 13. After commit, queue batch-recalculate-mutuals job if there are affected addresses
    const allAffectedAddresses = [...new Set([...oldMutualAddresses, ...newFollowedAddresses])];
    if (allAffectedAddresses.length > 0) {
      const boss = (job as unknown as { boss: PgBoss }).boss;
      if (boss) {
        await boss.send('batch-recalculate-mutuals', {
          userAddress: address,
          affectedAddresses: allAffectedAddresses,
        });
        logger.info(
          { address, affectedCount: allAffectedAddresses.length },
          'Queued batch-recalculate-mutuals job'
        );
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
