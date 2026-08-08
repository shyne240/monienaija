import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthenticationSessionService } from '../customer-authentication/authentication-session.service';
import { AuthorizationService } from './authorization.service';
import type { AuthorizationRequest, AuthorizationPrincipal } from './authorization.types';
import { RoutePolicyRegistry } from './route-policy-registry';

interface RuntimeRequest extends AuthorizationRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
}

@Injectable()
export class RuntimeAccessGuard implements CanActivate {
  constructor(
    private readonly sessionService: AuthenticationSessionService,
    private readonly authorizationService: AuthorizationService,
    private readonly routePolicyRegistry: RoutePolicyRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RuntimeRequest>();
    const route = this.routePolicyRegistry.resolve({
      method: request.method,
      url: request.url,
      params: request.params,
    });
    if (route.public) {
      return true;
    }

    if (route.authenticationMode === 'PROVIDER_CALLBACK') {
      // Provider callbacks use their signed partner envelope. The callback
      // boundary performs authentication and replay checks before ingestion;
      // a customer bearer session is not a valid provider credential.
      return true;
    }

    const token = this.bearerToken(request.headers.authorization);
    const validation = await this.sessionService.validate({ token });
    if (!validation.valid || !validation.principal) {
      throw new UnauthorizedException('Authentication required');
    }

    const principal: AuthorizationPrincipal = {
      type: 'CUSTOMER',
      principalId: validation.principal.customerId,
      customerId: validation.principal.customerId,
      sessionId: validation.principal.sessionId,
      audience: validation.principal.audience,
      roles: [],
      scopes: [],
      customerAccess: 'SELF',
      assuranceLevel: 'PASSWORD',
    };
    request.authorizationPrincipal = principal;
    const decision = await this.authorizationService.authorize(principal, route.policy, {
      type: route.resourceType,
      id: route.resourceId,
      customerId: route.customerId,
    });
    request.authorizationDecision = decision;
    if (!decision.allowed) {
      throw new ForbiddenException('Authorization denied');
    }
    return true;
  }

  private bearerToken(header: string | string[] | undefined): string {
    if (typeof header !== 'string') {
      throw new UnauthorizedException('Authentication required');
    }
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1]) {
      throw new UnauthorizedException('Authentication required');
    }
    return match[1];
  }
}
