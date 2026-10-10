import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../prisma/prisma-client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBaristaDto, ListBaristasQueryDto, UpdateBaristaDto } from './dto/barista.dto';

@Injectable()
export class BaristasService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListBaristasQueryDto) {
    const where: Prisma.BaristaWhereInput = {};
    if (query.active !== undefined) where.active = query.active;
    if (query.q?.trim()) {
      where.name = { contains: query.q.trim(), mode: 'insensitive' };
    }

    const items = await this.prisma.barista.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { queues: true } } },
    });

    return { total: items.length, items };
  }

  async findOne(id: number) {
    const barista = await this.prisma.barista.findUnique({ where: { id } });
    if (!barista) throw new NotFoundException(`Barista #${id} tidak ditemukan`);
    return barista;
  }

  async create(dto: CreateBaristaDto) {
    return this.prisma.barista.create({
      data: {
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateBaristaDto) {
    await this.findOne(id);
    return this.prisma.barista.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  /** Barista yang punya riwayat antrian hanya dinonaktifkan, tidak dihapus. */
  async remove(id: number) {
    const barista = await this.findOne(id);
    const used = await this.prisma.queue.count({ where: { baristaId: id } });

    if (used > 0) {
      await this.prisma.barista.update({ where: { id }, data: { active: false } });
      return {
        deleted: false,
        deactivated: true,
        id,
        name: barista.name,
        message: `"${barista.name}" punya ${used} riwayat antrian, jadi hanya dinonaktifkan. Riwayat tetap utuh.`,
      };
    }

    await this.prisma.barista.delete({ where: { id } });
    return {
      deleted: true,
      deactivated: false,
      id,
      name: barista.name,
      message: `Barista "${barista.name}" dihapus.`,
    };
  }
}
