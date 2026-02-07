import {
  createLogger,
  getPool,
  closePool,
  setPhase,
  setMigrationComplete,
  setSchemaMigrationsComplete,
  waitForIndexerCatchUp,
  getSystemState,
  ensureSchema,
} from '@efp/shared';
import { runSchemaMigrations, runDataMigrations } from './migrations.js';

const logger = createLogger('orchestrator');

async function main() {
  logger.info('Orchestrator starting...');

  try {
    // Ensure database schema exists
    await ensureSchema();

    const state = await getSystemState();
    logger.info({ state }, 'Current system state');

    // Step 1: Run schema migrations if not complete
    if (!state.schemaMigrationsComplete) {
      logger.info('Running schema migrations...');
      await runSchemaMigrations();
      await setSchemaMigrationsComplete(true);
    } else {
      logger.info('Schema migrations already complete');
    }

    // Step 2: Check if data migrations already done
    // Re-fetch state since indexer may have reset flags
    const currentState = await getSystemState();
    if (currentState.migrationComplete) {
      logger.info('Data migrations already complete, entering monitoring mode');
      await monitorSystem();
      return;
    }

    // Step 3: Wait for indexer to catch up
    if (!currentState.indexerCaughtUp) {
      await waitForIndexerCatchUp(30000);
    }

    // Step 4: Run data migrations
    logger.info('Starting data migrations...');
    await setPhase('migrating');

    // Run SQL data migrations
    await runDataMigrations();

    // Mark complete
    await setMigrationComplete(true);
    await setPhase('listening');

    logger.info('Migration complete!');

    await monitorSystem();
  } catch (err) {
    logger.error(err, 'Orchestrator fatal error');
    process.exit(1);
  }
}

async function monitorSystem() {
  logger.info('Entering monitoring mode');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Stay alive and periodically log health
  while (true) {
    await sleep(5 * 60 * 1000); // Every 5 minutes

    try {
      const db = getPool();
      const stats = await db.query(`
        SELECT
          (SELECT COUNT(*) FROM efp_lists) as lists,
          (SELECT COUNT(*) FROM efp_followers) as followers,
          (SELECT COUNT(*) FROM efp_user_stats) as users,
          (SELECT COUNT(*) FROM efp_leaderboard) as leaderboard
      `);

      logger.info({ stats: stats.rows[0] }, 'System health check');
    } catch (err) {
      logger.error(err, 'Health check failed');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
