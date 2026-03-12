import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class IssuePasswordResetDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;
}
