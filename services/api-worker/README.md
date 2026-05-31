# EFP API — Cloudflare Workers + Hyperdrive

Cloudflare Workers port of `services/api` using Hono, chanfana (OpenAPI 3.1), and Hyperdrive for Postgres.

## Architecture

See [docs/SHARED_DECOUPLING.md](docs/SHARED_DECOUPLING.md), [docs/CACHE_RATELIMIT.md](docs/CACHE_RATELIMIT.md), and [docs/SUBREQUEST_LIMITS.md](docs/SUBREQUEST_LIMITS.md).

## Prerequisites

- Cloudflare account (Paid recommended for ENS `cache=fresh` fan-out)
- Existing Postgres database (Railway or other)
- Wrangler CLI

## Setup

```bash
# From repo root
npm install

# Build isomorphic shared-core
npm run build --workspace=@efp/shared-core

# Create Hyperdrive config
npx wrangler hyperdrive create efp-api-hyperdrive \
  --connection-string="postgres://USER:PASS@HOST:5432/DB" \
  --caching-disabled

# Update hyperdrive.id in wrangler.jsonc

# Create KV namespace for phase cache
npx wrangler kv namespace create PHASE_CACHE
npx wrangler kv namespace create PHASE_CACHE --preview
# Update kv_namespaces ids in wrangler.jsonc

# Set secrets
npx wrangler secret put PRIMARY_RPC_ETH
npx wrangler secret put POAP_API_TOKEN  # optional
```

## Development

```bash
npm run dev -w @efp/api-worker
# Worker at http://localhost:8787

# Remote dev (connects to real Hyperdrive + Postgres)
npm run dev:remote -w @efp/api-worker
```

## Endpoints (POC)

| Method | Path | Status |
|--------|------|--------|
| GET | `/api/v1/users/:addressOrENS/account` | P0 |
| GET | `/api/v1/users/:addressOrENS/details` | P0 |
| GET | `/api/v1/users/:addressOrENS/stats` | P0 |
| GET | `/api/v1/health` | Health |
| GET | `/api/v1/spike/hyperdrive` | Spike (remove before prod) |
| GET | `/docs` | OpenAPI UI |
| GET | `/openapi.json` | OpenAPI schema |

## Testing

```bash
# Unit + spike tests (Workers runtime)
npm run test -w @efp/api-worker

# Live Hyperdrive spike against real Postgres
RUN_HYPERDRIVE_SPIKE=true DATABASE_URL=postgres://... npm run test:hyperdrive -w @efp/api-worker

# P0 comparison against running Worker
WORKER_API_URL=http://localhost:8787/api/v1 npm run test:p0 -w @efp/api-worker

# Compare shapes to production
WORKER_API_URL=http://localhost:8787/api/v1 COMPARE_TO_PRODUCTION=true npm run test:p0 -w @efp/api-worker
```

## Deploy

```bash
npm run deploy -w @efp/api-worker
# or staging/production:
npx wrangler deploy --env staging
npx wrangler deploy --env production
```

## QR code note

`qr-image` (used by Fastify API) is **not Workers-compatible**. Use `qrcode-svg` via [`src/qr/generate.ts`](src/qr/generate.ts). See QR spike test.
