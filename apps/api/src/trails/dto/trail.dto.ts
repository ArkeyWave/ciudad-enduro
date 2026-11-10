import { ApiProperty } from '@nestjs/swagger';
import { CITIES, DIFFICULTIES, TRAIL_TYPES, type City, type Difficulty, type TrailType } from '../../db/schema/index.js';

export class CoordinatesDto {
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
}

export class TrailSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: CITIES, enumName: 'City' }) city!: City;
  @ApiProperty({ enum: DIFFICULTIES, enumName: 'Difficulty' }) difficulty!: Difficulty;
  @ApiProperty({ enum: TRAIL_TYPES, enumName: 'TrailType' }) type!: TrailType;
  @ApiProperty({ type: CoordinatesDto }) start!: CoordinatesDto;
  @ApiProperty({ type: Number, nullable: true }) distanceM!: number | null;
}

export class TrailDetailDto extends TrailSummaryDto {
  @ApiProperty() description!: string;
  @ApiProperty({ type: CoordinatesDto, nullable: true }) end!: CoordinatesDto | null;
  @ApiProperty({
    description: '[lng, lat] pairs',
    type: 'array',
    items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    nullable: true,
  })
  path!: [number, number][] | null;
  @ApiProperty({ type: Number, nullable: true }) elevationGainM!: number | null;
}
