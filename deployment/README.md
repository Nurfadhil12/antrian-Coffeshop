# Deployment — Antrian & Pembukuan Coffee Shop

Stack ini menjalankan tiga lapisan di satu VPS memakai Docker Compose:

    Client ──► Nginx (:80 → redirect, :443 TLS)
                 ├── /              ─► web  (Next.js 16, :3000, standalone)
                 ├── /_next/static  ─► web
                 └── /api/          ─► api  (NestJS 12, :3000) ─► db (PostgreSQL 17)
    certbot ──► renew sertifikat Let's Encrypt tiap 12 jam (volume terpisah)

Hanya 80/443 yang terbuka ke internet. Database dan aplikasi tidak pernah
mengekspos port ke luar host.

---

## 1. Isi aplikasi ini (yang dikelola stack ini)

### Antrian (pesanan)
- **`/`** — papan antrian hari ini: nomor berjalan, pesanan sedang dibuat, daftar
  antrian, dan tombol **Panggil → Selesai → Bayar**.
- Nomor antrian (`A-001`, `A-002`, …) **direset setiap hari** menurut zona waktu toko
  (`SHOP_TIMEZONE`, default `Asia/Jakarta`). Penomoran dikunci dengan *advisory lock*
  per tanggal, jadi dua kasir yang menekan tombol bersamaan tidak dapat nomor sama.
- Total nota dihitung **di server** dari harga master menu (`menu_items`), bukan dari
  angka yang dikirim browser. Harga per baris disimpan sebagai snapshot
  (`order_items.name_snapshot`, `unit_price`) supaya nota lama tidak berubah kalau
  harga menu diedit kemudian.
- Item di luar menu (titipan) didukung: cukup kirim `name` + `unitPrice` tanpa `menuItemId`.

### Pembukuan (buku kas)
- **`/pembukuan`** — daftar baris buku kas per rentang tanggal, total pemasukan,
  pengeluaran, laba, rincian per kategori & metode bayar, dan form catat manual.
- Sumber tunggal angkanya adalah tabel **`ledger_entries`**:
  - **pendapatan penjualan dibuat OTOMATIS** saat nota dibayar (satu nota = satu baris,
    dijaga oleh constraint `UNIQUE (queue_id)`), ditulis dalam **transaksi yang sama**
    dengan perubahan status nota;
  - pengeluaran (bahan baku, gaji, sewa) diinput manual di halaman Pembukuan.
- **Membatalkan** pendapatan dari nota tidak menghapus riwayat begitu saja: baris
  pendapatannya dihapus **dan** nota ditandai `VOID` dalam satu transaksi, sehingga
  total buku kas selalu sama dengan jumlah nota yang benar-benar lunas. Nota `VOID`
  bisa dibayar ulang.
- Menghapus nota berbayar atau mengubah baris pendapatan dari nota **ditolak (409)** —
  koreksinya lewat void, bukan edit diam-diam.
- **`/laporan`** menyandingkan penjualan nota lunas dengan pendapatan di buku kas dan
  menampilkan status kecocokannya (`reconciliation.match`). Kalau ada selisih, itu
  tanda ada baris buku kas yang diubah manual — dan angkanya ditampilkan, bukan disembunyikan.

### Master data
- **`/menu`** — menu (nama, kategori, harga, aktif) & barista.
- Menu/barista yang sudah punya riwayat **tidak dihapus permanen**, hanya dinonaktifkan,
  supaya laporan lama tetap menyebut nama yang benar. API-nya mengembalikan
  `deleted: false, deactivated: true` — jadi jelas apa yang terjadi.

---

## 2. Struktur folder

    <repo-root>/
      api/                                  # source NestJS
        Dockerfile                          # multi-stage: deps → build → migrator → prod-deps → runtime
        .dockerignore
        docker-entrypoint.sh
        prisma/schema.prisma                # model data (Prisma 7)
        prisma/migrations/                  # migrasi SQL (dibuat di mesin ini)
        prisma7.config.ts                   # konfigurasi Prisma CLI (URL koneksi)
        scripts/smoke-api.sh                # uji end-to-end API
        scripts/json-get.js                 # helper baca JSON untuk smoke test
      web/                                  # source Next.js
        Dockerfile, .dockerignore
        app/ (page.tsx, menu/, pembukuan/, laporan/)
        components/, lib/
      deployment/                           # semua berkas deployment
        docker-compose.yml                  # base: db, api, api-migrate, api-seed, web, nginx, certbot
        docker-compose.prod.yml             # override produksi
        .env.example                        # template environment
        Makefile                            # pintasan perintah
        nginx/Dockerfile
        nginx/nginx.conf
        nginx/templates/app.conf.template   # server block (envsubst: ${DOMAIN})
        nginx/snippets/security-headers.conf
        postgres/init/01-init.sql           # ekstensi saja, jalan sekali saat initdb
        scripts/init-letsencrypt.sh
        scripts/backup-db.sh
        scripts/restore-db.sh
        scripts/deploy.sh
        .github/workflows/deploy.yml

**Semua perintah dijalankan dari folder `deployment/`** — compose otomatis membaca
`deployment/.env` (karena file compose ada di folder itu), dan semua path relatif
(volume, build context) di-resolve dari satu tempat.

---

## 3. Deploy pertama kali di VPS

    # 1) Prasyarat (Ubuntu/Debian)
    sudo apt update && sudo apt install -y docker.io docker-compose-plugin git make
    sudo usermod -aG docker "$USER" && newgrp docker

    # 2) Clone repo & masuk folder deployment
    git clone <repo-url> /srv/app && cd /srv/app/deployment

    # 3) Environment — WAJIB diisi: DOMAIN, LETSENCRYPT_EMAIL, POSTGRES_PASSWORD
    cp .env.example .env
    nano .env

    # 4) Port: di VPS yang memegang 80/443, ubah di .env
    #    HTTP_PORT=80
    #    HTTPS_PORT=443
    #    (Let's Encrypt WAJIB bisa menjangkau port 80 dari internet)

    # 5) DNS: arahkan A record (dan AAAA bila ada) ke IP VPS, tunggu propagasi
    dig +short example.com

    # 6) Sertifikat TLS (bikin dummy → minta sertifikat)
    ./scripts/init-letsencrypt.sh          # LETSENCRYPT_STAGING=1 dulu (default di .env.example)

    # 7) Nyalakan semuanya (mode produksi)
    ./scripts/deploy.sh --build            # atau: make prod-up

    # 8) Data contoh (opsional, aman diulang)
    make seed

    # 9) Kalau sudah normal, pindah ke sertifikat produksi
    LETSENCRYPT_STAGING=0 ./scripts/init-letsencrypt.sh

Firewall (hanya buka 22/80/443):

    sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable

**Setelah selesai, WAJIB ganti `POSTGRES_PASSWORD`** di `.env` (password di repo ini
contoh untuk lokal saja) — lalu `make clean` (data hilang) atau `ALTER USER` kalau
volume sudah terlanjur dibuat.

---

## 4. Alur harian (Makefile)

Jalankan dari `deployment/`; `make help` menampilkan daftar lengkap.

| Perintah | Fungsi |
|---|---|
| `make up` / `make down` | nyalakan / matikan stack (port DB terbuka di 127.0.0.1) |
| `make prod-up` / `make prod-down` | stack produksi (limit resource, port DB ditutup) |
| `make logs` / `logs-api` / `logs-web` / `logs-db` | ikuti log |
| `make ps` | status container |
| `make check` | validasi compose base + override (tanpa menjalankan apa pun) |
| `make deploy` | deploy penuh: git pull → image → migrasi → up → verifikasi |
| `make migrate` | migrasi database satu kali — otomatis juga saat `up` |
| `make seed` | data contoh (9 menu, 3 barista, 3 antrian hari ini, 3 pengeluaran) |
| `make smoke` | uji API end-to-end **lewat Nginx** (paling meyakinkan) |
| `make backup` / `make restore FILE=backups/x.dump` | backup / restore PostgreSQL |
| `make psql` / `make shell-db` | masuk ke database |
| `make certs` / `certs-prod` / `certs-renew` | sertifikat TLS |
| `make clean` | **hapus** stack + volume (data & sertifikat hilang) |

Mengembangkan backend di host (tanpa container):

    make up                       # atau: docker compose -f docker-compose.yml up -d db
    # Postgres tersedia di 127.0.0.1:55432
    cd ../api && cp .env.example .env && npm install && npm run start:dev   # port 3220

---

## 5. Update & rollback

    cd /srv/app/deployment
    ./scripts/deploy.sh              # pull kode + tarik image + migrasi + up + verifikasi
    ./scripts/deploy.sh --build      # kalau build image di VPS, bukan dari registry

Rollback cepat:

1. `git checkout <commit-lama>` lalu `./scripts/deploy.sh --no-pull --build`, **atau**
2. pin tag image: set `API_IMAGE=<registry>/api:tag-lama` di `.env`, lalu
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api`.
3. Migrasi database **tidak** ikut rollback otomatis. Backup dulu sebelum migrasi
   destruktif (`make backup`), dan tulis migrasi yang punya jalur `down`.

---

## 6. Backup & restore database

    make backup                                  # → deployment/backups/coffeeshop_<tanggal>.dump
    make restore FILE=backups/coffeeshop_2026-10-10_023000.dump

- Format `pg_dump -Fc -Z 6`, retensi `BACKUP_RETENTION_DAYS` (default 14 hari).
  Retensi dijalankan **di dalam container** karena berkasnya milik uid postgres.
- Cron di host (02:30 tiap hari):

      30 2 * * * cd /srv/app/deployment && ./scripts/backup-db.sh >> /var/log/coffeeshop-backup.log 2>&1

- Simpan salinan di luar VPS, mis. `rclone sync /srv/app/deployment/backups remote:coffeeshop-backups`.
- `postgres/init/*.sql` hanya jalan saat volume `pgdata` masih kosong. Untuk
  menerapkan ulang: `make clean` (data hilang) lalu `make prod-up`.

---

## 7. Migrasi database

Service **`api-migrate` wajib selesai sukses sebelum `api` start**
(`depends_on: api-migrate: condition: service_completed_successfully`), jadi
`docker compose up -d` tidak pernah menyalakan aplikasi di atas skema lama, dan
migrasi yang gagal membatalkan start `api` (bukan aplikasi setengah jalan).

`api-migrate` memakai target build **`migrator`** yang masih membawa devDependencies
(Prisma CLI). Image runtime `api` hanya berisi dependencies produksi — karena itu
`RUN_MIGRATIONS=false` di `.env`: container API **tidak** memigrasi sendiri, dan
`/api/health` melaporkan `migrate.status = "disabled"` sebagai konfirmasi eksplisit.

Tiga jalur menjalankan migrasi:

1. **Otomatis** — `docker compose up -d` / `./scripts/deploy.sh` (default).
2. **Manual** — `make migrate` setelah menambah migrasi baru sementara stack jalan.
3. **Dari CI** — `./scripts/deploy.sh --no-pull` di VPS, lihat bagian 10.

Membuat migrasi baru (butuh `DATABASE_URL` yang bisa dijangkau dari host):

    cd api
    DATABASE_URL='postgresql://postgres:<password>@127.0.0.1:55432/coffeeshop' \
      npx prisma migrate dev --name <nama-perubahan>

---

## 8. Variabel lingkungan penting (`deployment/.env`)

| Variabel | Arti |
|---|---|
| `DOMAIN` | domain publik tanpa protokol; juga nama file sertifikat |
| `LETSENCRYPT_EMAIL`, `LETSENCRYPT_STAGING` | registrasi & mode sertifikat (1 = staging) |
| `POSTGRES_USER/PASSWORD/DB/PORT` | kredensial database. Password dipakai juga di `DATABASE_URL` → **URL-encode karakter spesial** (`@ : / # ?`) |
| `POSTGRES_SHARED_BUFFERS` dll. | tuning PostgreSQL; sesuaikan dengan RAM VPS (RAM 2 GB → `shared_buffers=512MB`, `effective_cache_size=1GB`) |
| `SHOP_TIMEZONE` | zona waktu toko: menentukan "hari ini" untuk nomor antrian & tutup buku |
| `RUN_MIGRATIONS` | `false` (default) = migrasi ditangani `api-migrate`. Lihat bagian 7 |
| `DB_POOL_MAX` | batas koneksi pool per container api (jangan melebihi `POSTGRES_MAX_CONNECTIONS`) |
| `CORS_ORIGIN` | origin yang diizinkan, dipisah koma. Kosong = semua (mode lokal) |
| `NEXT_PUBLIC_API_URL` | build-arg frontend (default `/api`) — **dibakar saat build**, ubah butuh rebuild |
| `API_IMAGE`, `WEB_IMAGE`, `NGINX_IMAGE`, `API_MIGRATE_IMAGE` | nama/tag image untuk deploy berbasis registry |
| `HTTP_PORT`, `HTTPS_PORT`, `NGINX_CLIENT_MAX_BODY_SIZE` | Nginx. Default `8080`/`8443` supaya tidak bentrok dengan stack lain; di VPS pakai `80`/`443` |
| `WEB_PORT` | akses langsung frontend tanpa TLS (hanya 127.0.0.1), default 3120 |
| `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` | backup |
| `*_CPU_LIMIT`, `*_MEM_LIMIT`, `*_MEM_RESERVATION` | limit resource produksi |

`POSTGRES_PASSWORD` memakai `${...:?}` di compose → kalau kosong, perintah compose
langsung gagal dengan pesan jelas (bukan container yang diam-diam salah konfigurasi).

---

## 9. Troubleshooting

**Halaman menampilkan panel gelap "Gagal memuat …"** — itu memang fitur, bukan crash:
panel itu membaca `/api/health` dan menampilkan host database, status skema, dan status
migrasi. Baca baris `Langkah berikutnya` di panel itu.

**Nginx tidak mau start** — sertifikat belum ada. Jalankan
`./scripts/init-letsencrypt.sh` (script itu membuat sertifikat dummy lebih dulu).
Cek: `docker compose exec nginx nginx -t`.

**Build web gagal: `.next/standalone` tidak ada** — `output: 'standalone'` hilang di
`web/next.config.js`.

**404 di semua `/api/...`** — Nginx meneruskan path apa adanya (tanpa memotong `/api`),
cocok dengan `app.setGlobalPrefix('api')` di `api/src/main.ts`. Kalau API-mu tidak
memakai prefix, ubah di `nginx/templates/app.conf.template`:

    location /api/ {
        proxy_pass http://api_upstream/;   # perhatikan garis miring di akhir

Lalu **restart** container nginx (bukan reload): template di-render ulang hanya saat
container start.

**502 Bad Gateway** — backend belum siap atau crash. `make logs-api`; pastikan
`DATABASE_URL` benar dan `api-migrate` sukses (`docker compose logs api-migrate`).

**`/api/health` menjawab `schema: "missing"`** — tabel belum ada. `make migrate`.

**Perubahan `NEXT_PUBLIC_API_URL` tidak berefek** — variabel itu dibakar saat build:
butuh `./scripts/deploy.sh --build`.

**Let's Encrypt: "too many certificates"** — pakai `LETSENCRYPT_STAGING=1` untuk uji
coba; rate limit produksi ketat (5 sertifikat duplikat per minggu). Untuk mengganti
sertifikat staging menjadi produksi, `--force-renewal` diperlukan (sudah ada di script).

**Port 80/443 sudah dipakai stack lain** — `sudo ss -ltnp | grep :80`; di mesin
pengembangan ubah `HTTP_PORT`/`HTTPS_PORT` di `.env` (default repo ini 8080/8443).
Di VPS produksi jangan, karena Let's Encrypt butuh port 80 dari internet.

**Port container tidak bisa diakses dari host (`docker inspect` → `NetworkSettings.Ports`
kosong, tapi `docker compose config` terlihat benar)** — service-nya berada di network
`internal: true`. Docker **tidak** mem-publish port container di network internal, dan
tidak memberi error. Compose di repo ini memakai `data-net` sebagai bridge biasa, dan
menutup port database di produksi lewat `ports: !reset []`.

**Database "password authentication failed"** — `POSTGRES_PASSWORD` diubah setelah
volume dibuat; password lama masih tersimpan di volume. Reset: `make clean` (data
hilang) atau `ALTER USER` manual.

**Cek cepat kesehatan sistem**

    cd deployment
    docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
    curl -s http://127.0.0.1:${HTTP_PORT}/healthz        # nginx
    curl -s http://127.0.0.1:${HTTP_PORT}/api/health     # API + database + skema

### Masalah khusus versi yang dipakai aplikasi ini

**Build api gagal: `TS5011 … rootDir` atau `TS5101 Option 'baseUrl' is deprecated`** —
TypeScript 6 (dipakai `@nestjs/cli` 12) mewajibkan `rootDir` eksplisit dan menolak
`baseUrl`. Perbaikannya ada di `api/tsconfig.json` (`"rootDir": "./src"`, tanpa
`baseUrl`). Jangan tambahkan `ignoreDeprecations` untuk menutupinya.

**Prisma 7: `The datasource property 'url' is no longer supported`** — sejak Prisma 7
URL tidak lagi di `schema.prisma`. URL migrasi ada di `api/prisma7.config.ts`, runtime
memakai driver adapter (`@prisma/adapter-pg`) di `api/src/prisma/prisma.service.ts`.
Jangan kembalikan `url = env("DATABASE_URL")` ke schema.

**`prisma generate` gagal waktu build image** — generate membaca `prisma7.config.ts`
yang mengambil `DATABASE_URL`. Stage `build` di `api/Dockerfile` sudah menyuntik
`DATABASE_URL` dummy; kalau dihapus, build gagal dengan pesan koneksi.

**Jangan `npx prisma init` di dalam repo** — CLI Prisma 7 juga menulis folder
`.claude/`, `.windsurf/`, `.agents/` dan `skills-lock.json`. Repo ini sudah punya
`schema.prisma` + `prisma7.config.ts`; cukup edit yang ada.

**"drift detected" saat `prisma migrate dev`** — ada tabel di database yang tidak ada
di `schema.prisma`. Repo ini menghindarinya dengan tidak membuat tabel apa pun di
`postgres/init/01-init.sql` (hanya ekstensi); semua tabel dimiliki migrasi Prisma.

**`prisma migrate diff --to-schema-datamodel` tidak dikenal** — di Prisma 7 flag
berbasis schema sudah dihapus dari `migrate diff`; jalur yang bekerja adalah
`prisma migrate dev` terhadap database yang bisa dijangkau.

**`prisma migrate dev --skip-generate` / `migrate dev --name` gagal dengan pesan
usage** — flag `--skip-generate` sudah tidak ada di Prisma 7. Gunakan
`npx prisma migrate dev --name <nama>`.

---

## 10. CI (opsional)

`deployment/.github/workflows/deploy.yml` membangun & mem-push image `api`/`web` ke
GHCR, lalu deploy ke VPS via SSH. Supaya aktif, pindahkan ke root repo (GitHub hanya
membaca `.github/workflows/` di root):

    mkdir -p .github/workflows
    mv deployment/.github/workflows/deploy.yml .github/workflows/deploy.yml

Secret di GitHub: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `DEPLOY_PATH` (mis. `/srv/app`).
Image GHCR memakai `GITHUB_TOKEN` bawaan — package-nya default **privat**, jadi login
sekali di VPS: `echo "$PAT" | docker login ghcr.io -u <username> --password-stdin`,
atau ubah visibility package menjadi public.

---

## 11. Hasil verifikasi

Bagian ini menyebut apa yang **benar-benar dijalankan**, dan apa yang belum bisa
diverifikasi di mesin pengembangan. Kalau kamu mengubah berkas deployment, ulangi
langkah di bawah sebelum mempercayainya.

### Sudah dijalankan (Docker 28.3.2 / Compose v2.39.1, macOS 14.5)

Dijalankan langsung dan hasilnya diperiksa — bukan hanya "config-nya bisa dibaca":

- **Migrasi Prisma dibuat dan diterapkan ke database kosong**: `prisma migrate dev`
  membuat `prisma/migrations/<ts>_init/`; setelah `migrate deploy`, PostgreSQL 17 punya
  tabel `menu_items`, `baristas`, `queues`, `order_items`, `ledger_entries`,
  `_prisma_migrations` dan 6 tipe enum.
- **Build aplikasi**: `npm run build` (api) dan `next build` (web) sukses di host;
  `tsc --noEmit` untuk web tanpa error.
- **Seed berjalan**: 9 menu, 3 barista, 3 antrian, 4 baris pembukuan.
- **`api/scripts/smoke-api.sh` — 71 PASS / 0 FAIL** terhadap API yang benar-benar
  berjalan di atas PostgreSQL. Yang dibuktikan antara lain: nomor antrian naik otomatis,
  total nota dihitung server, 409 untuk nama duplikat & pembayaran ganda & hapus nota
  berbayar, 400 untuk pesanan tanpa item & rentang tanggal terbalik, 404 untuk menu
  tidak ada, alur panggil → selesai → bayar, **invariant nota berbayar ⇢ tepat satu baris
  pendapatan**, void pembayaran mengembalikan nota ke `VOID` dan nota bisa dibayar ulang,
  serta `reconciliation.match = true` (penjualan = buku kas).
- **Dua bug nyata ditemukan lewat uji ini dan sudah diperbaiki**: rentang tanggal terbalik
  dulu menjawab 500 (kini 400), dan uji "panggil barista yang sedang sibuk" mengungkap
  perilaku penugasan barista yang benar (409, bukan penimpaan diam-diam).
- **`docker compose config` bersih** untuk base **dan** base+prod, dan hasil resolusi
  prod membuktikan `ports: !reset []` benar-benar menutup port Postgres: yang tersisa
  hanya 8080/8443 (nginx) dan 3120 (web loopback).
- **Nginx**: image dibangun, template ter-render lewat envsubst sungguhan
  (`server_name example.com`, `client_max_body_size 25m`, `ssl_certificate` mengarah ke
  `/etc/letsencrypt/live/example.com/`), `nginx -t` sukses dengan upstream stub, dan uji
  routing nyata: `/healthz` → **200 "ok"**, `/apa-saja` → **301** ke HTTPS,
  `/api/ping` → **502**, `/_next/static/x.js` → **502**, `/` → **502**, `/favicon.ico` →
  **502** (502 = lokasi cocok dan diteruskan; 404 berarti tidak pernah cocok).
- **Header keamanan terkirim 5/5 di SETIAP lokasi** — termasuk `/_next/static/*` dan
  `/healthz`, yang sebelumnya kehilangan semuanya karena nginx tidak mewariskan
  `add_header` ke location yang mendefinisikannya sendiri. Perbaikan itu
  (`nginx/snippets/security-headers.conf`) diverifikasi ulang setelah diperbaiki.
- **Semua script lolos `bash -n`**; `make help` dan `make check` valid; YAML workflow CI
  ter-parse; script diberi izin eksekusi (`chmod +x`).

### Stack lengkap dijalankan sungguhan (Docker Compose, port 8080/8443/3120)

- **Build image produksi**: `api` (927 MB), `web` (303 MB), `nginx` (93 MB) — semuanya
  sukses dari repo ini apa adanya.
- **`docker compose up -d` dari VOLUME KOSONG**: `postgres/init/01-init.sql` menjalankan
  tugasnya (ekstensi `uuid-ossp`, `pgcrypto`, `citext`, `pg_trgm`, `unaccent` terpasang),
  `api-migrate` membuat seluruh tabel + 6 tipe enum (`All migrations have been successfully
  applied.`), lalu `api` start — urutannya dipaksa oleh `depends_on`. Semua container
  berakhir `healthy`.
- **`make smoke` (lewat Nginx + TLS): 71 PASS / 0 FAIL.**
- **Lewat Nginx**: `http://127.0.0.1:8080/healthz` → 200; `/` → 301 ke HTTPS;
  `https://localhost:8443/healthz` → 200; `https://localhost:8443/api/health` →
  `{"status":"ok","db":"up","schema":"ok"}`.
- **Semua halaman merender data nyata (SSR), bukan placeholder** — dicek dari HTML yang
  dikirim: `/` memuat A-001…A-004 beserta nama item, `/pembukuan` memuat kategori &
  nominal, `/laporan` memuat status kecocokan, `/menu` memuat daftar barista.
- **UI diuji di browser sungguhan** (Chrome via CDP): buka form pesanan → isi nama →
  pilih 2x Kopi Susu Gula Aren (total pratinjau Rp44.000) → simpan → **A-005** dibuat dan
  papan langsung menyegar (menunggu 1→2, belum dibayar 2→3) → pilih barista Rina →
  **Panggil** → status "Dibuat" → **Selesai** → pilih **QRIS** → **Bayar** → status
  "Lunas", pendapatan hari ini naik Rp132.000 → **Rp176.000** (persis +Rp44.000).
  Lalu halaman Pembukuan menampilkan baris pendapatan otomatis untuk A-005 (kategori
  "Penjualan", QRIS, +Rp44.000) dan Laporan menampilkan "Cocok: pendapatan di buku kas
  Rp176.000 sama dengan penjualan nota lunas Rp176.000".
- **Jalur void diuji lewat API**: menghapus baris pendapatan sebuah nota menandai notanya
  `VOID` (bukan terhapus) dan notanya bisa dibayar ulang — total buku kas tetap sama
  dengan nota yang benar-benar lunas.
- **Bug yang ditemukan dan diperbaiki lewat verifikasi ini**:
  1. rentang tanggal terbalik (`?from=` lebih besar dari `?to=`) menjawab **500**; kini **400**
     dengan pesan yang menyebut kedua tanggalnya;
  2. header keamanan hilang di `/_next/static/*` dan `/healthz` karena nginx tidak
     mewariskan `add_header` ke location yang mendefinisikannya sendiri — diperbaiki dengan
     `nginx/snippets/security-headers.conf` dan diverifikasi ulang (kini 5/5 di setiap lokasi);
  3. target `make smoke` memakai HTTP, padahal Nginx di :80 hanya melayani `/healthz` dan
     me-redirect sisanya ke HTTPS — semua request kena 301. Kini target itu memakai HTTPS
     (domain lokal otomatis dapat `-k`).

### Belum bisa diverifikasi di sini

- **Penerbitan sertifikat Let's Encrypt asli** — butuh domain yang sudah menunjuk ke VPS.
  Jalur `DOMAIN=localhost` (self-signed) sudah dijalankan sungguhan di sini; jalur ACME
  belum pernah dijalankan terhadap CA sungguhan dari repo ini.
- **Limit CPU/memori (`deploy.resources`) dan perilaku reboot VPS.**
- **Uji beban / beberapa kasir bersamaan** — penguncian nomor antrian memakai
  `pg_advisory_xact_lock`, tapi belum diuji dengan request paralel nyata.
