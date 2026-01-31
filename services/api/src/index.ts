import { buildApp } from './app.js';
import { createLogger, env, closePool, closeRedis } from '@efp/shared';

const logger = createLogger('api');

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
    logger.info({ port: env.API_PORT }, 'API server started');
  } catch (err) {
    logger.error(err, 'Failed to start API server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    try {
      await app.close();
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
