"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/lib/client-api";
import type { LedgerType, PaymentMethod } from "@/lib/types";

const EXPENSE_CATEGORIES = [
  "Bahan Baku",
  "Gaji",
  "Sewa",
  "Operasional",
  "Peralatan",
  "Promosi",
  "Lain-lain",
];

const INCOME_CATEGORIES = ["Penjualan Lain", "Catering", "Event", "Lain-lain"];

const METHODS: Array<{ value: PaymentMethod | ""; label: string }> = [
  { value: "", label: "— tidak dicatat —" },
  { value: "CASH", label: "Tunai" },
  { value: "QRIS", label: "QRIS" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "E_WALLET", label: "E-Wallet" },
];

/**
 * Input manual buku kas.
 *
 * Pemasukan penjualan TIDAK diinput di sini — itu dibuat otomatis saat nota dibayar
 * di halaman Antrian, supaya angka penjualan tidak pernah dobel.
 */
export function LedgerForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [type, setType] = useState<LedgerType>("EXPENSE");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("CASH");
  const [entryDate, setEntryDate] = useState(defaultDate);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const suggestions =
    type === "EXPENSE" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await apiSend("POST", "/ledger", {
        type,
        category: category.trim(),
        amount: Number(amount),
        ...(method ? { method } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        entryDate,
      });
      setOk(
        `${
          type === "EXPENSE" ? "Pengeluaran" : "Pemasukan"
        } "${category.trim()}" dicatat ke pembukuan.`
      );
      setCategory("");
      setAmount("");
      setDescription("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Catat manual</h2>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {ok ? <div className="alert success">{ok}</div> : null}

      <form onSubmit={submit}>
        <div className="inline">
          <label className="field">
            <span>Jenis</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LedgerType)}
            >
              <option value="EXPENSE">Pengeluaran</option>
              <option value="INCOME">Pemasukan (non-kasir)</option>
            </select>
          </label>

          <label className="field">
            <span className="req">Kategori</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="kategori-pembukuan"
              placeholder={
                type === "EXPENSE" ? "mis. Bahan Baku" : "mis. Catering"
              }
              required
            />
            <datalist id="kategori-pembukuan">
              {suggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span className="req">Jumlah (Rp)</span>
            {/* step={1} — JANGAN diganti jadi step={500}. Dengan min={1}, HTML5
                mewajibkan nilai = min + n*step = 1, 501, 1001, … sehingga angka
                bulat seperti 450000 justru DITOLAK browser ("nilai terdekat yang
                valid: 449501 dan 450001") padahal API menerimanya. Rupiah adalah
                bilangan bulat, jadi satuannya 1; putaran 500 hanya akan membuat
                angka seperti 22.550 tidak bisa diisi. */}
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="450000"
              required
            />
          </label>

          <label className="field">
            <span>Metode</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Tanggal</span>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </label>

          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Keterangan (opsional)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="mis. biji kopi arabika 5 kg + susu 24 liter"
            />
          </label>
        </div>

        <div className="actions" style={{ marginTop: 14 }}>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan ke pembukuan"}
          </button>
        </div>
      </form>

      <p className="muted small" style={{ marginTop: 10 }}>
        Penjualan dari kasir tidak diinput di sini — dibayar di halaman{" "}
        <strong>Antrian</strong>, lalu otomatis muncul sebagai pendapatan.
      </p>
    </div>
  );
}
