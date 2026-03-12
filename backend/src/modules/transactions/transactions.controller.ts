import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { CreateAccrualDto } from './dto/create-accrual.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@DevActorHeaders()
@Roles(UserRole.PROGRAM_ADMIN)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('accruals')
  @ApiOperation({ summary: 'Creates an accrual command for employee points.' })
  createAccrual(
    @Body() payload: CreateAccrualDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.transactionsService.createAccrual(payload, actor);
  }

  @Post('adjustments')
  @ApiOperation({ summary: 'Creates a manual balance adjustment command.' })
  createAdjustment(
    @Body() payload: CreateAdjustmentDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.transactionsService.createAdjustment(payload, actor);
  }
}
