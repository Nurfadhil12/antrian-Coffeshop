#!/usr/bin/env bash
# deployment/scripts/backup-db.sh
#
# Backup database PostgreSQL ke folder ./backups (bind-mount ke container db).
# Format: custom-format pg_dump (-Fc) + kompresi internal (-Z 6), siap di-restore
# dengan scripts/restore-db.sh.
#
# Pakai:
#   ./scripts/backup-db.sh
#
# Jadwalkan lewat cron host, contoh (tiap hari 02:30):
#   30 2 * * * cd /srv/app/deployment && ./scripts/backup-db.sh >> /var/log/coffeeshop-backup.log 2>&1

set -Eeuo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: $DEPLOY_DIR/.env belum ada." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-coffeeshop}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
FILE="${DB_NAME}_${STAMP}.dump"

COMPOSE_ARGS=(-f docker-compose.yml)
[[ -f docker-compose.prod.yml ]] && COMPOSE_ARGS+=(-f docker-compose.prod.yml)
dc() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

if ! dc ps --status running --services 2>/dev/null | grep -qx db; then
  echo "ERROR: container 'db' tidak jalan. Jalankan: docker compose ${COMPOSE_ARGS[*]} up -d db" >&2
  exit 1
fi

echo "==> Dump $DB_NAME sebagai $DB_USER"
dc exec -T db sh -c "mkdir -p /backups && pg_dump -U '$DB_USER' -d '$DB_NAME' -Fc -Z 6 -f '/backups/$FILE'"

echo "==> Verifikasi hasil dump"
dc exec -T db sh -c "pg_restore -l '/backups/$FILE' > /dev/null && ls -lh '/backups/$FILE'"

# Retensi dijalankan DI DALAM container: berkasnya milik uid postgres, jadi user
# host tidak punya izin menghapusnya.
echo "==> Membersihkan backup lebih tua dari ${RETENTION} hari"
dc exec -T db sh -c "find /backups -maxdepth 1 -type f -name '*.dump' -mtime +${RETENTION} -print -delete"

echo "==> Selesai. Backup terbaru:"
ls -lh "$DEPLOY_DIR/backups" 2>/dev/null | tail -5 || \
  dc exec -T db sh -c "ls -lh /backups | tail -5"
