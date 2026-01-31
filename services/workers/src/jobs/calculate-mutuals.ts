import type PgBoss from 'pg-boss';
import { query, createLogger } from '@efp/shared';

const logger = createLogger('calculate-mutuals');

interface CalculateMutualsJob {
  addressA: string;
  addressB: string;
}

export async function handleCalculateMutuals(
  job: PgBoss.Job<CalculateMutualsJob>
): Promise<void> {
  const { addressA, addressB } = job.data;

  // Normalize order (always store smaller address first)
  const [addrA, addrB] = [addressA.toLowerCase(), addressB.toLowerCase()].sort();

  logger.debug({ addrA, addrB }, 'Calculating mutual status');

  // Check if mutual relationship exists
  const mutualCheck = await query<{ a_follows_b: boolean; b_follows_a: boolean }>(
    `
    SELECT
      EXISTS (
        SELECT 1 FROM efp_followers
        WHERE address = $1 AND follower_address = $2
          AND is_blocked = FALSE AND is_muted = FALSE
      ) as a_follows_b,
      EXISTS (
        SELECT 1 FROM efp_followers
        WHERE address = $2 AND follower_address = $1
          AND is_blocked = FALSE AND is_muted = FALSE
      ) as b_follows_a
  `,
    [addrB, addrA]
  );

  const { a_follows_b, b_follows_a } = mutualCheck.rows[0];
  const isMutual = a_follows_b && b_follows_a;

  if (isMutual) {
    // Upsert mutual relationship
    await query(
      `
      INSERT INTO efp_mutuals (address_a, address_b)
      VALUES ($1, $2)
      ON CONFLICT (address_a, address_b) DO NOTHING
    `,
      [addrA, addrB]
    );
    logger.info({ addrA, addrB }, 'Added mutual relationship');
  } else {
    // Remove mutual relationship if it exists
    const deleted = await query(
      `
      DELETE FROM efp_mutuals
      WHERE address_a = $1 AND address_b = $2
      RETURNING *
    `,
      [addrA, addrB]
    );

    if (deleted.rowCount && deleted.rowCount > 0) {
      logger.info({ addrA, addrB }, 'Removed mutual relationship');
    }
  }
}
