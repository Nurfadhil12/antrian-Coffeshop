// Helper tampilan: semua nominal disimpan sebagai rupiah bulat di database.

export function rupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString('id-ID')}`;
}

/** Versi ringkas untuk kartu statistik: 1.250.000 -> "Rp1,3 jt". */
export function rupiahShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (abs >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (abs >= 10_000) return `Rp${Math.round(value / 1000)} rb`;
  return rupiah(value);
}

/** "2026-10-10" -> "Sab, 10 Okt 2026" (tanpa pergeseran zona waktu). */
export function longDate(dateOnly: string): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  if (!y || !m || !d) return dateOnly;
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Timestamp ISO -> "14:32" menurut zona waktu toko. */
export function clockTime(iso: string | null, timeZone = 'Asia/Jakarta'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export function shiftDate(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayInShopTz(timeZone = 'Asia/Jakarta'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function firstOfMonth(dateOnly: string): string {
  return `${dateOnly.slice(0, 7)}-01`;
}

export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Tunai',
  QRIS: 'QRIS',
  TRANSFER: 'Transfer',
  E_WALLET: 'E-Wallet',
};

export const CATEGORY_LABEL: Record<string, string> = {
  KOPI: 'Kopi',
  NON_KOPI: 'Non-Kopi',
  MAKANAN: 'Makanan',
  SNACK: 'Snack',
  LAINNYA: 'Lainnya',
};

export const QUEUE_STATUS_LABEL: Record<string, string> = {
  WAITING: 'Menunggu',
  IN_PROGRESS: 'Dibuat',
  DONE: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: 'Belum bayar',
  PAID: 'Lunas',
  VOID: 'Void',
};
