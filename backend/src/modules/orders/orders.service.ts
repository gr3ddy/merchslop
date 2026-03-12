import { Injectable, NotImplementedException } from '@nestjs/common';

import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Injectable()
export class OrdersService {
  createOrder(_employeeId: string | undefined, _payload: CreateOrderDto): never {
    throw new NotImplementedException(
      'Order creation will be implemented with stock checks and reserve transactions.',
    );
  }

  listOrders(_employeeId?: string): never {
    throw new NotImplementedException(
      'Order list requires persistence and role-aware filtering.',
    );
  }

  updateStatus(_orderId: string, _payload: UpdateOrderStatusDto): never {
    throw new NotImplementedException(
      'Order status transitions will be implemented with ledger side effects.',
    );
  }
}

