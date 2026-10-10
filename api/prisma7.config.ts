// api/prisma7.config.ts — konfigurasi Prisma CLI (migrate, generate, db pull).
//
// Prisma 7 tidak lagi membaca `url` dari schema.prisma; URL koneksi untuk CLI
// diambil dari sini. Runtime aplikasi TIDAK memakai file ini — lihat
// src/prisma/prisma.service.ts (driver adapter @prisma/adapter-pg).
//
// Perintah yang benar-benar menyambung ke database: `migrate`, `db pull`, `db push`.
// `generate` hanya butuh sebuah URL (tidak menyambung), karena itu kalau env kosong
// kita pakai placeholder supaya `npm install` (postinstall: prisma generate) dan
// build di Docker tidak gagal.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const PLACEHOLDER = 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder';

function databaseUrl(): string {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.DIRECT_URL,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return found ?? PLACEHOLDER;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl(),
  },
});
