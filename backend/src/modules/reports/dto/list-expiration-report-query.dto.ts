import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ListExpirationReportQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound for expiration effective date.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound for expiration effective date.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsDateString()
  dateTo?: string;
}
