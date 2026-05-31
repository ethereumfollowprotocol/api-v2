# Shared Package Decoupling

## Problem

`@efp/shared` mixes **Node-only** modules with **isomorphic** code:

| Module | Node-only? | Used by Worker? |
|--------|-----------|-----------------|
| `db/postgres.ts` (pg Pool) | Yes | No — use Hyperdrive per-request Client |
| `db/redis.ts` (ioredis) | Yes | No — use Cache API / KV + Rate Limiting binding |
| `config/env.ts` (dotenv, process.exit) | Yes | No — use Wrangler bindings |
| `logger.ts` (pino) | Yes | No — use structured console.log |
| `phase.ts` | Uses pg | Worker has own phase middleware |
| `types/index.ts` | No | Yes |
| `contenthash.ts` | No | Yes |
| `CONTRACTS`, `CACHE_TTL` | No | Yes |

Workers cannot import `@efp/shared` directly without pulling in `pg`, `ioredis`, and `pino`.

## Solution: `@efp/shared-core`

New package at [`services/shared-core/`](../shared-core/):

```
@efp/shared-core
├── types/          Address, ENSProfile, response shapes, convertHexToBigInt
├── contenthash.ts  decodeContentHash, contenthashAbi
└── constants.ts    CONTRACTS, CACHE_TTL, Phase type
```

**Zero Node dependencies** — only `zod`.

## Dependency graph

```
@efp/shared-core  (isomorphic)
       ↑
       ├── @efp/shared      (Node services: re-exports core + pg/redis/pino)
       └── @efp/api-worker  (Workers: core + Hyperdrive db layer)
```

## Migration for Node services

`@efp/shared` now re-exports from `@efp/shared-core`:

- [`services/shared/src/types/index.ts`](../shared/src/types/index.ts) → re-exports types
- [`services/shared/src/contenthash.ts`](../shared/src/contenthash.ts) → re-exports contenthash
- [`services/shared/src/config/index.ts`](../shared/src/config/index.ts) → re-exports CONTRACTS/CACHE_TTL

Existing imports from `@efp/shared` continue to work unchanged.

## Worker data access pattern

```typescript
// Per-request — never module-global
const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
await client.connect();
try {
  await client.query('SELECT ...', [address]);
} finally {
  ctx.waitUntil(client.end());
}
```

Implemented in [`services/api-worker/src/middleware/db.ts`](../api-worker/src/middleware/db.ts).
