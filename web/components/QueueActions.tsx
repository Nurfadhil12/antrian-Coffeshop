'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/client-api';
import { rupiah } from '@/lib/format';
import type { BaristaView, PaymentMethod, QueueView } from '@/lib/types';

const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Tunai' },
  { value: 'QRIS', label: 'QRIS' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'E_WALLET', label: 'E-Wallet' },
];

/**
 * Tombol aksi satu nota. Aturannya sengaja mengikuti aturan API, supaya tombol yang
 * tampil tidak pernah ditolak 409:
 *   WAITING                → Panggil · Batalkan · Hapus
 *   IN_PROGRESS            → Selesai · Batalkan
 *   belum bayar (apa pun)  → Bayar
 *   PAID                   → tidak ada aksi (pembatalan lewat halaman Pembukuan)
 */
export function QueueActions({
  queue,
  baristas,
}: {
  queue: QueueView;
  baristas: BaristaView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [baristaId, setBaristaId] = useState(String(queue.baristaId ?? ''));

  const active = baristas.filter((b) => b.active);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (cause) {
      setError(`${label}: ${cause instanceof Error ? cause.message : 'gagal'}`);
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run('Panggil', () =>
      apiSend('POST', `/queues/${queue.id}/start`, baristaId ? { baristaId: Number(baristaId) } : {}),
    );
  const finish = () => run('Selesai', () => apiSend('POST', `/queues/${queue.id}/finish`));
  const cancel = () => run('Batalkan', () => apiSend('POST', `/queues/${queue.id}/cancel`));
  const remove = () => {
    if (!window.confirm(`Hapus nota ${queue.code} (${queue.customerName})?`)) return;
    void run('Hapus', () => apiSend('DELETE', `/queues/${queue.id}`));
  };
  const pay = () =>
    run('Bayar', () =>
      apiSend('POST', `/queues/${queue.id}/pay`, { paymentMethod: method }),
    );

  return (
    <div className="actions">
      {queue.status === 'WAITING' ? (
        <>
          {active.length > 1 ? (
            <select
              value={baristaId}
              onChange={(e) => setBaristaId(e.target.value)}
              style={{ width: 130 }}
              disabled={busy}
            >
              <option value="">pilih barista…</option>
              {active.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className="small info" onClick={start} disabled={busy}>
            Panggil
          </button>
        </>
      ) : null}

      {queue.status === 'IN_PROGRESS' ? (
        <button type="button" className="small ok" onClick={finish} disabled={busy}>
          Selesai
        </button>
      ) : null}

      {queue.paymentStatus !== 'PAID' && queue.status !== 'CANCELLED' ? (
        <>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            style={{ width: 108 }}
            disabled={busy}
            title="Metode pembayaran"
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="small primary"
            onClick={pay}
            disabled={busy}
            title={`Bayar ${rupiah(queue.total)} dan catat ke pembukuan`}
          >
            Bayar
          </button>
        </>
      ) : null}

      {queue.status === 'WAITING' || queue.status === 'IN_PROGRESS' ? (
        <button type="button" className="small danger" onClick={cancel} disabled={busy}>
          Batalkan
        </button>
      ) : null}

      {queue.paymentStatus !== 'PAID' ? (
        <button type="button" className="small ghost" onClick={remove} disabled={busy}>
          Hapus
        </button>
      ) : null}

      {error ? <span className="small" style={{ color: 'var(--danger)' }}>{error}</span> : null}
    </div>
  );
}
