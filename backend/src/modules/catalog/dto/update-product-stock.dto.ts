import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateProductStockDto {
  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsInt()
  stockQty?: number;

  @ApiPropertyOptional({ example: -2 })
  @IsOptional()
  @IsInt()
  delta?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
