import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { OrdersModule } from '../orders/orders.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [AuditModule, OrdersModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
