import { getPool, closePool, createLogger, setMigrationComplete } from '@efp/shared';
import { runMigrations } from '../services/orchestrator/src/migrations.js';

const logger = createLogger('reset-migrations');

async function main() {
  const pool = getPool();

  try {
    logger.info('Truncating derived tables...');

    // Truncate in correct order (respecting any FK constraints)
    await pool.query('TRUNCATE TABLE efp_leaderboard CASCADE');
    await pool.query('TRUNCATE TABLE efp_mutuals CASCADE');
    await pool.query('TRUNCATE TABLE efp_user_stats CASCADE');
    await pool.query('TRUNCATE TABLE efp_following CASCADE');
    await pool.query('TRUNCATE TABLE efp_followers CASCADE');

    logger.info('Tables truncated');

    // Reset migration state
    await setMigrationComplete(false);
    logger.info('Migration state reset');

    // Run migrations
    logger.info('Running migrations...');
    await runMigrations();

    logger.info('Migrations complete!');
  } catch (err) {
    logger.error(err, 'Error during reset');
    throw err;
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
