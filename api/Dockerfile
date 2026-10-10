# api/Dockerfile — NestJS multi-stage
# Stage: deps -> build -> prod-deps -> runtime (default)   dan   -> migrator (khusus migrasi)
#
# Struktur yang diasumsikan:
#   api/package.json, api/package-lock.json, api/src/, api/tsconfig.json
#   api/prisma/schema.prisma, api/prisma7.config.ts
#
# KONTRAK MIGRASI (dipilih sadar, lihat deployment/README.md):
#   Image `runtime` TIDAK membawa Prisma CLI, jadi tidak bisa memigrasi sendiri.
#   Migrasi dijalankan service `api-migrate` (target `migrator`, devDependencies
#   utuh) yang HARUS selesai sukses sebelum `api` start — dipaksa oleh
#   `depends_on: api-migrate: condition: service_completed_successfully`.
#   Karena itu RUN_MIGRATIONS=false di deployment/.env.
#
# Kalau butuh modul native (bcrypt, sharp, dll): ganti base image ke
# node:${NODE_VERSION}-slim (Debian) dan sesuaikan perintah apk -> apt-get.

ARG NODE_VERSION=24

# ─────────────────────────────── deps ───────────────────────────────
FROM node:${NODE_VERSION}-alpine AS deps
ARG NODE_VERSION
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
# Prisma 7: `prisma generate` (dipanggil postinstall) membaca prisma7.config.ts
# yang mengambil url dari DATABASE_URL. Nilai dummy ini hanya untuk tahap build;
# tidak ada koneksi yang benar-benar dibuka oleh `generate`.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
# Schema + config Prisma perlu ada SEBELUM npm ci karena ada script postinstall
# "prisma generate" (client Prisma 7 di-generate sebagai kode TypeScript).
COPY prisma ./prisma
COPY prisma7.config.ts ./
RUN set -eux; \
    if [ -f package-lock.json ]; then npm ci; \
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile --ignore-scripts; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; \
    else npm install; fi

# ─────────────────────────────── build ──────────────────────────────
FROM node:${NODE_VERSION}-alpine AS build
ARG NODE_VERSION
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=development
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Selalu pastikan folder prisma ada supaya COPY antar-stage tidak gagal.
RUN mkdir -p prisma
# Prisma client harus di-generate sebelum compile (client = kode TypeScript).
RUN npx prisma generate
RUN npm run build
# Normalisasi output: beberapa konfigurasi tsconfig menghasilkan dist/src/main.js.
RUN if [ -f dist/src/main.js ] && [ ! -f dist/main.js ]; then cp -r dist/src/. dist/ ; fi

# ──────────────────── migrator (devDependencies utuh) ───────────────
# Dipakai service `api-migrate`: docker compose run --rm api-migrate
FROM build AS migrator
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# ──────────────────── prod-deps (hanya dependencies) ────────────────
# --ignore-scripts penting: script postinstall "prisma generate" butuh Prisma CLI
# yang merupakan devDependency, jadi tidak ada di stage ini. Client Prisma sudah
# di-generate dan ikut ter-compile ke dist/ di stage `build`.
FROM node:${NODE_VERSION}-alpine AS prod-deps
ARG NODE_VERSION
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN set -eux; \
    if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; \
    elif [ -f yarn.lock ]; then yarn install --production --frozen-lockfile --ignore-scripts; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --prod --frozen-lockfile --ignore-scripts; \
    else npm install --omit=dev --ignore-scripts; fi

# ────────────────────────────── runtime ─────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
ARG NODE_VERSION
RUN apk add --no-cache openssl curl tini libcap
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    MIGRATE_STATUS_FILE=/app/logs/migrate-status.json \
    TZ=UTC

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/logs && chown -R node:node /app

USER node
EXPOSE 3000 80

# Izinkan user non-root mengikat port <1024 (port 80) — dipakai kalau container
# dijalankan di platform yang menyuntik PORT=80 (Vercel Services mengarahkan trafik
# ke port 80 secara default). Docker sendiri menyetel
# net.ipv4.ip_unprivileged_port_start=0 sehingga tidak terlihat di compose.
USER root
RUN setcap 'cap_net_bind_service=+ep' "$(command -v node)" && getcap "$(command -v node)"
USER node

# Liveness tanpa perlu endpoint tambahan: pastikan port benar-benar listen.
# Endpoint /api/health dipakai smoke test & Nginx, bukan healthcheck image ini.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const s=require('net').connect(Number(process.env.PORT||3000),'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));"

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
