import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MenuCategory } from '../../prisma/prisma-client';

export class CreateMenuItemDto {
  @IsString({ message: 'Nama menu wajib diisi' })
  @MinLength(2, { message: 'Nama menu minimal 2 karakter' })
  @MaxLength(80, { message: 'Nama menu maksimal 80 karakter' })
  name!: string;

  @IsOptional()
  @IsEnum(MenuCategory, {
    message: 'Kategori harus salah satu dari KOPI, NON_KOPI, MAKANAN, SNACK, LAINNYA',
  })
  category?: MenuCategory;

  @IsInt({ message: 'Harga wajib diisi (rupiah, tanpa desimal)' })
  @Min(0, { message: 'Harga tidak boleh negatif' })
  price!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateMenuItemDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Nama menu minimal 2 karakter' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(MenuCategory)
  category?: MenuCategory;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListMenuQueryDto {
  @IsOptional()
  @IsEnum(MenuCategory)
  category?: MenuCategory;

  // true = hanya yang aktif, false = hanya nonaktif, kosong = semua
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
