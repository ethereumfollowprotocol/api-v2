/**
 * Dev vs Production API comparison harness.
 *
 * Fetches the same endpoints from two live environments and deep-compares the
 * JSON responses value-by-value, reporting any differences. Used to validate
 * that the rewritten backend (dev) produces identical data to production.
 *
 * Usage:
 *   npm run compare:envs                          # full default matrix
 *   npm run compare:envs -- --filter followers    # only endpoints whose path matches
 *   npm run compare:envs -- --address vitalik.eth --address 0xabc...  # custom subjects
 *   npm run compare:envs -- --list 3 --list 88
 *   npm run compare:envs -- --tolerance 2         # allow ±2 on numeric leaves (live drift)
 *   npm run compare:envs -- --order-sensitive     # compare arrays in returned order
 *   npm run compare:envs -- --ignore-key avatar   # ignore additional keys by name
 *   npm run compare:envs -- --max-diffs 50        # diff lines shown per endpoint
 *
 * Environment overrides: DEV_API_URL, PROD_API_URL.
 */

const DEFAULT_DEV = 'https://api-development-3096.up.railway.app/api/v1';
const DEFAULT_PROD = 'https://api.ethfollow.xyz/api/v1';

// Keys whose values legitimately differ between environments (write times,
// cache times) — compared for presence/type but not value
const DEFAULT_IGNORED_KEYS = new Set(['updated_at', 'last_updated', 'created_at']);

const REQUEST_TIMEOUT_MS = 30000;
const CONCURRENCY = 4;

// Default subjects: a heavy account (vitalik) and a long-standing list
const DEFAULT_ADDRESSES = ['0xd8da6bf26964af9d7eed9e03e53415d37aa96045', 'brantly.eth'];
const DEFAULT_LISTS = ['3'];

// ============================================================
// CLI
// ============================================================

export interface Options {
  dev: string;
  prod: string;
  addresses: string[];
  lists: string[];
  filter: string | null;
  tolerance: number;
  orderSensitive: boolean;
  ignoredKeys: Set<string>;
  maxDiffs: number;
  fresh: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    dev: process.env.DEV_API_URL ?? DEFAULT_DEV,
    prod: process.env.PROD_API_URL ?? DEFAULT_PROD,
    addresses: [],
    lists: [],
    filter: null,
    tolerance: 0,
    orderSensitive: false,
    ignoredKeys: new Set(DEFAULT_IGNORED_KEYS),
    maxDiffs: 15,
    fresh: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case '--dev': opts.dev = next(); break;
      case '--prod': opts.prod = next(); break;
      case '--address': opts.addresses.push(next()); break;
      case '--list': opts.lists.push(next()); break;
      case '--filter': opts.filter = next(); break;
      case '--tolerance': opts.tolerance = Number(next()); break;
      case '--order-sensitive': opts.orderSensitive = true; break;
      case '--ignore-key': opts.ignoredKeys.add(next()); break;
      case '--max-diffs': opts.maxDiffs = Number(next()); break;
      case '--fresh': opts.fresh = true; break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.addresses.length === 0) opts.addresses = DEFAULT_ADDRESSES;
  if (opts.lists.length === 0) opts.lists = DEFAULT_LISTS;
  return opts;
}

// ============================================================
// Endpoint matrix
// ============================================================

function buildEndpoints(opts: Options): string[] {
  const endpoints: string[] = [];

  for (const a of opts.addresses) {
    endpoints.push(
      `/users/${a}/details`,
      `/users/${a}/stats`,
      `/users/${a}/lists`,
      `/users/${a}/primary-list`,
      `/users/${a}/followers?limit=25`,
      `/users/${a}/following?limit=25`,
      // Full following address set — direct, complete check of indexer output
      `/users/${a}/allFollowingAddresses`,
      `/users/${a}/tags`,
      `/users/${a}/taggedAs`,
      `/users/${a}/blocks?limit=25`,
      `/users/${a}/mutes?limit=25`,
    );
  }

  for (const id of opts.lists) {
    endpoints.push(
      `/lists/${id}/details`,
      `/lists/${id}/stats`,
      `/lists/${id}/records`,
      `/lists/${id}/followers?limit=25`,
      `/lists/${id}/following?limit=25`,
    );
  }

  endpoints.push(
    '/stats',
    '/leaderboard/count',
    '/leaderboard/ranked?limit=25',
    '/discover?limit=10',
  );

  let filtered = opts.filter ? endpoints.filter((e) => e.includes(opts.filter!)) : endpoints;
  if (opts.fresh) {
    filtered = filtered.map((e) => e + (e.includes('?') ? '&' : '?') + 'cache=fresh');
  }
  return filtered;
}

// ============================================================
// Fetching
// ============================================================

interface FetchResult {
  status: number;
  ms: number;
  body: unknown;
  rawText: string | null; // set when the body was not valid JSON
  error?: string;
}

async function fetchJson(baseUrl: string, path: string): Promise<FetchResult> {
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    const ms = Date.now() - started;
    const text = await response.text();
    try {
      return { status: response.status, ms, body: JSON.parse(text), rawText: null };
    } catch {
      return { status: response.status, ms, body: null, rawText: text };
    }
  } catch (err) {
    return {
      status: 0,
      ms: Date.now() - started,
      body: null,
      rawText: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// Deep diff
// ============================================================

export interface Diff {
  path: string;
  prod: string;
  dev: string;
}

function shortValue(v: unknown): string {
  const s = v === undefined ? '<missing>' : JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

// Plain decimal strings only — Number() would parse "0x..." as hex, making
// distinct addresses/calldata compare equal after float truncation
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const INTEGER_RE = /^-?\d+$/;

function numericValue(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && DECIMAL_RE.test(v.trim())) return Number(v);
  return null;
}

// Canonical key for order-insensitive array comparison: prefer a stable
// identity field, fall back to the full serialized item (ignored keys stripped)
function arrayItemKey(item: unknown, ignoredKeys: Set<string>): string {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    for (const idKey of ['address', 'data', 'token_id', 'efp_list_nft_token_id']) {
      if (typeof obj[idKey] === 'string') return `${idKey}:${obj[idKey]}`;
    }
  }
  return JSON.stringify(item, (key, value) => (ignoredKeys.has(key) ? undefined : value));
}

function canonicalJson(item: unknown, ignoredKeys: Set<string>): string {
  return JSON.stringify(item, (key, value) => (ignoredKeys.has(key) ? undefined : value)) ?? 'undefined';
}

// Arrays can contain several items with the same identity key (e.g. taggedAs
// returns one {address, tag} row per tag) — group rather than dedupe
function groupByKey(items: unknown[], ignoredKeys: Set<string>): Map<string, unknown[]> {
  const groups = new Map<string, unknown[]>();
  for (const item of items) {
    const key = arrayItemKey(item, ignoredKeys);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

export function diffValues(prod: unknown, dev: unknown, path: string, opts: Options, out: Diff[]): void {
  if (out.length > 500) return; // hard cap; the endpoint is already failed

  // Both missing/null-ish
  if (prod === dev) return;
  if (prod == null || dev == null) {
    out.push({ path, prod: shortValue(prod), dev: shortValue(dev) });
    return;
  }

  // Numeric comparison with tolerance, only when both sides are the same
  // type. Integer strings go through BigInt — uint256 values (token ids,
  // slots) overflow double precision and could falsely match via Number()
  if (typeof prod === 'string' && typeof dev === 'string' &&
      INTEGER_RE.test(prod.trim()) && INTEGER_RE.test(dev.trim())) {
    const a = BigInt(prod.trim());
    const b = BigInt(dev.trim());
    const delta = a > b ? a - b : b - a;
    if (delta > BigInt(Math.floor(opts.tolerance))) {
      out.push({ path, prod: shortValue(prod), dev: shortValue(dev) });
    }
    return;
  }
  if (typeof prod === typeof dev) {
    const np = numericValue(prod);
    const nd = numericValue(dev);
    if (np !== null && nd !== null) {
      if (Math.abs(np - nd) > opts.tolerance) {
        out.push({ path, prod: shortValue(prod), dev: shortValue(dev) });
      }
      return;
    }
  }

  if (Array.isArray(prod) && Array.isArray(dev)) {
    if (prod.length !== dev.length) {
      out.push({ path: `${path}.length`, prod: String(prod.length), dev: String(dev.length) });
    }
    if (opts.orderSensitive) {
      const len = Math.min(prod.length, dev.length);
      for (let i = 0; i < len; i++) diffValues(prod[i], dev[i], `${path}[${i}]`, opts, out);
    } else {
      const prodGroups = groupByKey(prod, opts.ignoredKeys);
      const devGroups = groupByKey(dev, opts.ignoredKeys);

      // Membership differences are summarized (counts + a few examples)
      // instead of one diff line per item
      const onlyInProd = [...prodGroups.keys()].filter((k) => !devGroups.has(k));
      const onlyInDev = [...devGroups.keys()].filter((k) => !prodGroups.has(k));
      if (onlyInProd.length > 0) {
        const examples = onlyInProd.slice(0, 3).join(', ');
        out.push({
          path,
          prod: `${onlyInProd.length} item(s) not in dev (e.g. ${examples})`,
          dev: '<missing>',
        });
      }
      if (onlyInDev.length > 0) {
        const examples = onlyInDev.slice(0, 3).join(', ');
        out.push({
          path,
          prod: '<missing>',
          dev: `${onlyInDev.length} item(s) not in prod (e.g. ${examples})`,
        });
      }

      for (const [key, prodGroup] of prodGroups) {
        const devGroup = devGroups.get(key);
        if (!devGroup) continue;
        if (prodGroup.length !== devGroup.length) {
          out.push({
            path: `${path}[${key}].occurrences`,
            prod: String(prodGroup.length),
            dev: String(devGroup.length),
          });
        }
        // Pair group members deterministically before diffing
        const byJson = (a: unknown, b: unknown) =>
          canonicalJson(a, opts.ignoredKeys) < canonicalJson(b, opts.ignoredKeys) ? -1 : 1;
        const sortedProd = [...prodGroup].sort(byJson);
        const sortedDev = [...devGroup].sort(byJson);
        const pairs = Math.min(sortedProd.length, sortedDev.length);
        for (let i = 0; i < pairs; i++) {
          const itemPath = prodGroup.length > 1 ? `${path}[${key}#${i}]` : `${path}[${key}]`;
          diffValues(sortedProd[i], sortedDev[i], itemPath, opts, out);
        }
      }
    }
    return;
  }

  if (typeof prod === 'object' && typeof dev === 'object' && !Array.isArray(prod) && !Array.isArray(dev)) {
    const prodObj = prod as Record<string, unknown>;
    const devObj = dev as Record<string, unknown>;
    const keys = new Set([...Object.keys(prodObj), ...Object.keys(devObj)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      if (opts.ignoredKeys.has(key)) {
        // Value differences are expected; still flag presence/type mismatches
        if ((key in prodObj) !== (key in devObj)) {
          out.push({ path: childPath, prod: shortValue(prodObj[key]), dev: shortValue(devObj[key]) });
        }
        continue;
      }
      diffValues(prodObj[key], devObj[key], childPath, opts, out);
    }
    return;
  }

  out.push({ path, prod: shortValue(prod), dev: shortValue(dev) });
}

// ============================================================
// Runner
// ============================================================

interface EndpointResult {
  path: string;
  status: 'MATCH' | 'DIFF' | 'ERROR';
  prodMs: number;
  devMs: number;
  detail: string[];
}

async function compareEndpoint(path: string, opts: Options): Promise<EndpointResult> {
  const [prod, dev] = await Promise.all([fetchJson(opts.prod, path), fetchJson(opts.dev, path)]);

  if (prod.error || dev.error) {
    return {
      path,
      status: 'ERROR',
      prodMs: prod.ms,
      devMs: dev.ms,
      detail: [
        ...(prod.error ? [`prod: ${prod.error}`] : []),
        ...(dev.error ? [`dev:  ${dev.error}`] : []),
      ],
    };
  }

  if (prod.status !== dev.status) {
    return {
      path,
      status: 'DIFF',
      prodMs: prod.ms,
      devMs: dev.ms,
      detail: [`HTTP status: prod=${prod.status} dev=${dev.status}`],
    };
  }

  // Non-JSON bodies (e.g. "Not implemented"): identical text on both sides is
  // a match; anything else is a diff
  if (prod.rawText !== null || dev.rawText !== null) {
    if (prod.rawText === dev.rawText) {
      return {
        path,
        status: 'MATCH',
        prodMs: prod.ms,
        devMs: dev.ms,
        detail: [],
      };
    }
    return {
      path,
      status: 'DIFF',
      prodMs: prod.ms,
      devMs: dev.ms,
      detail: [
        `non-JSON body: prod=${JSON.stringify(prod.rawText?.slice(0, 120) ?? '<json>')} ` +
          `dev=${JSON.stringify(dev.rawText?.slice(0, 120) ?? '<json>')}`,
      ],
    };
  }

  const diffs: Diff[] = [];
  diffValues(prod.body, dev.body, '', opts, diffs);

  if (diffs.length === 0) {
    return { path, status: 'MATCH', prodMs: prod.ms, devMs: dev.ms, detail: [] };
  }

  const lines = diffs
    .slice(0, opts.maxDiffs)
    .map((d) => `${d.path || '(root)'}: prod=${d.prod} dev=${d.dev}`);
  if (diffs.length > opts.maxDiffs) {
    lines.push(`... and ${diffs.length - opts.maxDiffs} more difference(s)`);
  }
  return { path, status: 'DIFF', prodMs: prod.ms, devMs: dev.ms, detail: lines };
}

async function runPool<T, R>(items: T[], worker: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function lane(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const endpoints = buildEndpoints(opts);

  console.log(`Comparing ${endpoints.length} endpoints`);
  console.log(`  prod: ${opts.prod}`);
  console.log(`  dev:  ${opts.dev}`);
  console.log(
    `  tolerance=${opts.tolerance} order-sensitive=${opts.orderSensitive} ` +
      `ignored-keys=[${[...opts.ignoredKeys].join(', ')}]\n`
  );

  const results = await runPool(endpoints, (path) => compareEndpoint(path, opts), CONCURRENCY);

  let matches = 0;
  let diffs = 0;
  let errors = 0;

  for (const r of results) {
    const timing = `prod ${String(r.prodMs).padStart(5)}ms | dev ${String(r.devMs).padStart(5)}ms`;
    if (r.status === 'MATCH') {
      matches++;
      console.log(`  MATCH  [${timing}]  ${r.path}`);
    } else {
      if (r.status === 'DIFF') diffs++;
      else errors++;
      console.log(`> ${r.status.padEnd(6)} [${timing}]  ${r.path}`);
      for (const line of r.detail) console.log(`         ${line}`);
    }
  }

  console.log(`\nSummary: ${matches} match, ${diffs} differ, ${errors} error (of ${results.length})`);
  if (diffs + errors > 0) process.exitCode = 1;
}

// Only run when executed directly (e.g. `tsx scripts/compare-envs.ts`), not when
// imported by tests
if (process.argv[1]?.includes('compare-envs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
