import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrderType, PaymentMethod, PaymentStatus, QueueStatus } from '../../prisma/prisma-client';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Satu baris pesanan.
 *  - menuItemId  → nama & harga diambil dari menu (cara normal)
 *  - name+unitPrice → item lepas yang tidak ada di menu (mis. titipan/request khusus)
 */
export class OrderItemInputDto {
  @IsOptional()
  @IsInt({ message: 'menuItemId harus angka' })
  @Min(1)
  menuItemId?: number;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Nama item minimal 2 karakter' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsInt({ message: 'Harga satuan harus angka rupiah' })
  @Min(0, { message: 'Harga satuan tidak boleh negatif' })
  unitPrice?: number;

  @IsInt({ message: 'Jumlah wajib diisi' })
  @Min(1, { message: 'Jumlah minimal 1' })
  @Max(99, { message: 'Jumlah maksimal 99 per baris' })
  qty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'Catatan item maksimal 120 karakter' })
  note?: string;
}

export class CreateQueueDto {
  @IsString({ message: 'Nama pelanggan wajib diisi' })
  @MinLength(2, { message: 'Nama pelanggan minimal 2 karakter' })
  @MaxLength(80, { message: 'Nama pelanggan maksimal 80 karakter' })
  customerName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Nomor telepon maksimal 20 karakter' })
  customerPhone?: string;

  @IsOptional()
  @IsEnum(OrderType, { message: 'Tipe pesanan harus DINE_IN atau TAKE_AWAY' })
  orderType?: OrderType;

  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'Nomor meja maksimal 10 karakter' })
  tableNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Catatan maksimal 200 karakter' })
  note?: string;

  @IsOptional()
  @IsInt({ message: 'Barista tidak valid' })
  @Min(1)
  baristaId?: number;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Tanggal harus berformat YYYY-MM-DD' })
  queueDate?: string;

  @IsOptional()
  @IsInt({ message: 'Diskon harus angka rupiah' })
  @Min(0, { message: 'Diskon tidak boleh negatif' })
  discount?: number;

  @IsArray({ message: 'Pesanan harus berisi minimal satu item' })
  @ArrayMinSize(1, { message: 'Pesanan harus berisi minimal satu item' })
  @ArrayMaxSize(50, { message: 'Maksimal 50 baris per pesanan' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
}

export class UpdateQueueDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Nama pelanggan minimal 2 karakter' })
  @MaxLength(80)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerPhone?: string;

  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  tableNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  // null = kosongkan barista
  @IsOptional()
  @IsInt()
  @Min(1)
  baristaId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  discount?: number;

  /** Kalau dikirim, seluruh baris pesanan DIGANTI dengan daftar ini. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Pesanan harus berisi minimal satu item' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items?: OrderItemInputDto[];
}

export class ListQueuesQueryDto {
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Tanggal harus berformat YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsEnum(QueueStatus, {
    message: 'Status harus salah satu dari WAITING, IN_PROGRESS, DONE, CANCELLED',
  })
  status?: QueueStatus;

  @IsOptional()
  @IsEnum(PaymentStatus, { message: 'Status bayar harus UNPAID, PAID, atau VOID' })
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  baristaId?: number;
}

export class StartQueueDto {
  @IsOptional()
  @IsInt({ message: 'Barista tidak valid' })
  @Min(1)
  baristaId?: number;
}

export class PayQueueDto {
  @IsEnum(PaymentMethod, {
    message: 'Metode pembayaran harus CASH, QRIS, TRANSFER, atau E_WALLET',
  })
  paymentMethod!: PaymentMethod;

  /** Diskon tambahan saat pembayaran (mis. potongan member). */
  @IsOptional()
  @IsInt({ message: 'Diskon harus angka rupiah' })
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
