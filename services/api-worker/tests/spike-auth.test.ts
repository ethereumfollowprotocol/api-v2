import { describe, it, expect } from 'vitest';
import {
  isSpikeAuthorized,
  isSpikeEndpointEnabled,
  isSpikePath,
} from '../src/middleware/spike-auth.js';

const baseEnv = {
  SPIKE_ENDPOINT_ENABLED: 'false',
  SPIKE_SECRET: 'test-secret',
  SPIKE_ALLOWED_IPS: '203.0.113.1, 203.0.113.2',
  CF_ACCESS_CLIENT_ID: 'access-client-1',
} as const;

describe('isSpikePath', () => {
  it('matches spike routes only', () => {
    expect(isSpikePath('/api/v1/spike/hyperdrive')).toBe(true);
    expect(isSpikePath('/api/v1/users/0xabc/details')).toBe(false);
  });
});

describe('isSpikeEndpointEnabled', () => {
  it('is false unless SPIKE_ENDPOINT_ENABLED is exactly true', () => {
    expect(isSpikeEndpointEnabled({ SPIKE_ENDPOINT_ENABLED: 'false' })).toBe(false);
    expect(isSpikeEndpointEnabled({ SPIKE_ENDPOINT_ENABLED: 'true' })).toBe(true);
    expect(isSpikeEndpointEnabled({ SPIKE_ENDPOINT_ENABLED: 'TRUE' })).toBe(false);
  });
});

describe('isSpikeAuthorized', () => {
  const enabled = { ...baseEnv, SPIKE_ENDPOINT_ENABLED: 'true' };

  it('denies when endpoint is disabled', () => {
    const request = new Request('https://api.example/api/v1/spike/hyperdrive?spike_key=test-secret');
    expect(isSpikeAuthorized(request, baseEnv)).toBe(false);
  });

  it('allows matching spike_key when enabled', () => {
    const request = new Request('https://api.example/api/v1/spike/hyperdrive?spike_key=test-secret');
    expect(isSpikeAuthorized(request, enabled)).toBe(true);
  });

  it('allows allowlisted CF-Connecting-IP when enabled', () => {
    const request = new Request('https://api.example/api/v1/spike/hyperdrive', {
      headers: { 'CF-Connecting-IP': '203.0.113.1' },
    });
    expect(isSpikeAuthorized(request, enabled)).toBe(true);
  });

  it('allows matching CF-Access-Client-Id when enabled', () => {
    const request = new Request('https://api.example/api/v1/spike/hyperdrive', {
      headers: { 'CF-Access-Client-Id': 'access-client-1' },
    });
    expect(isSpikeAuthorized(request, enabled)).toBe(true);
  });

  it('denies enabled endpoint without credentials', () => {
    const request = new Request('https://api.example/api/v1/spike/hyperdrive');
    expect(isSpikeAuthorized(request, enabled)).toBe(false);
  });
});
