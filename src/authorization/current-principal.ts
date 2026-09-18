import { UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthorizationPrincipal } from './authorization.types';

/**
 * Fastify request carrying the principal and decision established by `RuntimeAccessGuard`.
 */
export interface PrincipalRequest extends FastifyRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * Returns the authenticated principal for the current request.
 *
 * Route policies guarantee a principal exists on every non-public route; this helper makes the
 * controller-level binding explicit instead of relying on a cast.
 */
export function currentPrincipal(request: PrincipalRequest): AuthorizationPrincipal {
  const principal = request.authorizationPrincipal;
  if (!principal) {
    throw new UnauthorizedException('Authentication required');
  }
  return principal;
}
