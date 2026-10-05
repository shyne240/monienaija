import { Injectable } from '@nestjs/common';

import type { AuthorizationPolicy } from './authorization.types';

export type RouteAuthenticationMode =
  | 'PRINCIPAL'
  | 'WORKFORCE_ASSERTION'
  | 'WORKFORCE_SESSION'
  | 'PROVIDER_CALLBACK'
  | 'AGENT_LOGIN'
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
          allowedPrincipalTypes: ['CUSTOMER', 'SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
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

    // Agent application — applicant surface (A8). Applicants are not yet Agents, so these
    // are unauthenticated (AGENT_LOGIN) and do not require a bearer token. Ownership is
    // enforced via applicantReference, not via agentId param.
    if (path === '/api/v1/agents/applications' || path.startsWith('/api/v1/agents/applications/')) {
      return {
        public: false,
        authenticationMode: 'AGENT_LOGIN',
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
          allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
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
          allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
      };
    }

    // Aggregator self routes (if later authentication is introduced) would be handled here.
    // A18 does not expose aggregator login; foundation only. See AggregatorService docs.

    // Agent funding — internal privileged (A19). Source is platform pool, destination is Agent wallet.
    // No Aggregator ledger account in V1; Aggregator involvement is relationship authorization only.
    // Inactive/terminated/suspended checks are enforced in service layer.
    if (
      (method === 'POST' && /^\/api\/v1\/internal\/agents\/[^/]+\/(fund|defund)$/.test(path)) ||
      (method === 'POST' &&
        /^\/api\/v1\/internal\/aggregators\/[^/]+\/agents\/[^/]+\/(fund|defund)$/.test(path))
    ) {
      return {
        public: false,
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'agent-funding',
        policy: {
          resourceType: 'agent-funding',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
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
          allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
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
          allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
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
