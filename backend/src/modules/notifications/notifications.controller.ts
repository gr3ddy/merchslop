import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
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

  @Get('me/summary')
  @ApiOperation({ summary: 'Returns unread and total notifications counters.' })
  getMyNotificationSummary(@CurrentActor('userId') userId?: string) {
    return this.notificationsService.getMyNotificationSummary(userId);
  }

  @Patch('me/read-all')
  @ApiOperation({ summary: 'Marks all current actor notifications as read.' })
  markAllAsRead(@CurrentActor('userId') userId?: string) {
    return this.notificationsService.markAllMyNotificationsAsRead(userId);
  }

  @Patch('me/:notificationId/read')
  @ApiOperation({ summary: 'Marks one notification as read.' })
  markAsRead(
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
    @CurrentActor('userId') userId?: string,
  ) {
    return this.notificationsService.markMyNotificationAsRead(
      notificationId,
      userId,
    );
  }
}
