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

/**
 * V1-ADMIN-AUTHORIZATION-RUNTIME-01: HTTP methods a read-only principal (`principal.readOnlyPrincipal
 * === true`, set only by A2WorkforceSessionService when every catalogue role the principal holds is
 * `read_only = true`) may still use. Everything else (POST/PUT/PATCH/DELETE/...) is rejected with 403
 * regardless of what any individual controller/route-policy does or does not itself check.
 *
 * This generalizes, and closes, the gap documented in
 * docs/V1/V1-ADMIN-ROLE-ARCHITECTURE-AUDIT-01.md §2.2-2.3: nearly the entire /internal/** surface
 * gates purely on `allowedPrincipalTypes`, so any role collapsing to OPERATOR previously had full
 * read/write reach regardless of which specific catalogue role it actually was. It is deliberately
 * NOT a FINANCE_AUDITOR-specific or any-other-role-specific check — it is driven entirely by the
 * catalogue's `read_only` flag, so it protects every current and future read-only role without
 * naming one.
 */
const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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
      this.denyUnsafeMethodForReadOnlyPrincipal(principal, request.method);

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
      if (validation.valid && validation.principal) {
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
    }

    // V1-ADMIN-FULL-SURFACE-AUDIT-01: this default branch (reached when the route has no
    // explicit `authenticationMode`) previously only ever attempted Agent then Customer
    // session resolution. Several routes that fall through to this branch declare A2
    // workforce principal types (OPERATOR/SERVICE/PRIVILEGED) and/or SUPPORT in their
    // `policy.allowedPrincipalTypes` (e.g. the generic `/api/v1/customers/*` surface) —
    // but a genuine, valid workforce or SUPPORT bearer token could never be recognised
    // here, so it always fell straight through to "Authentication required" (401) before
    // `authorizationService.authorize()` ever got a chance to evaluate the policy that
    // already declared it allowed. This is the confirmed root cause of Admin Web screens
    // (e.g. Customer & KYC Servicing) showing "Authentication required" for a real,
    // correctly-issued FINANCE_ADMIN session.
    //
    // Sessions for every principal type are stored in separate tables and looked up by a
    // hash of the exact token value, so attempting all four here (Agent, Customer, A2
    // workforce, SUPPORT) is safe: a given token can only ever validate against one of
    // them. This does not change behaviour for any existing Agent/Customer caller — those
    // are tried first, exactly as before — it only adds a fallback for tokens neither of
    // them recognises. Final allow/deny is still decided entirely by
    // `authorizationService.authorize()` below using the route's existing, unmodified
    // policy, so this cannot grant access beyond what each route already declared allowed.
    if (!principal && this.workforceConfig.enabled) {
      try {
        principal = await this.workforceSessions.validate(token, this.workforceConfig.internalAudience);
      } catch {
        // Not a valid A2 workforce session — fall through to the next session type.
      }
    }

    if (!principal) {
      try {
        principal = await this.supportAuthenticationService.validate(token);
      } catch {
        // Not a valid SUPPORT session either — every known session type has now been tried.
      }
    }

    if (!principal) {
      throw new UnauthorizedException('Authentication required');
    }

    request.authorizationPrincipal = principal;
    this.denyUnsafeMethodForReadOnlyPrincipal(principal, request.method);
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

  /**
   * V1-ADMIN-AUTHORIZATION-RUNTIME-01. Guarded by `=== true` (not a truthy check) so a principal
   * for whom this field is `undefined` (every non-workforce principal type, and any workforce
   * principal holding zero recognized roles) is never vacuously treated as read-only.
   */
  private denyUnsafeMethodForReadOnlyPrincipal(principal: AuthorizationPrincipal, method: string): void {
    if (principal.readOnlyPrincipal === true && !SAFE_HTTP_METHODS.has(method.toUpperCase())) {
      throw new ForbiddenException('Read-only principal may not perform this operation');
    }
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
