import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LedgerType, PaymentMethod } from '../../prisma/prisma-client';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateLedgerEntryDto {
  @IsEnum(LedgerType, { message: 'Jenis harus INCOME (pemasukan) atau EXPENSE (pengeluaran)' })
  type!: LedgerType;

  @IsString({ message: 'Kategori wajib diisi' })
  @MinLength(2, { message: 'Kategori minimal 2 karakter' })
  @MaxLength(60, { message: 'Kategori maksimal 60 karakter' })
  category!: string;

  @IsInt({ message: 'Jumlah wajib diisi (rupiah, tanpa desimal)' })
  @Min(1, { message: 'Jumlah minimal Rp1' })
  amount!: number;

  @IsOptional()
  @IsEnum(PaymentMethod, {
    message: 'Metode harus CASH, QRIS, TRANSFER, atau E_WALLET',
  })
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Keterangan maksimal 300 karakter' })
  description?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Tanggal harus berformat YYYY-MM-DD' })
  entryDate?: string;
}

export class UpdateLedgerEntryDto {
  @IsOptional()
  @IsEnum(LedgerType)
  type?: LedgerType;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Kategori minimal 2 karakter' })
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Jumlah minimal Rp1' })
  amount?: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Tanggal harus berformat YYYY-MM-DD' })
  entryDate?: string;
}

export class ListLedgerQueryDto {
  /** Kosong = 30 hari terakhir sampai hari ini (lihat LedgerService.resolveRange). */
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from harus berformat YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to harus berformat YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @IsEnum(LedgerType)
  type?: LedgerType;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
