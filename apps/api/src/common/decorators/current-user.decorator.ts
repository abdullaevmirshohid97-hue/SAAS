import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { getContext } from '../context/request-context';

export const CurrentUser = createParamDecorator((_data: unknown, _ctx: ExecutionContext) => {
  const c = getContext();
  return {
    userId: c.userId,
    clinicId: c.clinicId,
    role: c.role,
    impersonatedBy: c.impersonatedBy,
  };
});

export const CurrentClinic = createParamDecorator((_data: unknown, _ctx: ExecutionContext) => {
  return getContext().clinicId;
});
