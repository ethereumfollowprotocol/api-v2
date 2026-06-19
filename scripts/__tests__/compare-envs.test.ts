import { describe, it, expect } from 'vitest';
import { diffValues, type Options, type Diff } from '../compare-envs.js';

function makeOpts(overrides: Partial<Options> = {}): Options {
  return {
    dev: '',
    prod: '',
    addresses: [],
    lists: [],
    filter: null,
    tolerance: 0,
    orderSensitive: false,
    ignoredKeys: new Set(['updated_at']),
    maxDiffs: 50,
    fresh: false,
    ...overrides,
  };
}

function diff(prod: unknown, dev: unknown, opts = makeOpts()): Diff[] {
  const out: Diff[] = [];
  diffValues(prod, dev, '', opts, out);
  return out;
}

// Regression for the order-insensitive array comparison. Items in endpoints like
// /lists/:id/following share an identity key (address/data trimmed to 20 bytes),
// so several distinct items collapse to the same key. The earlier
// dedupe-into-a-Map approach kept only the last item per key, hiding real
// differences among the collapsed duplicates. groupByKey + occurrence-count +
// pairwise member diff must catch them.
describe('compare-envs diffValues — duplicate identity keys', () => {
  it('detects a real difference among items that share an identity key', () => {
    // Both arrays have length 2 and the same last item per key ({t:'1'}), which
    // is exactly what masked the diff under the old last-write-wins dedupe.
    const prod = [
      { address: '0xa', t: '2' },
      { address: '0xa', t: '1' },
    ];
    const dev = [
      { address: '0xa', t: '9' },
      { address: '0xa', t: '1' },
    ];

    const out = diff(prod, dev);
    expect(out.length).toBeGreaterThan(0);
    // The real difference is the '2' vs '9' member, not a length mismatch
    expect(out.some((d) => d.path.includes('.length'))).toBe(false);
    expect(out.some((d) => d.prod === '"2"' && d.dev === '"9"')).toBe(true);
  });

  it('flags an occurrence-count difference for a repeated identity key', () => {
    const prod = [
      { address: '0xa', t: '1' },
      { address: '0xa', t: '1' },
    ];
    const dev = [{ address: '0xa', t: '1' }];

    const out = diff(prod, dev);
    expect(out.some((d) => d.path.includes('occurrences') || d.path.includes('.length'))).toBe(true);
  });

  it('treats reordered duplicates with the same identity key as a match', () => {
    const prod = [
      { address: '0xa', t: '1' },
      { address: '0xa', t: '2' },
    ];
    const dev = [
      { address: '0xa', t: '2' },
      { address: '0xa', t: '1' },
    ];

    expect(diff(prod, dev)).toEqual([]);
  });
});
