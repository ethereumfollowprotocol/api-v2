import { env } from './config/index.js';
import { query } from './db/index.js';

/** Profile returned by the ENS worker (ensv2-records, enstate-compatible). */
export interface ENSWorkerProfile {
  name: string;
  address?: string;
  /** Resolved image URL (NFT / IPFS avatars already converted). */
  avatar?: string;
  /** Resolved image URL. */
  header?: string;
  display: string;
  contenthash?: string;
  records: Record<string, string>;
  chains: Record<string, string>;
  fresh: number;
  resolver: string;
  errors: Record<string, string>;
}

export type ENSWorkerBulkItem =
  | ({ type: 'success' } & ENSWorkerProfile)
  | { type: 'error'; status: number; error: string };

const REQUEST_TIMEOUT_MS = 10_000;

/** Max inputs per bulk request accepted by the deployed worker. */
export const ENS_WORKER_MAX_BULK = 50;

async function get<T>(path: string, fresh: boolean): Promise<T | null> {
  const url = `${env.ENS_API_URL}${path}${fresh ? `${path.includes('?') ? '&' : '?'}fresh=1` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ENS worker ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Primary-name profile for an address, or null when it has no primary name. Throws on worker errors. */
export function fetchENSProfileByAddress(address: string, fresh = false): Promise<ENSWorkerProfile | null> {
  return get(`/a/${address}`, fresh);
}

/** Profile for a name, or null when the name doesn't exist. Throws on worker errors. */
export function fetchENSProfileByName(name: string, fresh = false): Promise<ENSWorkerProfile | null> {
  return get(`/n/${encodeURIComponent(name)}`, fresh);
}

/** Bulk name lookup; caller must keep `names.length <= ENS_WORKER_MAX_BULK`. */
export async function fetchENSProfilesByName(names: string[], fresh = false): Promise<ENSWorkerBulkItem[]> {
  const qs = names.map((n) => `names[]=${encodeURIComponent(n)}`).join('&');
  const data = await get<{ response: ENSWorkerBulkItem[] }>(`/bulk/n?${qs}`, fresh);
  return data?.response ?? [];
}

export interface ENSMetadataRow {
  name: string;
  avatar: string | null;
  header: string | null;
  records: Record<string, string> | null;
}

/** Map a worker profile to the shape stored in `ens_metadata`. */
export function toENSMetadataRow(profile: ENSWorkerProfile): ENSMetadataRow {
  const records: Record<string, string> = { ...profile.records };
  // Store resolved image URLs (matches what viem's getEnsAvatar produced before).
  if (profile.avatar) records.avatar = profile.avatar;
  if (profile.header) records.header = profile.header;
  if (profile.contenthash) records.contenthash = profile.contenthash;

  return {
    name: profile.name,
    avatar: profile.avatar ?? null,
    header: profile.header ?? records.header ?? null,
    records: Object.keys(records).length > 0 ? records : null,
  };
}

/** Upsert an address's ENS data; `row = null` records that it has no primary name. */
export async function upsertENSMetadata(address: string, row: ENSMetadataRow | null): Promise<void> {
  if (!row) {
    await query(
      `INSERT INTO ens_metadata (address, name, resolved_at, updated_at)
       VALUES ($1, NULL, NOW(), NOW())
       ON CONFLICT (address) DO UPDATE SET
         name = NULL, resolved_at = NOW(), updated_at = NOW()`,
      [address]
    );
    return;
  }

  await query(
    `INSERT INTO ens_metadata (address, name, avatar, header, records, resolved_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (address) DO UPDATE SET
       name = EXCLUDED.name,
       avatar = EXCLUDED.avatar,
       header = EXCLUDED.header,
       records = EXCLUDED.records,
       resolved_at = NOW(),
       updated_at = NOW()`,
    [address, row.name, row.avatar, row.header, row.records ? JSON.stringify(row.records) : null]
  );
}
