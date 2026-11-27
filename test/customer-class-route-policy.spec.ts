import {
  AUTHORIZATION_FUNCTION_SEED,
  AUTHORIZATION_ROLE_FUNCTION_SEED,
} from '../src/authorization-catalogue/authorization-catalogue.seed';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';

describe('customer class route authorization', () => {
  it.each([
    ['GET', '/api/v1/internal/customer-classes', 'customer.view'],
    ['GET', '/api/v1/internal/customer-classes/123', 'customer.view'],
    ['GET', '/api/v1/internal/customer-classes/tier-defaults', 'customer.view'],
    ['POST', '/api/v1/internal/customer-classes', 'customer.manage_classes'],
    ['PATCH', '/api/v1/internal/customer-classes/123', 'customer.manage_classes'],
    [
      'POST',
      '/api/v1/internal/customer-classes/tier-defaults/proposals',
      'customer.manage_classes',
    ],
    [
      'POST',
      '/api/v1/internal/customer-classes/tier-defaults/proposals/00000000-0000-4000-8000-000000000001/execute',
      'customer.manage_classes',
    ],
    ['GET', '/api/v1/internal/customers/123/class', 'customer.view'],
    ['GET', '/api/v1/internal/customers/123/class/history', 'customer.view'],
    ['POST', '/api/v1/internal/customers/123/class', 'customer.manage_classes'],
  ])('%s %s requires %s and audits denied workforce function checks', (method, url, permission) => {
    const result = new RoutePolicyRegistry().resolve({ method, url });
    expect(result.authenticationMode).toBe('WORKFORCE_SESSION');
    expect(result.auditDeniedWorkforceFunction).toBe(true);
    expect(result.policy?.requiredFunctions).toEqual([permission]);
    expect(result.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
    if (method !== 'GET') expect(result.policy?.allowedPrincipalTypes).not.toContain('SUPPORT');
  });

  it('grants customer.manage_classes only to coherent roles that already hold customer.view', () => {
    expect(
      AUTHORIZATION_FUNCTION_SEED.find((fn) => fn.functionCode === 'customer.manage_classes'),
    ).toBeDefined();
    const managers = AUTHORIZATION_ROLE_FUNCTION_SEED.filter(
      (grant) => grant.functionCode === 'customer.manage_classes',
    )
      .map((grant) => grant.roleKey)
      .sort();
    expect(managers).toEqual(['CUSTOMER_SERVICE', 'SUPER_ADMIN']);
    const viewers = new Set(
      AUTHORIZATION_ROLE_FUNCTION_SEED.filter(
        (grant) => grant.functionCode === 'customer.view',
      ).map((grant) => grant.roleKey),
    );
    for (const roleKey of managers) {
      expect(viewers.has(roleKey)).toBe(true);
    }
    expect(managers).not.toContain('AGENT_NETWORK_MANAGER');
    expect(managers).not.toContain('FINANCE_AUDITOR');
  });
});
