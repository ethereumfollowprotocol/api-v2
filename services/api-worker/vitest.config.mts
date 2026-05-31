import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            PRIMARY_RPC_ETH: 'https://eth.llamarpc.com',
            SERVE_DURING_SYNC: 'true',
            RATE_LIMIT_MAX: '100',
            RATE_LIMIT_WINDOW_SEC: '60',
          },
        },
      },
    },
  },
});
