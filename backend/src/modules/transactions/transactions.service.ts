import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  NotificationType,
  Prisma,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccrualDto } from './dto/create-accrual.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createAccrual(payload: CreateAccrualDto, actor?: RequestActor) {
    const amount = new Prisma.Decimal(payload.amount);

    if (amount.lte(0)) {
      throw new BadRequestException('Accrual amount must be greater than zero.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({
        where: {
          id: payload.employeeId,
        },
        include: {
          balanceSnapshot: true,
        },
      });

      if (!employee) {
        throw new NotFoundException(
          `Employee "${payload.employeeId}" was not found.`,
        );
      }

      if (employee.status !== EmployeeStatus.ACTIVE) {
        throw new ConflictException('Cannot accrue points to inactive employee.');
      }

      const reason = await tx.accrualReason.findUnique({
        where: {
          code: payload.reasonCode,
        },
      });

      if (!reason || !reason.isActive || !reason.appliesToAccrual) {
        throw new BadRequestException(
          `Accrual reason "${payload.reasonCode}" is invalid for accruals.`,
        );
      }

      const currentAvailable =
        employee.balanceSnapshot?.availableAmount ?? new Prisma.Decimal(0);
      const currentReserved =
        employee.balanceSnapshot?.reservedAmount ?? new Prisma.Decimal(0);
      const nextAvailable = currentAvailable.add(amount);

      const transaction = await tx.transaction.create({
        data: {
          employeeId: employee.id,
          authorId: actor?.userId,
          type: TransactionType.ACCRUAL,
          status: TransactionStatus.CONFIRMED,
          amount,
          reasonId: reason.id,
          comment: payload.comment,
          effectiveAt: new Date(),
        },
      });

      await tx.balanceSnapshot.upsert({
        where: {
          employeeId: employee.id,
        },
        create: {
          employeeId: employee.id,
          availableAmount: nextAvailable,
          reservedAmount: currentReserved,
        },
        update: {
          availableAmount: nextAvailable,
        },
      });

      await this.notificationsService.createForEmployee(
        employee.id,
        {
          type: NotificationType.BALANCE_ACCRUAL,
          title: 'Points accrued',
          body: `You received ${amount.toString()} points for "${reason.title}".`,
        },
        tx,
      );

      return {
        transaction,
        balance: {
          availableAmount: nextAvailable,
          reservedAmount: currentReserved,
        },
      };
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'transaction.accrual_created',
      entityType: 'Transaction',
      entityId: result.transaction.id,
      payload: {
        employeeId: payload.employeeId,
        amount: payload.amount,
        reasonCode: payload.reasonCode,
      },
    });

    return result;
  }

  async createAdjustment(payload: CreateAdjustmentDto, actor?: RequestActor) {
    const amount = new Prisma.Decimal(payload.amount);

    if (amount.eq(0)) {
      throw new BadRequestException('Adjustment amount cannot be zero.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({
        where: {
          id: payload.employeeId,
        },
        include: {
          balanceSnapshot: true,
        },
      });

      if (!employee) {
        throw new NotFoundException(
          `Employee "${payload.employeeId}" was not found.`,
        );
      }

      const reason = await tx.accrualReason.findUnique({
        where: {
          code: payload.reasonCode,
        },
      });

      if (!reason || !reason.isActive || !reason.appliesToAdjustment) {
        throw new BadRequestException(
          `Adjustment reason "${payload.reasonCode}" is invalid for adjustments.`,
        );
      }

      const currentAvailable =
        employee.balanceSnapshot?.availableAmount ?? new Prisma.Decimal(0);
      const currentReserved =
        employee.balanceSnapshot?.reservedAmount ?? new Prisma.Decimal(0);
      const nextAvailable = currentAvailable.add(amount);

      if (nextAvailable.lt(0)) {
        throw new ConflictException(
          'Adjustment would make available balance negative.',
        );
      }

      const transaction = await tx.transaction.create({
        data: {
          employeeId: employee.id,
          authorId: actor?.userId,
          type: TransactionType.ADJUSTMENT,
          status: TransactionStatus.CONFIRMED,
          amount,
          reasonId: reason.id,
          comment: payload.comment,
          metadata: payload.reference
            ? {
                reference: payload.reference,
              }
            : Prisma.JsonNull,
          effectiveAt: new Date(),
        },
      });

      await tx.balanceSnapshot.upsert({
        where: {
          employeeId: employee.id,
        },
        create: {
          employeeId: employee.id,
          availableAmount: nextAvailable,
          reservedAmount: currentReserved,
        },
        update: {
          availableAmount: nextAvailable,
        },
      });

      await this.notificationsService.createForEmployee(
        employee.id,
        {
          type: NotificationType.BALANCE_ADJUSTMENT,
          title: 'Balance adjusted',
          body: `Your balance was ${
            amount.gt(0) ? 'increased' : 'decreased'
          } by ${amount.abs().toString()} points for "${reason.title}".`,
        },
        tx,
      );

      return {
        transaction,
        balance: {
          availableAmount: nextAvailable,
          reservedAmount: currentReserved,
        },
      };
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'transaction.adjustment_created',
      entityType: 'Transaction',
      entityId: result.transaction.id,
      payload: {
        employeeId: payload.employeeId,
        amount: payload.amount,
        reasonCode: payload.reasonCode,
        reference: payload.reference ?? null,
      },
    });

    return result;
  }
}
