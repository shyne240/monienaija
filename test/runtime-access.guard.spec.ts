import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationService } from '../src/authorization/authorization.service';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { RuntimeAccessGuard } from '../src/authorization/runtime-access.guard';
import type { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import type { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';

function context(request: Record<string, unknown>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe('RoutePolicyRegistry', () => {
  it('allows only the explicit health, registration and credential-exchange public routes', () => {
    const registry = new RoutePolicyRegistry();
    expect(registry.isPublic('GET', '/api/v1/health')).toBe(true);
    expect(registry.isPublic('GET', '/api/v1/health/ready')).toBe(true);
    expect(registry.isPublic('POST', '/api/v1/customers')).toBe(true);
    expect(registry.isPublic('POST', `/api/v1/customers/${CUSTOMER_ID}/authenticate`)).toBe(true);

    // Operational routes are never public.
    expect(registry.isPublic('GET', '/api/v1/internal/version')).toBe(false);
    expect(registry.isPublic('GET', '/api/v1/internal/diagnostics')).toBe(false);
    expect(registry.isPublic('GET', '/api/v1/internal/readiness')).toBe(false);
    expect(registry.isPublic('GET', '/api/v1/customers/1')).toBe(false);
    expect(registry.isPublic('GET', '/api/v1/customers')).toBe(false);
    expect(registry.isPublic('POST', '/api/v1/internal/partner-callbacks/nibss-nip')).toBe(false);
    expect(
      registry.resolve({
        method: 'POST',
        url: '/api/v1/internal/partner-callbacks/nibss-nip',
      }).authenticationMode,
    ).toBe('PROVIDER_CALLBACK');
  });

  it('does not broaden the public credential exchange to other customer routes', () => {
    const registry = new RoutePolicyRegistry();
    expect(registry.isPublic('GET', `/api/v1/customers/${CUSTOMER_ID}/authenticate`)).toBe(false);
    expect(registry.isPublic('POST', '/api/v1/customers/1/authenticate')).toBe(false);
    expect(registry.isPublic('POST', `/api/v1/customers/${CUSTOMER_ID}/sessions/rotate`)).toBe(
      false,
    );
    expect(registry.isPublic('POST', `/api/v1/customers/${CUSTOMER_ID}/mfa-enrollments`)).toBe(
      false,
    );
  });

  it('keeps operational routes behind internal:access for workforce principals only', () => {
    const registry = new RoutePolicyRegistry();
    for (const path of [
      '/api/v1/internal/version',
      '/api/v1/internal/readiness',
      '/api/v1/internal/deployment',
      '/api/v1/internal/configuration',
      '/api/v1/internal/diagnostics',
      '/api/v1/internal/metrics',
      '/api/v1/internal/audit',
      '/api/v1/internal/outbox',
    ]) {
      const resolution = registry.resolve({ method: 'GET', url: path });
      expect(resolution.public).toBe(false);
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
      expect(resolution.policy?.customerAccess).toBe('NONE');
    }
  });

  it('exposes only money-movement self-service routes to customers and keeps internal scopes for workforce', () => {
    const registry = new RoutePolicyRegistry();

    const customerRoutes: Array<[string, string]> = [
      ['POST', '/api/v1/deposits'],
      ['GET', '/api/v1/deposits'],
      ['GET', `/api/v1/deposits/${CUSTOMER_ID}`],
      ['POST', '/api/v1/withdrawals'],
      ['GET', '/api/v1/withdrawals'],
      ['GET', `/api/v1/withdrawals/${CUSTOMER_ID}`],
      ['POST', '/api/v1/transfers'],
      ['GET', `/api/v1/transfers/${CUSTOMER_ID}`],
      ['GET', '/api/v1/wallets'],
      ['GET', `/api/v1/wallets/${CUSTOMER_ID}`],
      ['GET', `/api/v1/wallets/${CUSTOMER_ID}/balance`],
      ['GET', `/api/v1/wallets/${CUSTOMER_ID}/transactions`],
    ];
    for (const [method, url] of customerRoutes) {
      const resolution = registry.resolve({ method, url });
      expect(resolution.public).toBe(false);
      expect(resolution.policy?.allowedPrincipalTypes).toContain('CUSTOMER');
      // The pre-existing internal gate is unchanged for non-customer principals.
      expect(resolution.policy?.internalScopes).toEqual(['internal:access']);
      expect(resolution.policy?.requiredScopes).toBeUndefined();
    }

    // Settlement and state-transition routes stay internal-only.
    for (const [method, url] of [
      ['POST', `/api/v1/deposits/${CUSTOMER_ID}/complete`],
      ['POST', `/api/v1/deposits/${CUSTOMER_ID}/fail`],
      ['POST', `/api/v1/deposits/${CUSTOMER_ID}/cancel`],
      ['POST', `/api/v1/withdrawals/${CUSTOMER_ID}/process`],
      ['POST', `/api/v1/withdrawals/${CUSTOMER_ID}/complete`],
      ['POST', `/api/v1/withdrawals/${CUSTOMER_ID}/fail`],
      ['POST', `/api/v1/withdrawals/${CUSTOMER_ID}/cancel`],
      ['POST', '/api/v1/wallets'],
      ['GET', '/api/v1/ledger/accounts'],
    ] as Array<[string, string]>) {
      const resolution = registry.resolve({ method, url });
      expect(resolution.public).toBe(false);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
    }
  });
});

describe('RuntimeAccessGuard', () => {
  function fixture() {
    const sessionService = { validate: jest.fn() };
    const authorizationService = { authorize: jest.fn() };
    const workforceSessions = { validate: jest.fn() };
    const workforceConfig = {
      enabled: true,
      internalAudience: 'workforce-admin',
    } as A2WorkforceConfigurationV1;
    const guard = new RuntimeAccessGuard(
      sessionService as unknown as AuthenticationSessionService,
      authorizationService as unknown as AuthorizationService,
      new RoutePolicyRegistry(),
      workforceSessions as unknown as A2WorkforceSessionService,
      workforceConfig,
    );
    return { guard, sessionService, authorizationService, workforceSessions };
  }

  it('allows explicit public routes without a session', async () => {
    const testFixture = fixture();
    await expect(
      testFixture.guard.canActivate(
        context({ method: 'GET', url: '/api/v1/health', headers: {} }) as never,
      ),
    ).resolves.toBe(true);
    expect(testFixture.sessionService.validate).not.toHaveBeenCalled();
  });

  it('allows the non-public provider callback route to reach its signature boundary without a bearer token', async () => {
    const testFixture = fixture();
    await expect(
      testFixture.guard.canActivate(
        context({
          method: 'POST',
          url: '/api/v1/internal/partner-callbacks/nibss-nip',
          headers: {},
        }) as never,
      ),
    ).resolves.toBe(true);
    expect(testFixture.sessionService.validate).not.toHaveBeenCalled();
  });

  it('uses only the workforce session authority for internal workforce administration', async () => {
    const testFixture = fixture();
    testFixture.workforceSessions.validate.mockResolvedValue({
      type: 'PRIVILEGED',
      principalId: 'https://issuer.test:operator',
      sessionId: SESSION_ID,
      audience: 'workforce-admin',
      roles: ['FINANCE_ADMIN'],
      scopes: ['privileged:execute'],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    });
    const request: Record<string, unknown> = {
      method: 'POST',
      url: '/api/v1/internal/a2/workforce/bootstrap',
      headers: { authorization: 'Bearer workforce-token' },
    };
    await expect(testFixture.guard.canActivate(context(request) as never)).resolves.toBe(true);
    expect(testFixture.sessionService.validate).not.toHaveBeenCalled();
    expect(request.authorizationPrincipal).toMatchObject({ type: 'PRIVILEGED' });
  });

  it('rejects missing and malformed bearer credentials', async () => {
    const testFixture = fixture();
    await expect(
      testFixture.guard.canActivate(
        context({ method: 'GET', url: '/api/v1/customers/1', headers: {} }) as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      testFixture.guard.canActivate(
        context({
          method: 'GET',
          url: '/api/v1/customers/1',
          headers: { authorization: 'Basic token' },
          params: { id: CUSTOMER_ID },
        }) as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the customer principal and authorization decision to protected requests', async () => {
    const testFixture = fixture();
    testFixture.sessionService.validate.mockResolvedValue({
      valid: true,
      principal: {
        principalType: 'CUSTOMER',
        customerId: CUSTOMER_ID,
        credentialId: '00000000-0000-4000-8000-000000000003',
        sessionId: SESSION_ID,
        audience: 'customer-api',
        authenticatedAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      },
    });
    testFixture.authorizationService.authorize.mockResolvedValue({
      allowed: true,
      resourceType: 'customer',
      resourceId: CUSTOMER_ID,
      customerId: CUSTOMER_ID,
      action: 'GET:/api/v1/customers/:id',
    });
    const request: Record<string, unknown> = {
      method: 'GET',
      url: '/api/v1/customers/00000000-0000-4000-8000-000000000001',
      headers: { authorization: 'Bearer opaque-token' },
      params: { id: CUSTOMER_ID },
    };
    await expect(testFixture.guard.canActivate(context(request) as never)).resolves.toBe(true);
    expect(request.authorizationPrincipal).toMatchObject({
      type: 'CUSTOMER',
      customerId: CUSTOMER_ID,
      sessionId: SESSION_ID,
      customerAccess: 'SELF',
    });
    expect(request.authorizationDecision).toMatchObject({ allowed: true });
  });

  it('returns forbidden when authentication succeeds but authorization denies', async () => {
    const testFixture = fixture();
    testFixture.sessionService.validate.mockResolvedValue({
      valid: true,
      principal: {
        principalType: 'CUSTOMER',
        customerId: CUSTOMER_ID,
        credentialId: '00000000-0000-4000-8000-000000000003',
        sessionId: SESSION_ID,
        audience: 'customer-api',
        authenticatedAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      },
    });
    testFixture.authorizationService.authorize.mockResolvedValue({
      allowed: false,
      reason: 'CUSTOMER_SCOPE_MISMATCH',
      resourceType: 'customer',
      action: 'GET:/api/v1/customers/:id',
    });
    await expect(
      testFixture.guard.canActivate(
        context({
          method: 'GET',
          url: '/api/v1/customers/00000000-0000-4000-8000-000000000099',
          headers: { authorization: 'Bearer opaque-token' },
          params: { id: '00000000-0000-4000-8000-000000000099' },
        }) as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
