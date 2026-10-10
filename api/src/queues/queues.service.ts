import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatQueueCode, parseDateOnly, toDateOnlyString, todayInShopTz } from '../common/date.util';
import { Prisma, QueueStatus } from '../prisma/prisma-client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateQueueDto,
  ListQueuesQueryDto,
  OrderItemInputDto,
  PayQueueDto,
  StartQueueDto,
  UpdateQueueDto,
} from './dto/queue.dto';

const QUEUE_INCLUDE = {
  barista: { select: { id: true, name: true } },
  orderItems: {
    select: {
      id: true,
      menuItemId: true,
      nameSnapshot: true,
      qty: true,
      unitPrice: true,
      lineTotal: true,
      note: true,
    },
    orderBy: { id: 'asc' as const },
  },
} as const;

const STATUS_LABEL: Record<QueueStatus, string> = {
  WAITING: 'menunggu',
  IN_PROGRESS: 'sedang dilayani',
  DONE: 'selesai',
  CANCELLED: 'dibatalkan',
};

interface PricedLine {
  menuItemId: number | null;
  nameSnapshot: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  note: string | null;
}

@Injectable()
export class QueuesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Daftar antrian satu hari + ringkasannya — satu round-trip untuk papan antrian. */
  async list(query: ListQueuesQueryDto) {
    const queueDate = parseDateOnly(query.date ?? todayInShopTz());
    const where: Prisma.QueueWhereInput = { queueDate };

    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.baristaId) where.baristaId = query.baristaId;
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { customerName: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { customerPhone: { contains: q } },
      ];
    }

    const [items, summary] = await Promise.all([
      this.prisma.queue.findMany({ where, include: QUEUE_INCLUDE, orderBy: [{ number: 'asc' }] }),
      this.summaryFor(queueDate),
    ]);

    return { date: toDateOnlyString(queueDate), items, summary };
  }

  async summary(query: ListQueuesQueryDto) {
    const queueDate = parseDateOnly(query.date ?? todayInShopTz());
    return { date: toDateOnlyString(queueDate), summary: await this.summaryFor(queueDate) };
  }

  async findOne(id: number) {
    const queue = await this.prisma.queue.findUnique({ where: { id }, include: QUEUE_INCLUDE });
    if (!queue) throw new NotFoundException(`Antrian #${id} tidak ditemukan`);
    return queue;
  }

  async create(dto: CreateQueueDto) {
    const dateStr = dto.queueDate ?? todayInShopTz();
    const queueDate = parseDateOnly(dateStr);

    if (dto.baristaId) await this.requireActiveBarista(dto.baristaId);
    const lines = await this.priceLines(dto.items);
    const totals = this.totalsOf(lines, dto.discount ?? 0);

    // Nomor urut direset per hari. Kunci advisory per tanggal membuat dua kasir
    // yang menekan "Tambah" bersamaan tidak mendapat nomor yang sama.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`queue:${dateStr}`}))`;

      const last = await tx.queue.findFirst({
        where: { queueDate },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;

      return tx.queue.create({
        data: {
          number,
          code: formatQueueCode(number),
          queueDate,
          customerName: dto.customerName.trim(),
          customerPhone: dto.customerPhone?.trim() || null,
          orderType: dto.orderType ?? 'DINE_IN',
          tableNumber: dto.tableNumber?.trim() || null,
          note: dto.note?.trim() || null,
          baristaId: dto.baristaId ?? null,
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          orderItems: { create: lines },
        },
        include: QUEUE_INCLUDE,
      });
    });
  }

  /** Ubah nota. Hanya boleh selama belum dibayar & belum dibatalkan/selesai. */
  async update(id: number, dto: UpdateQueueDto) {
    const queue = await this.findOne(id);
    this.assertEditable(queue);

    if (dto.baristaId !== undefined && dto.baristaId !== null) {
      await this.requireActiveBarista(dto.baristaId);
    }

    const lines = dto.items ? await this.priceLines(dto.items) : null;
    const discount = dto.discount ?? queue.discount;
    const subtotal = lines
      ? lines.reduce((sum, line) => sum + line.lineTotal, 0)
      : queue.subtotal;
    const totals = this.totalsOf(lines ?? [], discount, subtotal);

    return this.prisma.$transaction(async (tx) => {
      if (lines) {
        // Ganti seluruh baris: nota belum dibayar, jadi belum ada pembukuan yang
        // bergantung padanya.
        await tx.orderItem.deleteMany({ where: { queueId: id } });
        await tx.orderItem.createMany({
          data: lines.map((line) => ({ ...line, queueId: id })),
        });
      }

      return tx.queue.update({
        where: { id },
        data: {
          ...(dto.customerName !== undefined ? { customerName: dto.customerName.trim() } : {}),
          ...(dto.customerPhone !== undefined
            ? { customerPhone: dto.customerPhone.trim() || null }
            : {}),
          ...(dto.orderType !== undefined ? { orderType: dto.orderType } : {}),
          ...(dto.tableNumber !== undefined ? { tableNumber: dto.tableNumber.trim() || null } : {}),
          ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
          ...(dto.baristaId !== undefined ? { baristaId: dto.baristaId } : {}),
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
        },
        include: QUEUE_INCLUDE,
      });
    });
  }

  /** Panggil pesanan: WAITING -> IN_PROGRESS. */
  async start(id: number, dto: StartQueueDto) {
    const queue = await this.findOne(id);
    if (queue.status !== 'WAITING') {
      throw new ConflictException(
        `Antrian ${queue.code} berstatus ${STATUS_LABEL[queue.status]}, tidak bisa dipanggil.`,
      );
    }

    let baristaId = dto.baristaId ?? queue.baristaId ?? null;

    if (baristaId) {
      await this.requireActiveBarista(baristaId);
      const busy = await this.prisma.queue.findFirst({
        where: { queueDate: queue.queueDate, baristaId, status: 'IN_PROGRESS', id: { not: id } },
        select: { code: true },
      });
      if (busy) {
        throw new ConflictException(
          `Barista itu sedang mengerjakan ${busy.code}. Selesaikan dulu sebelum memanggil antrian lain.`,
        );
      }
    } else {
      const activeBaristas = await this.prisma.barista.findMany({
        where: { active: true },
        take: 2,
        select: { id: true },
      });
      if (activeBaristas.length === 1) {
        baristaId = activeBaristas[0].id; // cuma satu barista aktif → otomatis
      } else {
        throw new BadRequestException('Pilih barista dulu sebelum memanggil antrian ini.');
      }
    }

    return this.prisma.queue.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), baristaId },
      include: QUEUE_INCLUDE,
    });
  }

  /** Pesanan selesai dibuat/diserahkan: IN_PROGRESS -> DONE. */
  async finish(id: number) {
    const queue = await this.findOne(id);
    if (queue.status !== 'IN_PROGRESS') {
      throw new ConflictException(
        `Antrian ${queue.code} belum dipanggil (status: ${STATUS_LABEL[queue.status]}), jadi belum bisa diselesaikan.`,
      );
    }
    return this.prisma.queue.update({
      where: { id },
      data: { status: 'DONE', finishedAt: new Date() },
      include: QUEUE_INCLUDE,
    });
  }

  /** Batalkan: WAITING / IN_PROGRESS -> CANCELLED. Nota yang sudah dibayar tidak bisa. */
  async cancel(id: number) {
    const queue = await this.findOne(id);
    if (queue.status === 'DONE' || queue.status === 'CANCELLED') {
      throw new ConflictException(
        `Antrian ${queue.code} sudah ${STATUS_LABEL[queue.status]}, tidak bisa dibatalkan.`,
      );
    }
    if (queue.paymentStatus === 'PAID') {
      throw new ConflictException(
        `Nota ${queue.code} sudah dibayar. Kalau uangnya dikembalikan, catat sebagai pengeluaran (refund) di halaman Pembukuan.`,
      );
    }
    return this.prisma.queue.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: QUEUE_INCLUDE,
    });
  }

  /**
   * Bayar nota: menandai PAID **dan** menulis satu baris pendapatan ke pembukuan
   * dalam transaksi yang sama. Jadi tidak mungkin ada nota berbayar yang tidak
   * tercatat di buku kas (dan sebaliknya).
   */
  async pay(id: number, dto: PayQueueDto) {
    const queue = await this.findOne(id);

    if (queue.status === 'CANCELLED') {
      throw new ConflictException(`Antrian ${queue.code} sudah dibatalkan, jadi tidak bisa dibayar.`);
    }
    if (queue.paymentStatus === 'PAID') {
      throw new ConflictException(`Nota ${queue.code} sudah dibayar (${queue.paymentMethod}).`);
    }
    if (queue.orderItems.length === 0) {
      throw new BadRequestException(
        `Nota ${queue.code} belum punya item pesanan, jadi tidak ada yang bisa dibayar.`,
      );
    }

    const discount = dto.discount ?? queue.discount;
    const subtotal = queue.orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const total = Math.max(0, subtotal - discount);

    const itemSummary = queue.orderItems
      .map((item) => `${item.qty}x ${item.nameSnapshot}`)
      .join(', ')
      .slice(0, 300);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.queue.update({
        where: { id },
        data: {
          paymentStatus: 'PAID',
          paymentMethod: dto.paymentMethod,
          paidAt: new Date(),
          discount,
          subtotal,
          total,
        },
        include: QUEUE_INCLUDE,
      });

      await tx.ledgerEntry.create({
        data: {
          entryDate: queue.queueDate, // tanggal usaha, bukan tanggal jam dinding
          type: 'INCOME',
          category: 'Penjualan',
          amount: total,
          method: dto.paymentMethod,
          description: `${queue.code} — ${queue.customerName}${itemSummary ? ` (${itemSummary})` : ''}${
            dto.note ? ` · ${dto.note}` : ''
          }`,
          queueId: id,
        },
      });

      return updated;
    });
  }

  /** Hapus permanen (koreksi salah input). Baris pembukuan nota ini tidak ikut terhapus. */
  async remove(id: number) {
    const queue = await this.findOne(id);
    if (queue.paymentStatus === 'PAID') {
      throw new ConflictException(
        `Nota ${queue.code} sudah dibayar dan tercatat di pembukuan. Batalkan baris pendapatannya dulu di halaman Pembukuan kalau memang salah input.`,
      );
    }
    await this.prisma.queue.delete({ where: { id } });
    return { deleted: true, id, code: queue.code };
  }

  // ─────────────────────────── internal ───────────────────────────

  private assertEditable(queue: { code: string; status: QueueStatus; paymentStatus: string }) {
    if (queue.paymentStatus === 'PAID') {
      throw new ConflictException(
        `Nota ${queue.code} sudah dibayar, jadi isinya tidak bisa diubah.`,
      );
    }
    if (queue.status === 'CANCELLED') {
      throw new ConflictException(`Antrian ${queue.code} sudah dibatalkan.`);
    }
  }

  /** Ambil nama & harga dari menu (snapshot) atau dari item lepas. */
  private async priceLines(items: OrderItemInputDto[]): Promise<PricedLine[]> {
    const menuIds = items
      .map((item) => item.menuItemId)
      .filter((id): id is number => typeof id === 'number');

    const menuItems = menuIds.length
      ? await this.prisma.menuItem.findMany({ where: { id: { in: menuIds } } })
      : [];
    const byId = new Map(menuItems.map((item) => [item.id, item]));

    return items.map((item) => {
      if (item.menuItemId !== undefined) {
        const menu = byId.get(item.menuItemId);
        if (!menu) throw new NotFoundException(`Menu #${item.menuItemId} tidak ditemukan`);
        if (!menu.active) {
          throw new BadRequestException(`Menu "${menu.name}" sedang nonaktif.`);
        }
        return {
          menuItemId: menu.id,
          nameSnapshot: menu.name,
          qty: item.qty,
          unitPrice: menu.price,
          lineTotal: menu.price * item.qty,
          note: item.note?.trim() || null,
        };
      }

      // Item lepas: wajib punya nama dan harga sendiri.
      if (!item.name?.trim() || item.unitPrice === undefined) {
        throw new BadRequestException(
          'Setiap item harus punya menuItemId, atau name DAN unitPrice untuk item di luar menu.',
        );
      }
      return {
        menuItemId: null,
        nameSnapshot: item.name.trim(),
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineTotal: item.unitPrice * item.qty,
        note: item.note?.trim() || null,
      };
    });
  }

  private totalsOf(lines: PricedLine[], discount: number, subtotalOverride?: number) {
    const subtotal =
      subtotalOverride ?? lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const safeDiscount = Math.min(Math.max(discount, 0), subtotal);
    return { subtotal, discount: safeDiscount, total: subtotal - safeDiscount };
  }

  private async summaryFor(queueDate: Date) {
    const rows = await this.prisma.queue.findMany({
      where: { queueDate },
      select: {
        id: true,
        number: true,
        code: true,
        status: true,
        paymentStatus: true,
        customerName: true,
        total: true,
        startedAt: true,
        finishedAt: true,
      },
      orderBy: { number: 'asc' },
    });

    const count = (status: QueueStatus) => rows.filter((r) => r.status === status).length;
    const paid = rows.filter((r) => r.paymentStatus === 'PAID');
    const durations = rows
      .filter((r) => r.status === 'DONE' && r.startedAt && r.finishedAt)
      .map((r) => (r.finishedAt as Date).getTime() - (r.startedAt as Date).getTime());

    const serving = rows.find((r) => r.status === 'IN_PROGRESS') ?? null;
    const next = rows.find((r) => r.status === 'WAITING') ?? null;

    return {
      total: rows.length,
      waiting: count('WAITING'),
      inProgress: count('IN_PROGRESS'),
      done: count('DONE'),
      cancelled: count('CANCELLED'),
      unpaid: rows.filter((r) => r.paymentStatus === 'UNPAID' && r.status !== 'CANCELLED').length,
      paidCount: paid.length,
      revenue: paid.reduce((sum, r) => sum + r.total, 0),
      unpaidAmount: rows
        .filter((r) => r.paymentStatus === 'UNPAID' && r.status !== 'CANCELLED')
        .reduce((sum, r) => sum + r.total, 0),
      lastNumber: rows.length ? rows[rows.length - 1].number : 0,
      serving: serving
        ? { id: serving.id, code: serving.code, customerName: serving.customerName }
        : null,
      next: next ? { id: next.id, code: next.code, customerName: next.customerName } : null,
      avgServiceMinutes: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60_000)
        : null,
    };
  }

  private async requireActiveBarista(id: number) {
    const barista = await this.prisma.barista.findUnique({ where: { id } });
    if (!barista) throw new NotFoundException(`Barista #${id} tidak ditemukan`);
    if (!barista.active) throw new BadRequestException(`Barista "${barista.name}" sedang nonaktif`);
    return barista;
  }
}
