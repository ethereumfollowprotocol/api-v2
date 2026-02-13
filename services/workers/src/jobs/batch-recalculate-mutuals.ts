import type PgBoss from 'pg-boss';
import { getClient, createLogger } from '@efp/shared';

const logger = createLogger('batch-recalculate-mutuals');

interface BatchRecalculateMutualsJob {
  userAddress: string;
  affectedAddresses: string[];
}

const BATCH_SIZE = 100;

export async function handleBatchRecalculateMutuals(
  job: PgBoss.Job<BatchRecalculateMutualsJob>
): Promise<void> {
  const { userAddress, affectedAddresses } = job.data;

  if (!affectedAddresses || affectedAddresses.length === 0) {
    logger.debug({ userAddress }, 'No affected addresses to process');
    return;
  }

  logger.info(
    { userAddress, affectedCount: affectedAddresses.length },
    'Starting batch mutual recalculation'
  );

  const client = await getClient();
  const newMutuals: Array<{ addrA: string; addrB: string }> = [];
  const affectedMutualCounts = new Map<string, number>(); // Track how many new mutuals each address gains

  try {
    // Process in batches
    for (let i = 0; i < affectedAddresses.length; i += BATCH_SIZE) {
      const batch = affectedAddresses.slice(i, i + BATCH_SIZE);

      // Check mutual status for each address in the batch
      const result = await client.query<{
        other_address: string;
        user_follows_other: boolean;
        other_follows_user: boolean;
      }>(
        `
        SELECT
          other_addr as other_address,
          EXISTS (
            SELECT 1 FROM efp_followers
            WHERE address = other_addr AND follower_address = $1
              AND is_blocked = FALSE AND is_muted = FALSE
          ) as user_follows_other,
          EXISTS (
            SELECT 1 FROM efp_followers
            WHERE address = $1 AND follower_address = other_addr
              AND is_blocked = FALSE AND is_muted = FALSE
          ) as other_follows_user
        FROM unnest($2::varchar[]) as other_addr
      `,
        [userAddress, batch]
      );

      for (const row of result.rows) {
        const isMutual = row.user_follows_other && row.other_follows_user;
        if (isMutual) {
          // Normalize order: always store smaller address first
          const [addrA, addrB] = [userAddress.toLowerCase(), row.other_address.toLowerCase()].sort();
          newMutuals.push({ addrA, addrB });
          affectedMutualCounts.set(
            row.other_address.toLowerCase(),
            (affectedMutualCounts.get(row.other_address.toLowerCase()) || 0) + 1
          );
        }
      }
    }

    // Insert new mutuals (if any)
    await client.query('BEGIN');

    if (newMutuals.length > 0) {
      // Batch insert mutuals
      const values = newMutuals.map((m) => `('${m.addrA}', '${m.addrB}')`).join(', ');
      await client.query(`
        INSERT INTO efp_mutuals (address_a, address_b)
        VALUES ${values}
        ON CONFLICT (address_a, address_b) DO NOTHING
      `);

      logger.info({ count: newMutuals.length }, 'Inserted new mutual relationships');
    }

    // Update mutuals_count for the user
    await client.query(
      `UPDATE efp_user_stats
       SET mutuals_count = (
         SELECT COUNT(*) FROM efp_mutuals
         WHERE address_a = $1 OR address_b = $1
       )
       WHERE address = $1`,
      [userAddress]
    );

    // Update mutuals_count for affected addresses that gained new mutuals
    if (affectedMutualCounts.size > 0) {
      const addressesToUpdate = Array.from(affectedMutualCounts.keys());
      await client.query(
        `UPDATE efp_user_stats us
         SET mutuals_count = (
           SELECT COUNT(*) FROM efp_mutuals
           WHERE address_a = us.address OR address_b = us.address
         )
         WHERE us.address = ANY($1)`,
        [addressesToUpdate]
      );

      logger.debug(
        { count: addressesToUpdate.length },
        'Updated mutuals_count for affected addresses'
      );
    }

    await client.query('COMMIT');

    logger.info(
      {
        userAddress,
        newMutualsCount: newMutuals.length,
        affectedAddressesUpdated: affectedMutualCounts.size,
      },
      'Completed batch mutual recalculation'
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
