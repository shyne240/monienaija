import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { SupportAuthenticationService } from '../support-authentication/support-authentication.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-OPS-01 — workforce provisioning of SUPPORT workforce identities.
 *
 * Closes the verified V1 gap: SUPPORT was a recognized `AuthorizationPrincipalType` and
 * every `/internal/*` route policy already allowed it, but no production code path could
 * ever actually issue a SUPPORT-typed session (A2WorkforceSessionService resolves only to
 * OPERATOR/PRIVILEGED, and the A2 Finance role vocabulary is schema-locked to exactly 4
 * Finance governance roles with no SUPPORT key).
 *
 * Mirrors AdminAgentCredentialsController exactly: workforce (OPERATOR/SERVICE/PRIVILEGED —
 * SUPPORT explicitly denied, both here and at the route-policy layer) provisions a Support
 * identity. A one-time temporary password is generated here (CSPRNG), returned ONCE in this
 * authorized response for out-of-band delivery, and is NEVER persisted or logged in
 * plaintext — only its PBKDF2 hash is stored. SUPPORT has no path anywhere in the codebase
 * to provision itself or any other workforce identity — this is the only issuance path.
 */
@Controller('internal/admin/support')
export class AdminSupportCredentialsController {
  constructor(private readonly supportAuthentication: SupportAuthenticationService) {}

  @Post('workforce-users')
  @HttpCode(201)
  async provision(@Body() body: { username?: string }, @Req() req: AuthenticatedRequest) {
    const actor = this.requireOperational(req);
    if (!body?.username) throw new UnauthorizedException('username is required');
    const { user, temporaryPassword, passwordExpiresAt } =
      await this.supportAuthentication.provision({ username: body.username, actor });
    return {
      supportUserId: user.id,
      username: user.username,
      status: user.status,
      // ONE-TIME delivery value — present only in this response; never stored or logged.
      temporaryPassword,
      passwordExpiresAt: passwordExpiresAt.toISOString(),
      deliveryNotice:
        'Temporary credential — deliver to the Support user out-of-band. No rotation flow exists in V1; the operator may re-provision if needed.',
    };
  }

  @Post('workforce-users/:id/disable')
  @HttpCode(200)
  async disable(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = this.requireOperational(req);
    const user = await this.supportAuthentication.disable(id, actor, body?.reason);
    return user;
  }

  @Post('workforce-users/:id/enable')
  @HttpCode(200)
  async enable(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.requireOperational(req);
    const user = await this.supportAuthentication.enable(id, actor);
    return user;
  }

  private requireOperational(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    // Same actor vocabulary as AdminAgentCredentialsController (V1-003 decision):
    // OPERATOR/SERVICE/PRIVILEGED only; SUPPORT, CUSTOMER, AGENT, AGGREGATOR denied.
    // SUPPORT must never be able to provision itself or another SUPPORT identity.
    if (
      principal.type === 'CUSTOMER' ||
      principal.type === 'AGENT' ||
      (principal.type as string) === 'AGGREGATOR' ||
      principal.type === 'SUPPORT'
    ) {
      throw new ForbiddenException('Operational access required');
    }
    if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type as string)) {
      throw new ForbiddenException('Operational access required');
    }
    return principal.principalId;
  }
}
