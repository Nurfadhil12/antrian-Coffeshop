// Pemanggil API untuk Server Component (Next server -> API NestJS).
//
// Base URL diambil dari environment, berurutan:
//   1. INTERNAL_API_URL — diisi otomatis oleh BINDING Vercel Services (lihat
//      vercel.json: binding "web" -> service "api"). JANGAN di-set manual di
//      Project Settings; Vercel yang membuat nilainya, dan nilainya mengikuti
//      deployment (preview menuju preview).
//   2. Docker Compose mengisinya lewat docker-compose.yml (http://api:3000).
//   3. Di lokal tanpa env: http://localhost:3220 (API `npm run start:dev`).
//
// Binding hanya tersedia saat RUNTIME di function, bukan saat build dan bukan di
// middleware — karena itu fungsi ini dipakai komponen server (RSC), bukan middleware.

import 'server-only';

import type { HealthView } from './types';

const ORIGIN = (process.env.INTERNAL_API_URL ?? 'http://localhost:3220').replace(/\/$/, '');
const PREFIX = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string): Promise<T> {
  const url = `${ORIGIN}${PREFIX}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new ApiError(`Tidak bisa menghubungi API (${url}).`, 0);
  }

  const text = await res.text();

  // Respons non-JSON = hampir selalu halaman error dari proxy/platform, bukan dari
  // aplikasi kita. Tampilkan status + potongan body supaya penyebabnya kelihatan,
  // jangan disembunyikan di balik error JSON.parse.
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 200);
      throw new ApiError(
        `API menjawab dengan ${res.status} dan isi non-JSON (${url}): "${snippet}". ` +
          'Periksa log service api dan pastikan DATABASE_URL sudah di-set.',
        res.status,
      );
    }
  }

  if (!res.ok) {
    throw new ApiError(extractMessage(data, res.status), res.status);
  }
  return data as T;
}

function extractMessage(data: unknown, status: number): string {
  const body = data as { message?: unknown; code?: unknown } | null;
  const message = body?.message;

  // Sertakan kode error Prisma (mis. P2021) supaya penyebabnya bisa dicari langsung.
  const code = typeof body?.code === 'string' ? ` (kode ${body.code})` : '';

  if (Array.isArray(message)) return `${message.join(', ')}${code}`;
  if (typeof message === 'string') return `${message}${code}`;
  return `Permintaan gagal (HTTP ${status})${code}.`;
}

export const apiGet = request;

/**
 * Ambil data + status kesehatan API sekaligus.
 *
 * Kalau API gagal, halaman TIDAK di-crash: datanya null dan komponen
 * <ApiDiagnostics> menampilkan isi /api/health supaya penyebabnya terbaca
 * (mis. "Tabel belum ada — jalankan migrasi") tanpa perlu buka log container.
 */
export async function loadWithHealth<T>(
  path: string,
): Promise<{ data: T | null; error: string | null; health: HealthView | null }> {
  try {
    const data = await request<T>(path);
    return { data, error: null, health: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal memuat data.';
    let health: HealthView | null = null;
    try {
      health = await request<HealthView>('/health');
    } catch {
      health = null;
    }
    return { data: null, error: message, health };
  }
}
