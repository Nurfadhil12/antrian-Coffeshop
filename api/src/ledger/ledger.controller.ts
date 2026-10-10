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
  CreateLedgerEntryDto,
  ListLedgerQueryDto,
  UpdateLedgerEntryDto,
} from './dto/ledger.dto';
import { LedgerService } from './ledger.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /** GET /api/ledger?from=2026-10-01&to=2026-10-10&type=EXPENSE&method=CASH */
  @Get()
  list(@Query() query: ListLedgerQueryDto) {
    return this.ledger.list(query);
  }

  /** GET /api/ledger/:id */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ledger.findOne(id);
  }

  /** POST /api/ledger — input manual pengeluaran / pemasukan non-kasir */
  @Post()
  create(@Body() dto: CreateLedgerEntryDto) {
    return this.ledger.create(dto);
  }

  /** PATCH /api/ledger/:id — hanya untuk baris manual (bukan dari nota kasir) */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLedgerEntryDto) {
    return this.ledger.update(id, dto);
  }

  /**
   * DELETE /api/ledger/:id
   * Baris dari nota kasir: nota ikut ditandai VOID dalam transaksi yang sama.
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.ledger.remove(id);
  }
}
