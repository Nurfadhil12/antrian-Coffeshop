import { Injectable } from '@nestjs/common';
import {
  dateRange,
  daysBetween,
  parseDateOnly,
  toDateOnlyString,
  todayInShopTz,
} from '../common/date.util';
import { LedgerType } from '../prisma/prisma-client';
import { PrismaService } from '../prisma/prisma.service';

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Tunai',
  QRIS: 'QRIS',
  TRANSFER: 'Transfer',
  E_WALLET: 'E-Wallet',
};

interface LedgerTotals {
  income: number;
  expense: number;
  net: number;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Laporan satu hari: penjualan dari nota kasir + buku kas, berdampingan.
   *
   * Keduanya dilaporkan terpisah dengan sengaja: `sales.revenue` dihitung dari
   * nota berbayar, sedangkan `ledger.income` dibaca dari buku kas. Keduanya harus
   * sama; kalau berbeda, ada baris buku kas yang diubah manual dan itu terlihat
   * di field `reconciliation`.
   */
  async daily(dateInput?: string) {
    const dateStr = dateInput ?? todayInShopTz();
    const day = parseDateOnly(dateStr);

    const [queues, ledgerEntries] = await Promise.all([
      this.prisma.queue.findMany({
        where: { queueDate: day },
        select: {
          id: true,
          code: true,
          status: true,
          paymentStatus: true,
          paymentMethod: true,
          subtotal: true,
          discount: true,
          total: true,
          startedAt: true,
          finishedAt: true,
          baristaId: true,
          barista: { select: { id: true, name: true } },
          orderItems: { select: { nameSnapshot: true, qty: true, lineTotal: true, menuItem: { select: { category: true } } } },
        },
        orderBy: { number: 'asc' },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { entryDate: day },
        select: { type: true, category: true, amount: true, method: true, queueId: true },
      }),
    ]);

    const paid = queues.filter((q) => q.paymentStatus === 'PAID');
    const unpaid = queues.filter((q) => q.paymentStatus === 'UNPAID' && q.status !== 'CANCELLED');
    const voided = queues.filter((q) => q.paymentStatus === 'VOID');

    const durations = queues
      .filter((q) => q.status === 'DONE' && q.startedAt && q.finishedAt)
      .map((q) => (q.finishedAt as Date).getTime() - (q.startedAt as Date).getTime());

    // ── Item terjual & pendapatan per kategori menu (hanya nota berbayar) ──
    const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
    const categoryMap = new Map<string, { category: string; qty: number; revenue: number }>();
    const baristaMap = new Map<number, { baristaId: number; name: string; notes: number; revenue: number }>();

    for (const queue of paid) {
      for (const item of queue.orderItems) {
        const current = itemMap.get(item.nameSnapshot) ?? {
          name: item.nameSnapshot,
          qty: 0,
          revenue: 0,
        };
        current.qty += item.qty;
        current.revenue += item.lineTotal;
        itemMap.set(item.nameSnapshot, current);

        const category = item.menuItem?.category ?? 'LAINNYA';
        const cat = categoryMap.get(category) ?? { category, qty: 0, revenue: 0 };
        cat.qty += item.qty;
        cat.revenue += item.lineTotal;
        categoryMap.set(category, cat);
      }

      if (queue.barista) {
        const row =
          baristaMap.get(queue.barista.id) ??
          { baristaId: queue.barista.id, name: queue.barista.name, notes: 0, revenue: 0 };
        row.notes += 1;
        row.revenue += queue.total;
        baristaMap.set(queue.barista.id, row);
      }
    }

    const methodMap = new Map<string, { method: string; label: string; notes: number; revenue: number }>();
    for (const queue of paid) {
      const method = queue.paymentMethod ?? 'CASH';
      const row = methodMap.get(method) ?? {
        method,
        label: METHOD_LABEL[method] ?? method,
        notes: 0,
        revenue: 0,
      };
      row.notes += 1;
      row.revenue += queue.total;
      methodMap.set(method, row);
    }

    const ledger = this.ledgerBreakdown(ledgerEntries);
    const revenue = paid.reduce((sum, q) => sum + q.total, 0);

    return {
      date: dateStr,
      sales: {
        notes: queues.length,
        paidNotes: paid.length,
        unpaidNotes: unpaid.length,
        voidedNotes: voided.length,
        cancelledNotes: queues.filter((q) => q.status === 'CANCELLED').length,
        gross: paid.reduce((sum, q) => sum + q.subtotal, 0),
        discount: paid.reduce((sum, q) => sum + q.discount, 0),
        revenue,
        unpaidAmount: unpaid.reduce((sum, q) => sum + q.total, 0),
        avgNoteValue: paid.length ? Math.round(revenue / paid.length) : 0,
        avgServiceMinutes: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60_000)
          : null,
        lastCode: queues.length ? queues[queues.length - 1].code : null,
      },
      ledger,
      reconciliation: {
        salesRevenue: revenue,
        ledgerIncome: ledger.income,
        difference: ledger.income - revenue,
        match: ledger.income === revenue,
      },
      topItems: [...itemMap.values()].sort((a, b) => b.revenue - a.revenue),
      byMenuCategory: [...categoryMap.values()].sort((a, b) => b.revenue - a.revenue),
      byPaymentMethod: [...methodMap.values()].sort((a, b) => b.revenue - a.revenue),
      byBarista: [...baristaMap.values()].sort((a, b) => b.revenue - a.revenue),
    };
  }

  /**
   * Laporan rentang tanggal: satu baris per hari (termasuk hari tanpa transaksi,
   * supaya grafik/ tabel tidak bolong) + total keseluruhan.
   */
  async range(fromInput?: string, toInput?: string) {
    const to = toInput ?? todayInShopTz();
    const from = fromInput ?? `${to.slice(0, 7)}-01`; // awal bulan berjalan
    const bounds = dateRange(from, to);
    const days = daysBetween(from, to);

    const [ledgerGroups, queueGroups] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['entryDate', 'type'],
        where: { entryDate: bounds },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.queue.groupBy({
        by: ['queueDate', 'paymentStatus'],
        where: { queueDate: bounds },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);

    const perDay = new Map<string, {
      date: string;
      income: number;
      expense: number;
      net: number;
      paidNotes: number;
      unpaidNotes: number;
      allNotes: number;
    }>();

    for (let offset = 0; offset < days; offset += 1) {
      const cursor = parseDateOnly(from);
      cursor.setUTCDate(cursor.getUTCDate() + offset);
      const key = toDateOnlyString(cursor);
      perDay.set(key, {
        date: key,
        income: 0,
        expense: 0,
        net: 0,
        paidNotes: 0,
        unpaidNotes: 0,
        allNotes: 0,
      });
    }

    for (const group of ledgerGroups) {
      const key = toDateOnlyString(group.entryDate as Date);
      const row = perDay.get(key);
      if (!row) continue;
      const amount = group._sum.amount ?? 0;
      if (group.type === 'INCOME') row.income += amount;
      else row.expense += amount;
    }

    for (const group of queueGroups) {
      const key = toDateOnlyString(group.queueDate as Date);
      const row = perDay.get(key);
      if (!row) continue;
      row.allNotes += group._count._all;
      if (group.paymentStatus === 'PAID') row.paidNotes += group._count._all;
      if (group.paymentStatus === 'UNPAID') row.unpaidNotes += group._count._all;
    }

    const rows = [...perDay.values()].map((row) => ({ ...row, net: row.income - row.expense }));

    const totals = rows.reduce<LedgerTotals & { paidNotes: number; allNotes: number; unpaidNotes: number }>(
      (acc, row) => ({
        income: acc.income + row.income,
        expense: acc.expense + row.expense,
        net: acc.net + row.net,
        paidNotes: acc.paidNotes + row.paidNotes,
        unpaidNotes: acc.unpaidNotes + row.unpaidNotes,
        allNotes: acc.allNotes + row.allNotes,
      }),
      { income: 0, expense: 0, net: 0, paidNotes: 0, unpaidNotes: 0, allNotes: 0 },
    );

    const expenseByCategory = await this.prisma.ledgerEntry.groupBy({
      by: ['category'],
      where: { entryDate: bounds, type: 'EXPENSE' },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    return {
      from,
      to,
      days,
      rows,
      totals: {
        ...totals,
        avgDailyIncome: days ? Math.round(totals.income / days) : 0,
        avgDailyExpense: days ? Math.round(totals.expense / days) : 0,
      },
      expenseByCategory: expenseByCategory.map((group) => ({
        category: group.category,
        total: group._sum.amount ?? 0,
        count: group._count._all,
      })),
    };
  }

  // ─────────────────────────── internal ───────────────────────────

  private ledgerBreakdown(
    entries: Array<{ type: LedgerType; category: string; amount: number; method: string | null; queueId: number | null }>,
  ) {
    const income = entries
      .filter((e) => e.type === 'INCOME')
      .reduce((sum, e) => sum + e.amount, 0);
    const expense = entries
      .filter((e) => e.type === 'EXPENSE')
      .reduce((sum, e) => sum + e.amount, 0);

    const byCategory = new Map<string, { category: string; type: LedgerType; total: number; count: number }>();
    for (const entry of entries) {
      const mapKey = `${entry.type}:${entry.category}`;
      const row = byCategory.get(mapKey) ?? {
        category: entry.category,
        type: entry.type,
        total: 0,
        count: 0,
      };
      row.total += entry.amount;
      row.count += 1;
      byCategory.set(mapKey, row);
    }

    const byMethod = new Map<string, { method: string; label: string; total: number; count: number }>();
    for (const entry of entries) {
      const method = entry.method ?? 'OTHER';
      const row = byMethod.get(method) ?? {
        method,
        label: METHOD_LABEL[method] ?? 'Tanpa metode',
        total: 0,
        count: 0,
      };
      row.total += entry.amount;
      row.count += 1;
      byMethod.set(method, row);
    }

    return {
      count: entries.length,
      income,
      expense,
      net: income - expense,
      autoIncomeCount: entries.filter((e) => e.queueId !== null).length,
      manualIncomeCount: entries.filter((e) => e.type === 'INCOME' && e.queueId === null).length,
      byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total),
      byMethod: [...byMethod.values()].sort((a, b) => b.total - a.total),
    };
  }
}
