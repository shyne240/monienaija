import { Injectable } from '@nestjs/common';

import type { AuthorizationPolicy } from './authorization.types';

export type RouteAuthenticationMode =
  | 'PRINCIPAL'
  | 'WORKFORCE_ASSERTION'
  | 'WORKFORCE_SESSION'
  | 'PROVIDER_CALLBACK';

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
}

const PUBLIC_ROUTES = new Set([
  'GET /api/v1/health',
  'GET /api/v1/health/ready',
  // Customer registration is anonymous by design and is matched exactly: no other route in the
  // `/customers` collection (for example `GET /api/v1/customers`) is public.
  'POST /api/v1/customers',
]);

/**
 * Customer credential exchange. Matched with an exact route shape so that no other
 * `/customers/:id/*` route is affected. The handler is responsible for credential verification,
 * generic failure responses and account lockout.
 */
const CUSTOMER_AUTHENTICATION_ROUTE =
  /^\/api\/v1\/customers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/authenticate$/i;

/**
 * Operational routes (readiness, migration head, diagnostics, version). They stay behind the
 * existing `internal:access` scope and are reachable only by an authenticated workforce session;
 * they are never public and never customer-reachable.
 */
const OPERATIONAL_ROUTES = new Set([
  'GET /api/v1/internal/version',
  'GET /api/v1/internal/readiness',
  'GET /api/v1/internal/deployment',
  'GET /api/v1/internal/configuration',
  'GET /api/v1/internal/diagnostics',
  'GET /api/v1/internal/metrics',
  'GET /api/v1/internal/audit',
  'GET /api/v1/internal/outbox',
]);

const CUSTOMER_REACHABLE_PRINCIPALS = [
  'CUSTOMER',
  'SUPPORT',
  'OPERATOR',
  'SERVICE',
  'PRIVILEGED',
] as const;

const OPERATIONAL_PRINCIPALS = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'] as const;

const INTERNAL_ACCESS_SCOPE = ['internal:access'] as const;

/**
 * Customer self-service money-movement and wallet routes.
 *
 * These paths carry resource ids (deposit/withdrawal/transfer/wallet ids), never the customer id,
 * so the guard's `customerAccess: 'SELF'` check has no resource customer id to compare against on
 * the collection routes. Ownership for a CUSTOMER principal is therefore enforced in the controller
 * and in the service/domain layer (`WalletOwnershipBinding`): the customer id used for the
 * operation always comes from the authenticated session, and every wallet referenced by the
 * request must belong to that customer. `internalScopes` keeps the pre-existing internal gate for
 * workforce/service principals, so exposing these routes to customers does not widen internal
 * access. Settlement/completion transitions (`:id/complete`, `:id/fail`, `:id/cancel`,
 * `:id/process`) are deliberately absent and remain internal-only.
 */
const CUSTOMER_SELF_SERVICE_ROUTES: ReadonlyArray<{
  method: string;
  pattern: RegExp;
  resourceType: string;
}> = [
  { method: 'POST', pattern: /^\/api\/v1\/deposits$/, resourceType: 'deposit' },
  { method: 'GET', pattern: /^\/api\/v1\/deposits$/, resourceType: 'deposit' },
  { method: 'GET', pattern: /^\/api\/v1\/deposits\/[^/]+$/, resourceType: 'deposit' },
  { method: 'POST', pattern: /^\/api\/v1\/withdrawals$/, resourceType: 'withdrawal' },
  { method: 'GET', pattern: /^\/api\/v1\/withdrawals$/, resourceType: 'withdrawal' },
  { method: 'GET', pattern: /^\/api\/v1\/withdrawals\/[^/]+$/, resourceType: 'withdrawal' },
  { method: 'POST', pattern: /^\/api\/v1\/transfers$/, resourceType: 'transfer' },
  { method: 'GET', pattern: /^\/api\/v1\/transfers\/[^/]+$/, resourceType: 'transfer' },
  { method: 'GET', pattern: /^\/api\/v1\/wallets$/, resourceType: 'wallet' },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[^/]+$/, resourceType: 'wallet' },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[^/]+\/balance$/, resourceType: 'wallet' },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[^/]+\/transactions$/, resourceType: 'wallet' },
];

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

    if (method === 'POST' && CUSTOMER_AUTHENTICATION_ROUTE.test(path)) {
      return { public: true, resourceType: 'customer-authentication' };
    }

    if (OPERATIONAL_ROUTES.has(`${method} ${path}`)) {
      return {
        public: false,
        // Operational routes are workforce-session routes. They must not be resolved through the
        // customer session service: a customer bearer token can never satisfy `internal:access`,
        // and a genuine workforce session must be able to. Only these read-only operational GETs
        // are promoted; every other internal route keeps the fail-closed default policy below.
        authenticationMode: 'WORKFORCE_SESSION',
        resourceType: 'operational-route',
        policy: {
          resourceType: 'operational-route',
          action: `${method}:${path}`,
          requiredScopes: [...INTERNAL_ACCESS_SCOPE],
          allowedPrincipalTypes: [...OPERATIONAL_PRINCIPALS],
          customerAccess: 'NONE',
        },
      };
    }

    const selfServiceRoute = CUSTOMER_SELF_SERVICE_ROUTES.find(
      (route) => route.method === method && route.pattern.test(path),
    );
    if (selfServiceRoute) {
      return {
        public: false,
        resourceType: selfServiceRoute.resourceType,
        resourceId: input.params?.id,
        customerId: input.params?.id,
        policy: {
          resourceType: selfServiceRoute.resourceType,
          action: `${method}:${path}`,
          allowedPrincipalTypes: [...CUSTOMER_REACHABLE_PRINCIPALS],
          internalScopes: [...INTERNAL_ACCESS_SCOPE],
          customerAccess: 'SELF',
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

    return {
      public: false,
      resourceType: 'internal-route',
      policy: {
        resourceType: 'internal-route',
        action: `${method}:${path}`,
        requiredScopes: ['internal:access'],
        allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
        customerAccess: 'NONE',
      },
    };
  }

  isPublic(method: string, url: string): boolean {
    return this.resolve({ method, url }).public;
  }
}
