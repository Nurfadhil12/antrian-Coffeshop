import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../prisma/prisma-client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMenuItemDto, ListMenuQueryDto, UpdateMenuItemDto } from './dto/menu.dto';

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMenuQueryDto) {
    const where: Prisma.MenuItemWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.active !== undefined) where.active = query.active;
    if (query.q?.trim()) {
      where.name = { contains: query.q.trim(), mode: 'insensitive' };
    }

    const items = await this.prisma.menuItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return { total: items.length, items };
  }

  async findOne(id: number) {
    const item = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Menu #${id} tidak ditemukan`);
    return item;
  }

  async create(dto: CreateMenuItemDto) {
    return this.prisma.menuItem.create({
      data: {
        name: dto.name.trim(),
        category: dto.category ?? 'KOPI',
        price: dto.price,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateMenuItemDto) {
    await this.findOne(id);
    return this.prisma.menuItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  /**
   * Menu yang pernah dipesan TIDAK dihapus, hanya dinonaktifkan: riwayat nota &
   * pembukuan harus tetap bisa dibaca (lihat nameSnapshot di OrderItem). Menghapus
   * paksa akan memutus nama menu dari laporan penjualan lama.
   */
  async remove(id: number) {
    const item = await this.findOne(id);
    const used = await this.prisma.orderItem.count({ where: { menuItemId: id } });

    if (used > 0) {
      const updated = await this.prisma.menuItem.update({
        where: { id },
        data: { active: false },
      });
      return {
        deleted: false,
        deactivated: true,
        id,
        name: updated.name,
        message: `"${item.name}" sudah pernah dipesan di ${used} baris nota, jadi hanya dinonaktifkan (tidak muncul lagi saat membuat pesanan). Riwayat tetap utuh.`,
      };
    }

    await this.prisma.menuItem.delete({ where: { id } });
    return { deleted: true, deactivated: false, id, name: item.name, message: `Menu "${item.name}" dihapus.` };
  }
}
