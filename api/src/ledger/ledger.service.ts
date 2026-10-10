import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { dateRange, parseDateOnly, toDateOnlyString, todayInShopTz } from '../common/date.util';
import { LedgerType, Prisma } from '../prisma/prisma-client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLedgerEntryDto,
  ListLedgerQueryDto,
  UpdateLedgerEntryDto,
} from './dto/ledger.dto';

const DEFAULT_RANGE_DAYS = 30;

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Tunai',
  QRIS: 'QRIS',
  TRANSFER: 'Transfer',
  E_WALLET: 'E-Wallet',
};

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Daftar baris buku kas + totalnya.
   *
   * Rentang default: 30 hari terakhir sampai hari ini — supaya endpoint tidak
   * pernah mengembalikan seluruh riwayat tanpa diminta.
   */
  async list(query: ListLedgerQueryDto) {
    const { from, to } = this.resolveRange(query);

    const where: Prisma.LedgerEntryWhereInput = {
      entryDate: dateRange(from, to),
    };
    if (query.type) where.type = query.type;
    if (query.method) where.method = query.method;
    if (query.category) where.category = { equals: query.category, mode: 'insensitive' };
    if (query.q?.trim()) {
      where.description = { contains: query.q.trim(), mode: 'insensitive' };
    }

    const items = await this.prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      include: { queue: { select: { id: true, code: true, customerName: true, status: true } } },
    });

    return {
      from,
      to,
      total: items.length,
      totals: this.totalsOf(items),
      byCategory: this.groupBy(items, 'category'),
      byMethod: this.groupBy(items, 'method'),
      items,
    };
  }

  async findOne(id: number) {
    const entry = await this.prisma.ledgerEntry.findUnique({
      where: { id },
      include: { queue: { select: { id: true, code: true, customerName: true, status: true } } },
    });
    if (!entry) throw new NotFoundException(`Baris pembukuan #${id} tidak ditemukan`);
    return entry;
  }

  /**
   * Input manual: pengeluaran (beli bahan, gaji, sewa) atau pemasukan lain di luar
   * penjualan kasir (mis. catering). Pemasukan penjualan TIDAK diinput di sini —
   * itu dibuat otomatis saat nota dibayar di halaman Antrian.
   */
  async create(dto: CreateLedgerEntryDto) {
    const entryDate = parseDateOnly(dto.entryDate ?? todayInShopTz());

    return this.prisma.ledgerEntry.create({
      data: {
        entryDate,
        type: dto.type,
        category: dto.category.trim(),
        amount: dto.amount,
        method: dto.method ?? null,
        description: dto.description?.trim() || null,
        queueId: null,
      },
    });
  }

  /**
   * Ubah baris manual. Baris yang terikat nota kasir tidak bisa diubah di sini —
   * angkanya harus sama dengan total nota, jadi ubahnya lewat void (DELETE).
   */
  async update(id: number, dto: UpdateLedgerEntryDto) {
    const entry = await this.findOne(id);
    if (entry.queueId !== null) {
      throw new ConflictException(
        `Baris ini dibuat otomatis dari nota ${entry.queue?.code ?? `#${entry.queueId}`}, jadi angkanya tidak bisa diubah di sini. ` +
          'Kalau pembayarannya salah, hapus baris ini (nota akan kembali berstatus belum dibayar / VOID).',
      );
    }

    return this.prisma.ledgerEntry.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.entryDate !== undefined ? { entryDate: parseDateOnly(dto.entryDate) } : {}),
      },
    });
  }

  /**
   * Hapus baris.
   *
   * Untuk baris yang berasal dari nota kasir, keduanya dibatalkan bersama dalam
   * satu transaksi: baris pendapatan hilang DAN nota ditandai VOID (bukan UNPAID,
   * supaya jejaknya tetap terlihat di riwayat). Total pembukuan jadi tidak pernah
   * berbeda dari nota yang benar-benar lunas.
   */
  async remove(id: number) {
    const entry = await this.findOne(id);

    if (entry.queueId === null) {
      await this.prisma.ledgerEntry.delete({ where: { id } });
      return {
        deleted: true,
        queueVoided: false,
        id,
        message: `Baris ${entry.type === 'INCOME' ? 'pemasukan' : 'pengeluaran'} "${entry.category}" dihapus.`,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.delete({ where: { id } });
      const queue = await tx.queue.update({
        where: { id: entry.queueId as number },
        data: { paymentStatus: 'VOID', paymentMethod: null, paidAt: null },
      });
      return {
        deleted: true,
        queueVoided: true,
        id,
        code: queue.code,
        message:
          `Pendapatan nota ${queue.code} dibatalkan. Nota ditandai VOID (bukan dihapus) ` +
          'supaya riwayatnya tetap terlihat; nota bisa dibayar ulang dari halaman Antrian.',
      };
    });
  }

  // ─────────────────────────── internal ───────────────────────────

  private resolveRange(query: { from?: string; to?: string }): { from: string; to: string } {
    const today = todayInShopTz();
    const to = query.to ?? today;
    const from = query.from ?? this.shiftDate(to, -(DEFAULT_RANGE_DAYS - 1));
    // dateRange() memvalidasi urutannya (dan melempar kalau terbalik).
    dateRange(from, to);
    return { from, to };
  }

  private shiftDate(dateStr: string, days: number): string {
    const date = parseDateOnly(dateStr);
    date.setUTCDate(date.getUTCDate() + days);
    return toDateOnlyString(date);
  }

  private totalsOf(entries: Array<{ type: LedgerType; amount: number }>) {
    const income = entries
      .filter((e) => e.type === 'INCOME')
      .reduce((sum, e) => sum + e.amount, 0);
    const expense = entries
      .filter((e) => e.type === 'EXPENSE')
      .reduce((sum, e) => sum + e.amount, 0);
    return {
      income,
      expense,
      net: income - expense,
      incomeCount: entries.filter((e) => e.type === 'INCOME').length,
      expenseCount: entries.filter((e) => e.type === 'EXPENSE').length,
    };
  }

  private groupBy<K extends 'category' | 'method'>(
    entries: Array<{ type: LedgerType; amount: number; category: string; method: string | null }>,
    key: K,
  ) {
    const buckets = new Map<string, { key: string; label: string; type: LedgerType; total: number; count: number }>();

    for (const entry of entries) {
      const raw = entry[key];
      const value = raw ?? '(tanpa metode)';
      const mapKey = `${entry.type}:${value}`;
      const current = buckets.get(mapKey);
      if (current) {
        current.total += entry.amount;
        current.count += 1;
      } else {
        buckets.set(mapKey, {
          key: value,
          label: key === 'method' ? (METHOD_LABEL[value] ?? value) : value,
          type: entry.type,
          total: entry.amount,
          count: 1,
        });
      }
    }

    return [...buckets.values()].sort((a, b) => b.total - a.total);
  }
}
