import { Injectable } from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { CompanySettingsService } from '../company-settings/company-settings.service';
import { LedgerAllocation, LedgerLot, LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

type WarningSweepResult = {
  candidateEmployees: number;
  notificationsCreated: number;
  lotsWarned: number;
  totalWarningAmount: string;
};

type ExpirationSweepResult = {
  candidateEmployees: number;
  transactionsCreated: number;
  expiredLots: number;
  totalExpiredAmount: string;
};

@Injectable()
export class ExpirationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly companySettingsService: CompanySettingsService,
    private readonly ledgerService: LedgerService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async runWarningSweep(
    actor?: RequestActor,
    now = new Date(),
  ): Promise<WarningSweepResult> {
    const settings = await this.companySettingsService.getSettings();
    const warningCutoff = this.addDays(now, settings.expirationWarningDays);
    const candidateEmployeeIds = await this.findCandidateEmployeeIds({
      gt: now,
      lte: warningCutoff,
    });
    let notificationsCreated = 0;
    let lotsWarned = 0;
    let totalWarningAmount = new Prisma.Decimal(0);

    for (const employeeId of candidateEmployeeIds) {
      const state = await this.ledgerService.getEmployeeState(employeeId, this.prisma, {
        upTo: now,
      });
      const warnableLots = state.availableLots.filter(
        (lot) =>
          lot.expiresAt !== null &&
          lot.expiresAt.getTime() > now.getTime() &&
          lot.expiresAt.getTime() <= warningCutoff.getTime(),
      );

      if (warnableLots.length === 0) {
        continue;
      }

      const warnedSourceIds = await this.findAlreadyWarnedSourceIds(
        warnableLots.map((lot) => lot.sourceTransactionId),
      );
      const pendingLots = warnableLots.filter(
        (lot) => !warnedSourceIds.has(lot.sourceTransactionId),
      );

      if (pendingLots.length === 0) {
        continue;
      }

      const totalAmount = this.sumLots(pendingLots);
      const notificationCreated = await this.prisma.$transaction(async (tx) => {
        const notification = await this.notificationsService.createForEmployee(
          employeeId,
          {
            type: NotificationType.POINTS_EXPIRING,
            title: 'Points expiring soon',
            body: this.buildWarningBody(pendingLots),
          },
          tx,
        );

        if (!notification) {
          return false;
        }

        await tx.auditEvent.createMany({
          data: pendingLots.map((lot) => ({
            actorId: actor?.userId ?? null,
            action: 'expiration.warning_sent',
            entityType: 'Transaction',
            entityId: lot.sourceTransactionId,
            payload: {
              employeeId,
              amount: lot.amount.toString(),
              expiresAt: lot.expiresAt?.toISOString() ?? null,
            },
          })),
        });

        return true;
      });

      if (!notificationCreated) {
        continue;
      }

      notificationsCreated += 1;
      lotsWarned += pendingLots.length;
      totalWarningAmount = totalWarningAmount.add(totalAmount);
    }

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'expiration.warning_sweep_completed',
      entityType: 'System',
      entityId: 'expiration',
      payload: {
        candidateEmployees: candidateEmployeeIds.length,
        notificationsCreated,
        lotsWarned,
        totalWarningAmount: totalWarningAmount.toString(),
      },
    });

    return {
      candidateEmployees: candidateEmployeeIds.length,
      notificationsCreated,
      lotsWarned,
      totalWarningAmount: totalWarningAmount.toString(),
    };
  }

  async runExpirationSweep(
    actor?: RequestActor,
    now = new Date(),
  ): Promise<ExpirationSweepResult> {
    const candidateEmployeeIds = await this.findCandidateEmployeeIds({
      lte: now,
    });
    let transactionsCreated = 0;
    let expiredLots = 0;
    let totalExpiredAmount = new Prisma.Decimal(0);

    for (const employeeId of candidateEmployeeIds) {
      const result = await this.prisma.runInSerializableTransaction(async (tx) => {
        const state = await this.ledgerService.getEmployeeState(employeeId, tx, {
          upTo: now,
        });
        const expiredAvailableLots = state.availableLots.filter(
          (lot) =>
            lot.expiresAt !== null &&
            lot.expiresAt.getTime() <= now.getTime() &&
            lot.amount.gt(0),
        );

        if (expiredAvailableLots.length === 0) {
          return null;
        }

        const totalAmount = this.sumLots(expiredAvailableLots);
        const expirationTransaction = await tx.transaction.create({
          data: {
            employeeId,
            authorId: actor?.userId,
            type: TransactionType.EXPIRATION,
            status: TransactionStatus.CONFIRMED,
            amount: totalAmount,
            sourceTransactionId:
              expiredAvailableLots.length === 1
                ? expiredAvailableLots[0].sourceTransactionId
                : null,
            comment: 'Points expired automatically by company expiration rules.',
            metadata: this.buildAllocationsMetadata(expiredAvailableLots),
            effectiveAt: now,
          },
        });

        await this.ledgerService.rebuildEmployeeSnapshot(employeeId, tx);

        const notification = await this.notificationsService.createForEmployee(
          employeeId,
          {
            type: NotificationType.POINTS_EXPIRED,
            title: 'Points expired',
            body: this.buildExpirationBody(expiredAvailableLots, totalAmount),
          },
          tx,
        );

        await tx.auditEvent.create({
          data: {
            actorId: actor?.userId ?? null,
            action: 'expiration.applied',
            entityType: 'Transaction',
            entityId: expirationTransaction.id,
            payload: {
              employeeId,
              amount: totalAmount.toString(),
              lots: expiredAvailableLots.length,
              notified: notification !== null,
            },
          },
        });

        return {
          amount: totalAmount,
          lots: expiredAvailableLots.length,
        };
      });

      if (!result) {
        continue;
      }

      transactionsCreated += 1;
      expiredLots += result.lots;
      totalExpiredAmount = totalExpiredAmount.add(result.amount);
    }

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'expiration.sweep_completed',
      entityType: 'System',
      entityId: 'expiration',
      payload: {
        candidateEmployees: candidateEmployeeIds.length,
        transactionsCreated,
        expiredLots,
        totalExpiredAmount: totalExpiredAmount.toString(),
      },
    });

    return {
      candidateEmployees: candidateEmployeeIds.length,
      transactionsCreated,
      expiredLots,
      totalExpiredAmount: totalExpiredAmount.toString(),
    };
  }

  private async findCandidateEmployeeIds(
    expiresAt: Prisma.DateTimeNullableFilter,
  ): Promise<string[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        status: TransactionStatus.CONFIRMED,
        expiresAt,
      },
      distinct: ['employeeId'],
      select: {
        employeeId: true,
      },
    });

    return rows.map((row) => row.employeeId);
  }

  private async findAlreadyWarnedSourceIds(
    sourceTransactionIds: string[],
  ): Promise<Set<string>> {
    if (sourceTransactionIds.length === 0) {
      return new Set();
    }

    const events = await this.prisma.auditEvent.findMany({
      where: {
        action: 'expiration.warning_sent',
        entityType: 'Transaction',
        entityId: {
          in: sourceTransactionIds,
        },
      },
      select: {
        entityId: true,
      },
    });

    return new Set(events.map((event) => event.entityId));
  }

  private buildAllocationsMetadata(
    lots: LedgerLot[],
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (lots.length === 0) {
      return Prisma.JsonNull;
    }

    const allocations: LedgerAllocation[] = lots.map((lot) => ({
      sourceTransactionId: lot.sourceTransactionId,
      amount: lot.amount.toString(),
      expiresAt: lot.expiresAt?.toISOString() ?? null,
    }));

    return { allocations };
  }

  private buildWarningBody(lots: LedgerLot[]): string {
    const firstExpiration = lots[0].expiresAt!;
    const lastExpiration = lots[lots.length - 1].expiresAt!;
    const totalAmount = this.sumLots(lots).toString();

    if (this.sameDay(firstExpiration, lastExpiration)) {
      return `${totalAmount} points will expire on ${this.formatCalendarDate(firstExpiration)}.`;
    }

    return `${totalAmount} points will expire between ${this.formatCalendarDate(firstExpiration)} and ${this.formatCalendarDate(lastExpiration)}.`;
  }

  private buildExpirationBody(
    lots: LedgerLot[],
    totalAmount: Prisma.Decimal,
  ): string {
    const firstExpiration = lots[0].expiresAt!;
    const lastExpiration = lots[lots.length - 1].expiresAt!;

    if (this.sameDay(firstExpiration, lastExpiration)) {
      return `${totalAmount.toString()} points expired on ${this.formatCalendarDate(firstExpiration)}.`;
    }

    return `${totalAmount.toString()} points expired automatically for balances dated between ${this.formatCalendarDate(firstExpiration)} and ${this.formatCalendarDate(lastExpiration)}.`;
  }

  private sumLots(lots: LedgerLot[]): Prisma.Decimal {
    return lots.reduce(
      (total, lot) => total.add(lot.amount),
      new Prisma.Decimal(0),
    );
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private sameDay(left: Date, right: Date): boolean {
    return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
  }

  private formatCalendarDate(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
