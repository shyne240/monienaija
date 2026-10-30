import { Injectable } from '@nestjs/common';

import type { AuthorizationPolicy } from './authorization.types';

export type RouteAuthenticationMode =
  | 'PRINCIPAL'
  | 'WORKFORCE_ASSERTION'
  | 'WORKFORCE_SESSION'
  | 'PROVIDER_CALLBACK'
  | 'AGENT_LOGIN'
  | 'APPLICATION_ACCESS'
  | 'CUSTOMER_LOGIN'
  | 'SUPPORT_LOGIN';

export interface RoutePolicyInput {
  method: string;
  url: string;
  params?: Record<string, string | undefined>;
}

export interface RoutePolicyResolution {
  public: boolean;
  authenticationMode?: RouteAuthenticationMode;
  policy?: AuthorizationPolicy;
  resourceType: string;
  resourceId?: string;
  customerId?: string;
  agentId?: string;
  aggregatorId?: string;
}

const PUBLIC_ROUTES = new Set([
  // Public read-only projection of active, Cash-to-Cash eligible physical outlets.
  'GET /api/v1/public/agents/cash-to-cash-outlets',
  'GET /api/v1/health',
  'GET /api/v1/health/ready',
  // REPORT-32 M-01 (remediated on integration/main-backend-frontend-20261030): the API version
  // metadata moved OFF this list. It used to be public even though the generic internal contract
  // (and this file's own generic-branch comment) declares `/internal/**` non-public, so an
  // anonymous caller could read current/supported API version headers from an internal path.
  // It is now an explicit catalogue-gated workforce read (see
  // INTERNAL_OPERATIONAL_ROUTE_POLICIES below). Public liveness/probe needs remain covered by
  // `GET /api/v1/health` and `GET /api/v1/health/ready`.
  // V1-CUSTOMER-ONBOARDING-01 — customer registration front door (decided hybrid model,
  // docs/V1-CUSTOMER-ONBOARDING-DECISION-01.md). Unauthenticated by design: no session-
  // bearing auth mode exists pre-registration. Abuse is bounded inside the registration
  // service (per-phone/per-IP token buckets, OTP lockout/cooldown); the surface can only
  // create DRAFT customers + verified phone metadata — never ACTIVE/wallets/credentials.
  'POST /api/v1/customers/registration/otp',
  'POST /api/v1/customers/registration/otp/verify',
  'POST /api/v1/customers/registration',
]);

/**
 * REPORT-32 H-01 / M-01 — explicit least-privilege policies for the internal operational read
 * surface.
 *
 * Before this table existed, every one of these paths fell through to the registry's generic
 * `/api/v1/internal/` catch-all, whose policy listed the four workforce principal *types* and
 * declared no function, role or scope gate. `RuntimeAccessGuard` only enforces gates a policy
 * explicitly declares, so a valid SUPPORT session (or any OPERATOR/SERVICE/PRIVILEGED session,
 * whatever catalogue role it actually held) could read deployment readiness, migration metadata,
 * reconciliation status, pending-outbox counts, safe configuration and API version metadata.
 * `OperationsController` already re-checked metrics/diagnostics/outbox at the controller with
 * `requireFunction`, but `ProductionController` performed no capability check at all.
 *
 * A principal type is authentication evidence, not an authorization decision. Each route below
 * therefore requires an explicit, existing catalogue function from
 * `src/authorization-catalogue/authorization-catalogue.seed.ts` — no function identifier is
 * invented here, and none of these grants is broader than the function's documented meaning:
 *
 *   - `diagnostics.view`  — "View operational diagnostics endpoints" (SUPER_ADMIN,
 *                           FINANCE_AUDITOR, OPERATIONS).
 *   - `reconciliation.view` — "View reconciliation run status/exceptions" (SUPER_ADMIN,
 *                           FINANCE_AUDITOR, TREASURY).
 *   - `metrics.view`      — "View operational metrics" (SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS).
 *   - `outbox.view`       — "View the transactional outbox/event delivery queue"
 *                           (SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS).
 *
 * `GET /internal/readiness` and `GET /internal/deployment` return the SAME payload
 * (`ProductionReadinessService.getReadiness()`), which embeds reconciliation PASS/WARNING/ERROR
 * alongside data-source, migration and pending-outbox state. They therefore require BOTH
 * `diagnostics.view` (schema/deployment diagnostics) and `reconciliation.view` (financial
 * reconciliation state) — an all-of gate, so they are reachable only by roles holding both, i.e.
 * SUPER_ADMIN and FINANCE_AUDITOR. OPERATIONS keeps metrics/diagnostics/outbox/configuration and
 * the public `/health/ready` probe; TREASURY (whose V1 grant is exactly `reconciliation.view`)
 * does not gain deployment or migration visibility from that single function.
 *
 * SUPPORT is deliberately absent from `allowedPrincipalTypes` for every route in this table: the
 * approved V1 SUPPORT scope is "read + funding-maker + support-queue only" (UAT-SEC-005 /
 * UAT-ADMIN-011) and a SUPPORT principal holds none of these function codes. Denial is therefore
 * doubly enforced — principal type, then function.
 *
 * This is a guard-level policy (defense in depth) layered on top of, never instead of, the
 * controller-level `requireFunction` checks in `OperationsController`. No controller check is
 * removed by this table, and no route is granted a capability it did not already declare.
 */
const INTERNAL_OPERATIONAL_ROUTE_POLICIES: Record<
  string,
  { resourceType: string; requiredFunctions: readonly string[] }
> = {
  'GET /api/v1/internal/readiness': {
    resourceType: 'internal-readiness',
    requiredFunctions: ['diagnostics.view', 'reconciliation.view'],
  },
  'GET /api/v1/internal/deployment': {
    resourceType: 'internal-deployment',
    requiredFunctions: ['diagnostics.view', 'reconciliation.view'],
  },
  'GET /api/v1/internal/configuration': {
    resourceType: 'internal-configuration',
    requiredFunctions: ['diagnostics.view'],
  },
  'GET /api/v1/internal/version': {
    resourceType: 'internal-version',
    requiredFunctions: ['diagnostics.view'],
  },
  'GET /api/v1/internal/metrics': {
    resourceType: 'internal-metrics',
    requiredFunctions: ['metrics.view'],
  },
  'GET /api/v1/internal/diagnostics': {
    resourceType: 'internal-diagnostics',
    requiredFunctions: ['diagnostics.view'],
  },
  'GET /api/v1/internal/outbox': {
    resourceType: 'internal-outbox',
    requiredFunctions: ['outbox.view'],
  },
};

/**
 * REPORT-32 H-01 — the one internal read that keeps SUPPORT reach by explicit product decision.
 *
 * `GET /api/v1/internal/audit` is the generic audit listing. `OperationsController` intentionally
 * does not gate it behind `audit.view`, because a genuine SUPPORT workforce session is a proven,
 * pre-existing consumer (a22-admin-foundation "Audit reads via workforce and no sensitive fields"),
 * SUPPORT is not a catalogue-governed principal type, and withdrawing that capability would be an
 * unapproved reduction of SUPPORT's approved scope. The remediation decision (recorded in the
 * Report 32 remediation report) is to keep the capability but make it an explicit, documented
 * policy rather than an accident of the generic catch-all, so the reachable principal set for
 * audit is stated in one auditable place and cannot silently widen.
 *
 * The narrower `notification.provider.view` restriction on provider-configuration audit rows is
 * still enforced inside the controller, unchanged.
 */
const INTERNAL_AUDIT_READ = {
  resourceType: 'internal-audit-read',
  allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'] as const,
};


  // INTEGRATION (integration/main-backend-frontend-20261030) — constructs carried over from
  // main (39a9e504, phase 16-20 production readiness). Two of main's four registry additions are
  // deliberately NOT carried over; see docs/integration/20261030 for the recorded rationale.

/**
 * Customer credential exchange. Matched with an exact route shape so that no other
 * `/customers/:id/*` route is affected. The handler is responsible for credential verification,
 * generic failure responses and account lockout.
 */
const CUSTOMER_AUTHENTICATION_ROUTE =
  /^\/api\/v1\/customers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/authenticate$/i;

// INTEGRATION NOTE (integration/main-backend-frontend-20261030) — main's
// `CUSTOMER_SELF_SERVICE_ROUTES` / `CUSTOMER_REACHABLE_PRINCIPALS` / `INTERNAL_ACCESS_SCOPE`
// constructs are deliberately NOT carried into this registry. They made GET/POST
// /deposits, /withdrawals, /transfers and /wallets customer-reachable with
// `customerAccess: 'SELF'`, but on collection routes there is no resource customer id for the
// guard's SELF check to compare against, so customer scoping depends entirely on the controller
// calling main's `customerSelfId()` + `*ForCustomer()` service methods. The integrated V1
// financial controllers (Lineage A) do the opposite: they disable the generic command endpoints
// outright and gate reads behind catalogue function codes for workforce principals. Carrying
// main's registry entries without main's controllers would therefore have exposed unscoped
// collection reads to customer principals — a cross-customer disclosure gap, not a protection.
// Both halves of main's design are left dormant together and the choice is escalated: see
// docs/integration/20261030-CONTROLLED-INTEGRATION-REPORT.md (open item OI-01).

@Injectable()
export class RoutePolicyRegistry {
  resolve(input: RoutePolicyInput): RoutePolicyResolution {
    const method = input.method.toUpperCase();
    const path = input.url.split('?', 1)[0] ?? input.url;
    if (PUBLIC_ROUTES.has(`${method} ${path}`)) {
      return { public: true, resourceType: 'public-route' };
    }

    if (method === 'POST' && path === '/api/v1/internal/a2/workforce/sessions') {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_ASSERTION',
        resourceType: 'a2-workforce-session-exchange',
      };
    }
    // V1-ADMIN-LOCAL-LOGIN-01 — LOCAL DEVELOPMENT ONLY real username/password front door for
    // Admin Web. Uses the identical authentication mode as the real OIDC exchange above
    // (unauthenticated at the HTTP layer, hard-gated on A2_WORKFORCE_ENABLED=true by
    // RuntimeAccessGuard); LocalAdminAuthenticationService then independently refuses outside
    // NODE_ENV=development/test regardless of this route ever being reachable.
    if (method === 'POST' && path === '/api/v1/internal/a2/workforce/local-admin-sessions') {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_ASSERTION',
        resourceType: 'a2-workforce-local-admin-login',
      };
    }
    if (path.startsWith('/api/v1/internal/a2/workforce/')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'a2-workforce-administration',
      };
    }

    if (method === 'POST' && path === '/api/v1/internal/partner-callbacks/nibss-nip') {
      return {
        public: false,
        authenticationMode: 'PROVIDER_CALLBACK',
        resourceType: 'external-partner-callback',
        policy: {
          resourceType: 'external-partner-callback',
          action: 'partner:callback:receive',
          allowedPrincipalTypes: ['SERVICE'],
          customerAccess: 'NONE',
        },
      };
    }

    // Customer App — login is unauthenticated (CUSTOMER_LOGIN)
    if (
      method === 'POST' &&
      (path === '/api/v1/customers/sessions' || path === '/api/v1/customers/login')
    ) {
      return {
        public: false,
        authenticationMode: 'CUSTOMER_LOGIN',
        resourceType: 'customer-session',
      };
    }

    // Customer initial-credential rotation (V1-CUSTOMER-CREDENTIALS-01) — unauthenticated
    // like login: the customer proves the temporary password and receives its first session
    // only AFTER rotation completes inside this handler. No bearer token exists yet.
    if (method === 'POST' && path === '/api/v1/customers/credentials/rotate') {
      return {
        public: false,
        authenticationMode: 'CUSTOMER_LOGIN',
        resourceType: 'customer-credential-rotation',
      };
    }
    // Customer App — self routes are strictly CUSTOMER SELF (A23). Must be before generic customers check.
    if (path === '/api/v1/customers/me' || path.startsWith('/api/v1/customers/me/')) {
      return {
        public: false,
        resourceType: 'customer',
        policy: {
          resourceType: 'customer',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['CUSTOMER'],
          customerAccess: 'SELF',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }
    // Customer lifecycle transitions (PATCH /customers/:id) are privileged workforce
    // operations (S-FIX-01, audit contradiction C-3). UpdateCustomerDto carries lifecycle
    // status only: a CUSTOMER SELF principal must not self-activate / self-unsuspend /
    // self-close merely by supplying its own customer id. Workforce session required;
    // Customer/Agent bearer tokens are denied (authenticated principal cross-check).
    // SUPPORT is excluded from this branch (UAT-DEFECT-001 fix): per the authoritative
    // V1 UAT catalogue (UAT-SEC-005 / UAT-ADMIN-011) the SUPPORT scope is
    // "read + funding-maker + support-queue only" — lifecycle transitions are
    // OPERATOR/SERVICE/PRIVILEGED only, mirroring the agent-lifecycle branch's
    // SUPPORT-exclusion recorded below (V1-003 decision).
    // Self-service remains available under /customers/me/* (checked above).
    if (method === 'PATCH' && /^\/api\/v1\/customers\/(?!me(?:\/|$))[^/]+$/.test(path)) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'customer-lifecycle',
        policy: {
          resourceType: 'customer-lifecycle',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }
    // Bare /customers list + create (no :id segment). This is the same admin/back-office
    // customer-servicing surface as the generic `/customers/:id` branch below (same
    // allowedPrincipalTypes, already declared there) but listing/creating customers never
    // targets an existing customerId, so there is no "self" resource to scope against —
    // `customerAccess: 'NONE'` is accurate rather than a functional restriction (the
    // customer-scope check only ever engages when a resource customerId is present).
    // V1-ADMIN-FULL-SURFACE-AUDIT-01: this exact path previously had no dedicated branch at
    // all and fell to the final catch-all below, whose `requiredScopes: ['internal:access']`
    // is never granted to any principal — meaning the bare list/create endpoints were
    // unreachable by design for everyone, not just workforce principals.
    // SUPPORT is deliberately excluded from both branches below (not just CUSTOMER/OPERATOR/
    // SERVICE/PRIVILEGED as previously declared). Per the authoritative V1 UAT catalogue
    // (UAT-SEC-005 / UAT-ADMIN-011, see the lifecycle-PATCH comment above) SUPPORT's scope is
    // "read + funding-maker + support-queue only" — it must not read or write arbitrary
    // customer PII/records through this general-purpose customer domain surface at all, only
    // through its own dedicated, narrowly-scoped controllers (support tickets, phone
    // verification, etc. under /internal/customers and /customers/me/support). This was
    // previously an inert over-grant (the guard bug made the whole branch unreachable by any
    // workforce/SUPPORT principal, so it never mattered); it is corrected here in the same
    // change that fixes guard reachability, per the explicit real-HTTP regression test in
    // test/v1-harden-01-support-adversarial.integration.spec.ts ("a real SUPPORT bearer token
    // cannot read or modify an arbitrary customer record via the customer API" — written in
    // advance against exactly this guard fallback fix).
    if (path === '/api/v1/customers') {
      return {
        public: false,
        resourceType: 'customer',
        policy: {
          resourceType: 'customer',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['CUSTOMER', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
        },
      };
    }

    // Compliance cases are highly restricted workforce records, not customer self-service.
    // The class-level case guard checks the applicable database-backed function/access type;
    // the service also scopes every case and child record to its customer and category.
    if (/^\/api\/v1\/customers\/[^/]+\/compliance-cases(?:\/.*)?$/.test(path)) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'customer-compliance-case',
        resourceId: input.params?.caseId,
        customerId: input.params?.id,
        policy: {
          resourceType: 'customer-compliance-case',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
          customerAccess: 'SELF',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Secure Proof of Address documents are workforce-only and never inherit the customer
    // self-service policy. The controller additionally requires the dedicated catalogue
    // function for each metadata, upload, content, withdrawal, and archive operation.
    if (/^\/api\/v1\/customers\/[^/]+\/proof-of-address(?:\/.*)?$/.test(path)) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'customer-proof-of-address',
        resourceId: input.params?.submissionId,
        customerId: input.params?.customerId,
        policy: {
          resourceType: 'customer-proof-of-address',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          // Workforce principals do not carry customerAccess=ANY; SELF is the established
          // workforce route scope here (the principal-type allowlist excludes customer self-service).
          // The controller also requires a dedicated PoA function and the service scopes every row
          // by both customerId and submissionId.
          customerAccess: 'SELF',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // INTEGRATION: main's phase 16-20 customer credential exchange. Marked public because the
    // caller has no session yet; the handler (CustomerSessionController.authenticate) performs
    // the credential verification, generic failure responses, account lockout and the bounded
    // per-client-address / per-account rate limiting. Without this entry the route falls to the
    // generic `/customers/:id` branch below, whose customerAccess:'SELF' policy demands a bearer
    // token and makes the login route unreachable.
    if (method === 'POST' && CUSTOMER_AUTHENTICATION_ROUTE.test(path)) {
      return { public: true, resourceType: 'customer-authentication' };
    }

    const customerId = input.params?.id;
    if (path.startsWith('/api/v1/customers/')) {
      return {
        public: false,
        resourceType: 'customer',
        resourceId: customerId,
        customerId,
        policy: {
          resourceType: 'customer',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['CUSTOMER', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'SELF',
        },
      };
    }

    // Agent authentication HTTP surface (A7) — Agent-owned routes
    // Login is unauthenticated (AGENT_LOGIN) and must not require a bearer token.
    if (method === 'POST' && path === '/api/v1/agents/sessions') {
      return {
        public: false,
        authenticationMode: 'AGENT_LOGIN',
        resourceType: 'agent-session',
      };
    }
    if (method === 'POST' && path === '/api/v1/agents/login') {
      return {
        public: false,
        authenticationMode: 'AGENT_LOGIN',
        resourceType: 'agent-session',
      };
    }

    // Agent initial-credential rotation (V1-AGENT-CREDENTIALS-01) — unauthenticated like
    // login: the Agent proves the temporary password and receives its first session only
    // AFTER rotation completes inside this handler. No bearer token exists yet.
    if (method === 'POST' && path === '/api/v1/agents/credentials/rotate') {
      return {
        public: false,
        authenticationMode: 'AGENT_LOGIN',
        resourceType: 'agent-credential-rotation',
      };
    }

    // Recipient resolution — A9: typed CUSTOMER vs AGENT resolution by receiving number / phone
    // Preserve Customer phone + MonieNaija resolution; block PENDING/rejected/deleted/terminated at service layer.
    if (path.startsWith('/api/v1/recipients/')) {
      return {
        public: false,
        resourceType: 'recipient-resolution',
        policy: {
          resourceType: 'recipient-resolution',
          action: `${method}:${path}`,
          allowedPrincipalTypes: [
            'CUSTOMER',
            'AGENT',
            'SUPPORT',
            'OPERATOR',
            'SERVICE',
            'PRIVILEGED',
          ],
          customerAccess: 'ANY',
          agentAccess: 'ANY',
        },
      };
    }

    // A8 application creation remains public. Subsequent applicant access uses the one-time
    // capability returned at creation; workforce review uses its own catalogue function.
    if (method === 'POST' && path === '/api/v1/agents/applications') {
      return {
        public: false,
        authenticationMode: 'AGENT_LOGIN',
        resourceType: 'agent-application',
      };
    }
    if (path.startsWith('/api/v1/agents/applications/')) {
      return {
        public: false,
        authenticationMode: 'APPLICATION_ACCESS',
        resourceType: 'agent-application',
      };
    }

    // Outlets & Terminals via Aggregator — internal privileged (A20)
    // Must be checked before generic aggregator block; Aggregator context is via A18 relationship
    if (
      (method === 'POST' &&
        /^\/api\/v1\/internal\/aggregators\/[^/]+\/agents\/[^/]+\/outlets$/.test(path)) ||
      (method === 'POST' &&
        /^\/api\/v1\/internal\/aggregators\/[^/]+\/agents\/[^/]+\/terminals$/.test(path))
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: path.includes('/terminals') ? 'agent-terminal' : 'agent-outlet',
        policy: {
          resourceType: path.includes('/terminals') ? 'agent-terminal' : 'agent-outlet',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredFunctions: ['agent.manage_outlets_terminals'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Aggregator management — internal privileged (A18 foundation). No public aggregator creation.
    // Inactive/terminated aggregators cannot perform restricted operations (checked in service layer).
    // Aggregator as a principal type is distinct from Agent/Customer; do not grant AGENT SELF.
    if (path.startsWith('/api/v1/internal/aggregators')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'aggregator',
        policy: {
          resourceType: 'aggregator',
          action: `${method}:${path}`,
          allowedPrincipalTypes:
            method === 'GET'
              ? ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']
              : ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          ...(method === 'GET' ? {} : { requiredFunctions: ['aggregator.manage'] }),
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Aggregator self routes (if later authentication is introduced) would be handled here.
    // A18 does not expose aggregator login; foundation only. See AggregatorService docs.

    // V1-SPRINT3-AGENT-HISTORY-API-01 (ARENA 3): workforce read of an Agent's unified
    // transaction history (AdminAgentController). Same gate as the internal receiving-number
    // read below and the sibling agent investigation reads: catalogue function agent.view.
    // SUPPORT is excluded (it holds no agent-domain functions by policy). Declared here for
    // defense in depth; the controller enforces the identical gate via requireFunction.
    if (
      method === 'GET' &&
      /^\/api\/v1\/internal\/agents\/[^/]+\/transactions$/.test(path)
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-transaction-history',
        policy: {
          resourceType: 'agent-transaction-history',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredFunctions: ['agent.view'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // V1-SPRINT2-AUTHZ-01 (ARENA 3): internal Agent receiving-number reads.
    // docs/V1/V1-PHASE1-AGENT-SECURITY-IMPLEMENTATION-01.md §"Applications and function
    // permissions": "Internal receiving-number reads require agent.view." Previously this
    // route fell through to the generic /api/v1/internal/ branch below, which admits ANY
    // workforce principal type (including SUPPORT) with no catalogue function at all —
    // insufficient authorization for an Agent funding-identifier read. SUPPORT is excluded
    // here (it holds no agent-domain functions by policy, see
    // support-authentication.service.ts principalFor) and the read is bound to the
    // agent.view catalogue function, matching the classes GET gate below.
    if (
      method === 'GET' &&
      /^\/api\/v1\/internal\/agents\/[^/]+\/receiving-number$/.test(path)
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-receiving-number',
        policy: {
          resourceType: 'agent-receiving-number',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredFunctions: ['agent.view'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    if (
      /^\/api\/v1\/internal\/agents\/classes(?:\/[^/]+)?$/.test(path)
    ) {
      const functionCode = method === 'GET' ? 'agent.view' : 'agent.manage_classes';
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-class',
        policy: {
          resourceType: 'agent-class',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredFunctions: [functionCode],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Agent funding maker commands. They create pending requests only; Decision 7's
    // AGENT_NETWORK_MANAGER/FINANCE_CONTROLLER governance is checked again by the controller
    // and the funding service before any journal can post.
    if (
      (method === 'POST' && /^\/api\/v1\/internal\/agents\/[^/]+\/(fund|defund|fund-request|defund-request)$/.test(path)) ||
      (method === 'POST' &&
        /^\/api\/v1\/internal\/aggregators\/[^/]+\/agents\/[^/]+\/(fund|defund)$/.test(path))
    ) {
      const functionCode = path.endsWith('/defund') || path.endsWith('/defund-request')
        ? 'agent.defund'
        : 'agent.fund';
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-funding',
        policy: {
          resourceType: 'agent-funding',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredFunctions: [functionCode],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // V1-SPRINT2-FUNDING-INBOX-01 (ARENA 3): global checker inbox for Agent funding work.
    // Read-only cross-Agent discovery for the independent FINANCE_CONTROLLER checker side
    // of Decision 7 — mirrors the requiredRoles/requiredFunctions gate of the
    // execute/reject branches below and is re-checked inside AgentFundingService
    // (assertCheckerPrincipal). Deliberately does NOT require or confer agent.view or any
    // other Agent Network function; the maker's own requests are excluded server-side so
    // maker-checker independence is preserved.
    if (
      method === 'GET' &&
      path === '/api/v1/internal/agents/funding-requests'
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-funding-request',
        policy: {
          resourceType: 'agent-funding-request',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredRoles: ['FINANCE_CONTROLLER'],
          requiredFunctions: ['agent.fund', 'agent.defund'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    if (
      method === 'GET' &&
      /^\/api\/v1\/internal\/agents\/[^/]+\/funding-requests$/.test(path)
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-funding-request',
        policy: {
          resourceType: 'agent-funding-request',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    if (
      method === 'POST' &&
      /^\/api\/v1\/internal\/agents\/funding-requests\/[^/]+\/(execute|reject)$/.test(path)
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-funding-request',
        policy: {
          resourceType: 'agent-funding-request',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredRoles: ['FINANCE_CONTROLLER'],
          requiredFunctions: ['agent.fund', 'agent.defund'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Agent outlets & terminals — internal privileged (A20)
    if (
      path.startsWith('/api/v1/internal/agents/') &&
      (path.includes('/outlets') || path.includes('/terminals'))
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: path.includes('/terminals') ? 'agent-terminal' : 'agent-outlet',
        policy: {
          resourceType: path.includes('/terminals') ? 'agent-terminal' : 'agent-outlet',
          action: `${method}:${path}`,
          allowedPrincipalTypes:
            method === 'GET'
              ? ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']
              : ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          ...(method === 'GET' ? {} : { requiredFunctions: ['agent.manage_outlets_terminals'] }),
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }
    if (
      path.startsWith('/api/v1/internal/outlets/') ||
      path.startsWith('/api/v1/internal/terminals/')
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType:
          path.includes('/terminals/') || path.startsWith('/api/v1/internal/terminals/')
            ? 'agent-terminal'
            : 'agent-outlet',
        policy: {
          resourceType:
            path.includes('/terminals/') || path.startsWith('/api/v1/internal/terminals/')
              ? 'agent-terminal'
              : 'agent-outlet',
          action: `${method}:${path}`,
          allowedPrincipalTypes:
            method === 'GET'
              ? ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']
              : ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          ...(method === 'GET' ? {} : { requiredFunctions: ['agent.manage_outlets_terminals'] }),
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // V1-003 Admin operational control plane — agent lifecycle (suspend/terminate/reactivate/activate)
    // Legacy routes /internal/agents/:id/{suspend,terminate,reactivate,activate} remain for compatibility but now restricted
    // New consolidated routes /internal/admin/agents/:id/{...} are authoritative admin surface
    // Both require OPERATOR/SERVICE/PRIVILEGED (SUPPORT denied) — documented V1-003 decision
    if (
      (method === 'POST' &&
        /^\/api\/v1\/internal\/agents\/[^/]+\/(suspend|terminate|reactivate|activate)$/.test(
          path,
        )) ||
      (method === 'POST' &&
        /^\/api\/v1\/internal\/agents\/applications\/[^/]+\/activate$/.test(path))
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-lifecycle',
        policy: {
          resourceType: 'agent-lifecycle',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }
    // Agent credential issuance/reissuance (V1-AGENT-CREDENTIALS-01) — internal privileged
    // workforce surface mirroring the agent-lifecycle actor vocabulary (controller enforces
    // OPERATOR/SERVICE/PRIVILEGED; SUPPORT denied there as with lifecycle actions).
    // Customer credential issuance/reissuance (V1-CUSTOMER-CREDENTIALS-01) — internal
    // privileged workforce surface mirroring the agent credential issuance vocabulary
    // (controller enforces OPERATOR/SERVICE/PRIVILEGED; SUPPORT denied there as well).
    if (
      method === 'POST' &&
      /^\/api\/v1\/internal\/admin\/customers\/[^/]+\/credentials(\/reissue)?$/.test(path)
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'customer-credential-issuance',
        policy: {
          resourceType: 'customer-credential-issuance',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    if (
      method === 'POST' &&
      /^\/api\/v1\/internal\/admin\/agents\/[^/]+\/credentials(\/reissue)?$/.test(path)
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-credential-issuance',
        policy: {
          resourceType: 'agent-credential-issuance',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // SUPPORT workforce identity provisioning (V1-OPS-01) — mirrors the Agent/Customer
    // credential-issuance actor vocabulary exactly. SUPPORT must never be able to provision
    // itself or another SUPPORT identity, so it is explicitly excluded here (defense in
    // depth alongside AdminSupportCredentialsController's own check).
    if (
      method === 'POST' &&
      /^\/api\/v1\/internal\/admin\/support\/workforce-users(\/[^/]+\/(disable|enable))?$/.test(path)
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'support-workforce-provisioning',
        policy: {
          resourceType: 'support-workforce-provisioning',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // SUPPORT workforce login (V1-OPS-01) — unauthenticated, like /agents/sessions and
    // /customers/sessions. The Support user proves its own credential inside the handler;
    // no bearer token exists yet.
    if (method === 'POST' && path === '/api/v1/internal/support/workforce-sessions') {
      return {
        public: false,
        authenticationMode: 'SUPPORT_LOGIN',
        resourceType: 'support-workforce-session',
      };
    }

    if (
      path.startsWith('/api/v1/internal/admin/agents/') &&
      method === 'POST' &&
      (/^\/api\/v1\/internal\/admin\/agents\/[^/]+\/(suspend|terminate|reactivate|activate)$/.test(
        path,
      ) ||
        /^\/api\/v1\/internal\/admin\/agents\/applications\/[^/]+\/activate$/.test(path) ||
        path.endsWith('/suspend') ||
        path.endsWith('/terminate') ||
        path.endsWith('/reactivate') ||
        path.endsWith('/activate'))
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'admin-agent-lifecycle',
        policy: {
          resourceType: 'admin-agent-lifecycle',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Notification template/configuration governance is workforce-session only. Keep the
    // existing delivery-diagnostics route separate; its legacy callers are unaffected.
    if (path === '/api/v1/internal/notifications/events' ||
        path === '/api/v1/internal/notifications/templates' ||
        path.startsWith('/api/v1/internal/notifications/templates/') ||
        path === '/api/v1/internal/notifications/changes' ||
        path.startsWith('/api/v1/internal/notifications/changes/')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'notification-registry',
        policy: {
          resourceType: 'notification-registry', action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
          customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
        },
      };
    }

    // V1-LIMIT-05 + audit F-03/P0-03 (docs/audit/20261028): limit DIAGNOSTICS reads are gated by
    // the catalogue function `limit.view` (FINANCE domain, READ sensitivity), AND-combined with the
    // workforce principal-type allowlist — the same function the Admin Web LimitAssignmentScreen
    // and navigation-access have always required client-side. Declared here so the RuntimeAccessGuard
    // V1-SPRINT3-GUARD-01 slice enforces it (403 Authorization denied: FUNCTION_MISSING) in addition
    // to the authoritative controller-level check in LimitOperationsController. This narrows access
    // only: roles holding limit.view (SUPER_ADMIN, FINANCE_PREPARER, FINANCE_CONTROLLER,
    // FINANCE_AUDITOR, AGENT_NETWORK_MANAGER) resolve to OPERATOR/PRIVILEGED and keep access;
    // workforce roles without the function are now denied where principal type alone previously
    // admitted them. Exact GET paths only — the mutation route
    // POST /api/v1/internal/limit-reservation-recovery/release stays under the generic prefix with
    // its separate stricter PRIVILEGED-only controller gate (reservation release is NOT conflated
    // with diagnostics reads).
    if (
      method === 'GET' &&
      (path === '/api/v1/internal/limit-usages' || path === '/api/v1/internal/limit-reservations')
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'limit-catalogue',
        policy: {
          resourceType: 'limit-catalogue',
          action: `${method}:${path}`,
          requiredFunctions: ['limit.view'],
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Limit catalogue & assignment — workforce-only OPERATOR/SERVICE/PRIVILEGED (V1-LIMIT-01/02). Strict subset of generic internal.
    if (path.startsWith('/api/v1/internal/limit-')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'limit-catalogue',
        policy: {
          resourceType: 'limit-catalogue',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Commercial decision snapshots — workforce read-only evidence surface (V1-COMMERCIAL-DECISION-01).
    // Strict subset of generic internal; snapshots are immutable and written only internally.
    if (path.startsWith('/api/v1/internal/commercial-decision')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'commercial-decision-snapshot',
        policy: {
          resourceType: 'commercial-decision-snapshot',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Product catalogue — workforce configuration surface (V1-COMMERCIAL-02).
    // Strict subset of generic internal; the catalogue is the authoritative product identity.
    if (path.startsWith('/api/v1/internal/products')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'product-catalogue',
        policy: {
          resourceType: 'product-catalogue',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Fee rule registry — workforce configuration surface (V1-COMMERCIAL-03). Schema foundation:
    // manages fee rule DEFINITIONS only; no runtime charging exists.
    if (path.startsWith('/api/v1/internal/fee-rules')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'fee-rule-registry',
        policy: {
          resourceType: 'fee-rule-registry',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Commission rule registry — workforce configuration surface (V1-COMMISSION-01). Schema
    // foundation: manages commission rule DEFINITIONS and read-only resolution diagnostics only;
    // no runtime commission charging or posting exists and zero production rules are seeded.
    if (path.startsWith('/api/v1/internal/commission-rules')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'commission-rule-registry',
        policy: {
          resourceType: 'commission-rule-registry',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Reward rule registry — workforce configuration surface (V1-REWARD-01). Schema
    // foundation: manages reward rule DEFINITIONS and read-only resolution diagnostics only;
    // no runtime reward crediting or posting exists and zero production rules are seeded.
    if (path.startsWith('/api/v1/internal/reward-rules')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'reward-rule-registry',
        policy: {
          resourceType: 'reward-rule-registry',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Commission rule registry — workforce configuration surface (V1-COMMISSION-01). Schema
    // foundation: manages commission rule DEFINITIONS + read-only resolution diagnostics only;
    // no runtime commission charging exists and no production rules are seeded.
    if (path.startsWith('/api/v1/internal/commission-rules')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'commission-rule-registry',
        policy: {
          resourceType: 'commission-rule-registry',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Reward rule registry — workforce configuration surface (V1-REWARD-01). Schema
    // foundation: manages reward rule DEFINITIONS + read-only resolution diagnostics only;
    // no runtime reward crediting exists and no production rules are seeded.
    if (path.startsWith('/api/v1/internal/reward-rules')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'reward-rule-registry',
        policy: {
          resourceType: 'reward-rule-registry',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Capability registry — internal workforce only (V1-CAPABILITY-REGISTRY-01), read-only
    if (path.startsWith('/api/v1/internal/capabilities')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'capability-registry',
        policy: {
          resourceType: 'capability-registry',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // REPORT-32 H-01 / M-01 — explicit capability gates for the internal operational read
    // surface. Must precede the generic `/api/v1/internal/` branch below, which declares no
    // function/role/scope gate and therefore only authenticated a caller. See
    // INTERNAL_OPERATIONAL_ROUTE_POLICIES and INTERNAL_AUDIT_READ at the top of this file.
    const operationalPolicy = INTERNAL_OPERATIONAL_ROUTE_POLICIES[`${method} ${path}`];
    if (operationalPolicy) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: operationalPolicy.resourceType,
        policy: {
          resourceType: operationalPolicy.resourceType,
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredFunctions: [...operationalPolicy.requiredFunctions],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // REPORT-32 H-01 — generic audit listing keeps SUPPORT reach by explicit product decision;
    // stated here so the reachable principal set is deliberate and auditable. See
    // INTERNAL_AUDIT_READ.
    if (method === 'GET' && path === '/api/v1/internal/audit') {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: INTERNAL_AUDIT_READ.resourceType,
        policy: {
          resourceType: INTERNAL_AUDIT_READ.resourceType,
          action: `${method}:${path}`,
          allowedPrincipalTypes: [...INTERNAL_AUDIT_READ.allowedPrincipalTypes],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Generic internal admin surface — workforce only (A22). Covers list/get for
    // agents, customers, aggregators (when not caught above), reconciliation,
    // audit, metrics, diagnostics, outbox, version (non-public), configuration,
    // readiness, deployment etc. Must be before the generic agents check.
    if (path.startsWith('/api/v1/internal/')) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'internal-route',
        policy: {
          resourceType: 'internal-route',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // V1-FULL-ADMIN-01 — Workforce observability for ledger & transaction rails
    // These routes previously fell to the final `internal:access` catch-all below
    // which is granted to no role (documented broken in
    // docs/V1/V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01.md). They are legitimate
    // workforce reads/writes (ledger view/post/reverse, transfer/deposit/withdrawal
    // trace, wallet read, fee calc, limits) and must be reachable via workforce
    // session. Fine-grained denial (FINANCE_AUDITOR can view, not post/reverse)
    // is enforced inside each controller via AuthorizationService.requireFunction().
    if (
      path.startsWith('/api/v1/ledger') ||
      path.startsWith('/api/v1/transfers') ||
      path.startsWith('/api/v1/wallets') ||
      path.startsWith('/api/v1/deposits') ||
      path.startsWith('/api/v1/withdrawals') ||
      path.startsWith('/api/v1/fees') ||
      path.startsWith('/api/v1/limits') ||
      path.startsWith('/api/v1/quotes') ||
      path.startsWith('/api/v1/banks') ||
      path.startsWith('/api/v1/beneficiaries') ||
      path.startsWith('/api/v1/virtual-accounts')
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'workforce-observability',
        policy: {
          resourceType: 'workforce-observability',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // All other /api/v1/agents/* routes require an AGENT principal
    if (path.startsWith('/api/v1/agents/')) {
      // /agents/me and /agents/me/* are strictly AGENT SELF via agentAccess
      // No arbitrary agentId param is trusted; identity comes from session.
      //
      // V1-SPRINT2-AUTHZ-01 (ARENA 3): routes that DO address a specific Agent by path
      // parameter (today: GET /api/v1/agents/:id/receiving-number) must bind the SELF
      // policy to the *requested* Agent id, not to the caller's own id. Previously no
      // branch ever extracted an agentId, so RuntimeAccessGuard evaluated SELF against
      // `principal.agentId` — a comparison of the caller with itself that trivially
      // passed, letting any authenticated Agent read any other Agent's receiving number
      // (docs/V1/A21-AGENT-APP-CONTRACT.md:42-43 requires 403/404 when :id differs from
      // principal.agentId). Extracting `params.id` makes checkAgentScope compare the
      // session Agent against the resource Agent and deny cross-Agent reads.
      //
      // Extraction is deliberately restricted to non-`me` paths: under the literal
      // /agents/me/* subtree an `:id` parameter is NEVER an Agent id — e.g.
      // /agents/me/support/tickets/:id carries a TICKET id (support-agent.controller),
      // and binding it as the resource Agent would deny the legitimate owner (observed
      // as 404→403 drift in v1-007-support-ticket before this guard was added). The only
      // other parameterized non-me surface, /agents/applications/:id, is handled by its
      // own explicit branch above and never reaches here.
      const addressesAgentById =
        !!input.params?.id && !path.startsWith('/api/v1/agents/me');
      return {
        public: false,
        resourceType: 'agent',
        ...(addressesAgentById ? { agentId: input.params!.id } : {}),
        policy: {
          resourceType: 'agent',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['AGENT'],
          customerAccess: 'NONE',
          agentAccess: 'SELF',
        },
      };
    }

    return {
      public: false,
      resourceType: 'internal-route',
      policy: {
        resourceType: 'internal-route',
        action: `${method}:${path}`,
        requiredScopes: ['internal:access'],
        allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      },
    };
  }

  isPublic(method: string, url: string): boolean {
    return this.resolve({ method, url }).public;
  }
}
