import { Controller, Get, Query } from '@nestjs/common';
import { DailyReportQueryDto, RangeReportQueryDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** GET /api/reports/daily?date=2026-10-10 — laporan satu hari (penjualan + buku kas) */
  @Get('daily')
  daily(@Query() query: DailyReportQueryDto) {
    return this.reports.daily(query.date);
  }

  /** GET /api/reports/range?from=2026-10-01&to=2026-10-10 — rekap per hari + total */
  @Get('range')
  range(@Query() query: RangeReportQueryDto) {
    return this.reports.range(query.from, query.to);
  }
}
