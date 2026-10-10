/**
 * Menentukan URL database sesuai lingkungan.
 *
 * - Docker/VPS lokal: DATABASE_URL (lihat deployment/docker-compose.yml)
 * - Platform terkelola (Neon/Railway): beberapa nama env var sekaligus; runtime
 *   memakai koneksi pooled, jadi urutan di bawah ini yang menentukan.
 *
 * Jangan memakai DIRECT_URL/POSTGRES_URL_NON_POOLING di sini: itu untuk perintah
 * CLI Prisma (migrate) yang butuh koneksi langsung, bukan untuk trafik aplikasi.
 */

export type DatabaseUrlSource =
  | 'DATABASE_URL'
  | 'POSTGRES_PRISMA_URL'
  | 'POSTGRES_URL'
  | 'DIRECT_URL'
  | 'placeholder';

export interface DatabaseUrlInfo {
  url: string;
  source: DatabaseUrlSource;
  /** true = tidak ada env var sama sekali; url berisi placeholder (hanya untuk boot) */
  missing: boolean;
  /** host saja (tanpa kredensial) — untuk log/diagnostik */
  host: string;
}

const PLACEHOLDER = 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder';

/**
 * Nama env var yang dicoba, berurutan. Diekspor supaya pesan diagnostik bisa
 * menyebut daftarnya tanpa menyalin ulang (dan tidak pernah menyebut nilainya).
 */
export const DATABASE_URL_NAMES: ReadonlyArray<Exclude<DatabaseUrlSource, 'placeholder'>> = [
  'DATABASE_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'DIRECT_URL',
];

const NAMES = DATABASE_URL_NAMES;

/**
 * Nama env var kandidat → ada/tidak ada. HANYA nama dan boolean; nilainya tidak
 * pernah dikembalikan, sehingga aman ditampilkan di /api/health.
 *
 * Gunanya saat deploy gagal: kalau `urlSource` bernilai "placeholder", pertanyaan
 * berikutnya selalu "env var mana yang sebenarnya sampai ke container ini?" —
 * fungsi ini menjawabnya dalam satu lihat, tanpa membuka log.
 */
export function databaseUrlCandidates(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of NAMES) {
    const value = env[name];
    out[name] = typeof value === 'string' && value.trim().length > 0;
  }
  return out;
}

/** Apakah proses ini berjalan di Vercel? Dipakai untuk memilih pesan perbaikan. */
export function isVercelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === '1' || typeof env.VERCEL_URL === 'string';
}

/** Info URL + asalnya. Tidak pernah melempar — dipakai saat boot aplikasi. */
export function safeDatabaseUrl(env: NodeJS.ProcessEnv = process.env): DatabaseUrlInfo {
  for (const name of NAMES) {
    const value = env[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { url: value, source: name, missing: false, host: hostOf(value) };
    }
  }
  return { url: PLACEHOLDER, source: 'placeholder', missing: true, host: hostOf(PLACEHOLDER) };
}

/** Versi tegas untuk script CLI (seed): gagal cepat dengan pesan jelas. */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const info = safeDatabaseUrl(env);
  if (info.missing) {
    throw new Error(
      'URL database tidak ditemukan. Set DATABASE_URL (atau POSTGRES_PRISMA_URL / POSTGRES_URL ' +
        'kalau memakai database terkelola) di environment.',
    );
  }
  return info.url;
}

/** Ambil host dari connection string tanpa membocorkan user/password. */
export function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).host;
  } catch {
    return '(tidak bisa dibaca)';
  }
}
