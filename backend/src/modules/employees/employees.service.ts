import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  ImportJobStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as XLSX from 'xlsx';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';

const EMPLOYEE_IMPORT_SHEET_NAME = 'employees';
const EMPLOYEE_IMPORT_REQUIRED_COLUMNS = [
  'employeeNumber',
  'fullName',
  'email',
  'department',
] as const;
const EMPLOYEE_IMPORT_OPTIONAL_COLUMNS = [
  'position',
  'managerName',
  'hireDate',
  'branch',
  'legalEntity',
] as const;

type ImportError = {
  row: number;
  message: string;
  employeeNumber?: string;
  email?: string;
};

type ParsedEmployeeImportRow = {
  rowNumber: number;
  payload: CreateEmployeeDto;
};

type UploadedExcelFile = {
  originalname: string;
  buffer: Buffer;
};

type UserProvisioningCandidate = {
  id: string;
  role: UserRole;
  status: UserStatus;
  employeeId: string | null;
  passwordHash: string | null;
};

type UserProvisioningPlan =
  | {
      action: 'create';
    }
  | {
      action: 'bind';
      userId: string;
      currentStatus: UserStatus;
      hasPassword: boolean;
    };

type UserProvisioningResult = {
  action: 'created' | 'bound';
  userId: string;
  status: UserStatus;
};

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  getImportTemplateDefinition() {
    return {
      fileType: 'xlsx',
      sheetName: EMPLOYEE_IMPORT_SHEET_NAME,
      requiredColumns: [...EMPLOYEE_IMPORT_REQUIRED_COLUMNS],
      optionalColumns: [...EMPLOYEE_IMPORT_OPTIONAL_COLUMNS],
      uniqueness: ['employeeNumber', 'email'],
    };
  }

  async importFromExcel(
    file: UploadedExcelFile | undefined,
    actor?: RequestActor,
  ) {
    if (!file) {
      throw new BadRequestException('Excel file is required for import.');
    }

    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Only .xlsx files are supported for import.');
    }

    const workbook = this.readWorkbook(file.buffer);
    const { sheetName, worksheet } = this.resolveWorksheet(workbook);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: false,
      dateNF: 'yyyy-mm-dd',
    });

    if (rows.length === 0) {
      throw new BadRequestException('The uploaded Excel sheet is empty.');
    }

    const header = this.extractHeader(rows[0]);
    const dataRows = rows.slice(1);

    const job = await this.prisma.importJob.create({
      data: {
        fileName: file.originalname,
        status: ImportJobStatus.PROCESSING,
        rowsTotal: dataRows.length,
        initiatedById: actor?.userId ?? null,
      },
    });

    const missingColumns = EMPLOYEE_IMPORT_REQUIRED_COLUMNS.filter(
      (column) => !header.includes(column),
    );

    if (missingColumns.length > 0) {
      return this.finalizeImportJob(
        job.id,
        actor,
        {
          status: ImportJobStatus.FAILED,
          rowsSucceeded: 0,
          rowsFailed: dataRows.length,
          summary: {
            sheetName,
            missingColumns,
            errors: [
              {
                row: 1,
                message: `Missing required columns: ${missingColumns.join(', ')}.`,
              },
            ],
          },
        },
      );
    }

    if (dataRows.length === 0) {
      return this.finalizeImportJob(
        job.id,
        actor,
        {
          status: ImportJobStatus.FAILED,
          rowsSucceeded: 0,
          rowsFailed: 0,
          summary: {
            sheetName,
            errors: [
              {
                row: 1,
                message: 'The uploaded Excel sheet has no employee rows.',
              },
            ],
          },
        },
      );
    }

    const { validRows, errors } = this.parseImportRows(header, dataRows);
    const existingConflicts = await this.findExistingConflicts(validRows);
    const allErrors = [...errors, ...existingConflicts];
    const blockedRows = new Set(allErrors.map((error) => error.row));
    const createdEmployees: Array<{ id: string; employeeNumber: string }> = [];

    for (const row of validRows) {
      if (blockedRows.has(row.rowNumber)) {
        continue;
      }

      try {
        const employee = await this.create(row.payload, actor);

        createdEmployees.push({
          id: employee.id,
          employeeNumber: employee.employeeNumber,
        });
      } catch (error) {
        allErrors.push({
          row: row.rowNumber,
          employeeNumber: row.payload.employeeNumber,
          email: row.payload.email,
          message:
            error instanceof Error
              ? error.message
              : 'Unexpected error while importing employee row.',
        });
      }
    }

    const failedRows = new Set(allErrors.map((error) => error.row)).size;
    const rowsSucceeded = createdEmployees.length;
    const status =
      rowsSucceeded === 0
        ? ImportJobStatus.FAILED
        : failedRows > 0
          ? ImportJobStatus.PARTIAL
          : ImportJobStatus.COMPLETED;

    return this.finalizeImportJob(
      job.id,
      actor,
      {
        status,
        rowsSucceeded,
        rowsFailed: failedRows,
        summary: {
          sheetName,
          createdEmployees,
          errors: allErrors,
        },
      },
    );
  }

  async create(payload: CreateEmployeeDto, actor?: RequestActor) {
    const email = payload.email.toLowerCase();

    const [employeeByNumber, employeeByEmail, userByEmail] = await Promise.all([
      this.prisma.employee.findUnique({
        where: {
          employeeNumber: payload.employeeNumber,
        },
        select: {
          id: true,
        },
      }),
      this.prisma.employee.findUnique({
        where: {
          email,
        },
        select: {
          id: true,
        },
      }),
      this.prisma.user.findUnique({
        where: {
          email,
        },
        select: {
          id: true,
          role: true,
          status: true,
          employeeId: true,
          passwordHash: true,
        },
      }),
    ]);

    if (employeeByNumber) {
      throw new ConflictException(
        `Employee number "${payload.employeeNumber}" already exists.`,
      );
    }

    if (employeeByEmail) {
      throw new ConflictException(`Employee email "${email}" already exists.`);
    }

    const userProvisioningPlan = this.resolveUserProvisioningPlan(userByEmail, email);

    const employee = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          employeeNumber: payload.employeeNumber,
          fullName: payload.fullName,
          email,
          department: payload.department,
          position: payload.position,
          managerName: payload.managerName,
          hireDate: payload.hireDate ? new Date(payload.hireDate) : undefined,
          branch: payload.branch,
          legalEntity: payload.legalEntity,
        },
      });

      await tx.balanceSnapshot.create({
        data: {
          employeeId: created.id,
        },
      });

      const userProvisioning = await this.provisionLocalAccount(
        tx,
        created.id,
        email,
        created.status,
        userProvisioningPlan,
      );

      const employeeWithUser = await tx.employee.findUniqueOrThrow({
        where: {
          id: created.id,
        },
        include: {
          balanceSnapshot: true,
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
              lastLoginAt: true,
            },
          },
        },
      });

      return {
        employee: employeeWithUser,
        userProvisioning,
      };
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.employee.id,
      payload: {
        employeeNumber: employee.employee.employeeNumber,
        email: employee.employee.email,
        localAccount: {
          action: employee.userProvisioning.action,
          userId: employee.userProvisioning.userId,
          status: employee.userProvisioning.status,
        },
      },
    });

    return employee.employee;
  }

  findAll() {
    return this.prisma.employee.findMany({
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
      include: {
        balanceSnapshot: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            lastLoginAt: true,
          },
        },
      },
    });
  }

  async updateStatus(
    employeeId: string,
    payload: UpdateEmployeeStatusDto,
    actor?: RequestActor,
  ) {
    const existing = await this.prisma.employee.findUnique({
      where: {
        id: employeeId,
      },
      include: {
        user: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Employee "${employeeId}" was not found.`);
    }

    const employee = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: {
          id: employeeId,
        },
        data: {
          status: payload.status,
        },
        include: {
          balanceSnapshot: true,
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
              lastLoginAt: true,
            },
          },
        },
      });

      if (existing.user) {
        const nextUserStatus = this.resolveEmployeeUserStatus(
          payload.status,
          existing.user.status,
          Boolean(existing.user.passwordHash),
        );

        await tx.user.update({
          where: {
            id: existing.user.id,
          },
          data: {
            status: nextUserStatus,
          },
        });
      }

      return updated;
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'employee.status_updated',
      entityType: 'Employee',
      entityId: employeeId,
      payload: {
        previousStatus: existing.status,
        newStatus: payload.status,
        comment: payload.comment ?? null,
      },
    });

    return employee;
  }

  private readWorkbook(buffer: Buffer): XLSX.WorkBook {
    try {
      return XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
      });
    } catch {
      throw new BadRequestException('Failed to read the uploaded Excel file.');
    }
  }

  private resolveWorksheet(workbook: XLSX.WorkBook): {
    sheetName: string;
    worksheet: XLSX.WorkSheet;
  } {
    const sheetName =
      workbook.SheetNames.find((name) => name === EMPLOYEE_IMPORT_SHEET_NAME) ??
      workbook.SheetNames[0];

    if (!sheetName) {
      throw new BadRequestException('The uploaded Excel file has no worksheets.');
    }

    return {
      sheetName,
      worksheet: workbook.Sheets[sheetName],
    };
  }

  private extractHeader(row: unknown[]): string[] {
    return row.map((cell) => String(cell ?? '').trim()).filter(Boolean);
  }

  private parseImportRows(
    header: string[],
    rows: unknown[][],
  ): {
    validRows: ParsedEmployeeImportRow[];
    errors: ImportError[];
  } {
    const validRows: ParsedEmployeeImportRow[] = [];
    const errors: ImportError[] = [];
    const seenEmployeeNumbers = new Map<string, number>();
    const seenEmails = new Map<string, number>();

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const payload = this.parseEmployeeImportRow(header, row, rowNumber);

      if ('error' in payload) {
        errors.push(payload.error);
        return;
      }

      const duplicateEmployeeNumberRow = seenEmployeeNumbers.get(
        payload.payload.employeeNumber,
      );

      if (duplicateEmployeeNumberRow) {
        errors.push({
          row: rowNumber,
          employeeNumber: payload.payload.employeeNumber,
          email: payload.payload.email,
          message: `Duplicate employeeNumber in file. First seen on row ${duplicateEmployeeNumberRow}.`,
        });
        return;
      }

      const duplicateEmailRow = seenEmails.get(payload.payload.email);

      if (duplicateEmailRow) {
        errors.push({
          row: rowNumber,
          employeeNumber: payload.payload.employeeNumber,
          email: payload.payload.email,
          message: `Duplicate email in file. First seen on row ${duplicateEmailRow}.`,
        });
        return;
      }

      seenEmployeeNumbers.set(payload.payload.employeeNumber, rowNumber);
      seenEmails.set(payload.payload.email, rowNumber);
      validRows.push({
        rowNumber,
        payload: payload.payload,
      });
    });

    return {
      validRows,
      errors,
    };
  }

  private parseEmployeeImportRow(
    header: string[],
    row: unknown[],
    rowNumber: number,
  ):
    | {
        payload: CreateEmployeeDto;
      }
    | {
        error: ImportError;
      } {
    const rowData = Object.fromEntries(
      header.map((column, index) => [column, this.normalizeCellValue(row[index])]),
    );

    const employeeNumber = rowData.employeeNumber ?? '';
    const fullName = rowData.fullName ?? '';
    const email = (rowData.email ?? '').toLowerCase();
    const department = rowData.department ?? '';
    const hireDate = this.normalizeImportDate(rowData.hireDate);

    if (!employeeNumber) {
      return {
        error: {
          row: rowNumber,
          email,
          message: 'employeeNumber is required.',
        },
      };
    }

    if (!fullName) {
      return {
        error: {
          row: rowNumber,
          employeeNumber,
          email,
          message: 'fullName is required.',
        },
      };
    }

    if (!email) {
      return {
        error: {
          row: rowNumber,
          employeeNumber,
          message: 'email is required.',
        },
      };
    }

    if (!this.isValidEmail(email)) {
      return {
        error: {
          row: rowNumber,
          employeeNumber,
          email,
          message: 'email must be a valid email address.',
        },
      };
    }

    if (!department) {
      return {
        error: {
          row: rowNumber,
          employeeNumber,
          email,
          message: 'department is required for import.',
        },
      };
    }

    if (rowData.hireDate && !hireDate) {
      return {
        error: {
          row: rowNumber,
          employeeNumber,
          email,
          message:
            'hireDate must be a valid date. Supported formats: YYYY-MM-DD or DD.MM.YYYY.',
        },
      };
    }

    return {
      payload: {
        employeeNumber,
        fullName,
        email,
        department,
        position: rowData.position,
        managerName: rowData.managerName,
        hireDate,
        branch: rowData.branch,
        legalEntity: rowData.legalEntity,
      },
    };
  }

  private async findExistingConflicts(
    rows: ParsedEmployeeImportRow[],
  ): Promise<ImportError[]> {
    if (rows.length === 0) {
      return [];
    }

    const [existingByNumber, existingByEmail] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          employeeNumber: {
            in: rows.map((row) => row.payload.employeeNumber),
          },
        },
        select: {
          employeeNumber: true,
        },
      }),
      this.prisma.employee.findMany({
        where: {
          email: {
            in: rows.map((row) => row.payload.email),
          },
        },
        select: {
          email: true,
        },
      }),
    ]);

    const takenNumbers = new Set(
      existingByNumber.map((employee) => employee.employeeNumber),
    );
    const takenEmails = new Set(existingByEmail.map((employee) => employee.email));

    return rows.flatMap((row) => {
      const errors: ImportError[] = [];

      if (takenNumbers.has(row.payload.employeeNumber)) {
        errors.push({
          row: row.rowNumber,
          employeeNumber: row.payload.employeeNumber,
          email: row.payload.email,
          message: `Employee number "${row.payload.employeeNumber}" already exists.`,
        });
      }

      if (takenEmails.has(row.payload.email)) {
        errors.push({
          row: row.rowNumber,
          employeeNumber: row.payload.employeeNumber,
          email: row.payload.email,
          message: `Employee email "${row.payload.email}" already exists.`,
        });
      }

      return errors;
    });
  }

  private async finalizeImportJob(
    importJobId: string,
    actor: RequestActor | undefined,
    result: {
      status: ImportJobStatus;
      rowsSucceeded: number;
      rowsFailed: number;
      summary: {
        sheetName: string;
        errors: ImportError[];
        createdEmployees?: Array<{ id: string; employeeNumber: string }>;
        missingColumns?: string[];
      };
    },
  ) {
    const job = await this.prisma.importJob.update({
      where: {
        id: importJobId,
      },
      data: {
        status: result.status,
        rowsSucceeded: result.rowsSucceeded,
        rowsFailed: result.rowsFailed,
        summary: result.summary,
      },
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'employee.import_completed',
      entityType: 'ImportJob',
      entityId: importJobId,
      payload: {
        status: result.status,
        rowsTotal: job.rowsTotal,
        rowsSucceeded: result.rowsSucceeded,
        rowsFailed: result.rowsFailed,
      },
    });

    return job;
  }

  private normalizeCellValue(value: unknown): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private normalizeImportDate(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const ddMmYyyyMatch = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);

    if (ddMmYyyyMatch) {
      const [, day, month, year] = ddMmYyyyMatch;
      return `${year}-${month}-${day}`;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return parsed.toISOString().slice(0, 10);
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private resolveUserProvisioningPlan(
    user: UserProvisioningCandidate | null,
    email: string,
  ): UserProvisioningPlan {
    if (!user) {
      return {
        action: 'create',
      };
    }

    if (user.employeeId) {
      throw new ConflictException(
        `User with email "${email}" is already linked to another employee.`,
      );
    }

    if (user.role !== UserRole.EMPLOYEE) {
      throw new ConflictException(
        `User with email "${email}" already exists with role "${user.role}" and cannot be linked automatically.`,
      );
    }

    return {
      action: 'bind',
      userId: user.id,
      currentStatus: user.status,
      hasPassword: Boolean(user.passwordHash),
    };
  }

  private async provisionLocalAccount(
    tx: Prisma.TransactionClient,
    employeeId: string,
    email: string,
    employeeStatus: EmployeeStatus,
    plan: UserProvisioningPlan,
  ): Promise<UserProvisioningResult> {
    if (plan.action === 'create') {
      const user = await tx.user.create({
        data: {
          email,
          role: UserRole.EMPLOYEE,
          employeeId,
          status: this.resolveEmployeeUserStatus(employeeStatus),
        },
        select: {
          id: true,
          status: true,
        },
      });

      return {
        action: 'created',
        userId: user.id,
        status: user.status,
      };
    }

    const user = await tx.user.update({
      where: {
        id: plan.userId,
      },
      data: {
        employeeId,
        status: this.resolveEmployeeUserStatus(
          employeeStatus,
          plan.currentStatus,
          plan.hasPassword,
        ),
      },
      select: {
        id: true,
        status: true,
      },
    });

    return {
      action: 'bound',
      userId: user.id,
      status: user.status,
    };
  }

  private resolveEmployeeUserStatus(
    employeeStatus: EmployeeStatus,
    currentStatus?: UserStatus,
    hasPassword = false,
  ): UserStatus {
    if (employeeStatus === EmployeeStatus.INACTIVE) {
      return UserStatus.DISABLED;
    }

    if (!hasPassword || currentStatus === UserStatus.INVITED) {
      return UserStatus.INVITED;
    }

    return UserStatus.ACTIVE;
  }
}
