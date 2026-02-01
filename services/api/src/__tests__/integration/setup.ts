/**
 * Integration test setup
 *
 * This file provides utilities for testing the API against a running instance
 * or against the production API for comparison.
 */

export const LOCAL_API = process.env.LOCAL_API_URL || 'http://localhost:3000/api/v1';
export const PRODUCTION_API = 'https://data.ethfollow.xyz/api/v1';

// Test fixtures
export const TEST_ADDRESSES = {
  vitalik: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  brantly: '0x983110309620d911731ac0932219af06091b6744',
  zero: '0x0000000000000000000000000000000000000000',
};

export const TEST_ENS_NAMES = {
  vitalik: 'vitalik.eth',
  brantly: 'brantly.eth',
};

export const TEST_LIST_IDS = {
  brantly: '3',
  vitalik: '6509',
};

// Helper to fetch from an API
export async function fetchAPI(baseUrl: string, path: string, options?: RequestInit): Promise<Response> {
  const url = `${baseUrl}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...options?.headers,
    },
  });
}

// Helper to compare response shapes
export function compareShapes(actual: unknown, expected: unknown): { matches: boolean; differences: string[] } {
  const differences: string[] = [];

  function compare(a: unknown, e: unknown, path: string = ''): void {
    if (typeof a !== typeof e) {
      differences.push(`${path}: type mismatch (got ${typeof a}, expected ${typeof e})`);
      return;
    }

    if (Array.isArray(e)) {
      if (!Array.isArray(a)) {
        differences.push(`${path}: expected array, got ${typeof a}`);
        return;
      }
      if (e.length > 0 && a.length > 0) {
        compare(a[0], e[0], `${path}[0]`);
      }
      return;
    }

    if (typeof e === 'object' && e !== null) {
      if (typeof a !== 'object' || a === null) {
        differences.push(`${path}: expected object, got ${typeof a}`);
        return;
      }
      for (const key of Object.keys(e)) {
        if (!(key in (a as Record<string, unknown>))) {
          differences.push(`${path}.${key}: missing key`);
        } else {
          compare((a as Record<string, unknown>)[key], (e as Record<string, unknown>)[key], `${path}.${key}`);
        }
      }
    }
  }

  compare(actual, expected, 'root');

  return {
    matches: differences.length === 0,
    differences,
  };
}

// Wait for API to be ready
export async function waitForAPI(baseUrl: string, maxAttempts = 30, delay = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return true;
    } catch {
      // API not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return false;
}
