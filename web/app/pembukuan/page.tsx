import { ApiDiagnostics } from '@/components/ApiDiagnostics';
import { LedgerForm } from '@/components/LedgerForm';
import { LedgerTable } from '@/components/LedgerTable';
import { RangeNav } from '@/components/RangeNav';
import { loadWithHealth } from '@/lib/api';
import { METHOD_LABEL, firstOfMonth, longDate, rupiah, rupiahShort, todayInShopTz } from '@/lib/format';
import type { LedgerListResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PembukuanPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const today = todayInShopTz();
  const to = params.to ?? today;
  const from = params.from ?? firstOfMonth(to);

  const res = await loadWithHealth<LedgerListResponse>(`/ledger?from=${from}&to=${to}`);

  const head = (
    <div className="page-head">
      <div>
        <h1>Pembukuan</h1>
        <p>
          Buku kas {longDate(from)} — {longDate(to)}
        </p>
      </div>
      <RangeNav from={from} to={to} basePath="/pembukuan" />
    </div>
  );

  if (!res.data) {
    return (
      <>
        {head}
        <ApiDiagnostics
          error={res.error ?? 'Data pembukuan tidak tersedia.'}
          health={res.health}
          context="buku kas"
        />
      </>
    );
  }

  const { totals, byCategory, byMethod, items } = res.data;
  const incomeRows = byCategory.filter((row) => row.type === 'INCOME');
  const expenseRows = byCategory.filter((row) => row.type === 'EXPENSE');
  const maxExpense = expenseRows.reduce((max, row) => Math.max(max, row.total), 0) || 1;

  return (
    <>
      {head}

      <div className="grid-stats">
        <div className="stat ok">
          <div className="label">Pemasukan</div>
          <div className="value">{rupiahShort(totals.income)}</div>
          <div className="sub">
            {rupiah(totals.income)} · {totals.incomeCount} baris
          </div>
        </div>
        <div className="stat danger">
          <div className="label">Pengeluaran</div>
          <div className="value">{rupiahShort(totals.expense)}</div>
          <div className="sub">
            {rupiah(totals.expense)} · {totals.expenseCount} baris
          </div>
        </div>
        <div className={totals.net >= 0 ? 'stat ok' : 'stat danger'}>
          <div className="label">Laba bersih</div>
          <div className="value">{rupiahShort(totals.net)}</div>
          <div className="sub">{rupiah(totals.net)}</div>
        </div>
        <div className="stat">
          <div className="label">Baris tercatat</div>
          <div className="value">{res.data.total}</div>
          <div className="sub">pada rentang ini</div>
        </div>
      </div>

      <LedgerForm defaultDate={to} />

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <h2>Pengeluaran per kategori</h2>
          </div>
          {expenseRows.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Belum ada pengeluaran pada rentang ini.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kategori</th>
                    <th className="money">Jumlah</th>
                    <th>Porsi</th>
                  </tr>
                </thead>
                <tbody>
                  {expenseRows.map((row) => (
                    <tr key={`${row.type}-${row.key}`}>
                      <td>
                        {row.label} <span className="muted small">({row.count}x)</span>
                      </td>
                      <td className="money">{rupiah(row.total)}</td>
                      <td style={{ minWidth: 90 }}>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{ width: `${Math.round((row.total / maxExpense) * 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Metode pembayaran</h2>
          </div>
          {byMethod.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Belum ada baris dengan metode pembayaran.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Metode</th>
                    <th>Jenis</th>
                    <th className="money">Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {byMethod.map((row) => (
                    <tr key={`${row.type}-${row.key}`}>
                      <td>{METHOD_LABEL[row.key] ?? row.label}</td>
                      <td>
                        <span className={row.type === 'INCOME' ? 'badge INCOME' : 'badge EXPENSE'}>
                          {row.type === 'INCOME' ? 'Masuk' : 'Keluar'}
                        </span>
                      </td>
                      <td className="money">{rupiah(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {incomeRows.length > 0 ? (
            <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
              Pemasukan dari kasir otomatis punya kategori &ldquo;Penjualan&rdquo;:{' '}
              {incomeRows.map((row) => `${row.label} ${rupiah(row.total)}`).join(', ')}.
            </p>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Riwayat buku kas ({items.length})</h2>
        </div>
        <LedgerTable items={items} />
      </div>
    </>
  );
}
