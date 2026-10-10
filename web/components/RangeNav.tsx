'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** Navigasi rentang tanggal (?from=&to=) untuk halaman Pembukuan & Laporan. */
export function RangeNav({
  from,
  to,
  basePath,
  presets = true,
}: {
  from: string;
  to: string;
  basePath: string;
  presets?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (nextFrom: string, nextTo: string) => {
    startTransition(() => {
      router.push(`${basePath}?from=${nextFrom}&to=${nextTo}`);
    });
  };

  const monthStart = `${to.slice(0, 7)}-01`;

  return (
    <div className="toolbar">
      <label className="field">
        <span>Dari</span>
        <input
          type="date"
          value={from}
          style={{ width: 160 }}
          onChange={(e) => e.target.value && go(e.target.value, to)}
        />
      </label>
      <label className="field">
        <span>Sampai</span>
        <input
          type="date"
          value={to}
          style={{ width: 160 }}
          onChange={(e) => e.target.value && go(from, e.target.value)}
        />
      </label>

      {presets ? (
        <div className="pill-row">
          <button
            type="button"
            className="small"
            disabled={pending}
            onClick={() => go(monthStart, to)}
            title="Mulai dari awal bulan"
          >
            Bulan ini
          </button>
          <button
            type="button"
            className="small"
            disabled={pending}
            onClick={() => go(shift(to, -6), to)}
          >
            7 hari
          </button>
          <button
            type="button"
            className="small"
            disabled={pending}
            onClick={() => go(shift(to, -29), to)}
          >
            30 hari
          </button>
        </div>
      ) : null}

      {pending ? <span className="muted small">memuat…</span> : null}
    </div>
  );
}

function shift(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
