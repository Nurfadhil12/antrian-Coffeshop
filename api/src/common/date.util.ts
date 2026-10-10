import { BadRequestException } from '@nestjs/common';

// Helper tanggal: antrian & pembukuan dihitung per hari menurut zona waktu toko,
// bukan UTC. Dipakai bersama oleh service, controller, dan seed.

export const SHOP_TIMEZONE = process.env.SHOP_TIMEZONE ?? 'Asia/Jakarta';

/** "2026-10-10" untuk hari ini menurut zona waktu toko. */
export function todayInShopTz(timeZone: string = SHOP_TIMEZONE, now: Date = new Date()): string {
  // 'en-CA' menghasilkan format YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** "2026-10-10" -> Date pada tengah malam UTC (kolom @db.Date). */
export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Format tanggal harus YYYY-MM-DD, diterima: ${value}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Tanggal tidak valid: ${value}`);
  }
  return date;
}

/** Date (kolom @db.Date) -> "2026-10-10". */
export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Rentang tanggal inklusif untuk query kolom @db.Date.
 * Keduanya dikembalikan supaya bisa dipakai `gte` / `lte` di Prisma.
 *
 * Rentang terbalik adalah kesalahan PEMAKAI (query string salah), bukan kesalahan
 * server — jadi dilempar sebagai BadRequestException (400). Kalau dibiarkan sebagai
 * Error biasa, Nest menjawab 500 dan pemakainya tidak tahu apa yang salah.
 */
export function dateRange(from: string, to: string): { gte: Date; lte: Date } {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (end.getTime() < start.getTime()) {
    throw new BadRequestException(
      `Rentang tanggal terbalik: "to" (${to}) lebih awal dari "from" (${from}).`,
    );
  }
  return { gte: start, lte: end };
}

/** Nomor antrian -> kode tampilan, mis. 7 -> "A-007". */
export function formatQueueCode(number: number): string {
  return `A-${String(number).padStart(3, '0')}`;
}

/** Jumlah hari (inklusif) antara dua tanggal YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  const ms = parseDateOnly(to).getTime() - parseDateOnly(from).getTime();
  return Math.round(ms / 86_400_000) + 1;
}
