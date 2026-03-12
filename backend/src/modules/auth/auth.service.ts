import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  EmployeeStatus,
  PasswordActionTokenType,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { CompletePasswordActionDto } from './dto/complete-password-action.dto';
import { IssueInviteDto } from './dto/issue-invite.dto';
import { IssuePasswordResetDto } from './dto/issue-password-reset.dto';
import { LoginDto } from './dto/login.dto';

const PASSWORD_ACTION_TOKEN_TTL_HOURS: Record<PasswordActionTokenType, number> = {
  [PasswordActionTokenType.INVITE]: 72,
  [PasswordActionTokenType.RESET_PASSWORD]: 24,
};

type EmployeeUserContext = {
  id: string;
  employeeNumber: string;
  fullName: string;
  email: string;
  status: EmployeeStatus;
  user: {
    id: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    employeeId: string | null;
    passwordHash: string | null;
  } | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly mailerService: MailerService,
  ) {}

  async getSession(actor?: RequestActor): Promise<{
    authenticated: boolean;
    actor: RequestActor | null;
    authMode: string;
    user: {
      id: string;
      email: string;
      role: UserRole;
      status: UserStatus;
      employeeId: string | null;
    } | null;
  }> {
    if (!actor?.userId) {
      return {
        authenticated: false,
        actor: null,
        authMode: 'none',
        user: null,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: actor.userId,
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        employeeId: true,
      },
    });

    return {
      authenticated: Boolean(user),
      actor: actor ?? null,
      authMode: actor.authMode ?? 'unknown',
      user: user ?? null,
    };
  }

  async bootstrapAdmin(payload: BootstrapAdminDto) {
    const usersCount = await this.prisma.user.count();

    if (usersCount > 0) {
      throw new ConflictException(
        'Bootstrap admin is allowed only when no users exist.',
      );
    }

    const passwordHash = await this.hashPassword(payload.password);

    const user = await this.prisma.user.create({
      data: {
        email: payload.email.toLowerCase(),
        passwordHash,
        role: UserRole.PROGRAM_ADMIN,
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        employeeId: true,
      },
    });

    return {
      user,
      message: 'Bootstrap admin created successfully.',
    };
  }

  async login(payload: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        email: payload.email.toLowerCase(),
      },
    });

    if (!user || !user.passwordHash || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await this.verifyPassword(
      payload.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });

    const accessToken = await this.signAccessToken(user);

    return {
      accessToken,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        employeeId: user.employeeId,
      },
    };
  }

  async issueInvite(payload: IssueInviteDto, actor?: RequestActor) {
    return this.issuePasswordActionToken(
      payload.employeeId,
      PasswordActionTokenType.INVITE,
      actor,
    );
  }

  async issuePasswordReset(
    payload: IssuePasswordResetDto,
    actor?: RequestActor,
  ) {
    return this.issuePasswordActionToken(
      payload.employeeId,
      PasswordActionTokenType.RESET_PASSWORD,
      actor,
    );
  }

  async completePasswordAction(payload: CompletePasswordActionDto) {
    const tokenHash = this.hashPasswordActionToken(payload.token);
    const now = new Date();

    const actionToken = await this.prisma.passwordActionToken.findUnique({
      where: {
        tokenHash,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            employeeId: true,
            employee: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (
      !actionToken ||
      actionToken.consumedAt ||
      actionToken.expiresAt <= now ||
      actionToken.user.role !== UserRole.EMPLOYEE
    ) {
      throw new UnauthorizedException('Invalid or expired password action token.');
    }

    if (
      actionToken.user.employee &&
      actionToken.user.employee.status === EmployeeStatus.INACTIVE
    ) {
      throw new BadRequestException(
        'Inactive employees cannot complete password setup.',
      );
    }

    const passwordHash = await this.hashPassword(payload.password);
    const updatedAt = new Date();

    const user = await this.prisma.runInSerializableTransaction(async (tx) => {
      await tx.passwordActionToken.update({
        where: {
          id: actionToken.id,
        },
        data: {
          consumedAt: updatedAt,
        },
      });

      await tx.passwordActionToken.updateMany({
        where: {
          userId: actionToken.userId,
          consumedAt: null,
          id: {
            not: actionToken.id,
          },
        },
        data: {
          consumedAt: updatedAt,
        },
      });

      return tx.user.update({
        where: {
          id: actionToken.userId,
        },
        data: {
          passwordHash,
          status: UserStatus.ACTIVE,
          lastLoginAt: updatedAt,
        },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          employeeId: true,
        },
      });
    });

    await this.auditService.createEvent({
      actorId: actionToken.userId,
      action: 'auth.password_action_completed',
      entityType: 'User',
      entityId: actionToken.userId,
      payload: {
        type: actionToken.type,
        tokenId: actionToken.id,
      },
    });

    return {
      accessToken: await this.signAccessToken(user),
      tokenType: 'Bearer',
      action: actionToken.type,
      message:
        actionToken.type === PasswordActionTokenType.INVITE
          ? 'Password set successfully. Employee account is now active.'
          : 'Password reset successfully.',
      user,
    };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }

  private async issuePasswordActionToken(
    employeeId: string,
    type: PasswordActionTokenType,
    actor?: RequestActor,
  ) {
    const plainToken = this.generatePasswordActionToken();
    const tokenHash = this.hashPasswordActionToken(plainToken);
    const expiresAt = this.calculateTokenExpiry(type);
    const issuedAt = new Date();

    const result = await this.prisma.runInSerializableTransaction(async (tx) => {
      const employee = await tx.employee.findUnique({
        where: {
          id: employeeId,
        },
        select: {
          id: true,
          employeeNumber: true,
          fullName: true,
          email: true,
          status: true,
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
              employeeId: true,
              passwordHash: true,
            },
          },
        },
      });

      if (!employee) {
        throw new NotFoundException(`Employee "${employeeId}" was not found.`);
      }

      if (employee.status === EmployeeStatus.INACTIVE) {
        throw new BadRequestException(
          'Cannot issue password actions for inactive employees.',
        );
      }

      const user = await this.ensureEmployeeUser(tx, employee);
      this.assertPasswordActionAllowed(user, type);

      if (type === PasswordActionTokenType.INVITE) {
        await tx.user.update({
          where: {
            id: user.id,
          },
          data: {
            status: UserStatus.INVITED,
          },
        });
      }

      await tx.passwordActionToken.updateMany({
        where: {
          userId: user.id,
          consumedAt: null,
        },
        data: {
          consumedAt: issuedAt,
        },
      });

      const actionToken = await tx.passwordActionToken.create({
        data: {
          userId: user.id,
          type,
          tokenHash,
          expiresAt,
          issuedById: actor?.userId ?? null,
        },
        select: {
          id: true,
        },
      });

      return {
        actionTokenId: actionToken.id,
        employee,
        user: {
          id: user.id,
          email: user.email,
          status:
            type === PasswordActionTokenType.INVITE
              ? UserStatus.INVITED
              : user.status,
        },
      };
    });

    const delivery = await this.mailerService.sendPasswordActionEmail({
      to: result.user.email,
      fullName: result.employee.fullName,
      employeeNumber: result.employee.employeeNumber,
      type,
      token: plainToken,
      expiresAt,
    });

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action:
        type === PasswordActionTokenType.INVITE
          ? 'auth.invite_issued'
          : 'auth.password_reset_issued',
      entityType: 'User',
      entityId: result.user.id,
      payload: {
        employeeId: result.employee.id,
        employeeNumber: result.employee.employeeNumber,
        email: result.user.email,
        type,
        tokenId: result.actionTokenId,
        expiresAt,
        deliveryMode: delivery.mode,
        deliveryReason: delivery.reason,
        emailSent: delivery.sent,
      },
    });

    if (delivery.sent) {
      await this.auditService.createEvent({
        actorId: actor?.userId ?? null,
        action: 'auth.password_action_email_sent',
        entityType: 'User',
        entityId: result.user.id,
        payload: {
          employeeId: result.employee.id,
          type,
          recipient: delivery.recipient,
          messageId: delivery.messageId,
        },
      });
    }

    return {
      type,
      delivery: delivery.mode,
      token: delivery.mode === 'manual' ? plainToken : undefined,
      expiresAt,
      user: {
        id: result.user.id,
        email: result.user.email,
        status: result.user.status,
        employeeId: result.employee.id,
        employeeNumber: result.employee.employeeNumber,
        fullName: result.employee.fullName,
      },
      emailDelivery: {
        sent: delivery.sent,
        recipient: delivery.recipient,
        reason: delivery.reason,
      },
      message:
        type === PasswordActionTokenType.INVITE
          ? delivery.mode === 'email'
            ? 'Invite email sent successfully.'
            : 'Invite token issued successfully.'
          : delivery.mode === 'email'
            ? 'Password reset email sent successfully.'
            : 'Password reset token issued successfully.',
    };
  }

  private assertPasswordActionAllowed(
    user: {
      status: UserStatus;
      passwordHash: string | null;
    },
    type: PasswordActionTokenType,
  ) {
    if (user.status === UserStatus.DISABLED) {
      throw new BadRequestException(
        'Disabled users cannot receive invite or reset tokens.',
      );
    }

    if (type === PasswordActionTokenType.INVITE && user.passwordHash) {
      throw new ConflictException(
        'Employee account already has a password. Use password reset instead.',
      );
    }

    if (type === PasswordActionTokenType.RESET_PASSWORD && !user.passwordHash) {
      throw new ConflictException(
        'Employee account has no password yet. Use invite flow instead.',
      );
    }
  }

  private async ensureEmployeeUser(
    tx: Prisma.TransactionClient,
    employee: EmployeeUserContext,
  ) {
    if (employee.user) {
      if (employee.user.role !== UserRole.EMPLOYEE) {
        throw new ConflictException(
          `Linked user "${employee.user.email}" has unsupported role "${employee.user.role}".`,
        );
      }

      return employee.user;
    }

    const existingUserByEmail = await tx.user.findUnique({
      where: {
        email: employee.email,
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        employeeId: true,
        passwordHash: true,
      },
    });

    if (!existingUserByEmail) {
      return tx.user.create({
        data: {
          email: employee.email,
          role: UserRole.EMPLOYEE,
          employeeId: employee.id,
          status:
            employee.status === EmployeeStatus.INACTIVE
              ? UserStatus.DISABLED
              : UserStatus.INVITED,
        },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          employeeId: true,
          passwordHash: true,
        },
      });
    }

    if (existingUserByEmail.role !== UserRole.EMPLOYEE) {
      throw new ConflictException(
        `User with email "${employee.email}" already exists with role "${existingUserByEmail.role}" and cannot be linked automatically.`,
      );
    }

    if (existingUserByEmail.employeeId && existingUserByEmail.employeeId !== employee.id) {
      throw new ConflictException(
        `User with email "${employee.email}" is already linked to another employee.`,
      );
    }

    return tx.user.update({
      where: {
        id: existingUserByEmail.id,
      },
      data: {
        employeeId: employee.id,
        status:
          employee.status === EmployeeStatus.INACTIVE
            ? UserStatus.DISABLED
            : existingUserByEmail.passwordHash
              ? existingUserByEmail.status
              : UserStatus.INVITED,
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        employeeId: true,
        passwordHash: true,
      },
    });
  }

  private calculateTokenExpiry(type: PasswordActionTokenType): Date {
    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() + PASSWORD_ACTION_TOKEN_TTL_HOURS[type],
    );

    return expiresAt;
  }

  private generatePasswordActionToken(): string {
    return randomBytes(32).toString('hex');
  }

  private hashPasswordActionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private signAccessToken(user: {
    id: string;
    role: UserRole;
    employeeId: string | null;
  }) {
    return this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
      employeeId: user.employeeId ?? undefined,
    });
  }
}
