import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import {
  CATALOG_IMAGE_ALLOWED_EXTENSIONS,
  CATALOG_IMAGE_ALLOWED_MIME_TYPES,
  CATALOG_IMAGE_UPLOAD_MAX_BYTES,
} from '../../common/upload/upload.constants';
import { createUploadMulterOptions } from '../../common/upload/upload.utils';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStockDto } from './dto/update-product-stock.dto';
import { UploadProductImageDto } from './dto/upload-product-image.dto';
import { CatalogService } from './catalog.service';

type UploadedCatalogImageFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

@ApiTags('catalog')
@DevActorHeaders()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Lists active product categories for employee catalog.' })
  listCategories() {
    return this.catalogService.findAvailableCategories();
  }

  @Get('products')
  @ApiOperation({ summary: 'Lists visible products for employee catalog.' })
  listProducts() {
    return this.catalogService.findAvailableProducts();
  }

  @Get('products/:productId')
  @ApiOperation({ summary: 'Returns a product card by id.' })
  getProduct(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.findProductById(productId, actor);
  }

  @Get('admin/categories')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lists all product categories for catalog administration.' })
  listAdminCategories() {
    return this.catalogService.findAdminCategories();
  }

  @Post('categories')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Creates a product category.' })
  createCategory(
    @Body() payload: CreateProductCategoryDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.createCategory(payload, actor);
  }

  @Patch('categories/:categoryId')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Updates a product category.' })
  updateCategory(
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @Body() payload: UpdateProductCategoryDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.updateCategory(categoryId, payload, actor);
  }

  @Delete('categories/:categoryId')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deletes a product category if it has no linked products.' })
  deleteCategory(
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.deleteCategory(categoryId, actor);
  }

  @Get('admin/products')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lists all products for catalog administration.' })
  listAdminProducts() {
    return this.catalogService.findAdminProducts();
  }

  @Post('products')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Creates a product in the catalog.' })
  createProduct(
    @Body() payload: CreateProductDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.createProduct(payload, actor);
  }

  @Patch('products/:productId')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Updates a catalog product.' })
  updateProduct(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() payload: UpdateProductDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.updateProduct(productId, payload, actor);
  }

  @Patch('products/:productId/stock')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Updates product stock manually.' })
  updateProductStock(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() payload: UpdateProductStockDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.updateProductStock(productId, payload, actor);
  }

  @Post('products/:productId/images')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadMulterOptions({
        fileLabel: 'Catalog image',
        maxBytes: CATALOG_IMAGE_UPLOAD_MAX_BYTES,
        allowedExtensions: CATALOG_IMAGE_ALLOWED_EXTENSIONS,
        allowedMimeTypes: CATALOG_IMAGE_ALLOWED_MIME_TYPES,
      }),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'Allowed: .jpg, .jpeg, .png, .webp. Max size: 5 MB.',
        },
        altText: {
          type: 'string',
        },
        sortOrder: {
          type: 'integer',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Uploads an image for a catalog product.' })
  uploadProductImage(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @UploadedFile() file: UploadedCatalogImageFile | undefined,
    @Body() payload: UploadProductImageDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.uploadProductImage(productId, file, payload, actor);
  }

  @Delete('products/:productId/images/:imageId')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deletes a product image.' })
  deleteProductImage(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('imageId', new ParseUUIDPipe()) imageId: string,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.deleteProductImage(productId, imageId, actor);
  }

  @Delete('products/:productId')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deletes a product if it is not referenced by orders.' })
  deleteProduct(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.deleteProduct(productId, actor);
  }
}
