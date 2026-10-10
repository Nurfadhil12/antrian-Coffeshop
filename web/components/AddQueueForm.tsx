'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { apiSend } from '@/lib/client-api';
import { CATEGORY_LABEL, rupiah } from '@/lib/format';
import type { BaristaView, MenuItemView, OrderType, QueueView } from '@/lib/types';

interface Line {
  qty: number;
  note: string;
}

/**
 * Dua bentuk baris pesanan yang diterima API: dari master menu, atau item lepas
 * (nama + harga sendiri). Ditulis sebagai union supaya TypeScript ikut menjaga
 * bentuk payload-nya, bukan sekadar dikirim apa adanya.
 */
type ItemPayload =
  | { menuItemId: number; qty: number; note?: string }
  | { name: string; unitPrice: number; qty: number };

/**
 * Form pesanan baru = sekaligus pembuatan nomor antrian.
 *
 * Dua hal yang sengaja dibuat eksplisit:
 *  - harga diambil dari MASTER MENU di server (bukan dari state browser), jadi total
 *    yang tampil di sini hanya pratinjau — angka final selalu dari respons API;
 *  - item di luar menu bisa ditambahkan satu baris (mis. titipan) dengan nama & harga
 *    sendiri, sesuai dukungan API.
 */
export function AddQueueForm({
  date,
  menu,
  baristas,
}: {
  date: string;
  menu: MenuItemView[];
  baristas: BaristaView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');
  const [tableNumber, setTableNumber] = useState('');
  const [note, setNote] = useState('');
  const [baristaId, setBaristaId] = useState('');
  const [discount, setDiscount] = useState('0');
  const [lines, setLines] = useState<Record<number, Line>>({});
  const [custom, setCustom] = useState({ name: '', price: '', qty: '1' });

  const activeMenu = useMemo(() => menu.filter((item) => item.active), [menu]);

  const previewSubtotal = useMemo(() => {
    const fromMenu = Object.entries(lines).reduce((sum, [id, line]) => {
      const item = activeMenu.find((m) => m.id === Number(id));
      return sum + (item ? item.price * line.qty : 0);
    }, 0);
    const customTotal =
      custom.name.trim() && custom.price.trim()
        ? Number(custom.price || 0) * Number(custom.qty || 1)
        : 0;
    return fromMenu + customTotal;
  }, [lines, activeMenu, custom]);

  const previewTotal = Math.max(0, previewSubtotal - Number(discount || 0));

  function bump(id: number, delta: number) {
    setLines((prev) => {
      const current = prev[id] ?? { qty: 0, note: '' };
      const qty = Math.max(0, current.qty + delta);
      const next = { ...prev };
      if (qty === 0) delete next[id];
      else next[id] = { ...current, qty };
      return next;
    });
  }

  function reset() {
    setCustomerName('');
    setCustomerPhone('');
    setOrderType('DINE_IN');
    setTableNumber('');
    setNote('');
    setBaristaId('');
    setDiscount('0');
    setLines({});
    setCustom({ name: '', price: '', qty: '1' });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setOk(null);

    const items: ItemPayload[] = Object.entries(lines).map(([id, line]) => ({
      menuItemId: Number(id),
      qty: line.qty,
      ...(line.note.trim() ? { note: line.note.trim() } : {}),
    }));

    if (custom.name.trim() && custom.price.trim()) {
      items.push({
        name: custom.name.trim(),
        unitPrice: Number(custom.price),
        qty: Number(custom.qty || 1),
      });
    }

    if (items.length === 0) {
      setError('Pilih minimal satu item menu (atau isi item tambahan).');
      return;
    }

    setBusy(true);
    try {
      const created = await apiSend<QueueView>('POST', '/queues', {
        customerName: customerName.trim(),
        ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
        orderType,
        ...(tableNumber.trim() ? { tableNumber: tableNumber.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(baristaId ? { baristaId: Number(baristaId) } : {}),
        queueDate: date,
        discount: Number(discount || 0),
        items,
      });
      setOk(`Antrian ${created.code} dibuat — ${created.customerName} (${rupiah(created.total)}).`);
      reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal membuat antrian.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>Pesanan baru</h2>
          <button type="button" className="primary" onClick={() => setOpen(true)}>
            + Tambah antrian
          </button>
        </div>
        {ok ? <div className="alert success">{ok}</div> : null}
        <p className="muted small" style={{ margin: 0 }}>
          Nomor antrian dibuat otomatis berurutan untuk tanggal ini ({date}).
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Pesanan baru</h2>
        <button
          type="button"
          className="small ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Tutup
        </button>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {ok ? <div className="alert success">{ok}</div> : null}

      <form onSubmit={submit}>
        <div className="inline" style={{ marginBottom: 16 }}>
          <label className="field">
            <span className="req">Nama pelanggan</span>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="mis. Budi"
              required
            />
          </label>

          <label className="field">
            <span>No. HP (opsional)</span>
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
          </label>

          <label className="field">
            <span>Tipe pesanan</span>
            <select value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)}>
              <option value="DINE_IN">Makan/minum di tempat</option>
              <option value="TAKE_AWAY">Dibungkus</option>
            </select>
          </label>

          {orderType === 'DINE_IN' ? (
            <label className="field">
              <span>No. meja (opsional)</span>
              <input value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} />
            </label>
          ) : null}

          <label className="field">
            <span>Barista (opsional)</span>
            <select value={baristaId} onChange={(e) => setBaristaId(e.target.value)}>
              <option value="">— belum ditentukan —</option>
              {baristas
                .filter((b) => b.active)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>

          <label className="field">
            <span>Diskon (Rp)</span>
            {/* step={1}, bukan step={500}: lihat catatan di LedgerForm.tsx — dengan
                min, step menentukan nilai yang BOLEH, bukan sekadar besar loncatan
                tombol panah. */}
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Catatan (opsional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. gula terpisah"
            />
          </label>
        </div>

        <h3 className="small muted" style={{ marginBottom: 8 }}>
          Pilih menu
        </h3>
        {activeMenu.length === 0 ? (
          <div className="alert info">
            Belum ada menu aktif. Tambahkan dulu di halaman <strong>Menu &amp; Barista</strong>.
          </div>
        ) : (
          <div className="item-grid">
            {activeMenu.map((item) => {
              const picked = lines[item.id]?.qty ?? 0;
              return (
                <div
                  key={item.id}
                  className={picked > 0 ? 'item-chip picked' : 'item-chip'}
                  onClick={() => bump(item.id, 1)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') bump(item.id, 1);
                  }}
                >
                  <div>
                    <div className="nm">{item.name}</div>
                    <div className="pr">
                      {rupiah(item.price)} · {CATEGORY_LABEL[item.category] ?? item.category}
                    </div>
                  </div>
                  <span className="badge cat">{picked > 0 ? `${picked}x` : '+'}</span>
                </div>
              );
            })}
          </div>
        )}

        {Object.keys(lines).length > 0 ? (
          <div className="basket">
            {Object.entries(lines).map(([id, line]) => {
              const item = activeMenu.find((m) => m.id === Number(id));
              if (!item) return null;
              return (
                <div key={id} className="basket-row">
                  <span className="nm">{item.name}</span>
                  <div className="qty-box">
                    <button type="button" className="tiny" onClick={() => bump(item.id, -1)}>
                      −
                    </button>
                    <input readOnly value={line.qty} />
                    <button type="button" className="tiny" onClick={() => bump(item.id, 1)}>
                      +
                    </button>
                  </div>
                  <span className="money nowrap">{rupiah(item.price * line.qty)}</span>
                  <button
                    type="button"
                    className="tiny danger"
                    onClick={() =>
                      setLines((prev) => {
                        const next = { ...prev };
                        delete next[item.id];
                        return next;
                      })
                    }
                  >
                    hapus
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="basket">
          <div className="small muted" style={{ marginBottom: 6 }}>
            Item di luar menu (opsional — untuk titipan / permintaan khusus)
          </div>
          <div className="inline">
            <label className="field">
              <span>Nama item</span>
              <input
                value={custom.name}
                onChange={(e) => setCustom({ ...custom, name: e.target.value })}
                placeholder="mis. Extra Shot"
              />
            </label>
            <label className="field">
              <span>Harga satuan (Rp)</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={custom.price}
                onChange={(e) => setCustom({ ...custom, price: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Jumlah</span>
              <input
                type="number"
                min={1}
                max={99}
                value={custom.qty}
                onChange={(e) => setCustom({ ...custom, qty: e.target.value })}
              />
            </label>
          </div>
        </div>

        <div className="total-line">
          <span>
            Pratinjau total
            {Number(discount) > 0 ? (
              <span className="muted small"> (subtotal {rupiah(previewSubtotal)})</span>
            ) : null}
          </span>
          <span>{rupiah(previewTotal)}</span>
        </div>

        <div className="actions" style={{ marginTop: 14 }}>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan pesanan'}
          </button>
          <button type="button" onClick={reset} disabled={busy}>
            Kosongkan
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Total yang tersimpan dihitung ulang di server memakai harga master menu.
        </p>
      </form>
    </div>
  );
}
