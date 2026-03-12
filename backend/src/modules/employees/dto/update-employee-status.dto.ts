import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

import { EmployeeStatus } from '../../../common/enums/domain.enum';

export class UpdateEmployeeStatusDto {
  @ApiProperty({ enum: EmployeeStatus })
  @IsEnum(EmployeeStatus)
  status!: EmployeeStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  comment?: string;
}

