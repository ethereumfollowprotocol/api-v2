import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Chain RPCs
  PRIMARY_RPC_BASE: z.string().url(),
  PRIMARY_RPC_OP: z.string().url(),
  PRIMARY_RPC_ETH: z.string().url(),

  // Chain ID
  CHAIN_ID: z.coerce.number().default(8453),

  // API Configuration
  API_PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Rate Limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000),

  // ENS API
  ENS_API_URL: z.string().url().default('https://ens.ethfollow.xyz'),

  // Phase Management
  SERVE_DURING_SYNC: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),

  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  _env = result.data;
  return _env;
}

export const env = getEnv();
