#!/usr/bin/env bash
# deployment/scripts/init-letsencrypt.sh
#
# Inisialisasi sertifikat TLS untuk Nginx:
#   1. bikin sertifikat dummy (self-signed) supaya nginx bisa start
#   2. minta sertifikat asli dari Let's Encrypt lewat webroot challenge
#   3. reload nginx
#
# Kalau DOMAIN=localhost / 127.0.0.1 / *.local → cukup self-signed, Let's Encrypt dilewati
# (CA publik tidak bisa memvalidasi nama privat).
#
# Pakai:
#   ./scripts/init-letsencrypt.sh                        # pakai setting .env (STAGING dulu!)
#   LETSENCRYPT_STAGING=0 ./scripts/init-letsencrypt.sh  # sertifikat produksi
#
# Jalankan dari mana saja (path di-resolve otomatis).

set -Eeuo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: $DEPLOY_DIR/.env belum ada. Jalankan: cp .env.example .env lalu isi." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

DOMAIN="${DOMAIN:?DOMAIN belum diisi di deployment/.env}"
EMAIL="${LETSENCRYPT_EMAIL:-}"
STAGING="${LETSENCRYPT_STAGING:-1}"

COMPOSE_ARGS=(-f docker-compose.yml)
[[ -f docker-compose.prod.yml ]] && COMPOSE_ARGS+=(-f docker-compose.prod.yml)
dc() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

ensure_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker daemon tidak jalan. Start Docker dulu (mis. 'open -a Docker' atau 'sudo systemctl start docker')." >&2
    exit 1
  fi
}
ensure_docker

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

echo "==> Domain        : $DOMAIN"
echo "==> Email         : ${EMAIL:-<kosong>}"
echo "==> Let's Encrypt : $([[ "$STAGING" == "1" ]] && echo 'STAGING (sertifikat tidak dipercaya browser)' || echo 'PRODUKSI')"

if ! dc config --quiet 2>/dev/null; then
  echo "ERROR: konfigurasi compose tidak valid. Cek dengan: docker compose -f docker-compose.yml config" >&2
  exit 1
fi

# ── Domain lokal: self-signed saja ──
case "$DOMAIN" in
  localhost|127.0.0.1|*.local|*.localhost)
    echo "==> Domain lokal terdeteksi — membuat sertifikat self-signed (Let's Encrypt dilewati)"
    dc run --rm --no-deps --entrypoint sh certbot -c "
      mkdir -p '$CERT_DIR' &&
      openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -keyout '$CERT_DIR/privkey.pem' \
        -out    '$CERT_DIR/fullchain.pem' \
        -subj '/CN=$DOMAIN' \
        -addext 'subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1'
    "
    dc up -d nginx >/dev/null
    echo "==> Selesai. Buka https://$DOMAIN:${HTTPS_PORT:-8443} (browser akan memperingatkan sertifikat self-signed — normal)."
    exit 0
    ;;
esac

if [[ -z "$EMAIL" ]]; then
  echo "ERROR: LETSENCRYPT_EMAIL kosong di .env (wajib untuk Let's Encrypt)." >&2
  exit 1
fi

# ── 1) Sertifikat dummy 1 hari supaya nginx bisa start (nginx membaca sertifikat
#       saat load; file yang belum ada membuatnya menolak start) ──
echo "==> 1/5 Membuat sertifikat dummy (self-signed) untuk $DOMAIN"
dc run --rm --no-deps --entrypoint sh certbot -c "
  rm -rf '$CERT_DIR' '/etc/letsencrypt/archive/$DOMAIN' '/etc/letsencrypt/renewal/$DOMAIN.conf' &&
  mkdir -p '$CERT_DIR' &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout '$CERT_DIR/privkey.pem' \
    -out    '$CERT_DIR/fullchain.pem' \
    -subj '/CN=localhost'
"

# ── 2) Start nginx ──
echo "==> 2/5 Menyalakan nginx"
dc up -d nginx
for _ in $(seq 1 30); do
  if dc exec -T nginx wget -q -O /dev/null http://127.0.0.1/healthz 2>/dev/null; then
    echo "    nginx siap"
    break
  fi
  sleep 2
done

# ── 3) Hapus sertifikat dummy ──
echo "==> 3/5 Menghapus sertifikat dummy"
dc run --rm --no-deps --entrypoint sh certbot -c "
  rm -rf '$CERT_DIR' '/etc/letsencrypt/archive/$DOMAIN' '/etc/letsencrypt/renewal/$DOMAIN.conf'
"

# ── 4) Minta sertifikat asli ──
echo "==> 4/5 Meminta sertifikat dari Let's Encrypt"
CERTBOT_ARGS=(
  certonly
  --webroot -w /var/www/certbot
  -d "$DOMAIN"
  --email "$EMAIL"
  --agree-tos --no-eff-email --non-interactive
  --key-type ecdsa
  --force-renewal
  --deploy-hook "true"
)
[[ "$STAGING" == "1" ]] && CERTBOT_ARGS+=(--staging)
dc run --rm --entrypoint certbot certbot "${CERTBOT_ARGS[@]}"

# ── 5) Reload nginx ──
echo "==> 5/5 Reload nginx"
dc exec -T nginx nginx -t
dc exec -T nginx nginx -s reload

echo
echo "==> Selesai. https://$DOMAIN sudah memakai sertifikat Let's Encrypt $([[ "$STAGING" == "1" ]] && echo '(STAGING)')."
if [[ "$STAGING" == "1" ]]; then
  echo "    Setelah yakin semuanya normal, minta sertifikat produksi:"
  echo "      LETSENCRYPT_STAGING=0 ./scripts/init-letsencrypt.sh"
fi
echo "    Perpanjangan otomatis ditangani container 'certbot' (cek tiap 12 jam)."
