import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { BaristasService } from './baristas.service';
import { CreateBaristaDto, ListBaristasQueryDto, UpdateBaristaDto } from './dto/barista.dto';

@Controller('baristas')
export class BaristasController {
  constructor(private readonly baristas: BaristasService) {}

  /** GET /api/baristas?active=true */
  @Get()
  list(@Query() query: ListBaristasQueryDto) {
    return this.baristas.list(query);
  }

  /** GET /api/baristas/:id */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.baristas.findOne(id);
  }

  /** POST /api/baristas */
  @Post()
  create(@Body() dto: CreateBaristaDto) {
    return this.baristas.create(dto);
  }

  /** PATCH /api/baristas/:id */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBaristaDto) {
    return this.baristas.update(id, dto);
  }

  /** DELETE /api/baristas/:id — dengan riwayat antrian hanya dinonaktifkan. */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.baristas.remove(id);
  }
}
