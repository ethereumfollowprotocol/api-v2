import pino from 'pino';
import { env } from './config/index.js';

// pino is exported as default in ESM
const createPino = pino.default ?? pino;

export const logger = createPino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
});

export function createLogger(name: string) {
  return logger.child({ service: name });
}
