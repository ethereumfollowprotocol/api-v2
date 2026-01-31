# EFP V2 - Product Requirements Document

**Status**: Draft
**Last Updated**: 2026-01-30
**Authors**: Human + Claude

---

## Executive Summary

Rewrite the EFP backend infrastructure to handle increased traffic load. The current Cloudflare Workers-based API suffers from connection pool exhaustion under high traffic, causing fatal PostgreSQL errors and service crashes.

**Solution**: Adopt the Grails backend architecture pattern:
- Fastify API with proper connection pooling
- PostgreSQL with CDC-friendly schema design
- Elasticsearch for search and leaderboards
- WAL-listener for real-time cache invalidation
- pg-boss workers for background job processing

---

## Problem Statement

### Current Issues
1. **Connection Pool Exhaustion**: Serverless (CF Workers) creates/destroys DB connections rapidly, causing `08P01` protocol violations under load
2. **Hot Endpoints**: `/users/[address]/account` and `/users/[address]/details` receive burst traffic from integrated projects
3. **Cache Invalidation**: Sequential, fire-and-forget pattern with no retries
4. **Background Jobs**: Interval-based services instead of proper job queue
5. **Search Performance**: Heavy stored procedure reliance instead of dedicated search engine

### Traffic Pattern
- **Read-heavy** workload (public API used by many projects)
- Burst traffic patterns causing cascading failures
- Primary bottleneck: user account/details lookups

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BLOCKCHAIN NETWORKS                             │
│    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│    │   Ethereum   │    │   Optimism   │    │     Base     │                 │
│    └──────────────┘    └──────────────┘    └──────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          INDEXER (existing, minimal changes)                 │
│    - Listens to ListRegistry, ListRecords, AccountMetadata events           │
│    - Writes to PostgreSQL core tables                                        │
│    - Sets indexer_caught_up flag when synced                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              POSTGRESQL DATABASE                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  Core Tables    │  │  Derived Tables │  │  System State   │             │
│  │  - events       │  │  - efp_followers│  │  - phase        │             │
│  │  - efp_lists    │  │  - efp_following│  │  - caught_up    │             │
│  │  - efp_records  │  │  - efp_stats    │  │  - migration    │             │
│  │  - efp_tags     │  │  - efp_leaderbd │  │  - pgboss.*     │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
         │                         │                        │
         ▼                         ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────────┐
│  ORCHESTRATOR   │    │  ELASTICSEARCH  │    │      PG-BOSS WORKERS        │
│  - Waits for    │    │  - Users index  │    │  - update-follower-counts   │
│    indexer      │    │  - Leaderboard  │    │  - update-leaderboard       │
│  - Runs derived │    │  - Search       │    │  - sync-ens-metadata        │
│    migrations   │    │                 │    │  - calculate-mutuals        │
│  - Phase mgmt   │    │                 │    │  - invalidate-cache         │
└─────────────────┘    └─────────────────┘    └─────────────────────────────┘
                                │                           │
┌─────────────────┐             │                           │
│  WAL-LISTENER   │◄────────────┼───────────────────────────┘
│  - CDC from WAL │             │
│  - ES sync      │             │
│  - Redis inval  │             ▼
│  - Queue jobs   │    ┌─────────────────┐
└─────────────────┘    │   REDIS CACHE   │
                       └─────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FASTIFY API                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  Cache Layer    │  │  Route Handlers │  │  Connection     │             │
│  │  - Per-route    │  │  - /users/*     │  │  Pooling        │             │
│  │    TTL config   │  │  - /lists/*     │  │  - Singleton    │             │
│  │  - X-Cache hdr  │  │  - /leaderboard │  │    pattern      │             │
│  │  - IP rate limit│  │  - /stats       │  │  - Graceful     │             │
│  └─────────────────┘  └─────────────────┘  │    shutdown     │             │
│                                            └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Service Responsibilities

| Service | Responsibility |
|---------|----------------|
| **Indexer** | Blockchain event indexing → core tables. Sets `indexer_caught_up` flag. |
| **Orchestrator** | Phase management, derived table migration, system health monitoring. |
| **WAL-Listener** | PostgreSQL CDC → Elasticsearch sync + Redis cache invalidation + pg-boss job queuing. |
| **Workers** | Background job processing: stats updates, leaderboard, ENS sync, mutuals. |
| **API** | HTTP endpoints with Redis caching, rate limiting, connection pooling. |

---

## Database Schema Design

### Philosophy
- **CDC-friendly**: Tables designed for change detection via WAL
- **Denormalized for reads**: Pre-computed follower/following counts
- **Separate concerns**: Raw events vs derived/computed data
- **Timestamps everywhere**: `created_at`, `updated_at` with triggers

### Core Tables (from Indexer - minimal changes)

```sql
-- Raw blockchain events (existing)
CREATE TABLE events (
    chain_id            BIGINT NOT NULL,
    block_number        BIGINT NOT NULL,
    transaction_index   INTEGER NOT NULL,
    log_index           INTEGER NOT NULL,
    contract_address    VARCHAR(42) NOT NULL,
    event_name          VARCHAR(64) NOT NULL,
    event_args          JSONB NOT NULL,
    block_hash          VARCHAR(66),
    transaction_hash    VARCHAR(66),
    sort_key            VARCHAR(64),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chain_id, block_number, transaction_index, log_index)
);

-- EFP Lists (NFT ownership)
CREATE TABLE efp_lists (
    token_id                    NUMERIC PRIMARY KEY,
    owner                       VARCHAR(42) NOT NULL,
    manager                     VARCHAR(42),
    "user"                      VARCHAR(42),
    list_storage_location       BYTEA,
    list_storage_location_chain_id      BIGINT,
    list_storage_location_contract      VARCHAR(42),
    list_storage_location_slot          BYTEA,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- List records (follows/blocks/mutes)
CREATE TABLE efp_list_records (
    chain_id            BIGINT NOT NULL,
    contract_address    VARCHAR(42) NOT NULL,
    slot                BYTEA NOT NULL,
    record              BYTEA NOT NULL,
    record_version      SMALLINT,
    record_type         SMALLINT,
    record_data         BYTEA,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chain_id, contract_address, slot, record)
);

-- Record tags
CREATE TABLE efp_list_record_tags (
    chain_id            BIGINT NOT NULL,
    contract_address    VARCHAR(42) NOT NULL,
    slot                BYTEA NOT NULL,
    record              BYTEA NOT NULL,
    tag                 VARCHAR(255) NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chain_id, contract_address, slot, record, tag)
);

-- Account metadata (primary list designation)
CREATE TABLE efp_account_metadata (
    chain_id            BIGINT NOT NULL,
    contract_address    VARCHAR(42) NOT NULL,
    address             VARCHAR(42) NOT NULL,
    key                 VARCHAR(255) NOT NULL,
    value               BYTEA,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chain_id, contract_address, address, key)
);
```

### New Derived Tables (for API performance)

```sql
-- Denormalized user stats (updated by workers)
CREATE TABLE efp_user_stats (
    address             VARCHAR(42) PRIMARY KEY,
    primary_list_id     NUMERIC,
    followers_count     INTEGER DEFAULT 0,
    following_count     INTEGER DEFAULT 0,
    mutuals_count       INTEGER DEFAULT 0,
    blocks_count        INTEGER DEFAULT 0,      -- blocks given
    blocked_by_count    INTEGER DEFAULT 0,      -- blocks received
    mutes_count         INTEGER DEFAULT 0,
    muted_by_count      INTEGER DEFAULT 0,
    top8_count          INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Follower relationships (denormalized for fast queries)
CREATE TABLE efp_followers (
    address             VARCHAR(42) NOT NULL,       -- the followed user
    follower_address    VARCHAR(42) NOT NULL,       -- who is following
    follower_list_id    NUMERIC NOT NULL,           -- from which list
    is_blocked          BOOLEAN DEFAULT FALSE,
    is_muted            BOOLEAN DEFAULT FALSE,
    tags                TEXT[] DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address, follower_address)
);

-- Following relationships (denormalized)
CREATE TABLE efp_following (
    address             VARCHAR(42) NOT NULL,       -- the follower
    list_id             NUMERIC NOT NULL,           -- which list
    following_address   VARCHAR(42) NOT NULL,       -- who they follow
    is_blocked          BOOLEAN DEFAULT FALSE,
    is_muted            BOOLEAN DEFAULT FALSE,
    tags                TEXT[] DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address, following_address)
);

-- Leaderboard (pre-computed rankings)
CREATE TABLE efp_leaderboard (
    address             VARCHAR(42) PRIMARY KEY,
    followers_count     INTEGER DEFAULT 0,
    following_count     INTEGER DEFAULT 0,
    mutuals_count       INTEGER DEFAULT 0,
    followers_rank      INTEGER,
    following_rank      INTEGER,
    mutuals_rank        INTEGER,
    blocks_rank         INTEGER,
    top8_rank           INTEGER,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ENS metadata cache
CREATE TABLE ens_metadata (
    address             VARCHAR(42) PRIMARY KEY,
    name                VARCHAR(255),
    avatar              TEXT,
    header              TEXT,
    records             JSONB,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Mutual followers (pre-computed)
CREATE TABLE efp_mutuals (
    address_a           VARCHAR(42) NOT NULL,
    address_b           VARCHAR(42) NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address_a, address_b)
);
```

### Indexes

```sql
-- Hot path indexes
CREATE INDEX idx_efp_followers_address ON efp_followers(address);
CREATE INDEX idx_efp_followers_follower ON efp_followers(follower_address);
CREATE INDEX idx_efp_following_address ON efp_following(address);
CREATE INDEX idx_efp_following_target ON efp_following(following_address);
CREATE INDEX idx_efp_user_stats_followers ON efp_user_stats(followers_count DESC);
CREATE INDEX idx_efp_user_stats_following ON efp_user_stats(following_count DESC);
CREATE INDEX idx_efp_leaderboard_followers ON efp_leaderboard(followers_rank);
CREATE INDEX idx_efp_leaderboard_mutuals ON efp_leaderboard(mutuals_rank);
CREATE INDEX idx_ens_metadata_name ON ens_metadata(name);
CREATE INDEX idx_efp_mutuals_b ON efp_mutuals(address_b, address_a);

-- Tag filtering
CREATE INDEX idx_efp_followers_tags ON efp_followers USING GIN(tags);
CREATE INDEX idx_efp_following_tags ON efp_following USING GIN(tags);
```

### Triggers

```sql
-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_efp_user_stats_updated_at
    BEFORE UPDATE ON efp_user_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_efp_followers_updated_at
    BEFORE UPDATE ON efp_followers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Similar triggers for other tables...
```

---

## Elasticsearch Schema

### Users Index

```json
{
  "mappings": {
    "properties": {
      "address": { "type": "keyword" },
      "ens_name": {
        "type": "text",
        "analyzer": "autocomplete",
        "search_analyzer": "standard"
      },
      "ens_name_keyword": { "type": "keyword" },
      "avatar": { "type": "keyword", "index": false },
      "header": { "type": "keyword", "index": false },
      "primary_list_id": { "type": "long" },
      "followers_count": { "type": "integer" },
      "following_count": { "type": "integer" },
      "mutuals_count": { "type": "integer" },
      "followers_rank": { "type": "integer" },
      "following_rank": { "type": "integer" },
      "mutuals_rank": { "type": "integer" },
      "has_primary_list": { "type": "boolean" },
      "updated_at": { "type": "date" }
    }
  },
  "settings": {
    "analysis": {
      "analyzer": {
        "autocomplete": {
          "tokenizer": "autocomplete",
          "filter": ["lowercase"]
        }
      },
      "tokenizer": {
        "autocomplete": {
          "type": "ngram",
          "min_gram": 2,
          "max_gram": 20,
          "token_chars": ["letter", "digit"]
        }
      }
    }
  }
}
```

---

## API Structure

### Service Layout (Monorepo)

```
services/
├── api/                    # Fastify REST API
│   ├── src/
│   │   ├── index.ts        # Server entry point
│   │   ├── routes/
│   │   │   ├── users.ts    # /api/v1/users/*
│   │   │   ├── lists.ts    # /api/v1/lists/*
│   │   │   ├── leaderboard.ts
│   │   │   ├── stats.ts
│   │   │   └── health.ts
│   │   ├── middleware/
│   │   │   ├── cache.ts    # Redis caching
│   │   │   └── error.ts    # Error handling
│   │   └── services/
│   │       ├── users.ts
│   │       ├── lists.ts
│   │       └── ens.ts
│   └── package.json
│
├── indexer/                # Existing indexer (minimal changes)
│
├── wal-listener/           # PostgreSQL CDC
│   ├── src/
│   │   ├── index.ts
│   │   ├── elasticsearch-sync.ts
│   │   └── cache-invalidation.ts
│   └── package.json
│
├── workers/                # pg-boss job handlers
│   ├── src/
│   │   ├── index.ts
│   │   ├── jobs/
│   │   │   ├── update-follower-counts.ts
│   │   │   ├── update-leaderboard.ts
│   │   │   ├── calculate-mutuals.ts
│   │   │   ├── sync-ens-metadata.ts
│   │   │   └── invalidate-cache.ts
│   │   └── queue.ts
│   └── package.json
│
└── shared/                 # Shared utilities
    ├── src/
    │   ├── config/
    │   ├── db/
    │   │   ├── client.ts   # Singleton pool
    │   │   └── schema.sql
    │   ├── types/
    │   └── services/
    └── package.json
```

### API Endpoints (Priority Order)

**Phase 1 - Critical (Hot Path)**
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /users/:address/account` | ENS metadata + primary list | 60s |
| `GET /users/:address/details` | Stats + ranks + metadata | 60s |
| `GET /users/:address/stats` | Follower/following counts | 30s |
| `GET /health` | Health check | None |

**Phase 2 - Core**
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /users/:address/followers` | Paginated followers | 30s |
| `GET /users/:address/following` | Paginated following | 30s |
| `GET /users/:address/mutuals` | Mutual followers | 60s |
| `GET /lists/:id/followers` | List followers | 30s |
| `GET /lists/:id/following` | List following | 30s |

**Phase 3 - Discovery**
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /leaderboard` | Ranked users | 300s |
| `GET /leaderboard/search` | Search leaderboard | 60s |
| `GET /stats` | Global stats | 300s |
| `GET /discover` | Recent activity | 30s |

**Phase 4 - Advanced**
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /users/:address/recommended` | Recommendations | 300s |
| `GET /users/:address/tags` | User's tags | 60s |
| `GET /search` | Global search (ES) | 30s |

### Caching Strategy

```typescript
// Per-route TTL configuration
const CACHE_CONFIG = {
  '/users/:address/account': { ttl: 60, skipOnAuth: true },
  '/users/:address/details': { ttl: 60, skipOnAuth: true },
  '/users/:address/stats': { ttl: 30, skipOnAuth: true },
  '/users/:address/followers': { ttl: 30, skipOnAuth: false },
  '/leaderboard': { ttl: 300, skipOnAuth: false },
  '/stats': { ttl: 300, skipOnAuth: false },
};

// Cache key generation
function getCacheKey(request: Request): string {
  const url = new URL(request.url);
  return `efp:${url.pathname}${url.search}`;
}
```

---

## pg-boss Workers

### Job Types

| Job Name | Trigger | Description |
|----------|---------|-------------|
| `update-user-stats` | WAL change on efp_followers/following | Recalculate follower/following counts |
| `update-leaderboard` | Scheduled (5 min) + on-demand | Recompute rankings |
| `calculate-mutuals` | WAL change on efp_followers | Update mutual relationships |
| `sync-ens-metadata` | On new address seen | Fetch ENS name/avatar |
| `invalidate-cache` | WAL change | Clear Redis keys for affected addresses |
| `batch-update-stats` | Scheduled (hourly) | Bulk reconciliation |

### Worker Configuration

```typescript
const queueConfig = {
  schema: 'pgboss',
  application_name: 'efp-workers',
  max: 10,  // max connections
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  expireInHours: 24,
  archiveCompletedAfterSeconds: 60 * 60 * 24 * 7,  // 7 days
};
```

---

## WAL-Listener Design

### Tables to Monitor

| Table | Sync Target | Action |
|-------|-------------|--------|
| `efp_followers` | Elasticsearch + Redis | Update user index, invalidate cache |
| `efp_following` | Elasticsearch + Redis | Update user index, invalidate cache |
| `efp_user_stats` | Elasticsearch | Update counts/ranks |
| `efp_leaderboard` | Elasticsearch | Update rankings |
| `ens_metadata` | Elasticsearch | Update names/avatars |

### CDC Flow

```
PostgreSQL WAL
    │
    ▼
┌─────────────────────┐
│   WAL-Listener      │
│   (LISTEN/NOTIFY)   │
└─────────────────────┘
    │
    ├──► Elasticsearch Sync (async)
    │    - Upsert user document
    │    - Update rankings
    │
    └──► Redis Cache Invalidation
         - DEL efp:/users/{address}/*
         - Publish pg-boss job for expensive recalcs
```

---

## Automatic Phase Management

The system automatically transitions through phases on fresh deployment - no manual intervention required. This is ideal for Railway template deployments.

### System State Table

```sql
CREATE TABLE efp_system_state (
    key                 VARCHAR(64) PRIMARY KEY,
    value               TEXT,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Initial state (set by schema migration)
INSERT INTO efp_system_state (key, value) VALUES
    ('phase', 'historical'),
    ('indexer_caught_up', 'false'),
    ('migration_complete', 'false'),
    ('last_migration_block', '0');
```

### Phase Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AUTOMATIC STARTUP SEQUENCE                        │
│                                                                             │
│  1. All services start simultaneously                                       │
│  2. Indexer begins processing historical events                             │
│  3. Orchestrator polls DB, waiting for indexer_caught_up = true             │
│  4. WAL-listener polls DB, waiting for migration_complete = true            │
│  5. API serves 503 "initializing" (unless SERVE_DURING_SYNC=true)          │
│                                                                             │
│  ─── TIME PASSES (indexer syncing) ───                                      │
│                                                                             │
│  6. Indexer reaches chain head (gap <= 12 blocks)                          │
│  7. Indexer sets indexer_caught_up = true                                  │
│  8. Orchestrator detects flag, sets phase = 'migrating'                    │
│  9. Orchestrator runs derived table migration SQL                          │
│  10. Orchestrator sets migration_complete = true, phase = 'listening'      │
│  11. WAL-listener activates, begins processing changes                      │
│  12. Workers activate, begin processing jobs                                │
│  13. API starts serving real responses                                      │
│  14. Orchestrator enters monitoring mode                                    │
│                                                                             │
│  Phase: historical ──▶ migrating ──▶ listening                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Service Behavior by Phase

| Service | historical | migrating | listening |
|---------|------------|-----------|-----------|
| **Indexer** | Processing historical blocks | Waiting for new events | Watching for new events |
| **Orchestrator** | Waiting for indexer | Running migration SQL | Monitoring mode |
| **WAL-listener** | Waiting (polling DB) | Waiting (polling DB) | Active - processing changes |
| **Workers** | Waiting (polling DB) | Waiting (polling DB) | Active - processing jobs |
| **API** | 503 or serve (if override) | 503 or serve (if override) | Fully operational |

### Service Layout

```
services/
├── api/              # Fastify REST API
├── indexer/          # Blockchain event indexer (minimal changes)
├── orchestrator/     # Phase management + migration runner
├── wal-listener/     # CDC for cache invalidation + Elasticsearch sync
├── workers/          # pg-boss job handlers
└── shared/           # Shared config, DB clients, types
```

### Indexer Changes (Minimal)

Only change: set `indexer_caught_up` flag when within 12 blocks of chain head:

```typescript
// services/indexer/src/utils/phase.ts
export async function checkAndSetCaughtUp(
  lastProcessedBlock: number,
  chainHead: number
) {
  const gap = chainHead - lastProcessedBlock;

  if (gap <= 12) {
    const alreadySet = await db.query(`
      SELECT value FROM efp_system_state WHERE key = 'indexer_caught_up'
    `);

    if (alreadySet.rows[0]?.value !== 'true') {
      await db.execute(`
        UPDATE efp_system_state
        SET value = 'true', updated_at = NOW()
        WHERE key = 'indexer_caught_up'
      `);
      await db.execute(`
        UPDATE efp_system_state
        SET value = $1, updated_at = NOW()
        WHERE key = 'last_migration_block'
      `, [lastProcessedBlock.toString()]);

      console.log(`Indexer caught up at block ${lastProcessedBlock}`);
    }
  }
}

// Called in main indexer loop after processing each batch
await checkAndSetCaughtUp(lastProcessedBlock, await getChainHead());
```

### Orchestrator Service

Manages phase transitions and runs migrations:

```typescript
// services/orchestrator/src/index.ts
import { getPool } from '@efp/shared/db';
import { runMigrationScripts } from './migrations';
import { logger } from '@efp/shared/logger';

async function main() {
  const db = getPool();
  logger.info('Orchestrator starting...');

  // Phase 1: Wait for indexer to catch up
  await waitForIndexerCatchUp(db);

  // Phase 2: Run migration
  await runMigration(db);

  // Phase 3: Enter monitoring mode
  logger.info('System ready - entering monitoring mode');
  await monitorSystem(db);
}

async function waitForIndexerCatchUp(db: Pool) {
  logger.info('Waiting for indexer to catch up...');

  while (true) {
    const result = await db.query(`
      SELECT value FROM efp_system_state WHERE key = 'indexer_caught_up'
    `);

    if (result.rows[0]?.value === 'true') {
      logger.info('Indexer caught up!');
      return;
    }

    // Log progress periodically
    const progress = await db.query(`
      SELECT last_processed_block FROM indexer_state
      ORDER BY updated_at DESC LIMIT 1
    `);
    logger.info({ block: progress.rows[0]?.last_processed_block }, 'Indexer syncing...');

    await sleep(30_000); // Check every 30 seconds
  }
}

async function runMigration(db: Pool) {
  logger.info('Starting derived table migration...');

  await db.execute(`
    UPDATE efp_system_state SET value = 'migrating', updated_at = NOW()
    WHERE key = 'phase'
  `);

  // Run migration scripts in order
  await runMigrationScripts(db, [
    '001_populate_efp_user_stats.sql',
    '002_populate_efp_followers.sql',
    '003_populate_efp_following.sql',
    '004_populate_efp_leaderboard.sql',
    '005_populate_efp_mutuals.sql',
    '006_create_wal_triggers.sql',
    '007_index_elasticsearch.sql',
  ]);

  // Mark complete
  await db.execute(`
    UPDATE efp_system_state SET value = 'true', updated_at = NOW()
    WHERE key = 'migration_complete'
  `);
  await db.execute(`
    UPDATE efp_system_state SET value = 'listening', updated_at = NOW()
    WHERE key = 'phase'
  `);

  logger.info('Migration complete!');
}

async function monitorSystem(db: Pool) {
  // Stay alive for health checks and periodic maintenance
  while (true) {
    await sleep(60_000 * 5); // Every 5 minutes

    // Optional: Check for data consistency issues
    // Optional: Trigger periodic recomputation jobs
    // Optional: Log system health metrics

    const stats = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM efp_lists) as lists,
        (SELECT COUNT(*) FROM efp_followers) as followers,
        (SELECT COUNT(*) FROM efp_user_stats) as users
    `);
    logger.info({ stats: stats.rows[0] }, 'System health check');
  }
}

main().catch((err) => {
  logger.error(err, 'Orchestrator fatal error');
  process.exit(1);
});
```

### WAL-Listener Startup

Waits for migration before activating:

```typescript
// services/wal-listener/src/index.ts
async function main() {
  logger.info('WAL-Listener starting...');

  await waitForMigrationComplete();

  logger.info('Migration complete - activating WAL listener');
  await startWALListener();
}

async function waitForMigrationComplete() {
  while (true) {
    const result = await db.query(`
      SELECT value FROM efp_system_state WHERE key = 'migration_complete'
    `);

    if (result.rows[0]?.value === 'true') {
      return;
    }

    const phase = await db.query(`
      SELECT value FROM efp_system_state WHERE key = 'phase'
    `);
    logger.info({ phase: phase.rows[0]?.value }, 'Waiting for migration...');

    await sleep(10_000);
  }
}
```

### API Phase Middleware

```typescript
// services/api/src/middleware/phase.ts
import { env } from '../config';

export async function phaseMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Always allow health endpoints
  if (request.url.startsWith('/health') || request.url.startsWith('/api/v1/health')) {
    return;
  }

  const phase = await getSystemPhase();

  // Add phase header for debugging
  reply.header('X-EFP-Phase', phase);

  // Skip check if override enabled
  if (env.SERVE_DURING_SYNC) {
    return;
  }

  // Block requests during sync
  if (phase !== 'listening') {
    return reply.code(503).header('Retry-After', '60').send({
      error: 'Service initializing',
      phase: phase,
      message: 'System is syncing blockchain data. Please retry shortly.',
    });
  }
}

async function getSystemPhase(): Promise<string> {
  const result = await db.query(`
    SELECT value FROM efp_system_state WHERE key = 'phase'
  `);
  return result.rows[0]?.value || 'unknown';
}
```

---

## Deployment Configuration

### Service Dependencies

```yaml
# docker-compose.yml / Railway template
services:
  postgres:
    image: postgres:15

  redis:
    image: redis:7

  elasticsearch:
    image: elasticsearch:8.11.0

  indexer:
    build: ./services/indexer
    depends_on: [postgres]
    environment:
      - RECOVER_HISTORY=true

  orchestrator:
    build: ./services/orchestrator
    depends_on: [postgres, elasticsearch]
    # Waits for indexer via DB flag polling

  wal-listener:
    build: ./services/wal-listener
    depends_on: [postgres, redis, elasticsearch]
    # Waits for migration via DB flag polling

  workers:
    build: ./services/workers
    depends_on: [postgres, redis]
    # Waits for migration via DB flag polling

  api:
    build: ./services/api
    depends_on: [postgres, redis, elasticsearch]
    # Serves 503 until migration complete (unless override)
    ports:
      - "3000:3000"
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `REDIS_URL` | required | Redis connection string |
| `ELASTICSEARCH_URL` | required | Elasticsearch connection string |
| `CHAIN_ID` | `8453` | Primary chain (Base) |
| `PRIMARY_RPC_BASE` | required | Base RPC endpoint |
| `PRIMARY_RPC_OP` | required | Optimism RPC endpoint |
| `PRIMARY_RPC_ETH` | required | Ethereum RPC endpoint |
| `SERVE_DURING_SYNC` | `false` | Allow API requests during sync phases |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `API_PORT` | `3000` | API server port |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW` | `60000` | Rate limit window in ms |

---

## Design Decisions

1. **ENS Resolution**: Background sync - pre-resolve all addresses, keep in `ens_metadata` table, refresh periodically via pg-boss worker

2. **Rate Limiting**: IP-based rate limiting only (no API keys for now)

3. **API Versioning**: Keep `/api/v1` with same response shapes for backwards compatibility

4. **Existing Integrations**: Full backwards compatibility required

5. **Multi-region**: Not a concern - existing 4-region deployment pattern will continue

6. **Indexer Changes**: WAL-listener approach - minimal changes to indexer, derived data updates via WAL detection + pg-boss jobs

7. **Data Population**: Fresh indexer run will populate core tables, derived tables populated via WAL-listener + workers (no manual backfill)

---

## Migration SQL Scripts

These scripts are run by the orchestrator after the indexer catches up. They populate derived tables from core indexed data.

### Understanding the Data Model (Verified Against Indexer Schema)

**Core tables (from indexer):**
- `efp_lists` - NFT ownership with composite key `(nft_chain_id, nft_contract_address, token_id)`
- `efp_list_records` - Records indexed by `(chain_id, contract_address, slot, record)`
- `efp_list_record_tags` - Tags on records with key `(chain_id, contract_address, slot, record, tag)`
- `efp_account_metadata` - Key-value pairs with `value` as hexstring (VARCHAR(255))

**Key data types:**
- `types.eth_address` = VARCHAR(42) with format `0x[a-f0-9]{40}`
- `types.hexstring` = VARCHAR(255) with format `0x([a-f0-9]{2})*`
- `types.efp_list_storage_location_slot` = BYTEA(32)
- `record_data` = BYTEA (20 bytes for address records)
- `token_id` = BIGINT (not NUMERIC)

**Key conversions:**
- Hex to BIGINT: `convert_hex_to_bigint(value::text)` (existing function)
- BYTEA to address: `'0x' || encode(record_data, 'hex')`

### Script 001: Populate efp_user_stats

```sql
-- migrations/001_populate_efp_user_stats.sql
-- Creates initial stats for all users seen in the protocol

INSERT INTO efp_user_stats (
    address,
    primary_list_id,
    followers_count,
    following_count,
    mutuals_count,
    blocks_count,
    blocked_by_count,
    mutes_count,
    muted_by_count,
    top8_count,
    created_at,
    updated_at
)
SELECT
    address,
    primary_list_id,
    0 as followers_count,
    0 as following_count,
    0 as mutuals_count,
    0 as blocks_count,
    0 as blocked_by_count,
    0 as mutes_count,
    0 as muted_by_count,
    0 as top8_count,
    NOW() as created_at,
    NOW() as updated_at
FROM (
    -- All addresses that are list users (have a list)
    SELECT DISTINCT
        l."user" as address,
        (
            SELECT convert_hex_to_bigint(am.value::text)
            FROM efp_account_metadata am
            WHERE am.address = l."user"
              AND am."key" = 'primary-list'
            LIMIT 1
        ) as primary_list_id
    FROM efp_lists l
    WHERE l."user" IS NOT NULL
      AND l."user" != ''

    UNION

    -- All addresses that have been followed (from record_data)
    SELECT DISTINCT
        '0x' || encode(r.record_data, 'hex') as address,
        NULL::BIGINT as primary_list_id
    FROM efp_list_records r
    WHERE r.record_type = 1  -- Address record type
) all_addresses
WHERE address IS NOT NULL
  AND address ~ '^0x[a-f0-9]{40}$'  -- Valid eth address format
ON CONFLICT (address) DO UPDATE SET
    primary_list_id = COALESCE(EXCLUDED.primary_list_id, efp_user_stats.primary_list_id),
    updated_at = NOW();
```

### Script 002: Populate efp_followers

```sql
-- migrations/002_populate_efp_followers.sql
-- Denormalizes follower relationships for fast queries
-- A valid follow requires:
--   1. The list has a storage location pointing to the records
--   2. The list is set as the user's primary list
--   3. The record exists in that storage location

INSERT INTO efp_followers (
    address,
    follower_address,
    follower_list_id,
    is_blocked,
    is_muted,
    tags,
    created_at,
    updated_at
)
SELECT
    -- The address being followed (decoded from record_data)
    '0x' || encode(r.record_data, 'hex') as address,

    -- The follower (user of the list)
    l."user" as follower_address,

    -- The list ID (token_id is BIGINT)
    l.token_id as follower_list_id,

    -- Check for block tag
    EXISTS (
        SELECT 1 FROM efp_list_record_tags t
        WHERE t.chain_id = r.chain_id
          AND t.contract_address = r.contract_address
          AND t.slot = r.slot
          AND t.record = r.record
          AND t.tag = 'block'
    ) as is_blocked,

    -- Check for mute tag
    EXISTS (
        SELECT 1 FROM efp_list_record_tags t
        WHERE t.chain_id = r.chain_id
          AND t.contract_address = r.contract_address
          AND t.slot = r.slot
          AND t.record = r.record
          AND t.tag = 'mute'
    ) as is_muted,

    -- Aggregate all tags into array
    COALESCE(
        (
            SELECT array_agg(DISTINCT t.tag ORDER BY t.tag)
            FROM efp_list_record_tags t
            WHERE t.chain_id = r.chain_id
              AND t.contract_address = r.contract_address
              AND t.slot = r.slot
              AND t.record = r.record
        ),
        '{}'::TEXT[]
    ) as tags,

    NOW() as created_at,
    NOW() as updated_at

FROM efp_list_records r
-- Join to list via storage location
INNER JOIN efp_lists l ON
    l.list_storage_location_chain_id = r.chain_id
    AND l.list_storage_location_contract_address = r.contract_address
    AND l.list_storage_location_slot = r.slot
-- Only include if this is the user's primary list
INNER JOIN efp_account_metadata am ON
    am.address = l."user"
    AND am."key" = 'primary-list'
    AND convert_hex_to_bigint(am.value::text) = l.token_id
WHERE
    r.record_type = 1  -- Address record type
    AND l."user" IS NOT NULL
    AND l."user" != ''
ON CONFLICT (address, follower_address) DO UPDATE SET
    follower_list_id = EXCLUDED.follower_list_id,
    is_blocked = EXCLUDED.is_blocked,
    is_muted = EXCLUDED.is_muted,
    tags = EXCLUDED.tags,
    updated_at = NOW();
```

### Script 003: Populate efp_following

```sql
-- migrations/003_populate_efp_following.sql
-- Denormalizes following relationships (inverse perspective of followers)

INSERT INTO efp_following (
    address,
    list_id,
    following_address,
    is_blocked,
    is_muted,
    tags,
    created_at,
    updated_at
)
SELECT
    -- The follower (user of the list)
    l."user" as address,

    -- The list ID
    l.token_id as list_id,

    -- The address being followed
    '0x' || encode(r.record_data, 'hex') as following_address,

    -- Check for block tag
    EXISTS (
        SELECT 1 FROM efp_list_record_tags t
        WHERE t.chain_id = r.chain_id
          AND t.contract_address = r.contract_address
          AND t.slot = r.slot
          AND t.record = r.record
          AND t.tag = 'block'
    ) as is_blocked,

    -- Check for mute tag
    EXISTS (
        SELECT 1 FROM efp_list_record_tags t
        WHERE t.chain_id = r.chain_id
          AND t.contract_address = r.contract_address
          AND t.slot = r.slot
          AND t.record = r.record
          AND t.tag = 'mute'
    ) as is_muted,

    -- Aggregate all tags into array
    COALESCE(
        (
            SELECT array_agg(DISTINCT t.tag ORDER BY t.tag)
            FROM efp_list_record_tags t
            WHERE t.chain_id = r.chain_id
              AND t.contract_address = r.contract_address
              AND t.slot = r.slot
              AND t.record = r.record
        ),
        '{}'::TEXT[]
    ) as tags,

    NOW() as created_at,
    NOW() as updated_at

FROM efp_list_records r
INNER JOIN efp_lists l ON
    l.list_storage_location_chain_id = r.chain_id
    AND l.list_storage_location_contract_address = r.contract_address
    AND l.list_storage_location_slot = r.slot
INNER JOIN efp_account_metadata am ON
    am.address = l."user"
    AND am."key" = 'primary-list'
    AND convert_hex_to_bigint(am.value::text) = l.token_id
WHERE
    r.record_type = 1
    AND l."user" IS NOT NULL
    AND l."user" != ''
ON CONFLICT (address, following_address) DO UPDATE SET
    list_id = EXCLUDED.list_id,
    is_blocked = EXCLUDED.is_blocked,
    is_muted = EXCLUDED.is_muted,
    tags = EXCLUDED.tags,
    updated_at = NOW();
```

### Script 004: Update User Stats Counts

```sql
-- migrations/004_update_user_stats_counts.sql
-- Update all count fields from the denormalized tables

-- Batch update all stats in one pass for efficiency
WITH stats AS (
    SELECT
        us.address,
        COALESCE(flwr.followers_count, 0) as followers_count,
        COALESCE(flwg.following_count, 0) as following_count,
        COALESCE(blk.blocks_count, 0) as blocks_count,
        COALESCE(blkd.blocked_by_count, 0) as blocked_by_count,
        COALESCE(mt.mutes_count, 0) as mutes_count,
        COALESCE(mtd.muted_by_count, 0) as muted_by_count,
        COALESCE(t8.top8_count, 0) as top8_count
    FROM efp_user_stats us
    LEFT JOIN (
        SELECT address, COUNT(*) as followers_count
        FROM efp_followers
        WHERE is_blocked = FALSE AND is_muted = FALSE
        GROUP BY address
    ) flwr ON flwr.address = us.address
    LEFT JOIN (
        SELECT address, COUNT(*) as following_count
        FROM efp_following
        WHERE is_blocked = FALSE AND is_muted = FALSE
        GROUP BY address
    ) flwg ON flwg.address = us.address
    LEFT JOIN (
        SELECT address, COUNT(*) as blocks_count
        FROM efp_following
        WHERE is_blocked = TRUE
        GROUP BY address
    ) blk ON blk.address = us.address
    LEFT JOIN (
        SELECT address, COUNT(*) as blocked_by_count
        FROM efp_followers
        WHERE is_blocked = TRUE
        GROUP BY address
    ) blkd ON blkd.address = us.address
    LEFT JOIN (
        SELECT address, COUNT(*) as mutes_count
        FROM efp_following
        WHERE is_muted = TRUE
        GROUP BY address
    ) mt ON mt.address = us.address
    LEFT JOIN (
        SELECT address, COUNT(*) as muted_by_count
        FROM efp_followers
        WHERE is_muted = TRUE
        GROUP BY address
    ) mtd ON mtd.address = us.address
    LEFT JOIN (
        SELECT address, COUNT(*) as top8_count
        FROM efp_followers
        WHERE 'top8' = ANY(tags)
        GROUP BY address
    ) t8 ON t8.address = us.address
)
UPDATE efp_user_stats us
SET
    followers_count = stats.followers_count,
    following_count = stats.following_count,
    blocks_count = stats.blocks_count,
    blocked_by_count = stats.blocked_by_count,
    mutes_count = stats.mutes_count,
    muted_by_count = stats.muted_by_count,
    top8_count = stats.top8_count,
    updated_at = NOW()
FROM stats
WHERE us.address = stats.address;
```

### Script 005: Populate efp_mutuals

```sql
-- migrations/005_populate_efp_mutuals.sql
-- Mutual follows: A follows B AND B follows A (neither blocked/muted)

INSERT INTO efp_mutuals (address_a, address_b, created_at)
SELECT
    LEAST(f1.follower_address, f1.address) as address_a,
    GREATEST(f1.follower_address, f1.address) as address_b,
    NOW() as created_at
FROM efp_followers f1
INNER JOIN efp_followers f2 ON
    f2.address = f1.follower_address
    AND f2.follower_address = f1.address
WHERE
    f1.is_blocked = FALSE
    AND f1.is_muted = FALSE
    AND f2.is_blocked = FALSE
    AND f2.is_muted = FALSE
    -- Only process one direction to avoid duplicates
    AND f1.follower_address < f1.address
ON CONFLICT (address_a, address_b) DO NOTHING;

-- Update mutuals_count in user_stats
UPDATE efp_user_stats us
SET
    mutuals_count = (
        SELECT COUNT(*)
        FROM efp_mutuals m
        WHERE m.address_a = us.address OR m.address_b = us.address
    ),
    updated_at = NOW();
```

### Script 006: Populate efp_leaderboard

```sql
-- migrations/006_populate_efp_leaderboard.sql
-- Pre-computed rankings for leaderboard queries

INSERT INTO efp_leaderboard (
    address,
    followers_count,
    following_count,
    mutuals_count,
    followers_rank,
    following_rank,
    mutuals_rank,
    blocks_rank,
    top8_rank,
    updated_at
)
SELECT
    address,
    followers_count,
    following_count,
    mutuals_count,
    RANK() OVER (ORDER BY followers_count DESC) as followers_rank,
    RANK() OVER (ORDER BY following_count DESC) as following_rank,
    RANK() OVER (ORDER BY mutuals_count DESC) as mutuals_rank,
    RANK() OVER (ORDER BY blocks_count DESC) as blocks_rank,
    RANK() OVER (ORDER BY top8_count DESC) as top8_rank,
    NOW() as updated_at
FROM efp_user_stats
WHERE followers_count > 0 OR following_count > 0
ON CONFLICT (address) DO UPDATE SET
    followers_count = EXCLUDED.followers_count,
    following_count = EXCLUDED.following_count,
    mutuals_count = EXCLUDED.mutuals_count,
    followers_rank = EXCLUDED.followers_rank,
    following_rank = EXCLUDED.following_rank,
    mutuals_rank = EXCLUDED.mutuals_rank,
    blocks_rank = EXCLUDED.blocks_rank,
    top8_rank = EXCLUDED.top8_rank,
    updated_at = NOW();
```

### Script 007: Create WAL Triggers

```sql
-- migrations/007_create_wal_triggers.sql
-- Triggers for LISTEN/NOTIFY to WAL-listener

-- Notify channel for table changes
CREATE OR REPLACE FUNCTION notify_efp_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'efp_changes',
        json_build_object(
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'data', CASE
                WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)
                ELSE row_to_json(NEW)
            END
        )::text
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if any (idempotent)
DROP TRIGGER IF EXISTS efp_list_records_notify ON efp_list_records;
DROP TRIGGER IF EXISTS efp_list_record_tags_notify ON efp_list_record_tags;
DROP TRIGGER IF EXISTS efp_lists_notify ON efp_lists;
DROP TRIGGER IF EXISTS efp_account_metadata_notify ON efp_account_metadata;
DROP TRIGGER IF EXISTS efp_followers_notify ON efp_followers;
DROP TRIGGER IF EXISTS efp_following_notify ON efp_following;
DROP TRIGGER IF EXISTS efp_user_stats_notify ON efp_user_stats;

-- Triggers on core tables (WAL-listener syncs derived tables)
CREATE TRIGGER efp_list_records_notify
    AFTER INSERT OR UPDATE OR DELETE ON efp_list_records
    FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

CREATE TRIGGER efp_list_record_tags_notify
    AFTER INSERT OR UPDATE OR DELETE ON efp_list_record_tags
    FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

CREATE TRIGGER efp_lists_notify
    AFTER INSERT OR UPDATE OR DELETE ON efp_lists
    FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

CREATE TRIGGER efp_account_metadata_notify
    AFTER INSERT OR UPDATE OR DELETE ON efp_account_metadata
    FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

-- Triggers on derived tables (for cache invalidation)
CREATE TRIGGER efp_followers_notify
    AFTER INSERT OR UPDATE OR DELETE ON efp_followers
    FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

CREATE TRIGGER efp_following_notify
    AFTER INSERT OR UPDATE OR DELETE ON efp_following
    FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

CREATE TRIGGER efp_user_stats_notify
    AFTER INSERT OR UPDATE OR DELETE ON efp_user_stats
    FOR EACH ROW EXECUTE FUNCTION notify_efp_change();
```

### Script 008: Index Elasticsearch

```sql
-- migrations/008_index_elasticsearch.sql
-- Marker script - actual ES indexing done by orchestrator TypeScript code

-- This query returns the data to be indexed into Elasticsearch
-- The orchestrator will execute this and batch-index the results

SELECT
    us.address,
    em.name as ens_name,
    em.avatar,
    em.display as ens_display,
    us.primary_list_id,
    us.followers_count,
    us.following_count,
    us.mutuals_count,
    lb.followers_rank,
    lb.following_rank,
    lb.mutuals_rank,
    (us.primary_list_id IS NOT NULL) as has_primary_list,
    us.updated_at
FROM efp_user_stats us
LEFT JOIN ens_metadata em ON em.address = us.address
LEFT JOIN efp_leaderboard lb ON lb.address = us.address
WHERE us.followers_count > 0 OR us.following_count > 0;
```

---

## Testing Strategy

### Philosophy

- **Comparison Testing**: During development, compare new API responses against existing production API
- **Snapshot Testing**: Capture expected response shapes for regression testing
- **Load Testing**: Verify the new system handles traffic that crashes the current one

### Test Structure

```
services/api/
├── src/
└── tests/
    ├── comparison/           # Compare against production API
    │   ├── users.test.ts
    │   ├── lists.test.ts
    │   └── leaderboard.test.ts
    ├── integration/          # Full stack integration tests
    │   ├── users.test.ts
    │   ├── lists.test.ts
    │   └── cache.test.ts
    ├── unit/                 # Unit tests for services
    │   ├── services/
    │   └── middleware/
    ├── load/                 # Load testing scripts
    │   └── k6/
    ├── fixtures/             # Test data and snapshots
    │   └── snapshots/
    └── helpers/
        ├── comparison.ts     # Comparison test utilities
        └── setup.ts          # Test setup/teardown
```

### Comparison Testing Framework

```typescript
// tests/helpers/comparison.ts
import { describe, it, expect } from 'vitest';

const PRODUCTION_API = 'https://api.ethfollow.xyz/api/v1';
const NEW_API = process.env.NEW_API_URL || 'http://localhost:3000/api/v1';

interface ComparisonOptions {
  endpoint: string;
  params?: Record<string, string>;
  // Fields to ignore in comparison (e.g., timestamps, cache headers)
  ignoreFields?: string[];
  // Fields that may differ but should be within tolerance
  toleranceFields?: { field: string; tolerance: number }[];
}

export async function compareEndpoints(options: ComparisonOptions) {
  const { endpoint, params, ignoreFields = [], toleranceFields = [] } = options;

  const queryString = params ? '?' + new URLSearchParams(params).toString() : '';
  const url = `${endpoint}${queryString}`;

  // Fetch from both APIs in parallel
  const [prodResponse, newResponse] = await Promise.all([
    fetch(`${PRODUCTION_API}${url}`).then(r => r.json()),
    fetch(`${NEW_API}${url}`).then(r => r.json()),
  ]);

  // Remove ignored fields
  const cleanProd = removeFields(prodResponse, ignoreFields);
  const cleanNew = removeFields(newResponse, ignoreFields);

  // Check tolerance fields
  for (const { field, tolerance } of toleranceFields) {
    const prodValue = getNestedField(cleanProd, field);
    const newValue = getNestedField(cleanNew, field);
    if (Math.abs(prodValue - newValue) > tolerance) {
      throw new Error(
        `Field ${field} differs by more than ${tolerance}: prod=${prodValue}, new=${newValue}`
      );
    }
    // Remove from comparison since we checked separately
    deleteNestedField(cleanProd, field);
    deleteNestedField(cleanNew, field);
  }

  return { prodResponse: cleanProd, newResponse: cleanNew };
}

function removeFields(obj: any, fields: string[]): any {
  const clone = JSON.parse(JSON.stringify(obj));
  for (const field of fields) {
    deleteNestedField(clone, field);
  }
  return clone;
}

function getNestedField(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function deleteNestedField(obj: any, path: string): void {
  const parts = path.split('.');
  const last = parts.pop()!;
  const parent = parts.reduce((o, k) => o?.[k], obj);
  if (parent) delete parent[last];
}
```

### Example Comparison Tests

```typescript
// tests/comparison/users.test.ts
import { describe, it, expect } from 'vitest';
import { compareEndpoints } from '../helpers/comparison';

// Sample addresses to test against
const TEST_ADDRESSES = [
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // vitalik.eth
  '0x983110309620D911731Ac0932219af06091b6744', // brantly.eth
  // Add more known addresses
];

describe('Users API Comparison', () => {
  describe('GET /users/:address/account', () => {
    for (const address of TEST_ADDRESSES) {
      it(`returns matching data for ${address}`, async () => {
        const { prodResponse, newResponse } = await compareEndpoints({
          endpoint: `/users/${address}/account`,
          ignoreFields: ['last_updated', 'cache_timestamp'],
        });

        expect(newResponse).toEqual(prodResponse);
      });
    }
  });

  describe('GET /users/:address/details', () => {
    for (const address of TEST_ADDRESSES) {
      it(`returns matching data for ${address}`, async () => {
        const { prodResponse, newResponse } = await compareEndpoints({
          endpoint: `/users/${address}/details`,
          ignoreFields: ['last_updated'],
          // Counts might differ slightly due to timing
          toleranceFields: [
            { field: 'followers_count', tolerance: 5 },
            { field: 'following_count', tolerance: 5 },
          ],
        });

        expect(newResponse).toEqual(prodResponse);
      });
    }
  });

  describe('GET /users/:address/followers', () => {
    for (const address of TEST_ADDRESSES) {
      it(`returns matching followers for ${address}`, async () => {
        const { prodResponse, newResponse } = await compareEndpoints({
          endpoint: `/users/${address}/followers`,
          params: { limit: '10', offset: '0' },
          ignoreFields: ['last_updated'],
        });

        // Check structure matches
        expect(newResponse.followers).toHaveLength(prodResponse.followers.length);

        // Check each follower matches (order may differ)
        const prodAddresses = new Set(prodResponse.followers.map((f: any) => f.address));
        const newAddresses = new Set(newResponse.followers.map((f: any) => f.address));
        expect(newAddresses).toEqual(prodAddresses);
      });
    }
  });

  describe('GET /users/:address/stats', () => {
    for (const address of TEST_ADDRESSES) {
      it(`returns matching stats for ${address}`, async () => {
        const { prodResponse, newResponse } = await compareEndpoints({
          endpoint: `/users/${address}/stats`,
          toleranceFields: [
            { field: 'followers_count', tolerance: 5 },
            { field: 'following_count', tolerance: 5 },
            { field: 'mutuals_count', tolerance: 5 },
          ],
        });

        // Structure should match even if counts slightly differ
        expect(Object.keys(newResponse)).toEqual(Object.keys(prodResponse));
      });
    }
  });
});
```

### Snapshot Testing for Response Shapes

```typescript
// tests/integration/users.test.ts
import { describe, it, expect } from 'vitest';
import { app } from '../../src/app';

describe('Users API', () => {
  describe('GET /users/:address/account', () => {
    it('returns correct response shape', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/account',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();

      // Verify response shape matches expected schema
      expect(body).toMatchSnapshot({
        // Dynamic fields that change
        last_updated: expect.any(String),
      });

      // Verify required fields exist
      expect(body).toHaveProperty('address');
      expect(body).toHaveProperty('ens');
      expect(body).toHaveProperty('primary_list');
    });
  });
});
```

### Load Testing with k6

```javascript
// tests/load/k6/stress-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

// Addresses that caused crashes in production
const HOT_ADDRESSES = [
  '0x47a89a0633dc6b5fba5cc1f19985905eb3584266',
  '0x4860b6885224ebb273c5f18653844eca7f171f82',
  '0x7a8e0d45ffae3fb39433600e0b24e1f4dd92ce64',
];

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '3m', target: 50 },   // Stay at 50
    { duration: '1m', target: 100 },  // Ramp to 100
    { duration: '3m', target: 100 },  // Stay at 100
    { duration: '1m', target: 200 },  // Ramp to 200 (stress)
    { duration: '3m', target: 200 },  // Stay at 200
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    errors: ['rate<0.01'],              // Error rate under 1%
  },
};

export default function () {
  const address = HOT_ADDRESSES[Math.floor(Math.random() * HOT_ADDRESSES.length)];

  // Simulate the traffic pattern that crashes production
  const responses = http.batch([
    ['GET', `${__ENV.API_URL}/api/v1/users/${address}/account`],
    ['GET', `${__ENV.API_URL}/api/v1/users/${address}/details`],
  ]);

  for (const res of responses) {
    const success = check(res, {
      'status is 200': (r) => r.status === 200,
      'response time < 500ms': (r) => r.timings.duration < 500,
    });
    errorRate.add(!success);
  }

  sleep(0.1); // 100ms between requests per user
}
```

### CI Integration

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:unit

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
      redis:
        image: redis:7
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:integration

  comparison-tests:
    runs-on: ubuntu-latest
    # Only run on PRs to main, not every push
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:comparison
        env:
          PRODUCTION_API: https://api.ethfollow.xyz/api/v1
```

### Test Commands

```json
// package.json (root)
{
  "scripts": {
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "vitest run --config vitest.unit.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:comparison": "vitest run --config vitest.comparison.config.ts",
    "test:load": "k6 run tests/load/k6/stress-test.js",
    "test:watch": "vitest watch"
  }
}
```

---

## Success Metrics

- **P99 latency** < 200ms for hot endpoints
- **Error rate** < 0.1%
- **Cache hit rate** > 80%
- **Zero connection pool exhaustion errors**
- **Leaderboard freshness** < 5 minutes

---

## Timeline

TBD based on resource availability and priority discussions.
