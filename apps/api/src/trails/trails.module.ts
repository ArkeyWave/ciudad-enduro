import { Module } from '@nestjs/common';
import { TrailsController } from './trails.controller.js';
import { TrailsService } from './trails.service.js';

@Module({
  controllers: [TrailsController],
  providers: [TrailsService],
})
export class TrailsModule {}
