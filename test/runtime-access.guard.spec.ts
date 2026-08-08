import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationService } from '../src/authorization/authorization.service';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { RuntimeAccessGuard } from '../src/authorization/runtime-access.guard';
import type { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';

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
  it('allows only the explicit health/version public route allowlist', () => {
    const registry = new RoutePolicyRegistry();
    expect(registry.isPublic('GET', '/api/v1/health')).toBe(true);
    expect(registry.isPublic('GET', '/api/v1/health/ready')).toBe(true);
    expect(registry.isPublic('GET', '/api/v1/internal/version')).toBe(true);
    expect(registry.isPublic('GET', '/api/v1/customers/1')).toBe(false);
    expect(registry.isPublic('GET', '/api/v1/internal/diagnostics')).toBe(false);
    expect(registry.isPublic('POST', '/api/v1/internal/partner-callbacks/nibss-nip')).toBe(false);
    expect(
      registry.resolve({
        method: 'POST',
        url: '/api/v1/internal/partner-callbacks/nibss-nip',
      }).authenticationMode,
    ).toBe('PROVIDER_CALLBACK');
  });
});

describe('RuntimeAccessGuard', () => {
  function fixture() {
    const sessionService = { validate: jest.fn() };
    const authorizationService = { authorize: jest.fn() };
    const guard = new RuntimeAccessGuard(
      sessionService as unknown as AuthenticationSessionService,
      authorizationService as unknown as AuthorizationService,
      new RoutePolicyRegistry(),
    );
    return { guard, sessionService, authorizationService };
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
