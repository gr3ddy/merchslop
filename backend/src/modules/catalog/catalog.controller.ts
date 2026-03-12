import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Creates a product in the catalog.' })
  createProduct(
    @Body() payload: CreateProductDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.catalogService.createProduct(payload, actor);
  }
}
