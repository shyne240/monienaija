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
    if (path === '/api/v1/customers' || path.startsWith('/api/v1/customers/')) {
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

    // Ledger operations - operation-specific scopes
    if (path.startsWith('/api/v1/ledger/')) {
      if (path === '/api/v1/ledger/accounts' && method === 'GET') {
        return {
          public: false,
          resourceType: 'ledger',
          policy: {
            resourceType: 'ledger',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['ledger:read'],
            customerAccess: 'NONE',
          },
        };
      }
      if (path === '/api/v1/ledger/accounts' && method === 'POST') {
        return {
          public: false,
          resourceType: 'ledger',
          policy: {
            resourceType: 'ledger',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['ledger:write'],
            customerAccess: 'NONE',
          },
        };
      }
      if (path.match(/^\/api\/v1\/ledger\/accounts\/[^/]+(\/balance)?$/) && method === 'GET') {
        return {
          public: false,
          resourceType: 'ledger',
          policy: {
            resourceType: 'ledger',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['ledger:read'],
            customerAccess: 'NONE',
          },
        };
      }
      if (path.match(/^\/api\/v1\/ledger\/journals\/[^/]+\/reversal$/) && method === 'POST') {
        return {
          public: false,
          resourceType: 'ledger',
          policy: {
            resourceType: 'ledger',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['ledger:reverse'],
            customerAccess: 'NONE',
          },
        };
      }
      if (path.match(/^\/api\/v1\/ledger\/journals(\/[^/]+)?$/) && method === 'GET') {
        return {
          public: false,
          resourceType: 'ledger',
          policy: {
            resourceType: 'ledger',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['ledger:read'],
            customerAccess: 'NONE',
          },
        };
      }
      if (path === '/api/v1/ledger/journals' && method === 'POST') {
        return {
          public: false,
          resourceType: 'ledger',
          policy: {
            resourceType: 'ledger',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['ledger:write'],
            customerAccess: 'NONE',
          },
        };
      }
    }

    // Deposit operations
    if (path.startsWith('/api/v1/deposits/')) {
      if (path.match(/^\/api\/v1\/deposits\/[^/]+\/complete$/) && method === 'POST') {
        return {
          public: false,
          resourceType: 'deposit',
          policy: {
            resourceType: 'deposit',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['deposit:complete'],
            customerAccess: 'NONE',
          },
        };
      }
      if (path.match(/^\/api\/v1\/deposits\/[^/]+\/(fail|cancel)$/) && method === 'POST') {
        return {
          public: false,
          resourceType: 'deposit',
          policy: {
            resourceType: 'deposit',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['deposit:complete'],
            customerAccess: 'NONE',
          },
        };
      }
      if (path.match(/^\/api\/v1\/deposits\/[^/]+$/) && method === 'GET') {
        return {
          public: false,
          resourceType: 'deposit',
          policy: {
            resourceType: 'deposit',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['deposit:create'],
            customerAccess: 'NONE',
          },
        };
      }
    }
    if (path === '/api/v1/deposits') {
      return {
        public: false,
        resourceType: 'deposit',
        policy: {
          resourceType: 'deposit',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredScopes: method === 'POST' ? ['deposit:create'] : ['deposit:create'],
          customerAccess: 'NONE',
        },
      };
    }

    // Withdrawal operations
    if (path.startsWith('/api/v1/withdrawals/')) {
      if (path.match(/^\/api\/v1\/withdrawals\/[^/]+\/complete$/) && method === 'POST') {
        return {
          public: false,
          resourceType: 'withdrawal',
          policy: {
            resourceType: 'withdrawal',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['withdrawal:complete'],
            customerAccess: 'NONE',
          },
        };
      }
      if (path.match(/^\/api\/v1\/withdrawals\/[^/]+\/(fail|cancel)$/) && method === 'POST') {
        return {
          public: false,
          resourceType: 'withdrawal',
          policy: {
            resourceType: 'withdrawal',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['withdrawal:complete'],
            customerAccess: 'NONE',
          },
        };
      }
      if (path.match(/^\/api\/v1\/withdrawals\/[^/]+$/) && method === 'GET') {
        return {
          public: false,
          resourceType: 'withdrawal',
          policy: {
            resourceType: 'withdrawal',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['withdrawal:create'],
            customerAccess: 'NONE',
          },
        };
      }
    }
    if (path === '/api/v1/withdrawals') {
      return {
        public: false,
        resourceType: 'withdrawal',
        policy: {
          resourceType: 'withdrawal',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredScopes: method === 'POST' ? ['withdrawal:create'] : ['withdrawal:create'],
          customerAccess: 'NONE',
        },
      };
    }

    // Transfer operations
    if (path.startsWith('/api/v1/transfers/')) {
      if (path.match(/^\/api\/v1\/transfers\/[^/]+$/) && method === 'GET') {
        return {
          public: false,
          resourceType: 'transfer',
          policy: {
            resourceType: 'transfer',
            action: `${method}:${path}`,
            allowedPrincipalTypes: ['CUSTOMER', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
            requiredScopes: ['transfer:create'],
            customerAccess: 'SELF',
          },
        };
      }
    }
    if (path === '/api/v1/transfers' && method === 'POST') {
      return {
        public: false,
        resourceType: 'transfer',
        policy: {
          resourceType: 'transfer',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['CUSTOMER', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredScopes: ['transfer:create'],
          customerAccess: 'SELF',
        },
      };
    }

    // Reconciliation (read-only observability)
    if (path.startsWith('/api/v1/internal/reconciliation/')) {
      return {
        public: false,
        resourceType: 'reconciliation',
        policy: {
          resourceType: 'reconciliation',
          action: `${method}:${path}`,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredScopes: ['finance:audit'],
          customerAccess: 'NONE',
        },
      };
    }

    // Default internal route (fallback)
    return {
      public: false,
      resourceType: 'internal-route',
      policy: {
        resourceType: 'internal-route',
        action: `${method}:${path}`,
        allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
        customerAccess: 'NONE',
      },
    };
  }

  isPublic(method: string, url: string): boolean {
    return this.resolve({ method, url }).public;
  }
}
