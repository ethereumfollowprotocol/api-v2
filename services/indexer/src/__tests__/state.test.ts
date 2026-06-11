import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@efp/shared', () => ({
  query: vi.fn(),
}));

import { getChainCursor, setChainCursor } from '../state.js';
import { query } from '@efp/shared';

const ADDRESSES = [
  '0x0E688f5DCa4a0a4729946ACbC44C792341714e08',
  '0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33',
] as `0x${string}`[];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getChainCursor', () => {
  it('returns the MIN last_block across the chain contracts', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ last_block: '123456' }] } as never);

    const cursor = await getChainCursor(8453, ADDRESSES);

    expect(cursor).toBe(BigInt(123456));
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toMatch(/MIN\(last_block\)/);
    expect(params).toEqual([8453, ADDRESSES.map((a) => a.toLowerCase())]);
  });

  it('returns 0 when no rows exist (fresh deploy)', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ last_block: null }] } as never);
    expect(await getChainCursor(8453, ADDRESSES)).toBe(BigInt(0));

    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
    expect(await getChainCursor(8453, ADDRESSES)).toBe(BigInt(0));
  });
});

describe('setChainCursor', () => {
  it('upserts all contract rows for the chain to the same block', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);

    await setChainCursor(8453, ADDRESSES, BigInt(999999));

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toMatch(/unnest\(\$2::text\[\]\)/);
    expect(sql).toMatch(/ON CONFLICT \(chain_id, contract_address\) DO UPDATE/);
    expect(params).toEqual([8453, ADDRESSES.map((a) => a.toLowerCase()), '999999']);
  });
});
