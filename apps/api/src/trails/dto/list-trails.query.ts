import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CITIES, TRAIL_STATUSES, type City, type TrailStatus } from '../../db/schema/index.js';

export class ListTrailsQuery {
  @ApiPropertyOptional({ enum: CITIES, enumName: 'City' })
  @IsOptional()
  @IsIn(CITIES)
  city?: City;
}

export class QueueQuery {
  @ApiProperty({ enum: TRAIL_STATUSES, enumName: 'TrailStatus' })
  @IsIn(TRAIL_STATUSES)
  status!: TrailStatus;
}
