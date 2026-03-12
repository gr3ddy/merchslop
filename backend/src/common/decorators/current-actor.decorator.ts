import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { RequestActor } from '../interfaces/request-actor.interface';

export const CurrentActor = createParamDecorator(
  (data: keyof RequestActor | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const actor = request.actor as RequestActor | undefined;

    return data ? actor?.[data] : actor;
  },
);

