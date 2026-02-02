import type PgBoss from 'pg-boss';
import { getClient, createLogger } from '@efp/shared';

const logger = createLogger('shuffle-recommended');

/**
 * Shuffles the efp_recommended table using weighted randomization
 * Class A: weight 0.5 (highest probability of appearing at top)
 * Class B: weight 0.35 + offset 0.1
 * Class C: weight 0.2 (lowest probability)
 *
 * This job runs every 15 minutes to keep recommendations fresh
 */
export async function handleShuffleRecommended(
  job: PgBoss.Job<Record<string, never>>
): Promise<void> {
  const startTime = Date.now();

  logger.info('Starting recommended shuffle');

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Get shuffled results using weighted randomization
    const shuffledResult = await client.query<{
      address: string;
      name: string;
      avatar: string;
      header: string | null;
      class: string;
    }>(`
      WITH
        ListA_Weighted AS (
          SELECT name, address, avatar, header, class, RANDOM() * 0.5 AS weighted_value
          FROM efp_recommended WHERE class = 'A'
        ),
        ListB_Weighted AS (
          SELECT name, address, avatar, header, class, 0.1 + RANDOM() * 0.35 AS weighted_value
          FROM efp_recommended WHERE class = 'B'
        ),
        ListC_Weighted AS (
          SELECT name, address, avatar, header, class, RANDOM() * 0.2 AS weighted_value
          FROM efp_recommended WHERE class = 'C'
        ),
        Combined AS (
          SELECT * FROM ListA_Weighted
          UNION ALL
          SELECT * FROM ListB_Weighted
          UNION ALL
          SELECT * FROM ListC_Weighted
        )
      SELECT name, address, avatar, header, class
      FROM Combined
      ORDER BY weighted_value DESC
    `);

    if (shuffledResult.rows.length === 0) {
      logger.warn('No recommended accounts found to shuffle');
      await client.query('ROLLBACK');
      return;
    }

    // Clear and repopulate with new indexes
    await client.query('TRUNCATE efp_recommended');

    // Insert with new indexes
    const insertValues = shuffledResult.rows.map((row, index) => ({
      index,
      address: row.address,
      name: row.name,
      avatar: row.avatar,
      header: row.header,
      class: row.class,
    }));

    // Batch insert
    const batchSize = 100;
    for (let i = 0; i < insertValues.length; i += batchSize) {
      const batch = insertValues.slice(i, i + batchSize);
      const values = batch.map((row, idx) => {
        const paramBase = idx * 6;
        return `($${paramBase + 1}, $${paramBase + 2}, $${paramBase + 3}, $${paramBase + 4}, $${paramBase + 5}, $${paramBase + 6})`;
      }).join(', ');

      const params = batch.flatMap((row) => [
        row.index,
        row.address,
        row.name,
        row.avatar,
        row.header,
        row.class,
      ]);

      await client.query(
        `INSERT INTO efp_recommended (index, address, name, avatar, header, class) VALUES ${values}`,
        params
      );
    }

    await client.query('COMMIT');

    const duration = Date.now() - startTime;
    logger.info({ duration, count: shuffledResult.rows.length }, 'Completed recommended shuffle');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
