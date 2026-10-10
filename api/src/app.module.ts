import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { BaristasModule } from './baristas/baristas.module';
import { LedgerModule } from './ledger/ledger.module';
import { MenuModule } from './menu/menu.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueuesModule } from './queues/queues.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    PrismaModule,
    MenuModule,
    BaristasModule,
    QueuesModule,
    LedgerModule,
    ReportsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
