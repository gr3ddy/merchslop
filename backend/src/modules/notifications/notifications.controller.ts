import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@DevActorHeaders()
@Roles(UserRole.EMPLOYEE, UserRole.PROGRAM_ADMIN)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Lists notifications for current actor.' })
  getMyNotifications(@CurrentActor('userId') userId?: string) {
    return this.notificationsService.getMyNotifications(userId);
  }
}
