import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@DevActorHeaders()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Roles(UserRole.EMPLOYEE, UserRole.PROGRAM_ADMIN)
  @ApiOperation({
    summary: 'Lists orders for current employee or all orders for admin in future.',
  })
  listOrders(@CurrentActor('employeeId') employeeId?: string) {
    return this.ordersService.listOrders(employeeId);
  }

  @Post()
  @Roles(UserRole.EMPLOYEE, UserRole.PROGRAM_ADMIN)
  @ApiOperation({ summary: 'Creates a new catalog order with points reservation.' })
  createOrder(
    @CurrentActor('employeeId') employeeId: string | undefined,
    @Body() payload: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(employeeId, payload);
  }

  @Patch(':orderId/status')
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiOperation({ summary: 'Moves order through the admin workflow.' })
  updateStatus(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() payload: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(orderId, payload);
  }
}
