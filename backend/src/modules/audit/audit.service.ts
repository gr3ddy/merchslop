import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

type CreateAuditEventInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload?: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(limit = 50) {
    return this.prisma.auditEvent.findMany({
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  createEvent(input: CreateAuditEventInput) {
    return this.prisma.auditEvent.create({
      data: input,
    });
  }
}
