import { AllowAnonymous, Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseFilePipe,
  type PipeTransform,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Auth } from '../auth/auth.factory.js';
import { OriginGuard } from '../auth/origin.guard.js';
import { hasRole } from '../auth/roles.js';
import { ListTrailsQuery } from './dto/list-trails.query.js';
import { ErrorBodyDto, TrailDetailDto, TrailSummaryDto } from './dto/trail.dto.js';
import { CreateTrailBody, CreateTrailDto, UpdateTrailDto } from './dto/write-trail.dto.js';
import { TrailsService } from './trails.service.js';
import { UploadThrottleGuard } from './upload-throttle.js';

const MiB = 1024 * 1024;
// Multer limits (plan D2, M8): one file, at most 6 text fields, 8 KiB per field. Field names are
// flat: no `a[b]` nesting and no `a[0]` array (Nest's own defaults would allow depth 32, index 1000).
export const GPX_UPLOAD_LIMITS = {
  fileSize: 10 * MiB,
  files: 1,
  fields: 6,
  parts: 7,
  fieldSize: 8 * 1024,
  fieldNameSize: 32,
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
};

// No stored slug holds U+0000, and Postgres refuses it in a text parameter (a 500): such a slug is
// unknown. On both :slug handlers; a pipe runs after the guards, so PATCH still checks auth first.
export const SlugPipe: PipeTransform<string, string> = {
  transform(slug) {
    if (slug.includes('\0')) throw new NotFoundException();
    return slug;
  },
};

const isAdmin = (session: UserSession<Auth> | null) => hasRole(session?.user.role, ['admin']);

// @AllowAnonymous() stays on the GET handlers: on the class it would turn @Roles off, because the
// auth guard returns early for a public route before it checks roles.
@ApiTags('trails')
@Controller('trails')
export class TrailsController {
  constructor(private readonly trails: TrailsService) {}

  @Get()
  @AllowAnonymous()
  @ApiOkResponse({ type: TrailSummaryDto, isArray: true })
  list(@Query() query: ListTrailsQuery): Promise<TrailSummaryDto[]> {
    return this.trails.listPublished(query.city);
  }

  @Get(':slug')
  @AllowAnonymous()
  @ApiOkResponse({ type: TrailDetailDto })
  @ApiNotFoundResponse({ description: 'No published trail has this slug (an admin gets every trail, an author also their own drafts and hidden trails)' })
  async get(@Param('slug', SlugPipe) slug: string, @Session() session: UserSession<Auth> | null): Promise<TrailDetailDto> {
    const trail = await this.trails.findBySlug(slug, { id: session?.user.id ?? null, admin: isAdmin(session) });
    // Missing and unpublished trails get the same response.
    if (!trail) throw new NotFoundException();
    return trail;
  }

  // Any signed-in user (plan R-D1). Order: auth guard (401) → origin (403) → upload throttle for a
  // non-admin (429 TOO_MANY_UPLOADS) → multipart parser → pending limit for a non-admin (429
  // TOO_MANY_PENDING, rechecked under a lock at the insert) → GPX parser.
  @Post()
  @UseGuards(OriginGuard, UploadThrottleGuard)
  @UseInterceptors(FileInterceptor('gpx', { limits: GPX_UPLOAD_LIMITS }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateTrailBody })
  @ApiCreatedResponse({ type: TrailDetailDto })
  @ApiBadRequestResponse({ type: ErrorBodyDto, description: 'GPX_* or SLUG_EMPTY, or a validation error' })
  @ApiConflictResponse({ type: ErrorBodyDto, description: 'GPX_DUPLICATE (slug only when visible to the uploader) or SLUG_TAKEN' })
  @ApiTooManyRequestsResponse({
    type: ErrorBodyDto,
    description: 'TOO_MANY_UPLOADS: a non-admin made 10 attempts in 10 min; TOO_MANY_PENDING: a non-admin already has 3 drafts',
  })
  create(
    @Body() body: CreateTrailDto,
    @UploadedFile(new ParseFilePipe()) file: { buffer: Buffer },
    @Session() session: UserSession<Auth>,
  ): Promise<TrailDetailDto> {
    return this.trails.createFromGpx(body, { id: session.user.id, admin: isAdmin(session) }, file.buffer);
  }

  @Patch(':slug')
  @Roles(['admin'])
  @UseGuards(OriginGuard)
  @ApiOkResponse({ type: TrailDetailDto })
  @ApiNotFoundResponse({ description: 'No trail has this slug' })
  async update(@Param('slug', SlugPipe) slug: string, @Body() body: UpdateTrailDto): Promise<TrailDetailDto> {
    const trail = await this.trails.update(slug, body);
    if (!trail) throw new NotFoundException();
    return trail;
  }
}
