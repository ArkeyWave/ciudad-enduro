import { AllowAnonymous, Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Auth } from '../auth/auth.factory.js';
import { OriginGuard } from '../auth/origin.guard.js';
import { hasRole } from '../auth/roles.js';
import { ListTrailsQuery } from './dto/list-trails.query.js';
import { TrailDetailDto, TrailSummaryDto } from './dto/trail.dto.js';
import { CreateTrailBody, CreateTrailDto, UpdateTrailDto } from './dto/write-trail.dto.js';
import { TrailsService } from './trails.service.js';

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
  @ApiNotFoundResponse({ description: 'No published trail has this slug (an admin also gets drafts and hidden trails)' })
  async get(@Param('slug') slug: string, @Session() session: UserSession<Auth> | null): Promise<TrailDetailDto> {
    const trail = await this.trails.findBySlug(slug, isAdmin(session));
    // Missing and unpublished trails get the same response.
    if (!trail) throw new NotFoundException();
    return trail;
  }

  // Order: auth guard (401) → role (403) → origin (403) → multipart parser → GPX parser.
  @Post()
  @Roles(['admin']) // the guard applies hasRole's rule (auth/roles.ts)
  @UseGuards(OriginGuard)
  @UseInterceptors(FileInterceptor('gpx', { limits: GPX_UPLOAD_LIMITS }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateTrailBody })
  @ApiCreatedResponse({ type: TrailDetailDto })
  create(
    @Body() body: CreateTrailDto,
    @UploadedFile(new ParseFilePipe()) file: { buffer: Buffer },
    @Session() session: UserSession<Auth>,
  ): Promise<TrailDetailDto> {
    return this.trails.createFromGpx(body, session.user.id, file.buffer);
  }

  @Patch(':slug')
  @Roles(['admin'])
  @UseGuards(OriginGuard)
  @ApiOkResponse({ type: TrailDetailDto })
  @ApiNotFoundResponse({ description: 'No trail has this slug' })
  async update(@Param('slug') slug: string, @Body() body: UpdateTrailDto): Promise<TrailDetailDto> {
    const trail = await this.trails.update(slug, body);
    if (!trail) throw new NotFoundException();
    return trail;
  }
}
