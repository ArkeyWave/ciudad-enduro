import { Module } from '@nestjs/common';
import { MediaStorage } from '../photos/media-storage.js';
import { PhotosController } from '../photos/photos.controller.js';
import { PhotosService } from '../photos/photos.service.js';
import { TrailListsController } from './trail-lists.controller.js';
import { TrailsController } from './trails.controller.js';
import { TrailsService } from './trails.service.js';
import { UploadAttempts } from './upload-throttle.js';

// Trails and their photos share the upload throttle (plan §9 V4) and the detail lists the photos.
@Module({
  controllers: [TrailsController, TrailListsController, PhotosController],
  providers: [TrailsService, UploadAttempts, PhotosService, MediaStorage],
})
export class TrailsModule {}
