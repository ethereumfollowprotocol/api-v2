import PgBoss from 'pg-boss';
import {
  createLogger,
  env,
  waitForMigrationComplete,
  closePool,
  closeRedis,
} from '@efp/shared';
import { handleUpdateUserStats } from './jobs/update-user-stats.js';
import { handleCalculateMutuals } from './jobs/calculate-mutuals.js';
import { handleUpdateLeaderboardEntry } from './jobs/update-leaderboard-entry.js';
import { handleUpdateLeaderboardFull } from './jobs/update-leaderboard-full.js';
import { handleSyncENSMetadata } from './jobs/sync-ens-metadata.js';
import { handleResyncUserRelationships } from './jobs/resync-user-relationships.js';
import { handleEnsureUserStats } from './jobs/ensure-user-stats.js';
import { handleBatchReconcileStats } from './jobs/batch-reconcile-stats.js';
import { handleBatchRefreshENS } from './jobs/batch-refresh-ens.js';
import { handleShuffleRecommended } from './jobs/shuffle-recommended.js';
import { handleSeedRecommended } from './jobs/seed-recommended.js';
import { handleBatchRecalculateMutuals } from './jobs/batch-recalculate-mutuals.js';

const logger = createLogger('workers');

// Job configurations
const jobConfigs: Record<string, Partial<PgBoss.WorkOptions>> = {
  'update-user-stats': { teamSize: 5, teamConcurrency: 5 },
  'calculate-mutuals': { teamSize: 3, teamConcurrency: 3 },
  'update-leaderboard-entry': { teamSize: 2, teamConcurrency: 2 },
  'update-leaderboard-full': { teamSize: 1, teamConcurrency: 1 },
  'sync-ens-metadata': { teamSize: 10, teamConcurrency: 10 },
  'resync-user-relationships': { teamSize: 1, teamConcurrency: 1 },
  'batch-recalculate-mutuals': { teamSize: 2, teamConcurrency: 2 },
  'ensure-user-stats': { teamSize: 5, teamConcurrency: 5 },
  'batch-reconcile-stats': { teamSize: 1, teamConcurrency: 1 },
  'batch-refresh-ens': { teamSize: 1, teamConcurrency: 1 },
  'shuffle-recommended': { teamSize: 1, teamConcurrency: 1 },
  'seed-recommended': { teamSize: 1, teamConcurrency: 1 },
};

async function main() {
  logger.info('Workers starting...');

  // Wait for migration to complete
  await waitForMigrationComplete(10000);

  logger.info('Migration complete - starting workers');

  // Initialize pg-boss
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'pgboss',
    application_name: 'efp-workers',
    max: 10,
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInHours: 24,
    archiveCompletedAfterSeconds: 60 * 60 * 24 * 7, // 7 days
    monitorStateIntervalSeconds: 30,
    deleteAfterSeconds: 60 * 60 * 24 * 14, // 14 days
    maintenanceIntervalSeconds: 300,
  });

  boss.on('error', (err) => logger.error(err, 'pg-boss error'));
  boss.on('monitor-states', (states) => {
    logger.info({ states: states.queues }, 'Queue status');
  });

  await boss.start();
  logger.info('pg-boss started');

  // Register job handlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Array<[string, (job: PgBoss.Job<any>) => Promise<void>]> = [
    ['update-user-stats', handleUpdateUserStats],
    ['calculate-mutuals', handleCalculateMutuals],
    ['update-leaderboard-entry', handleUpdateLeaderboardEntry],
    ['update-leaderboard-full', handleUpdateLeaderboardFull],
    ['sync-ens-metadata', handleSyncENSMetadata],
    ['resync-user-relationships', handleResyncUserRelationships],
    ['batch-recalculate-mutuals', handleBatchRecalculateMutuals],
    ['ensure-user-stats', handleEnsureUserStats],
    ['batch-reconcile-stats', handleBatchReconcileStats],
    ['batch-refresh-ens', handleBatchRefreshENS],
    ['shuffle-recommended', handleShuffleRecommended],
    ['seed-recommended', handleSeedRecommended],
  ];

  for (const [jobName, handler] of handlers) {
    const config = jobConfigs[jobName] || {};
    await boss.work(jobName, config, handler);
    logger.info({ jobName, config }, 'Registered job handler');
  }

  // Schedule recurring jobs
  await boss.schedule('update-leaderboard-full', '*/5 * * * *'); // Every 5 minutes
  await boss.schedule('batch-reconcile-stats', '0 * * * *'); // Every hour
  await boss.schedule('batch-refresh-ens', '0 3 * * *'); // Daily at 3 AM
  await boss.schedule('shuffle-recommended', '*/15 * * * *'); // Every 15 minutes

  // Trigger seed-recommended once on startup (will skip if already populated)
  await boss.send('seed-recommended', {}, { singletonKey: 'seed-recommended-startup' });
  logger.info('Triggered seed-recommended job');

  logger.info('Workers ready');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    try {
      await boss.stop({ graceful: true, timeout: 30000 });
      await closePool();
      await closeRedis();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
