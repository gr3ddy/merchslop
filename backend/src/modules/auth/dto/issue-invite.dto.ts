import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class IssueInviteDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;
}
