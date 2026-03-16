import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

type NotificationStore = Prisma.TransactionClient | PrismaService;

type CreateNotificationInput = {
  type: NotificationType;
  title: string;
  body: string;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  getMyNotifications(userId?: string) {
    const resolvedUserId = this.requireUserId(userId);

    return this.prisma.notification.findMany({
      where: {
        userId: resolvedUserId,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async getMyNotificationSummary(userId?: string) {
    const resolvedUserId = this.requireUserId(userId);

    const [totalCount, unreadCount] = await Promise.all([
      this.prisma.notification.count({
        where: {
          userId: resolvedUserId,
        },
      }),
      this.prisma.notification.count({
        where: {
          userId: resolvedUserId,
          readAt: null,
        },
      }),
    ]);

    return {
      totalCount,
      unreadCount,
    };
  }

  async markMyNotificationAsRead(notificationId: string, userId?: string) {
    const resolvedUserId = this.requireUserId(userId);

    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId: resolvedUserId,
      },
    });

    if (!notification) {
      throw new NotFoundException(
        `Notification "${notificationId}" was not found.`,
      );
    }

    if (notification.readAt) {
      return notification;
    }

    return this.prisma.notification.update({
      where: {
        id: notification.id,
      },
      data: {
        readAt: new Date(),
      },
    });
  }

  async markAllMyNotificationsAsRead(userId?: string) {
    const resolvedUserId = this.requireUserId(userId);
    const readAt = new Date();

    const result = await this.prisma.notification.updateMany({
      where: {
        userId: resolvedUserId,
        readAt: null,
      },
      data: {
        readAt,
      },
    });

    return {
      updatedCount: result.count,
      readAt,
    };
  }

  async createForEmployee(
    employeeId: string,
    input: CreateNotificationInput,
    db: NotificationStore = this.prisma,
  ) {
    const user = await db.user.findFirst({
      where: {
        employeeId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return null;
    }

    return this.createForUser(user.id, input, db);
  }

  createForUser(
    userId: string,
    input: CreateNotificationInput,
    db: NotificationStore = this.prisma,
  ) {
    return db.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        sentAt: new Date(),
      },
    });
  }

  private requireUserId(userId?: string): string {
    if (!userId) {
      throw new BadRequestException(
        'User context is required to access notifications.',
      );
    }

    return userId;
  }
}
