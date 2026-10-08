/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';

/**
 * V1-CUSTOMER-09 Part C — workforce permission-boundary regression.
 *
 * `/internal/support/tickets` (and every other `/internal/*` route) treats
 * SUPPORT, OPERATOR, SERVICE and PRIVILEGED as equally-trusted "workforce"
 * principal types (see route-policy-registry.ts and
 * support-internal.controller.ts's requireWorkforce()). This test proves,
 * directly against the real `A2WorkforceSessionService`, what principal
 * `type` a genuine workforce session actually resolves to for every finance
 * role configuration the service can be given.
 *
 * Finding: `A2WorkforceSessionService.principal()` only ever returns
 * `'PRIVILEGED'` (when the session's active roles include SUPER_ADMIN) or
 * `'OPERATOR'` (every other case). No role configuration, and no other
 * production code path in this codebase, ever constructs a principal with
 * `type: 'SUPPORT'` or `type: 'SERVICE'`. This is not a security hole — the
 * route policy already grants OPERATOR/PRIVILEGED the same access — but it
 * means a dedicated least-privilege "Support" workforce identity does not
 * exist yet. Guarding against a regression here (e.g. someone wiring a role
 * called "SUPPORT_AGENT" straight through) is the point of this test: it
 * must keep failing loudly if the mapping ever silently starts producing an
 * unexpected type instead of the two documented values.
 */
describe('A2WorkforceSessionService — resolved principal type (Part C boundary audit)', () => {
  function buildConfig(roles: A2WorkforceConfigurationV1['roles']): A2WorkforceConfigurationV1 {
    return {
      enabled: true,
      environment: 'test',
      oidcIssuer: 'https://issuer.test',
      oidcJwksUri: 'https://issuer.test/jwks',
      oidcAudience: 'workforce',
      oidcClientId: 'client',
      internalAudience: 'workforce-admin',
      sessionTtlSeconds: 900,
      mfaFreshnessSeconds: 300,
      oidcJwksCacheSeconds: 900,
      oidcJwksMaxStalenessSeconds: 3600,
      bootstrapEnabled: false,
      bootstrapIssuer: '',
      bootstrapAudience: '',
      bootstrapKeys: [],
      bootstrapFinanceAdminScopes: [],
      roles,
      makerCheckerRules: [],
      rateLimits: [],
      trustedProxyAddresses: [],
    } as unknown as A2WorkforceConfigurationV1;
  }

  function role(roleKey: string, scopes: string[] = []): any {
    return {
      roleKey,
      displayName: roleKey,
      description: roleKey,
      enabled: true,
      scopes,
      applicableActions: [],
      mfaRequired: true,
      approvalCapability: false,
      makerEligible: false,
      checkerEligible: false,
      administrativeCapability: roleKey === 'SUPER_ADMIN',
    };
  }

  function buildService(
    config: A2WorkforceConfigurationV1,
    opts: { sessionRow: any; assignments: any[] },
  ): A2WorkforceSessionService {
    const sessionRepo = {
      findOne: jest.fn().mockResolvedValue(opts.sessionRow),
      save: jest.fn().mockImplementation(async (row: any) => row),
    };
    const assignmentRepo = {
      find: jest.fn().mockResolvedValue(opts.assignments),
    };
    const dataSource = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        // A2WorkforceSession vs A2FinanceRoleAssignment are distinguished by name.
        if (entity?.name === 'A2FinanceRoleAssignment') return assignmentRepo;
        return sessionRepo;
      }),
    } as any;
    const audit = { record: jest.fn() } as any;
    // V1-ADMIN-AUTHORIZATION-RUNTIME-01: duck-typed fake — these tests exercise the LEGACY
    // config-driven role/type resolution path specifically, so the catalogue is made to
    // recognize nothing (empty resolution), which falls back entirely to the legacy
    // `administrativeCapability` flag on `config.roles` — preserving this file's original
    // PRIVILEGED-iff-SUPER_ADMIN assertions unchanged.
    const catalogue = {
      resolveForRoleKeys: jest.fn().mockResolvedValue({
        recognizedRoleKeys: [],
        functionCodes: [],
        hasAdministrativeCapability: false,
        allRecognizedRolesReadOnly: false,
      }),
    } as any;
    return new A2WorkforceSessionService(dataSource, audit, catalogue, config);
  }

  function activeSessionRow(principalId: string): any {
    const now = new Date();
    return {
      id: 'session-1',
      principalId,
      tokenHash: 'irrelevant-because-findOne-is-mocked',
      audience: 'workforce-admin',
      status: 'ACTIVE',
      expiresAt: new Date(now.getTime() + 60_000),
      assuranceLevel: 'MFA',
      roles: [],
      scopes: [],
      lastSeenAt: now,
    };
  }

  it('resolves to OPERATOR when the principal holds no SUPER_ADMIN assignment', async () => {
    const config = buildConfig([
      role('SUPER_ADMIN'),
      role('FINANCE_PREPARER'),
      role('FINANCE_CONTROLLER'),
      role('FINANCE_AUDITOR'),
    ]);
    const service = buildService(config, {
      sessionRow: activeSessionRow('workforce-user-1'),
      assignments: [], // no active finance role assignment at all
    });
    const principal = await service.validate('any-token', 'workforce-admin');
    expect(principal.type).toBe('OPERATOR');
    expect(principal.type).not.toBe('SUPPORT');
    expect(principal.type).not.toBe('SERVICE');
  });

  it('resolves to OPERATOR for a non-admin active role (e.g. FINANCE_AUDITOR)', async () => {
    const config = buildConfig([role('SUPER_ADMIN'), role('FINANCE_AUDITOR')]);
    const now = new Date();
    const service = buildService(config, {
      sessionRow: activeSessionRow('workforce-user-2'),
      assignments: [
        {
          roleKey: 'FINANCE_AUDITOR',
          status: 'ACTIVE',
          effectiveFrom: new Date(now.getTime() - 1000),
          effectiveTo: new Date(now.getTime() + 100_000),
        },
      ],
    });
    const principal = await service.validate('any-token', 'workforce-admin');
    expect(principal.type).toBe('OPERATOR');
  });

  it('resolves to PRIVILEGED only when the active roles include SUPER_ADMIN', async () => {
    const config = buildConfig([role('SUPER_ADMIN')]);
    const now = new Date();
    const service = buildService(config, {
      sessionRow: activeSessionRow('workforce-user-3'),
      assignments: [
        {
          roleKey: 'SUPER_ADMIN',
          status: 'ACTIVE',
          effectiveFrom: new Date(now.getTime() - 1000),
          effectiveTo: new Date(now.getTime() + 100_000),
        },
      ],
    });
    const principal = await service.validate('any-token', 'workforce-admin');
    expect(principal.type).toBe('PRIVILEGED');
  });

  it('never resolves to SUPPORT or SERVICE for any role configuration — no production code path issues those types today', async () => {
    const roleKeys = ['SUPER_ADMIN', 'FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'FINANCE_AUDITOR'];
    const config = buildConfig(roleKeys.map((k) => role(k)));
    const now = new Date();
    for (const roleKey of roleKeys) {
      const service = buildService(config, {
        sessionRow: activeSessionRow(`workforce-user-${roleKey}`),
        assignments: [
          {
            roleKey,
            status: 'ACTIVE',
            effectiveFrom: new Date(now.getTime() - 1000),
            effectiveTo: new Date(now.getTime() + 100_000),
          },
        ],
      });
      const principal = await service.validate('any-token', 'workforce-admin');
      expect(['OPERATOR', 'PRIVILEGED']).toContain(principal.type);
    }
  });
});
