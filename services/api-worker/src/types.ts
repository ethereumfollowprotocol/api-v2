import type { Client } from 'pg';
import type { Context } from 'hono';

export type AppVariables = {
  db?: Client;
};

export type AppBindings = Env;

export type AppContext = Context<{ Bindings: AppBindings; Variables: AppVariables }>;
