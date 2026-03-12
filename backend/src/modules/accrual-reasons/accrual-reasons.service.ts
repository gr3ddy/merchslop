import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccrualReasonDto } from './dto/create-accrual-reason.dto';
import { UpdateAccrualReasonDto } from './dto/update-accrual-reason.dto';

const DEFAULT_REASONS: Array<{
  code: string;
  title: string;
  description: string;
  appliesToAccrual: boolean;
  appliesToAdjustment: boolean;
}> = [
  {
    code: 'EVENT_PARTICIPATION',
    title: 'Участие в мероприятии',
    description: 'Начисление за участие в корпоративной активности.',
    appliesToAccrual: true,
    appliesToAdjustment: false,
  },
  {
    code: 'SPECIAL_ACHIEVEMENT',
    title: 'Особое достижение',
    description: 'Разовое поощрение за вклад или достижение.',
    appliesToAccrual: true,
    appliesToAdjustment: false,
  },
  {
    code: 'MANUAL_CORRECTION',
    title: 'Ручная корректировка',
    description: 'Коррекция баланса по административному решению.',
    appliesToAccrual: false,
    appliesToAdjustment: true,
  },
];

@Injectable()
export class AccrualReasonsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const reason of DEFAULT_REASONS) {
      await this.prisma.accrualReason.upsert({
        where: {
          code: reason.code,
        },
        update: {
          title: reason.title,
          description: reason.description,
          appliesToAccrual: reason.appliesToAccrual,
          appliesToAdjustment: reason.appliesToAdjustment,
          isActive: true,
        },
        create: {
          ...reason,
          isActive: true,
        },
      });
    }
  }

  findAll() {
    return this.prisma.accrualReason.findMany({
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
    });
  }

  async create(payload: CreateAccrualReasonDto, actor?: RequestActor) {
    const existing = await this.prisma.accrualReason.findUnique({
      where: {
        code: payload.code,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Accrual reason with code "${payload.code}" already exists.`,
      );
    }

    const reason = await this.prisma.accrualReason.create({
      data: {
        code: payload.code,
        title: payload.title,
        description: payload.description,
        appliesToAccrual: payload.appliesToAccrual ?? true,
        appliesToAdjustment: payload.appliesToAdjustment ?? false,
        isActive: payload.isActive ?? true,
      },
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'accrual_reason.created',
      entityType: 'AccrualReason',
      entityId: reason.id,
      payload: {
        code: reason.code,
      },
    });

    return reason;
  }

  async update(
    reasonId: string,
    payload: UpdateAccrualReasonDto,
    actor?: RequestActor,
  ) {
    const existing = await this.prisma.accrualReason.findUnique({
      where: {
        id: reasonId,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Accrual reason "${reasonId}" was not found.`);
    }

    if (payload.code && payload.code !== existing.code) {
      const duplicate = await this.prisma.accrualReason.findUnique({
        where: {
          code: payload.code,
        },
      });

      if (duplicate) {
        throw new ConflictException(
          `Accrual reason with code "${payload.code}" already exists.`,
        );
      }
    }

    const updated = await this.prisma.accrualReason.update({
      where: {
        id: reasonId,
      },
      data: payload,
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'accrual_reason.updated',
      entityType: 'AccrualReason',
      entityId: updated.id,
      payload: {
        previousCode: existing.code,
        nextCode: updated.code,
        isActive: updated.isActive,
      },
    });

    return updated;
  }
}
