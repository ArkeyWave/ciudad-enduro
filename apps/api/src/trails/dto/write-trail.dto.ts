import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, Length, MaxLength, NotContains, ValidateIf } from 'class-validator';
import {
  CITIES,
  DIFFICULTIES,
  TRAIL_STATUSES,
  TRAIL_TYPES,
  type City,
  type Difficulty,
  type TrailStatus,
  type TrailType,
} from '../../db/schema/index.js';

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 2000;

// Postgres text cannot store U+0000 (a 500 otherwise).
const noNul = NotContains('\u0000', { message: '$property must not contain U+0000' });

/** The text fields of the multipart upload; the file is the `gpx` part. */
export class CreateTrailDto {
  @ApiProperty({ minLength: 1, maxLength: NAME_MAX })
  @IsString()
  @Length(1, NAME_MAX)
  @noNul
  name!: string;

  @ApiProperty({ enum: CITIES, enumName: 'City' })
  @IsIn(CITIES)
  city!: City;

  @ApiProperty({ enum: DIFFICULTIES, enumName: 'Difficulty' })
  @IsIn(DIFFICULTIES)
  difficulty!: Difficulty;

  @ApiProperty({ enum: TRAIL_TYPES, enumName: 'TrailType' })
  @IsIn(TRAIL_TYPES)
  type!: TrailType;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  @noNul
  description?: string;
}

/** The multipart body as OpenAPI shows it. */
export class CreateTrailBody extends CreateTrailDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'One GPX file, at most 10 MiB' })
  gpx!: unknown;
}

// Every field optional, but a present field is validated: `null` is refused (plan M2).
const present = ValidateIf((_, v) => v !== undefined);

export class UpdateTrailDto {
  @ApiPropertyOptional({ enum: TRAIL_STATUSES, enumName: 'TrailStatus' })
  @present
  @IsIn(TRAIL_STATUSES)
  status?: TrailStatus;

  @ApiPropertyOptional({ minLength: 1, maxLength: NAME_MAX })
  @present
  @IsString()
  @Length(1, NAME_MAX)
  @noNul
  name?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX })
  @present
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  @noNul
  description?: string;

  @ApiPropertyOptional({ enum: CITIES, enumName: 'City' })
  @present
  @IsIn(CITIES)
  city?: City;

  @ApiPropertyOptional({ enum: DIFFICULTIES, enumName: 'Difficulty' })
  @present
  @IsIn(DIFFICULTIES)
  difficulty?: Difficulty;

  @ApiPropertyOptional({ enum: TRAIL_TYPES, enumName: 'TrailType' })
  @present
  @IsIn(TRAIL_TYPES)
  type?: TrailType;
}
