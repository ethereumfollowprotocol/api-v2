import type { Client } from 'pg';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { connectClient, disconnectClient } from '../db/client.js';
import type { AppBindings, AppVariables } from '../types.js';

type DbContext = Context<{ Bindings: AppBindings; Variables: AppVariables }>;

/**
 * Lazily opens a per-request pg Client via Hyperdrive when first needed.
 * Hyperdrive maintains the underlying pool; we must not store the client globally.
 */
export async function ensureDb(c: DbContext): Promise<Client> {
  const existing = c.get('db');
  if (existing) {
    return existing;
  }

  const client = await connectClient(c.env.HYPERDRIVE.connectionString);
  c.set('db', client);
  return client;
}

/**
 * Disconnects a lazily opened client at the end of the request.
 * Does not connect on its own — pair with ensureDb() in handlers/middleware.
 */
export const dbCleanupMiddleware = createMiddleware<{ Bindings: AppBindings; Variables: AppVariables }>(
  async (c, next) => {
    try {
      await next();
    } finally {
      const client = c.get('db');
      if (client) {
        c.executionCtx.waitUntil(disconnectClient(client));
      }
    }
  }
);
