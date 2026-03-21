import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCartDto } from './dto/update-cart.dto';
import { UpsertCartItemDto } from './dto/upsert-cart-item.dto';

const cartInclude = {
  pickupPoint: true,
  items: {
    orderBy: [{ createdAt: 'asc' }],
    include: {
      product: {
        include: {
          category: true,
          images: {
            orderBy: [{ sortOrder: 'asc' }],
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

type CartStore = Prisma.TransactionClient | PrismaService;
type CartDetails = Prisma.CartGetPayload<{
  include: typeof cartInclude;
}>;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ordersService: OrdersService,
  ) {}

  async getMyCart(actor?: RequestActor) {
    const employeeId = this.requireEmployeeId(actor);

    await this.ensureActiveEmployee(employeeId, this.prisma);

    const cart = await this.ensureCart(employeeId, this.prisma);

    return this.buildCartResponse(cart);
  }

  async updateMyCart(actor: RequestActor | undefined, payload: UpdateCartDto) {
    const employeeId = this.requireEmployeeId(actor);

    const cart = await this.prisma.runInSerializableTransaction(async (tx) => {
      await this.ensureActiveEmployee(employeeId, tx);

      if (payload.pickupPointId) {
        await this.ensurePickupPoint(payload.pickupPointId, tx);
      }

      const persistedCart = await this.ensureCart(employeeId, tx);
      const updateData: Prisma.CartUncheckedUpdateInput = {};

      if (payload.pickupPointId !== undefined) {
        updateData.pickupPointId = payload.pickupPointId ?? null;
      }

      if (payload.comment !== undefined) {
        updateData.comment = this.normalizeComment(payload.comment);
      }

      if (Object.keys(updateData).length === 0) {
        return persistedCart;
      }

      return tx.cart.update({
        where: {
          id: persistedCart.id,
        },
        data: updateData,
        include: cartInclude,
      });
    });

    await this.auditService.createEvent({
      actorId: actor?.userId,
      action: 'cart.updated',
      entityType: 'Cart',
      entityId: cart.id,
      payload: {
        pickupPointId: cart.pickupPointId,
        hasComment: Boolean(cart.comment),
      },
    });

    return this.buildCartResponse(cart);
  }

  async setMyCartItem(
    actor: RequestActor | undefined,
    productId: string,
    payload: UpsertCartItemDto,
  ) {
    const employeeId = this.requireEmployeeId(actor);

    const cart = await this.prisma.runInSerializableTransaction(async (tx) => {
      await this.ensureActiveEmployee(employeeId, tx);
      const product = await this.ensureProduct(productId, payload.quantity, tx);
      const persistedCart = await this.ensureCart(employeeId, tx);

      await tx.cartItem.upsert({
        where: {
          cartId_productId: {
            cartId: persistedCart.id,
            productId: product.id,
          },
        },
        update: {
          quantity: payload.quantity,
        },
        create: {
          cartId: persistedCart.id,
          productId: product.id,
          quantity: payload.quantity,
        },
      });

      return this.loadCartByEmployee(employeeId, tx);
    });

    await this.auditService.createEvent({
      actorId: actor?.userId,
      action: 'cart.item_set',
      entityType: 'Cart',
      entityId: cart.id,
      payload: {
        productId,
        quantity: payload.quantity,
      },
    });

    return this.buildCartResponse(cart);
  }

  async removeMyCartItem(actor: RequestActor | undefined, productId: string) {
    const employeeId = this.requireEmployeeId(actor);

    const result = await this.prisma.runInSerializableTransaction(async (tx) => {
      await this.ensureActiveEmployee(employeeId, tx);
      const cart = await this.ensureCart(employeeId, tx);
      const deleteResult = await tx.cartItem.deleteMany({
        where: {
          cartId: cart.id,
          productId,
        },
      });

      return {
        cart: await this.loadCartByEmployee(employeeId, tx),
        removed: deleteResult.count > 0,
      };
    });

    if (result.removed) {
      await this.auditService.createEvent({
        actorId: actor?.userId,
        action: 'cart.item_removed',
        entityType: 'Cart',
        entityId: result.cart.id,
        payload: {
          productId,
        },
      });
    }

    return this.buildCartResponse(result.cart);
  }

  async clearMyCart(actor?: RequestActor) {
    const employeeId = this.requireEmployeeId(actor);

    const cart = await this.prisma.runInSerializableTransaction(async (tx) => {
      await this.ensureActiveEmployee(employeeId, tx);
      const persistedCart = await this.ensureCart(employeeId, tx);

      await tx.cartItem.deleteMany({
        where: {
          cartId: persistedCart.id,
        },
      });

      return tx.cart.update({
        where: {
          id: persistedCart.id,
        },
        data: {
          pickupPointId: null,
          comment: null,
        },
        include: cartInclude,
      });
    });

    await this.auditService.createEvent({
      actorId: actor?.userId,
      action: 'cart.cleared',
      entityType: 'Cart',
      entityId: cart.id,
      payload: {
        employeeId,
      },
    });

    return this.buildCartResponse(cart);
  }

  checkoutMyCart(actor?: RequestActor) {
    return this.ordersService.checkoutCart(actor);
  }

  private requireEmployeeId(actor?: RequestActor): string {
    if (!actor?.employeeId) {
      throw new BadRequestException(
        'Employee context is required to work with a persisted cart.',
      );
    }

    return actor.employeeId;
  }

  private async ensureActiveEmployee(employeeId: string, db: CartStore) {
    const employee = await db.employee.findUnique({
      where: {
        id: employeeId,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee "${employeeId}" was not found.`);
    }

    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new ConflictException('Inactive employee cannot modify the cart.');
    }

    return employee;
  }

  private async ensurePickupPoint(pickupPointId: string, db: CartStore) {
    const pickupPoint = await db.pickupPoint.findUnique({
      where: {
        id: pickupPointId,
      },
    });

    if (!pickupPoint || !pickupPoint.isActive) {
      throw new NotFoundException(
        `Pickup point "${pickupPointId}" is not available.`,
      );
    }

    return pickupPoint;
  }

  private async ensureProduct(
    productId: string,
    quantity: number,
    db: CartStore,
  ) {
    const product = await db.product.findUnique({
      where: {
        id: productId,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product "${productId}" was not found.`);
    }

    if (product.status !== ProductStatus.ACTIVE) {
      throw new ConflictException(
        `Product "${product.title}" is not available for ordering.`,
      );
    }

    if (!product.hasUnlimitedStock && product.stockQty < quantity) {
      throw new ConflictException(
        `Not enough stock for product "${product.title}".`,
      );
    }

    return product;
  }

  private async ensureCart(employeeId: string, db: CartStore): Promise<CartDetails> {
    return db.cart.upsert({
      where: {
        employeeId,
      },
      update: {},
      create: {
        employeeId,
      },
      include: cartInclude,
    });
  }

  private async loadCartByEmployee(
    employeeId: string,
    db: CartStore,
  ): Promise<CartDetails> {
    const cart = await db.cart.findUnique({
      where: {
        employeeId,
      },
      include: cartInclude,
    });

    if (!cart) {
      throw new NotFoundException(`Cart for employee "${employeeId}" was not found.`);
    }

    return cart;
  }

  private buildCartResponse(cart: CartDetails) {
    const totalAmount = cart.items.reduce(
      (sum, item) =>
        sum.add(item.product.pricePoints.mul(new Prisma.Decimal(item.quantity))),
      new Prisma.Decimal(0),
    );
    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    return {
      ...cart,
      itemCount,
      totalAmount,
    };
  }

  private normalizeComment(comment: string | null | undefined): string | null {
    if (comment === undefined) {
      return null;
    }

    const normalized = comment?.trim();

    return normalized ? normalized : null;
  }
}
