import { getClient, createLogger } from '@efp/shared';

const logger = createLogger('migrations');

// Migration SQL scripts in order
const MIGRATIONS = [
  {
    name: '001_populate_efp_user_stats',
    sql: `
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
      SELECT DISTINCT ON (address)
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

          UNION ALL

          -- All addresses that have been followed (from record_data)
          SELECT DISTINCT
              convert_from(r.record_data, 'UTF8') as address,
              NULL::BIGINT as primary_list_id
          FROM efp_list_records r
          WHERE r.record_type = 1  -- Address record type
      ) all_addresses
      WHERE address IS NOT NULL
        AND address ~ '^0x[a-f0-9]{40}$'
      ORDER BY address, primary_list_id NULLS LAST
      ON CONFLICT (address) DO UPDATE SET
          primary_list_id = COALESCE(EXCLUDED.primary_list_id, efp_user_stats.primary_list_id),
          updated_at = NOW()
    `,
  },
  {
    name: '002_populate_efp_followers',
    sql: `
      -- Denormalizes follower relationships for fast queries
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
          convert_from(r.record_data, 'UTF8') as address,
          l."user" as follower_address,
          l.token_id as follower_list_id,
          EXISTS (
              SELECT 1 FROM efp_list_record_tags t
              WHERE t.chain_id = r.chain_id
                AND t.contract_address = r.contract_address
                AND t.slot = r.slot
                AND t.record = r.record
                AND t.tag = 'block'
          ) as is_blocked,
          EXISTS (
              SELECT 1 FROM efp_list_record_tags t
              WHERE t.chain_id = r.chain_id
                AND t.contract_address = r.contract_address
                AND t.slot = r.slot
                AND t.record = r.record
                AND t.tag = 'mute'
          ) as is_muted,
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
          AND length(convert_from(r.record_data, 'UTF8')) = 42
      ON CONFLICT (address, follower_address) DO UPDATE SET
          follower_list_id = EXCLUDED.follower_list_id,
          is_blocked = EXCLUDED.is_blocked,
          is_muted = EXCLUDED.is_muted,
          tags = EXCLUDED.tags,
          updated_at = NOW()
    `,
  },
  {
    name: '003_populate_efp_following',
    sql: `
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
          l."user" as address,
          l.token_id as list_id,
          convert_from(r.record_data, 'UTF8') as following_address,
          EXISTS (
              SELECT 1 FROM efp_list_record_tags t
              WHERE t.chain_id = r.chain_id
                AND t.contract_address = r.contract_address
                AND t.slot = r.slot
                AND t.record = r.record
                AND t.tag = 'block'
          ) as is_blocked,
          EXISTS (
              SELECT 1 FROM efp_list_record_tags t
              WHERE t.chain_id = r.chain_id
                AND t.contract_address = r.contract_address
                AND t.slot = r.slot
                AND t.record = r.record
                AND t.tag = 'mute'
          ) as is_muted,
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
          AND length(convert_from(r.record_data, 'UTF8')) = 42
      ON CONFLICT (address, following_address) DO UPDATE SET
          list_id = EXCLUDED.list_id,
          is_blocked = EXCLUDED.is_blocked,
          is_muted = EXCLUDED.is_muted,
          tags = EXCLUDED.tags,
          updated_at = NOW()
    `,
  },
  {
    name: '004_update_user_stats_counts',
    sql: `
      -- Update all count fields from the denormalized tables
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
      WHERE us.address = stats.address
    `,
  },
  {
    name: '005_populate_efp_mutuals',
    sql: `
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
          AND f1.follower_address < f1.address
      ON CONFLICT (address_a, address_b) DO NOTHING
    `,
  },
  {
    name: '006_update_mutuals_count',
    sql: `
      -- Update mutuals_count in user_stats
      UPDATE efp_user_stats us
      SET
          mutuals_count = (
              SELECT COUNT(*)
              FROM efp_mutuals m
              WHERE m.address_a = us.address OR m.address_b = us.address
          ),
          updated_at = NOW()
    `,
  },
  {
    name: '007_populate_efp_leaderboard',
    sql: `
      -- Pre-computed rankings for leaderboard queries
      INSERT INTO efp_leaderboard (
          address,
          followers_count,
          following_count,
          mutuals_count,
          blocks_count,
          top8_count,
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
          blocks_count,
          top8_count,
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
          blocks_count = EXCLUDED.blocks_count,
          top8_count = EXCLUDED.top8_count,
          followers_rank = EXCLUDED.followers_rank,
          following_rank = EXCLUDED.following_rank,
          mutuals_rank = EXCLUDED.mutuals_rank,
          blocks_rank = EXCLUDED.blocks_rank,
          top8_rank = EXCLUDED.top8_rank,
          updated_at = NOW()
    `,
  },
  {
    name: '008_create_wal_triggers',
    sql: `
      -- Triggers on core tables (WAL-listener syncs derived tables)
      DROP TRIGGER IF EXISTS efp_list_records_notify ON efp_list_records;
      CREATE TRIGGER efp_list_records_notify
          AFTER INSERT OR UPDATE OR DELETE ON efp_list_records
          FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

      DROP TRIGGER IF EXISTS efp_list_record_tags_notify ON efp_list_record_tags;
      CREATE TRIGGER efp_list_record_tags_notify
          AFTER INSERT OR UPDATE OR DELETE ON efp_list_record_tags
          FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

      DROP TRIGGER IF EXISTS efp_lists_notify ON efp_lists;
      CREATE TRIGGER efp_lists_notify
          AFTER INSERT OR UPDATE OR DELETE ON efp_lists
          FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

      DROP TRIGGER IF EXISTS efp_account_metadata_notify ON efp_account_metadata;
      CREATE TRIGGER efp_account_metadata_notify
          AFTER INSERT OR UPDATE OR DELETE ON efp_account_metadata
          FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

      -- Triggers on derived tables (for cache invalidation)
      DROP TRIGGER IF EXISTS efp_followers_notify ON efp_followers;
      CREATE TRIGGER efp_followers_notify
          AFTER INSERT OR UPDATE OR DELETE ON efp_followers
          FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

      DROP TRIGGER IF EXISTS efp_following_notify ON efp_following;
      CREATE TRIGGER efp_following_notify
          AFTER INSERT OR UPDATE OR DELETE ON efp_following
          FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

      DROP TRIGGER IF EXISTS efp_user_stats_notify ON efp_user_stats;
      CREATE TRIGGER efp_user_stats_notify
          AFTER INSERT OR UPDATE OR DELETE ON efp_user_stats
          FOR EACH ROW EXECUTE FUNCTION notify_efp_change();

      DROP TRIGGER IF EXISTS ens_metadata_notify ON ens_metadata;
      CREATE TRIGGER ens_metadata_notify
          AFTER INSERT OR UPDATE OR DELETE ON ens_metadata
          FOR EACH ROW EXECUTE FUNCTION notify_efp_change();
    `,
  },
  {
    name: '008_fix_ens_metadata_notify',
    sql: `
      -- Create a separate notify function for ens_metadata that only sends the address
      -- Avatar/header can be data URIs which exceed pg_notify's 8KB limit
      -- The handler will fetch full data from the database
      CREATE OR REPLACE FUNCTION notify_ens_metadata_change()
      RETURNS TRIGGER AS $$
      BEGIN
          PERFORM pg_notify(
              'efp_changes',
              json_build_object(
                  'table', TG_TABLE_NAME,
                  'operation', TG_OP,
                  'data', json_build_object(
                      'address', CASE WHEN TG_OP = 'DELETE' THEN OLD.address ELSE NEW.address END
                  )
              )::text
          );
          RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;

      -- Replace the trigger to use the new function
      DROP TRIGGER IF EXISTS ens_metadata_notify ON ens_metadata;
      CREATE TRIGGER ens_metadata_notify
          AFTER INSERT OR UPDATE OR DELETE ON ens_metadata
          FOR EACH ROW EXECUTE FUNCTION notify_ens_metadata_change();
    `,
  },
  {
    name: '009_add_events_target_address',
    sql: `
      -- Add target_address column to events table for efficient notification queries
      -- The target address is extracted from the op hex: position 11-50 (after 0x, version, opcode, recordVersion, recordType)
      ALTER TABLE events ADD COLUMN IF NOT EXISTS target_address VARCHAR(42);

      -- Backfill target_address from existing ListOp events
      UPDATE events
      SET target_address = '0x' || lower(substring(event_args->>'op', 11, 40))
      WHERE event_name = 'ListOp' AND target_address IS NULL;

      -- Create index for efficient queries by target address
      CREATE INDEX IF NOT EXISTS idx_events_target_address
      ON events(target_address, created_at DESC)
      WHERE event_name = 'ListOp';
    `,
  },
];

export async function runMigrations(): Promise<void> {
  const client = await getClient();

  try {
    for (const migration of MIGRATIONS) {
      logger.info({ name: migration.name }, 'Running migration');
      const startTime = Date.now();

      await client.query(migration.sql);

      const duration = Date.now() - startTime;
      logger.info({ name: migration.name, duration }, 'Migration completed');
    }

    logger.info('All migrations completed successfully');
  } finally {
    client.release();
  }
}
