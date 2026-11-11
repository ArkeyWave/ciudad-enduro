import { Module } from '@nestjs/common';
import { TrailListsController } from './trail-lists.controller.js';
import { TrailsController } from './trails.controller.js';
import { TrailsService } from './trails.service.js';
import { UploadAttempts } from './upload-throttle.js';

@Module({
  controllers: [TrailsController, TrailListsController],
  providers: [TrailsService, UploadAttempts],
})
export class TrailsModule {}
