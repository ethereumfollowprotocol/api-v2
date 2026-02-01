/**
 * Unit tests for helper functions
 */

import { describe, it, expect } from 'vitest';

describe('Pagination helpers', () => {
  const parsePagination = (query: { limit?: string; offset?: string }, defaults = { limit: 10, maxLimit: 100 }) => {
    const limit = Math.min(parseInt(query.limit || String(defaults.limit), 10) || defaults.limit, defaults.maxLimit);
    const offset = parseInt(query.offset || '0', 10) || 0;
    return { limit, offset };
  };

  it('should use defaults when no params provided', () => {
    const result = parsePagination({});
    expect(result).toEqual({ limit: 10, offset: 0 });
  });

  it('should parse valid limit and offset', () => {
    const result = parsePagination({ limit: '20', offset: '50' });
    expect(result).toEqual({ limit: 20, offset: 50 });
  });

  it('should cap limit at maxLimit', () => {
    const result = parsePagination({ limit: '500' });
    expect(result.limit).toBe(100);
  });

  it('should handle invalid values', () => {
    const result = parsePagination({ limit: 'invalid', offset: 'bad' });
    expect(result).toEqual({ limit: 10, offset: 0 });
  });

  it('should handle negative values by parsing them as-is', () => {
    // Note: parseInt parses negative numbers, they don't fall back to defaults
    // In production, we'd want additional validation
    const result = parsePagination({ limit: '-10', offset: '-5' });
    expect(result.limit).toBe(-10); // parseInt returns -10
    expect(result.offset).toBe(-5); // parseInt returns -5
  });
});

describe('Sort parameter parsing', () => {
  const parseSort = (sort: string | undefined, validSorts: string[], defaultSort: string): string => {
    if (!sort) return defaultSort;
    return validSorts.includes(sort) ? sort : defaultSort;
  };

  it('should return default when no sort provided', () => {
    const result = parseSort(undefined, ['latest', 'followers', 'earliest'], 'latest');
    expect(result).toBe('latest');
  });

  it('should accept valid sort values', () => {
    expect(parseSort('followers', ['latest', 'followers', 'earliest'], 'latest')).toBe('followers');
    expect(parseSort('earliest', ['latest', 'followers', 'earliest'], 'latest')).toBe('earliest');
  });

  it('should reject invalid sort values', () => {
    const result = parseSort('invalid', ['latest', 'followers', 'earliest'], 'latest');
    expect(result).toBe('latest');
  });
});

describe('Tags parsing', () => {
  const parseTags = (tags: string | undefined): string[] => {
    if (!tags) return [];
    return tags.split(',').filter(Boolean).map(t => t.trim());
  };

  it('should return empty array when no tags', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });

  it('should parse comma-separated tags', () => {
    expect(parseTags('block,mute')).toEqual(['block', 'mute']);
    expect(parseTags('top8')).toEqual(['top8']);
  });

  it('should handle whitespace', () => {
    expect(parseTags(' block , mute ')).toEqual(['block', 'mute']);
  });

  it('should filter empty strings', () => {
    expect(parseTags('block,,mute')).toEqual(['block', 'mute']);
  });
});

describe('String/Number conversions', () => {
  const toStringOrNull = (value: number | null | undefined): string | null => {
    if (value === null || value === undefined) return null;
    return value.toString();
  };

  it('should convert numbers to strings', () => {
    expect(toStringOrNull(42)).toBe('42');
    expect(toStringOrNull(0)).toBe('0');
    expect(toStringOrNull(123456789)).toBe('123456789');
  });

  it('should return null for null/undefined', () => {
    expect(toStringOrNull(null)).toBeNull();
    expect(toStringOrNull(undefined)).toBeNull();
  });
});

describe('Hex to BigInt conversion', () => {
  const convertHexToBigInt = (hex: string): bigint => {
    if (!hex || hex === '0x' || hex === '0x0') return BigInt(0);
    // Remove 0x prefix if present
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    return BigInt('0x' + cleanHex);
  };

  it('should convert hex strings to bigint', () => {
    expect(convertHexToBigInt('0x1')).toBe(BigInt(1));
    expect(convertHexToBigInt('0xa')).toBe(BigInt(10));
    expect(convertHexToBigInt('0xff')).toBe(BigInt(255));
  });

  it('should handle zero values', () => {
    expect(convertHexToBigInt('0x0')).toBe(BigInt(0));
    expect(convertHexToBigInt('0x')).toBe(BigInt(0));
    expect(convertHexToBigInt('')).toBe(BigInt(0));
  });

  it('should handle large numbers (token IDs)', () => {
    const tokenId = '0x0000000000000000000000000000000000000000000000000000000000001975';
    expect(convertHexToBigInt(tokenId)).toBe(BigInt(6517));
  });
});
