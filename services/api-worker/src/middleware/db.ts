import { createMiddleware } from 'hono/factory';
import { connectClient, disconnectClient } from '../db/query.js';
import type { AppBindings, AppVariables } from '../types.js';

/**
 * Creates a per-request pg Client via Hyperdrive connection string.
 * Hyperdrive maintains the underlying pool; we must not store the client globally.
 */
export const dbMiddleware = createMiddleware<{ Bindings: AppBindings; Variables: AppVariables }>(
  async (c, next) => {
    const client = await connectClient(c.env.HYPERDRIVE.connectionString);
    c.set('db', client);
    try {
      await next();
    } finally {
      c.executionCtx.waitUntil(disconnectClient(client));
    }
  }
);
