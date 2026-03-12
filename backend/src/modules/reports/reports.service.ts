import { Injectable } from '@nestjs/common';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ListBalanceReportQueryDto } from './dto/list-balance-report-query.dto';
import { ListExpirationReportQueryDto } from './dto/list-expiration-report-query.dto';
import { ListOrderReportQueryDto } from './dto/list-order-report-query.dto';
import { ListTransactionReportQueryDto } from './dto/list-transaction-report-query.dto';

type CsvValue = string | number | boolean | null | undefined;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  listBalances(query: ListBalanceReportQueryDto) {
    return this.prisma.employee.findMany({
      where: {
        id: query.employeeId,
        status: query.status,
        department: query.department,
        ...(query.query
          ? {
              OR: [
                {
                  employeeNumber: {
                    contains: query.query,
                    mode: 'insensitive',
                  },
                },
                {
                  fullName: {
                    contains: query.query,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: query.query.toLowerCase(),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ fullName: 'asc' }],
      include: {
        balanceSnapshot: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            role: true,
          },
        },
      },
    });
  }

  async exportBalancesCsv(query: ListBalanceReportQueryDto): Promise<string> {
    const balances = await this.listBalances(query);

    return this.serializeCsv(
      [
        'employeeId',
        'employeeNumber',
        'fullName',
        'email',
        'department',
        'status',
        'availableAmount',
        'reservedAmount',
        'balanceUpdatedAt',
        'userId',
        'userEmail',
        'userStatus',
      ],
      balances.map((employee) => ({
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        fullName: employee.fullName,
        email: employee.email,
        department: employee.department ?? '',
        status: employee.status,
        availableAmount:
          employee.balanceSnapshot?.availableAmount.toString() ?? '0.00',
        reservedAmount:
          employee.balanceSnapshot?.reservedAmount.toString() ?? '0.00',
        balanceUpdatedAt: this.formatDate(employee.balanceSnapshot?.updatedAt),
        userId: employee.user?.id ?? '',
        userEmail: employee.user?.email ?? '',
        userStatus: employee.user?.status ?? '',
      })),
    );
  }

  listTransactions(query: ListTransactionReportQueryDto) {
    return this.prisma.transaction.findMany({
      where: {
        employeeId: query.employeeId,
        type: query.type,
        status: query.status,
        effectiveAt: this.buildDateRange(query.dateFrom, query.dateTo),
      },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        employee: true,
        author: {
          select: {
            id: true,
            email: true,
          },
        },
        reason: {
          select: {
            code: true,
            title: true,
          },
        },
        order: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });
  }

  async exportTransactionsCsv(
    query: ListTransactionReportQueryDto,
  ): Promise<string> {
    const transactions = await this.listTransactions(query);

    return this.serializeCsv(
      [
        'transactionId',
        'effectiveAt',
        'createdAt',
        'employeeId',
        'employeeNumber',
        'employeeName',
        'type',
        'status',
        'amount',
        'reasonCode',
        'reasonTitle',
        'orderId',
        'orderStatus',
        'authorId',
        'authorEmail',
        'comment',
      ],
      transactions.map((transaction) => ({
        transactionId: transaction.id,
        effectiveAt: this.formatDate(transaction.effectiveAt),
        createdAt: this.formatDate(transaction.createdAt),
        employeeId: transaction.employeeId,
        employeeNumber: transaction.employee.employeeNumber,
        employeeName: transaction.employee.fullName,
        type: transaction.type,
        status: transaction.status,
        amount: transaction.amount.toString(),
        reasonCode: transaction.reason?.code ?? '',
        reasonTitle: transaction.reason?.title ?? '',
        orderId: transaction.orderId ?? '',
        orderStatus: transaction.order?.status ?? '',
        authorId: transaction.author?.id ?? '',
        authorEmail: transaction.author?.email ?? '',
        comment: transaction.comment ?? '',
      })),
    );
  }

  listOrders(query: ListOrderReportQueryDto) {
    return this.prisma.order.findMany({
      where: {
        employeeId: query.employeeId,
        status: query.status,
        createdAt: this.buildDateRange(query.dateFrom, query.dateTo),
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        items: {
          include: {
            product: true,
          },
        },
        employee: true,
        pickupPoint: true,
        canceledBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async exportOrdersCsv(query: ListOrderReportQueryDto): Promise<string> {
    const orders = await this.listOrders(query);

    return this.serializeCsv(
      [
        'orderId',
        'createdAt',
        'employeeId',
        'employeeNumber',
        'employeeName',
        'status',
        'pickupPoint',
        'totalAmount',
        'reservedAmount',
        'confirmedAt',
        'assembledAt',
        'issuedAt',
        'canceledAt',
        'canceledByEmail',
        'items',
        'comment',
      ],
      orders.map((order) => ({
        orderId: order.id,
        createdAt: this.formatDate(order.createdAt),
        employeeId: order.employeeId,
        employeeNumber: order.employee.employeeNumber,
        employeeName: order.employee.fullName,
        status: order.status,
        pickupPoint: order.pickupPoint?.name ?? '',
        totalAmount: order.totalAmount.toString(),
        reservedAmount: order.reservedAmount.toString(),
        confirmedAt: this.formatDate(order.confirmedAt),
        assembledAt: this.formatDate(order.assembledAt),
        issuedAt: this.formatDate(order.issuedAt),
        canceledAt: this.formatDate(order.canceledAt),
        canceledByEmail: order.canceledBy?.email ?? '',
        items: order.items
          .map(
            (item) =>
              `${item.product.title} x${item.quantity} @ ${item.pricePoints.toString()}`,
          )
          .join('; '),
        comment: order.comment ?? '',
      })),
    );
  }

  listExpirations(query: ListExpirationReportQueryDto) {
    return this.prisma.transaction.findMany({
      where: {
        employeeId: query.employeeId,
        type: TransactionType.EXPIRATION,
        status: TransactionStatus.CONFIRMED,
        effectiveAt: this.buildDateRange(query.dateFrom, query.dateTo),
      },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        employee: true,
        author: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async exportExpirationsCsv(
    query: ListExpirationReportQueryDto,
  ): Promise<string> {
    const expirations = await this.listExpirations(query);

    return this.serializeCsv(
      [
        'transactionId',
        'effectiveAt',
        'createdAt',
        'employeeId',
        'employeeNumber',
        'employeeName',
        'amount',
        'authorId',
        'authorEmail',
        'sourceTransactionId',
        'expiredLots',
        'comment',
      ],
      expirations.map((transaction) => ({
        transactionId: transaction.id,
        effectiveAt: this.formatDate(transaction.effectiveAt),
        createdAt: this.formatDate(transaction.createdAt),
        employeeId: transaction.employeeId,
        employeeNumber: transaction.employee.employeeNumber,
        employeeName: transaction.employee.fullName,
        amount: transaction.amount.toString(),
        authorId: transaction.author?.id ?? '',
        authorEmail: transaction.author?.email ?? '',
        sourceTransactionId: transaction.sourceTransactionId ?? '',
        expiredLots: this.formatExpirationLots(transaction.metadata),
        comment: transaction.comment ?? '',
      })),
    );
  }

  private buildDateRange(
    dateFrom?: string,
    dateTo?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!dateFrom && !dateTo) {
      return undefined;
    }

    return {
      ...(dateFrom
        ? {
            gte: this.normalizeDateBoundary(dateFrom, 'start'),
          }
        : {}),
      ...(dateTo
        ? {
            lte: this.normalizeDateBoundary(dateTo, 'end'),
          }
        : {}),
    };
  }

  private normalizeDateBoundary(value: string, mode: 'start' | 'end'): Date {
    if (value.length <= 10) {
      const suffix = mode === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
      return new Date(`${value}${suffix}`);
    }

    return new Date(value);
  }

  private serializeCsv(
    headers: string[],
    rows: Array<Record<string, CsvValue>>,
  ): string {
    const lines = [
      headers.join(','),
      ...rows.map((row) =>
        headers.map((header) => this.escapeCsvValue(row[header])).join(','),
      ),
    ];

    return `\uFEFF${lines.join('\n')}`;
  }

  private escapeCsvValue(value: CsvValue): string {
    const normalized = value == null ? '' : String(value);
    const escaped = normalized.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  }

  private formatDate(value?: Date | null): string {
    return value ? value.toISOString() : '';
  }

  private formatExpirationLots(metadata: Prisma.JsonValue | null): string {
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      !('allocations' in metadata) ||
      !Array.isArray(metadata.allocations)
    ) {
      return '';
    }

    return metadata.allocations
      .flatMap((allocation) => {
        if (
          !allocation ||
          typeof allocation !== 'object' ||
          Array.isArray(allocation) ||
          typeof allocation.sourceTransactionId !== 'string' ||
          typeof allocation.amount !== 'string'
        ) {
          return [];
        }

        const expiresAt =
          allocation.expiresAt && typeof allocation.expiresAt === 'string'
            ? allocation.expiresAt
            : '';

        return [
          `${allocation.sourceTransactionId}:${allocation.amount}${
            expiresAt ? `@${expiresAt}` : ''
          }`,
        ];
      })
      .join('; ');
  }
}
