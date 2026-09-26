import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthenticationSessionService } from '../customer-authentication/authentication-session.service';
import { AuthorizationService } from './authorization.service';
import { A2WorkforceSessionService } from './workforce-session.service';
import { A2_WORKFORCE_CONFIG } from './workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from './workforce-authentication.types';
import type { AuthorizationRequest, AuthorizationPrincipal } from './authorization.types';
import { RoutePolicyRegistry } from './route-policy-registry';
import { AgentAuthenticationSessionService } from '../agent-authentication/agent-authentication-session.service';

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
    private readonly workforceSessions: A2WorkforceSessionService,
    @Inject(A2_WORKFORCE_CONFIG) private readonly workforceConfig: A2WorkforceConfigurationV1,
    private readonly agentSessionService: AgentAuthenticationSessionService,
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

    if (route.authenticationMode === 'WORKFORCE_ASSERTION') {
      if (!this.workforceConfig.enabled)
        throw new UnauthorizedException('Workforce authentication disabled');
      return true;
    }
    if (route.authenticationMode === 'WORKFORCE_SESSION') {
      const token = this.bearerToken(request.headers.authorization);
      try {
        if (!this.workforceConfig.enabled)
          throw new UnauthorizedException('Workforce authentication disabled');
        request.authorizationPrincipal = await this.workforceSessions.validate(
          token,
          this.workforceConfig.internalAudience,
        );
        return true;
      } catch (e) {
        // For workforce routes, an Agent or Customer token should be rejected as Forbidden (403) not Unauthorized (401)
        try {
          const agentValidation = await this.agentSessionService.validate({ token });
          if (agentValidation.valid && agentValidation.principal) {
            throw new ForbiddenException('Agent not allowed on workforce route');
          }
        } catch (inner) {
          if (inner instanceof ForbiddenException) throw inner;
        }
        try {
          const custValidation = await this.sessionService.validate({ token });
          if (custValidation.valid && (custValidation as any).principal) {
            throw new ForbiddenException('Customer not allowed on workforce route');
          }
        } catch (inner) {
          if (inner instanceof ForbiddenException) throw inner;
        }
        if (e instanceof ForbiddenException || e instanceof UnauthorizedException) throw e;
        throw new UnauthorizedException('Authentication required');
      }
    }

    if (route.authenticationMode === 'AGENT_LOGIN') {
      return true;
    }

    if (route.authenticationMode === 'PROVIDER_CALLBACK') {
      // Provider callbacks use their signed partner envelope. The callback
      // boundary performs authentication and replay checks before ingestion;
      // a customer bearer session is not a valid provider credential.
      return true;
    }

    const token = this.bearerToken(request.headers.authorization);

    // Attempt Agent session first, then Customer session. Sessions are Agent-owned vs Customer-owned
    // and stored in separate tables; a token is valid in exactly one table.
    const agentValidation = await this.agentSessionService.validate({ token });
    let principal: AuthorizationPrincipal | undefined;
    if (agentValidation.valid && agentValidation.principal) {
      principal = {
        type: 'AGENT',
        principalId: agentValidation.principal.agentId,
        agentId: agentValidation.principal.agentId,
        sessionId: agentValidation.principal.sessionId,
        audience: agentValidation.principal.audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'SELF',
        assuranceLevel: 'PASSWORD',
      };
    } else {
      const validation = await this.sessionService.validate({ token });
      if (!validation.valid || !validation.principal) {
        throw new UnauthorizedException('Authentication required');
      }
      principal = {
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
    }

    request.authorizationPrincipal = principal;
    const decision = await this.authorizationService.authorize(principal, route.policy, {
      type: route.resourceType,
      id: route.resourceId,
      customerId: route.customerId,
      agentId: principal.agentId ?? route.agentId,
      aggregatorId: (principal as any).aggregatorId ?? (route as any).aggregatorId,
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
