# syntax=docker/dockerfile:1
#
# Hoardodile server image — the Fastify sidecar exactly as desktop packaging
# stages it: apps/server/dist (native deps + embedded SPA + migrations)
# plus the builtin `file` plugin and every seed plugin dist, assembled by
# scripts/stage-runtime.mjs (plugin-channel SSOT: scripts/lib/plugin-channels.mjs).
#
# Build:
#   docker build -t hoardodile .
# Run (see compose.yaml for the documented setup):
#   docker run -d -p 3000:3000 -v hd-data:/data hoardodile
#
# Runtime env: config is env-only (apps/server/src/config/env.ts), so a
# reverse proxy in front only needs HOST/PORT/STORAGE_ROOT plus
# SESSION_SECURE_COOKIE/FORCE_HTTPS (see README). HOARDODILE_PACKAGED=1
# keeps the server from walking a workspace `.env`/package.json — it has
# none inside the image — and enables the packaged seed semantics
# (uninstalling a bundled plugin removes its source until the image is
# recreated with a newer one).

FROM node:24-bookworm-slim AS build

# 7z-bin's install script downloads its binary through `curl` (ffmpeg-static
# style); bookworm-slim ships neither it nor the CA bundle.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Corepack reads the pinned pnpm from package.json's `packageManager`.
RUN corepack enable

WORKDIR /app

# Manifest-first install (Turborepo's monorepo Dockerfile pattern) keeps
# the dependency layer cached until a manifest or the lockfile changes.
# When a new workspace package is added, add its package.json here too.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY plugins/file/package.json plugins/file/package.json
COPY plugins/gallery/package.json plugins/gallery/package.json
COPY plugins/template/package.json plugins/template/package.json
COPY plugins/pdf/package.json plugins/pdf/package.json
COPY plugins/host/package.json plugins/host/package.json
COPY plugins/host-web/package.json plugins/host-web/package.json
COPY plugins/sdk-types/package.json plugins/sdk-types/package.json
COPY plugins/sdk-server/package.json plugins/sdk-server/package.json
COPY plugins/sdk-web/package.json plugins/sdk-web/package.json
COPY plugins/sdk-react/package.json plugins/sdk-react/package.json
COPY plugins/workbench/package.json plugins/workbench/package.json
COPY plugins/create-plugin/package.json plugins/create-plugin/package.json
RUN pnpm install --frozen-lockfile

# Full source: build the runtime tree (desktop shell is irrelevant here —
# its dependencies are installed but never built or shipped).
COPY . .
RUN pnpm exec turbo run build --filter=!@hoardodile/desktop
RUN node scripts/stage-runtime.mjs --out /out/runtime --channels-env

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	STORAGE_ROOT=/data \
	HOARDODILE_PACKAGED=1

WORKDIR /app
COPY --from=build /out/runtime /app

# /app is owned by root; the server only needs write access to /data.
RUN mkdir -p /data && chown node:node /data
USER node

VOLUME /data
EXPOSE 3000

# No curl in slim; the bundled Node runs the probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# channels.env (written by stage-runtime.mjs) carries the BUILTIN_PATH and
# SEED_PLUGIN_PATHS values the image actually ships, relative to /app (the
# packaged runtime resolves relative paths against its cwd) — the same
# seed channel set the desktop shell discovers at runtime.
CMD ["sh", "-c", "set -a; . ./channels.env; set +a; exec node --enable-source-maps ./server/main.js"]
