/**
 * api/prisma/seed.ts — data contoh coffee shop (aman dijalankan berulang).
 *
 *   npm run seed                                     # di host (butuh api/.env)
 *   docker compose --profile tools run --rm api-seed # di dalam stack
 *
 * Yang diisi:
 *   - 9 item menu (kopi, non-kopi, makanan, snack)
 *   - 3 barista
 *   - contoh antrian hari ini: 1 selesai & dibayar (Tunai), 1 sedang dibuat,
 *     1 menunggu  — dibuat HANYA kalau hari ini belum punya antrian
 *   - 3 pengeluaran contoh (bahan baku, gaji, operasional)
 *
 * Prinsip yang dijaga: setiap nota berstatus PAID selalu punya tepat satu baris
 * pendapatan di buku kas (lihat QueuesService.pay).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { resolveDatabaseUrl } from '../src/common/database-url';
import { formatQueueCode, parseDateOnly, todayInShopTz } from '../src/common/date.util';
import { PrismaClient } from '../src/generated/prisma/client';

const MENU: Array<{ name: string; category: 'KOPI' | 'NON_KOPI' | 'MAKANAN' | 'SNACK'; price: number }> = [
  { name: 'Kopi Susu Gula Aren', category: 'KOPI', price: 22000 },
  { name: 'Americano', category: 'KOPI', price: 20000 },
  { name: 'Cappuccino', category: 'KOPI', price: 26000 },
  { name: 'Es Kopi Tubruk', category: 'KOPI', price: 18000 },
  { name: 'Matcha Latte', category: 'NON_KOPI', price: 27000 },
  { name: 'Lemon Tea', category: 'NON_KOPI', price: 15000 },
  { name: 'Croissant', category: 'MAKANAN', price: 21000 },
  { name: 'Roti Bakar Keju', category: 'MAKANAN', price: 18000 },
  { name: 'Kentang Goreng', category: 'SNACK', price: 17000 },
];

const BARISTAS = [
  { name: 'Rina', phone: '0812-1111-2222' },
  { name: 'Dimas', phone: '0813-3333-4444' },
  { name: 'Yuni', phone: null },
];

const EXPENSES = [
  { category: 'Bahan Baku', amount: 450000, method: 'TRANSFER' as const, description: 'Biji kopi arabika 5 kg + susu 24 liter' },
  { category: 'Gaji', amount: 300000, method: 'CASH' as const, description: 'Honor harian 2 barista' },
  { category: 'Operasional', amount: 85000, method: 'E_WALLET' as const, description: 'Token listrik & gas' },
];

async function main() {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  pool.on('error', (error) => console.error('[seed] koneksi database bermasalah:', error.message));
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // ── Menu ──
    for (const item of MENU) {
      await prisma.menuItem.upsert({
        where: { name: item.name },
        update: { category: item.category, price: item.price, active: true },
        create: item,
      });
    }

    // ── Barista ──
    for (const barista of BARISTAS) {
      await prisma.barista.upsert({
        where: { name: barista.name },
        update: { phone: barista.phone, active: true },
        create: barista,
      });
    }

    const menu = await prisma.menuItem.findMany({ orderBy: { name: 'asc' } });
    const menuByName = new Map(menu.map((item) => [item.name, item]));
    const baristas = await prisma.barista.findMany({ orderBy: { id: 'asc' } });
    const [rina, dimas] = baristas;

    // ── Antrian contoh hari ini ──
    const dateStr = todayInShopTz();
    const queueDate = parseDateOnly(dateStr);
    const existing = await prisma.queue.count({ where: { queueDate } });

    if (existing > 0) {
      console.log(`[seed] ${dateStr} sudah punya ${existing} antrian — contoh antrian dilewati.`);
    } else {
      const line = (name: string, qty: number) => {
        const item = menuByName.get(name);
        if (!item) throw new Error(`Menu "${name}" tidak ditemukan setelah seed`);
        return {
          menuItemId: item.id,
          nameSnapshot: item.name,
          qty,
          unitPrice: item.price,
          lineTotal: item.price * qty,
          note: null,
        };
      };

      // 1) Selesai & sudah dibayar (Tunai) — sekaligus menulis pendapatan ke buku kas.
      const paidLines = [line('Kopi Susu Gula Aren', 2), line('Croissant', 1)];
      const paidTotal = paidLines.reduce((sum, l) => sum + l.lineTotal, 0);
      const paidAt = new Date(Date.now() - 3 * 3600_000);

      const paidQueue = await prisma.queue.create({
        data: {
          number: 1,
          code: formatQueueCode(1),
          queueDate,
          customerName: 'Budi Santoso',
          customerPhone: '0857-1234-5678',
          orderType: 'DINE_IN',
          tableNumber: '3',
          status: 'DONE',
          baristaId: rina?.id ?? null,
          subtotal: paidTotal,
          discount: 0,
          total: paidTotal,
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          paidAt,
          startedAt: new Date(paidAt.getTime() - 12 * 60_000),
          finishedAt: new Date(paidAt.getTime() - 2 * 60_000),
          orderItems: { create: paidLines },
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          entryDate: queueDate,
          type: 'INCOME',
          category: 'Penjualan',
          amount: paidTotal,
          method: 'CASH',
          description: `${paidQueue.code} — ${paidQueue.customerName} (2x Kopi Susu Gula Aren, 1x Croissant)`,
          queueId: paidQueue.id,
        },
      });

      // 2) Sedang dikerjakan barista kedua (belum bayar).
      const inProgressLines = [line('Cappuccino', 1), line('Roti Bakar Keju', 1)];
      await prisma.queue.create({
        data: {
          number: 2,
          code: formatQueueCode(2),
          queueDate,
          customerName: 'Sari Dewi',
          orderType: 'DINE_IN',
          tableNumber: '5',
          status: 'IN_PROGRESS',
          baristaId: dimas?.id ?? null,
          startedAt: new Date(Date.now() - 4 * 60_000),
          subtotal: inProgressLines.reduce((sum, l) => sum + l.lineTotal, 0),
          total: inProgressLines.reduce((sum, l) => sum + l.lineTotal, 0),
          orderItems: { create: inProgressLines },
          note: 'Gula terpisah',
        },
      });

      // 3) Masih menunggu, dibungkus untuk dibawa pulang.
      const waitingLines = [line('Matcha Latte', 1), line('Kentang Goreng', 1)];
      await prisma.queue.create({
        data: {
          number: 3,
          code: formatQueueCode(3),
          queueDate,
          customerName: 'Agus Pratama',
          orderType: 'TAKE_AWAY',
          status: 'WAITING',
          subtotal: waitingLines.reduce((sum, l) => sum + l.lineTotal, 0),
          total: waitingLines.reduce((sum, l) => sum + l.lineTotal, 0),
          orderItems: { create: waitingLines },
        },
      });

      console.log(`[seed] 3 antrian contoh dibuat untuk ${dateStr} (1 sudah dibayar → 1 baris pendapatan).`);
    }

    // ── Pengeluaran contoh (hanya kalau belum ada di tanggal yang sama) ──
    let createdExpenses = 0;
    for (const expense of EXPENSES) {
      const already = await prisma.ledgerEntry.findFirst({
        where: { entryDate: queueDate, type: 'EXPENSE', category: expense.category },
        select: { id: true },
      });
      if (already) continue;
      await prisma.ledgerEntry.create({
        data: { entryDate: queueDate, type: 'EXPENSE', queueId: null, ...expense },
      });
      createdExpenses += 1;
    }

    const counts = {
      menu: await prisma.menuItem.count(),
      baristas: await prisma.barista.count(),
      queues: await prisma.queue.count(),
      ledger: await prisma.ledgerEntry.count(),
    };

    console.log(
      `[seed] selesai — menu: ${counts.menu}, barista: ${counts.baristas}, antrian: ${counts.queues}, ` +
        `baris pembukuan: ${counts.ledger} (pengeluaran contoh baru: ${createdExpenses}).`,
    );
    console.log(`[seed] cek hasilnya: GET /api/reports/daily?date=${dateStr}`);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('[seed] GAGAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
