import { Controller, Get, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import {
  DATABASE_URL_NAMES,
  databaseUrlCandidates,
  isVercelRuntime,
} from './common/database-url';
import { PrismaService } from './prisma/prisma.service';

interface MigrateStatus {
  status: 'pending' | 'done' | 'failed' | 'disabled';
  attempts: number;
  error: string | null;
  updatedAt: string;
}

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/ping — sengaja TIDAK menyentuh database.
   *
   * Gunanya saat diagnosa deploy: kalau /api/ping hidup tapi /api/health gagal,
   * masalahnya di database. Kalau keduanya tidak bisa diakses sama sekali,
   * masalahnya di boot/bundling aplikasi atau di Nginx.
   */
  @Get('ping')
  ping() {
    return { pong: true, service: 'coffeeshop-api', time: new Date().toISOString() };
  }

  /**
   * Status migrasi yang ditulis docker-entrypoint.sh saat container start.
   * Dibaca dari berkas, bukan dari database — supaya tetap bisa dibaca walau
   * database belum bisa dijangkau.
   */
  private readMigrateStatus(): MigrateStatus | null {
    const file = process.env.MIGRATE_STATUS_FILE;
    if (!file) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as MigrateStatus;
    } catch {
      return null;
    }
  }

  /**
   * GET /api/health — dipakai healthcheck, smoke test, dan (yang terpenting saat
   * deploy) untuk tahu MENGAPA API tidak bisa melayani: URL database belum di-set,
   * host-nya salah, kredensialnya ditolak, atau skemanya belum dimigrasi.
   * Tidak pernah membocorkan kredensial — hanya host.
   */
  @Get('health')
  async health() {
    const startedAt = Date.now();
    let db: 'up' | 'down' = 'down';
    let error: string | null = null;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch (cause) {
      error = (cause as Error).message?.slice(0, 300) ?? 'query gagal';
      this.logger.error(`Health check: query database gagal — ${error.split('\n')[0]}`);
    }

    // Database bisa "up" (SELECT 1 jalan) sementara tabelnya belum ada — kejadian ini
    // yang membingungkan: health hijau tapi aplikasi gagal dengan P2021.
    let schema: 'ok' | 'missing' | 'unknown' = 'unknown';
    if (db === 'up') {
      try {
        const rows = await this.prisma.$queryRaw<
          { present: string | null }[]
        >`SELECT to_regclass('public.queues')::text AS present`;
        schema = rows[0]?.present ? 'ok' : 'missing';
      } catch {
        schema = 'unknown';
      }
    }

    const migrate = this.readMigrateStatus();

    // Diagnostik environment: HANYA nama env var + boolean, tidak pernah nilainya.
    // Kalau `dbSource` bernilai "placeholder", daftar ini yang menjawab "env var
    // mana yang sebenarnya sampai ke proses ini?" tanpa perlu buka log container.
    const candidates = databaseUrlCandidates();
    const presentNames = Object.entries(candidates)
      .filter(([, present]) => present)
      .map(([name]) => name);
    const onVercel = isVercelRuntime();

    return {
      status: db === 'up' && schema !== 'missing' ? 'ok' : 'degraded',
      db,
      schema,
      migrate,
      latencyMs: Date.now() - startedAt,
      dbSource: this.prisma.urlSource,
      dbHost: this.prisma.urlHost,
      env: {
        databaseUrlCandidates: candidates,
        presentNames,
        missingNames: DATABASE_URL_NAMES.filter((name) => !candidates[name]),
        vercel: onVercel,
        vercelEnv: process.env.VERCEL_ENV ?? null,
        deployment: process.env.VERCEL_URL ?? null,
      },
      hint: this.healthHint(db, schema, migrate, {
        urlMissing: this.prisma.urlMissing,
        presentNames,
        onVercel,
      }),
      error,
      service: 'coffeeshop-api',
      time: new Date().toISOString(),
    };
  }

  private healthHint(
    db: 'up' | 'down',
    schema: 'ok' | 'missing' | 'unknown',
    migrate: MigrateStatus | null,
    ctx: { urlMissing: boolean; presentNames: string[]; onVercel: boolean },
  ): string | null {
    if (ctx.urlMissing) {
      const list = DATABASE_URL_NAMES.join(' / ');
      if (ctx.onVercel) {
        return (
          `Tidak ada satu pun dari ${list} di environment deployment ini. ` +
          'Urutan perbaikannya: (1) project → Storage → Create Database (Postgres/Neon) lalu ' +
          'hubungkan ke project ini; (2) env var baru TIDAK berlaku untuk deployment lama — ' +
          'lakukan Redeploy; (3) kalau database dibuat langsung di neon.tech (bukan lewat Storage), ' +
          'tempel connection string-nya di Settings → Environment Variables dengan scope ' +
          'Production, lalu Redeploy.'
        );
      }
      return (
        'DATABASE_URL belum ada di environment. Di Docker Compose: isi deployment/.env ' +
        '(lihat deployment/README.md). Di Vercel: pasang database dari Marketplace (mis. Neon) ' +
        'atau set DATABASE_URL / POSTGRES_PRISMA_URL / POSTGRES_URL di Project Settings → ' +
        'Environment Variables.'
      );
    }
    if (db === 'down') {
      return 'Host database tidak bisa dijangkau dari container ini. Periksa isi DATABASE_URL (host/port) dan status container db.';
    }
    if (schema === 'missing') {
      if (migrate?.status === 'failed') {
        return 'Migrasi otomatis GAGAL (lihat migrate.error). Setelah diperbaiki, redeploy.';
      }
      if (migrate?.status === 'pending') {
        return 'Migrasi sedang berjalan di latar — muat ulang sebentar lagi.';
      }
      if (migrate?.status === 'disabled') {
        return (
          'Migrasi otomatis dimatikan (RUN_MIGRATIONS=false) — itu normal. Di Docker Compose ' +
          'migrasi dijalankan service api-migrate: docker compose logs api-migrate. Di Vercel ' +
          'Services tidak ada langkah itu, jadi jalankan sekali dari komputer: ' +
          'cd api && DATABASE_URL="<url-langsung>" npx prisma migrate deploy'
        );
      }
      if (ctx.onVercel) {
        return (
          'Tabel belum ada di database ini. Vercel tidak punya langkah migrasi otomatis, jadi ' +
          'jalankan sekali dari komputer: cd api && ' +
          'DATABASE_URL="<url-langsung-dari-neon>" npx prisma migrate deploy'
        );
      }
      return 'Tabel belum ada. Jalankan migrasi: make migrate';
    }
    return null;
  }
}
