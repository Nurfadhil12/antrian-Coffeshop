import { ApiDiagnostics } from '@/components/ApiDiagnostics';
import { RangeNav } from '@/components/RangeNav';
import { loadWithHealth } from '@/lib/api';
import {
  CATEGORY_LABEL,
  METHOD_LABEL,
  firstOfMonth,
  longDate,
  rupiah,
  rupiahShort,
  todayInShopTz,
} from '@/lib/format';
import type { DailyReport, RangeReport } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function LaporanPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const today = todayInShopTz();
  const date = params.date ?? today;
  const to = params.to ?? date;
  const from = params.from ?? firstOfMonth(to);

  const [dailyRes, rangeRes] = await Promise.all([
    loadWithHealth<DailyReport>(`/reports/daily?date=${date}`),
    loadWithHealth<RangeReport>(`/reports/range?from=${from}&to=${to}`),
  ]);

  const head = (
    <div className="page-head">
      <div>
        <h1>Laporan</h1>
        <p>Penjualan dari nota kasir dan buku kas, disandingkan supaya selisihnya langsung terlihat.</p>
      </div>
      <RangeNav from={from} to={to} basePath="/laporan" />
    </div>
  );

  if (!dailyRes.data) {
    return (
      <>
        {head}
        <ApiDiagnostics
          error={dailyRes.error ?? 'Laporan tidak tersedia.'}
          health={dailyRes.health}
          context="laporan harian"
        />
      </>
    );
  }

  const daily = dailyRes.data;
  const range = rangeRes.data;
  const maxDay = range ? range.rows.reduce((max, row) => Math.max(max, row.income), 0) || 1 : 1;

  return (
    <>
      {head}

      <div className="card">
        <div className="card-head">
          <h2>Hari {longDate(date)}</h2>
          <a className="small" href={`/laporan?date=${date}&from=${from}&to=${to}`}>
            <span className="muted">muat ulang</span>
          </a>
        </div>

        <div className="grid-stats">
          <div className="stat ok">
            <div className="label">Penjualan (nota lunas)</div>
            <div className="value">{rupiahShort(daily.sales.revenue)}</div>
            <div className="sub">
              {daily.sales.paidNotes} nota · rata-rata {rupiah(daily.sales.avgNoteValue)}
            </div>
          </div>
          <div className="stat danger">
            <div className="label">Pengeluaran</div>
            <div className="value">{rupiahShort(daily.ledger.expense)}</div>
            <div className="sub">total hari ini</div>
          </div>
          <div className={daily.ledger.net >= 0 ? 'stat ok' : 'stat danger'}>
            <div className="label">Laba bersih</div>
            <div className="value">{rupiahShort(daily.ledger.net)}</div>
            <div className="sub">
              {rupiah(daily.sales.revenue)} − {rupiah(daily.ledger.expense)}
            </div>
          </div>
          <div className={daily.sales.unpaidNotes > 0 ? 'stat warn' : 'stat'}>
            <div className="label">Belum dibayar</div>
            <div className="value">{daily.sales.unpaidNotes}</div>
            <div className="sub">{rupiah(daily.sales.unpaidAmount)}</div>
          </div>
          <div className="stat">
            <div className="label">Rata-rata layanan</div>
            <div className="value">
              {daily.sales.avgServiceMinutes !== null ? `${daily.sales.avgServiceMinutes}m` : '—'}
            </div>
            <div className="sub">{daily.sales.notes} nota hari ini</div>
          </div>
        </div>

        <div className={daily.reconciliation.match ? 'alert success' : 'alert error'}>
          {daily.reconciliation.match ? (
            <>
              Cocok: pendapatan di buku kas {rupiah(daily.reconciliation.ledgerIncome)} sama dengan
              penjualan nota lunas {rupiah(daily.reconciliation.salesRevenue)}.
            </>
          ) : (
            <>
              <strong>Selisih {rupiah(daily.reconciliation.difference)}.</strong> Penjualan nota
              lunas {rupiah(daily.reconciliation.salesRevenue)}, sedangkan pendapatan di buku kas{' '}
              {rupiah(daily.reconciliation.ledgerIncome)}. Ada baris pendapatan yang diubah/dihapus
              manual, atau nota yang dibayar tanpa tercatat — periksa halaman Pembukuan.
            </>
          )}
        </div>

        <div className="two-col">
          <div>
            <h3 className="small muted">Menu terlaris</h3>
            {daily.topItems.length === 0 ? (
              <p className="muted small">Belum ada nota lunas hari ini.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="money">Terjual</th>
                      <th className="money">Nilai</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.topItems.map((item) => (
                      <tr key={item.name}>
                        <td>{item.name}</td>
                        <td className="money">{item.qty}</td>
                        <td className="money">{rupiah(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="small muted">Rincian lain</h3>
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <th>Per kategori menu</th>
                    <td>
                      {daily.byMenuCategory.length === 0
                        ? '—'
                        : daily.byMenuCategory
                            .map(
                              (row) =>
                                `${CATEGORY_LABEL[row.category] ?? row.category} ${rupiah(row.revenue)}`,
                            )
                            .join(' · ')}
                    </td>
                  </tr>
                  <tr>
                    <th>Per metode bayar</th>
                    <td>
                      {daily.byPaymentMethod.length === 0
                        ? '—'
                        : daily.byPaymentMethod
                            .map((row) => `${row.label} ${rupiah(row.revenue)} (${row.notes})`)
                            .join(' · ')}
                    </td>
                  </tr>
                  <tr>
                    <th>Per barista</th>
                    <td>
                      {daily.byBarista.length === 0
                        ? '—'
                        : daily.byBarista
                            .map((row) => `${row.name} ${rupiah(row.revenue)} (${row.notes})`)
                            .join(' · ')}
                    </td>
                  </tr>
                  <tr>
                    <th>Pengeluaran per kategori</th>
                    <td>
                      {daily.ledger.byCategory.filter((row) => row.type === 'EXPENSE').length === 0
                        ? '—'
                        : daily.ledger.byCategory
                            .filter((row) => row.type === 'EXPENSE')
                            .map((row) => `${row.category} ${rupiah(row.total)}`)
                            .join(' · ')}
                    </td>
                  </tr>
                  <tr>
                    <th>Status nota</th>
                    <td>
                      {daily.sales.paidNotes} lunas · {daily.sales.unpaidNotes} belum bayar ·{' '}
                      {daily.sales.voidedNotes} void · {daily.sales.cancelledNotes} dibatalkan
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {range ? (
        <div className="card">
          <div className="card-head">
            <h2>
              Rekap {longDate(range.from)} — {longDate(range.to)} ({range.days} hari)
            </h2>
          </div>

          <div className="grid-stats">
            <div className="stat ok">
              <div className="label">Total pemasukan</div>
              <div className="value">{rupiahShort(range.totals.income)}</div>
              <div className="sub">
                rata-rata {rupiah(range.totals.avgDailyIncome)}/hari
              </div>
            </div>
            <div className="stat danger">
              <div className="label">Total pengeluaran</div>
              <div className="value">{rupiahShort(range.totals.expense)}</div>
              <div className="sub">
                rata-rata {rupiah(range.totals.avgDailyExpense)}/hari
              </div>
            </div>
            <div className={range.totals.net >= 0 ? 'stat ok' : 'stat danger'}>
              <div className="label">Laba bersih</div>
              <div className="value">{rupiahShort(range.totals.net)}</div>
              <div className="sub">{rupiah(range.totals.net)}</div>
            </div>
            <div className="stat">
              <div className="label">Nota</div>
              <div className="value">{range.totals.allNotes}</div>
              <div className="sub">
                {range.totals.paidNotes} lunas · {range.totals.unpaidNotes} belum bayar
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th className="money">Pemasukan</th>
                  <th className="money">Pengeluaran</th>
                  <th className="money">Laba</th>
                  <th className="money">Nota</th>
                  <th>Porsi pemasukan</th>
                </tr>
              </thead>
              <tbody>
                {range.rows.map((row) => (
                  <tr key={row.date}>
                    <td className="small nowrap">{longDate(row.date)}</td>
                    <td className="money" style={{ color: 'var(--ok)' }}>
                      {rupiah(row.income)}
                    </td>
                    <td className="money" style={{ color: 'var(--danger)' }}>
                      {row.expense > 0 ? rupiah(row.expense) : <span className="muted">—</span>}
                    </td>
                    <td className="money">{rupiah(row.net)}</td>
                    <td className="money small">
                      {row.paidNotes}/{row.allNotes}
                    </td>
                    <td style={{ minWidth: 110 }}>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: `${Math.round((row.income / maxDay) * 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="money">{rupiah(range.totals.income)}</th>
                  <th className="money">{rupiah(range.totals.expense)}</th>
                  <th className="money">{rupiah(range.totals.net)}</th>
                  <th className="money">
                    {range.totals.paidNotes}/{range.totals.allNotes}
                  </th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>

          {range.expenseByCategory.length > 0 ? (
            <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
              Pengeluaran terbesar:{' '}
              {range.expenseByCategory
                .slice(0, 3)
                .map((row) => `${row.category} ${rupiah(row.total)}`)
                .join(' · ')}
            </p>
          ) : null}
        </div>
      ) : (
        <ApiDiagnostics
          error={rangeRes.error ?? 'Rekap rentang tidak tersedia.'}
          health={rangeRes.health}
          context="rekap rentang tanggal"
        />
      )}
    </>
  );
}
