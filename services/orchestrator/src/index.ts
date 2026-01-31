import {
  createLogger,
  getPool,
  closePool,
  setPhase,
  setMigrationComplete,
  waitForIndexerCatchUp,
  getSystemState,
  ensureUsersIndex,
  getElasticsearch,
} from '@efp/shared';
import { runMigrations } from './migrations.js';
import { indexUsersToElasticsearch } from './elasticsearch.js';

const logger = createLogger('orchestrator');

async function main() {
  logger.info('Orchestrator starting...');

  try {
    // Check current state
    const state = await getSystemState();
    logger.info({ state }, 'Current system state');

    // If already complete, skip to monitoring
    if (state.migrationComplete) {
      logger.info('Migration already complete, entering monitoring mode');
      await monitorSystem();
      return;
    }

    // Phase 1: Wait for indexer to catch up
    if (!state.indexerCaughtUp) {
      await waitForIndexerCatchUp(30000);
    }

    // Phase 2: Run migration
    logger.info('Starting derived table migration...');
    await setPhase('migrating');

    // Run SQL migrations
    await runMigrations();

    // Ensure Elasticsearch index exists
    await ensureUsersIndex();

    // Index users to Elasticsearch
    await indexUsersToElasticsearch();

    // Mark complete
    await setMigrationComplete(true);
    await setPhase('listening');

    logger.info('Migration complete!');

    // Phase 3: Enter monitoring mode
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
