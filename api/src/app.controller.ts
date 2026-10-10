import { Controller, Get, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import {
  DATABASE_URL_NAMES,
  databaseUrlCandidates,
  isVercelRuntime,
} from './common/database-url';
import {
  probeSchema,
  unknownSchemaProbe,
  type SchemaProbe,
} from './common/schema-probe';
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

    // Database bisa "up" (SELECT 1 jalan) sementara SKEMANYA tidak cocok — kejadian ini
    // yang membingungkan: health hijau tapi aplikasi gagal dengan P2021/P2022.
    // Probe-nya memeriksa kolom yang benar-benar dipakai aplikasi, bukan sekadar
    // keberadaan tabelnya (lihat common/schema-probe.ts untuk alasannya).
    const schemaProbe = db === 'up' ? await probeSchema(this.prisma) : unknownSchemaProbe();
    const schema = schemaProbe.status;

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
      status: db === 'up' && schema === 'ok' ? 'ok' : 'degraded',
      db,
      schema,
      schemaDetail: schemaProbe,
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
      hint: this.healthHint(db, schemaProbe, migrate, {
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
    probe: SchemaProbe,
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
      return 'Host database tidak bisa dijangkau dari container ini. Periksa isi DATABASE_URL (host/port) dan status database.';
    }

    // ── Skema TIDAK cocok: kasus yang paling menyesatkan, karena "db: up" hijau ──
    if (probe.status === 'partial' || probe.status === 'missing') {
      const missing = probe.missingMarkers.slice(0, 4).join(', ');
      const foreign = probe.foreignTables;

      // Konteks migrasi ditambahkan ke setiap pesan di cabang ini: "disabled"
      // menjelaskan mengapa tidak ada migrasi yang berjalan sendiri.
      const migrateNote =
        migrate?.status === 'failed'
          ? ` Migrasi otomatis terakhir GAGAL: ${migrate.error ?? 'lihat migrate.error'}.`
          : migrate?.status === 'pending'
            ? ' Migrasi otomatis sedang berjalan di latar — muat ulang sebentar lagi.'
            : migrate?.status === 'disabled'
              ? ' (Migrasi otomatis memang dimatikan: RUN_MIGRATIONS=false.)'
              : '';

      // Paling sering terjadi lebih dulu: database baru yang belum pernah dimigrasi.
      if (probe.presentAppTables.length === 0) {
        return (
          'Database ini belum punya satu pun tabel aplikasi ini (masih kosong), jadi memang belum ' +
          'dimigrasi. Jalankan sekali dari komputer: cd api && ' +
          'DATABASE_URL="<url-langsung>" npx prisma migrate deploy' +
          migrateNote
        );
      }

      if (foreign.length > 0) {
        return (
          `Skema database ini TIDAK cocok dengan aplikasi (kolom hilang: ${missing}), dan ` +
          `database ini juga berisi tabel milik aplikasi lain: ${foreign.join(', ')}. ` +
          'Kemungkinan besar ini database yang dipakai bersama. JANGAN menjalankan migrasi ke ' +
          'database ini — buat database terpisah di Neon (New Project, atau New Database di project ' +
          'yang sama), arahkan DATABASE_URL ke database baru itu, lalu migrasi ke sana.' +
          migrateNote
        );
      }

      if (probe.migrations.appliedCount === 0) {
        return (
          `Tabel aplikasi sudah ada tapi kolomnya tidak cocok (hilang: ${missing}), dan ` +
          '_prisma_migrations tidak mencatat satu pun migrasi yang selesai — jadi skema ini dibuat ' +
          'cara lain, bukan oleh migrasi aplikasi ini. Pakai database kosong yang baru, lalu: ' +
          'cd api && DATABASE_URL="<url-langsung>" npx prisma migrate deploy' +
          migrateNote
        );
      }

      return (
        `Skema database tertinggal dari aplikasi (kolom hilang: ${missing}). Jalankan migrasi ke ` +
        'database ini: cd api && DATABASE_URL="<url-langsung>" npx prisma migrate deploy ' +
        '(pemeriksaan lengkap: npx tsx scripts/db-doctor.ts)' +
        migrateNote
      );
    }

    if (probe.status === 'unknown') {
      return 'Skema database belum bisa diperiksa (query metadata gagal). Lihat schemaDetail.error.';
    }

    // Sampai sini skema sudah cocok. Kalau laporan migrasi otomatis menunjukkan
    // masalah, tetap sebutkan — supaya masalah yang pernah terjadi tidak hilang
    // dari pandangan hanya karena hasil akhirnya sudah benar.
    if (migrate?.status === 'failed') {
      return `Skema sudah cocok, tapi laporan migrasi otomatis terakhir GAGAL: ${
        migrate.error ?? 'lihat migrate.error'
      }. Perbaiki penyebabnya lalu redeploy.`;
    }

    return null;
  }
}
