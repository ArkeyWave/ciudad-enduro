import { Module } from '@nestjs/common';
import { TrailListsController } from './trail-lists.controller.js';
import { TrailsController } from './trails.controller.js';
import { TrailsService } from './trails.service.js';

@Module({
  controllers: [TrailsController, TrailListsController],
  providers: [TrailsService],
})
export class TrailsModule {}
