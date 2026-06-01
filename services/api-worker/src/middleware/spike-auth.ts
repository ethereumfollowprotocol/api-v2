import { createMiddleware } from 'hono/factory';
import type { AppBindings, AppVariables } from '../types.js';

function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** Spike routes are off unless SPIKE_ENDPOINT_ENABLED=true (default false in wrangler). */
export function isSpikeEndpointEnabled(
  env: Pick<AppBindings, 'SPIKE_ENDPOINT_ENABLED'>
): boolean {
  return env.SPIKE_ENDPOINT_ENABLED === 'true';
}

export function isSpikePath(pathname: string): boolean {
  return pathname.startsWith('/api/v1/spike');
}

function isIpAllowlisted(request: Request, allowedIps: string | undefined): boolean {
  if (!allowedIps?.trim()) {
    return false;
  }
  const ip = getClientIp(request);
  return allowedIps
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(ip);
}

/**
 * When the spike endpoint is enabled, allow SPIKE_SECRET, CF Access client id, or SPIKE_ALLOWED_IPS.
 */
export function isSpikeAuthorized(
  request: Request,
  env: Pick<
    AppBindings,
    'SPIKE_ENDPOINT_ENABLED' | 'SPIKE_SECRET' | 'CF_ACCESS_CLIENT_ID' | 'SPIKE_ALLOWED_IPS'
  >
): boolean {
  if (!isSpikeEndpointEnabled(env)) {
    return false;
  }

  if (isIpAllowlisted(request, env.SPIKE_ALLOWED_IPS)) {
    return true;
  }

  const secret = env.SPIKE_SECRET;
  if (secret) {
    if (request.headers.get('X-Spike-Key') === secret) {
      return true;
    }
  }

  const accessClientId = env.CF_ACCESS_CLIENT_ID;
  if (accessClientId && request.headers.get('CF-Access-Client-Id') === accessClientId) {
    return true;
  }

  return false;
}

/** Returns 404 when spike is disabled so the route is not discoverable in production. */
export const spikeGateMiddleware = createMiddleware<{ Bindings: AppBindings; Variables: AppVariables }>(
  async (c, next) => {
    if (!isSpikeEndpointEnabled(c.env)) {
      return c.notFound();
    }
    return next();
  }
);
