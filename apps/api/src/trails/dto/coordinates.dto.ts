import { ApiProperty } from '@nestjs/swagger';

// Its own file: the trail and the photo DTOs both use it, and the trail DTO imports the photo DTO.
export class CoordinatesDto {
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
}
