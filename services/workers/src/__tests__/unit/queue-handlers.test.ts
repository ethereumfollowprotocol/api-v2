/**
 * Handlers that queue follow-up jobs must use the boss instance passed in at registration.
 * pg-boss jobs carry no reference to it, so reading `job.boss` silently queued nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type PgBoss from 'pg-boss';

const query = vi.fn();

vi.mock('@efp/shared', () => ({
  query: (...args: unknown[]) => query(...args),
  convertHexToBigInt: (hex: string) => BigInt(hex),
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { handleBatchRefreshENS } = await import('../../jobs/batch-refresh-ens.js');
const { handleEnsureUserStats } = await import('../../jobs/ensure-user-stats.js');
const { handleResyncListRelationships } = await import('../../jobs/resync-list-relationships.js');

function makeBoss() {
  const send = vi.fn().mockResolvedValue('job-id');
  return { boss: { send } as unknown as PgBoss, send };
}

function makeJob<T>(data: T): PgBoss.Job<T> {
  return { id: 'job-1', name: 'test', data };
}

beforeEach(() => {
  query.mockReset();
});

describe('batch-refresh-ens', () => {
  it('queues a forced sync for every stale address', async () => {
    query.mockResolvedValueOnce({ rows: [{ address: '0xaaa' }, { address: '0xbbb' }] });
    const { boss, send } = makeBoss();

    await handleBatchRefreshENS(makeJob({}), boss);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'sync-ens-metadata', { address: '0xaaa', force: true });
    expect(send).toHaveBeenNthCalledWith(2, 'sync-ens-metadata', { address: '0xbbb', force: true });
  });

  it('queues nothing when no rows are stale', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { boss, send } = makeBoss();

    await handleBatchRefreshENS(makeJob({}), boss);

    expect(send).not.toHaveBeenCalled();
  });
});

describe('ensure-user-stats', () => {
  it('queues an ENS sync when a new stats row is created', async () => {
    query.mockResolvedValueOnce({ rows: [{ address: '0xaaa' }] });
    const { boss, send } = makeBoss();

    await handleEnsureUserStats(makeJob({ address: '0xaaa' }), boss);

    expect(send).toHaveBeenCalledWith(
      'sync-ens-metadata',
      { address: '0xaaa' },
      { singletonKey: 'ens:0xaaa', singletonSeconds: 3600 }
    );
  });

  it('does not queue when the stats row already existed', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { boss, send } = makeBoss();

    await handleEnsureUserStats(makeJob({ address: '0xaaa' }), boss);

    expect(send).not.toHaveBeenCalled();
  });
});

describe('resync-list-relationships', () => {
  it('delegates to resync-user-relationships for a primary list', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ user: '0xAAA' }] })
      .mockResolvedValueOnce({ rows: [{ value: '0x07' }] });
    const { boss, send } = makeBoss();

    await handleResyncListRelationships(makeJob({ tokenId: 7 }), boss);

    expect(send).toHaveBeenCalledWith(
      'resync-user-relationships',
      { address: '0xaaa', newPrimaryList: 7 },
      { singletonKey: 'resync:0xaaa', singletonSeconds: 30 }
    );
  });

  it('does not delegate for a non-primary list', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ user: '0xaaa' }] })
      .mockResolvedValueOnce({ rows: [{ value: '0x08' }] });
    const { boss, send } = makeBoss();

    await handleResyncListRelationships(makeJob({ tokenId: 7 }), boss);

    expect(send).not.toHaveBeenCalled();
  });
});
