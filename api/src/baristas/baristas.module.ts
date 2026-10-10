import { Module } from '@nestjs/common';
import { BaristasController } from './baristas.controller';
import { BaristasService } from './baristas.service';

@Module({
  controllers: [BaristasController],
  providers: [BaristasService],
  exports: [BaristasService],
})
export class BaristasModule {}
