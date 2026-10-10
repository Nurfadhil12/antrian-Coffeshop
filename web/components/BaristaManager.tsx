'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/client-api';
import type { BaristaView } from '@/lib/types';

export function BaristaManager({ baristas }: { baristas: BaristaView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', phone: '' });

  async function run(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await fn();
      if (message) setOk(message);
      router.refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal menyimpan.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    const done = await run(
      () =>
        apiSend('POST', '/baristas', {
          name,
          ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
        }),
      `Barista "${name}" ditambahkan.`,
    );
    if (done) setDraft({ name: '', phone: '' });
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Barista ({baristas.length})</h2>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {ok ? <div className="alert success">{ok}</div> : null}

      <form className="inline" onSubmit={add} style={{ marginBottom: 16 }}>
        <label className="field">
          <span className="req">Nama barista</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="mis. Rina"
            required
          />
        </label>
        <label className="field">
          <span>No. HP (opsional)</span>
          <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
        </label>
        <div>
          <button type="submit" className="primary" disabled={busy}>
            Tambah barista
          </button>
        </div>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nama</th>
              <th>No. HP</th>
              <th className="money">Antrian dilayani</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {baristas.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  Belum ada barista.
                </td>
              </tr>
            ) : (
              baristas.map((barista) => (
                <tr key={barista.id} className={barista.active ? undefined : 'row-dim'}>
                  <td>{barista.name}</td>
                  <td className="muted small">{barista.phone ?? '—'}</td>
                  <td className="money">{barista._count?.queues ?? 0}</td>
                  <td>
                    <span className={barista.active ? 'badge PAID' : 'badge CANCELLED'}>
                      {barista.active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <div className="actions">
                      <button
                        type="button"
                        className="tiny"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => apiSend('PATCH', `/baristas/${barista.id}`, { active: !barista.active }),
                            `Barista "${barista.name}" ${barista.active ? 'dinonaktifkan' : 'diaktifkan'}.`,
                          )
                        }
                      >
                        {barista.active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button
                        type="button"
                        className="tiny danger"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Hapus barista "${barista.name}"?`)) return;
                          void run(
                            () => apiSend('DELETE', `/baristas/${barista.id}`),
                            `Barista "${barista.name}" diproses.`,
                          );
                        }}
                      >
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        Barista yang punya riwayat antrian hanya dinonaktifkan, supaya laporan lama tetap
        menyebut namanya.
      </p>
    </div>
  );
}
