'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/client-api';
import { METHOD_LABEL, longDate, rupiah } from '@/lib/format';
import type { LedgerEntryView } from '@/lib/types';

export function LedgerTable({ items }: { items: LedgerEntryView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function remove(entry: LedgerEntryView) {
    const fromQueue = entry.queueId !== null;
    const warning = fromQueue
      ? `Hapus pendapatan dari nota ${entry.queue?.code ?? `#${entry.queueId}`}?\n\n` +
        'Nota itu akan ditandai VOID (belum lunas lagi) supaya total pembukuan tetap sama ' +
        'dengan nota yang benar-benar dibayar. Nota bisa dibayar ulang dari halaman Antrian.'
      : `Hapus baris ${entry.type === 'INCOME' ? 'pemasukan' : 'pengeluaran'} "${entry.category}" (${rupiah(entry.amount)})?`;

    if (!window.confirm(warning)) return;

    setBusyId(entry.id);
    setError(null);
    setOk(null);
    try {
      const result = await apiSend<{ message: string }>('DELETE', `/ledger/${entry.id}`);
      setOk(result.message);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal menghapus.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error ? <div className="alert error">{error}</div> : null}
      {ok ? <div className="alert success">{ok}</div> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Jenis</th>
              <th>Kategori</th>
              <th>Keterangan</th>
              <th>Metode</th>
              <th className="money">Jumlah</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  Belum ada baris pembukuan pada rentang ini.
                </td>
              </tr>
            ) : (
              items.map((entry) => (
                <tr key={entry.id}>
                  <td className="small nowrap">{longDate(entry.entryDate.slice(0, 10))}</td>
                  <td>
                    <span className={entry.type === 'INCOME' ? 'badge INCOME' : 'badge EXPENSE'}>
                      {entry.type === 'INCOME' ? 'Masuk' : 'Keluar'}
                    </span>
                  </td>
                  <td>
                    <span className="badge cat">{entry.category}</span>
                  </td>
                  <td className="small">
                    {entry.queue ? (
                      <span className="muted">
                        <strong>{entry.queue.code}</strong>{' '}
                        {entry.description ? `· ${entry.description}` : ''}
                      </span>
                    ) : (
                      entry.description ?? <span className="muted">—</span>
                    )}
                  </td>
                  <td className="small">
                    {entry.method ? (METHOD_LABEL[entry.method] ?? entry.method) : '—'}
                  </td>
                  <td
                    className="money"
                    style={{ color: entry.type === 'INCOME' ? 'var(--ok)' : 'var(--danger)' }}
                  >
                    {entry.type === 'INCOME' ? '+' : '−'}
                    {rupiah(entry.amount)}
                  </td>
                  <td className="actions-cell">
                    <button
                      type="button"
                      className="tiny danger"
                      disabled={busyId === entry.id}
                      onClick={() => void remove(entry)}
                      title={
                        entry.queueId !== null
                          ? 'Membatalkan pendapatan nota ini (nota ditandai VOID)'
                          : 'Hapus baris ini'
                      }
                    >
                      {busyId === entry.id ? '…' : 'Hapus'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
