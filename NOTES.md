# Implementation Notes

## Production API Response Observations (2026-01-31)

Verified against production API at `https://api.ethfollow.xyz/api/v1`:

### /users/:address/account
- `ens.records` is a full object (not a string), containing text records like `com.twitter`, `com.github`, `description`, `header`, `url`, `avatar`
- Example: `{"avatar": "...", "com.github": "vbuterin", "com.twitter": "VitalikButerin", ...}`

### /users/:address/details
- `ranks` values are **STRINGS** not numbers (e.g., `"followers_rank": "1"` not `"followers_rank": 1`)
- `blocks_rank` can be `0` (number) when others are strings - inconsistent typing
- `primary_list` is a **STRING** (e.g., `"6509"` not `6509`)

### /users/:address/followers
- Includes `efp_list_nft_token_id` field (not documented in PRD)
- Includes `updated_at` timestamp per follower
- No ENS data by default (requires `include=ens`)

### /users/:address/following
- Does NOT include `is_blocked`, `is_muted` flags in default response (PRD showed these)
- Has `version`, `record_type`, `data`, `address`, `tags` only

### /leaderboard/ranked
- ALL rank and count fields are **STRINGS** (e.g., `"mutuals": "2329"`, `"followers_rank": "1"`)
- `blocks_rank` can be `null` (not just 0)
- Has both `_rank` fields (ranking position) and raw count fields (e.g., `followers`, `mutuals`)

## Implementation Decisions

### Type Handling
- Need to return ranks/counts as strings to match production exactly
- Store as integers in DB but convert to strings in API response

### convert_hex_to_bigint Function
- Need to create this function if not present in indexer schema
- Converts hex string like `0x0000...1234` to BIGINT

### Schema Notes
- `efp_lists.token_id` should be BIGINT (matching production)
- `efp_user_stats.primary_list_id` should be BIGINT (not NUMERIC)

## Questions for User
- [x] Confirm indexer schema matches what PRD expects - User confirmed fresh setup
- [x] Confirm we should create all services from scratch - Yes

## Implementation Status (2026-01-31)

### Completed
1. [x] Monorepo structure with package.json files
2. [x] Shared package (config, db clients, types, phase utilities)
3. [x] API service with P0 endpoints (account, details, stats)
4. [x] API service with P1 endpoints (followers, following, lists, leaderboard)
5. [x] Orchestrator service (phase management, migrations)
6. [x] WAL-listener service (CDC, cache invalidation, pg-boss job publishing)
7. [x] Workers service (pg-boss job handlers - 10 jobs implemented)
8. [x] Database schema with all tables and triggers
9. [x] Docker Compose for local development

### Remaining Work
- [ ] P2/P3 endpoints (mutuals, search, recommendations, etc.)
- [ ] Testing infrastructure (vitest setup, comparison tests)
- [ ] Indexer integration (add indexer_caught_up flag to existing indexer)
- [ ] Production deployment configuration
- [ ] Load testing with k6

## Architecture Summary

```
services/
├── shared/          # Config, DB clients, types, phase utilities
├── api/             # Fastify REST API (P0+P1 endpoints implemented)
├── orchestrator/    # Phase management + migration runner
├── wal-listener/    # PostgreSQL CDC → derived tables + cache + ES
└── workers/         # pg-boss job handlers (10 jobs)
```

## Key Files

| File | Purpose |
|------|---------|
| `services/shared/src/db/schema.sql` | Complete database schema |
| `services/orchestrator/src/migrations.ts` | Migration SQL scripts |
| `docker-compose.yml` | Local development infrastructure |
| `.env.example` | Environment variable template |

## Running Locally

```bash
# Start infrastructure
docker-compose up -d

# Install dependencies
npm install

# Run services in development mode
npm run dev:api          # API server on :3000
npm run dev:orchestrator # Phase management
npm run dev:wal-listener # CDC listener
npm run dev:workers      # Job processors
```
