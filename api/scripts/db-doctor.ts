/**
 * api/scripts/db-doctor.ts — periksa apakah database tujuan benar-benar berisi
 * skema aplikasi ini.
 *
 * Pakai (dari folder api/):
 *   DATABASE_URL="postgresql://…/neondb?sslmode=require" npx tsx scripts/db-doctor.ts
 *   npm run db:doctor                       # pakai DATABASE_URL dari api/.env
 *
 * Skrip ini READ-ONLY: hanya membaca metadata (information_schema + daftar migrasi).
 * Tidak membuat, mengubah, atau menghapus apa pun — jadi aman dijalankan ke database
 * produksi, dan aman dijalankan sebelum memutuskan langkah perbaikan.
 *
 * Kenapa ada: kegagalan "skema tertinggal" (P2021/P2022) terlihat sama saja entah
 * database-nya kosong, migrasinya gagal separuh, atau database itu ternyata dipakai
 * aplikasi lain. Ketiganya butuh tindakan yang berbeda, dan yang membedakan hanya
 * isi metadata — bukan log.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { hostOf, resolveDatabaseUrl } from '../src/common/database-url';
import { APP_TABLES, probeSchema } from '../src/common/schema-probe';
import { PrismaClient } from '../src/generated/prisma/client';

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK — semua kolom yang dipakai aplikasi ada',
  partial: 'TIDAK COCOK — sebagian kolom hilang',
  missing: 'KOSONG — tidak ada satu pun penanda skema aplikasi',
  unknown: 'TIDAK BISA DIPERIKSA',
};

async function main() {
  const url = resolveDatabaseUrl();
  const pool = new Pool({ connectionString: url });
  pool.on('error', () => undefined);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    console.log('== Pemeriksaan database ==');
    console.log(`   host             : ${hostOf(url)} (kredensial tidak ditampilkan)`);

    let reachable = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (cause) {
      reachable = false;
      console.log(`   koneksi          : GAGAL — ${(cause as Error).message?.split('\n')[0]}`);
    }

    if (!reachable) {
      console.log('\n== Kesimpulan ==');
      console.log('   Database tidak bisa dijangkau. Periksa host/sslmode pada DATABASE_URL');
      console.log('   (Neon butuh ?sslmode=require) dan pastikan project-nya tidak di-suspend.');
      process.exitCode = 1;
      return;
    }

    const probe = await probeSchema(prisma);

    console.log(`   status skema     : ${STATUS_LABEL[probe.status] ?? probe.status}`);
    console.log(`   penanda ada      : ${probe.presentMarkers.length} dari ${probe.presentMarkers.length + probe.missingMarkers.length}`);
    if (probe.missingMarkers.length) {
      console.log(`   penanda HILANG   : ${probe.missingMarkers.join(', ')}`);
    }
    console.log(
      `   tabel aplikasi   : ${APP_TABLES.map((t) => t).join(', ')}`,
    );
    if (probe.foreignTables.length) {
      console.log(`   tabel ASING      : ${probe.foreignTables.join(', ')}  <-- milik aplikasi lain`);
    } else {
      console.log('   tabel asing      : tidak ada');
    }
    console.log(
      `   tabel app ada    : ${probe.presentAppTables.length} dari ${APP_TABLES.length}${
        probe.missingAppTables.length ? ` (belum ada: ${probe.missingAppTables.join(', ')})` : ''
      }`,
    );
    console.log(
      `   _prisma_migrations: ${probe.migrations.hasTable ? `${probe.migrations.appliedCount} migrasi selesai${probe.migrations.lastName ? `, terakhir ${probe.migrations.lastName}` : ''}` : 'tabel tidak ada (migrasi aplikasi ini belum pernah jalan di sini)'}`,
    );
    if (probe.error) console.log(`   error metadata   : ${probe.error}`);

    console.log('\n== Kesimpulan & langkah berikutnya ==');
    if (probe.status === 'ok') {
      console.log('   Skema database sudah cocok dengan aplikasi ini. Tidak ada yang perlu dilakukan.');
    } else if (probe.presentAppTables.length === 0) {
      console.log('   Database ini masih kosong — belum ada satu pun tabel aplikasi ini.');
      console.log('   Ini keadaan yang benar untuk database baru; tinggal dimigrasi:');
      console.log('     npx prisma migrate deploy');
    } else if (probe.foreignTables.length > 0) {
      console.log('   Database ini berisi tabel milik aplikasi LAIN. Jangan migrasi ke sini —');
      console.log('   tabelnya akan bentrok (mis. "queues" versi aplikasi lain sudah ada).');
      console.log('   Buat database terpisah: Neon → New Project (atau New Database di project yang sama),');
      console.log('   arahkan DATABASE_URL ke database baru itu, lalu ulangi langkah migrasi.');
    } else if (probe.migrations.appliedCount === 0) {
      console.log('   Ada tabel yang namanya sama tapi kolomnya bukan milik aplikasi ini, dan');
      console.log('   _prisma_migrations kosong — skema ini dibuat cara lain, bukan oleh migrasi ini.');
      console.log('   Paling aman: pakai database kosong yang baru, lalu migrasi ke sana:');
      console.log('     npx prisma migrate deploy');
    } else {
      console.log('   Skema tertinggal dari aplikasi. Jalankan migrasi ke database ini:');
      console.log('     npx prisma migrate deploy');
    }
    console.log('\n   (skrip ini read-only — tidak ada yang diubah di database)');
    process.exitCode = probe.status === 'ok' ? 0 : 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('[db-doctor] GAGAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
