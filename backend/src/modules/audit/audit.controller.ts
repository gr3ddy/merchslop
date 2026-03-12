import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@DevActorHeaders()
@Roles(UserRole.PROGRAM_ADMIN)
@Controller('audit-events')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Lists persisted audit events.' })
  findAll(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.auditService.findAll(limit);
  }
}
