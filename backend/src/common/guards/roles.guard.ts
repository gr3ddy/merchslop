import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestActor } from '../interfaces/request-actor.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const actor = request.actor as RequestActor | undefined;

    if (!actor) {
      throw new UnauthorizedException(
        'Actor context is missing. Provide auth or temporary dev headers.',
      );
    }

    if (!requiredRoles.includes(actor.role)) {
      throw new ForbiddenException('Insufficient role for this operation.');
    }

    return true;
  }
}

