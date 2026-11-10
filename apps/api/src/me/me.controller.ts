import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Auth } from '../auth/auth.factory.js';

export class MeDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['rider', 'admin'] }) role!: string;
}

@ApiTags('me')
@Controller('me')
export class MeController {
  @Get()
  @ApiOkResponse({ type: MeDto })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  get(@Session() session: UserSession<Auth>): MeDto {
    const { id, email, name, role } = session.user;
    return { id, email, name, role };
  }
}
