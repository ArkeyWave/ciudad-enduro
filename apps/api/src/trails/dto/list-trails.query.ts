import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { TRAIL_STATUSES, type TrailStatus } from '../../db/schema/index.js';
import { isUbigeo, UBIGEO_PROPERTY } from './ubigeo.js';

export class ListTrailsQuery {
  @ApiPropertyOptional(UBIGEO_PROPERTY)
  @IsOptional()
  @isUbigeo
  ubigeo?: string;
}

export class QueueQuery {
  @ApiProperty({ enum: TRAIL_STATUSES, enumName: 'TrailStatus' })
  @IsIn(TRAIL_STATUSES)
  status!: TrailStatus;
}
