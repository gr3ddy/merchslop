import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  getMyNotifications(_userId?: string): never {
    throw new NotImplementedException(
      'Notification persistence will be added together with domain event handlers.',
    );
  }
}

