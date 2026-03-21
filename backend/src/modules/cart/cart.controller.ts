import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { UpdateCartDto } from './dto/update-cart.dto';
import { UpsertCartItemDto } from './dto/upsert-cart-item.dto';
import { CartService } from './cart.service';

@ApiTags('cart')
@ApiBearerAuth()
@DevActorHeaders()
@Roles(UserRole.EMPLOYEE, UserRole.PROGRAM_ADMIN)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Returns the persisted cart for the current employee.' })
  getMyCart(@CurrentActor() actor?: RequestActor) {
    return this.cartService.getMyCart(actor);
  }

  @Patch()
  @ApiOperation({ summary: 'Updates cart-level checkout fields like pickup point and comment.' })
  updateMyCart(
    @CurrentActor() actor: RequestActor | undefined,
    @Body() payload: UpdateCartDto,
  ) {
    return this.cartService.updateMyCart(actor, payload);
  }

  @Put('items/:productId')
  @ApiOperation({ summary: 'Sets the quantity for one product in the persisted cart.' })
  setMyCartItem(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body() payload: UpsertCartItemDto,
  ) {
    return this.cartService.setMyCartItem(actor, productId, payload);
  }

  @Delete('items/:productId')
  @ApiOperation({ summary: 'Removes one product from the persisted cart.' })
  removeMyCartItem(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.cartService.removeMyCartItem(actor, productId);
  }

  @Delete()
  @ApiOperation({ summary: 'Clears persisted cart items and checkout metadata.' })
  clearMyCart(@CurrentActor() actor?: RequestActor) {
    return this.cartService.clearMyCart(actor);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Creates an order from the persisted cart and clears it.' })
  checkoutMyCart(@CurrentActor() actor?: RequestActor) {
    return this.cartService.checkoutMyCart(actor);
  }
}
