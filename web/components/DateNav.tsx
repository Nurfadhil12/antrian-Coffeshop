'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { longDate, shiftDate, todayInShopTz } from '@/lib/format';

/**
 * Navigasi tanggal lewat query string (?date=YYYY-MM-DD) supaya Server Component
 * memuat ulang data untuk tanggal itu. `router.refresh()` tidak dipakai di sini —
 * mengubah query string sudah cukup dan tetap menyimpan riwayat browser.
 */
export function DateNav({ date, basePath }: { date: string; basePath: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = todayInShopTz();
  const isToday = date === today;

  const go = (next: string) => {
    startTransition(() => {
      router.push(`${basePath}?date=${next}`);
    });
  };

  return (
    <div className="date-nav">
      <button type="button" className="small" onClick={() => go(shiftDate(date, -1))} disabled={pending}>
        ← Hari sebelumnya
      </button>

      <input
        type="date"
        value={date}
        style={{ width: 170 }}
        onChange={(event) => {
          if (event.target.value) go(event.target.value);
        }}
      />

      <button type="button" className="small" onClick={() => go(shiftDate(date, 1))} disabled={pending}>
        Hari berikutnya →
      </button>

      {!isToday ? (
        <button type="button" className="small primary" onClick={() => go(today)} disabled={pending}>
          Hari ini
        </button>
      ) : (
        <span className="pill active">Hari ini</span>
      )}

      <span className="muted small">{longDate(date)}</span>
      {pending ? <span className="muted small">memuat…</span> : null}
    </div>
  );
}
