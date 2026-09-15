import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { A2RateLimitRuleV1 } from '../authorization/workforce-authentication.types';
import { A2SecurityRateLimitService } from '../authorization/security-rate-limit.service';
import { getRequestContext } from '../production/request-context';
import { AuthenticationSessionService } from './authentication-session.service';
import {
  CUSTOMER_AUTH_ACCOUNT_CATEGORY,
  CUSTOMER_AUTH_IP_CATEGORY,
  CUSTOMER_AUTH_RATE_LIMIT_RULES,
  customerAuthenticationRateLimitRule,
} from './customer-authentication-rate-limit.config';
import { CustomerAuthenticationRuntimeService } from './customer-authentication-runtime.service';
import { AuthenticateCustomerDto } from './dto/authenticate-customer.dto';

interface CustomerSessionRequest extends FastifyRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
}

interface SessionTokenResponse {
  authenticated: true;
  customerId: string;
  session: {
    accessToken: string;
    tokenType: string;
    sessionId: string;
    audience: string;
    expiresAt: Date;
  };
}

interface SessionViewResponse {
  sessionId: string;
  customerId: string;
  audience: string;
  status: string;
  issuedAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
}

/**
 * Customer authentication and session lifecycle over HTTP.
 *
 * `POST /customers/:id/authenticate` is the only anonymous route: it is the credential exchange
 * itself and is an explicitly registered public route in `RoutePolicyRegistry`. Every other route
 * here is bound by the `customer` route policy to the session owner (`customerAccess: 'SELF'`), and
 * additionally re-checks the authenticated session id against the `:id` path parameter.
 *
 * Credential material is never returned: responses carry only the opaque session token issued by
 * `AuthenticationSessionService` (whose SHA-256 hash is what the platform stores).
 */
@Controller('customers')
export class CustomerSessionController {
  constructor(
    private readonly runtime: CustomerAuthenticationRuntimeService,
    private readonly sessions: AuthenticationSessionService,
    private readonly rateLimits: A2SecurityRateLimitService,
    @Inject(CUSTOMER_AUTH_RATE_LIMIT_RULES)
    private readonly rateLimitRules: readonly A2RateLimitRuleV1[],
  ) {}

  @Post(':id/authenticate')
  @HttpCode(HttpStatus.OK)
  async authenticate(
    @Param('id') id: string,
    @Body() dto: AuthenticateCustomerDto,
    @Req() request: CustomerSessionRequest,
  ): Promise<SessionTokenResponse> {
    const customerId = id.trim().toLowerCase();
    // Abuse control before credential verification: bounded per client address and per account.
    // A rejection is a 429 from the shared security limiter and never discloses whether the
    // customer exists or whether the password was correct.
    const correlationId = getRequestContext(request)?.correlationId ?? 'unknown';
    await this.consumeRateLimit(
      CUSTOMER_AUTH_IP_CATEGORY,
      [this.clientAddress(request)],
      correlationId,
    );
    await this.consumeRateLimit(CUSTOMER_AUTH_ACCOUNT_CATEGORY, [customerId], correlationId);

    const result = await this.runtime.authenticateCustomer({
      customerId,
      password: dto.password,
      actor: `customer:${customerId}`,
    });

    if (!result.authenticated || !result.session) {
      // Identical response for unknown customers, wrong passwords, unavailable/expired credentials
      // and locked accounts: the failure reason is never disclosed and the password is never echoed.
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      authenticated: true,
      customerId: result.customerId,
      session: {
        accessToken: result.session.accessToken,
        tokenType: result.session.tokenType,
        sessionId: result.session.sessionId,
        audience: result.session.audience,
        expiresAt: result.session.expiresAt,
      },
    };
  }

  @Get(':id/sessions/current')
  async currentSession(
    @Param('id') id: string,
    @Req() request: CustomerSessionRequest,
  ): Promise<SessionViewResponse> {
    const principal = this.requireCustomerSession(request, id);
    const session = await this.sessions.getSession(principal.sessionId);
    if (!session || session.customerId !== principal.customerId) {
      throw new NotFoundException('Session was not found');
    }
    return {
      sessionId: session.id,
      customerId: session.customerId,
      audience: session.audience,
      status: session.status,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
    };
  }

  @Post(':id/sessions/rotate')
  @HttpCode(HttpStatus.OK)
  async rotateSession(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: CustomerSessionRequest,
  ): Promise<SessionTokenResponse> {
    const principal = this.requireCustomerSession(request, id);
    const rotated = await this.sessions.rotate({
      token: this.bearerToken(authorization),
      actor: `customer:${principal.customerId}`,
      reason: 'Customer session rotated',
    });
    if (!rotated || rotated.principal.customerId !== principal.customerId) {
      throw new UnauthorizedException('Session could not be rotated');
    }
    return {
      authenticated: true,
      customerId: rotated.principal.customerId,
      session: {
        accessToken: rotated.accessToken,
        tokenType: rotated.tokenType,
        sessionId: rotated.sessionId,
        audience: rotated.audience,
        expiresAt: rotated.expiresAt,
      },
    };
  }

  @Delete(':id/sessions/current')
  async logout(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: CustomerSessionRequest,
  ) {
    const principal = this.requireCustomerSession(request, id);
    await this.sessions.revoke({
      token: this.bearerToken(authorization),
      actor: `customer:${principal.customerId}`,
      reason: 'Customer logout',
    });
    return { revoked: true, sessionId: principal.sessionId };
  }

  @Delete(':id/sessions')
  async revokeAllSessions(@Param('id') id: string, @Req() request: CustomerSessionRequest) {
    const principal = this.requireCustomerSession(request, id);
    const session = await this.sessions.getSession(principal.sessionId);
    if (!session || session.customerId !== principal.customerId) {
      throw new NotFoundException('Session was not found');
    }
    const revoked = await this.sessions.revokeAllForCredential(
      session.credentialId,
      `customer:${principal.customerId}`,
      'Customer revoked all sessions',
    );
    return { revoked, credentialId: session.credentialId };
  }

  private async consumeRateLimit(
    category: string,
    dimensions: readonly string[],
    correlationId: string,
  ): Promise<void> {
    const rule = customerAuthenticationRateLimitRule(this.rateLimitRules, category);
    await this.rateLimits.consume(rule, dimensions, correlationId);
  }

  private clientAddress(request: CustomerSessionRequest): string {
    // `request.ip` is the socket address unless trustProxy is explicitly enabled, so this value
    // cannot be spoofed with a header by default.
    return request.ip || 'unknown';
  }

  private requireCustomerSession(
    request: CustomerSessionRequest,
    pathCustomerId: string,
  ): { customerId: string; sessionId: string } {
    const principal = request.authorizationPrincipal;
    if (!principal || principal.type !== 'CUSTOMER' || !principal.customerId) {
      throw new UnauthorizedException('Authentication required');
    }
    if (principal.customerId !== pathCustomerId.trim().toLowerCase()) {
      // Defence in depth: the route policy already denies cross-customer access.
      throw new ForbiddenException('Authorization denied');
    }
    if (!principal.sessionId) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    return { customerId: principal.customerId, sessionId: principal.sessionId };
  }

  private bearerToken(header: string | undefined): string {
    const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
    if (!match?.[1]) {
      throw new UnauthorizedException('Authentication required');
    }
    return match[1];
  }
}
