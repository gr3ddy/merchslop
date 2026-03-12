import { Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { ExpirationService } from './expiration.service';

@ApiTags('expiration')
@ApiBearerAuth()
@DevActorHeaders()
@Roles(UserRole.PROGRAM_ADMIN)
@Controller('expiration')
export class ExpirationController {
  constructor(private readonly expirationService: ExpirationService) {}

  @Post('warnings/run')
  @ApiOperation({ summary: 'Runs the expiring-points warning sweep.' })
  runWarningSweep(@CurrentActor() actor?: RequestActor) {
    return this.expirationService.runWarningSweep(actor);
  }

  @Post('run')
  @ApiOperation({ summary: 'Runs the points expiration sweep.' })
  runExpirationSweep(@CurrentActor() actor?: RequestActor) {
    return this.expirationService.runExpirationSweep(actor);
  }
}
