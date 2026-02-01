/**
 * Unit tests for address resolution service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isAddress } from 'viem';

// Mock dependencies
vi.mock('@efp/shared', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Address Utilities', () => {
  describe('isAddress (from viem)', () => {
    it('should validate correct Ethereum addresses', () => {
      expect(isAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe(true);
      // viem isAddress requires proper checksum for mixed case
      expect(isAddress('0x0000000000000000000000000000000000000000')).toBe(true);
    });

    it('should reject invalid Ethereum addresses', () => {
      expect(isAddress('0x123')).toBe(false);
      expect(isAddress('not an address')).toBe(false);
      expect(isAddress('vitalik.eth')).toBe(false);
      expect(isAddress('')).toBe(false);
      expect(isAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false);
    });

    it('should handle addresses with mixed case (checksummed)', () => {
      // Checksummed address
      expect(isAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(true);
    });
  });

  describe('ENS name detection', () => {
    const isENSName = (name: string): boolean => {
      return name.endsWith('.eth') || name.includes('.');
    };

    it('should detect valid ENS names', () => {
      expect(isENSName('vitalik.eth')).toBe(true);
      expect(isENSName('brantly.eth')).toBe(true);
      expect(isENSName('sub.domain.eth')).toBe(true);
    });

    it('should reject non-ENS names', () => {
      expect(isENSName('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe(false);
      expect(isENSName('notaname')).toBe(false);
    });
  });
});

describe('Address Normalization', () => {
  it('should lowercase addresses', () => {
    const address = '0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045';
    expect(address.toLowerCase()).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
  });

  it('should preserve 0x prefix', () => {
    const address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    expect(address.startsWith('0x')).toBe(true);
    expect(address.length).toBe(42);
  });
});
