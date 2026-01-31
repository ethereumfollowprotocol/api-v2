import { query } from './db/postgres.js';
import { logger } from './logger.js';

export type Phase = 'historical' | 'migrating' | 'listening';

export interface SystemState {
  phase: Phase;
  indexerCaughtUp: boolean;
  migrationComplete: boolean;
  lastMigrationBlock: number;
}

export async function getSystemState(): Promise<SystemState> {
  const result = await query<{ key: string; value: string }>(`
    SELECT key, value FROM efp_system_state
    WHERE key IN ('phase', 'indexer_caught_up', 'migration_complete', 'last_migration_block')
  `);

  const stateMap = new Map(result.rows.map((row) => [row.key, row.value]));

  return {
    phase: (stateMap.get('phase') as Phase) || 'historical',
    indexerCaughtUp: stateMap.get('indexer_caught_up') === 'true',
    migrationComplete: stateMap.get('migration_complete') === 'true',
    lastMigrationBlock: parseInt(stateMap.get('last_migration_block') || '0', 10),
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

export async function waitForMigrationComplete(pollIntervalMs = 10000): Promise<void> {
  logger.info('Waiting for migration to complete...');

  while (true) {
    if (await isMigrationComplete()) {
      logger.info('Migration complete!');
      return;
    }

    const phase = await getPhase();
    logger.debug({ phase }, 'Waiting for migration...');
    await sleep(pollIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
