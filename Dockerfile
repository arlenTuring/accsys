# ACCSYS app image: same image for local test hosts and the on-prem server.
# Uses only the built-in BuildKit frontend (no remote `# syntax=` image).
# No cloud-provider services are required at build or run time.
#
# Build needs outbound HTTPS to the npm registry only (fonts come from the
# @fontsource packages in the lockfile).

# Pinned by digest so a rebuilt tag cannot silently change the base image.
# Refresh deliberately (see README「更新基底映像」) to pick up OS security patches.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# One-off jobs, never part of web startup: migrations (MIGRATION_DATABASE_URL,
# accsys_migrator) and the admin CLI scripts (DATABASE_URL, accsys_app).
FROM ${NODE_IMAGE} AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY drizzle ./drizzle
COPY db/baseline-fingerprint.json ./db/
COPY scripts/db-migrate.ts scripts/db-baseline.ts scripts/db-fingerprint.ts ./scripts/
COPY scripts/auth-bootstrap.ts scripts/directory-sync.ts scripts/directory-authorize.ts ./scripts/
COPY scripts/lib/migrations.ts ./scripts/lib/
COPY src/lib ./src/lib
USER node
ENTRYPOINT ["node_modules/.bin/tsx"]
CMD ["scripts/db-migrate.ts"]

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    STORAGE_LOCAL_PATH=/data/attachments
# App files stay root-owned (read-only for the runtime user); only the
# attachment directory and Next's cache are writable, and only by `node`.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
RUN mkdir -p /data/attachments /app/.next/cache \
 && chown node:node /data/attachments /app/.next/cache \
 && chmod 0700 /data/attachments
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
