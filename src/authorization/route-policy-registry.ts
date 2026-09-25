import { Injectable } from '@nestjs/common';

import type { AuthorizationPolicy } from './authorization.types';

export type RouteAuthenticationMode =
  | 'PRINCIPAL'
  | 'WORKFORCE_ASSERTION'
  | 'WORKFORCE_SESSION'
  | 'PROVIDER_CALLBACK'
  | 'AGENT_LOGIN';

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

    // Recipient resolution — A9: typed CUSTOMER vs AGENT resolution by receiving number / phone
    // Preserve Customer phone + MonieNaija resolution; block PENDING/rejected/deleted/terminated at service layer.
    if (path.startsWith('/api/v1/recipients/')) {
      return {
        public: false,
        resourceType: 'recipient-resolution',
        policy: {
          resourceType: 'recipient-resolution',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['CUSTOMER', 'AGENT', 'SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
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
      (method === 'POST' &&
        /^\/api\/v1\/internal\/agents\/[^/]+\/(fund|defund)$/.test(path)) ||
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
