import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CreateMenuItemDto, ListMenuQueryDto, UpdateMenuItemDto } from './dto/menu.dto';
import { MenuService } from './menu.service';

@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  /** GET /api/menu?category=KOPI&active=true&q=susu */
  @Get()
  list(@Query() query: ListMenuQueryDto) {
    return this.menu.list(query);
  }

  /** GET /api/menu/:id */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.menu.findOne(id);
  }

  /** POST /api/menu */
  @Post()
  create(@Body() dto: CreateMenuItemDto) {
    return this.menu.create(dto);
  }

  /** PATCH /api/menu/:id */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMenuItemDto) {
    return this.menu.update(id, dto);
  }

  /**
   * DELETE /api/menu/:id
   * Menu yang sudah pernah dipesan otomatis hanya dinonaktifkan (lihat MenuService).
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.menu.remove(id);
  }
}
