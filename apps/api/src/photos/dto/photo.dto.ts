import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsLatitude, IsLongitude, ValidateIf } from 'class-validator';
import { TRAIL_STATUSES, type TrailStatus } from '../../db/schema/index.js';
import { CoordinatesDto } from '../../trails/dto/coordinates.dto.js';

/** A photo on a trail (plan §9 V5): the timeline and the map markers. */
export class TrailPhotoDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: TRAIL_STATUSES, enumName: 'TrailStatus' }) status!: TrailStatus;
  @ApiProperty({ description: '0 at the trail start, 1 at its end' }) lineFraction!: number;
  @ApiProperty({ type: CoordinatesDto }) position!: CoordinatesDto;
  @ApiProperty({ type: Number, nullable: true, description: 'Degrees from north (EXIF GPSImgDirection)' }) heading!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) takenAt!: string | null;
  @ApiProperty({ description: 'WebP, at most 1600 px' }) url!: string;
  @ApiProperty({ description: 'WebP, 160 px square' }) thumbUrl!: string;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
}

/** A photo with its trail: the upload answer and the PATCH answer. */
export class PhotoDto extends TrailPhotoDto {
  @ApiProperty() trailSlug!: string;
  @ApiProperty() trailName!: string;
}

/** A photo in the admin moderation queue. */
export class QueuePhotoDto extends PhotoDto {
  @ApiProperty({ type: String, nullable: true, description: 'Null when the author was deleted' }) authorEmail!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

// Both or neither: a lone coordinate is a 400.
const withPosition = ValidateIf((body: CreatePhotoDto) => body.lat !== undefined || body.lng !== undefined);

/** The text fields of the multipart upload; the file is the `photo` part. */
export class CreatePhotoDto {
  @ApiPropertyOptional({ type: String, description: 'The phone position (accuracy ≤ 30 m, age ≤ 10 s); else the EXIF GPS' })
  @withPosition
  @IsLatitude()
  lat?: string;

  @ApiPropertyOptional({ type: String })
  @withPosition
  @IsLongitude()
  lng?: string;
}

/** The multipart body as OpenAPI shows it. */
export class CreatePhotoBody extends CreatePhotoDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'One JPEG, PNG or WebP, at most 10 MiB' })
  photo!: unknown;
}

export class UpdatePhotoDto {
  @ApiProperty({ enum: TRAIL_STATUSES, enumName: 'TrailStatus' })
  @IsIn(TRAIL_STATUSES)
  status!: TrailStatus;
}
