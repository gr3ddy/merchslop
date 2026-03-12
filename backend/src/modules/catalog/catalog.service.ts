import { Injectable, NotImplementedException } from '@nestjs/common';

import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class CatalogService {
  findAvailableProducts(): never {
    throw new NotImplementedException(
      'Catalog reads will be implemented after product repository wiring.',
    );
  }

  createProduct(_payload: CreateProductDto): never {
    throw new NotImplementedException(
      'Catalog writes will be implemented after Prisma product models are wired.',
    );
  }
}

