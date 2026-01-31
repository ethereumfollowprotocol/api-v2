import pg from 'pg';
import PgBoss from 'pg-boss';
import {
  createLogger,
  env,
  waitForMigrationComplete,
  closePool,
  closeRedis,
} from '@efp/shared';
import { handleEvent, type WALEvent } from './handlers/index.js';

const logger = createLogger('wal-listener');

let boss: PgBoss;

export function getBoss(): PgBoss {
  return boss;
}

async function main() {
  logger.info('WAL-Listener starting...');

  // Wait for migration to complete
  await waitForMigrationComplete(10000);

  logger.info('Migration complete - activating WAL listener');

  // Initialize pg-boss for job publishing
  boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'pgboss',
    application_name: 'efp-wal-listener',
  });

  boss.on('error', (err) => logger.error(err, 'pg-boss error'));

  await boss.start();
  logger.info('pg-boss started');

  // Create a dedicated connection for LISTEN/NOTIFY
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    application_name: 'efp-wal-listener',
  });

  await client.connect();
  logger.info('Connected to PostgreSQL for LISTEN/NOTIFY');

  // Subscribe to notification channel
  await client.query('LISTEN efp_changes');
  logger.info('Subscribed to efp_changes channel');

  // Handle notifications
  client.on('notification', async (msg) => {
    if (msg.channel !== 'efp_changes' || !msg.payload) return;

    try {
      const event: WALEvent = JSON.parse(msg.payload);
      await handleEvent(event);
    } catch (err) {
      logger.error({ err, payload: msg.payload }, 'Failed to handle WAL event');
    }
  });

  // Handle connection errors
  client.on('error', (err) => {
    logger.error(err, 'PostgreSQL connection error');
    process.exit(1); // Exit and let supervisor restart
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    try {
      await boss.stop({ graceful: true, timeout: 30000 });
      await client.end();
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

  logger.info('WAL-Listener active, listening for changes...');
}

main().catch((err) => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
