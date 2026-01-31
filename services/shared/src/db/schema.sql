-- EFP V2 Database Schema
-- This file contains both core tables (for fresh setup) and derived tables

-- ============================================================
-- TYPES
-- ============================================================

-- Custom domains (may already exist in indexer)
DO $$ BEGIN
  CREATE DOMAIN types.eth_address AS VARCHAR(42) CHECK (VALUE ~ '^0x[a-f0-9]{40}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- UTILITY FUNCTIONS
-- ============================================================

-- Convert hex string to bigint
CREATE OR REPLACE FUNCTION convert_hex_to_bigint(hex_string TEXT)
RETURNS BIGINT AS $$
DECLARE
    clean_hex TEXT;
BEGIN
    IF hex_string IS NULL OR hex_string = '' OR hex_string = '0x' THEN
        RETURN NULL;
    END IF;

    -- Remove 0x prefix if present
    clean_hex := CASE
        WHEN hex_string LIKE '0x%' THEN substring(hex_string from 3)
        ELSE hex_string
    END;

    -- Convert to bigint
    RETURN ('x' || lpad(clean_hex, 16, '0'))::bit(64)::bigint;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Auto-update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SYSTEM STATE TABLE (for phase management)
-- ============================================================

CREATE TABLE IF NOT EXISTS efp_system_state (
    key                 VARCHAR(64) PRIMARY KEY,
    value               TEXT,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Initial state values
INSERT INTO efp_system_state (key, value) VALUES
    ('phase', 'historical'),
    ('indexer_caught_up', 'false'),
    ('migration_complete', 'false'),
    ('last_migration_block', '0')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- CORE TABLES (populated by indexer)
-- ============================================================

-- Raw blockchain events
CREATE TABLE IF NOT EXISTS events (
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
CREATE TABLE IF NOT EXISTS efp_lists (
    nft_chain_id                            BIGINT DEFAULT 8453,
    nft_contract_address                    VARCHAR(42),
    token_id                                BIGINT NOT NULL,
    owner                                   VARCHAR(42) NOT NULL,
    manager                                 VARCHAR(42),
    "user"                                  VARCHAR(42),
    list_storage_location                   BYTEA,
    list_storage_location_chain_id          BIGINT,
    list_storage_location_contract_address  VARCHAR(42),
    list_storage_location_slot              BYTEA,
    created_at                              TIMESTAMPTZ DEFAULT NOW(),
    updated_at                              TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (token_id)
);

CREATE INDEX IF NOT EXISTS idx_efp_lists_user ON efp_lists("user");
CREATE INDEX IF NOT EXISTS idx_efp_lists_owner ON efp_lists(owner);
CREATE INDEX IF NOT EXISTS idx_efp_lists_storage_location ON efp_lists(
    list_storage_location_chain_id,
    list_storage_location_contract_address,
    list_storage_location_slot
);

-- List records (follows/blocks/mutes)
CREATE TABLE IF NOT EXISTS efp_list_records (
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

CREATE INDEX IF NOT EXISTS idx_efp_list_records_slot ON efp_list_records(chain_id, contract_address, slot);
CREATE INDEX IF NOT EXISTS idx_efp_list_records_record_type ON efp_list_records(record_type);

-- Record tags
CREATE TABLE IF NOT EXISTS efp_list_record_tags (
    chain_id            BIGINT NOT NULL,
    contract_address    VARCHAR(42) NOT NULL,
    slot                BYTEA NOT NULL,
    record              BYTEA NOT NULL,
    tag                 VARCHAR(255) NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chain_id, contract_address, slot, record, tag)
);

CREATE INDEX IF NOT EXISTS idx_efp_list_record_tags_lookup ON efp_list_record_tags(chain_id, contract_address, slot, record);

-- Account metadata (primary list designation)
CREATE TABLE IF NOT EXISTS efp_account_metadata (
    chain_id            BIGINT NOT NULL DEFAULT 8453,
    contract_address    VARCHAR(42) NOT NULL,
    address             VARCHAR(42) NOT NULL,
    key                 VARCHAR(255) NOT NULL,
    value               VARCHAR(255),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address, key)
);

CREATE INDEX IF NOT EXISTS idx_efp_account_metadata_key ON efp_account_metadata(key);

-- ============================================================
-- DERIVED TABLES (populated by migration + WAL-listener)
-- ============================================================

-- Denormalized user stats (updated by workers)
CREATE TABLE IF NOT EXISTS efp_user_stats (
    address             VARCHAR(42) PRIMARY KEY,
    primary_list_id     BIGINT,
    followers_count     INTEGER DEFAULT 0,
    following_count     INTEGER DEFAULT 0,
    mutuals_count       INTEGER DEFAULT 0,
    blocks_count        INTEGER DEFAULT 0,
    blocked_by_count    INTEGER DEFAULT 0,
    mutes_count         INTEGER DEFAULT 0,
    muted_by_count      INTEGER DEFAULT 0,
    top8_count          INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_efp_user_stats_followers ON efp_user_stats(followers_count DESC);
CREATE INDEX IF NOT EXISTS idx_efp_user_stats_following ON efp_user_stats(following_count DESC);
CREATE INDEX IF NOT EXISTS idx_efp_user_stats_mutuals ON efp_user_stats(mutuals_count DESC);

-- Follower relationships (denormalized for fast queries)
CREATE TABLE IF NOT EXISTS efp_followers (
    address             VARCHAR(42) NOT NULL,
    follower_address    VARCHAR(42) NOT NULL,
    follower_list_id    BIGINT NOT NULL,
    is_blocked          BOOLEAN DEFAULT FALSE,
    is_muted            BOOLEAN DEFAULT FALSE,
    tags                TEXT[] DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address, follower_address)
);

CREATE INDEX IF NOT EXISTS idx_efp_followers_address ON efp_followers(address);
CREATE INDEX IF NOT EXISTS idx_efp_followers_follower ON efp_followers(follower_address);
CREATE INDEX IF NOT EXISTS idx_efp_followers_tags ON efp_followers USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_efp_followers_updated ON efp_followers(updated_at DESC);

-- Following relationships (denormalized)
CREATE TABLE IF NOT EXISTS efp_following (
    address             VARCHAR(42) NOT NULL,
    list_id             BIGINT NOT NULL,
    following_address   VARCHAR(42) NOT NULL,
    is_blocked          BOOLEAN DEFAULT FALSE,
    is_muted            BOOLEAN DEFAULT FALSE,
    tags                TEXT[] DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address, following_address)
);

CREATE INDEX IF NOT EXISTS idx_efp_following_address ON efp_following(address);
CREATE INDEX IF NOT EXISTS idx_efp_following_target ON efp_following(following_address);
CREATE INDEX IF NOT EXISTS idx_efp_following_tags ON efp_following USING GIN(tags);

-- Leaderboard (pre-computed rankings)
CREATE TABLE IF NOT EXISTS efp_leaderboard (
    address             VARCHAR(42) PRIMARY KEY,
    followers_count     INTEGER DEFAULT 0,
    following_count     INTEGER DEFAULT 0,
    mutuals_count       INTEGER DEFAULT 0,
    blocks_count        INTEGER DEFAULT 0,
    top8_count          INTEGER DEFAULT 0,
    followers_rank      INTEGER,
    following_rank      INTEGER,
    mutuals_rank        INTEGER,
    blocks_rank         INTEGER,
    top8_rank           INTEGER,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_efp_leaderboard_followers ON efp_leaderboard(followers_rank);
CREATE INDEX IF NOT EXISTS idx_efp_leaderboard_following ON efp_leaderboard(following_rank);
CREATE INDEX IF NOT EXISTS idx_efp_leaderboard_mutuals ON efp_leaderboard(mutuals_rank);

-- ENS metadata cache
CREATE TABLE IF NOT EXISTS ens_metadata (
    address             VARCHAR(42) PRIMARY KEY,
    name                VARCHAR(255),
    avatar              TEXT,
    header              TEXT,
    records             JSONB,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ens_metadata_name ON ens_metadata(name);

-- Mutual followers (pre-computed)
CREATE TABLE IF NOT EXISTS efp_mutuals (
    address_a           VARCHAR(42) NOT NULL,
    address_b           VARCHAR(42) NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address_a, address_b)
);

CREATE INDEX IF NOT EXISTS idx_efp_mutuals_b ON efp_mutuals(address_b, address_a);

-- ============================================================
-- TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS update_efp_user_stats_updated_at ON efp_user_stats;
CREATE TRIGGER update_efp_user_stats_updated_at
    BEFORE UPDATE ON efp_user_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_efp_followers_updated_at ON efp_followers;
CREATE TRIGGER update_efp_followers_updated_at
    BEFORE UPDATE ON efp_followers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_efp_following_updated_at ON efp_following;
CREATE TRIGGER update_efp_following_updated_at
    BEFORE UPDATE ON efp_following
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ens_metadata_updated_at ON ens_metadata;
CREATE TRIGGER update_ens_metadata_updated_at
    BEFORE UPDATE ON ens_metadata
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_efp_lists_updated_at ON efp_lists;
CREATE TRIGGER update_efp_lists_updated_at
    BEFORE UPDATE ON efp_lists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_efp_account_metadata_updated_at ON efp_account_metadata;
CREATE TRIGGER update_efp_account_metadata_updated_at
    BEFORE UPDATE ON efp_account_metadata
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- WAL NOTIFICATION TRIGGERS
-- ============================================================

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

-- Note: WAL notification triggers are created by migration script 007
