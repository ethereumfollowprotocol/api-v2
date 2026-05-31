/// <reference types="@cloudflare/workers-types" />

interface Env {
  HYPERDRIVE: Hyperdrive;
  PHASE_CACHE: KVNamespace;
  API_RATE_LIMITER: RateLimit;
  PRIMARY_RPC_ETH: string;
  SERVE_DURING_SYNC: string;
  RATE_LIMIT_MAX: string;
  RATE_LIMIT_WINDOW_SEC: string;
  POAP_API_TOKEN?: string;
}
