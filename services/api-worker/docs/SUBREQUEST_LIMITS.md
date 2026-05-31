# Workers Subrequest Limits and ENS Fan-Out

## Context

`refreshENSProfile` (triggered by `?cache=fresh`) issues parallel RPC subrequests:

| Call | Count |
|------|-------|
| `getEnsName` | 1 |
| `getEnsAvatar` | 1 |
| `getEnsResolver` + `readContract` (contenthash) | 2 |
| `getEnsText` × 21 text record keys | 21 |
| **Total** | **~25 subrequests** |

Source: [`services/api/src/services/ens.ts`](../../api/src/services/ens.ts)

## Cloudflare Workers limits (2026)

| Plan | Subrequests per invocation |
|------|---------------------------|
| Free | 50 |
| Paid (Workers Paid) | 1,000 |
| Unbound / higher tiers | Higher |

Reference: [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)

## Assessment

| Scenario | Subrequests | Verdict |
|----------|------------|---------|
| Normal P0 read (account/details/stats) | 0–1 (ENS resolve if `.eth` name) | Safe on all plans |
| `?cache=fresh` on ENS endpoints | ~25 | **Requires Paid plan** (exceeds Free 50 only if combined with other fetches; borderline on Free) |
| `allFollowers` with `include=ens` × 100 | 100+ ENS DB reads (no RPC) | Safe — DB only |
| POAP badges endpoint | 1 external HTTP | Safe |

## Recommendation

1. **Deploy on Workers Paid** — `$5/month` minimum; 1000 subrequests/invocation covers ENS refresh comfortably.
2. **Batch ENS refresh** — for `cache=fresh`, consider reducing parallel text record fetches or delegating refresh to a Queue consumer (future optimization).
3. **Monitor** — enable Workers Observability traces; alert on subrequest limit errors (`1102`).

## P0 endpoints (current Worker POC)

The ported P0 endpoints (`account`, `details`, `stats`) do **not** call `refreshENSProfile` yet — they read ENS from Postgres cache only. ENS resolution for `.eth` path params adds at most 1 RPC subrequest via viem.

## Free tier viability

The Worker POC is **viable on Free tier** for P0 endpoints without `cache=fresh`. Full API parity with ENS refresh requires Paid.
