import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAvailableProducts() {
    return this.prisma.product.findMany({
      where: {
        status: ProductStatus.ACTIVE,
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        category: true,
        images: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    });
  }

  async createProduct(payload: CreateProductDto, actor?: RequestActor) {
    const existing = await this.prisma.product.findUnique({
      where: {
        sku: payload.sku,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Product with SKU "${payload.sku}" already exists.`,
      );
    }

    if (payload.categoryId) {
      const category = await this.prisma.productCategory.findUnique({
        where: {
          id: payload.categoryId,
        },
        select: {
          id: true,
        },
      });

      if (!category) {
        throw new NotFoundException(
          `Product category "${payload.categoryId}" was not found.`,
        );
      }
    }

    const product = await this.prisma.product.create({
      data: {
        sku: payload.sku,
        title: payload.title,
        description: payload.description,
        pricePoints: new Prisma.Decimal(payload.pricePoints),
        stockQty: payload.stockQty ?? 0,
        hasUnlimitedStock: payload.hasUnlimitedStock ?? false,
        status: payload.status ?? ProductStatus.ACTIVE,
        categoryId: payload.categoryId,
      },
      include: {
        category: true,
        images: true,
      },
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'product.created',
      entityType: 'Product',
      entityId: product.id,
      payload: {
        sku: product.sku,
        title: product.title,
      },
    });

    return product;
  }
}
