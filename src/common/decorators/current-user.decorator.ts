import { type ExecutionContext, createParamDecorator } from '@nestjs/common';

import type { AuthUser } from '../auth/auth-user.type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    return request.user;
  },
);
