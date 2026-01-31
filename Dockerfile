# Base stage with dependencies
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
COPY services/shared/package.json ./services/shared/
COPY services/api/package.json ./services/api/
COPY services/indexer/package.json ./services/indexer/
COPY services/orchestrator/package.json ./services/orchestrator/
COPY services/workers/package.json ./services/workers/
COPY services/wal-listener/package.json ./services/wal-listener/
RUN npm ci

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build shared first, then all other packages
RUN npm run build --workspace=@efp/shared && npm run build --workspaces --if-present

# Shared runtime base
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/services/shared/dist ./services/shared/dist
COPY --from=builder /app/services/shared/package.json ./services/shared/
COPY package.json ./

# API service
FROM runtime AS api
COPY --from=builder /app/services/api/dist ./services/api/dist
COPY --from=builder /app/services/api/package.json ./services/api/
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "services/api/dist/index.js"]

# Indexer service
FROM runtime AS indexer
COPY --from=builder /app/services/indexer/dist ./services/indexer/dist
COPY --from=builder /app/services/indexer/package.json ./services/indexer/
ENV NODE_ENV=production
CMD ["node", "services/indexer/dist/index.js"]

# Orchestrator service
FROM runtime AS orchestrator
COPY --from=builder /app/services/orchestrator/dist ./services/orchestrator/dist
COPY --from=builder /app/services/orchestrator/package.json ./services/orchestrator/
ENV NODE_ENV=production
CMD ["node", "services/orchestrator/dist/index.js"]

# Workers service
FROM runtime AS workers
COPY --from=builder /app/services/workers/dist ./services/workers/dist
COPY --from=builder /app/services/workers/package.json ./services/workers/
ENV NODE_ENV=production
CMD ["node", "services/workers/dist/index.js"]

# WAL-Listener service
FROM runtime AS wal-listener
COPY --from=builder /app/services/wal-listener/dist ./services/wal-listener/dist
COPY --from=builder /app/services/wal-listener/package.json ./services/wal-listener/
ENV NODE_ENV=production
CMD ["node", "services/wal-listener/dist/index.js"]
