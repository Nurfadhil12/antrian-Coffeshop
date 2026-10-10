#!/usr/bin/env bash
# deployment/scripts/deploy.sh — deploy/update aplikasi di VPS
#
# Langkah: git pull → (opsional) build → tarik image → migrasi → up -d → verifikasi.
#
# Pakai:
#   ./scripts/deploy.sh                 # update: pull kode + pull image + migrasi + restart
#   ./scripts/deploy.sh --build         # build image lokal di VPS (tanpa registry)
#   ./scripts/deploy.sh --no-pull       # lewati 'git pull' (mis. dipanggil dari CI)
#   ./scripts/deploy.sh --no-migrate    # lewati migrasi database
#   PROD=0 ./scripts/deploy.sh          # tanpa docker-compose.prod.yml

set -Eeuo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

DO_PULL=1
DO_BUILD=0
DO_MIGRATE=1
for arg in "$@"; do
  case "$arg" in
    --build)       DO_BUILD=1 ;;
    --no-pull)     DO_PULL=0 ;;
    --no-migrate)  DO_MIGRATE=0 ;;
    -h|--help)     sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Argumen tidak dikenal: $arg" >&2; exit 1 ;;
  esac
done

if [[ ! -f .env ]]; then
  echo "ERROR: $DEPLOY_DIR/.env belum ada (cp .env.example .env)." >&2
  exit 1
fi

# Simpan nilai yang datang dari luar (mis. dari CI: API_IMAGE=ghcr.io/... ), karena
# 'source .env' di bawah akan menimpanya dengan nilai default di file .env.
PRE_API_IMAGE="${API_IMAGE:-}"
PRE_WEB_IMAGE="${WEB_IMAGE:-}"
PRE_NGINX_IMAGE="${NGINX_IMAGE:-}"
PRE_API_MIGRATE_IMAGE="${API_MIGRATE_IMAGE:-}"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

if [[ -n "$PRE_API_IMAGE" ]];         then export API_IMAGE="$PRE_API_IMAGE"; fi
if [[ -n "$PRE_WEB_IMAGE" ]];         then export WEB_IMAGE="$PRE_WEB_IMAGE"; fi
if [[ -n "$PRE_NGINX_IMAGE" ]];       then export NGINX_IMAGE="$PRE_NGINX_IMAGE"; fi
if [[ -n "$PRE_API_MIGRATE_IMAGE" ]]; then export API_MIGRATE_IMAGE="$PRE_API_MIGRATE_IMAGE"; fi

COMPOSE_ARGS=(-f docker-compose.yml)
if [[ "${PROD:-1}" == "1" && -f docker-compose.prod.yml ]]; then
  COMPOSE_ARGS+=(-f docker-compose.prod.yml)
fi
dc() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon tidak jalan." >&2
  exit 1
fi

# ── 1) Update kode ──
if [[ "$DO_PULL" == "1" && -d .git ]]; then
  step "git pull --ff-only"
  git pull --ff-only
elif [[ "$DO_PULL" == "1" ]]; then
  step "Lewati git pull (bukan git repository)"
fi

# ── 2) Siapkan image ──
if [[ "$DO_BUILD" == "1" ]]; then
  step "Build image lokal"
  dc build --pull
else
  step "Tarik image terbaru dari registry"
  # Image yang dibangun lokal (tag :local) akan gagal di-pull — itu tidak fatal.
  dc pull --ignore-pull-failures || true
fi

# ── 3) Migrasi database ──
if [[ "$DO_MIGRATE" == "1" ]]; then
  step "Migrasi database (service api-migrate)"
  MIGRATOR_IMAGE="${API_MIGRATE_IMAGE:-coffeeshop-api:migrator}"
  if ! docker image inspect "$MIGRATOR_IMAGE" >/dev/null 2>&1; then
    echo "    image migrator belum ada → build dulu"
    dc --profile tools build api-migrate
  fi
  dc --profile tools run --rm api-migrate
else
  step "Lewati migrasi (--no-migrate)"
fi

# ── 4) Nyalakan/refresh stack ──
step "docker compose up -d --remove-orphans"
dc up -d --remove-orphans

# ── 5) Verifikasi lewat proxy ──
step "Menunggu nginx sehat di port ${HTTP_PORT:-8080}"
HTTP_PORT="${HTTP_PORT:-8080}"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HTTP_PORT}/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
dc ps
if [[ "$ok" == "1" ]]; then
  echo "==> nginx merespons di port ${HTTP_PORT} (healthz OK)"
else
  echo "PERINGATAN: nginx belum merespons di http://127.0.0.1:${HTTP_PORT}/healthz" >&2
  dc logs --tail 50 nginx >&2 || true
fi

# Verifikasi kedua: API benar-benar menjawab lewat proxy (bukan hanya nginx hidup).
step "Cek API lewat proxy"
if curl -fsS "http://127.0.0.1:${HTTP_PORT}/api/health" >/tmp/deploy-health.json 2>/dev/null; then
  cat /tmp/deploy-health.json
  echo
  echo "    (field \"status\" harus \"ok\", db \"up\", schema \"ok\")"
else
  echo "PERINGATAN: /api/health tidak bisa diakses lewat nginx. Cek: dc logs --tail 80 api" >&2
fi

# ── 6) Bersihkan image lama ──
step "Prune image tanpa tag"
docker image prune -f >/dev/null

step "Selesai"
echo "    Aplikasi : https://${DOMAIN:-localhost}$([[ "${HTTP_PORT:-8080}" != "80" ]] && echo " (http://127.0.0.1:${HTTP_PORT})")"
echo "    Cek status: docker compose ${COMPOSE_ARGS[*]} ps"
echo "    Cek log   : docker compose ${COMPOSE_ARGS[*]} logs -f --tail 100"
