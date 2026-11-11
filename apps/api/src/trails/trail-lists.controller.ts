import { Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Auth } from '../auth/auth.factory.js';
import { QueueQuery } from './dto/list-trails.query.js';
import { MyTrailDto, QueueTrailDto } from './dto/trail.dto.js';
import { TrailsService } from './trails.service.js';

// Signed-in lists of unpublished trails. No @AllowAnonymous: the auth guard answers 401 first.
@ApiTags('trails')
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller()
export class TrailListsController {
  constructor(private readonly trails: TrailsService) {}

  @Get('me/trails')
  @ApiOkResponse({ type: MyTrailDto, isArray: true })
  mine(@Session() session: UserSession<Auth>): Promise<MyTrailDto[]> {
    return this.trails.listByAuthor(session.user.id);
  }

  @Get('admin/trails')
  @Roles(['admin'])
  @ApiOkResponse({ type: QueueTrailDto, isArray: true })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  queue(@Query() query: QueueQuery): Promise<QueueTrailDto[]> {
    return this.trails.listQueue(query.status);
  }
}
