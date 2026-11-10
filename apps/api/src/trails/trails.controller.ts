import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ListTrailsQuery } from './dto/list-trails.query.js';
import { TrailDetailDto, TrailSummaryDto } from './dto/trail.dto.js';
import { TrailsService } from './trails.service.js';

@ApiTags('trails')
@Controller('trails')
export class TrailsController {
  constructor(private readonly trails: TrailsService) {}

  @Get()
  @ApiOkResponse({ type: TrailSummaryDto, isArray: true })
  list(@Query() query: ListTrailsQuery): Promise<TrailSummaryDto[]> {
    return this.trails.listPublished(query.city);
  }

  @Get(':slug')
  @ApiOkResponse({ type: TrailDetailDto })
  @ApiNotFoundResponse({ description: 'No published trail has this slug' })
  async get(@Param('slug') slug: string): Promise<TrailDetailDto> {
    const trail = await this.trails.findPublished(slug);
    // Missing and unpublished trails get the same response.
    if (!trail) throw new NotFoundException();
    return trail;
  }
}
