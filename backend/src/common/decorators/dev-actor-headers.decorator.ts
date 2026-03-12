import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export function DevActorHeaders(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiHeader({
      name: 'x-user-id',
      required: false,
      description: 'Temporary development actor user id.',
    }),
    ApiHeader({
      name: 'x-user-role',
      required: false,
      description: 'Temporary development actor role. Example: PROGRAM_ADMIN.',
    }),
    ApiHeader({
      name: 'x-employee-id',
      required: false,
      description: 'Temporary employee id for employee-scoped requests.',
    }),
  );
}

