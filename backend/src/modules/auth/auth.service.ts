import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { PrismaService } from '../prisma/prisma.service';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
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

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
      employeeId: user.employeeId ?? undefined,
    });

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

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}
