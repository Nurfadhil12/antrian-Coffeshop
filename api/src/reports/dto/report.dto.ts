import { IsOptional, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class DailyReportQueryDto {
  /** Kosong = hari ini menurut zona waktu toko (SHOP_TIMEZONE). */
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'date harus berformat YYYY-MM-DD' })
  date?: string;
}

export class RangeReportQueryDto {
  /** Kosong = awal bulan berjalan. */
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from harus berformat YYYY-MM-DD' })
  from?: string;

  /** Kosong = hari ini. */
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to harus berformat YYYY-MM-DD' })
  to?: string;
}
