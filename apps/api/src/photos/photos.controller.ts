import { Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Auth } from '../auth/auth.factory.js';
import { OriginGuard } from '../auth/origin.guard.js';
import { hasRole } from '../auth/roles.js';
import { QueueQuery } from '../trails/dto/list-trails.query.js';
import { ErrorBodyDto } from '../trails/dto/trail.dto.js';
import { UploadThrottleGuard } from '../trails/upload-throttle.js';
import { CreatePhotoBody, CreatePhotoDto, PhotoDto, QueuePhotoDto, UpdatePhotoDto } from './dto/photo.dto.js';
import { PhotosService } from './photos.service.js';

const MiB = 1024 * 1024;
// One file and the two position fields, flat names only (as the GPX upload, plan D2).
export const PHOTO_UPLOAD_LIMITS = {
  fileSize: 10 * MiB,
  files: 1,
  fields: 2,
  parts: 3,
  fieldSize: 64,
  fieldNameSize: 16,
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
};

// Signed-in routes only (no @AllowAnonymous): the auth guard answers 401 first.
@ApiTags('photos')
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller()
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  // Any signed-in user (plan §9 V1–V4). Order: auth (401) → origin (403) → the upload throttle
  // shared with trails (429 TOO_MANY_UPLOADS, admins pass) → multipart parser (413 over 10 MiB) →
  // the pipeline in PhotosService.create.
  @Post('photos')
  @UseGuards(OriginGuard, UploadThrottleGuard)
  @UseInterceptors(FileInterceptor('photo', { limits: PHOTO_UPLOAD_LIMITS }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreatePhotoBody })
  @ApiCreatedResponse({ type: PhotoDto })
  @ApiBadRequestResponse({ type: ErrorBodyDto, description: 'NO_POSITION (no body position and no EXIF GPS), PHOTO_INVALID, or a validation error' })
  @ApiUnsupportedMediaTypeResponse({ type: ErrorBodyDto, description: 'PHOTO_TYPE: not a JPEG, PNG or WebP' })
  @ApiPayloadTooLargeResponse({ type: ErrorBodyDto, description: 'Over 10 MiB, or PHOTO_TOO_LARGE: over 50 megapixels' })
  @ApiUnprocessableEntityResponse({ type: ErrorBodyDto, description: 'NO_TRAIL_NEARBY: no published trail within 50 m' })
  @ApiTooManyRequestsResponse({
    type: ErrorBodyDto,
    description: 'TOO_MANY_UPLOADS: a non-admin made 10 uploads (trails and photos) in 10 min; TOO_MANY_PENDING: 20 photos in review',
  })
  @ApiServiceUnavailableResponse({ type: ErrorBodyDto, description: 'ENCODE_BUSY or STORAGE_UNAVAILABLE; try again' })
  create(
    @Body() body: CreatePhotoDto,
    @UploadedFile(new ParseFilePipe()) file: { buffer: Buffer },
    @Session() session: UserSession<Auth>,
  ): Promise<PhotoDto> {
    const position = body.lat !== undefined && body.lng !== undefined ? { lat: Number(body.lat), lng: Number(body.lng) } : null;
    return this.photos.create({ id: session.user.id, admin: hasRole(session.user.role, ['admin']) }, file.buffer, position);
  }

  @Patch('photos/:id')
  @Roles(['admin'])
  @UseGuards(OriginGuard)
  @ApiOkResponse({ type: PhotoDto })
  @ApiForbiddenResponse({ description: 'Not an admin, or a foreign Origin' })
  @ApiNotFoundResponse({ description: 'No photo has this id' })
  async update(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string, @Body() body: UpdatePhotoDto): Promise<PhotoDto> {
    const photo = await this.photos.setStatus(id, body.status);
    if (!photo) throw new NotFoundException();
    return photo;
  }

  @Get('admin/photos')
  @Roles(['admin'])
  @ApiOkResponse({ type: QueuePhotoDto, isArray: true })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  queue(@Query() query: QueueQuery): Promise<QueuePhotoDto[]> {
    return this.photos.listQueue(query.status);
  }
}
