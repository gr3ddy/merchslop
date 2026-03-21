import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateCartDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Active pickup point for the current cart.',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  pickupPointId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Optional checkout comment stored with the cart.',
    maxLength: 500,
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  comment?: string | null;
}
