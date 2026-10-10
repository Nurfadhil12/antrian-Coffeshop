# web/Dockerfile — Next.js (multi-stage, output "standalone")
#
# WAJIB: web/next.config.js harus memuat  output: 'standalone'
# Kalau tidak, stage runner tidak menemukan .next/standalone dan build gagal
# (pesan errornya eksplisit di stage builder).
#
# Kalau frontend-mu static export (output: 'export'), jangan pakai image ini —
# build di CI lalu serve folder out/ lewat Nginx.

ARG NODE_VERSION=24

# ─────────────────────────────── deps ───────────────────────────────
FROM node:${NODE_VERSION}-alpine AS deps
ARG NODE_VERSION
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN set -eux; \
    if [ -f package-lock.json ]; then npm ci; \
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; \
    else npm install; fi

# ────────────────────────────── builder ─────────────────────────────
FROM node:${NODE_VERSION}-alpine AS builder
ARG NODE_VERSION
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ sering belum ada di project baru; buat supaya COPY di stage runner aman
RUN mkdir -p public

# NEXT_PUBLIC_* ditanam ke bundle saat BUILD (ubah butuh rebuild, bukan restart)
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Target rewrites /api (dipakai kalau frontend diakses langsung, bukan lewat Nginx).
# Default di next.config.js = http://localhost:3220 (API di host); di container
# compose diarahkan ke service api.
ARG API_PROXY_TARGET=http://localhost:3220
ENV API_PROXY_TARGET=${API_PROXY_TARGET}

RUN npm run build
RUN if [ ! -d .next/standalone ]; then \
      echo "ERROR: .next/standalone tidak ada."; \
      echo "Tambahkan  output: 'standalone'  ke web/next.config.js lalu build ulang."; \
      exit 1; \
    fi

# ─────────────────────────────── runner ─────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
ARG NODE_VERSION
WORKDIR /app
RUN apk add --no-cache curl

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=UTC

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const s=require('net').connect(Number(process.env.PORT||3000),'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));"

STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
