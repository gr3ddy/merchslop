import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';

import { UserRole } from '../enums/domain.enum';
import { RequestActor } from '../interfaces/request-actor.interface';

const ROLE_VALUES = new Set<string>(Object.values(UserRole));

@Injectable()
export class RequestActorMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const bearerActor = this.readBearerActor(req);

    if (bearerActor) {
      req.actor = bearerActor;
      next();
      return;
    }

    const userId = this.readHeader(req, 'x-user-id');
    const role = this.readHeader(req, 'x-user-role');
    const employeeId = this.readHeader(req, 'x-employee-id');

    if (userId && role && ROLE_VALUES.has(role)) {
      const actor: RequestActor = {
        userId,
        role: role as UserRole,
        authMode: 'dev-header',
        ...(employeeId ? { employeeId } : {}),
      };

      req.actor = actor;
    }

    next();
  }

  private readHeader(req: Request, headerName: string): string | undefined {
    const value = req.headers[headerName];

    if (Array.isArray(value)) {
      return value[0];
    }

    return value;
  }

  private readBearerActor(req: Request): RequestActor | undefined {
    const authorization = this.readHeader(req, 'authorization');

    if (!authorization) {
      return undefined;
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return undefined;
    }

    try {
      const payload = this.jwtService.verify<{
        sub: string;
        role: UserRole;
        employeeId?: string;
      }>(token);

      if (!payload?.sub || !ROLE_VALUES.has(payload.role)) {
        return undefined;
      }

      return {
        userId: payload.sub,
        role: payload.role,
        employeeId: payload.employeeId,
        authMode: 'jwt',
      };
    } catch {
      return undefined;
    }
  }
}
