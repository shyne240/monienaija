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
  'GET /api/v1/health',
  'GET /api/v1/health/ready',
  'GET /api/v1/internal/version',
  // V1-CUSTOMER-ONBOARDING-01 — customer registration front door (decided hybrid model,
  // docs/V1-CUSTOMER-ONBOARDING-DECISION-01.md). Unauthenticated by design: no session-
  // bearing auth mode exists pre-registration. Abuse is bounded inside the registration
  // service (per-phone/per-IP token buckets, OTP lockout/cooldown); the surface can only
  // create DRAFT customers + verified phone metadata — never ACTIVE/wallets/credentials.
  'POST /api/v1/customers/registration/otp',
  'POST /api/v1/customers/registration/otp/verify',
  'POST /api/v1/customers/registration',
]);

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
      return {
        public: false,
        resourceType: 'agent',
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
