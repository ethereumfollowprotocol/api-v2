# Cache and Rate Limiting on Workers

Replaces Redis-backed [`services/api/src/middleware/cache.ts`](../../api/src/middleware/cache.ts) and `@fastify/rate-limit` + ioredis.

## Response cache (Cache API)

**Binding:** `caches.default` (built-in, no wrangler config needed)

**Implementation:** [`src/middleware/cache.ts`](../src/middleware/cache.ts)

| Feature | Fastify + Redis | Worker + Cache API |
|---------|-----------------|-------------------|
| Key format | `efp:{pathname}?{query}` | Same |
| Bypass | `?cache=fresh`, `?live=true` | Same |
| TTL map | ROUTE_TTL from CACHE_TTL | Same (from `@efp/shared-core`) |
| Header | `X-Cache: HIT/MISS/BYPASS` | Same |
| Invalidation | `deleteCachePattern` via Redis KEYS | KV prefix delete or short TTLs; wal-listener invalidation TBD |

### Route TTL mapping (seconds)

| Route pattern | TTL |
|--------------|-----|
| `/users/:addressOrENS/account` | 60 |
| `/users/:addressOrENS/details` | 60 |
| `/users/:addressOrENS/stats` | 30 |
| `/users/:addressOrENS/followers` | 30 |
| `/users/:addressOrENS/following` | 30 |
| `/users/:addressOrENS/simple-profile` | 300 |
| `/leaderboard/ranked` | 300 |
| `/stats` | 300 |

### Optional KV for cross-colo hot keys

For keys that must be consistent globally (not just per-colo), add a KV namespace binding `RESPONSE_CACHE` and dual-write on cache miss. Phase cache already uses KV (`PHASE_CACHE`).

## Phase cache (KV)

**Binding:** `PHASE_CACHE` (KV namespace in wrangler.jsonc)

**Implementation:** [`src/middleware/phase.ts`](../src/middleware/phase.ts)

- Reads `efp_system_state.phase` from Postgres
- Caches in KV for 60 seconds (KV minimum TTL) to avoid a DB round-trip per request
- Bypasses health endpoints; bypasses spike only when `SPIKE_ENDPOINT_ENABLED=true`

## Rate limiting (Rate Limiting binding)

**Binding:** `API_RATE_LIMITER` via `unsafe.bindings` in wrangler.jsonc:

```jsonc
"unsafe": {
  "bindings": [{
    "name": "API_RATE_LIMITER",
    "type": "ratelimit",
    "namespace_id": "1001",
    "simple": { "limit": 100, "period": 60 }
  }]
}
```

**Implementation:** [`src/middleware/rate-limit.ts`](../src/middleware/rate-limit.ts)

| Feature | Fastify + Redis | Worker |
|---------|----------------|--------|
| Key | Client IP (`request.ip`) | `CF-Connecting-IP` header |
| Limit | 100 req / 60s (env) | 100 req / 60s (wrangler config) |
| Response | 429 JSON | Same shape |

Falls through gracefully when binding is unavailable (local dev without rate_limits configured).

## Hyperdrive query caching

Hyperdrive has optional built-in query result caching at the DB layer. **Disable** for write-heavy or freshness-critical paths; enable selectively for read-heavy leaderboard queries after load testing.

Configure at Hyperdrive creation:

```bash
npx wrangler hyperdrive create efp-api --connection-string="..." --caching-disabled
```

## wal-listener invalidation

The existing wal-listener invalidates Redis keys on CDC events. For Workers:

1. **Short TTLs** (current approach) — stale data expires naturally
2. **KV prefix purge** — wal-listener calls Cloudflare API to delete KV keys matching `efp:{table}:*`
3. **Cache API purge** — not practical cross-colo; prefer KV or short TTLs

Recommend option 2 for production cutover (future work).
