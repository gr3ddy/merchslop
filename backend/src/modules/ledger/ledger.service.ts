import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

type LedgerStore = Prisma.TransactionClient | PrismaService;

type ReplayTransaction = {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Prisma.Decimal;
  sourceTransactionId: string | null;
  metadata: Prisma.JsonValue | null;
  effectiveAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
};

export type LedgerAllocation = {
  sourceTransactionId: string;
  amount: string;
  expiresAt: string | null;
};

export type LedgerLot = {
  sourceTransactionId: string;
  amount: Prisma.Decimal;
  expiresAt: Date | null;
};

export type LedgerState = {
  availableLots: LedgerLot[];
  reservedLotsByReference: Map<string, LedgerLot[]>;
  availableAmount: Prisma.Decimal;
  reservedAmount: Prisma.Decimal;
};

export function calculateAccrualExpirationDate(
  effectiveAt: Date,
  expirationMonths: number,
): Date {
  const expiresAt = new Date(effectiveAt);
  expiresAt.setMonth(expiresAt.getMonth() + expirationMonths);
  expiresAt.setHours(23, 59, 59, 999);

  return expiresAt;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async allocateEmployeeAvailableBalance(
    employeeId: string,
    amount: Prisma.Decimal | number | string,
    db: LedgerStore = this.prisma,
  ): Promise<LedgerAllocation[]> {
    const requestedAmount = new Prisma.Decimal(amount);

    if (requestedAmount.lte(0)) {
      return [];
    }

    const state = await this.getEmployeeState(employeeId, db);

    if (state.availableAmount.lt(requestedAmount)) {
      throw new ConflictException('Insufficient available balance.');
    }

    return this.serializeLots(
      this.allocateFromAvailableLots(
        state.availableLots.map((lot) => this.cloneLot(lot)),
        requestedAmount,
      ),
    );
  }

  async getEmployeeState(
    employeeId: string,
    db: LedgerStore = this.prisma,
    options?: {
      upTo?: Date;
    },
  ): Promise<LedgerState> {
    const transactions = await db.transaction.findMany({
      where: {
        employeeId,
        status: TransactionStatus.CONFIRMED,
        effectiveAt: options?.upTo
          ? {
              lte: options.upTo,
            }
          : undefined,
      },
      orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        status: true,
        amount: true,
        sourceTransactionId: true,
        metadata: true,
        effectiveAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return this.replayTransactions(transactions);
  }

  async rebuildEmployeeSnapshot(
    employeeId: string,
    db: LedgerStore = this.prisma,
  ) {
    const state = await this.getEmployeeState(employeeId, db);

    return db.balanceSnapshot.upsert({
      where: {
        employeeId,
      },
      create: {
        employeeId,
        availableAmount: state.availableAmount,
        reservedAmount: state.reservedAmount,
      },
      update: {
        availableAmount: state.availableAmount,
        reservedAmount: state.reservedAmount,
      },
    });
  }

  private replayTransactions(transactions: ReplayTransaction[]): LedgerState {
    const availableLots: LedgerLot[] = [];
    const reservedLotsByReference = new Map<string, LedgerLot[]>();
    const finalizedLotsByReference = new Map<string, LedgerLot[]>();

    for (const transaction of transactions) {
      if (transaction.type === TransactionType.ACCRUAL) {
        this.restoreLotsToAvailable(availableLots, [
          {
            sourceTransactionId: transaction.id,
            amount: transaction.amount,
            expiresAt: transaction.expiresAt,
          },
        ]);
        continue;
      }

      if (transaction.type === TransactionType.ADJUSTMENT) {
        if (transaction.amount.gt(0)) {
          this.restoreLotsToAvailable(availableLots, [
            {
              sourceTransactionId: transaction.id,
              amount: transaction.amount,
              expiresAt: transaction.expiresAt,
            },
          ]);
          continue;
        }

        const adjustmentLots = this.resolveAvailableAllocations(
          transaction,
          availableLots,
        );
        finalizedLotsByReference.set(transaction.id, this.cloneLots(adjustmentLots));
        continue;
      }

      if (transaction.type === TransactionType.RESERVE) {
        const reservedLots = this.resolveAvailableAllocations(transaction, availableLots);
        reservedLotsByReference.set(transaction.id, this.cloneLots(reservedLots));
        continue;
      }

      if (transaction.type === TransactionType.WRITE_OFF) {
        const writeOffLots =
          this.drainLotsByReference(
            reservedLotsByReference,
            transaction.sourceTransactionId,
          ) ?? this.extractMetadataLots(transaction.metadata);

        this.assertLotsMatchTransaction(transaction, writeOffLots);
        finalizedLotsByReference.set(transaction.id, this.cloneLots(writeOffLots));
        continue;
      }

      if (transaction.type === TransactionType.RELEASE) {
        const releasedLots =
          this.drainLotsByReference(
            reservedLotsByReference,
            transaction.sourceTransactionId,
          ) ??
          this.drainLotsByReference(
            finalizedLotsByReference,
            transaction.sourceTransactionId,
          ) ??
          this.extractMetadataLots(transaction.metadata);

        this.assertLotsMatchTransaction(transaction, releasedLots);
        this.restoreLotsToAvailable(availableLots, releasedLots);
        continue;
      }

      if (transaction.type === TransactionType.EXPIRATION) {
        const metadataLots = this.extractMetadataLots(transaction.metadata);
        const expiredLots =
          metadataLots.length > 0
            ? metadataLots
            : this.consumeLotsByReference(
                availableLots,
                transaction.sourceTransactionId,
                transaction.amount,
              );

        if (metadataLots.length > 0) {
          this.consumeSpecificLots(availableLots, metadataLots);
        }

        this.assertLotsMatchTransaction(transaction, expiredLots);
      }
    }

    const normalizedAvailableLots = this.sortLots(availableLots);
    const reservedAmount = Array.from(reservedLotsByReference.values()).reduce(
      (total, lots) => total.add(this.sumLots(lots)),
      new Prisma.Decimal(0),
    );

    return {
      availableLots: normalizedAvailableLots,
      reservedLotsByReference,
      availableAmount: this.sumLots(normalizedAvailableLots),
      reservedAmount,
    };
  }

  private resolveAvailableAllocations(
    transaction: ReplayTransaction,
    availableLots: LedgerLot[],
  ): LedgerLot[] {
    const metadataLots = this.extractMetadataLots(transaction.metadata);

    if (metadataLots.length > 0) {
      this.consumeSpecificLots(availableLots, metadataLots);
      this.assertLotsMatchTransaction(transaction, metadataLots);
      return metadataLots;
    }

    return this.allocateFromAvailableLots(availableLots, transaction.amount.abs());
  }

  private allocateFromAvailableLots(
    availableLots: LedgerLot[],
    amount: Prisma.Decimal,
  ): LedgerLot[] {
    const requestedAmount = new Prisma.Decimal(amount);
    const allocations: LedgerLot[] = [];
    let remainingAmount = new Prisma.Decimal(requestedAmount);

    for (const lot of this.sortLots(availableLots)) {
      if (remainingAmount.lte(0)) {
        break;
      }

      if (lot.amount.lte(0)) {
        continue;
      }

      const allocatedAmount = Prisma.Decimal.min(lot.amount, remainingAmount);

      if (allocatedAmount.lte(0)) {
        continue;
      }

      allocations.push({
        sourceTransactionId: lot.sourceTransactionId,
        amount: allocatedAmount,
        expiresAt: lot.expiresAt,
      });

      lot.amount = lot.amount.sub(allocatedAmount);
      remainingAmount = remainingAmount.sub(allocatedAmount);
    }

    this.pruneEmptyLots(availableLots);

    if (remainingAmount.gt(0)) {
      throw new ConflictException(
        'Ledger replay detected insufficient available balance.',
      );
    }

    return allocations;
  }

  private consumeSpecificLots(
    availableLots: LedgerLot[],
    lotsToConsume: LedgerLot[],
  ): void {
    for (const lotToConsume of lotsToConsume) {
      let remainingAmount = new Prisma.Decimal(lotToConsume.amount);

      for (const availableLot of this.sortLots(availableLots)) {
        if (remainingAmount.lte(0)) {
          break;
        }

        if (
          availableLot.sourceTransactionId !== lotToConsume.sourceTransactionId ||
          !this.sameExpirationDate(availableLot.expiresAt, lotToConsume.expiresAt)
        ) {
          continue;
        }

        const consumedAmount = Prisma.Decimal.min(availableLot.amount, remainingAmount);

        if (consumedAmount.lte(0)) {
          continue;
        }

        availableLot.amount = availableLot.amount.sub(consumedAmount);
        remainingAmount = remainingAmount.sub(consumedAmount);
      }

      if (remainingAmount.gt(0)) {
        throw new ConflictException(
          `Ledger replay could not consume expected lot "${lotToConsume.sourceTransactionId}".`,
        );
      }
    }

    this.pruneEmptyLots(availableLots);
  }

  private consumeLotsByReference(
    availableLots: LedgerLot[],
    sourceTransactionId: string | null,
    amount: Prisma.Decimal,
  ): LedgerLot[] {
    if (!sourceTransactionId) {
      throw new ConflictException(
        'Ledger replay requires a source transaction reference.',
      );
    }

    const matchingLots = this.sortLots(
      availableLots.filter(
        (availableLot) => availableLot.sourceTransactionId === sourceTransactionId,
      ),
    );

    if (matchingLots.length === 0) {
      throw new ConflictException(
        `Ledger replay could not find source transaction "${sourceTransactionId}".`,
      );
    }

    const requestedAmount = new Prisma.Decimal(amount);
    const consumedLots: LedgerLot[] = [];
    let remainingAmount = new Prisma.Decimal(requestedAmount);

    for (const matchingLot of matchingLots) {
      if (remainingAmount.lte(0)) {
        break;
      }

      const consumedAmount = Prisma.Decimal.min(matchingLot.amount, remainingAmount);

      if (consumedAmount.lte(0)) {
        continue;
      }

      consumedLots.push({
        sourceTransactionId: matchingLot.sourceTransactionId,
        amount: consumedAmount,
        expiresAt: matchingLot.expiresAt,
      });

      matchingLot.amount = matchingLot.amount.sub(consumedAmount);
      remainingAmount = remainingAmount.sub(consumedAmount);
    }

    this.pruneEmptyLots(availableLots);

    if (remainingAmount.gt(0)) {
      throw new ConflictException(
        `Ledger replay could not consume full amount from source transaction "${sourceTransactionId}".`,
      );
    }

    return consumedLots;
  }

  private restoreLotsToAvailable(
    availableLots: LedgerLot[],
    lotsToRestore: LedgerLot[],
  ): void {
    for (const lotToRestore of lotsToRestore) {
      const existingLot = availableLots.find(
        (availableLot) =>
          availableLot.sourceTransactionId === lotToRestore.sourceTransactionId &&
          this.sameExpirationDate(availableLot.expiresAt, lotToRestore.expiresAt),
      );

      if (existingLot) {
        existingLot.amount = existingLot.amount.add(lotToRestore.amount);
        continue;
      }

      availableLots.push(this.cloneLot(lotToRestore));
    }
  }

  private extractMetadataLots(metadata: Prisma.JsonValue | null): LedgerLot[] {
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      !('allocations' in metadata)
    ) {
      return [];
    }

    const allocations = metadata.allocations;

    if (!Array.isArray(allocations)) {
      return [];
    }

    return allocations.flatMap((allocation): LedgerLot[] => {
      if (
        !allocation ||
        typeof allocation !== 'object' ||
        Array.isArray(allocation) ||
        typeof allocation.sourceTransactionId !== 'string' ||
        typeof allocation.amount !== 'string'
      ) {
        return [];
      }

      return [
        {
          sourceTransactionId: allocation.sourceTransactionId,
          amount: new Prisma.Decimal(allocation.amount),
          expiresAt:
            allocation.expiresAt && typeof allocation.expiresAt === 'string'
              ? new Date(allocation.expiresAt)
              : null,
        },
      ];
    });
  }

  private serializeLots(lots: LedgerLot[]): LedgerAllocation[] {
    return lots.map((lot) => ({
      sourceTransactionId: lot.sourceTransactionId,
      amount: lot.amount.toString(),
      expiresAt: lot.expiresAt?.toISOString() ?? null,
    }));
  }

  private drainLotsByReference(
    lotMap: Map<string, LedgerLot[]>,
    referenceId: string | null,
  ): LedgerLot[] | null {
    if (!referenceId) {
      return null;
    }

    const lots = lotMap.get(referenceId);

    if (!lots) {
      return null;
    }

    lotMap.delete(referenceId);

    return this.cloneLots(lots);
  }

  private assertLotsMatchTransaction(
    transaction: ReplayTransaction,
    lots: LedgerLot[],
  ): void {
    if (lots.length === 0) {
      throw new ConflictException(
        `Ledger replay could not resolve allocations for transaction "${transaction.id}".`,
      );
    }

    const lotAmount = this.sumLots(lots);

    if (!lotAmount.eq(transaction.amount.abs())) {
      throw new ConflictException(
        `Ledger replay detected inconsistent allocations for transaction "${transaction.id}".`,
      );
    }
  }

  private sortLots(lots: LedgerLot[]): LedgerLot[] {
    return lots.sort((left, right) => {
      const leftExpiresAt = left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightExpiresAt = right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;

      if (leftExpiresAt !== rightExpiresAt) {
        return leftExpiresAt - rightExpiresAt;
      }

      return left.sourceTransactionId.localeCompare(right.sourceTransactionId);
    });
  }

  private pruneEmptyLots(lots: LedgerLot[]): void {
    for (let index = lots.length - 1; index >= 0; index -= 1) {
      if (lots[index].amount.lte(0)) {
        lots.splice(index, 1);
      }
    }
  }

  private sumLots(lots: LedgerLot[]): Prisma.Decimal {
    return lots.reduce(
      (total, lot) => total.add(lot.amount),
      new Prisma.Decimal(0),
    );
  }

  private sameExpirationDate(left: Date | null, right: Date | null): boolean {
    return (left?.toISOString() ?? null) === (right?.toISOString() ?? null);
  }

  private cloneLot(lot: LedgerLot): LedgerLot {
    return {
      sourceTransactionId: lot.sourceTransactionId,
      amount: new Prisma.Decimal(lot.amount),
      expiresAt: lot.expiresAt ? new Date(lot.expiresAt) : null,
    };
  }

  private cloneLots(lots: LedgerLot[]): LedgerLot[] {
    return lots.map((lot) => this.cloneLot(lot));
  }
}
