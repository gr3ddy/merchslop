import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import {
  Prisma,
  ProductStatus,
} from '@prisma/client';

import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import {
  CATALOG_IMAGE_ALLOWED_EXTENSIONS,
  CATALOG_IMAGE_ALLOWED_MIME_TYPES,
  CATALOG_IMAGE_UPLOAD_MAX_BYTES,
} from '../../common/upload/upload.constants';
import { assertUploadMatchesRules } from '../../common/upload/upload.utils';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStockDto } from './dto/update-product-stock.dto';
import { UploadProductImageDto } from './dto/upload-product-image.dto';

type UploadedCatalogImageFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

const productInclude = {
  category: true,
  images: {
    orderBy: {
      sortOrder: 'asc',
    },
  },
} satisfies Prisma.ProductInclude;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAvailableCategories() {
    return this.prisma.productCategory.findMany({
      where: {
        isActive: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findAdminCategories() {
    return this.prisma.productCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findAvailableProducts() {
    return this.prisma.product.findMany({
      where: {
        status: ProductStatus.ACTIVE,
      },
      orderBy: [{ createdAt: 'desc' }],
      include: productInclude,
    });
  }

  findAdminProducts() {
    return this.prisma.product.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: productInclude,
    });
  }

  async findProductById(productId: string, actor?: RequestActor) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        ...(actor?.role === UserRole.PROGRAM_ADMIN
          ? {}
          : {
              status: ProductStatus.ACTIVE,
            }),
      },
      include: productInclude,
    });

    if (!product) {
      throw new NotFoundException(`Product "${productId}" was not found.`);
    }

    return product;
  }

  async createCategory(payload: CreateProductCategoryDto, actor?: RequestActor) {
    const slug = await this.resolveUniqueCategorySlug(payload.slug ?? payload.name);

    const category = await this.prisma.productCategory.create({
      data: {
        name: payload.name.trim(),
        slug,
        isActive: payload.isActive ?? true,
        sortOrder: payload.sortOrder ?? 0,
      },
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'product_category.created',
      entityType: 'ProductCategory',
      entityId: category.id,
      payload: {
        name: category.name,
        slug: category.slug,
      },
    });

    return category;
  }

  async updateCategory(
    categoryId: string,
    payload: UpdateProductCategoryDto,
    actor?: RequestActor,
  ) {
    const category = await this.prisma.productCategory.findUnique({
      where: {
        id: categoryId,
      },
    });

    if (!category) {
      throw new NotFoundException(
        `Product category "${categoryId}" was not found.`,
      );
    }

    const nextSlug =
      payload.slug || payload.name
        ? await this.resolveUniqueCategorySlug(
            payload.slug ?? payload.name ?? category.slug,
            categoryId,
          )
        : category.slug;

    const updated = await this.prisma.productCategory.update({
      where: {
        id: categoryId,
      },
      data: {
        ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
        ...(payload.slug !== undefined || payload.name !== undefined
          ? { slug: nextSlug }
          : {}),
        ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
      },
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'product_category.updated',
      entityType: 'ProductCategory',
      entityId: updated.id,
      payload: {
        name: updated.name,
        slug: updated.slug,
        isActive: updated.isActive,
      },
    });

    return updated;
  }

  async deleteCategory(categoryId: string, actor?: RequestActor) {
    const category = await this.prisma.productCategory.findUnique({
      where: {
        id: categoryId,
      },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(
        `Product category "${categoryId}" was not found.`,
      );
    }

    if (category._count.products > 0) {
      throw new ConflictException(
        'Cannot delete a category that still has linked products.',
      );
    }

    await this.prisma.productCategory.delete({
      where: {
        id: categoryId,
      },
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'product_category.deleted',
      entityType: 'ProductCategory',
      entityId: categoryId,
      payload: {
        name: category.name,
        slug: category.slug,
      },
    });

    return {
      id: categoryId,
      deleted: true,
    };
  }

  async createProduct(payload: CreateProductDto, actor?: RequestActor) {
    const normalizedSku = payload.sku.trim();

    const existing = await this.prisma.product.findUnique({
      where: {
        sku: normalizedSku,
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
        sku: normalizedSku,
        title: payload.title.trim(),
        description: payload.description,
        pricePoints: new Prisma.Decimal(payload.pricePoints),
        stockQty: payload.stockQty ?? 0,
        hasUnlimitedStock: payload.hasUnlimitedStock ?? false,
        status: payload.status ?? ProductStatus.ACTIVE,
        categoryId: payload.categoryId,
      },
      include: productInclude,
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

  async updateProduct(
    productId: string,
    payload: UpdateProductDto,
    actor?: RequestActor,
  ) {
    const product = await this.prisma.product.findUnique({
      where: {
        id: productId,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product "${productId}" was not found.`);
    }

    const hasCategoryIdField = Object.prototype.hasOwnProperty.call(
      payload,
      'categoryId',
    );

    if (payload.sku && payload.sku.trim() !== product.sku) {
      const existingBySku = await this.prisma.product.findUnique({
        where: {
          sku: payload.sku.trim(),
        },
        select: {
          id: true,
        },
      });

      if (existingBySku && existingBySku.id !== productId) {
        throw new ConflictException(
          `Product with SKU "${payload.sku.trim()}" already exists.`,
        );
      }
    }

    if (hasCategoryIdField && payload.categoryId) {
      await this.ensureCategoryExists(payload.categoryId);
    }

    const updated = await this.prisma.product.update({
      where: {
        id: productId,
      },
      data: {
        ...(payload.sku !== undefined ? { sku: payload.sku.trim() } : {}),
        ...(payload.title !== undefined ? { title: payload.title.trim() } : {}),
        ...(payload.description !== undefined
          ? { description: payload.description }
          : {}),
        ...(payload.pricePoints !== undefined
          ? { pricePoints: new Prisma.Decimal(payload.pricePoints) }
          : {}),
        ...(payload.stockQty !== undefined ? { stockQty: payload.stockQty } : {}),
        ...(payload.hasUnlimitedStock !== undefined
          ? { hasUnlimitedStock: payload.hasUnlimitedStock }
          : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(hasCategoryIdField ? { categoryId: payload.categoryId ?? null } : {}),
      },
      include: productInclude,
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'product.updated',
      entityType: 'Product',
      entityId: updated.id,
      payload: {
        sku: updated.sku,
        title: updated.title,
        status: updated.status,
      },
    });

    return updated;
  }

  async updateProductStock(
    productId: string,
    payload: UpdateProductStockDto,
    actor?: RequestActor,
  ) {
    const hasStockQty = payload.stockQty !== undefined;
    const hasDelta = payload.delta !== undefined;

    if (hasStockQty === hasDelta) {
      throw new BadRequestException(
        'Provide either stockQty or delta for stock update.',
      );
    }

    const product = await this.prisma.product.findUnique({
      where: {
        id: productId,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product "${productId}" was not found.`);
    }

    const nextStockQty =
      payload.stockQty ?? product.stockQty + (payload.delta ?? 0);

    if (nextStockQty < 0) {
      throw new ConflictException('Product stock cannot become negative.');
    }

    const updated = await this.prisma.product.update({
      where: {
        id: productId,
      },
      data: {
        stockQty: nextStockQty,
      },
      include: productInclude,
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'product.stock_updated',
      entityType: 'Product',
      entityId: updated.id,
      payload: {
        previousStockQty: product.stockQty,
        nextStockQty: updated.stockQty,
        delta:
          payload.delta !== undefined
            ? payload.delta
            : updated.stockQty - product.stockQty,
        comment: payload.comment ?? null,
      },
    });

    return updated;
  }

  async uploadProductImage(
    productId: string,
    file: UploadedCatalogImageFile | undefined,
    payload: UploadProductImageDto,
    actor?: RequestActor,
  ) {
    assertUploadMatchesRules(file, {
      fileLabel: 'Catalog image',
      maxBytes: CATALOG_IMAGE_UPLOAD_MAX_BYTES,
      allowedExtensions: CATALOG_IMAGE_ALLOWED_EXTENSIONS,
      allowedMimeTypes: CATALOG_IMAGE_ALLOWED_MIME_TYPES,
    });
    const upload = file as UploadedCatalogImageFile;

    const product = await this.prisma.product.findUnique({
      where: {
        id: productId,
      },
      include: {
        images: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product "${productId}" was not found.`);
    }

    const relativeFilePath = this.buildProductImageRelativePath(
      product.id,
      upload.originalname,
    );
    const absoluteFilePath = resolve(process.cwd(), relativeFilePath);

    await mkdir(join(process.cwd(), 'uploads', 'catalog', product.id), {
      recursive: true,
    });
    await writeFile(absoluteFilePath, upload.buffer);

    try {
      const image = await this.prisma.productImage.create({
        data: {
          productId: product.id,
          filePath: relativeFilePath.replaceAll('\\', '/'),
          altText: payload.altText,
          sortOrder: payload.sortOrder ?? product.images.length,
        },
      });

      await this.auditService.createEvent({
        actorId: actor?.userId ?? null,
        action: 'product.image_uploaded',
        entityType: 'Product',
        entityId: product.id,
        payload: {
          imageId: image.id,
          filePath: image.filePath,
        },
      });

      return this.prisma.product.findUniqueOrThrow({
        where: {
          id: product.id,
        },
        include: productInclude,
      });
    } catch (error) {
      await this.safeUnlink(absoluteFilePath);
      throw error;
    }
  }

  async deleteProductImage(
    productId: string,
    imageId: string,
    actor?: RequestActor,
  ) {
    const image = await this.prisma.productImage.findFirst({
      where: {
        id: imageId,
        productId,
      },
    });

    if (!image) {
      throw new NotFoundException(
        `Product image "${imageId}" was not found for product "${productId}".`,
      );
    }

    await this.prisma.productImage.delete({
      where: {
        id: image.id,
      },
    });

    await this.safeUnlink(resolve(process.cwd(), image.filePath));

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'product.image_deleted',
      entityType: 'Product',
      entityId: productId,
      payload: {
        imageId: image.id,
        filePath: image.filePath,
      },
    });

    return this.prisma.product.findUniqueOrThrow({
      where: {
        id: productId,
      },
      include: productInclude,
    });
  }

  async deleteProduct(productId: string, actor?: RequestActor) {
    const product = await this.prisma.product.findUnique({
      where: {
        id: productId,
      },
      include: {
        images: true,
        _count: {
          select: {
            orderItems: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product "${productId}" was not found.`);
    }

    if (product._count.orderItems > 0) {
      throw new ConflictException(
        'Cannot delete a product that is already referenced by orders. Archive it instead.',
      );
    }

    await this.prisma.product.delete({
      where: {
        id: productId,
      },
    });

    for (const image of product.images) {
      await this.safeUnlink(resolve(process.cwd(), image.filePath));
    }

    await rm(join(process.cwd(), 'uploads', 'catalog', productId), {
      recursive: true,
      force: true,
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'product.deleted',
      entityType: 'Product',
      entityId: productId,
      payload: {
        sku: product.sku,
        title: product.title,
      },
    });

    return {
      id: productId,
      deleted: true,
    };
  }

  private async ensureCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.productCategory.findUnique({
      where: {
        id: categoryId,
      },
      select: {
        id: true,
      },
    });

    if (!category) {
      throw new NotFoundException(
        `Product category "${categoryId}" was not found.`,
      );
    }
  }

  private async resolveUniqueCategorySlug(
    source: string,
    currentCategoryId?: string,
  ): Promise<string> {
    const baseSlug = this.slugify(source) || `category-${Date.now()}`;
    let nextSlug = baseSlug;
    let attempt = 1;

    for (;;) {
      const existing = await this.prisma.productCategory.findUnique({
        where: {
          slug: nextSlug,
        },
        select: {
          id: true,
        },
      });

      if (!existing || existing.id === currentCategoryId) {
        return nextSlug;
      }

      attempt += 1;
      nextSlug = `${baseSlug}-${attempt}`;
    }
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private buildProductImageRelativePath(
    productId: string,
    originalName: string,
  ): string {
    const extension = extname(originalName).toLowerCase();
    const safeExtension =
      extension && /^[.][a-z0-9]+$/.test(extension) ? extension : '.bin';

    return join(
      'uploads',
      'catalog',
      productId,
      `${Date.now()}-${randomUUID()}${safeExtension}`,
    );
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
