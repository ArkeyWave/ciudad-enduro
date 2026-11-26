import { ApiProperty } from '@nestjs/swagger';
import {
  CITIES,
  DIFFICULTIES,
  TRAIL_STATUSES,
  TRAIL_TYPES,
  type City,
  type Difficulty,
  type ProfilePoint,
  type TrailStatus,
  type TrailType,
} from '../../db/schema/index.js';
import { TrailPhotoDto } from '../../photos/dto/photo.dto.js';
import { CoordinatesDto } from './coordinates.dto.js';

export { CoordinatesDto };

const pairs = (description: string) =>
  ({
    description,
    type: 'array',
    items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    nullable: true,
  }) as const;

/** The body of a 4xx answer: coded errors carry `code`; a validation error has a list of messages. */
export class ErrorBodyDto {
  @ApiProperty({ required: false, example: 'TOO_MANY_PENDING' }) code?: string;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }) message!: string | string[];
  @ApiProperty({ required: false, description: 'GPX_DUPLICATE only, when the uploader may see that trail' }) slug?: string;
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
  @ApiProperty({ type: Number, nullable: true }) elevationGainM!: number | null;
  @ApiProperty({ type: Number, nullable: true }) elevationLossM!: number | null;
  @ApiProperty(pairs('[distance_m, ele_m] pairs, at most 300'))
  elevationProfile!: ProfilePoint[] | null;
}

/** A trail in the author's own list (every status). */
export class MyTrailDto extends TrailSummaryDto {
  @ApiProperty({ enum: TRAIL_STATUSES, enumName: 'TrailStatus' }) status!: TrailStatus;
}

/** A trail in the admin moderation queue. */
export class QueueTrailDto extends MyTrailDto {
  @ApiProperty({ type: String, nullable: true, description: 'Null when the author was deleted' }) authorEmail!: string | null;
}

export class TrailDetailDto extends TrailSummaryDto {
  @ApiProperty({ enum: TRAIL_STATUSES, enumName: 'TrailStatus' }) status!: TrailStatus;
  @ApiProperty() description!: string;
  @ApiProperty({ type: CoordinatesDto, nullable: true }) end!: CoordinatesDto | null;
  @ApiProperty(pairs('[lng, lat] pairs, simplified for display'))
  path!: [number, number][] | null;
  @ApiProperty({ type: Number, nullable: true }) elevationMinM!: number | null;
  @ApiProperty({ type: Number, nullable: true }) elevationMaxM!: number | null;
  @ApiProperty({ type: () => TrailPhotoDto, isArray: true, description: 'Line order; published ones, plus drafts and hidden ones for their author and admins' })
  photos!: TrailPhotoDto[];
}
