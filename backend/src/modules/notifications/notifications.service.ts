import { BadRequestException, Injectable } from '@nestjs/common';
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
    if (!userId) {
      throw new BadRequestException(
        'User context is required to list notifications.',
      );
    }

    return this.prisma.notification.findMany({
      where: {
        userId,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
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
}
