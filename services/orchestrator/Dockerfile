FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
COPY services/shared/package.json ./services/shared/
COPY services/orchestrator/package.json ./services/orchestrator/
RUN npm ci

# Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=@efp/shared && npm run build --workspace=@efp/orchestrator

# Runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/services/shared/dist ./services/shared/dist
COPY --from=builder /app/services/shared/package.json ./services/shared/
COPY --from=builder /app/services/orchestrator/dist ./services/orchestrator/dist
COPY --from=builder /app/services/orchestrator/package.json ./services/orchestrator/
COPY package.json ./

CMD ["node", "services/orchestrator/dist/index.js"]
