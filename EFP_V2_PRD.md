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
│    - Writes to PostgreSQL events table                                       │
│    - Triggers dispatch to event handlers                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              POSTGRESQL DATABASE                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  Core Tables    │  │  Derived Tables │  │  Job Queue      │             │
│  │  - events       │  │  - efp_followers│  │  - pgboss.*     │             │
│  │  - efp_lists    │  │  - efp_following│  │                 │             │
│  │  - efp_records  │  │  - efp_stats    │  │                 │             │
│  │  - efp_tags     │  │  - efp_leaderbd │  │                 │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
         │                         │                        │
         │                         │                        │
         ▼                         ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────────┐
│  WAL-LISTENER   │    │  ELASTICSEARCH  │    │      PG-BOSS WORKERS        │
│  - CDC from WAL │    │  - Users index  │    │  - update-follower-counts   │
│  - Triggers ES  │    │  - Leaderboard  │    │  - update-leaderboard       │
│    sync         │    │  - Search       │    │  - sync-ens-metadata        │
│  - Invalidates  │    │                 │    │  - calculate-mutuals        │
│    Redis cache  │    │                 │    │  - invalidate-cache         │
└─────────────────┘    └─────────────────┘    └─────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FASTIFY API                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  Redis Cache    │  │  Route Handlers │  │  Connection     │             │
│  │  - Per-route    │  │  - /users/*     │  │  Pooling        │             │
│  │    TTL config   │  │  - /lists/*     │  │  - Singleton    │             │
│  │  - X-Cache hdr  │  │  - /leaderboard │  │    pattern      │             │
│  │  - Skip on auth │  │  - /stats       │  │  - Graceful     │             │
│  └─────────────────┘  └─────────────────┘  │    shutdown     │             │
│                                            └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

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

## Migration Strategy

### Phase 1: Infrastructure Setup
- [ ] Set up new PostgreSQL with derived tables
- [ ] Set up Elasticsearch cluster
- [ ] Set up Redis
- [ ] Set up pg-boss schema

### Phase 2: Data Migration
- [ ] Backfill `efp_user_stats` from existing data
- [ ] Backfill `efp_followers` / `efp_following` tables
- [ ] Backfill `efp_leaderboard`
- [ ] Index users in Elasticsearch

### Phase 3: Services
- [ ] Deploy WAL-listener
- [ ] Deploy pg-boss workers
- [ ] Deploy Fastify API (shadow mode)

### Phase 4: Cutover
- [ ] Route traffic to new API
- [ ] Monitor for issues
- [ ] Deprecate old API

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

## Success Metrics

- **P99 latency** < 200ms for hot endpoints
- **Error rate** < 0.1%
- **Cache hit rate** > 80%
- **Zero connection pool exhaustion errors**
- **Leaderboard freshness** < 5 minutes

---

## Timeline

TBD based on resource availability and priority discussions.
