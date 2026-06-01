import { Client } from 'pg';

/**
 * Hyperdrive connection lifecycle.
 *
 * Cloudflare Hyperdrive pools connections at the edge; each Worker request still
 * opens a short-lived `pg` Client against the Hyperdrive connection string,
 * runs queries, then disconnects. There is no Worker-native pool API — this is
 * the documented pattern: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/
 */
export async function connectClient(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

export async function disconnectClient(client: Client): Promise<void> {
  await client.end();
}
