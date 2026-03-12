import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AccrualReasonsService } from './accrual-reasons.service';
import { CreateAccrualReasonDto } from './dto/create-accrual-reason.dto';
import { UpdateAccrualReasonDto } from './dto/update-accrual-reason.dto';

@ApiTags('accrual-reasons')
@ApiBearerAuth()
@DevActorHeaders()
@Roles(UserRole.PROGRAM_ADMIN)
@Controller('accrual-reasons')
export class AccrualReasonsController {
  constructor(
    private readonly accrualReasonsService: AccrualReasonsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lists accrual and adjustment reasons.' })
  findAll() {
    return this.accrualReasonsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Creates a new accrual reason.' })
  create(
    @Body() payload: CreateAccrualReasonDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.accrualReasonsService.create(payload, actor);
  }

  @Patch(':reasonId')
  @ApiOperation({ summary: 'Updates an existing accrual reason.' })
  update(
    @Param('reasonId', new ParseUUIDPipe()) reasonId: string,
    @Body() payload: UpdateAccrualReasonDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.accrualReasonsService.update(reasonId, payload, actor);
  }
}
