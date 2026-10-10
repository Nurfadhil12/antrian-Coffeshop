# deployment/Makefile — pintasan perintah Docker Compose
# Jalankan dari folder deployment/:  make help
#
# Catatan: file ini memakai TAB untuk indentasi perintah (wajib di Makefile).

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

COMPOSE      := docker compose -f docker-compose.yml
COMPOSE_PROD := docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: help env check up down restart ps logs logs-api logs-web logs-db build prod-up prod-down prod-build deploy migrate seed backup restore certs certs-prod certs-renew shell-db psql smoke clean prune

help: ## Tampilkan daftar target
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## Buat deployment/.env dari .env.example (kalau belum ada)
	@test -f .env || { cp .env.example .env; echo "deployment/.env dibuat — ISI dulu password & DOMAIN-nya."; }

check: ## Validasi konfigurasi compose (tanpa menjalankan container)
	@$(COMPOSE) config --quiet && echo "base compose OK"
	@$(COMPOSE_PROD) config --quiet && echo "prod override OK"

up: env ## Nyalakan stack (dev/staging: port DB terbuka di loopback)
	$(COMPOSE) up -d --build --remove-orphans
	@$(COMPOSE) ps

down: ## Matikan stack (volume & data tetap aman)
	$(COMPOSE) down --remove-orphans

restart: ## Restart semua service
	$(COMPOSE) restart

ps: ## Status container
	$(COMPOSE) ps

logs: ## Ikuti semua log
	$(COMPOSE) logs -f --tail 100

logs-api: ## Log backend NestJS
	$(COMPOSE) logs -f --tail 100 api

logs-web: ## Log frontend Next.js
	$(COMPOSE) logs -f --tail 100 web

logs-db: ## Log PostgreSQL
	$(COMPOSE) logs -f --tail 100 db

build: ## Build ulang semua image
	$(COMPOSE) build --pull

prod-up: env ## Nyalakan stack produksi (limit resource, port DB ditutup)
	$(COMPOSE_PROD) up -d --remove-orphans
	@$(COMPOSE_PROD) ps

prod-down: ## Matikan stack produksi
	$(COMPOSE_PROD) down --remove-orphans

prod-build: ## Build image produksi
	$(COMPOSE_PROD) build --pull

deploy: ## Deploy/update penuh (git pull, image, migrasi, up, verifikasi)
	./scripts/deploy.sh $(ARGS)

migrate: ## Jalankan migrasi database (Prisma) satu kali — otomatis juga saat 'up'
	$(COMPOSE) run --rm api-migrate

seed: ## Isi data contoh (9 menu, 3 barista, 3 antrian hari ini, 3 pengeluaran)
	$(COMPOSE) --profile tools run --rm api-seed

backup: ## Backup database ke ./backups
	./scripts/backup-db.sh

restore: ## Restore database — pakai: make restore FILE=backups/nama.dump
	@test -n "$(FILE)" || { echo "Pakai: make restore FILE=backups/nama.dump"; exit 1; }
	./scripts/restore-db.sh "$(FILE)"

smoke: ## Uji API lewat Nginx (HTTPS; otomatis -k untuk domain lokal/self-signed)
	@set -a; . ./.env; set +a; \
	  case "$${DOMAIN:-localhost}" in \
	    localhost|127.0.0.1|*.local|*.localhost) EXTRA="-k" ;; \
	    *) EXTRA="" ;; \
	  esac; \
	  BASE="https://$${DOMAIN:-localhost}:$${HTTPS_PORT:-8443}/api"; \
	  echo "BASE=$$BASE CURL_EXTRA='$$EXTRA'"; \
	  echo "catatan: jalur ini MENULIS data uji ke database (lihat kepala smoke-api.sh)"; \
	  BASE="$$BASE" CURL_EXTRA="$$EXTRA" SHOP_TIMEZONE="$${SHOP_TIMEZONE:-Asia/Jakarta}" \
	    ../api/scripts/smoke-api.sh $(ARGS)

certs: ## Inisialisasi sertifikat TLS pertama kali (staging LE)
	./scripts/init-letsencrypt.sh

certs-prod: ## Minta sertifikat produksi Let's Encrypt
	LETSENCRYPT_STAGING=0 ./scripts/init-letsencrypt.sh

certs-renew: ## Perpanjang sertifikat sekarang (biasanya otomatis)
	$(COMPOSE_PROD) run --rm --entrypoint certbot certbot renew --webroot -w /var/www/certbot
	$(COMPOSE_PROD) exec nginx nginx -s reload

shell-db: ## Masuk ke shell container db (sh)
	$(COMPOSE_PROD) exec db sh

psql: ## Buka psql interaktif ke database aplikasi
	$(COMPOSE_PROD) exec db sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

clean: ## Hentikan stack + HAPUS volume (data database & sertifikat hilang!)
	@read -r -p "Ini menghapus volume pgdata + sertifikat. Lanjut? (ketik 'ya'): " a; [ "$$a" = "ya" ] || exit 1
	$(COMPOSE_PROD) down -v --remove-orphans

prune: ## Bersihkan image/volume yatim (tidak menyentuh data aktif)
	docker image prune -f
	docker volume prune -f
