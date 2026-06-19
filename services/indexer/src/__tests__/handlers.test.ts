import { describe, it, expect, vi } from 'vitest';

vi.mock('@efp/shared', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  query: vi.fn(),
  CONTRACTS: {},
}));

import { parseListOpsBatch } from '../handlers.js';

const CHAIN_ID = 8453;
const CONTRACT = '0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33';
const SLOT = ('0x' + '1'.padStart(64, '0')) as `0x${string}`;

const ADDR_A = 'aa'.repeat(20);
const ADDR_B = 'bb'.repeat(20);

// ListOp = version(01) + opcode + data.
// Record data (address record) = recordVersion(01) + recordType(01) + address(20).
const recordData = (addr: string) => `0101${addr}`;
const followOp = (addr: string) => ('0x0101' + recordData(addr)) as `0x${string}`; // opcode 1
const unfollowOp = (addr: string) => ('0x0102' + recordData(addr)) as `0x${string}`; // opcode 2
const tagHex = (tag: string) => Buffer.from(tag, 'utf8').toString('hex');
const tagOp = (addr: string, tag: string) => ('0x0103' + recordData(addr) + tagHex(tag)) as `0x${string}`; // opcode 3
const untagOp = (addr: string, tag: string) => ('0x0104' + recordData(addr) + tagHex(tag)) as `0x${string}`; // opcode 4

// The `record` column stores the full op data (recordVersion+recordType+address)
const recordHex = (addr: string) => '0x' + recordData(addr);

function run(ops: `0x${string}`[]) {
  return parseListOpsBatch(
    ops.map((op) => ({ slot: SLOT, op })),
    CHAIN_ID,
    CONTRACT
  );
}

describe('parseListOpsBatch folding', () => {
  it('a single follow inserts the record', () => {
    const { recordInserts, recordDeletes } = run([followOp(ADDR_A)]);
    expect(recordInserts.map((r) => r.record)).toEqual([recordHex(ADDR_A)]);
    expect(recordDeletes).toEqual([]);
  });

  it('unfollow + refollow of the same record nets to an insert (the follow is not lost)', () => {
    const { recordInserts, recordDeletes } = run([unfollowOp(ADDR_A), followOp(ADDR_A)]);
    expect(recordInserts.map((r) => r.record)).toEqual([recordHex(ADDR_A)]);
    expect(recordDeletes).toEqual([]);
  });

  it('follow + unfollow of the same record nets to a delete', () => {
    const { recordInserts, recordDeletes } = run([followOp(ADDR_A), unfollowOp(ADDR_A)]);
    expect(recordInserts).toEqual([]);
    expect(recordDeletes.map((r) => r.record)).toEqual([recordHex(ADDR_A)]);
  });

  it('keeps independent records separate', () => {
    const { recordInserts, recordDeletes } = run([
      followOp(ADDR_A),
      unfollowOp(ADDR_A),
      followOp(ADDR_B),
    ]);
    expect(recordInserts.map((r) => r.record)).toEqual([recordHex(ADDR_B)]);
    expect(recordDeletes.map((r) => r.record)).toEqual([recordHex(ADDR_A)]);
  });

  it('untag + retag of the same tag nets to a tag insert', () => {
    const { tagInserts, tagDeletes } = run([untagOp(ADDR_A, 'block'), tagOp(ADDR_A, 'block')]);
    expect(tagInserts.map((t) => t.tag)).toEqual(['block']);
    expect(tagDeletes).toEqual([]);
  });

  it('tag + untag of the same tag nets to a tag delete', () => {
    const { tagInserts, tagDeletes } = run([tagOp(ADDR_A, 'block'), untagOp(ADDR_A, 'block')]);
    expect(tagInserts).toEqual([]);
    expect(tagDeletes.map((t) => t.tag)).toEqual(['block']);
  });

  it('removing a record clears its tags from the batch (cascade)', () => {
    const { recordInserts, recordDeletes, tagInserts, tagDeletes } = run([
      followOp(ADDR_A),
      tagOp(ADDR_A, 'top8'),
      unfollowOp(ADDR_A),
    ]);
    expect(recordInserts).toEqual([]);
    expect(recordDeletes.map((r) => r.record)).toEqual([recordHex(ADDR_A)]);
    // The record delete cascades to its tags, so no tag insert/delete is emitted
    expect(tagInserts).toEqual([]);
    expect(tagDeletes).toEqual([]);
  });

  it('keeps a tag for a record that survives the batch', () => {
    const { recordInserts, tagInserts } = run([followOp(ADDR_A), tagOp(ADDR_A, 'top8')]);
    expect(recordInserts.map((r) => r.record)).toEqual([recordHex(ADDR_A)]);
    expect(tagInserts.map((t) => ({ record: t.record, tag: t.tag }))).toEqual([
      { record: recordHex(ADDR_A), tag: 'top8' },
    ]);
  });
});
