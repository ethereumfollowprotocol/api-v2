import type PgBoss from 'pg-boss';
import { createLogger } from '@efp/shared';
import { getBoss } from '../index.js';

const logger = createLogger('job-publisher');

// Publish a job with optional deduplication
export async function publishJob(
  jobName: string,
  data: Record<string, unknown>,
  options?: { priority?: number; singletonKey?: string; singletonSeconds?: number }
): Promise<void> {
  const boss = getBoss();

  const jobOptions: PgBoss.SendOptions = {};

  if (options?.priority) {
    jobOptions.priority = options.priority;
  }

  // Use singleton to dedupe rapid-fire updates for same entity
  if (options?.singletonKey) {
    jobOptions.singletonKey = options.singletonKey;
    jobOptions.singletonSeconds = options.singletonSeconds ?? 5; // Dedupe within 5 seconds
  }

  await boss.send(jobName, data, jobOptions);
  logger.debug({ jobName, singletonKey: options?.singletonKey }, 'Job published');
}

// Convenience methods with deduplication

export async function publishUserStatsJob(address: string): Promise<void> {
  await publishJob(
    'update-user-stats',
    { address },
    { singletonKey: `stats:${address}`, singletonSeconds: 5 }
  );
}

export async function publishMutualsJob(addressA: string, addressB: string): Promise<void> {
  const key = [addressA, addressB].sort().join(':');
  await publishJob(
    'calculate-mutuals',
    { addressA, addressB },
    { singletonKey: `mutuals:${key}`, singletonSeconds: 5 }
  );
}

export async function publishESUserSync(address: string): Promise<void> {
  await publishJob(
    'sync-user-to-elasticsearch',
    { address },
    { singletonKey: `es:${address}`, singletonSeconds: 5 }
  );
}

export async function publishResyncUserRelationships(
  address: string,
  newPrimaryList: number | null
): Promise<void> {
  await publishJob(
    'resync-user-relationships',
    { address, newPrimaryList },
    { singletonKey: `resync:${address}`, singletonSeconds: 30 }
  );
}

export async function publishEnsureUserStats(address: string): Promise<void> {
  await publishJob(
    'ensure-user-stats',
    { address },
    { singletonKey: `ensure:${address}`, singletonSeconds: 60 }
  );
}

export async function publishLeaderboardEntry(address: string): Promise<void> {
  await publishJob(
    'update-leaderboard-entry',
    { address },
    { singletonKey: `lb:${address}`, singletonSeconds: 30 }
  );
}

export async function publishENSSync(address: string, force?: boolean): Promise<void> {
  await publishJob(
    'sync-ens-metadata',
    { address, force },
    { singletonKey: `ens:${address}`, singletonSeconds: 3600 } // Dedupe for 1 hour
  );
}
