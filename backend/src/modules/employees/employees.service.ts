import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeStatusDto } from './dto/update-employee-status.dto';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  getImportTemplateDefinition() {
    return {
      fileType: 'xlsx',
      sheetName: 'employees',
      requiredColumns: ['employeeNumber', 'fullName', 'email', 'department'],
      optionalColumns: [
        'position',
        'managerName',
        'hireDate',
        'branch',
        'legalEntity',
      ],
      uniqueness: ['employeeNumber', 'email'],
    };
  }

  async create(payload: CreateEmployeeDto, actor?: RequestActor) {
    const email = payload.email.toLowerCase();

    const [employeeByNumber, employeeByEmail] = await Promise.all([
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
    ]);

    if (employeeByNumber) {
      throw new ConflictException(
        `Employee number "${payload.employeeNumber}" already exists.`,
      );
    }

    if (employeeByEmail) {
      throw new ConflictException(`Employee email "${email}" already exists.`);
    }

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

      return tx.employee.findUniqueOrThrow({
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
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      payload: {
        employeeNumber: employee.employeeNumber,
        email: employee.email,
      },
    });

    return employee;
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
        await tx.user.update({
          where: {
            id: existing.user.id,
          },
          data: {
            status:
              payload.status === 'ACTIVE'
                ? UserStatus.ACTIVE
                : UserStatus.DISABLED,
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
}
