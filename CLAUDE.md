# EFP API V2 - Claude Context

## Project Overview

This is a rewrite of the EFP (Ethereum Follow Protocol) backend to handle high traffic. The current Cloudflare Workers-based API crashes under load due to PostgreSQL connection pool exhaustion.

**Solution**: Adopt the Grails backend architecture (Fastify, pg-boss, WAL-listener, Elasticsearch).

## Key Documents

- **PRD**: `EFP_V2_PRD.md` - Complete technical specification (read this first)
- **Production API**: https://api.ethfollow.xyz/api/v1 (must match response shapes exactly)
- **EFP Docs**: https://docs.efp.app/

## Repository Structure

```
services/
├── api/           # Fastify REST API (62 endpoints)
├── indexer/       # Existing indexer (minimal changes)
├── orchestrator/  # Phase management + migration runner
├── wal-listener/  # PostgreSQL CDC → ES sync + cache invalidation
├── workers/       # pg-boss job handlers
└── shared/        # Config, DB clients, types
```

## Protocol Essentials

### Three Contracts
- **ListRegistry** (Base): ERC721 NFTs representing follow lists
- **AccountMetadata** (Base): Stores primary list designation
- **ListRecords** (Base, Optimism, Ethereum): Stores follow/block/mute operations

### Key Concept: Primary List
A follow only "counts" if it's from the user's designated primary list. Always validate:
1. Find list by storage location (chain_id, contract_address, slot)
2. Check if list's token_id matches user's primary-list in AccountMetadata
3. If not primary list, the follow doesn't count in the social graph

### Operations (ListOps)
- Opcode 1: Follow (add record)
- Opcode 2: Unfollow (remove record)
- Opcode 3: Tag (add tag to existing record)
- Opcode 4: Untag (remove tag from record)

### Tags
- `block`: Excluded from counts, highest precedence
- `mute`: Excluded from counts
- `top8`: Included in counts, tracked separately

## Contract Addresses (Production)

| Contract | Chain | Address |
|----------|-------|---------|
| ListRegistry | Base | `0x0E688f5DCa4a0a4729946ACbC44C792341714e08` |
| AccountMetadata | Base | `0x5289fE5daBC021D02FDDf23d4a4DF96F4E0F17EF` |
| ListRecords | Base | `0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33` |
| ListRecords | Optimism | `0x4Ca00413d850DcFa3516E14d21DAE2772F2aCb85` |
| ListRecords | Ethereum | `0x5289fE5daBC021D02FDDf23d4a4DF96F4E0F17EF` |

## Development Guidelines

### API Implementation
1. **Always verify against production first**: Fetch from `https://api.ethfollow.xyz/api/v1{endpoint}` and examine response before implementing
2. **Match response shapes exactly**: Field names, nesting, types must be identical for backwards compatibility
3. **Priority order**: P0 (account, details, stats) → P1 (followers, following, leaderboard) → P2/P3

### Database
- Core tables populated by indexer (don't modify)
- Derived tables (`efp_followers`, `efp_following`, `efp_user_stats`, `efp_leaderboard`, `efp_mutuals`) for fast API queries
- Use `convert_hex_to_bigint()` for primary-list value conversion
- Address format: VARCHAR(42) with `0x` prefix, lowercase

### Testing
- Comparison tests: Compare new API responses against production
- Use `?cache=fresh` to bypass production cache when testing
- Load test with k6 using addresses that caused production crashes

## Reference Repositories

| Repo | URL | Purpose |
|------|-----|---------|
| Grails Backend | https://github.com/grailsmarket/backend | Architecture reference |
| EFP Indexer | https://github.com/ethereumfollowprotocol/indexer | Current indexer |
| EFP API | https://github.com/ethereumfollowprotocol/api | Current API (to match) |
| EFP Contracts | https://github.com/ethereumfollowprotocol/contracts | Smart contracts |

## Quick Commands

```bash
# Verify endpoint against production
curl "https://api.ethfollow.xyz/api/v1/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/details" | jq

# Test with cache bypass
curl "https://api.ethfollow.xyz/api/v1/users/vitalik.eth/stats?cache=fresh" | jq
```

## Environment Variables

```bash
DATABASE_URL=           # PostgreSQL connection
REDIS_URL=              # Redis connection
ELASTICSEARCH_URL=      # Elasticsearch connection
PRIMARY_RPC_BASE=       # Base RPC endpoint
PRIMARY_RPC_OP=         # Optimism RPC endpoint
PRIMARY_RPC_ETH=        # Ethereum RPC endpoint
SERVE_DURING_SYNC=false # Set true to serve during historical sync
```
