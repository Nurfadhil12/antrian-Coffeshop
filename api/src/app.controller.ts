import { Controller, Get, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
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

    return {
      status: db === 'up' && schema !== 'missing' ? 'ok' : 'degraded',
      db,
      schema,
      migrate,
      latencyMs: Date.now() - startedAt,
      dbSource: this.prisma.urlSource,
      dbHost: this.prisma.urlHost,
      hint: this.healthHint(db, schema, migrate),
      error,
      service: 'coffeeshop-api',
      time: new Date().toISOString(),
    };
  }

  private healthHint(
    db: 'up' | 'down',
    schema: 'ok' | 'missing' | 'unknown',
    migrate: MigrateStatus | null,
  ): string | null {
    if (this.prisma.urlMissing) {
      return 'DATABASE_URL belum di-set di deployment/.env. Isi lalu jalankan: docker compose up -d';
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
        return 'Migrasi otomatis dimatikan (RUN_MIGRATIONS=false) — itu normal di compose, migrasi dijalankan service api-migrate. Cek: docker compose logs api-migrate';
      }
      return 'Tabel belum ada. Jalankan migrasi: make migrate';
    }
    return null;
  }
}
