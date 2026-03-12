import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  NotificationType,
  OrderStatus,
  Prisma,
  ProductStatus,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';

import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

type OrderDetails = Prisma.OrderGetPayload<{
  include: {
    items: {
      include: {
        product: true;
      };
    };
    pickupPoint: true;
    employee: {
      include: {
        balanceSnapshot: true;
      };
    };
    transactions: {
      orderBy: {
        createdAt: 'asc';
      };
    };
  };
}>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createOrder(actor: RequestActor | undefined, payload: CreateOrderDto) {
    if (!actor?.employeeId) {
      throw new BadRequestException(
        'Employee context is required to create an order.',
      );
    }

    const normalizedItems = this.normalizeItems(payload);

    const result = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({
        where: {
          id: actor.employeeId,
        },
        include: {
          balanceSnapshot: true,
        },
      });

      if (!employee) {
        throw new NotFoundException(
          `Employee "${actor.employeeId}" was not found.`,
        );
      }

      if (employee.status !== EmployeeStatus.ACTIVE) {
        throw new ConflictException('Inactive employee cannot create an order.');
      }

      if (payload.pickupPointId) {
        const pickupPoint = await tx.pickupPoint.findUnique({
          where: {
            id: payload.pickupPointId,
          },
        });

        if (!pickupPoint || !pickupPoint.isActive) {
          throw new NotFoundException(
            `Pickup point "${payload.pickupPointId}" is not available.`,
          );
        }
      }

      const products = await tx.product.findMany({
        where: {
          id: {
            in: normalizedItems.map((item) => item.productId),
          },
        },
      });

      if (products.length !== normalizedItems.length) {
        throw new NotFoundException('One or more ordered products were not found.');
      }

      const productMap = new Map(products.map((product) => [product.id, product]));
      let totalAmount = new Prisma.Decimal(0);

      for (const item of normalizedItems) {
        const product = productMap.get(item.productId);

        if (!product) {
          throw new NotFoundException(
            `Product "${item.productId}" was not found.`,
          );
        }

        if (product.status !== ProductStatus.ACTIVE) {
          throw new ConflictException(
            `Product "${product.title}" is not available for ordering.`,
          );
        }

        if (!product.hasUnlimitedStock && product.stockQty < item.quantity) {
          throw new ConflictException(
            `Not enough stock for product "${product.title}".`,
          );
        }

        totalAmount = totalAmount.add(
          product.pricePoints.mul(new Prisma.Decimal(item.quantity)),
        );
      }

      const currentAvailable =
        employee.balanceSnapshot?.availableAmount ?? new Prisma.Decimal(0);
      const currentReserved =
        employee.balanceSnapshot?.reservedAmount ?? new Prisma.Decimal(0);

      if (currentAvailable.lt(totalAmount)) {
        throw new ConflictException(
          'Insufficient available balance to create this order.',
        );
      }

      const createdOrder = await tx.order.create({
        data: {
          employeeId: employee.id,
          status: OrderStatus.CREATED,
          pickupPointId: payload.pickupPointId,
          reservedAmount: totalAmount,
          totalAmount,
          comment: payload.comment,
          items: {
            create: normalizedItems.map((item) => {
              const product = productMap.get(item.productId)!;

              return {
                productId: product.id,
                quantity: item.quantity,
                pricePoints: product.pricePoints,
              };
            }),
          },
        },
      });

      const reserveTransaction = await tx.transaction.create({
        data: {
          employeeId: employee.id,
          authorId: actor.userId,
          orderId: createdOrder.id,
          type: TransactionType.RESERVE,
          status: TransactionStatus.CONFIRMED,
          amount: totalAmount,
          comment: 'Points reserved for order creation.',
          effectiveAt: new Date(),
        },
      });

      const nextAvailable = currentAvailable.sub(totalAmount);
      const nextReserved = currentReserved.add(totalAmount);

      await tx.balanceSnapshot.upsert({
        where: {
          employeeId: employee.id,
        },
        create: {
          employeeId: employee.id,
          availableAmount: nextAvailable,
          reservedAmount: nextReserved,
        },
        update: {
          availableAmount: nextAvailable,
          reservedAmount: nextReserved,
        },
      });

      await this.notificationsService.createForEmployee(
        employee.id,
        {
          type: NotificationType.ORDER_CREATED,
          title: 'Order created',
          body: `Your order for ${totalAmount.toString()} points has been created and points are reserved.`,
        },
        tx,
      );

      const order = await this.loadOrderDetails(tx, createdOrder.id);

      return {
        order,
        reserveTransactionId: reserveTransaction.id,
        balance: {
          availableAmount: nextAvailable,
          reservedAmount: nextReserved,
        },
      };
    });

    await this.auditService.createEvent({
      actorId: actor.userId,
      action: 'order.created',
      entityType: 'Order',
      entityId: result.order.id,
      payload: {
        employeeId: actor.employeeId,
        totalAmount: result.order.totalAmount.toString(),
      },
    });

    return result;
  }

  listOrders(actor?: RequestActor) {
    if (!actor) {
      throw new BadRequestException('Actor context is required to list orders.');
    }

    if (actor.role !== UserRole.PROGRAM_ADMIN && !actor.employeeId) {
      throw new BadRequestException(
        'Employee actor must include employee context.',
      );
    }

    return this.prisma.order.findMany({
      where:
        actor.role === UserRole.PROGRAM_ADMIN
          ? undefined
          : {
              employeeId: actor.employeeId,
            },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        items: {
          include: {
            product: true,
          },
        },
        pickupPoint: true,
        employee: {
          include: {
            balanceSnapshot: true,
          },
        },
        transactions: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  }

  async updateStatus(
    orderId: string,
    payload: UpdateOrderStatusDto,
    actor?: RequestActor,
  ) {
    if (!actor?.userId) {
      throw new BadRequestException(
        'Actor context is required to update order status.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrderDetails(tx, orderId);

      if (payload.status === order.status) {
        throw new BadRequestException(
          `Order is already in status "${order.status}".`,
        );
      }

      this.assertTransition(order.status, payload.status);

      const reserveTransaction = order.transactions.find(
        (transaction) => transaction.type === TransactionType.RESERVE,
      );
      const writeOffTransaction = order.transactions.find(
        (transaction) => transaction.type === TransactionType.WRITE_OFF,
      );
      const releaseTransaction = order.transactions.find(
        (transaction) => transaction.type === TransactionType.RELEASE,
      );

      const currentAvailable =
        order.employee.balanceSnapshot?.availableAmount ?? new Prisma.Decimal(0);
      const currentReserved =
        order.employee.balanceSnapshot?.reservedAmount ?? new Prisma.Decimal(0);

      if (payload.status === OrderStatus.CONFIRMED) {
        if (!reserveTransaction) {
          throw new ConflictException('Reserve transaction is missing for order.');
        }

        if (writeOffTransaction) {
          throw new ConflictException(
            'Order already has a write-off transaction.',
          );
        }

        if (currentReserved.lt(order.totalAmount)) {
          throw new ConflictException(
            'Reserved balance is inconsistent for this order.',
          );
        }

        for (const item of order.items) {
          if (item.product.hasUnlimitedStock) {
            continue;
          }

          const stockUpdate = await tx.product.updateMany({
            where: {
              id: item.productId,
              stockQty: {
                gte: item.quantity,
              },
            },
            data: {
              stockQty: {
                decrement: item.quantity,
              },
            },
          });

          if (stockUpdate.count === 0) {
            throw new ConflictException(
              `Failed to confirm stock for product "${item.product.title}".`,
            );
          }
        }

        await tx.transaction.create({
          data: {
            employeeId: order.employeeId,
            authorId: actor.userId,
            orderId: order.id,
            type: TransactionType.WRITE_OFF,
            status: TransactionStatus.CONFIRMED,
            amount: order.totalAmount,
            sourceTransactionId: reserveTransaction.id,
            comment: payload.comment ?? 'Order confirmed and points written off.',
            effectiveAt: new Date(),
          },
        });

        await tx.balanceSnapshot.upsert({
          where: {
            employeeId: order.employeeId,
          },
          create: {
            employeeId: order.employeeId,
            availableAmount: currentAvailable,
            reservedAmount: currentReserved.sub(order.totalAmount),
          },
          update: {
            reservedAmount: currentReserved.sub(order.totalAmount),
          },
        });

        await tx.order.update({
          where: {
            id: order.id,
          },
          data: {
            status: OrderStatus.CONFIRMED,
            confirmedAt: new Date(),
            reservedAmount: new Prisma.Decimal(0),
            comment: payload.comment ?? order.comment,
          },
        });

        await this.notificationsService.createForEmployee(
          order.employeeId,
          {
            type: NotificationType.ORDER_CONFIRMED,
            title: 'Order confirmed',
            body: 'Your order has been confirmed and points were written off.',
          },
          tx,
        );
      }

      if (payload.status === OrderStatus.ASSEMBLED) {
        await tx.order.update({
          where: {
            id: order.id,
          },
          data: {
            status: OrderStatus.ASSEMBLED,
            assembledAt: new Date(),
            comment: payload.comment ?? order.comment,
          },
        });

        await this.notificationsService.createForEmployee(
          order.employeeId,
          {
            type: NotificationType.ORDER_ASSEMBLED,
            title: 'Order assembled',
            body: order.pickupPoint?.name
              ? `Your order is ready for pickup at "${order.pickupPoint.name}".`
              : 'Your order is ready for pickup.',
          },
          tx,
        );
      }

      if (payload.status === OrderStatus.ISSUED) {
        await tx.order.update({
          where: {
            id: order.id,
          },
          data: {
            status: OrderStatus.ISSUED,
            issuedAt: new Date(),
            comment: payload.comment ?? order.comment,
          },
        });

        await this.notificationsService.createForEmployee(
          order.employeeId,
          {
            type: NotificationType.ORDER_ISSUED,
            title: 'Order issued',
            body: 'Your order has been issued.',
          },
          tx,
        );
      }

      if (payload.status === OrderStatus.CANCELED) {
        if (releaseTransaction) {
          throw new ConflictException('Order already has a release transaction.');
        }

        if (order.status !== OrderStatus.CREATED) {
          for (const item of order.items) {
            if (item.product.hasUnlimitedStock) {
              continue;
            }

            await tx.product.update({
              where: {
                id: item.productId,
              },
              data: {
                stockQty: {
                  increment: item.quantity,
                },
              },
            });
          }
        }

        const releaseSource = writeOffTransaction ?? reserveTransaction;

        if (!releaseSource) {
          throw new ConflictException(
            'Cannot cancel order without reserve or write-off transaction.',
          );
        }

        const nextAvailable = currentAvailable.add(order.totalAmount);
        const nextReserved =
          order.status === OrderStatus.CREATED
            ? currentReserved.sub(order.totalAmount)
            : currentReserved;

        if (nextReserved.lt(0)) {
          throw new ConflictException(
            'Reserved balance would become negative after cancel.',
          );
        }

        await tx.transaction.create({
          data: {
            employeeId: order.employeeId,
            authorId: actor.userId,
            orderId: order.id,
            type: TransactionType.RELEASE,
            status: TransactionStatus.CONFIRMED,
            amount: order.totalAmount,
            sourceTransactionId: releaseSource.id,
            comment:
              payload.comment ??
              (order.status === OrderStatus.CREATED
                ? 'Order canceled and reserve released.'
                : 'Order canceled and points refunded.'),
            metadata: {
              mode:
                order.status === OrderStatus.CREATED
                  ? 'reserve_release'
                  : 'refund_after_write_off',
            },
            effectiveAt: new Date(),
          },
        });

        await tx.balanceSnapshot.upsert({
          where: {
            employeeId: order.employeeId,
          },
          create: {
            employeeId: order.employeeId,
            availableAmount: nextAvailable,
            reservedAmount: nextReserved,
          },
          update: {
            availableAmount: nextAvailable,
            reservedAmount: nextReserved,
          },
        });

        await tx.order.update({
          where: {
            id: order.id,
          },
          data: {
            status: OrderStatus.CANCELED,
            canceledAt: new Date(),
            canceledById: actor.userId,
            reservedAmount: new Prisma.Decimal(0),
            comment: payload.comment ?? order.comment,
          },
        });

        await this.notificationsService.createForEmployee(
          order.employeeId,
          {
            type: NotificationType.ORDER_CANCELED,
            title: 'Order canceled',
            body:
              order.status === OrderStatus.CREATED
                ? 'Your order was canceled and reserved points were released.'
                : 'Your order was canceled and points were refunded.',
          },
          tx,
        );
      }

      return this.loadOrderDetails(tx, order.id);
    });

    await this.auditService.createEvent({
      actorId: actor.userId,
      action: 'order.status_updated',
      entityType: 'Order',
      entityId: orderId,
      payload: {
        nextStatus: payload.status,
      },
    });

    return result;
  }

  private normalizeItems(payload: CreateOrderDto) {
    const byProductId = new Map<string, { productId: string; quantity: number }>();

    for (const item of payload.items) {
      const existing = byProductId.get(item.productId);

      if (existing) {
        existing.quantity += item.quantity;
        continue;
      }

      byProductId.set(item.productId, {
        productId: item.productId,
        quantity: item.quantity,
      });
    }

    return Array.from(byProductId.values());
  }

  private assertTransition(current: OrderStatus, next: OrderStatus): void {
    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.CREATED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELED],
      [OrderStatus.CONFIRMED]: [OrderStatus.ASSEMBLED, OrderStatus.CANCELED],
      [OrderStatus.ASSEMBLED]: [OrderStatus.ISSUED, OrderStatus.CANCELED],
      [OrderStatus.ISSUED]: [],
      [OrderStatus.CANCELED]: [],
    };

    if (!allowedTransitions[current].includes(next)) {
      throw new ConflictException(
        `Transition from "${current}" to "${next}" is not allowed.`,
      );
    }
  }

  private loadOrderDetails(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<OrderDetails> {
    return tx.order.findUniqueOrThrow({
      where: {
        id: orderId,
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        pickupPoint: true,
        employee: {
          include: {
            balanceSnapshot: true,
          },
        },
        transactions: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  }
}
