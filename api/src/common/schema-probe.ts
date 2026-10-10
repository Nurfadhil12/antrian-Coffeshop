import type { PrismaService } from '../prisma/prisma.service';

/**
 * Pemeriksaan skema database.
 *
 * Kenapa tidak cukup `SELECT 1` (dan kenapa bahkan `to_regclass('public.queues')`
 * tidak cukup): keduanya bisa HIJAU sementara aplikasi gagal di setiap query.
 * Yang pertama hijau di database kosong; yang kedua hijau kalau tabel `queues`
 * ada tapi kolomnya milik aplikasi lain — gejalanya P2022 ("kolom belum ada"),
 * dan pemeriksaannya melaporkan "ok". Persis kasus yang membingungkan.
 *
 * Karena itu probe ini memeriksa KOLOM yang benar-benar dipakai aplikasi, daftar
 * tabel yang ada, dan isi `_prisma_migrations`. Semuanya hanya metadata — tidak
 * ada isi tabel dan tidak ada kredensial yang dibaca atau dikembalikan.
 */

/** Tabel yang dimiliki aplikasi ini (dibuat oleh migrasi Prisma di api/prisma/migrations). */
export const APP_TABLES: ReadonlyArray<string> = [
  'menu_items',
  'baristas',
  'queues',
  'order_items',
  'ledger_entries',
];

/**
 * Penanda skema: pasangan tabel+kolom yang harus ada. Dipilih dari kolom yang
 * membedakan skema ini dari skema aplikasi antrian lain (mis. versi barbershop),
 * supaya database "tetangga" tidak pernah lolos sebagai skema yang benar.
 */
export const SCHEMA_MARKERS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'queues', column: 'order_type' },
  { table: 'queues', column: 'payment_status' },
  { table: 'queues', column: 'total' },
  { table: 'order_items', column: 'name_snapshot' },
  { table: 'menu_items', column: 'category' },
  { table: 'baristas', column: 'name' },
  { table: 'ledger_entries', column: 'entry_date' },
];

export interface SchemaProbe {
  /** ok = semua penanda ada · partial = sebagian · missing = tidak ada · unknown = query gagal */
  status: 'ok' | 'partial' | 'missing' | 'unknown';
  /** Contoh: "queues.order_type" — kolom yang hilang. */
  missingMarkers: string[];
  /** Penanda yang ada (untuk memastikan probe memang jalan, bukan asal kosong). */
  presentMarkers: string[];
  /**
   * Tabel aplikasi ini yang ada / tidak ada. Membedakan tiga keadaan yang
   * gejalanya sama tapi perbaikannya berbeda: database KOSONG (belum pernah
   * dimigrasi), database berisi tabel aplikasi LAIN, dan skema yang tertinggal.
   */
  presentAppTables: string[];
  missingAppTables: string[];
  /** Tabel di schema `public` yang BUKAN milik aplikasi ini — tanda database dipakai bersama. */
  foreignTables: string[];
  migrations: {
    hasTable: boolean;
    appliedCount: number;
    lastName: string | null;
  };
  error: string | null;
}

const MIGRATIONS_TABLE = '_prisma_migrations';

/** Hasil "belum bisa diperiksa" — dipakai saat database bahkan tidak terjangkau. */
export function unknownSchemaProbe(error: string | null = null): SchemaProbe {
  return {
    status: 'unknown',
    missingMarkers: [],
    presentMarkers: [],
    presentAppTables: [],
    missingAppTables: [],
    foreignTables: [],
    migrations: { hasTable: false, appliedCount: 0, lastName: null },
    error,
  };
}

/**
 * Jalankan pemeriksaan. Tidak pernah melempar: kegagalan query dilaporkan lewat
 * `status: 'unknown'` + `error`, karena fungsi ini dipakai justru saat sistem
 * sedang bermasalah.
 */
export async function probeSchema(prisma: PrismaService): Promise<SchemaProbe> {
  const empty = unknownSchemaProbe();

  let columns: Array<{ table_name: string; column_name: string }>;
  let tables: Array<{ table_name: string }>;

  try {
    // Seluruh daftar (tabel, kolom) di schema public: satu query kecil, tanpa
    // parameter, dan tidak menyentuh satu baris data pun.
    columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `;
    tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
  } catch (cause) {
    return { ...empty, error: (cause as Error).message?.slice(0, 300) ?? 'query gagal' };
  }

  const columnSet = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const presentMarkers = SCHEMA_MARKERS
    .map((marker) => `${marker.table}.${marker.column}`)
    .filter((key) => columnSet.has(key));
  const missingMarkers = SCHEMA_MARKERS
    .map((marker) => `${marker.table}.${marker.column}`)
    .filter((key) => !columnSet.has(key));

  const knownTables = new Set([...APP_TABLES, MIGRATIONS_TABLE]);
  const tableNames = new Set(tables.map((row) => row.table_name));
  const presentAppTables = APP_TABLES.filter((name) => tableNames.has(name));
  const missingAppTables = APP_TABLES.filter((name) => !tableNames.has(name));
  const foreignTables = tables
    .map((row) => row.table_name)
    .filter((name) => !knownTables.has(name))
    .sort();

  let status: SchemaProbe['status'];
  if (missingMarkers.length === 0) status = 'ok';
  else if (presentMarkers.length === 0) status = 'missing';
  else status = 'partial';

  // Isi _prisma_migrations hanya dibaca kalau tabelnya ada.
  let migrations: SchemaProbe['migrations'] = { hasTable: false, appliedCount: 0, lastName: null };
  if (tables.some((row) => row.table_name === MIGRATIONS_TABLE)) {
    try {
      const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at ASC
      `;
      migrations = {
        hasTable: true,
        appliedCount: rows.length,
        lastName: rows.length ? rows[rows.length - 1].migration_name : null,
      };
    } catch {
      migrations = { hasTable: true, appliedCount: 0, lastName: null };
    }
  }

  return {
    status,
    missingMarkers,
    presentMarkers,
    presentAppTables,
    missingAppTables,
    foreignTables,
    migrations,
    error: null,
  };
}
