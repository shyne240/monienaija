import { Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { A2SecurityRateLimitService } from '../authorization/security-rate-limit.service';
import { LocalAdminAuthenticationService } from './local-admin-authentication.service';

interface RequestWithContext extends FastifyRequest {
  requestContext?: { correlationId: string };
}

/**
 * V1-ADMIN-LOCAL-LOGIN-01 — LOCAL DEVELOPMENT ONLY real username/password front door for
 * the Admin Web login screen.
 *
 * `POST /internal/a2/workforce/local-admin-sessions` is deliberately registered next to the
 * real OIDC exchange (`POST /internal/a2/workforce/sessions`) and uses the identical
 * route-policy authentication mode (`WORKFORCE_ASSERTION`, see route-policy-registry.ts):
 * unauthenticated, but hard-dependent on `A2_WORKFORCE_ENABLED=true` at the guard layer.
 * `LocalAdminAuthenticationService.login` then independently refuses outside
 * NODE_ENV=development/test, regardless of the guard outcome — see that service's doc
 * comment for the full, deliberately redundant gate chain.
 *
 * This controller never issues a session itself: every successful call returns exactly the
 * `A2WorkforceSessionTokenV1` shape `A2WorkforceSessionService.establish` already produces
 * for the real OIDC path, with the same roles/scopes/session storage/audit trail.
 */
@Controller('internal/a2/workforce')
export class LocalAdminAuthenticationController {
  constructor(
    private readonly localAdminAuthentication: LocalAdminAuthenticationService,
    private readonly rateLimit: A2SecurityRateLimitService,
  ) {}

  @Post('local-admin-sessions')
  async login(
    @Body() body: { email?: string; password?: string },
    @Req() request: RequestWithContext,
  ) {
    if (!body?.email || !body?.password) {
      throw new UnauthorizedException('Invalid local administrator credentials');
    }
    await this.rateLimit.consume(
      this.localAdminAuthentication.rateLimitRule(),
      [request.ip, body.email.trim().toLowerCase()],
      request.requestContext?.correlationId ?? 'unknown',
    );
    return this.localAdminAuthentication.login(body.email, body.password);
  }
}
