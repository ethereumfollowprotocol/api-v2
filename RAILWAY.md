# Railway Deployment Guide

## Prerequisites

1. Railway account
2. PostgreSQL database (Railway or external)
3. Redis (Railway plugin)
4. Elasticsearch (external - e.g., Elastic Cloud, Bonsai)
5. RPC endpoints (Alchemy, Infura, or QuickNode)

## Deployment Steps

### 1. Create a New Project in Railway

### 2. Add Infrastructure

- **PostgreSQL**: Add from Railway's database options
- **Redis**: Add Redis plugin
- **Elasticsearch**: Use external provider and add URL to env vars

### 3. Deploy Services

For each service, create a new service in Railway:

#### API Service
- **Source**: Your GitHub repo
- **Root Directory**: `/`
- **Dockerfile Path**: `services/api/Dockerfile`
- **Port**: 3000

#### Indexer Service
- **Source**: Your GitHub repo
- **Root Directory**: `/`
- **Dockerfile Path**: `services/indexer/Dockerfile`

#### Orchestrator Service
- **Source**: Your GitHub repo
- **Root Directory**: `/`
- **Dockerfile Path**: `services/orchestrator/Dockerfile`

#### Workers Service
- **Source**: Your GitHub repo
- **Root Directory**: `/`
- **Dockerfile Path**: `services/workers/Dockerfile`

#### WAL-Listener Service
- **Source**: Your GitHub repo
- **Root Directory**: `/`
- **Dockerfile Path**: `services/wal-listener/Dockerfile`

### 4. Environment Variables

Set these variables (shared or per-service):

```env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
ELASTICSEARCH_URL=https://...
PRIMARY_RPC_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
PRIMARY_RPC_OP=https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY
PRIMARY_RPC_ETH=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
NODE_ENV=production
```

### 5. Deployment Order

1. **PostgreSQL + Redis** - Infrastructure first
2. **Orchestrator** - Runs migrations, sets up schema
3. **Indexer** - Starts indexing blockchain events
4. **API** - Serves HTTP requests
5. **Workers** - Background job processing
6. **WAL-Listener** - Database change streaming

### 6. Health Checks

The API exposes `/health` endpoint for health checks.

### 7. Scaling

- **API**: Can run multiple replicas behind load balancer
- **Indexer**: Run single instance per chain to avoid duplicates
- **Workers**: Can scale horizontally
- **WAL-Listener**: Single instance recommended

## Alternative: Using Root Dockerfile with Targets

You can also use the root `Dockerfile` with build targets:

```bash
# Build specific service
docker build --target api -t efp-api .
docker build --target indexer -t efp-indexer .
docker build --target orchestrator -t efp-orchestrator .
docker build --target workers -t efp-workers .
docker build --target wal-listener -t efp-wal-listener .
```

In Railway, set the `DOCKER_TARGET` variable to the service name.

## Monitoring

- Check `/health` endpoint for API status
- Monitor database for `indexer_state` table to track indexing progress
- Check `efp_system_state` for overall system status
