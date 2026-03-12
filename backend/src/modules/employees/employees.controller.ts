import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';
import { EmployeesService } from './employees.service';

type UploadedExcelFile = {
  originalname: string;
  buffer: Buffer;
};

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

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'Imports employees from an Excel file and returns import job summary.',
  })
  importEmployees(
    @UploadedFile() file: UploadedExcelFile | undefined,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.employeesService.importFromExcel(file, actor);
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
