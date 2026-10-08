# syntax=docker/dockerfile:1

# ---- build: compile the client ----------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

# Manifests first so the dependency layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @hexxar/client build

# ---- runtime: the game server, which also serves the built client -----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN pnpm install --frozen-lockfile --prod --filter @hexxar/server...

COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY --from=build /app/apps/client/dist apps/client/dist

ENV PORT=8080 STATIC_DIR=/app/apps/client/dist
USER node
EXPOSE 8080
WORKDIR /app/apps/server

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node_modules/.bin/tsx", "src/index.ts"]
