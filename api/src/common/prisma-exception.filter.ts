import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../prisma/prisma-client';

/**
 * Menerjemahkan error Prisma yang umum menjadi status HTTP yang masuk akal,
 * supaya pesan mentah database tidak bocor ke pengguna:
 *   P2002 unique constraint  -> 409 Conflict
 *   P2003 foreign key        -> 409 Conflict
 *   P2025 record not found   -> 404 Not Found
 *   P2000 value too long     -> 400 Bad Request
 *   P2021 tabel belum ada    -> 503 (skema tertinggal)
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    const map: Record<string, { status: number; message: string }> = {
      P1000: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Kredensial database ditolak. Periksa DATABASE_URL.' },
      P1001: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Database tidak bisa dijangkau. Periksa host DATABASE_URL dan status database.' },
      P1002: { status: HttpStatus.GATEWAY_TIMEOUT, message: 'Koneksi ke database timeout. Coba beberapa saat lagi.' },
      P1008: { status: HttpStatus.GATEWAY_TIMEOUT, message: 'Operasi database melebihi batas waktu (timeout).' },
      P1017: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Koneksi database ditutup oleh server. Coba lagi.' },
      P2002: { status: HttpStatus.CONFLICT, message: 'Data dengan nilai itu sudah ada (duplikat).' },
      P2003: {
        status: HttpStatus.CONFLICT,
        message: 'Data ini masih dipakai oleh data lain, jadi belum bisa dihapus.',
      },
      P2025: { status: HttpStatus.NOT_FOUND, message: 'Data tidak ditemukan.' },
      P2021: {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'Tabel belum ada di database ini. Jalankan migrasi: npx prisma migrate deploy (lihat deployment/README.md).',
      },
      P2022: {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'Kolom belum ada di database ini — skema tertinggal. Jalankan migrasi: npx prisma migrate deploy.',
      },
      P2010: { status: HttpStatus.BAD_REQUEST, message: 'Query database gagal dijalankan.' },
      P2000: { status: HttpStatus.BAD_REQUEST, message: 'Nilai yang dikirim terlalu panjang.' },
    };

    const hit = map[exception.code];
    const status = hit?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const message = hit?.message ?? 'Terjadi kesalahan pada database.';

    return res.status(status).json({
      statusCode: status,
      error: status === 500 ? 'Internal Server Error' : 'Terjadi masalah pada database',
      message,
      code: exception.code,
    });
  }
}
