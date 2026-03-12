import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { CreateProductDto } from './dto/create-product.dto';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@DevActorHeaders()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('products')
  @ApiOperation({ summary: 'Lists visible products for employee catalog.' })
  listProducts() {
    return this.catalogService.findAvailableProducts();
  }

  @Post('products')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiOperation({ summary: 'Creates a product. Contract-first endpoint.' })
  createProduct(@Body() payload: CreateProductDto) {
    return this.catalogService.createProduct(payload);
  }
}

