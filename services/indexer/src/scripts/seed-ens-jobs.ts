import PgBoss from 'pg-boss';
import { getPool, closePool, createLogger, env } from '@efp/shared';

const logger = createLogger('seed-ens-jobs');

async function main() {
  const pool = getPool();

  // Initialize pg-boss
  const boss = new PgBoss(env.DATABASE_URL);
  await boss.start();

  try {
    // Find all users in efp_user_stats that don't have ENS metadata
    const result = await pool.query<{ address: string }>(`
      SELECT us.address
      FROM efp_user_stats us
      LEFT JOIN ens_metadata em ON em.address = us.address
      WHERE em.address IS NULL
      ORDER BY us.followers_count DESC NULLS LAST
    `);

    logger.info({ count: result.rows.length }, 'Found users without ENS data');

    // Queue ENS sync jobs in batches
    const batchSize = 100;
    let queued = 0;

    for (let i = 0; i < result.rows.length; i += batchSize) {
      const batch = result.rows.slice(i, i + batchSize);

      for (const row of batch) {
        await boss.send(
          'sync-ens-metadata',
          { address: row.address },
          { singletonKey: `ens:${row.address}`, singletonSeconds: 3600 }
        );
        queued++;
      }

      logger.info({ queued, total: result.rows.length }, 'Progress');
    }

    logger.info({ queued }, 'ENS sync jobs queued');
  } catch (err) {
    logger.error(err, 'Error seeding ENS jobs');
    throw err;
  } finally {
    await boss.stop();
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
