'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/client-api';
import { CATEGORY_LABEL, rupiah } from '@/lib/format';
import type { MenuCategory, MenuItemView } from '@/lib/types';

const CATEGORIES: MenuCategory[] = ['KOPI', 'NON_KOPI', 'MAKANAN', 'SNACK', 'LAINNYA'];

export function MenuManager({ menu }: { menu: MenuItemView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', category: 'KOPI' as MenuCategory, price: '' });

  async function run(fn: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await fn();
      if (successMessage) setOk(successMessage);
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
    const done = await run(
      () =>
        apiSend('POST', '/menu', {
          name: draft.name.trim(),
          category: draft.category,
          price: Number(draft.price || 0),
        }),
      `Menu "${draft.name.trim()}" ditambahkan.`,
    );
    if (done) setDraft({ name: '', category: 'KOPI', price: '' });
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Menu ({menu.length})</h2>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {ok ? <div className="alert success">{ok}</div> : null}

      <form className="inline" onSubmit={add} style={{ marginBottom: 16 }}>
        <label className="field">
          <span className="req">Nama menu</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="mis. Kopi Susu Gula Aren"
            required
          />
        </label>
        <label className="field">
          <span>Kategori</span>
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value as MenuCategory })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="req">Harga (Rp)</span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            placeholder="22000"
            required
          />
        </label>
        <div>
          <button type="submit" className="primary" disabled={busy}>
            Tambah menu
          </button>
        </div>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nama</th>
              <th>Kategori</th>
              <th className="money">Harga</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {menu.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  Belum ada menu.
                </td>
              </tr>
            ) : (
              menu.map((item) => (
                <MenuRow key={item.id} item={item} busy={busy} run={run} />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        Menu yang sudah pernah dipesan tidak bisa dihapus permanen — hanya dinonaktifkan, supaya
        riwayat nota &amp; laporan lama tetap utuh.
      </p>
    </div>
  );
}

function MenuRow({
  item,
  busy,
  run,
}: {
  item: MenuItemView;
  busy: boolean;
  run: (fn: () => Promise<unknown>, successMessage?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: item.name,
    category: item.category,
    price: String(item.price),
  });

  if (editing) {
    return (
      <tr>
        <td>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </td>
        <td>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as MenuCategory })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c] ?? c}
              </option>
            ))}
          </select>
        </td>
        <td className="money">
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            style={{ width: 110, textAlign: 'right' }}
          />
        </td>
        <td>
          <span className={item.active ? 'badge PAID' : 'badge CANCELLED'}>
            {item.active ? 'Aktif' : 'Nonaktif'}
          </span>
        </td>
        <td className="actions-cell">
          <div className="actions">
            <button
              type="button"
              className="tiny primary"
              disabled={busy}
              onClick={async () => {
                const done = await run(
                  () =>
                    apiSend('PATCH', `/menu/${item.id}`, {
                      name: form.name.trim(),
                      category: form.category,
                      price: Number(form.price || 0),
                    }),
                  `Menu "${form.name.trim()}" diperbarui.`,
                );
                if (done) setEditing(false);
              }}
            >
              Simpan
            </button>
            <button
              type="button"
              className="tiny ghost"
              onClick={() => {
                setForm({ name: item.name, category: item.category, price: String(item.price) });
                setEditing(false);
              }}
            >
              Batal
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={item.active ? undefined : 'row-dim'}>
      <td>{item.name}</td>
      <td>
        <span className="badge cat">{CATEGORY_LABEL[item.category] ?? item.category}</span>
      </td>
      <td className="money">{rupiah(item.price)}</td>
      <td>
        <span className={item.active ? 'badge PAID' : 'badge CANCELLED'}>
          {item.active ? 'Aktif' : 'Nonaktif'}
        </span>
      </td>
      <td className="actions-cell">
        <div className="actions">
          <button type="button" className="tiny" onClick={() => setEditing(true)} disabled={busy}>
            Ubah
          </button>
          <button
            type="button"
            className="tiny"
            disabled={busy}
            onClick={() =>
              void run(
                () => apiSend('PATCH', `/menu/${item.id}`, { active: !item.active }),
                `Menu "${item.name}" ${item.active ? 'dinonaktifkan' : 'diaktifkan'}.`,
              )
            }
          >
            {item.active ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
          <button
            type="button"
            className="tiny danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Hapus menu "${item.name}"?`)) return;
              void run(async () => {
                const result = await apiSend<{ deleted: boolean; message: string }>(
                  'DELETE',
                  `/menu/${item.id}`,
                );
                return result;
              }, `Menu "${item.name}" diproses.`);
            }}
          >
            Hapus
          </button>
        </div>
      </td>
    </tr>
  );
}
