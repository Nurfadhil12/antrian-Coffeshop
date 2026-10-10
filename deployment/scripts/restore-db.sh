#!/usr/bin/env bash
# deployment/scripts/restore-db.sh
#
# Restore database dari hasil scripts/backup-db.sh (atau file .dump lain).
#
# Pakai:
#   ./scripts/restore-db.sh backups/coffeeshop_2026-10-10_023000.dump
#   ./scripts/restore-db.sh backups/coffeeshop_2026-10-10_023000.dump --yes   # tanpa konfirmasi
#
# Peringatan: database tujuan di-DROP lalu dibuat ulang. API & web dimatikan
# sementara selama proses, lalu dinyalakan kembali.

set -Eeuo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

DUMP_FILE="${1:-}"
ASSUME_YES="${2:-}"

if [[ -z "$DUMP_FILE" ]]; then
  echo "Pakai: $0 <file.dump> [--yes]" >&2
  echo "File yang tersedia:" >&2
  ls -1t backups/*.dump 2>/dev/null | head -10 >&2 || echo "  (folder backups/ kosong)" >&2
  exit 1
fi

[[ -f "$DUMP_FILE" ]] || { echo "ERROR: file '$DUMP_FILE' tidak ditemukan." >&2; exit 1; }

# shellcheck disable=SC1091
if [[ -f .env ]]; then set -a; . ./.env; set +a; fi

DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-coffeeshop}"
BASENAME="$(basename "$DUMP_FILE")"

COMPOSE_ARGS=(-f docker-compose.yml)
[[ -f docker-compose.prod.yml ]] && COMPOSE_ARGS+=(-f docker-compose.prod.yml)
dc() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

if [[ "$ASSUME_YES" != "--yes" && "$ASSUME_YES" != "-y" ]]; then
  echo "PERINGATAN: database '$DB_NAME' akan DIHAPUS dan diganti isi dari '$BASENAME'."
  read -r -p "Lanjutkan? (ketik 'ya' untuk lanjut): " answer
  [[ "$answer" == "ya" ]] || { echo "Dibatalkan."; exit 0; }
fi

echo "==> 1/6 Matikan api & web supaya tidak ada koneksi aktif"
dc stop api web 2>/dev/null || true

echo "==> 2/6 Pastikan container db jalan"
dc up -d db
for _ in $(seq 1 30); do
  if dc exec -T db pg_isready -U "$DB_USER" -d postgres >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "==> 3/6 Putuskan semua koneksi ke '$DB_NAME'"
dc exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();"

echo "==> 4/6 Drop & create database '$DB_NAME'"
dc exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
dc exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
# Ekstensi ikut hilang bersama database → pasang ulang (idempotent, sama seperti
# postgres/init/01-init.sql)
dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c \
  "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"

echo "==> 5/6 Restore '$BASENAME'"
dc exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" \
  --no-owner --no-privileges --clean --if-exists --exit-on-error "/backups/$BASENAME"

echo "==> 6/6 Nyalakan kembali api & web"
dc up -d api web nginx

echo
echo "==> Selesai. Cek tabelnya: docker compose ${COMPOSE_ARGS[*]} exec db psql -U $DB_USER -d $DB_NAME -c '\\dt'"
