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

## Protocol Operations: Follows, Unfollows, Tags, and Untags

This section explains how the EFP protocol encodes and processes social graph operations at the byte level.

### List Records

A **List Record** represents an entry in a user's list (typically a followed address). Records are stored as byte arrays with the following structure:

```
┌─────────────────────────────────────────────────────────────┐
│                      LIST RECORD (22 bytes for v1/type 1)   │
├──────────────┬──────────────┬───────────────────────────────┤
│ version (1)  │  type (1)    │  data (20 bytes for address)  │
│    0x01      │    0x01      │  0x followed by 40 hex chars  │
└──────────────┴──────────────┴───────────────────────────────┘
```

**Fields:**
- **version** (1 byte): Schema version, currently `0x01`
- **type** (1 byte): Record type, `0x01` = Ethereum address
- **data** (variable): Type-specific data. For addresses, 20 bytes.

**Example - Record for vitalik.eth:**
```
0x 01 01 d8dA6BF26964aF9D7eEd9e03E53415D37aA96045
   │  │  └─────────────────────────────────────────┘
   │  │              Address (20 bytes)
   │  └─ Type: 0x01 (address)
   └──── Version: 0x01
```

### List Operations (ListOps)

A **ListOp** is an instruction that modifies a list. Operations are emitted as events on the `ListRecords` contract and processed by the indexer.

```
┌─────────────────────────────────────────────────────────────┐
│                      LIST OPERATION                          │
├──────────────┬──────────────┬───────────────────────────────┤
│ version (1)  │  opcode (1)  │  data (variable)              │
│    0x01      │   0x01-04    │  record or record + tag       │
└──────────────┴──────────────┴───────────────────────────────┘
```

**Fields:**
- **version** (1 byte): Schema version, currently `0x01`
- **opcode** (1 byte): Operation type (see table below)
- **data** (variable): Operation-specific payload

### The Four Operations

| Opcode | Name | Description | Data Field |
|--------|------|-------------|------------|
| `0x01` | **Add Record** | Follow an address | ListRecord (22 bytes) |
| `0x02` | **Remove Record** | Unfollow an address | ListRecord (22 bytes) |
| `0x03` | **Tag Record** | Add a tag to an existing record | ListRecord (22 bytes) + Tag (UTF-8) |
| `0x04` | **Untag Record** | Remove a tag from a record | ListRecord (22 bytes) + Tag (UTF-8) |

### Operation Examples

#### 1. Follow (Opcode 0x01)

**Scenario**: User follows `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` (vitalik.eth)

```
ListOp bytes:
0x 01 01 01 01 d8dA6BF26964aF9D7eEd9e03E53415D37aA96045
   │  │  └──────────────────────────────────────────────┘
   │  │              ListRecord (22 bytes)
   │  └─ Opcode: 0x01 (add record)
   └──── Version: 0x01

Breakdown of ListRecord:
   01 01 d8dA6BF26964aF9D7eEd9e03E53415D37aA96045
   │  │  └─────────────────────────────────────────┘
   │  │              Address being followed
   │  └─ Record Type: 0x01 (address)
   └──── Record Version: 0x01
```

**Result**: A new row is inserted into `efp_list_records` with the record bytes.

#### 2. Unfollow (Opcode 0x02)

**Scenario**: User unfollows the same address

```
ListOp bytes:
0x 01 02 01 01 d8dA6BF26964aF9D7eEd9e03E53415D37aA96045
      │
      └─ Opcode: 0x02 (remove record)
```

**Result**: The row is deleted from `efp_list_records`.

#### 3. Tag (Opcode 0x03)

**Scenario**: User adds the "top8" tag to vitalik.eth

```
ListOp bytes:
0x 01 03 01 01 d8dA6BF26964aF9D7eEd9e03E53415D37aA96045 746f7038
      │  └──────────────────────────────────────────────┘ └──────┘
      │              ListRecord (22 bytes)                 "top8" (UTF-8)
      └─ Opcode: 0x03 (tag record)

UTF-8 encoding of "top8":
  t    o    p    8
  74   6f   70   38
```

**Result**: A new row is inserted into `efp_list_record_tags` linking the record to the tag.

**Important**: You can only tag a record that exists. The record must be added (opcode 0x01) before it can be tagged (opcode 0x03).

#### 4. Untag (Opcode 0x04)

**Scenario**: User removes the "top8" tag from vitalik.eth

```
ListOp bytes:
0x 01 04 01 01 d8dA6BF26964aF9D7eEd9e03E53415D37aA96045 746f7038
      │
      └─ Opcode: 0x04 (untag record)
```

**Result**: The row is deleted from `efp_list_record_tags`.

### Tags

Tags are UTF-8 strings associated with list records. They modify the semantic meaning of a follow relationship.

#### Standard Tags

| Tag | Meaning | Effect on Counts |
|-----|---------|------------------|
| `block` | Neither party should see each other's activity | **Excluded** from follower/following counts |
| `mute` | Hide the muted account's activity from the user | **Excluded** from follower/following counts |
| `top8` | Designate for display in "Top 8" feature | Included in counts, tracked separately |
| *(no tag)* | Simple follow | Included in counts |

#### Tag Precedence

If both `block` and `mute` tags are present on the same record, `block` takes precedence.

#### Tag Rules

1. **Tags require a record**: You cannot tag an address you haven't followed. The follow (opcode 0x01) must happen first.

2. **Tags don't create follows**: Adding a `block` tag doesn't automatically follow someone. You must:
   - Add record (0x01) → Creates the follow
   - Tag record (0x03) with "block" → Marks it as a block

3. **Multiple tags**: A single record can have multiple tags (e.g., both "friend" and "top8").

4. **Custom tags**: Users can create arbitrary tags (max 255 bytes, alphanumeric + emojis, normalized to lowercase).

5. **Tags only count if followed**: A tag on an address only "counts" if that address is also followed by the user (has an active record).

#### Tag Constraints

- Maximum length: 255 bytes
- Encoding: UTF-8
- Normalization: Lowercase
- Allowed characters: Alphanumeric and most emojis
- No leading/trailing whitespace

### How Tags Affect Derived Tables

When processing tags in the WAL-listener and workers:

```
efp_list_records (follow exists)
        │
        ├─── efp_list_record_tags (tags on that follow)
        │           │
        │           ├─── tag = 'block' → is_blocked = TRUE
        │           ├─── tag = 'mute'  → is_muted = TRUE
        │           └─── tag = 'top8'  → include in top8_count
        │
        └─── efp_followers / efp_following
                    │
                    ├─── is_blocked = TRUE → EXCLUDE from followers_count
                    ├─── is_muted = TRUE   → EXCLUDE from followers_count
                    └─── otherwise         → INCLUDE in followers_count
```

### Example: Complete User Flow

**User A wants to follow User B, add them to top8, then later block them:**

```
Step 1: Follow User B
────────────────────
ListOp: 0x 01 01 01 01 <address_B>
Result:
  - efp_list_records: new row
  - efp_followers: B gains A as follower (is_blocked=false, is_muted=false)
  - efp_following: A gains B as following
  - B.followers_count += 1

Step 2: Add "top8" tag
──────────────────────
ListOp: 0x 01 03 01 01 <address_B> <"top8">
Result:
  - efp_list_record_tags: new row (record → "top8")
  - efp_followers: tags = ['top8']
  - B.top8_count += 1
  - B.followers_count unchanged (still counted)

Step 3: Add "block" tag
───────────────────────
ListOp: 0x 01 03 01 01 <address_B> <"block">
Result:
  - efp_list_record_tags: new row (record → "block")
  - efp_followers: is_blocked = TRUE, tags = ['block', 'top8']
  - B.followers_count -= 1 (now excluded due to block)
  - B.blocked_by_count += 1

Step 4: Remove "block" tag (unblock)
────────────────────────────────────
ListOp: 0x 01 04 01 01 <address_B> <"block">
Result:
  - efp_list_record_tags: row deleted
  - efp_followers: is_blocked = FALSE, tags = ['top8']
  - B.followers_count += 1 (included again)
  - B.blocked_by_count -= 1

Step 5: Unfollow User B
───────────────────────
ListOp: 0x 01 02 01 01 <address_B>
Result:
  - efp_list_records: row deleted
  - efp_list_record_tags: all tags for this record deleted (cascade)
  - efp_followers: row deleted
  - efp_following: row deleted
  - B.followers_count -= 1
  - B.top8_count -= 1
```

### Database Impact Summary

| Operation | efp_list_records | efp_list_record_tags | efp_followers | efp_following |
|-----------|------------------|----------------------|---------------|---------------|
| Follow (0x01) | INSERT | - | INSERT | INSERT |
| Unfollow (0x02) | DELETE | CASCADE DELETE | DELETE | DELETE |
| Tag (0x03) | - | INSERT | UPDATE tags[] | UPDATE tags[] |
| Untag (0x04) | - | DELETE | UPDATE tags[] | UPDATE tags[] |

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

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WORKERS SERVICE                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         pg-boss Queue                                │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │
│  │  │ stats   │ │ mutuals │ │ leader  │ │ ens     │ │ resync  │       │   │
│  │  │ jobs    │ │ jobs    │ │ jobs    │ │ jobs    │ │ jobs    │       │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                    ┌───────────────┼───────────────┐                       │
│                    ▼               ▼               ▼                       │
│           ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│           │ Worker Pool  │ │ Worker Pool  │ │ Worker Pool  │              │
│           │ (stats)      │ │ (mutuals)    │ │ (ens)        │              │
│           │ concurrency:5│ │ concurrency:3│ │ concurrency:2│              │
│           └──────────────┘ └──────────────┘ └──────────────┘              │
│                    │               │               │                       │
│                    ▼               ▼               ▼                       │
│           ┌──────────────────────────────────────────────┐                │
│           │              PostgreSQL / Redis / ES          │                │
│           └──────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Job Types

| Job Name | Trigger | Concurrency | Description |
|----------|---------|-------------|-------------|
| `update-user-stats` | WAL change | 5 | Recalculate counts for a user |
| `calculate-mutuals` | WAL change | 3 | Update mutual relationship between two users |
| `update-leaderboard-entry` | Stats change | 2 | Update one user's leaderboard ranking |
| `update-leaderboard-full` | Scheduled (5 min) | 1 | Full leaderboard recompute |
| `sync-ens-metadata` | New address / Scheduled | 2 | Fetch ENS name/avatar |
| `sync-user-to-elasticsearch` | Derived table change | 3 | Update ES user document |
| `resync-user-relationships` | Primary list change | 1 | Full resync of a user's follows |
| `resync-list-relationships` | List user change | 1 | Full resync of a list's follows |
| `ensure-user-stats` | New user | 5 | Create initial stats entry |
| `batch-reconcile-stats` | Scheduled (hourly) | 1 | Bulk reconciliation |
| `batch-refresh-ens` | Scheduled (daily) | 1 | Refresh stale ENS data |

### Worker Configuration

```typescript
// services/workers/src/config.ts
import PgBoss from 'pg-boss';

export const bossConfig: PgBoss.ConstructorOptions = {
  connectionString: process.env.DATABASE_URL,
  schema: 'pgboss',
  application_name: 'efp-workers',

  // Connection pool
  max: 10,

  // Retry configuration
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,

  // Job lifecycle
  expireInHours: 24,
  archiveCompletedAfterSeconds: 60 * 60 * 24 * 7,  // 7 days

  // Monitoring
  monitorStateIntervalSeconds: 30,

  // Maintenance
  deleteAfterSeconds: 60 * 60 * 24 * 14,  // 14 days
  maintenanceIntervalSeconds: 300,
};

// Per-job configuration
export const jobConfigs = {
  'update-user-stats': {
    teamSize: 5,
    teamConcurrency: 5,
    batchSize: 1,
  },
  'calculate-mutuals': {
    teamSize: 3,
    teamConcurrency: 3,
    batchSize: 1,
  },
  'update-leaderboard-entry': {
    teamSize: 2,
    teamConcurrency: 2,
    batchSize: 10,  // Process in batches
  },
  'update-leaderboard-full': {
    teamSize: 1,
    teamConcurrency: 1,
  },
  'sync-ens-metadata': {
    teamSize: 2,
    teamConcurrency: 2,
  },
  'sync-user-to-elasticsearch': {
    teamSize: 3,
    teamConcurrency: 3,
    batchSize: 50,  // Batch ES updates
  },
  'resync-user-relationships': {
    teamSize: 1,
    teamConcurrency: 1,
  },
};
```

### Worker Entry Point

```typescript
// services/workers/src/index.ts
import PgBoss from 'pg-boss';
import { bossConfig, jobConfigs } from './config';
import { logger } from '@efp/shared/logger';
import { waitForMigrationComplete } from '@efp/shared/phase';

// Import job handlers
import { handleUpdateUserStats } from './jobs/update-user-stats';
import { handleCalculateMutuals } from './jobs/calculate-mutuals';
import { handleUpdateLeaderboardEntry } from './jobs/update-leaderboard-entry';
import { handleUpdateLeaderboardFull } from './jobs/update-leaderboard-full';
import { handleSyncENSMetadata } from './jobs/sync-ens-metadata';
import { handleSyncUserToElasticsearch } from './jobs/sync-user-to-elasticsearch';
import { handleResyncUserRelationships } from './jobs/resync-user-relationships';
import { handleResyncListRelationships } from './jobs/resync-list-relationships';
import { handleEnsureUserStats } from './jobs/ensure-user-stats';
import { handleBatchReconcileStats } from './jobs/batch-reconcile-stats';
import { handleBatchRefreshENS } from './jobs/batch-refresh-ens';

async function main() {
  // Wait for system to be ready
  await waitForMigrationComplete();

  const boss = new PgBoss(bossConfig);

  boss.on('error', (err) => logger.error(err, 'pg-boss error'));
  boss.on('monitor-states', (states) => logger.info({ states }, 'Queue states'));

  await boss.start();
  logger.info('pg-boss started');

  // Register job handlers
  const handlers: [string, PgBoss.WorkHandler<any>][] = [
    ['update-user-stats', handleUpdateUserStats],
    ['calculate-mutuals', handleCalculateMutuals],
    ['update-leaderboard-entry', handleUpdateLeaderboardEntry],
    ['update-leaderboard-full', handleUpdateLeaderboardFull],
    ['sync-ens-metadata', handleSyncENSMetadata],
    ['sync-user-to-elasticsearch', handleSyncUserToElasticsearch],
    ['resync-user-relationships', handleResyncUserRelationships],
    ['resync-list-relationships', handleResyncListRelationships],
    ['ensure-user-stats', handleEnsureUserStats],
    ['batch-reconcile-stats', handleBatchReconcileStats],
    ['batch-refresh-ens', handleBatchRefreshENS],
  ];

  for (const [jobName, handler] of handlers) {
    const config = jobConfigs[jobName] || {};
    await boss.work(jobName, config, handler);
    logger.info({ jobName, config }, 'Registered job handler');
  }

  // Schedule recurring jobs
  await boss.schedule('update-leaderboard-full', '*/5 * * * *');  // Every 5 minutes
  await boss.schedule('batch-reconcile-stats', '0 * * * *');       // Every hour
  await boss.schedule('batch-refresh-ens', '0 3 * * *');           // Daily at 3 AM

  logger.info('Workers ready');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Shutting down workers...');
    await boss.stop({ graceful: true, timeout: 30000 });
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(err, 'Workers fatal error');
  process.exit(1);
});
```

### Job Handler Implementations

#### update-user-stats

```typescript
// services/workers/src/jobs/update-user-stats.ts
import PgBoss from 'pg-boss';
import { getPool } from '@efp/shared/db';
import { logger } from '@efp/shared/logger';

interface UpdateUserStatsJob {
  address: string;
}

export async function handleUpdateUserStats(
  job: PgBoss.Job<UpdateUserStatsJob>
): Promise<void> {
  const { address } = job.data;
  const db = getPool();

  logger.debug({ address }, 'Updating user stats');

  // Calculate all stats in a single query
  const result = await db.query(`
    WITH stats AS (
      SELECT
        COALESCE((
          SELECT COUNT(*) FROM efp_followers
          WHERE address = $1 AND is_blocked = FALSE AND is_muted = FALSE
        ), 0) as followers_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_following
          WHERE address = $1 AND is_blocked = FALSE AND is_muted = FALSE
        ), 0) as following_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_mutuals
          WHERE address_a = $1 OR address_b = $1
        ), 0) as mutuals_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_following
          WHERE address = $1 AND is_blocked = TRUE
        ), 0) as blocks_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_followers
          WHERE address = $1 AND is_blocked = TRUE
        ), 0) as blocked_by_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_following
          WHERE address = $1 AND is_muted = TRUE
        ), 0) as mutes_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_followers
          WHERE address = $1 AND is_muted = TRUE
        ), 0) as muted_by_count,
        COALESCE((
          SELECT COUNT(*) FROM efp_followers
          WHERE address = $1 AND 'top8' = ANY(tags)
        ), 0) as top8_count
    )
    INSERT INTO efp_user_stats (
      address, followers_count, following_count, mutuals_count,
      blocks_count, blocked_by_count, mutes_count, muted_by_count, top8_count
    )
    SELECT $1, followers_count, following_count, mutuals_count,
           blocks_count, blocked_by_count, mutes_count, muted_by_count, top8_count
    FROM stats
    ON CONFLICT (address) DO UPDATE SET
      followers_count = EXCLUDED.followers_count,
      following_count = EXCLUDED.following_count,
      mutuals_count = EXCLUDED.mutuals_count,
      blocks_count = EXCLUDED.blocks_count,
      blocked_by_count = EXCLUDED.blocked_by_count,
      mutes_count = EXCLUDED.mutes_count,
      muted_by_count = EXCLUDED.muted_by_count,
      top8_count = EXCLUDED.top8_count,
      updated_at = NOW()
    RETURNING *
  `, [address]);

  logger.info({ address, stats: result.rows[0] }, 'Updated user stats');
}
```

#### calculate-mutuals

```typescript
// services/workers/src/jobs/calculate-mutuals.ts
import PgBoss from 'pg-boss';
import { getPool } from '@efp/shared/db';
import { logger } from '@efp/shared/logger';

interface CalculateMutualsJob {
  addressA: string;
  addressB: string;
}

export async function handleCalculateMutuals(
  job: PgBoss.Job<CalculateMutualsJob>
): Promise<void> {
  const { addressA, addressB } = job.data;
  const db = getPool();

  // Normalize order (always store smaller address first)
  const [addrA, addrB] = [addressA, addressB].sort();

  logger.debug({ addrA, addrB }, 'Calculating mutual status');

  // Check if mutual relationship exists
  const mutualCheck = await db.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM efp_followers
        WHERE address = $1 AND follower_address = $2
          AND is_blocked = FALSE AND is_muted = FALSE
      ) as a_follows_b,
      EXISTS (
        SELECT 1 FROM efp_followers
        WHERE address = $2 AND follower_address = $1
          AND is_blocked = FALSE AND is_muted = FALSE
      ) as b_follows_a
  `, [addrB, addrA]);

  const { a_follows_b, b_follows_a } = mutualCheck.rows[0];
  const isMutual = a_follows_b && b_follows_a;

  if (isMutual) {
    // Upsert mutual relationship
    await db.query(`
      INSERT INTO efp_mutuals (address_a, address_b)
      VALUES ($1, $2)
      ON CONFLICT (address_a, address_b) DO NOTHING
    `, [addrA, addrB]);
    logger.info({ addrA, addrB }, 'Added mutual relationship');
  } else {
    // Remove mutual relationship if it exists
    const deleted = await db.query(`
      DELETE FROM efp_mutuals
      WHERE address_a = $1 AND address_b = $2
      RETURNING *
    `, [addrA, addrB]);

    if (deleted.rowCount > 0) {
      logger.info({ addrA, addrB }, 'Removed mutual relationship');
    }
  }
}
```

#### update-leaderboard-full

```typescript
// services/workers/src/jobs/update-leaderboard-full.ts
import PgBoss from 'pg-boss';
import { getPool } from '@efp/shared/db';
import { logger } from '@efp/shared/logger';

export async function handleUpdateLeaderboardFull(
  job: PgBoss.Job<{}>
): Promise<void> {
  const db = getPool();
  const startTime = Date.now();

  logger.info('Starting full leaderboard update');

  // Truncate and repopulate with fresh rankings
  await db.query(`
    BEGIN;

    -- Clear existing leaderboard
    TRUNCATE efp_leaderboard;

    -- Repopulate with fresh rankings
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
    WHERE followers_count > 0 OR following_count > 0;

    COMMIT;
  `);

  const duration = Date.now() - startTime;
  logger.info({ duration }, 'Completed full leaderboard update');
}
```

#### sync-ens-metadata

```typescript
// services/workers/src/jobs/sync-ens-metadata.ts
import PgBoss from 'pg-boss';
import { getPool } from '@efp/shared/db';
import { logger } from '@efp/shared/logger';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

interface SyncENSMetadataJob {
  address: string;
  force?: boolean;
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.PRIMARY_RPC_ETH),
});

export async function handleSyncENSMetadata(
  job: PgBoss.Job<SyncENSMetadataJob>
): Promise<void> {
  const { address, force } = job.data;
  const db = getPool();

  // Check if we have recent data (skip if fresh and not forced)
  if (!force) {
    const existing = await db.query(`
      SELECT fresh FROM ens_metadata
      WHERE address = $1
        AND fresh > $2
    `, [address, Date.now() - 24 * 60 * 60 * 1000]);  // 24 hours

    if (existing.rows.length > 0) {
      logger.debug({ address }, 'ENS metadata is fresh, skipping');
      return;
    }
  }

  logger.debug({ address }, 'Fetching ENS metadata');

  try {
    // Reverse resolve address to ENS name
    const name = await client.getEnsName({ address: address as `0x${string}` });

    if (!name) {
      // No ENS name, store empty record
      await db.query(`
        INSERT INTO ens_metadata (address, name, fresh)
        VALUES ($1, '', $2)
        ON CONFLICT (address) DO UPDATE SET
          name = '',
          fresh = EXCLUDED.fresh,
          updated_at = NOW()
      `, [address, Date.now()]);
      return;
    }

    // Get avatar and other records
    const [avatar, records] = await Promise.all([
      client.getEnsAvatar({ name: normalize(name) }).catch(() => null),
      client.getEnsText({ name: normalize(name), key: 'description' }).catch(() => null),
    ]);

    // Store in database
    await db.query(`
      INSERT INTO ens_metadata (address, name, avatar, records, fresh)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (address) DO UPDATE SET
        name = EXCLUDED.name,
        avatar = EXCLUDED.avatar,
        records = EXCLUDED.records,
        fresh = EXCLUDED.fresh,
        updated_at = NOW()
    `, [address, name, avatar, records ? JSON.stringify({ description: records }) : null, Date.now()]);

    logger.info({ address, name, avatar: !!avatar }, 'Updated ENS metadata');

  } catch (err) {
    logger.error({ err, address }, 'Failed to fetch ENS metadata');
    throw err;  // Will trigger retry
  }
}
```

#### sync-user-to-elasticsearch

```typescript
// services/workers/src/jobs/sync-user-to-elasticsearch.ts
import PgBoss from 'pg-boss';
import { getPool, getElasticsearch } from '@efp/shared/db';
import { logger } from '@efp/shared/logger';

interface SyncUserToElasticsearchJob {
  address: string;
}

export async function handleSyncUserToElasticsearch(
  job: PgBoss.Job<SyncUserToElasticsearchJob>
): Promise<void> {
  const { address } = job.data;
  const db = getPool();
  const es = getElasticsearch();

  // Fetch user data from PostgreSQL
  const result = await db.query(`
    SELECT
      us.address,
      us.primary_list_id,
      us.followers_count,
      us.following_count,
      us.mutuals_count,
      em.name as ens_name,
      em.avatar,
      em.display as ens_display,
      lb.followers_rank,
      lb.following_rank,
      lb.mutuals_rank,
      lb.blocks_rank,
      lb.top8_rank
    FROM efp_user_stats us
    LEFT JOIN ens_metadata em ON em.address = us.address
    LEFT JOIN efp_leaderboard lb ON lb.address = us.address
    WHERE us.address = $1
  `, [address]);

  if (result.rows.length === 0) {
    logger.debug({ address }, 'No user stats found, skipping ES sync');
    return;
  }

  const user = result.rows[0];

  // Upsert to Elasticsearch
  await es.update({
    index: 'efp_users',
    id: address,
    doc: {
      address: user.address,
      ens_name: user.ens_name || null,
      ens_name_keyword: user.ens_name || null,
      avatar: user.avatar || null,
      primary_list_id: user.primary_list_id,
      followers_count: user.followers_count,
      following_count: user.following_count,
      mutuals_count: user.mutuals_count,
      followers_rank: user.followers_rank,
      following_rank: user.following_rank,
      mutuals_rank: user.mutuals_rank,
      blocks_rank: user.blocks_rank,
      top8_rank: user.top8_rank,
      has_primary_list: user.primary_list_id !== null,
      updated_at: new Date().toISOString(),
    },
    upsert: {
      address: user.address,
      ens_name: user.ens_name || null,
      ens_name_keyword: user.ens_name || null,
      avatar: user.avatar || null,
      primary_list_id: user.primary_list_id,
      followers_count: user.followers_count,
      following_count: user.following_count,
      mutuals_count: user.mutuals_count,
      followers_rank: user.followers_rank,
      following_rank: user.following_rank,
      mutuals_rank: user.mutuals_rank,
      blocks_rank: user.blocks_rank,
      top8_rank: user.top8_rank,
      has_primary_list: user.primary_list_id !== null,
      updated_at: new Date().toISOString(),
    },
  });

  logger.debug({ address }, 'Synced user to Elasticsearch');
}
```

#### resync-user-relationships

```typescript
// services/workers/src/jobs/resync-user-relationships.ts
import PgBoss from 'pg-boss';
import { getPool } from '@efp/shared/db';
import { logger } from '@efp/shared/logger';

interface ResyncUserRelationshipsJob {
  address: string;
  newPrimaryList: number | null;
}

export async function handleResyncUserRelationships(
  job: PgBoss.Job<ResyncUserRelationshipsJob>
): Promise<void> {
  const { address, newPrimaryList } = job.data;
  const db = getPool();

  logger.info({ address, newPrimaryList }, 'Resyncing user relationships');

  await db.query('BEGIN');

  try {
    // Remove all existing follower relationships where this user is the follower
    await db.query(`
      DELETE FROM efp_followers
      WHERE follower_address = $1
    `, [address]);

    // Remove all existing following relationships for this user
    await db.query(`
      DELETE FROM efp_following
      WHERE address = $1
    `, [address]);

    // Remove all mutuals involving this user
    await db.query(`
      DELETE FROM efp_mutuals
      WHERE address_a = $1 OR address_b = $1
    `, [address]);

    // If they have a new primary list, repopulate relationships
    if (newPrimaryList !== null) {
      // Get the list's storage location
      const listResult = await db.query(`
        SELECT
          list_storage_location_chain_id as chain_id,
          list_storage_location_contract_address as contract_address,
          list_storage_location_slot as slot
        FROM efp_lists
        WHERE token_id = $1 AND "user" = $2
      `, [newPrimaryList, address]);

      if (listResult.rows.length > 0) {
        const { chain_id, contract_address, slot } = listResult.rows[0];

        // Repopulate efp_followers and efp_following from list records
        await db.query(`
          INSERT INTO efp_followers (address, follower_address, follower_list_id, is_blocked, is_muted, tags)
          SELECT
            '0x' || encode(r.record_data, 'hex'),
            $4,
            $1,
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'block'),
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'mute'),
            COALESCE((SELECT array_agg(DISTINCT t.tag ORDER BY t.tag) FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record), '{}')
          FROM efp_list_records r
          WHERE r.chain_id = $2
            AND r.contract_address = $3
            AND r.slot = $5
            AND r.record_type = 1
          ON CONFLICT (address, follower_address) DO UPDATE SET
            follower_list_id = EXCLUDED.follower_list_id,
            is_blocked = EXCLUDED.is_blocked,
            is_muted = EXCLUDED.is_muted,
            tags = EXCLUDED.tags,
            updated_at = NOW()
        `, [newPrimaryList, chain_id, contract_address, address, slot]);

        // Similarly for efp_following
        await db.query(`
          INSERT INTO efp_following (address, list_id, following_address, is_blocked, is_muted, tags)
          SELECT
            $4,
            $1,
            '0x' || encode(r.record_data, 'hex'),
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'block'),
            EXISTS (SELECT 1 FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record AND t.tag = 'mute'),
            COALESCE((SELECT array_agg(DISTINCT t.tag ORDER BY t.tag) FROM efp_list_record_tags t WHERE t.chain_id = r.chain_id AND t.contract_address = r.contract_address AND t.slot = r.slot AND t.record = r.record), '{}')
          FROM efp_list_records r
          WHERE r.chain_id = $2
            AND r.contract_address = $3
            AND r.slot = $5
            AND r.record_type = 1
          ON CONFLICT (address, following_address) DO UPDATE SET
            list_id = EXCLUDED.list_id,
            is_blocked = EXCLUDED.is_blocked,
            is_muted = EXCLUDED.is_muted,
            tags = EXCLUDED.tags,
            updated_at = NOW()
        `, [newPrimaryList, chain_id, contract_address, address, slot]);
      }
    }

    await db.query('COMMIT');

    // Queue stats update and mutuals recalculation
    // This will be handled by the WAL-listener when it sees the changes

    logger.info({ address, newPrimaryList }, 'Completed user relationship resync');

  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}
```

#### batch-reconcile-stats

```typescript
// services/workers/src/jobs/batch-reconcile-stats.ts
import PgBoss from 'pg-boss';
import { getPool } from '@efp/shared/db';
import { logger } from '@efp/shared/logger';

export async function handleBatchReconcileStats(
  job: PgBoss.Job<{}>
): Promise<void> {
  const db = getPool();
  const startTime = Date.now();

  logger.info('Starting batch stats reconciliation');

  // Find users with potentially stale stats
  // (updated_at older than 1 hour but have recent follower/following changes)
  const staleUsers = await db.query(`
    SELECT DISTINCT us.address
    FROM efp_user_stats us
    WHERE us.updated_at < NOW() - INTERVAL '1 hour'
      AND (
        EXISTS (
          SELECT 1 FROM efp_followers f
          WHERE f.address = us.address
            AND f.updated_at > us.updated_at
        )
        OR EXISTS (
          SELECT 1 FROM efp_following f
          WHERE f.address = us.address
            AND f.updated_at > us.updated_at
        )
      )
    LIMIT 1000
  `);

  logger.info({ count: staleUsers.rows.length }, 'Found stale user stats');

  // Update stats in batches
  for (const row of staleUsers.rows) {
    await db.query(`
      UPDATE efp_user_stats us
      SET
        followers_count = COALESCE((SELECT COUNT(*) FROM efp_followers WHERE address = us.address AND is_blocked = FALSE AND is_muted = FALSE), 0),
        following_count = COALESCE((SELECT COUNT(*) FROM efp_following WHERE address = us.address AND is_blocked = FALSE AND is_muted = FALSE), 0),
        mutuals_count = COALESCE((SELECT COUNT(*) FROM efp_mutuals WHERE address_a = us.address OR address_b = us.address), 0),
        updated_at = NOW()
      WHERE us.address = $1
    `, [row.address]);
  }

  const duration = Date.now() - startTime;
  logger.info({ duration, reconciled: staleUsers.rows.length }, 'Completed batch stats reconciliation');
}
```

#### batch-refresh-ens

```typescript
// services/workers/src/jobs/batch-refresh-ens.ts
import PgBoss from 'pg-boss';
import { getPool } from '@efp/shared/db';
import { logger } from '@efp/shared/logger';

export async function handleBatchRefreshENS(
  job: PgBoss.Job<{}>
): Promise<void> {
  const db = getPool();
  const boss = job.boss as PgBoss;

  logger.info('Starting batch ENS refresh');

  // Find addresses with stale ENS data (older than 7 days)
  const staleAddresses = await db.query(`
    SELECT address
    FROM ens_metadata
    WHERE fresh < $1
      OR fresh IS NULL
    ORDER BY fresh ASC NULLS FIRST
    LIMIT 500
  `, [Date.now() - 7 * 24 * 60 * 60 * 1000]);

  logger.info({ count: staleAddresses.rows.length }, 'Found stale ENS records');

  // Queue individual refresh jobs
  for (const row of staleAddresses.rows) {
    await boss.send('sync-ens-metadata', {
      address: row.address,
      force: true,
    });
  }

  logger.info('Queued ENS refresh jobs');
}
```

### Job Monitoring

```typescript
// services/workers/src/monitoring.ts
import PgBoss from 'pg-boss';
import { logger } from '@efp/shared/logger';

export function setupMonitoring(boss: PgBoss) {
  // Log queue states periodically
  boss.on('monitor-states', (states) => {
    const summary = {
      created: states.queues.created || 0,
      retry: states.queues.retry || 0,
      active: states.queues.active || 0,
      completed: states.queues.completed || 0,
      failed: states.queues.failed || 0,
    };

    logger.info({ queueStates: summary }, 'Queue status');

    // Alert if too many failed jobs
    if (summary.failed > 100) {
      logger.warn({ failed: summary.failed }, 'High number of failed jobs');
    }

    // Alert if queue is backing up
    if (summary.created > 1000) {
      logger.warn({ created: summary.created }, 'Queue backlog growing');
    }
  });

  // Log individual job failures
  boss.on('failed', (job) => {
    logger.error({
      jobId: job.id,
      jobName: job.name,
      data: job.data,
      error: job.output,
    }, 'Job failed');
  });
}
```

---

## WAL-Listener Design

The WAL-listener is responsible for:
1. Detecting changes to core tables and updating derived tables
2. Syncing derived data to Elasticsearch
3. Invalidating Redis cache entries
4. Queuing pg-boss jobs for expensive computations

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WAL-LISTENER SERVICE                               │
│                                                                             │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │  LISTEN/NOTIFY  │────▶│  Event Router   │────▶│  Action Queue   │       │
│  │  Subscriber     │     │                 │     │  (in-memory)    │       │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘       │
│                                                           │                 │
│                          ┌────────────────────────────────┼─────────────┐   │
│                          ▼                                ▼             ▼   │
│                 ┌─────────────────┐          ┌─────────────────┐  ┌──────┐ │
│                 │  Derived Table  │          │  Elasticsearch  │  │Redis │ │
│                 │  Updater        │          │  Sync           │  │Inval │ │
│                 └─────────────────┘          └─────────────────┘  └──────┘ │
│                          │                                                  │
│                          ▼                                                  │
│                 ┌─────────────────┐                                        │
│                 │  pg-boss Job    │                                        │
│                 │  Publisher      │                                        │
│                 └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tables to Monitor

| Table | Change Type | Actions |
|-------|-------------|---------|
| `efp_list_records` | INSERT/DELETE | Update derived tables, queue stats job |
| `efp_list_record_tags` | INSERT/DELETE | Update derived tables, queue stats job |
| `efp_lists` | INSERT/UPDATE | Update derived tables if user/manager changed |
| `efp_account_metadata` | INSERT/UPDATE | Update primary list, queue stats job |
| `efp_followers` | INSERT/UPDATE/DELETE | Sync to ES, invalidate cache |
| `efp_following` | INSERT/UPDATE/DELETE | Sync to ES, invalidate cache |
| `efp_user_stats` | UPDATE | Sync to ES, invalidate cache |
| `ens_metadata` | INSERT/UPDATE | Sync to ES |

### Event Handler Implementation

```typescript
// services/wal-listener/src/index.ts
import { Client } from 'pg';
import { getPool, getRedis, getElasticsearch } from '@efp/shared';
import { publishJob } from './jobs';
import { logger } from '@efp/shared/logger';

interface WALEvent {
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  data: Record<string, any>;
}

async function main() {
  // Wait for migration complete
  await waitForMigrationComplete();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Subscribe to notification channel
  await client.query('LISTEN efp_changes');

  logger.info('WAL-Listener active, listening for changes...');

  client.on('notification', async (msg) => {
    if (msg.channel !== 'efp_changes' || !msg.payload) return;

    try {
      const event: WALEvent = JSON.parse(msg.payload);
      await handleEvent(event);
    } catch (err) {
      logger.error({ err, payload: msg.payload }, 'Failed to handle WAL event');
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Shutting down WAL-listener...');
    await client.end();
    process.exit(0);
  });
}

async function handleEvent(event: WALEvent) {
  const handler = eventHandlers[event.table];
  if (handler) {
    await handler(event.operation, event.data);
  }
}

const eventHandlers: Record<string, (op: string, data: any) => Promise<void>> = {
  'efp_list_records': handleListRecordsChange,
  'efp_list_record_tags': handleListRecordTagsChange,
  'efp_lists': handleListsChange,
  'efp_account_metadata': handleAccountMetadataChange,
  'efp_followers': handleFollowersChange,
  'efp_following': handleFollowingChange,
  'efp_user_stats': handleUserStatsChange,
  'ens_metadata': handleENSMetadataChange,
};
```

### Core Table Handlers (Trigger Derived Updates)

```typescript
// services/wal-listener/src/handlers/core-tables.ts

/**
 * Handle changes to efp_list_records
 * When a record is added/removed, update efp_followers and efp_following
 */
async function handleListRecordsChange(
  operation: string,
  data: {
    chain_id: number;
    contract_address: string;
    slot: Buffer;
    record: Buffer;
    record_type: number;
    record_data: Buffer;
  }
) {
  // Only handle address records (type 1)
  if (data.record_type !== 1) return;

  const db = getPool();
  const followedAddress = '0x' + data.record_data.toString('hex');

  // Find the list this record belongs to
  const listResult = await db.query(`
    SELECT l.token_id, l."user", am.value as primary_list_value
    FROM efp_lists l
    LEFT JOIN efp_account_metadata am ON
      am.address = l."user"
      AND am."key" = 'primary-list'
    WHERE l.list_storage_location_chain_id = $1
      AND l.list_storage_location_contract_address = $2
      AND l.list_storage_location_slot = $3
  `, [data.chain_id, data.contract_address, data.slot]);

  if (listResult.rows.length === 0) return;

  const list = listResult.rows[0];
  const followerAddress = list.user;

  // Check if this is the user's primary list
  const primaryListId = list.primary_list_value
    ? convertHexToBigInt(list.primary_list_value)
    : null;
  const isPrimaryList = primaryListId === list.token_id;

  if (!isPrimaryList) {
    logger.debug({ list: list.token_id }, 'Skipping non-primary list record');
    return;
  }

  // Get tags for this record
  const tagsResult = await db.query(`
    SELECT array_agg(tag ORDER BY tag) as tags
    FROM efp_list_record_tags
    WHERE chain_id = $1
      AND contract_address = $2
      AND slot = $3
      AND record = $4
  `, [data.chain_id, data.contract_address, data.slot, data.record]);

  const tags = tagsResult.rows[0]?.tags || [];
  const isBlocked = tags.includes('block');
  const isMuted = tags.includes('mute');

  if (operation === 'INSERT') {
    // Add to efp_followers (address being followed)
    await db.query(`
      INSERT INTO efp_followers (address, follower_address, follower_list_id, is_blocked, is_muted, tags)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (address, follower_address) DO UPDATE SET
        follower_list_id = EXCLUDED.follower_list_id,
        is_blocked = EXCLUDED.is_blocked,
        is_muted = EXCLUDED.is_muted,
        tags = EXCLUDED.tags,
        updated_at = NOW()
    `, [followedAddress, followerAddress, list.token_id, isBlocked, isMuted, tags]);

    // Add to efp_following (the follower's perspective)
    await db.query(`
      INSERT INTO efp_following (address, list_id, following_address, is_blocked, is_muted, tags)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (address, following_address) DO UPDATE SET
        list_id = EXCLUDED.list_id,
        is_blocked = EXCLUDED.is_blocked,
        is_muted = EXCLUDED.is_muted,
        tags = EXCLUDED.tags,
        updated_at = NOW()
    `, [followerAddress, list.token_id, followedAddress, isBlocked, isMuted, tags]);

  } else if (operation === 'DELETE') {
    // Remove from derived tables
    await db.query(`
      DELETE FROM efp_followers
      WHERE address = $1 AND follower_address = $2
    `, [followedAddress, followerAddress]);

    await db.query(`
      DELETE FROM efp_following
      WHERE address = $1 AND following_address = $2
    `, [followerAddress, followedAddress]);
  }

  // Queue stats update jobs for both addresses
  await publishJob('update-user-stats', { address: followedAddress });
  await publishJob('update-user-stats', { address: followerAddress });

  // Queue mutuals recalculation
  await publishJob('calculate-mutuals', {
    addressA: followerAddress,
    addressB: followedAddress,
  });

  logger.info({
    operation,
    follower: followerAddress,
    followed: followedAddress,
  }, 'Processed list record change');
}

/**
 * Handle changes to efp_list_record_tags
 * When a tag is added/removed, update the derived tables
 */
async function handleListRecordTagsChange(
  operation: string,
  data: {
    chain_id: number;
    contract_address: string;
    slot: Buffer;
    record: Buffer;
    tag: string;
  }
) {
  const db = getPool();

  // Get record details
  const recordResult = await db.query(`
    SELECT record_data, record_type
    FROM efp_list_records
    WHERE chain_id = $1
      AND contract_address = $2
      AND slot = $3
      AND record = $4
  `, [data.chain_id, data.contract_address, data.slot, data.record]);

  if (recordResult.rows.length === 0 || recordResult.rows[0].record_type !== 1) {
    return;
  }

  const followedAddress = '0x' + recordResult.rows[0].record_data.toString('hex');

  // Find the list and follower
  const listResult = await db.query(`
    SELECT l."user" as follower_address
    FROM efp_lists l
    INNER JOIN efp_account_metadata am ON
      am.address = l."user"
      AND am."key" = 'primary-list'
      AND convert_hex_to_bigint(am.value::text) = l.token_id
    WHERE l.list_storage_location_chain_id = $1
      AND l.list_storage_location_contract_address = $2
      AND l.list_storage_location_slot = $3
  `, [data.chain_id, data.contract_address, data.slot]);

  if (listResult.rows.length === 0) return;

  const followerAddress = listResult.rows[0].follower_address;

  // Get updated tags list
  const tagsResult = await db.query(`
    SELECT array_agg(tag ORDER BY tag) as tags
    FROM efp_list_record_tags
    WHERE chain_id = $1
      AND contract_address = $2
      AND slot = $3
      AND record = $4
  `, [data.chain_id, data.contract_address, data.slot, data.record]);

  const tags = tagsResult.rows[0]?.tags || [];
  const isBlocked = tags.includes('block');
  const isMuted = tags.includes('mute');

  // Update derived tables with new tag state
  await db.query(`
    UPDATE efp_followers
    SET is_blocked = $3, is_muted = $4, tags = $5, updated_at = NOW()
    WHERE address = $1 AND follower_address = $2
  `, [followedAddress, followerAddress, isBlocked, isMuted, tags]);

  await db.query(`
    UPDATE efp_following
    SET is_blocked = $3, is_muted = $4, tags = $5, updated_at = NOW()
    WHERE address = $1 AND following_address = $2
  `, [followerAddress, followedAddress, isBlocked, isMuted, tags]);

  // Queue stats update (block/mute affects counts)
  await publishJob('update-user-stats', { address: followedAddress });
  await publishJob('update-user-stats', { address: followerAddress });

  // Recalculate mutuals if block/mute changed
  if (data.tag === 'block' || data.tag === 'mute') {
    await publishJob('calculate-mutuals', {
      addressA: followerAddress,
      addressB: followedAddress,
    });
  }

  logger.info({
    operation,
    tag: data.tag,
    follower: followerAddress,
    followed: followedAddress,
  }, 'Processed tag change');
}

/**
 * Handle changes to efp_account_metadata
 * Primary list changes require full resync of follower relationships
 */
async function handleAccountMetadataChange(
  operation: string,
  data: {
    address: string;
    key: string;
    value: string;
  }
) {
  // Only care about primary-list changes
  if (data.key !== 'primary-list') return;

  const db = getPool();

  // Queue a full resync job for this user
  await publishJob('resync-user-relationships', {
    address: data.address,
    newPrimaryList: data.value ? convertHexToBigInt(data.value) : null,
  });

  logger.info({
    address: data.address,
    operation,
  }, 'Primary list changed, queued resync');
}

/**
 * Handle changes to efp_lists
 * User/manager assignment changes may affect relationships
 */
async function handleListsChange(
  operation: string,
  data: {
    token_id: number;
    user: string;
    manager: string;
  }
) {
  if (operation === 'INSERT') {
    // New list created, ensure user has stats entry
    await publishJob('ensure-user-stats', { address: data.user });
  } else if (operation === 'UPDATE') {
    // User assignment changed, may need to resync
    await publishJob('resync-list-relationships', { tokenId: data.token_id });
  }
}
```

### Derived Table Handlers (Sync to ES + Cache Invalidation)

```typescript
// services/wal-listener/src/handlers/derived-tables.ts

/**
 * Handle changes to efp_followers
 * Sync to Elasticsearch and invalidate Redis cache
 */
async function handleFollowersChange(
  operation: string,
  data: {
    address: string;
    follower_address: string;
    is_blocked: boolean;
    is_muted: boolean;
  }
) {
  const redis = getRedis();

  // Invalidate cache for both addresses
  const patterns = [
    `efp:/users/${data.address}/*`,
    `efp:/users/${data.follower_address}/*`,
    `efp:/lists/*`,  // Could be more targeted with list_id
  ];

  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug({ pattern, count: keys.length }, 'Invalidated cache keys');
    }
  }

  // Queue ES sync for affected addresses
  await publishJob('sync-user-to-elasticsearch', { address: data.address });
  await publishJob('sync-user-to-elasticsearch', { address: data.follower_address });
}

/**
 * Handle changes to efp_following
 * Similar to followers but from the opposite perspective
 */
async function handleFollowingChange(
  operation: string,
  data: {
    address: string;
    following_address: string;
  }
) {
  const redis = getRedis();

  // Invalidate cache
  const patterns = [
    `efp:/users/${data.address}/*`,
    `efp:/users/${data.following_address}/*`,
  ];

  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}

/**
 * Handle changes to efp_user_stats
 * Sync updated stats to Elasticsearch
 */
async function handleUserStatsChange(
  operation: string,
  data: {
    address: string;
    followers_count: number;
    following_count: number;
    mutuals_count: number;
  }
) {
  const redis = getRedis();
  const es = getElasticsearch();

  // Invalidate cache
  await redis.del(`efp:/users/${data.address}/stats`);
  await redis.del(`efp:/users/${data.address}/details`);

  // Update Elasticsearch
  await es.update({
    index: 'efp_users',
    id: data.address,
    doc: {
      followers_count: data.followers_count,
      following_count: data.following_count,
      mutuals_count: data.mutuals_count,
      updated_at: new Date().toISOString(),
    },
    upsert: {
      address: data.address,
      followers_count: data.followers_count,
      following_count: data.following_count,
      mutuals_count: data.mutuals_count,
      updated_at: new Date().toISOString(),
    },
  });

  // Queue leaderboard update if counts changed significantly
  await publishJob('update-leaderboard-entry', { address: data.address });
}

/**
 * Handle changes to ens_metadata
 * Update user's ENS info in Elasticsearch
 */
async function handleENSMetadataChange(
  operation: string,
  data: {
    address: string;
    name: string;
    avatar: string;
    display: string;
  }
) {
  const redis = getRedis();
  const es = getElasticsearch();

  // Invalidate cache
  await redis.del(`efp:/users/${data.address}/account`);
  await redis.del(`efp:/users/${data.address}/details`);
  await redis.del(`efp:/users/${data.address}/ens`);

  // Update Elasticsearch
  await es.update({
    index: 'efp_users',
    id: data.address,
    doc: {
      ens_name: data.name,
      ens_display: data.display,
      avatar: data.avatar,
      updated_at: new Date().toISOString(),
    },
    upsert: {
      address: data.address,
      ens_name: data.name,
      ens_display: data.display,
      avatar: data.avatar,
      updated_at: new Date().toISOString(),
    },
  });
}
```

### Job Publisher

```typescript
// services/wal-listener/src/jobs.ts
import PgBoss from 'pg-boss';

let boss: PgBoss;

export async function initJobQueue() {
  boss = new PgBoss(process.env.DATABASE_URL!);
  await boss.start();
}

export async function publishJob(
  jobName: string,
  data: Record<string, any>,
  options?: { priority?: number; singletonKey?: string }
) {
  const jobOptions: PgBoss.SendOptions = {};

  if (options?.priority) {
    jobOptions.priority = options.priority;
  }

  // Use singleton to dedupe rapid-fire updates for same entity
  if (options?.singletonKey) {
    jobOptions.singletonKey = options.singletonKey;
    jobOptions.singletonSeconds = 5;  // Dedupe within 5 seconds
  }

  await boss.send(jobName, data, jobOptions);
}

// Convenience methods with deduplication
export const publishUserStatsJob = (address: string) =>
  publishJob('update-user-stats', { address }, { singletonKey: `stats:${address}` });

export const publishMutualsJob = (addressA: string, addressB: string) => {
  const key = [addressA, addressB].sort().join(':');
  return publishJob('calculate-mutuals', { addressA, addressB }, { singletonKey: `mutuals:${key}` });
};

export const publishESUserSync = (address: string) =>
  publishJob('sync-user-to-elasticsearch', { address }, { singletonKey: `es:${address}` });
```
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

## API Response Shapes (Backwards Compatibility)

### Production API Reference

**Production URL:** `https://api.ethfollow.xyz/api/v1`
**Documentation:** https://ethidentitykit.com/docs/api

### Development Pattern: Verify Before Implement

Before implementing any endpoint, always verify the response shape against production:

```typescript
// Pattern: Fetch from production, examine response, then implement
async function verifyEndpoint(endpoint: string, params?: Record<string, string>) {
  const url = new URL(`https://api.ethfollow.xyz/api/v1${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const response = await fetch(url.toString());
  const data = await response.json();

  console.log('Status:', response.status);
  console.log('Headers:', Object.fromEntries(response.headers.entries()));
  console.log('Body:', JSON.stringify(data, null, 2));

  return data;
}

// Example: Before implementing /users/:address/details
await verifyEndpoint('/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/details');
```

### Complete Endpoint Parity Checklist

All endpoints must match production exactly. Check each off as verified and implemented.

#### Users Endpoints (`/users/:addressOrENS/*`)

| # | Endpoint | Priority | Status |
|---|----------|----------|--------|
| 1 | `GET /users/:addressOrENS/account` | P0 - Critical | ⬜ |
| 2 | `GET /users/:addressOrENS/details` | P0 - Critical | ⬜ |
| 3 | `GET /users/:addressOrENS/stats` | P0 - Critical | ⬜ |
| 4 | `GET /users/:addressOrENS/followers` | P1 - Core | ⬜ |
| 5 | `GET /users/:addressOrENS/following` | P1 - Core | ⬜ |
| 6 | `GET /users/:addressOrENS/allFollowers` | P1 - Core | ⬜ |
| 7 | `GET /users/:addressOrENS/allFollowing` | P1 - Core | ⬜ |
| 8 | `GET /users/:addressOrENS/commonFollowers` | P2 - Extended | ⬜ |
| 9 | `GET /users/:addressOrENS/ens` | P2 - Extended | ⬜ |
| 10 | `GET /users/:addressOrENS/followerState` | P2 - Extended | ⬜ |
| 11 | `GET /users/:addressOrENS/latestFollowers` | P2 - Extended | ⬜ |
| 12 | `GET /users/:addressOrENS/list-records` | P2 - Extended | ⬜ |
| 13 | `GET /users/:addressOrENS/lists` | P2 - Extended | ⬜ |
| 14 | `GET /users/:addressOrENS/notifications` | P3 - Advanced | ⬜ |
| 15 | `GET /users/:addressOrENS/poap` | P3 - Advanced | ⬜ |
| 16 | `GET /users/:addressOrENS/primary-list` | P2 - Extended | ⬜ |
| 17 | `GET /users/:addressOrENS/qr` | P3 - Advanced | ⬜ |
| 18 | `GET /users/:addressOrENS/recommended` | P3 - Advanced | ⬜ |
| 19 | `GET /users/:addressOrENS/relationships` | P2 - Extended | ⬜ |
| 20 | `GET /users/:addressOrENS/searchFollowers` | P2 - Extended | ⬜ |
| 21 | `GET /users/:addressOrENS/searchFollowing` | P2 - Extended | ⬜ |
| 22 | `GET /users/:addressOrENS/taggedAs` | P2 - Extended | ⬜ |
| 23 | `GET /users/:addressOrENS/tags` | P2 - Extended | ⬜ |

#### Lists Endpoints (`/lists/:token_id/*`)

| # | Endpoint | Priority | Status |
|---|----------|----------|--------|
| 24 | `GET /lists/:token_id/account` | P1 - Core | ⬜ |
| 25 | `GET /lists/:token_id/details` | P1 - Core | ⬜ |
| 26 | `GET /lists/:token_id/stats` | P1 - Core | ⬜ |
| 27 | `GET /lists/:token_id/followers` | P1 - Core | ⬜ |
| 28 | `GET /lists/:token_id/following` | P1 - Core | ⬜ |
| 29 | `GET /lists/:token_id/allFollowers` | P1 - Core | ⬜ |
| 30 | `GET /lists/:token_id/allFollowing` | P1 - Core | ⬜ |
| 31 | `GET /lists/:token_id/allFollowingAddresses` | P2 - Extended | ⬜ |
| 32 | `GET /lists/:token_id/buttonState` | P2 - Extended | ⬜ |
| 33 | `GET /lists/:token_id/followerState` | P2 - Extended | ⬜ |
| 34 | `GET /lists/:token_id/latestFollowers` | P2 - Extended | ⬜ |
| 35 | `GET /lists/:token_id/poap` | P3 - Advanced | ⬜ |
| 36 | `GET /lists/:token_id/records` | P2 - Extended | ⬜ |
| 37 | `GET /lists/:token_id/recommended` | P3 - Advanced | ⬜ |
| 38 | `GET /lists/:token_id/searchFollowers` | P2 - Extended | ⬜ |
| 39 | `GET /lists/:token_id/searchFollowing` | P2 - Extended | ⬜ |
| 40 | `GET /lists/:token_id/taggedAs` | P2 - Extended | ⬜ |
| 41 | `GET /lists/:token_id/tags` | P2 - Extended | ⬜ |

#### Leaderboard Endpoints (`/leaderboard/*`)

| # | Endpoint | Priority | Status |
|---|----------|----------|--------|
| 42 | `GET /leaderboard/ranked` | P1 - Core | ⬜ |
| 43 | `GET /leaderboard/followers` | P1 - Core | ⬜ |
| 44 | `GET /leaderboard/following` | P1 - Core | ⬜ |
| 45 | `GET /leaderboard/blocks` | P2 - Extended | ⬜ |
| 46 | `GET /leaderboard/blocked` | P2 - Extended | ⬜ |
| 47 | `GET /leaderboard/mutes` | P2 - Extended | ⬜ |
| 48 | `GET /leaderboard/muted` | P2 - Extended | ⬜ |
| 49 | `GET /leaderboard/all` | P2 - Extended | ⬜ |
| 50 | `GET /leaderboard/count` | P2 - Extended | ⬜ |
| 51 | `GET /leaderboard/search` | P2 - Extended | ⬜ |

#### Global Endpoints

| # | Endpoint | Priority | Status |
|---|----------|----------|--------|
| 52 | `GET /stats` | P1 - Core | ⬜ |
| 53 | `GET /discover` | P2 - Extended | ⬜ |
| 54 | `GET /minters` | P3 - Advanced | ⬜ |
| 55 | `GET /exportState` | P3 - Advanced | ⬜ |
| 56 | `GET /serviceHealth` | P0 - Critical | ⬜ |

#### Token Endpoints (`/token/*`)

| # | Endpoint | Priority | Status |
|---|----------|----------|--------|
| 57 | `GET /token/metadata` | P3 - Advanced | ⬜ |
| 58 | `GET /token/image` | P3 - Advanced | ⬜ |

#### Slots Endpoints (`/slots/*`)

| # | Endpoint | Priority | Status |
|---|----------|----------|--------|
| 59 | `GET /slots/:slot/details` | P3 - Advanced | ⬜ |

#### Debug Endpoints (`/debug/*`)

| # | Endpoint | Priority | Status |
|---|----------|----------|--------|
| 60 | `GET /debug/num-events` | P3 - Advanced | ⬜ |
| 61 | `GET /debug/num-list-ops` | P3 - Advanced | ⬜ |
| 62 | `GET /debug/total-supply` | P3 - Advanced | ⬜ |

**Total: 62 endpoints**

### Priority Definitions

- **P0 - Critical**: Endpoints causing production crashes, must implement first
- **P1 - Core**: Essential functionality used by most integrations
- **P2 - Extended**: Full feature parity for complete compatibility
- **P3 - Advanced**: Specialized features, implement last

### Core Types

```typescript
// Base address type
type Address = `0x${string}`;

// ENS Profile (returned when include=ens)
interface ENSProfile {
  name: string | null;
  address: Address;
  avatar: string | null;
  updated_at?: string;
  records?: string;
  contenthash?: string;
}

// ENS Profile in batch responses
interface ENSProfileResponse {
  name: string | null;
  address: Address;
  avatar: string | null;
  type?: 'error' | 'success';
}
```

### Critical Endpoint Response Shapes (P0)

#### GET /users/:address/account

```typescript
// Response
{
  address: Address;
  ens?: ENSProfile;
}

// Example
{
  "address": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
  "ens": {
    "name": "vitalik.eth",
    "address": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    "avatar": "https://euc.li/vitalik.eth",
    "updated_at": "2024-04-03T12:00:00Z"
  }
}
```

#### GET /users/:address/details

```typescript
// Response
{
  address: Address;
  ens?: ENSProfile;
  ranks: {
    mutuals_rank: number;
    followers_rank: number;
    following_rank: number;
    top8_rank: number;
    blocks_rank: number;
  };
  primary_list: string | null;  // Token ID as string, or null
}
```

#### GET /users/:address/stats

```typescript
// Response
{
  followers_count: number;
  following_count: number;
}
```

### Core Endpoint Response Shapes (P1)

#### GET /users/:address/followers

**Query params:** `limit`, `offset`, `sort` (latest|followers|earliest), `tags`, `include` (ens|mutuals|blocked|muted)

```typescript
// Response
{
  followers: Array<{
    address: Address;
    tags: string[];
    is_following: boolean;
    is_blocked: boolean;
    is_muted: boolean;
    ens?: ENSProfileResponse;  // Only if include=ens
  }>;
}
```

#### GET /users/:address/following

**Query params:** `limit`, `offset`, `sort` (latest|followers|earliest), `tags`, `include` (ens|mutuals|blocked|muted)

```typescript
// Response
{
  following: Array<{
    version: number;
    record_type: 'address' | string;
    data: Address;
    address: Address;
    tags: string[];
    ens?: ENSProfileResponse;
  }>;
}
```

#### GET /leaderboard/ranked

**Query params:** `limit` (default 50), `offset`, `sort` (mutuals|followers|following|blocks|top8), `direction` (DESC|ASC)

```typescript
// Response
{
  last_updated: string;
  results: Array<{
    address: Address;
    name: string | undefined;
    avatar: string | undefined;
    header: string | undefined;
    mutuals_rank: number;
    followers_rank: number;
    following_rank: number;
    blocks_rank: number;
    top8_rank: number;
    mutuals: number;
    following: number;
    followers: number;
    blocks: number;
    top8: number;
    updated_at: string;
  }>;
}
```

#### GET /leaderboard/followers (and similar)

```typescript
// Response: Direct array (no wrapper object)
Array<{
  rank: number;
  address: Address;
  followers_count: number;  // or following_count, blocks_count, etc.
}>
```

### Error Responses

```typescript
// 400 Bad Request
{
  response: string;  // e.g., "ENS name not valid or does not exist"
  error?: string;
}

// 404 Not Found
{
  response: "No User Found";
}

// 503 Service Unavailable (during sync, if SERVE_DURING_SYNC=false)
{
  error: "Service initializing";
  phase: "historical" | "migrating";
  message: "System is syncing blockchain data. Please retry shortly.";
}
```

### Response Headers

| Header | Description |
|--------|-------------|
| `X-Cache` | `HIT` or `MISS` - indicates cache status |
| `X-EFP-Phase` | Current system phase (when `SERVE_DURING_SYNC=true`) |
| `X-Response-Time` | Request processing time |

### Query Parameter Standards

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 10 (50 for ranked) | Max items to return |
| `offset` | number | 0 | Items to skip |
| `sort` | string | 'latest' | Sort order |
| `direction` | string | 'DESC' | Sort direction |
| `tags` | string | - | Comma-separated tag filter |
| `include` | string | - | Additional data (ens, mutuals, blocked, muted) |
| `cache` | string | - | Set to 'fresh' to bypass cache |

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

---

## Appendix: Project Summary & Resources

### Objective

Rewrite the EFP (Ethereum Follow Protocol) backend to handle significantly increased traffic that is currently causing production crashes. The solution adopts proven patterns from the Grails ENS marketplace backend, which has demonstrated reliability under high load.

### Core Problem

The existing EFP API runs on Cloudflare Workers (serverless), which creates and destroys database connections rapidly. Under burst traffic to `/users/:address/account` and `/users/:address/details` endpoints, the PostgreSQL connection pool becomes exhausted, causing `08P01` protocol violation errors and cascading failures.

### Solution Architecture

Replace the serverless architecture with a traditional service-based architecture:

| Component | Current | New |
|-----------|---------|-----|
| **API** | Cloudflare Workers (Hono) | Fastify with connection pooling |
| **Cache Invalidation** | cache-register (polling, sequential) | WAL-listener (CDC, real-time) |
| **Background Jobs** | Interval-based services | pg-boss (PostgreSQL job queue) |
| **Search/Leaderboard** | PostgreSQL stored procedures | Elasticsearch |
| **Database** | PostgreSQL (query-heavy) | PostgreSQL (CDC-friendly) + derived tables |

### Key Design Decisions

1. **ENS Resolution**: Background sync - pre-resolve all addresses, refresh periodically
2. **Rate Limiting**: IP-based only (no API keys for now)
3. **API Version**: Keep `/api/v1` with identical response shapes for backwards compatibility
4. **Indexer Changes**: Minimal - only add `indexer_caught_up` flag, WAL-listener handles derived data
5. **Phase Management**: Automatic via orchestrator service (historical → migrating → listening)
6. **Data Population**: Fresh indexer run, no manual backfill required

### Protocol Understanding

**EFP (Ethereum Follow Protocol)** is an on-chain social graph for Ethereum:

- **3 Smart Contracts**:
  - `ListRegistry` (Base): ERC721 NFTs representing follow lists
  - `ListRecords` (Base, Optimism, Mainnet): Stores follow/block/mute operations
  - `AccountMetadata` (Base): Stores primary list designation

- **Operations** (opcodes 1-4): Follow, Unfollow, Tag, Untag
- **Record Format**: `0x01 01 <20-byte-address>` (version, type, data)
- **Primary List**: A follow only "counts" if it's from the user's designated primary list
- **Tags**: block, mute, top8, and custom tags modify follow semantics

### Services Overview

| Service | Responsibility |
|---------|----------------|
| **Indexer** | Blockchain event indexing → core tables. Sets `indexer_caught_up` flag when synced. |
| **Orchestrator** | Phase management, derived table migration, system health monitoring. |
| **WAL-Listener** | PostgreSQL CDC → Elasticsearch sync + Redis cache invalidation + pg-boss job queuing. |
| **Workers** | Background job processing: stats updates, leaderboard, ENS sync, mutuals calculation. |
| **API** | HTTP endpoints with Redis caching, rate limiting, connection pooling. |

### Database Architecture

**Core Tables** (populated by indexer):
- `events` - Raw blockchain events
- `efp_lists` - NFT ownership and storage locations
- `efp_list_records` - Follow/block/mute records
- `efp_list_record_tags` - Tags on records
- `efp_account_metadata` - Primary list designation

**Derived Tables** (populated by migration + WAL-listener):
- `efp_followers` - Denormalized follower relationships
- `efp_following` - Denormalized following relationships
- `efp_user_stats` - Pre-computed counts per user
- `efp_leaderboard` - Pre-computed rankings
- `efp_mutuals` - Mutual follow relationships

### API Compatibility

- **62 endpoints** must match production exactly
- **P0 Critical**: `/users/:address/account`, `/users/:address/details`, `/users/:address/stats`
- **Response shapes**: All field names use snake_case, ENS data optional via `include=ens`
- **Testing**: Compare against production API before implementing each endpoint

### Resources & References

#### External Documentation

| Resource | URL |
|----------|-----|
| EFP Documentation | https://docs.efp.app/ |
| EFP State Interpretation | https://docs.efp.app/production/interpreting-state/ |
| API Documentation | https://ethidentitykit.com/docs/api |
| Production API | https://api.ethfollow.xyz/api/v1 |

#### EFP Repositories (ethereumfollowprotocol)

| Repository | GitHub URL | Description |
|------------|------------|-------------|
| Indexer | https://github.com/ethereumfollowprotocol/indexer | Blockchain event indexer (Bun + PostgreSQL) |
| API | https://github.com/ethereumfollowprotocol/api | Current API (Cloudflare Workers + Hono) |
| Contracts | https://github.com/ethereumfollowprotocol/contracts | Smart contracts (Solidity) |
| Cache Register | https://github.com/ethereumfollowprotocol/cache-register | Cache invalidation service |

#### Grails Repositories (grailsmarket)

| Repository | GitHub URL | Description |
|------------|------------|-------------|
| Backend | https://github.com/grailsmarket/backend | Reference architecture (Fastify, pg-boss, WAL-listener) |

#### New Repository (this project)

| Repository | GitHub URL | Description |
|------------|------------|-------------|
| API V2 | https://github.com/ethereumfollowprotocol/api-v2 | New API implementation |

### Key Patterns from Grails

1. **Connection Pooling**: Singleton pattern with `getPostgresPool()`
2. **WAL-based CDC**: PostgreSQL LISTEN/NOTIFY for real-time change detection
3. **pg-boss**: PostgreSQL-native job queue (no external message broker)
4. **Per-route Cache TTL**: Different TTLs for different endpoint volatility
5. **Transactional Workers**: BEGIN/ROLLBACK for multi-step operations
6. **Idempotency**: Singleton keys prevent duplicate job processing
7. **Graceful Shutdown**: SIGTERM handlers in every service
8. **Zod Validation**: Schema validation for all inputs and configs

### File Structure

```
services/
├── api/                    # Fastify REST API
│   ├── src/
│   │   ├── index.ts        # Server entry point
│   │   ├── routes/         # Route handlers (62 endpoints)
│   │   ├── middleware/     # Cache, rate-limit, phase-check
│   │   └── services/       # Business logic
│   └── tests/
│       ├── comparison/     # Compare against production
│       ├── integration/    # Full stack tests
│       └── load/           # k6 stress tests
│
├── indexer/                # Existing (minimal changes)
│
├── orchestrator/           # Phase management + migration
│   ├── src/
│   │   ├── index.ts
│   │   └── migrations/     # SQL scripts (001-008)
│   └── package.json
│
├── wal-listener/           # PostgreSQL CDC
│   ├── src/
│   │   ├── index.ts
│   │   ├── handlers/       # Table-specific handlers
│   │   └── jobs.ts         # pg-boss publisher
│   └── package.json
│
├── workers/                # pg-boss job handlers
│   ├── src/
│   │   ├── index.ts
│   │   └── jobs/           # 11 job handlers
│   └── package.json
│
└── shared/                 # Shared utilities
    ├── src/
    │   ├── config/         # Environment + validation
    │   ├── db/             # PostgreSQL + Redis + ES clients
    │   ├── types/          # Zod schemas + TypeScript types
    │   └── phase.ts        # Phase management utilities
    └── package.json
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `ELASTICSEARCH_URL` | Yes | Elasticsearch connection string |
| `CHAIN_ID` | Yes | Primary chain (8453 for Base) |
| `PRIMARY_RPC_BASE` | Yes | Base RPC endpoint |
| `PRIMARY_RPC_OP` | Yes | Optimism RPC endpoint |
| `PRIMARY_RPC_ETH` | Yes | Ethereum RPC endpoint |
| `SERVE_DURING_SYNC` | No | Allow API requests during sync (default: false) |
| `LOG_LEVEL` | No | Logging verbosity (default: info) |
| `API_PORT` | No | API server port (default: 3000) |
| `RATE_LIMIT_MAX` | No | Max requests per window per IP (default: 100) |
| `RATE_LIMIT_WINDOW` | No | Rate limit window in ms (default: 60000) |

### Success Criteria

- [ ] P99 latency < 200ms for hot endpoints
- [ ] Error rate < 0.1%
- [ ] Cache hit rate > 80%
- [ ] Zero connection pool exhaustion errors
- [ ] Leaderboard freshness < 5 minutes
- [ ] 100% API parity with production (62 endpoints)
- [ ] All comparison tests passing
- [ ] Load tests passing at 200 concurrent users

---

*This document serves as the living specification for the EFP V2 backend rewrite. It will be updated as implementation progresses and decisions are refined.*
