import { AddQueueForm } from '@/components/AddQueueForm';
import { ApiDiagnostics } from '@/components/ApiDiagnostics';
import { DateNav } from '@/components/DateNav';
import { QueueActions } from '@/components/QueueActions';
import { loadWithHealth } from '@/lib/api';
import {
  PAYMENT_STATUS_LABEL,
  QUEUE_STATUS_LABEL,
  longDate,
  rupiah,
  rupiahShort,
  todayInShopTz,
} from '@/lib/format';
import type { BaristaView, MenuItemView, QueueListResponse, QueueView } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AntrianPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const date = params.date ?? todayInShopTz();

  const [queueRes, menuRes, baristaRes] = await Promise.all([
    loadWithHealth<QueueListResponse>(`/queues?date=${date}`),
    loadWithHealth<{ items: MenuItemView[] }>('/menu'),
    loadWithHealth<{ items: BaristaView[] }>('/baristas'),
  ]);

  if (!queueRes.data) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Antrian</h1>
            <p>{longDate(date)}</p>
          </div>
          <DateNav date={date} basePath="/" />
        </div>
        <ApiDiagnostics
          error={queueRes.error ?? 'Data antrian tidak tersedia.'}
          health={queueRes.health}
          context="papan antrian"
        />
      </>
    );
  }

  const { items, summary } = queueRes.data;
  const menu = menuRes.data?.items ?? [];
  const baristas = baristaRes.data?.items ?? [];

  const waiting = items.filter((q) => q.status === 'WAITING');
  const inProgress = items.filter((q) => q.status === 'IN_PROGRESS');
  const unpaid = items.filter((q) => q.paymentStatus === 'UNPAID' && q.status !== 'CANCELLED');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Papan Antrian</h1>
          <p>
            {longDate(date)} · {summary.total} nota · nomor terakhir {summary.lastNumber || '—'}
          </p>
        </div>
        <DateNav date={date} basePath="/" />
      </div>

      {summary.serving ? (
        <div className="banner">
          <span className="badge IN_PROGRESS">sedang dibuat</span>
          <strong>{summary.serving.code}</strong>
          <span>{summary.serving.customerName}</span>
          {summary.next ? (
            <span className="muted">
              · berikutnya <strong>{summary.next.code}</strong> {summary.next.customerName}
            </span>
          ) : (
            <span className="muted">· tidak ada antrian menunggu</span>
          )}
        </div>
      ) : summary.next ? (
        <div className="banner ready">
          <span className="badge WAITING">berikutnya</span>
          <strong>{summary.next.code}</strong>
          <span>{summary.next.customerName}</span>
        </div>
      ) : null}

      <div className="grid-stats">
        <div className="stat warn">
          <div className="label">Menunggu</div>
          <div className="value">{summary.waiting}</div>
          <div className="sub">{waiting.length > 0 ? `terdepan ${waiting[0].code}` : 'kosong'}</div>
        </div>
        <div className="stat info">
          <div className="label">Sedang dibuat</div>
          <div className="value">{summary.inProgress}</div>
          <div className="sub">
            {summary.avgServiceMinutes !== null
              ? `rata-rata ${summary.avgServiceMinutes} menit`
              : 'belum ada data durasi'}
          </div>
        </div>
        <div className="stat ok">
          <div className="label">Selesai</div>
          <div className="value">{summary.done}</div>
          <div className="sub">{summary.paidCount} sudah dibayar</div>
        </div>
        <div className="stat">
          <div className="label">Pendapatan hari ini</div>
          <div className="value">{rupiahShort(summary.revenue)}</div>
          <div className="sub">{rupiah(summary.revenue)}</div>
        </div>
        <div className={summary.unpaid > 0 ? 'stat danger' : 'stat'}>
          <div className="label">Belum dibayar</div>
          <div className="value">{summary.unpaid}</div>
          <div className="sub">{rupiah(summary.unpaidAmount)}</div>
        </div>
      </div>

      {unpaid.length > 0 && summary.done > 0 ? (
        <div className="alert info">
          Ada {unpaid.length} nota belum dibayar ({rupiah(summary.unpaidAmount)}). Tombol{' '}
          <strong>Bayar</strong> di daftar bawah otomatis mencatat pendapatannya ke Pembukuan.
        </div>
      ) : null}

      <AddQueueForm date={date} menu={menu} baristas={baristas} />

      <div className="card">
        <div className="card-head">
          <h2>Daftar antrian ({items.length})</h2>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Pelanggan</th>
                <th>Pesanan</th>
                <th>Barista</th>
                <th className="money">Total</th>
                <th>Status</th>
                <th>Bayar</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    Belum ada antrian untuk {longDate(date)}. Klik <strong>+ Tambah antrian</strong>.
                  </td>
                </tr>
              ) : (
                items.map((queue) => <QueueRow key={queue.id} queue={queue} baristas={baristas} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function QueueRow({ queue, baristas }: { queue: QueueView; baristas: BaristaView[] }) {
  const dim = queue.status === 'DONE' || queue.status === 'CANCELLED';

  return (
    <tr className={dim ? 'row-dim' : undefined}>
      <td className="code">{queue.code}</td>
      <td>
        <div>{queue.customerName}</div>
        <div className="muted small">
          {queue.orderType === 'DINE_IN'
            ? queue.tableNumber
              ? `Meja ${queue.tableNumber}`
              : 'Di tempat'
            : 'Dibungkus'}
          {queue.customerPhone ? ` · ${queue.customerPhone}` : ''}
        </div>
        {queue.note ? <div className="muted small">“{queue.note}”</div> : null}
      </td>
      <td className="small">
        {queue.orderItems.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {queue.orderItems.map((item) => (
              <li key={item.id}>
                {item.qty}x {item.nameSnapshot}
                {item.note ? <span className="muted"> ({item.note})</span> : null}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="small">{queue.barista?.name ?? <span className="muted">—</span>}</td>
      <td className="money">
        {rupiah(queue.total)}
        {queue.discount > 0 ? (
          <div className="muted small">diskon {rupiah(queue.discount)}</div>
        ) : null}
      </td>
      <td>
        <span className={`badge ${queue.status}`}>{QUEUE_STATUS_LABEL[queue.status]}</span>
      </td>
      <td>
        <span className={`badge ${queue.paymentStatus}`}>
          {PAYMENT_STATUS_LABEL[queue.paymentStatus]}
        </span>
        {queue.paymentMethod ? (
          <div className="muted small">{queue.paymentMethod}</div>
        ) : null}
      </td>
      <td className="actions-cell">
        <QueueActions queue={queue} baristas={baristas} />
      </td>
    </tr>
  );
}
