/// <reference types="@cloudflare/workers-types" />

interface Env {
  HYPERDRIVE: Hyperdrive;
  PHASE_CACHE: KVNamespace;
  API_RATE_LIMITER: RateLimit;
  PRIMARY_RPC_ETH: string;
  SERVE_DURING_SYNC: string;
  /** Set to "true" to expose /api/v1/spike/* (default false). */
  SPIKE_ENDPOINT_ENABLED: string;
  /** Comma-separated IPs (CF-Connecting-IP) allowed when spike is enabled. */
  SPIKE_ALLOWED_IPS?: string;
  /** ?spike_key= or X-Spike-Key — set via wrangler secret. */
  SPIKE_SECRET?: string;
  /** Optional: allow requests with matching CF-Access-Client-Id header. */
  CF_ACCESS_CLIENT_ID?: string;
  POAP_API_TOKEN?: string;
}
