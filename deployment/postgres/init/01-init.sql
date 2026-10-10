-- deployment/postgres/init/01-init.sql
--
-- Dijalankan OTOMATIS oleh image postgres HANYA saat volume pgdata masih kosong
-- (initdb pertama kali). Kalau volume sudah ada, file ini diabaikan — untuk
-- menerapkan ulang: docker compose down -v (HAPUS SEMUA DATA) lalu up lagi.
--
-- PENTING: jangan membuat tabel aplikasi di sini. Semua tabel dimiliki migrasi
-- Prisma (api/prisma/migrations). Kalau init SQL membuat tabel yang tidak ada di
-- schema.prisma, `prisma migrate dev` melaporkan "drift detected" dan menawarkan
-- reset database.
--
-- Di sini hanya hal tingkat database yang tidak bisa dinyatakan lewat schema
-- Prisma: ekstensi PostgreSQL.
--
-- Berjalan sebagai POSTGRES_USER (superuser), database = POSTGRES_DB.

-- uuid_generate_v4(), gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- tipe text case-insensitive (cocok untuk email/username)
CREATE EXTENSION IF NOT EXISTS "citext";

-- index GIN untuk pencarian LIKE/ILIKE & pencarian tanpa aksen
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Timezone default sudah di-set lewat flag container:
--   postgres -c timezone=UTC   (lihat deployment/docker-compose.yml)
