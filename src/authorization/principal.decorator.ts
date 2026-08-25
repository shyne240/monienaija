import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthorizationPrincipal } from './authorization.types';

export const Principal = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthorizationPrincipal | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authorizationPrincipal;
  },
);
