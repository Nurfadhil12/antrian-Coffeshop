import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateQueueDto,
  ListQueuesQueryDto,
  PayQueueDto,
  StartQueueDto,
  UpdateQueueDto,
} from './dto/queue.dto';
import { QueuesService } from './queues.service';

@Controller('queues')
export class QueuesController {
  constructor(private readonly queues: QueuesService) {}

  /** GET /api/queues?date=2026-10-10&status=WAITING&paymentStatus=UNPAID&q=budi */
  @Get()
  list(@Query() query: ListQueuesQueryDto) {
    return this.queues.list(query);
  }

  /** GET /api/queues/summary?date=2026-10-10 — ringkasan ringan untuk header papan antrian */
  @Get('summary')
  summary(@Query() query: ListQueuesQueryDto) {
    return this.queues.summary(query);
  }

  /** GET /api/queues/:id — nota lengkap dengan item pesanannya */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.queues.findOne(id);
  }

  /** POST /api/queues — buat antrian baru (nomor urut otomatis per hari) */
  @Post()
  create(@Body() dto: CreateQueueDto) {
    return this.queues.create(dto);
  }

  /** PATCH /api/queues/:id — ubah nota (hanya selama belum dibayar) */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateQueueDto) {
    return this.queues.update(id, dto);
  }

  /** POST /api/queues/:id/start — panggil pesanan (WAITING → IN_PROGRESS) */
  @Post(':id/start')
  start(@Param('id', ParseIntPipe) id: number, @Body() dto: StartQueueDto) {
    return this.queues.start(id, dto);
  }

  /** POST /api/queues/:id/finish — pesanan selesai (IN_PROGRESS → DONE) */
  @Post(':id/finish')
  finish(@Param('id', ParseIntPipe) id: number) {
    return this.queues.finish(id);
  }

  /** POST /api/queues/:id/cancel — batalkan antrian */
  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.queues.cancel(id);
  }

  /** POST /api/queues/:id/pay — bayar nota + otomatis mencatat pendapatan ke pembukuan */
  @Post(':id/pay')
  pay(@Param('id', ParseIntPipe) id: number, @Body() dto: PayQueueDto) {
    return this.queues.pay(id, dto);
  }

  /** DELETE /api/queues/:id — hapus nota yang belum dibayar (koreksi salah input) */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.queues.remove(id);
  }
}
