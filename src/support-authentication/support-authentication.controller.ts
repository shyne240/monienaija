import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { SupportAuthenticationService } from './support-authentication.service';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

/**
 * V1-OPS-01 — SUPPORT workforce authentication surface.
 *
 * `POST .../workforce-sessions` is the SUPPORT login (unauthenticated, like
 * `/agents/sessions` and `/customers/sessions` — see `authenticationMode: 'SUPPORT_LOGIN'`
 * in route-policy-registry.ts). `DELETE .../workforce-sessions/:id` requires an
 * authenticated workforce bearer token (SUPPORT self, or OPERATOR/SERVICE/PRIVILEGED).
 */
@Controller('internal/support/workforce-sessions')
export class SupportAuthenticationController {
  constructor(private readonly supportAuthentication: SupportAuthenticationService) {}

  @Post()
  @HttpCode(200)
  async login(@Body() body: { username?: string; password?: string }) {
    if (!body?.username || !body?.password) {
      throw new UnauthorizedException('Invalid support credentials');
    }
    const token = await this.supportAuthentication.login(body.username, body.password);
    return token;
  }

  @Delete(':id')
  @HttpCode(200)
  async revoke(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (!['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException(`Principal type ${principal.type} not allowed`);
    }
    await this.supportAuthentication.revokeSession(
      id,
      principal,
      body?.reason?.trim() || 'Revoked by workforce',
    );
    return { revoked: true };
  }
}
