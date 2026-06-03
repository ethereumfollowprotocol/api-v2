import { query } from './db/postgres.js';
import { logger } from './logger.js';

export type Phase = 'historical' | 'migrating' | 'listening';

export interface SystemState {
  phase: Phase;
  indexerCaughtUp: boolean;
  migrationComplete: boolean;
  lastMigrationBlock: number;
  schemaMigrationsComplete: boolean;
}

export async function getSystemState(): Promise<SystemState> {
  const result = await query<{ key: string; value: string }>(`
    SELECT key, value FROM efp_system_state
    WHERE key IN ('phase', 'indexer_caught_up', 'migration_complete', 'last_migration_block', 'schema_migrations_complete')
  `);

  const stateMap = new Map(result.rows.map((row) => [row.key, row.value]));

  return {
    phase: (stateMap.get('phase') as Phase) || 'historical',
    indexerCaughtUp: stateMap.get('indexer_caught_up') === 'true',
    migrationComplete: stateMap.get('migration_complete') === 'true',
    lastMigrationBlock: parseInt(stateMap.get('last_migration_block') || '0', 10),
    schemaMigrationsComplete: stateMap.get('schema_migrations_complete') === 'true',
  };
}

export async function getPhase(): Promise<Phase> {
  const result = await query<{ value: string }>(`
    SELECT value FROM efp_system_state WHERE key = 'phase'
  `);
  return (result.rows[0]?.value as Phase) || 'historical';
}

export async function setPhase(phase: Phase): Promise<void> {
  await query(
    `
    INSERT INTO efp_system_state (key, value, updated_at)
    VALUES ('phase', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `,
    [phase]
  );
  logger.info({ phase }, 'System phase updated');
}

export async function isIndexerCaughtUp(): Promise<boolean> {
  const result = await query<{ value: string }>(`
    SELECT value FROM efp_system_state WHERE key = 'indexer_caught_up'
  `);
  return result.rows[0]?.value === 'true';
}

export async function isMigrationComplete(): Promise<boolean> {
  const result = await query<{ value: string }>(`
    SELECT value FROM efp_system_state WHERE key = 'migration_complete'
  `);
  return result.rows[0]?.value === 'true';
}

export async function setMigrationComplete(complete: boolean): Promise<void> {
  await query(
    `
    INSERT INTO efp_system_state (key, value, updated_at)
    VALUES ('migration_complete', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `,
    [complete.toString()]
  );
}

export async function isSchemaMigrationsComplete(): Promise<boolean> {
  const result = await query<{ value: string }>(`
    SELECT value FROM efp_system_state WHERE key = 'schema_migrations_complete'
  `);
  return result.rows[0]?.value === 'true';
}

export async function setSchemaMigrationsComplete(complete: boolean): Promise<void> {
  await query(
    `
    INSERT INTO efp_system_state (key, value, updated_at)
    VALUES ('schema_migrations_complete', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `,
    [complete.toString()]
  );
  logger.info({ complete }, 'Schema migrations complete flag updated');
}

export async function resetDataMigrations(): Promise<void> {
  await query(`
    UPDATE efp_system_state
    SET value = 'false', updated_at = NOW()
    WHERE key IN ('indexer_caught_up', 'migration_complete')
  `);
  logger.info('Reset indexer_caught_up and migration_complete flags');
}

export async function waitForIndexerCatchUp(pollIntervalMs = 30000): Promise<void> {
  logger.info('Waiting for indexer to catch up...');

  while (true) {
    if (await isIndexerCaughtUp()) {
      logger.info('Indexer caught up!');
      return;
    }

    logger.debug('Indexer still syncing, waiting...');
    await sleep(pollIntervalMs);
  }
}

export async function waitForMigrationComplete(
  pollIntervalMs = 10000,
  escalateAfterMs = 60000
): Promise<void> {
  logger.info('Waiting for migration to complete...');

  const startedAt = Date.now();

  while (true) {
    if (await isMigrationComplete()) {
      logger.info('Migration complete!');
      return;
    }

    const waitedMs = Date.now() - startedAt;
    const phase = await getPhase();

    // This loop has no upper bound: on a fresh system we must not start
    // processing jobs until the data migrations have populated the derived
    // tables. But the indexer can reset migration_complete at runtime when it
    // re-syncs, and if the orchestrator isn't around to restore it this service
    // would stall indefinitely. Escalate to error-level so a stuck gate is
    // visible in logs/alerting instead of failing silently.
    if (waitedMs >= escalateAfterMs) {
      logger.error(
        { phase, waitedSeconds: Math.round(waitedMs / 1000) },
        'Still waiting for migration_complete=true — this service is NOT processing jobs. ' +
          'If the system is already live (phase=listening, derived tables populated), the flag ' +
          'was likely reset by an indexer re-sync; the orchestrator should restore it.'
      );
    } else {
      logger.debug({ phase, waitedMs }, 'Waiting for migration...');
    }

    await sleep(pollIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
