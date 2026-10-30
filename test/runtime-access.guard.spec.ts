import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import type { AuthorizationService } from '../src/authorization/authorization.service';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { RuntimeAccessGuard } from '../src/authorization/runtime-access.guard';
import type { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import type { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import type { SupportAuthenticationService } from '../src/support-authentication/support-authentication.service';

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
  it('allows only the explicit health, OTP-registration and credential-exchange public routes', () => {
    const registry = new RoutePolicyRegistry();
    expect(registry.isPublic('GET', '/api/v1/health')).toBe(true);
    expect(registry.isPublic('GET', '/api/v1/health/ready')).toBe(true);
    // Selected V1 API contract: the anonymous customer front door is the OTP registration
    // lifecycle, never the workforce customer-creation command.
    expect(registry.isPublic('POST', '/api/v1/customers/registration/otp')).toBe(true);
    expect(registry.isPublic('POST', '/api/v1/customers/registration/otp/verify')).toBe(true);
    expect(registry.isPublic('POST', '/api/v1/customers/registration')).toBe(true);
    expect(registry.isPublic('POST', '/api/v1/customers')).toBe(false);
    expect(registry.isPublic('POST', `/api/v1/customers/${CUSTOMER_ID}/authenticate`)).toBe(true);

    // Operational routes are never public, including the API version metadata
    // (REPORT-32 M-01: `/internal/version` used to sit in PUBLIC_ROUTES).
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

  it('requires explicit catalogue capabilities on every internal operational route', () => {
    const registry = new RoutePolicyRegistry();
    // REPORT-32 H-01 / M-01: a principal type is not an authorization decision. Each of these
    // routes must declare the catalogue function(s) that actually govern it, and must not admit
    // SUPPORT (whose approved V1 scope is read + funding-maker + support-queue only).
    const expectations: Array<[string, string[]]> = [
      ['/api/v1/internal/readiness', ['diagnostics.view', 'reconciliation.view']],
      ['/api/v1/internal/deployment', ['diagnostics.view', 'reconciliation.view']],
      ['/api/v1/internal/configuration', ['diagnostics.view']],
      ['/api/v1/internal/version', ['diagnostics.view']],
      ['/api/v1/internal/diagnostics', ['diagnostics.view']],
      ['/api/v1/internal/metrics', ['metrics.view']],
      ['/api/v1/internal/outbox', ['outbox.view']],
    ];
    for (const [path, requiredFunctions] of expectations) {
      const resolution = registry.resolve({ method: 'GET', url: path });
      expect(resolution.public).toBe(false);
      expect(resolution.authenticationMode).toBe('WORKFORCE_SESSION');
      expect(resolution.policy?.requiredFunctions).toEqual(requiredFunctions);
      expect(resolution.policy?.requiredScopes).toBeUndefined();
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('SUPPORT');
      expect(resolution.policy?.customerAccess).toBe('NONE');
    }

    // The generic audit listing keeps SUPPORT reach by explicit, documented product decision
    // (SUPPORT is a proven consumer and is not catalogue-governed). It is declared explicitly
    // rather than inherited from the un-gated catch-all, and it still denies non-workforce
    // principals.
    const audit = registry.resolve({ method: 'GET', url: '/api/v1/internal/audit' });
    expect(audit.public).toBe(false);
    expect(audit.authenticationMode).toBe('WORKFORCE_SESSION');
    expect(audit.resourceType).toBe('internal-audit-read');
    expect(audit.policy?.allowedPrincipalTypes).toEqual([
      'SUPPORT',
      'OPERATOR',
      'SERVICE',
      'PRIVILEGED',
    ]);
    expect(audit.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
    expect(audit.policy?.allowedPrincipalTypes).not.toContain('AGENT');
  });

  it('keeps customers on the selected self-service contract and off the generic financial commands', () => {
    const registry = new RoutePolicyRegistry();

    // Selected V1 contract: customers transact through /customers/me/*, which is CUSTOMER SELF.
    for (const [method, url] of [
      ['GET', '/api/v1/customers/me'],
      ['GET', '/api/v1/customers/me/wallets'],
      ['POST', '/api/v1/customers/me/transfers'],
    ] as Array<[string, string]>) {
      const resolution = registry.resolve({ method, url });
      expect(resolution.public).toBe(false);
      expect(resolution.policy?.allowedPrincipalTypes).toContain('CUSTOMER');
      expect(resolution.policy?.customerAccess).toBe('SELF');
    }

    // Generic financial commands and collections remain workforce-only: the integrated
    // controllers disable the generic customer command endpoints outright, so no registry entry
    // may widen reach to customer principals (that is what made main's design unsafe without
    // main's controllers).
    for (const [method, url] of [
      ['POST', '/api/v1/deposits'],
      ['GET', '/api/v1/deposits'],
      ['GET', `/api/v1/deposits/${CUSTOMER_ID}`],
      ['POST', '/api/v1/withdrawals'],
      ['GET', '/api/v1/withdrawals'],
      ['POST', '/api/v1/transfers'],
      ['GET', `/api/v1/transfers/${CUSTOMER_ID}`],
      ['GET', '/api/v1/wallets'],
      ['GET', `/api/v1/wallets/${CUSTOMER_ID}`],
      ['GET', `/api/v1/wallets/${CUSTOMER_ID}/balance`],
      ['GET', `/api/v1/wallets/${CUSTOMER_ID}/transactions`],
    ] as Array<[string, string]>) {
      const resolution = registry.resolve({ method, url });
      expect(resolution.public).toBe(false);
      expect(resolution.policy?.allowedPrincipalTypes).toContain('OPERATOR');
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
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
    }
  });
});

describe('RuntimeAccessGuard', () => {
  function fixture() {
    const sessionService = { validate: jest.fn() };
    const authorizationService = { authorize: jest.fn() };
    const workforceSessions = { validate: jest.fn() };
    const agentSessionService = { validate: jest.fn().mockResolvedValue({ valid: false, reason: 'NOT_FOUND' }) };
    const supportAuthenticationService = {
      validate: jest.fn().mockRejectedValue(new UnauthorizedException('Invalid support session')),
    };
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
      agentSessionService as unknown as import('../src/agent-authentication/agent-authentication-session.service').AgentAuthenticationSessionService,
      supportAuthenticationService as unknown as SupportAuthenticationService,
    );
    return {
      guard,
      sessionService,
      authorizationService,
      workforceSessions,
      agentSessionService,
      supportAuthenticationService,
    };
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
