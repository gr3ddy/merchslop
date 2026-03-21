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
import {
  EMPLOYEE_IMPORT_ALLOWED_EXTENSIONS,
  EMPLOYEE_IMPORT_ALLOWED_MIME_TYPES,
  EMPLOYEE_IMPORT_UPLOAD_MAX_BYTES,
} from '../../common/upload/upload.constants';
import { createUploadMulterOptions } from '../../common/upload/upload.utils';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';
import { EmployeesService } from './employees.service';

type UploadedExcelFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
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
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadMulterOptions({
        fileLabel: 'Employee import',
        maxBytes: EMPLOYEE_IMPORT_UPLOAD_MAX_BYTES,
        allowedExtensions: EMPLOYEE_IMPORT_ALLOWED_EXTENSIONS,
        allowedMimeTypes: EMPLOYEE_IMPORT_ALLOWED_MIME_TYPES,
      }),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'Allowed: .xlsx only. Max size: 2 MB.',
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
