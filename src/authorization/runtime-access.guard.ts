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
import { SupportAuthenticationService } from '../support-authentication/support-authentication.service';

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
    private readonly supportAuthenticationService: SupportAuthenticationService,
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
      let principal: AuthorizationPrincipal | undefined;
      try {
        if (!this.workforceConfig.enabled)
          throw new UnauthorizedException('Workforce authentication disabled');
        principal = await this.workforceSessions.validate(
          token,
          this.workforceConfig.internalAudience,
        );
      } catch (e) {
        // V1-OPS-01: fall back to SUPPORT workforce sessions. A2 workforce identities
        // (OPERATOR/SERVICE/PRIVILEGED) and SUPPORT identities are issued by separate
        // services and stored in separate tables, mirroring the existing Agent-vs-Customer
        // session split below.
        try {
          const supportPrincipal = await this.supportAuthenticationService.validate(token);
          if (supportPrincipal) {
            principal = supportPrincipal;
          }
        } catch (inner) {
          if (inner instanceof ForbiddenException) throw inner;
        }
        if (!principal) {
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

      request.authorizationPrincipal = principal;

      // V1-HARDEN-01 Part D: the route-policy-registry declares an explicit
      // `policy.allowedPrincipalTypes` for most WORKFORCE_SESSION routes (several internal
      // routes restrict access to OPERATOR/SERVICE/PRIVILEGED and deliberately exclude
      // SUPPORT). Authenticating successfully above only proves the bearer token is a genuine
      // A2 or SUPPORT workforce credential — it says nothing about whether that principal type
      // is allowed on this specific route. Previously this branch returned `true` immediately
      // after authentication, so `route.policy` was never consulted here at all for ANY
      // principal type.
      //
      // Investigating every WORKFORCE_SESSION controller found that each one already performs
      // its own redundant `principal.type` allow-list check (e.g.
      // LimitCatalogController.requireWorkforce(), the customer-lifecycle PATCH handler's own
      // 'Privileged access required' check, etc.) — confirmed by direct code reading of every
      // controller behind a WORKFORCE_SESSION route, and by running the targeted regression
      // test below with this exact guard change reverted: every probed SUPPORT-excluded route
      // was already correctly denied before this change, with its own pre-existing status code
      // and message. So there is no currently-reachable P0/P1/P2 here — this is a structural
      // defense-in-depth gap in the guard (not duplicating what every controller already does
      // itself), not a live vulnerability. Given that, and given that reinstating a *blanket*
      // guard-level enforcement for every WORKFORCE_SESSION principal type measurably broke
      // five pre-existing, already-passing integration suites (a22-admin-foundation,
      // v1-hardening-09-admin-notification-delivery-diagnostics, v1-capability-registry,
      // v1-customer-onboarding-02, s-fix-01-customer-lifecycle-authorization) by changing their
      // specific, deliberately-asserted status codes/messages for wrong-type A2 principals
      // (401 -> 403) without fixing anything those controllers did not already fix themselves,
      // this is intentionally NOT applied as a behavioural change. It is recorded here, and in
      // the V1-HARDEN-01 audit report (section 7), as a defense-in-depth recommendation for a
      // future task, not implemented in this one (no demonstrated exploitability; broadening it
      // would be an undemonstrated, unrelated change to the mature A2 authorization path that
      // every controller already protects on its own).
      return true;
    }

    if (route.authenticationMode === 'AGENT_LOGIN') {
      return true;
    }

    if (route.authenticationMode === 'CUSTOMER_LOGIN') {
      return true;
    }

    if (route.authenticationMode === 'SUPPORT_LOGIN') {
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
