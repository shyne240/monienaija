import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';

describe('customer class route authorization', () => {
  it.each([
    ['GET', '/api/v1/internal/customer-classes', 'customer.view'],
    ['GET', '/api/v1/internal/customer-classes/123', 'customer.view'],
    ['POST', '/api/v1/internal/customer-classes', 'customer.manage_classes'],
    ['PATCH', '/api/v1/internal/customer-classes/123', 'customer.manage_classes'],
    ['GET', '/api/v1/internal/customers/123/class', 'customer.view'],
    ['GET', '/api/v1/internal/customers/123/class/history', 'customer.view'],
    ['POST', '/api/v1/internal/customers/123/class', 'customer.manage_classes'],
  ])('%s %s requires %s', (method, url, permission) => {
    const result = new RoutePolicyRegistry().resolve({ method, url });
    expect(result.authenticationMode).toBe('WORKFORCE_SESSION');
    expect(result.policy?.requiredFunctions).toEqual([permission]);
    expect(result.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
    if (method !== 'GET') expect(result.policy?.allowedPrincipalTypes).not.toContain('SUPPORT');
  });
});
