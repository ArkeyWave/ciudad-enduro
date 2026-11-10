import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CITIES, type City } from '../../db/schema/index.js';

export class ListTrailsQuery {
  @ApiPropertyOptional({ enum: CITIES, enumName: 'City' })
  @IsOptional()
  @IsIn(CITIES)
  city?: City;
}
