import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';
import { EmployeesService } from './employees.service';

@ApiTags('employees')
@ApiBearerAuth()
@DevActorHeaders()
@Roles(UserRole.PROGRAM_ADMIN)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get('import-template')
  @ApiOperation({ summary: 'Returns default Excel import template definition.' })
  getImportTemplate() {
    return this.employeesService.getImportTemplateDefinition();
  }

  @Post()
  @ApiOperation({
    summary:
      'Creates a single employee record for early admin operations and backend testing.',
  })
  create(
    @Body() payload: CreateEmployeeDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.employeesService.create(payload, actor);
  }

  @Get()
  @ApiOperation({ summary: 'Lists employees with balance snapshots and linked user info.' })
  findAll() {
    return this.employeesService.findAll();
  }

  @Patch(':employeeId/status')
  @ApiOperation({ summary: 'Updates employee status and disables linked user if needed.' })
  updateStatus(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body() payload: UpdateEmployeeStatusDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.employeesService.updateStatus(employeeId, payload, actor);
  }
}
