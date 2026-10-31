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
 * `read_only = true`) may still use. Other methods are rejected with 403, except for the exact
 * authenticated A2 workforce current-session revocation described in the WORKFORCE_SESSION branch.
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
      let validatedA2Session = false;
      try {
        if (!this.workforceConfig.enabled)
          throw new UnauthorizedException('Workforce authentication disabled');
        principal = await this.workforceSessions.validate(
          token,
          this.workforceConfig.internalAudience,
        );
        validatedA2Session = true;
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
            if (custValidation.valid && custValidation.principal) {
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
      // Mission 19A: logout is the sole unsafe-method exception for a read-only A2 session.
      // Both Fastify's decoded parameter and the exact raw path must identify the session
      // established by this bearer; a SUPPORT fallback or a sibling session is not sufficient.
      // This skips only the read-only method check, not route policy, controller validation or
      // the session service's ownership check.
      const currentSessionId = principal.sessionId;
      const selfRevocation =
        validatedA2Session &&
        principal.readOnlyPrincipal === true &&
        request.method.toUpperCase() === 'DELETE' &&
        typeof currentSessionId === 'string' && currentSessionId.length > 0 &&
        request.params?.id === currentSessionId &&
        request.url.split('?', 1)[0] ===
          `/api/v1/internal/a2/workforce/sessions/${currentSessionId}`;
      if (!selfRevocation) this.denyUnsafeMethodForReadOnlyPrincipal(principal, request.method);

      // Mission 16A: AdminAgentController historically rejects these non-workforce principal
      // types with 401 before checking agent.view. Keep that ordering only on its read routes,
      // without skipping the catalogue gate or changing the real Agent/Customer token fallback
      // above (which deliberately returns 403 for a valid non-workforce session).
      if (
        route.rejectNonWorkforcePrincipalWith401 &&
        ['AGENT', 'CUSTOMER', 'AGGREGATOR'].includes(principal.type)
      ) {
        throw new UnauthorizedException('Privileged access required');
      }

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
      //
      // V1-SPRINT3-GUARD-01 (ARENA 3): the carefully scoped slice of that recommendation
      // implemented here enforces ONLY the catalogue gates a WORKFORCE_SESSION route policy
      // explicitly DECLARES (requiredFunctions / requiredRoles / requiredScopes) — never the
      // bare allowedPrincipalTypes list, which is what caused the 401→403 status drift when
      // blanket enforcement was trialled in V1-HARDEN-01 Part D.
      //
      // Zero-drift proof (Sprint 3 mapping, see the Sprint 3 report): every WORKFORCE_SESSION
      // branch that declares required* gates is backed by an equal-or-stricter controller gate
      // today — classes (agent.view / agent.manage_classes) ≡ AgentClassController;
      // internal receiving-number (agent.view) ≡ its controller; internal agent transactions
      // (agent.view) ≡ AdminAgentController; funding maker POSTs (agent.fund / agent.defund)
      // ≡ AgentFundingController.requireFunction; funding inbox/execute/reject
      // (FINANCE_CONTROLLER + agent.fund + agent.defund) ≡ requireFundingChecker /
      // assertCheckerPrincipal; outlets/terminals mutations (agent.manage_outlets_terminals)
      // ≡ OutletController.requireManage; aggregator mutations (aggregator.manage) ≡
      // AggregatorController.requireManage. So this check can only ever deny a principal the
      // matching controller gate would deny milliseconds later — it cannot block any
      // legitimate existing caller, and it cannot bypass a stricter controller gate (the
      // controller still runs its own full check, including principal-type allow-lists with
      // their documented status conventions, which are deliberately NOT duplicated here).
      // Denial mirrors requireFunction's default: 403 `Authorization denied: <REASON>`
      // (FUNCTION_MISSING/ROLE_MISSING/SCOPE_MISSING — identical status and message to the
      // controller-level denial for function misses). SUPER_ADMIN keeps its explicitly
      // approved behavior: it holds declared functions where policy grants them and is still
      // excluded from Decision 7 funding routes by requiredRoles (403, exactly as the
      // controllers already denied it). evaluate() (not authorize()) is used so this
      // defense-in-depth layer adds no second audit record — the authoritative, audited
      // decision remains the controller's requireFunction call, exactly as before.
      const declaredPolicy = route.policy;
      const declaresCatalogueGate =
        !!declaredPolicy &&
        ((declaredPolicy.requiredFunctions?.length ?? 0) > 0 ||
          (declaredPolicy.requiredRoles?.length ?? 0) > 0 ||
          (declaredPolicy.requiredScopes?.length ?? 0) > 0);
      if (declaresCatalogueGate && declaredPolicy) {
        const gateDecision = this.authorizationService.evaluate(
          principal,
          {
            resourceType: declaredPolicy.resourceType,
            action: declaredPolicy.action,
            ...(declaredPolicy.requiredScopes
              ? { requiredScopes: declaredPolicy.requiredScopes }
              : {}),
            ...(declaredPolicy.requiredRoles ? { requiredRoles: declaredPolicy.requiredRoles } : {}),
            ...(declaredPolicy.requiredFunctions
              ? { requiredFunctions: declaredPolicy.requiredFunctions }
              : {}),
            // REPORT-34 H-01-R2: carry the narrow, per-route function-gate exemption (today only
            // SUPPORT on GET/HEAD /internal/audit) into the evaluated policy. Omitting it would
            // silently turn the approved SUPPORT exception into a denial.
            ...(declaredPolicy.requiredFunctionsExemptPrincipalTypes
              ? {
                  requiredFunctionsExemptPrincipalTypes:
                    declaredPolicy.requiredFunctionsExemptPrincipalTypes,
                }
              : {}),
            customerAccess: 'NONE',
            agentAccess: 'NONE',
            aggregatorAccess: 'NONE',
          },
          { type: route.resourceType, id: route.resourceId },
        );
        if (!gateDecision.allowed) {
          // A newly declared Agent gate would otherwise stop the request before its existing
          // controller-level requireFunction() can record a denial. Audit only these explicitly
          // marked single-function routes, and only on denial, so allowed requests still get
          // exactly one controller decision and unrelated Arena 3 policies retain their behavior.
          if (route.auditDeniedWorkforceFunction && declaredPolicy.requiredFunctions?.length === 1) {
            const functionCode = declaredPolicy.requiredFunctions[0]!;
            await this.authorizationService.authorize(
              principal,
              {
                resourceType: route.resourceType,
                action: functionCode,
                requiredFunctions: [functionCode],
                customerAccess: 'NONE',
              },
              { type: route.resourceType },
            );
          }
          throw new ForbiddenException(`Authorization denied: ${gateDecision.reason}`);
        }
      }
      return true;
    }

    if (route.authenticationMode === 'APPLICATION_ACCESS') {
      const token = this.optionalBearerToken(request.headers.authorization);
      if (!token) return true; // The controller will reject the absent capability with 401.

      let principal: AuthorizationPrincipal | undefined;
      try {
        if (!this.workforceConfig.enabled) {
          throw new UnauthorizedException('Workforce authentication disabled');
        }
        principal = await this.workforceSessions.validate(token, this.workforceConfig.internalAudience);
      } catch {
        try {
          const supportPrincipal = await this.supportAuthenticationService.validate(token);
          if (supportPrincipal) principal = supportPrincipal;
        } catch {
          // An opaque application capability is intentionally not a workforce credential.
        }
      }

      if (principal) {
        request.authorizationPrincipal = principal;
        this.denyUnsafeMethodForReadOnlyPrincipal(principal, request.method);
        return true;
      }

      try {
        const agentValidation = await this.agentSessionService.validate({ token });
        if (agentValidation.valid && agentValidation.principal) {
          throw new ForbiddenException('Agent session cannot access applicant applications');
        }
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
      }
      try {
        const customerValidation = await this.sessionService.validate({ token });
        if (customerValidation.valid && customerValidation.principal) {
          throw new ForbiddenException('Customer session cannot access applicant applications');
        }
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
      }
      // Opaque applicant capabilities are validated by AgentApplicationService after the
      // route is reached. Unknown/malformed tokens therefore fail closed at the controller.
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
    // V1-SPRINT2-AUTHZ-01 (ARENA 3): `route.agentId` is the *resource* Agent addressed by
    // the URL (extracted by RoutePolicyRegistry from route params); `principal.agentId` is
    // the *caller's* own Agent identity from its session. For resource-addressed Agent
    // routes the SELF policy must compare the caller against the requested resource, so the
    // route-extracted id must win. The previous order (`principal.agentId ?? route.agentId`)
    // made every AGENT-principal SELF check vacuous — the caller was only ever compared
    // with itself. No registry branch set route.agentId before this fix, so the reordering
    // alone changes nothing for any pre-existing route; it activates the resource binding
    // for GET /api/v1/agents/:id/receiving-number (A21 contract SELF rule).
    const decision = await this.authorizationService.authorize(principal, route.policy, {
      type: route.resourceType,
      id: route.resourceId,
      customerId: route.customerId,
      agentId: route.agentId ?? principal.agentId,
      aggregatorId: principal.aggregatorId ?? route.aggregatorId,
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

  private optionalBearerToken(header: string | string[] | undefined): string | undefined {
    if (typeof header !== 'string') return undefined;
    return /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  }

  private bearerToken(header: string | string[] | undefined): string {
    const token = this.optionalBearerToken(header);
    if (!token) throw new UnauthorizedException('Authentication required');
    return token;
  }
}
