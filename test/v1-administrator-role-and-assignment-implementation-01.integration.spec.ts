/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01 — dedicated real-PostgreSQL, real-HTTP
 * proof suite for the ADMINISTRATOR role and its delegated, structurally-restricted role
 * assignment authority (see docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01.md and its
 * -DECISIONS-01 companion).
 *
 * Nothing authorization-relevant is mocked: real bearer-token validation
 * (`A2WorkforceSessionService`), the real `RuntimeAccessGuard`/`RoutePolicyRegistry`, the real
 * `authorization_role_functions` catalogue, the real `AuthorizationService.requireFunction()`
 * checks, and the real `A2FinanceRoleAdministrationService` assign/revoke paths including the
 * new `ADMINISTRATOR_SCOPE` branch and its database CHECK constraints (migration
 * 1785753600085). SUPER_ADMIN sessions use the real local-admin login HTTP endpoint;
 * non-SUPER_ADMIN sessions are minted via a real, unmocked `A2WorkforceSessionService.establish()`
 * call after persisting a real `a2_finance_role_assignments` row — identical, established pattern
 * to test/v1-admin-authorization-hardening-01.integration.spec.ts.
 *
 * Covers all 12 categories required by the task:
 *   1. all 11 roles seeded, ADMINISTRATOR holds exactly its approved grants
 *   2. ADMINISTRATOR assigns/revokes each of the six operational roles for another user (HTTP)
 *   3. ADMINISTRATOR cannot assign/revoke its own role
 *   4. ADMINISTRATOR cannot grant SUPER_ADMIN/Finance roles via HTTP
 *   5. direct DB attempts to violate the structural (CHECK constraint) restriction fail
 *   6. only SUPER_ADMIN grants/revokes ADMINISTRATOR itself
 *   7. unauthenticated rejected (401), unauthorized denied (403)
 *   8. FINANCE_AUDITOR cannot gain admin write authority via principal type alone
 *   9. existing Finance assignment/privileged-approval maker/checker workflow still works
 *  10. audit records correctly identify actor/target for the new operational actions
 *  11. revocation takes effect on the very next authorization check (no caching)
 *  12. (verified by running the full existing suites alongside this file — see the task report)
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { AuditEvent } from '../src/operations/audit-event.entity';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';
const ROLES_PATH = '/api/v1/internal/a2/workforce/roles';
const OPERATIONAL_ROLES = [
  'OPERATIONS',
  'AGENT_NETWORK_MANAGER',
  'COMPLIANCE',
  'RISK_FRAUD',
  'CUSTOMER_SERVICE',
  'TREASURY',
] as const;

describe('V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01 — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1adminroleassign01');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    localAdminService = moduleRef.get(LocalAdminAuthenticationService);
    sessionService = moduleRef.get(A2WorkforceSessionService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  // ---------------------------------------------------------------- session helpers (identical
  // pattern to v1-admin-authorization-hardening-01.integration.spec.ts)

  async function loginSuperAdmin(): Promise<string> {
    await localAdminService.seedDefaultAdmin({
      email: 'admin@monienaija.local',
      password: 'MonieNaijaAdmin123!',
    });
    const login = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    if (login.status !== 201) {
      throw new Error(`SUPER_ADMIN login failed: ${login.status} ${JSON.stringify(login.body)}`);
    }
    return login.body.accessToken as string;
  }

  /** Direct, non-HTTP role provisioning for test setup — same pattern as hardening-01. */
  async function provisionRole(
    roleKey: string,
    principalSuffix = roleKey,
    principalId = `admroleassign01:${principalSuffix}:${randomUUID()}`.slice(0, 160),
  ): Promise<{ principalId: string; token: string }> {
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `v1-admin-role-assign-01:${principalId}:${roleKey}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      assignedBy: 'test-harness',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    } as any);
    const result = await sessionService.establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'test-harness-key',
    });
    return { principalId, token: result.accessToken };
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function assignViaHttp(
    token: string,
    targetPrincipalId: string,
    roleKey: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(ROLES_PATH)
      .set(auth(token))
      .send({
        targetPrincipalId,
        roleKey,
        effectiveFrom: new Date().toISOString(),
        effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
      });
  }

  async function revokeViaHttp(
    token: string,
    targetPrincipalId: string,
    roleKey: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .delete(`${ROLES_PATH}/${encodeURIComponent(targetPrincipalId)}/${encodeURIComponent(roleKey)}`)
      .set(auth(token))
      .send({
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        effectiveTo: new Date().toISOString(),
        approvalIds: [],
      });
  }

  // =====================================================================================
  // 1. All 11 roles seeded correctly; ADMINISTRATOR has exactly its approved grants
  // =====================================================================================

  describe('1. Seed correctness', () => {
    it('1a. all eleven approved roles exist as ACTIVE catalogue rows', async () => {
      const rows: Array<{ role_key: string }> = await dataSource.query(
        `SELECT role_key FROM authorization_roles WHERE is_active = true ORDER BY role_key`,
      );
      expect(rows.map((r) => r.role_key)).toEqual([
        'ADMINISTRATOR',
        'AGENT_NETWORK_MANAGER',
        'COMPLIANCE',
        'CUSTOMER_SERVICE',
        'FINANCE_AUDITOR',
        'FINANCE_CONTROLLER',
        'FINANCE_PREPARER',
        'OPERATIONS',
        'RISK_FRAUD',
        'SUPER_ADMIN',
        'TREASURY',
      ]);
    });

    it('1b. ADMINISTRATOR holds exactly its approved 9 function grants and nothing else', async () => {
      const rows: Array<{ function_code: string; access_type: string }> = await dataSource.query(`
        SELECT f.function_code, rf.access_type FROM authorization_role_functions rf
        JOIN authorization_roles r ON r.id = rf.role_id
        JOIN authorization_functions f ON f.function_code = rf.function_code
        WHERE r.role_key = 'ADMINISTRATOR'
        ORDER BY f.function_code
      `);
      expect(rows).toEqual(
        [
          { function_code: 'aggregator.view', access_type: 'VIEW' },
          { function_code: 'agent.view', access_type: 'VIEW' },
          { function_code: 'customer.view', access_type: 'VIEW' },
          { function_code: 'workforce.role.assign_operational', access_type: 'EXECUTE' },
          { function_code: 'workforce.role.revoke_operational', access_type: 'EXECUTE' },
          { function_code: 'workforce.role.view', access_type: 'VIEW' },
          { function_code: 'workforce.user.create', access_type: 'EXECUTE' },
          { function_code: 'workforce.user.suspend', access_type: 'EXECUTE' },
          { function_code: 'workforce.user.view', access_type: 'VIEW' },
        ].sort((a, b) => a.function_code.localeCompare(b.function_code)),
      );
    });

    it('1c. ADMINISTRATOR holds no finance/ledger/KYC/role-governance mutation function', async () => {
      const forbidden = [
        'ledger.post',
        'ledger.reverse',
        'ledger.approve_adjustment',
        'kyc.approve',
        'kyc.reject',
        'workforce.role.create',
        'workforce.role.modify',
        'workforce.role.assign',
        'workforce.role.revoke',
        'finance.control_policy.activate',
      ];
      const rows: Array<{ function_code: string }> = await dataSource.query(
        `SELECT rf.function_code FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id
         WHERE r.role_key = 'ADMINISTRATOR' AND rf.function_code = ANY($1)`,
        [forbidden],
      );
      expect(rows).toHaveLength(0);
    });

    it('1d. ADMINISTRATOR does not hold administrative_capability (reserved to SUPER_ADMIN)', async () => {
      const rows = await dataSource.query(
        `SELECT administrative_capability FROM authorization_roles WHERE role_key = 'ADMINISTRATOR'`,
      );
      expect(rows[0].administrative_capability).toBe(false);
    });

    it('1e. SUPER_ADMIN is a strict superset: also holds the two new operational assignment functions', async () => {
      const rows: Array<{ function_code: string }> = await dataSource.query(`
        SELECT rf.function_code FROM authorization_role_functions rf
        JOIN authorization_roles r ON r.id = rf.role_id
        WHERE r.role_key = 'SUPER_ADMIN' AND rf.function_code IN ('workforce.role.assign_operational','workforce.role.revoke_operational')
      `);
      expect(rows).toHaveLength(2);
    });
  });

  // =====================================================================================
  // 2. ADMINISTRATOR assigns/revokes each of the six operational roles for another user
  // =====================================================================================

  describe('2. ADMINISTRATOR delegated assignment of the six operational roles', () => {
    it.each(OPERATIONAL_ROLES)('assigns then revokes %s for another user via real HTTP', async (roleKey) => {
      const admin = await provisionRole('ADMINISTRATOR');
      const targetPrincipalId = `admroleassign01:target:${randomUUID()}`.slice(0, 160);

      const assignRes = await assignViaHttp(admin.token, targetPrincipalId, roleKey);
      expect(assignRes.status).toBeLessThan(300);

      const active = await dataSource.getRepository(A2FinanceRoleAssignment).findOne({
        where: { principalId: targetPrincipalId, roleKey, status: 'ACTIVE' },
      });
      expect(active).not.toBeNull();
      expect(active!.initiatedScope).toBe('ADMINISTRATOR_SCOPE');
      expect(active!.assignedBy).toBe(admin.principalId);

      const revokeRes = await revokeViaHttp(admin.token, targetPrincipalId, roleKey);
      expect(revokeRes.status).toBeLessThan(300);

      const revoked = await dataSource.getRepository(A2FinanceRoleAssignment).findOne({
        where: { assignmentReference: active!.assignmentReference, status: 'REVOKED' },
      });
      expect(revoked).not.toBeNull();
      expect(revoked!.revokedBy).toBe(admin.principalId);
    });
  });

  // =====================================================================================
  // 3. ADMINISTRATOR cannot assign/revoke its own role
  // =====================================================================================

  describe('3. Self-assignment / self-escalation protection', () => {
    it('3a. ADMINISTRATOR cannot assign an operational role to itself', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const res = await assignViaHttp(admin.token, admin.principalId, 'OPERATIONS');
      expect(res.status).toBe(403);
      const row = await dataSource.getRepository(A2FinanceRoleAssignment).findOne({
        where: { principalId: admin.principalId, roleKey: 'OPERATIONS' },
      });
      expect(row).toBeNull();
    });

    it('3b. ADMINISTRATOR cannot revoke its own ADMINISTRATOR assignment', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const res = await revokeViaHttp(admin.token, admin.principalId, 'ADMINISTRATOR');
      expect([401, 403]).toContain(res.status);
      const row = await dataSource.getRepository(A2FinanceRoleAssignment).findOne({
        where: { principalId: admin.principalId, roleKey: 'ADMINISTRATOR', status: 'ACTIVE' },
      });
      expect(row).not.toBeNull();
    });
  });

  // =====================================================================================
  // 4. ADMINISTRATOR cannot grant SUPER_ADMIN/Finance roles via HTTP
  // =====================================================================================

  describe('4. ADMINISTRATOR cannot grant SUPER_ADMIN or any Finance role', () => {
    it('4a. is denied granting SUPER_ADMIN', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const target = `admroleassign01:t4a:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp(admin.token, target, 'SUPER_ADMIN');
      expect([401, 403]).toContain(res.status);
      const row = await dataSource.getRepository(A2FinanceRoleAssignment).findOne({
        where: { principalId: target, roleKey: 'SUPER_ADMIN' },
      });
      expect(row).toBeNull();
    });

    it.each(['FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'FINANCE_AUDITOR'])(
      '4b. is denied granting %s',
      async (roleKey) => {
        const admin = await provisionRole('ADMINISTRATOR');
        const target = `admroleassign01:t4b:${randomUUID()}`.slice(0, 160);
        const res = await assignViaHttp(admin.token, target, roleKey);
        expect([401, 403]).toContain(res.status);
        const row = await dataSource.getRepository(A2FinanceRoleAssignment).findOne({
          where: { principalId: target, roleKey },
        });
        expect(row).toBeNull();
      },
    );
  });

  // =====================================================================================
  // 5. Direct DB attempts to violate the structural restriction fail
  // =====================================================================================

  describe('5. Database-enforced structural restriction (CHECK constraints)', () => {
    async function rawInsert(roleKey: string, initiatedScope: string) {
      const now = new Date();
      return dataSource.query(
        `INSERT INTO a2_finance_role_assignments
           (id, assignment_reference, assignment_version, principal_id, role_key, scopes, status,
            initiated_scope, interim, effective_from, effective_to, assigned_by, assigned_at,
            approval_ids, audit_references, record_version, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, 1, $2, $3, '[]'::jsonb, 'ACTIVE', $4, true, $5, $6, 'direct-sql-test',
            $5, '[]'::jsonb, '[]'::jsonb, 1, $5, $5)`,
        [
          `direct-sql-test:${randomUUID()}`,
          `direct-sql-principal:${randomUUID()}`,
          roleKey,
          initiatedScope,
          now,
          new Date(now.getTime() + 86_400_000),
        ],
      );
    }

    it('5a. a direct SQL insert tagging ADMINISTRATOR_SCOPE against SUPER_ADMIN is rejected', async () => {
      await expect(rawInsert('SUPER_ADMIN', 'ADMINISTRATOR_SCOPE')).rejects.toThrow();
    });

    it('5b. a direct SQL insert tagging ADMINISTRATOR_SCOPE against FINANCE_CONTROLLER is rejected', async () => {
      await expect(rawInsert('FINANCE_CONTROLLER', 'ADMINISTRATOR_SCOPE')).rejects.toThrow();
    });

    it('5c. a direct SQL insert tagging ADMINISTRATOR_SCOPE against an operational role succeeds', async () => {
      await expect(rawInsert('OPERATIONS', 'ADMINISTRATOR_SCOPE')).resolves.toBeDefined();
    });

    it('5d. an unrecognized initiated_scope value is rejected regardless of role', async () => {
      await expect(rawInsert('OPERATIONS', 'ROGUE_SCOPE')).rejects.toThrow();
    });

    it('5e. SUPER_ADMIN_SCOPE remains unrestricted (can name any role, including SUPER_ADMIN)', async () => {
      await expect(rawInsert('SUPER_ADMIN', 'SUPER_ADMIN_SCOPE')).resolves.toBeDefined();
    });
  });

  // =====================================================================================
  // 6. Only SUPER_ADMIN grants/revokes ADMINISTRATOR itself
  // =====================================================================================

  describe('6. Only SUPER_ADMIN may grant/revoke ADMINISTRATOR', () => {
    it('6a. SUPER_ADMIN can grant ADMINISTRATOR (first assignment, bootstrap-style bypass)', async () => {
      const superAdminToken = await loginSuperAdmin();
      const target = `admroleassign01:t6a:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp(superAdminToken, target, 'ADMINISTRATOR');
      expect(res.status).toBeLessThan(300);
      const row = await dataSource.getRepository(A2FinanceRoleAssignment).findOne({
        where: { principalId: target, roleKey: 'ADMINISTRATOR', status: 'ACTIVE' },
      });
      expect(row).not.toBeNull();
      expect(row!.initiatedScope).toBe('SUPER_ADMIN_SCOPE');
    });

    it('6b. ADMINISTRATOR cannot grant ADMINISTRATOR to a third party', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const target = `admroleassign01:t6b:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp(admin.token, target, 'ADMINISTRATOR');
      expect([401, 403]).toContain(res.status);
    });

    it('6c. a non-SUPER_ADMIN, non-ADMINISTRATOR role cannot grant ADMINISTRATOR', async () => {
      const ops = await provisionRole('OPERATIONS');
      const target = `admroleassign01:t6c:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp(ops.token, target, 'ADMINISTRATOR');
      expect([401, 403]).toContain(res.status);
    });
  });

  // =====================================================================================
  // 7. Unauthenticated rejected (401); unauthorized correctly denied (403)
  // =====================================================================================

  describe('7. Authentication/authorization boundary', () => {
    it('7a. no bearer token on the assign route returns 401, not 403', async () => {
      const target = `admroleassign01:t7a:${randomUUID()}`.slice(0, 160);
      const res = await request(app.getHttpServer())
        .post(ROLES_PATH)
        .send({
          targetPrincipalId: target,
          roleKey: 'OPERATIONS',
          effectiveFrom: new Date().toISOString(),
          effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
        });
      expect(res.status).toBe(401);
    });

    it('7b. a garbage bearer token returns 401', async () => {
      const target = `admroleassign01:t7b:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp('garbage-token-value', target, 'OPERATIONS');
      expect(res.status).toBe(401);
    });

    it('7c. CUSTOMER_SERVICE (an operational role itself) is denied delegated assignment authority', async () => {
      const cs = await provisionRole('CUSTOMER_SERVICE');
      const target = `admroleassign01:t7c:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp(cs.token, target, 'OPERATIONS');
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // 8. FINANCE_AUDITOR cannot gain admin write authority via principal type
  // =====================================================================================

  describe('8. FINANCE_AUDITOR (principal.type === OPERATOR) is denied operational-role authority', () => {
    it('8a. FINANCE_AUDITOR is denied assigning an operational role despite being a real OPERATOR principal', async () => {
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const target = `admroleassign01:t8a:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp(auditor.token, target, 'OPERATIONS');
      expect(res.status).toBe(403);
    });

    it('8b. FINANCE_AUDITOR is denied revoking an operational role', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const target = `admroleassign01:t8b:${randomUUID()}`.slice(0, 160);
      await assignViaHttp(admin.token, target, 'TREASURY');
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const res = await revokeViaHttp(auditor.token, target, 'TREASURY');
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // 9. Existing Finance assignment/privileged-approval maker/checker workflow still works
  // =====================================================================================

  describe('9. Existing Finance maker/checker safeguards are unaffected', () => {
    it('9a. SUPER_ADMIN can still perform the first (bootstrap-bypass) FINANCE_PREPARER assignment', async () => {
      const superAdminToken = await loginSuperAdmin();
      const target = `admroleassign01:t9a:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp(superAdminToken, target, 'FINANCE_PREPARER');
      expect(res.status).toBeLessThan(300);
    });

    it('9b. FINANCE_PREPARER (not an initiating role) is still denied FINANCE_ROLE_ASSIGN', async () => {
      const preparer = await provisionRole('FINANCE_PREPARER');
      const target = `admroleassign01:t9b:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp(preparer.token, target, 'FINANCE_AUDITOR');
      expect([401, 403]).toContain(res.status);
    });

    it('9c. a second FINANCE_PREPARER assignment still requires FINANCE_CONTROLLER approval (maker/checker untouched)', async () => {
      const superAdminToken = await loginSuperAdmin();
      // First assignment of FINANCE_CONTROLLER itself uses the bootstrap-bypass path.
      const controllerTarget = `admroleassign01:t9c-controller:${randomUUID()}`.slice(0, 160);
      await assignViaHttp(superAdminToken, controllerTarget, 'FINANCE_CONTROLLER');
      // First FINANCE_PREPARER assignment also uses the bootstrap-bypass path (count was 0).
      const firstPreparer = `admroleassign01:t9c-first:${randomUUID()}`.slice(0, 160);
      const first = await assignViaHttp(superAdminToken, firstPreparer, 'FINANCE_PREPARER');
      expect(first.status).toBeLessThan(300);
      // A SECOND FINANCE_PREPARER assignment is no longer the "first" for this role key, so it
      // must now go through consumeApprovals — expect it to be rejected without approvalIds.
      const secondPreparer = `admroleassign01:t9c-second:${randomUUID()}`.slice(0, 160);
      const second = await assignViaHttp(superAdminToken, secondPreparer, 'FINANCE_PREPARER');
      expect([401, 403]).toContain(second.status);
    });
  });

  // =====================================================================================
  // 10. Audit records correctly identify actor/target
  // =====================================================================================

  describe('10. Audit trail for the new operational actions', () => {
    it('10a. assigning an operational role records actor + target in the audit log', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const target = `admroleassign01:t10a:${randomUUID()}`.slice(0, 160);
      const res = await assignViaHttp(admin.token, target, 'COMPLIANCE');
      expect(res.status).toBeLessThan(300);

      const events = await dataSource.getRepository(AuditEvent).find({
        where: { action: 'WORKFORCE_ROLE_ASSIGN_OPERATIONAL' },
      });
      expect(events.length).toBeGreaterThanOrEqual(1);
      const event = events.find((e) => (e.newValues as any)?.targetPrincipalId === target);
      expect(event).toBeDefined();
      expect(event!.actor).toBe(admin.principalId);
      expect((event!.newValues as any).roleKey).toBe('COMPLIANCE');
      expect((event!.newValues as any).initiatedScope).toBe('ADMINISTRATOR_SCOPE');
    });

    it('10b. revoking an operational role records actor + target in the audit log', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const target = `admroleassign01:t10b:${randomUUID()}`.slice(0, 160);
      await assignViaHttp(admin.token, target, 'RISK_FRAUD');
      const res = await revokeViaHttp(admin.token, target, 'RISK_FRAUD');
      expect(res.status).toBeLessThan(300);

      const events = await dataSource.getRepository(AuditEvent).find({
        where: { action: 'WORKFORCE_ROLE_REVOKED_OPERATIONAL' },
      });
      const event = events.find((e) => (e.newValues as any)?.targetPrincipalId === target);
      expect(event).toBeDefined();
      expect(event!.actor).toBe(admin.principalId);
      expect((event!.newValues as any).roleKey).toBe('RISK_FRAUD');
    });
  });

  // =====================================================================================
  // 11. Revocation takes effect on subsequent authz checks (no stale caching)
  // =====================================================================================

  describe('11. Revocation takes effect immediately on the next authorization check', () => {
    it('11a. a target principal loses OPERATIONS-gated access the moment it is revoked, same still-valid token', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const target = await provisionRole('CUSTOMER_SERVICE', 'target-11a');
      // Grant OPERATIONS on top of the target's existing CUSTOMER_SERVICE role.
      const assignRes = await assignViaHttp(admin.token, target.principalId, 'OPERATIONS');
      expect(assignRes.status).toBeLessThan(300);

      const customerRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
        [`cust-adminrole01-${randomUUID()}`],
      );
      const customerId = customerRows[0]!.id;
      await dataSource.query(
        `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
        [customerId, 'Admin Role Test Customer'],
      );

      const before = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(target.token))
        .send({ status: 'SUSPENDED', actor: 'admin-role-01-test' });
      expect(before.status).toBe(200);

      const revokeRes = await revokeViaHttp(admin.token, target.principalId, 'OPERATIONS');
      expect(revokeRes.status).toBeLessThan(300);

      // SAME token, SAME still-unexpired session — the next request must be denied because
      // A2WorkforceSessionService.validate() recomputes roles fresh from the DB every call.
      const after = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(target.token))
        .send({ status: 'ACTIVE', actor: 'admin-role-01-test' });
      expect(after.status).toBe(403);
    });
  });

  // =====================================================================================
  // 12. Concurrency / race-condition safety
  // =====================================================================================

  describe('12. Concurrency safety', () => {
    it('12a. two concurrent ADMINISTRATOR assignment requests for the same target/role: exactly one succeeds', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const target = `admroleassign01:t12a:${randomUUID()}`.slice(0, 160);
      const [a, b] = await Promise.all([
        assignViaHttp(admin.token, target, 'OPERATIONS'),
        assignViaHttp(admin.token, target, 'OPERATIONS'),
      ]);
      const statuses = [a.status, b.status].sort();
      // One must succeed (<300); the other must fail (409 conflict, or any non-2xx) — never both
      // succeeding, which would indicate a duplicate-active-assignment race.
      const successCount = [a, b].filter((r) => r.status < 300).length;
      expect(successCount).toBe(1);
      const activeRows = await dataSource.getRepository(A2FinanceRoleAssignment).find({
        where: { principalId: target, roleKey: 'OPERATIONS', status: 'ACTIVE' },
      });
      expect(activeRows).toHaveLength(1);
      expect(statuses.some((s) => s >= 300)).toBe(true);
    });

    it('12b. concurrent assign calls for two DIFFERENT operational roles on the same target both succeed independently', async () => {
      const admin = await provisionRole('ADMINISTRATOR');
      const target = `admroleassign01:t12b:${randomUUID()}`.slice(0, 160);
      const [a, b] = await Promise.all([
        assignViaHttp(admin.token, target, 'TREASURY'),
        assignViaHttp(admin.token, target, 'RISK_FRAUD'),
      ]);
      expect(a.status).toBeLessThan(300);
      expect(b.status).toBeLessThan(300);
      const activeRows = await dataSource.getRepository(A2FinanceRoleAssignment).find({
        where: { principalId: target, status: 'ACTIVE' },
      });
      expect(activeRows.map((r) => r.roleKey).sort()).toEqual(['RISK_FRAUD', 'TREASURY']);
    });
  });
});
