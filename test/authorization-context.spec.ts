import {
  getAuthorizationContext,
  requireAuthorizationContext,
  requirePrincipal,
  runWithAuthorizationContext,
  runWithSystemContext,
  isSystemContext,
  clearAuthorizationContext,
} from '../src/authorization/authorization-context';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';

describe('Authorization Context', () => {
  afterEach(() => {
    clearAuthorizationContext();
  });

  describe('getAuthorizationContext', () => {
    it('returns undefined when no context is established', () => {
      const context = getAuthorizationContext();
      expect(context).toBeUndefined();
    });

    it('returns context when established', () => {
      const principal: AuthorizationPrincipal = {
        type: 'PRIVILEGED',
        principalId: 'test-principal',
        roles: ['FINANCE_ADMIN'],
        scopes: ['ledger:write'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      };

      runWithAuthorizationContext({ principal, source: 'http-request' }, () => {
        const context = getAuthorizationContext();
        expect(context).toBeDefined();
        expect(context?.principal).toEqual(principal);
        expect(context?.source).toBe('http-request');
      });
    });
  });

  describe('requireAuthorizationContext', () => {
    it('throws when no context is established', () => {
      expect(() => requireAuthorizationContext()).toThrow(
        'Authorization context is required for this operation',
      );
    });

    it('returns context when established', () => {
      const principal: AuthorizationPrincipal = {
        type: 'PRIVILEGED',
        principalId: 'test-principal',
        roles: ['FINANCE_ADMIN'],
        scopes: ['ledger:write'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      };

      runWithAuthorizationContext({ principal, source: 'http-request' }, () => {
        const context = requireAuthorizationContext();
        expect(context.principal).toEqual(principal);
      });
    });
  });

  describe('requirePrincipal', () => {
    it('throws when no context is established', () => {
      expect(() => requirePrincipal()).toThrow(
        'Authorization context is required for this operation',
      );
    });

    it('returns principal when context is established', () => {
      const principal: AuthorizationPrincipal = {
        type: 'PRIVILEGED',
        principalId: 'test-principal',
        roles: ['FINANCE_ADMIN'],
        scopes: ['ledger:write'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      };

      runWithAuthorizationContext({ principal, source: 'http-request' }, () => {
        const result = requirePrincipal();
        expect(result).toEqual(principal);
      });
    });
  });

  describe('runWithSystemContext', () => {
    it('establishes system context with reason', () => {
      const principal: AuthorizationPrincipal = {
        type: 'SERVICE',
        principalId: 'system:internal-service',
        roles: [],
        scopes: ['internal:service-call'],
        customerAccess: 'NONE',
        assuranceLevel: 'PASSWORD',
      };

      runWithSystemContext('test:internal-call', () => {
        const context = requireAuthorizationContext();
        expect(context.principal).toEqual(principal);
        expect(context.source).toBe('system');
        expect(context.reason).toBe('test:internal-call');
      }, principal);
    });

    it('isSystemContext returns true for system context', () => {
      const principal: AuthorizationPrincipal = {
        type: 'SERVICE',
        principalId: 'system:internal-service',
        roles: [],
        scopes: ['internal:service-call'],
        customerAccess: 'NONE',
        assuranceLevel: 'PASSWORD',
      };

      runWithSystemContext('test:internal-call', () => {
        expect(isSystemContext()).toBe(true);
      }, principal);
    });

    it('isSystemContext returns false for http-request context', () => {
      const principal: AuthorizationPrincipal = {
        type: 'PRIVILEGED',
        principalId: 'test-principal',
        roles: ['FINANCE_ADMIN'],
        scopes: ['ledger:write'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      };

      runWithAuthorizationContext({ principal, source: 'http-request' }, () => {
        expect(isSystemContext()).toBe(false);
      });
    });
  });

  describe('context isolation', () => {
    it('context does not leak outside runWithAuthorizationContext', () => {
      const principal: AuthorizationPrincipal = {
        type: 'PRIVILEGED',
        principalId: 'test-principal',
        roles: ['FINANCE_ADMIN'],
        scopes: ['ledger:write'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      };

      runWithAuthorizationContext({ principal, source: 'http-request' }, () => {
        expect(getAuthorizationContext()).toBeDefined();
      });

      expect(getAuthorizationContext()).toBeUndefined();
    });

    it('nested contexts are isolated', () => {
      const principal1: AuthorizationPrincipal = {
        type: 'PRIVILEGED',
        principalId: 'principal-1',
        roles: ['FINANCE_ADMIN'],
        scopes: ['ledger:write'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      };

      const principal2: AuthorizationPrincipal = {
        type: 'PRIVILEGED',
        principalId: 'principal-2',
        roles: ['FINANCE_PREPARER'],
        scopes: ['finance:prepare'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      };

      runWithAuthorizationContext({ principal: principal1, source: 'http-request' }, () => {
        expect(requirePrincipal().principalId).toBe('principal-1');

        runWithAuthorizationContext({ principal: principal2, source: 'http-request' }, () => {
          expect(requirePrincipal().principalId).toBe('principal-2');
        });

        expect(requirePrincipal().principalId).toBe('principal-1');
      });
    });
  });

  describe('async context propagation', () => {
    it('context propagates through async operations', async () => {
      const principal: AuthorizationPrincipal = {
        type: 'PRIVILEGED',
        principalId: 'test-principal',
        roles: ['FINANCE_ADMIN'],
        scopes: ['ledger:write'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      };

      await runWithAuthorizationContext({ principal, source: 'http-request' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(requirePrincipal().principalId).toBe('test-principal');
      });
    });

    it('context propagates through Promise chains', async () => {
      const principal: AuthorizationPrincipal = {
        type: 'PRIVILEGED',
        principalId: 'test-principal',
        roles: ['FINANCE_ADMIN'],
        scopes: ['ledger:write'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      };

      await runWithAuthorizationContext({ principal, source: 'http-request' }, () => {
        return Promise.resolve()
          .then(() => {
            expect(requirePrincipal().principalId).toBe('test-principal');
          })
          .then(() => {
            expect(requirePrincipal().principalId).toBe('test-principal');
          });
      });
    });
  });
});
