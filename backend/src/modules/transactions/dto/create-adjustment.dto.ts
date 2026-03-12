import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  NotEquals,
} from 'class-validator';

export class CreateAdjustmentDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ example: -100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0)
  amount!: number;

  @ApiProperty({ example: 'MANUAL_CORRECTION' })
  @IsString()
  reasonCode!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  comment!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reference?: string;
}

