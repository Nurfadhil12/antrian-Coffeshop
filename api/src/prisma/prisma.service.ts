import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { safeDatabaseUrl, type DatabaseUrlInfo, type DatabaseUrlSource } from '../common/database-url';
import { PrismaClient } from './prisma-client';

/**
 * Prisma 7 memakai driver adapter (bukan lagi URL di schema.prisma), jadi koneksi
 * dipegang oleh pg.Pool dan diserahkan ke Prisma lewat PrismaPg.
 *
 * Dua keputusan penting:
 *
 * 1. Pool dibatasi (DB_POOL_MAX) — PostgreSQL punya max_connections terbatas
 *    (lihat POSTGRES_MAX_CONNECTIONS di compose). Satu container API tidak boleh
 *    menghabiskan seluruh kuota koneksi.
 *
 * 2. **Boot tidak pernah gagal karena database.** URL yang hilang hanya
 *    menghasilkan placeholder + log, dan `$connect()` yang gagal ditangkap.
 *    Kalau tidak, satu env var yang kurang membuat seluruh service crash dan
 *    pengguna hanya melihat "connection refused" dari Nginx — tanpa petunjuk.
 *    Dengan begini `/api/health` tetap bisa diakses dan melaporkan penyebabnya.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly info: DatabaseUrlInfo;
  private readonly pool: Pool;

  /** Asal URL: DATABASE_URL / POSTGRES_PRISMA_URL / POSTGRES_URL / DIRECT_URL / placeholder. */
  readonly urlSource: DatabaseUrlSource;
  /** Host database (tanpa kredensial) untuk diagnostik. */
  readonly urlHost: string;
  /** Nama database (tanpa kredensial) — host saja tidak membedakan dua database
   *  dalam satu project Neon. */
  readonly urlDatabase: string;
  readonly urlMissing: boolean;

  constructor() {
    // Semua dihitung sebagai variabel lokal dulu: 'this' belum boleh dipakai
    // sebelum super(), karena PrismaClient adalah kelas induk.
    const info = safeDatabaseUrl();
    const pool = new Pool({
      connectionString: info.url,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10_000),
    });

    // WAJIB ada. node-postgres memancarkan event 'error' untuk klien idle yang
    // bermasalah (database restart, koneksi diputus). Tanpa listener, event itu
    // menjadi unhandled error dan MEMATIKAN proses API — gejalanya container
    // restart-loop tanpa error aplikasi yang bisa dibaca. Dengan listener ini
    // kegagalan koneksi hanya tercatat di log dan /api/health melaporkannya.
    pool.on('error', (error) => {
      this.logger.error(`Koneksi database bermasalah (dari pool): ${error.message}`);
    });

    super({ adapter: new PrismaPg(pool) });

    this.info = info;
    this.pool = pool;
    this.urlSource = info.source;
    this.urlHost = info.host;
    this.urlDatabase = info.database;
    this.urlMissing = info.missing;

    if (info.missing) {
      this.logger.error(
        'DATABASE_URL tidak ditemukan (juga POSTGRES_PRISMA_URL/POSTGRES_URL). ' +
          'API tetap hidup, tapi semua query database akan gagal — periksa deployment/.env ' +
          'lalu jalankan: docker compose up -d',
      );
    } else {
      this.logger.log(`Database dari ${info.source} → ${info.host}/${info.database}`);
    }
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Terhubung ke PostgreSQL');
    } catch (error) {
      // Jangan jatuhkan proses: biarkan /api/health melaporkan masalahnya.
      this.logger.error(`Gagal menyambung ke PostgreSQL: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect().catch(() => undefined);
    await this.pool.end().catch(() => undefined);
  }
}
