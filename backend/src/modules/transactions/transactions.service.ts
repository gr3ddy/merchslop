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
import { CompanySettingsService } from '../company-settings/company-settings.service';
import {
  calculateAccrualExpirationDate,
  LedgerAllocation,
  LedgerService,
} from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccrualDto } from './dto/create-accrual.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly companySettingsService: CompanySettingsService,
    private readonly ledgerService: LedgerService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createAccrual(payload: CreateAccrualDto, actor?: RequestActor) {
    const amount = new Prisma.Decimal(payload.amount);
    const settings = await this.companySettingsService.getSettings();

    if (amount.lte(0)) {
      throw new BadRequestException('Accrual amount must be greater than zero.');
    }

    const result = await this.prisma.runInSerializableTransaction(
      async (tx) => {
        const effectiveAt = new Date();
        const expiresAt = calculateAccrualExpirationDate(
          effectiveAt,
          settings.expirationMonths,
        );

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

        const transaction = await tx.transaction.create({
          data: {
            employeeId: employee.id,
            authorId: actor?.userId,
            type: TransactionType.ACCRUAL,
            status: TransactionStatus.CONFIRMED,
            amount,
            reasonId: reason.id,
            comment: payload.comment,
            effectiveAt,
            expiresAt,
          },
        });

        const balance = await this.ledgerService.rebuildEmployeeSnapshot(employee.id, tx);

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
          balance,
        };
      },
    );

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

    const result = await this.prisma.runInSerializableTransaction(
      async (tx) => {
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

        const allocations =
          amount.lt(0)
            ? await this.ledgerService.allocateEmployeeAvailableBalance(
                employee.id,
                amount.abs(),
                tx,
              )
            : [];

        const transaction = await tx.transaction.create({
          data: {
            employeeId: employee.id,
            authorId: actor?.userId,
            type: TransactionType.ADJUSTMENT,
            status: TransactionStatus.CONFIRMED,
            amount,
            reasonId: reason.id,
            comment: payload.comment,
            metadata: this.buildAdjustmentMetadata(payload.reference, allocations),
            effectiveAt: new Date(),
          },
        });

        const balance = await this.ledgerService.rebuildEmployeeSnapshot(employee.id, tx);

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
          balance,
        };
      },
    );

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

  async rebuildBalance(employeeId: string, actor?: RequestActor) {
    const employee = await this.prisma.employee.findUnique({
      where: {
        id: employeeId,
      },
      select: {
        id: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee "${employeeId}" was not found.`);
    }

    const balance = await this.prisma.runInSerializableTransaction(
      async (tx) => this.ledgerService.rebuildEmployeeSnapshot(employeeId, tx),
    );

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'transaction.balance_rebuilt',
      entityType: 'Employee',
      entityId: employeeId,
      payload: {
        availableAmount: balance.availableAmount.toString(),
        reservedAmount: balance.reservedAmount.toString(),
      },
    });

    return balance;
  }

  private buildAdjustmentMetadata(
    reference: string | undefined,
    allocations: LedgerAllocation[],
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (!reference && allocations.length === 0) {
      return Prisma.JsonNull;
    }

    return {
      ...(reference ? { reference } : {}),
      ...(allocations.length > 0 ? { allocations } : {}),
    };
  }
}
