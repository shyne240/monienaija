/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01 — real PostgreSQL + real HTTP proof suite.
 *
 * Nothing authorization-relevant is mocked: real `A2WorkforceSessionService.establish()` (same
 * pattern as v1-administrator-role-and-assignment-implementation-01.integration.spec.ts), the
 * real `authorization_role_functions` catalogue, the real `AuthorizationService.requireFunction`
 * checks reached through `DashboardController`, and the real `dashboard_templates` /
 * `role_dashboard_assignments` tables seeded by `DashboardSeedService`.
 *
 * Covers all 12 categories required by the task:
 *   1. all 11 roles have a valid, persisted assignment to an active template
 *   2. templates/assignments persist across requests (not hardcoded in memory)
 *   3. a brand-new role reuses an existing template via DB/API only — zero frontend/widget code
 *   4. changing a role's dashboard assignment never changes its function grants
 *   5. unauthorized callers are blocked from viewing/modifying dashboard configuration
 *   6. a tampered/forged assignment pointing a role at a template with unauthorized widgets is
 *      still blocked at the per-widget data endpoint
 *   7. missing/inactive-template/unknown-role situations resolve to the safe fallback dashboard
 *   8. unauthorized widget data requests are rejected server-side regardless of client state
 *   9. the period/date filter on transaction-summary computes the correct window and rejects
 *      invalid input
 *  10. not-found / bad-request / malformed-widget error shapes are well-formed and distinct
 *  11. every one of the 11 roles' resolved dashboard contains only widgets that role is actually
 *      entitled to see, and every widget marked authorized is independently fetchable
 *  12. full regression is covered by running the complete existing PG integration suite alongside
 *      this file (see the task report) — not duplicated here
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
import { DashboardTemplate } from '../src/dashboard/dashboard-template.entity';
import { RoleDashboardAssignment } from '../src/dashboard/role-dashboard-assignment.entity';
import { DASHBOARD_WIDGET_REGISTRY } from '../src/dashboard/dashboard-widget-registry';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';
const DASH = '/api/v1/internal/a2/workforce/dashboard';

const ALL_V1_ROLES = [
  'SUPER_ADMIN',
  'ADMINISTRATOR',
  'FINANCE_PREPARER',
  'FINANCE_CONTROLLER',
  'FINANCE_AUDITOR',
  'OPERATIONS',
  'AGENT_NETWORK_MANAGER',
  'COMPLIANCE',
  'RISK_FRAUD',
  'CUSTOMER_SERVICE',
  'TREASURY',
] as const;

describe('V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01 — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1dashplat01');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
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
  // pattern to v1-administrator-role-and-assignment-implementation-01.integration.spec.ts)

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

  async function provisionRole(
    roleKey: string,
    principalSuffix = roleKey,
    principalId = `v1dashplat01:${principalSuffix}:${randomUUID()}`.slice(0, 160),
  ): Promise<{ principalId: string; token: string }> {
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `v1-dash-plat-01:${principalId}:${roleKey}`,
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
      issuer: 'https://id.monienaija.test',
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

  async function grantedFunctionsFor(roleKey: string): Promise<Set<string>> {
    const rows: Array<{ function_code: string }> = await dataSource.query(
      `SELECT f.function_code FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id
         JOIN authorization_functions f ON f.function_code = rf.function_code
        WHERE r.role_key = $1 AND rf.is_active = TRUE`,
      [roleKey],
    );
    return new Set(rows.map((r) => r.function_code));
  }

  // =====================================================================================
  // 1 & 2. All 11 roles seeded with a valid, persisted, active-template assignment
  // =====================================================================================
  describe('1 & 2. seed correctness and persistence', () => {
    it('1a. every one of the 11 V1 roles has exactly one assignment pointing at an active template', async () => {
      const token = await loginSuperAdmin();
      const res = await request(app.getHttpServer()).get(`${DASH}/assignments`).set(auth(token));
      expect(res.status).toBe(200);
      const byRole = new Map<string, any>(res.body.map((a: any) => [a.roleKey, a]));
      for (const roleKey of ALL_V1_ROLES) {
        const assignment = byRole.get(roleKey);
        expect(assignment).toBeDefined();
        const templateRes = await request(app.getHttpServer())
          .get(`${DASH}/templates/${assignment.templateKey}`)
          .set(auth(token));
        expect(templateRes.status).toBe(200);
        expect(templateRes.body.isActive).toBe(true);
      }
    });

    it('1b. 12 templates seeded (11 operational-area + 1 fallback), each referencing only registered widgets', async () => {
      const token = await loginSuperAdmin();
      const res = await request(app.getHttpServer()).get(`${DASH}/templates`).set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(12);
      const registryKeys = new Set(DASHBOARD_WIDGET_REGISTRY.map((w) => w.widgetKey));
      for (const template of res.body) {
        for (const w of template.layout.widgets) {
          expect(registryKeys.has(w.widgetKey)).toBe(true);
        }
      }
    });

    it('2a. an assignment change persists across independent requests (not held in memory)', async () => {
      const token = await loginSuperAdmin();
      const changeRes = await request(app.getHttpServer())
        .put(`${DASH}/assignments/TREASURY`)
        .set(auth(token))
        .send({ templateKey: 'RECONCILIATION_VISIBILITY', reason: 'no-op re-assignment for persistence check' });
      expect(changeRes.status).toBe(200);

      const refetch = await request(app.getHttpServer()).get(`${DASH}/assignments`).set(auth(token));
      const treasury = refetch.body.find((a: any) => a.roleKey === 'TREASURY');
      expect(treasury.templateKey).toBe('RECONCILIATION_VISIBILITY');

      // Independently confirm directly against the DB (not just through the same API process).
      const dbRow = await dataSource
        .getRepository(RoleDashboardAssignment)
        .findOne({ where: { roleKey: 'TREASURY' } as never });
      expect(dbRow?.templateKey).toBe('RECONCILIATION_VISIBILITY');
    });
  });

  // =====================================================================================
  // 3. A brand-new role reuses an existing template with zero frontend/widget code changes
  // =====================================================================================
  describe('3. new role reuse', () => {
    it('3a. a newly-created role can be assigned an existing template purely via DB/API rows', async () => {
      const token = await loginSuperAdmin();

      // Simulate "a new role now exists" the same way the governance seed table would: insert a
      // new authorization_roles row directly (role creation itself is governed by
      // V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01 and is out of scope here — this
      // test only proves the DASHBOARD layer needs no code change once a role exists).
      const newRoleId = randomUUID();
      await dataSource.query(
        `INSERT INTO authorization_roles
           (id, role_key, display_name, description, is_active, is_system_seeded,
            finance_role_class, administrative_capability, read_only, maker_eligible,
            checker_eligible, created_by, created_at, updated_at)
         VALUES ($1,'JUNIOR_SUPPORT_AGENT','Junior Support Agent','A new, narrower support role',true,false,
                 false,false,false,false,false,'test-harness',NOW(),NOW())`,
        [newRoleId],
      );
      await dataSource.query(
        `INSERT INTO authorization_role_functions (id, role_id, function_code, access_type, is_active, assigned_by, assigned_at, created_at, updated_at)
         VALUES ($1,$2,'customer.manage_support_case','EXECUTE',true,'test-harness',NOW(),NOW(),NOW())`,
        [randomUUID(), newRoleId],
      );

      const assignRes = await request(app.getHttpServer())
        .put(`${DASH}/assignments/JUNIOR_SUPPORT_AGENT`)
        .set(auth(token))
        .send({ templateKey: 'CUSTOMER_SERVICING', reason: 'new role reuses existing template' });
      expect(assignRes.status).toBe(200);
      expect(assignRes.body.templateKey).toBe('CUSTOMER_SERVICING');

      // The new role's resolved dashboard uses the SAME template/widget set as CUSTOMER_SERVICE —
      // no new widget, template, or frontend component was created.
      const { token: newRoleToken } = await provisionRole('JUNIOR_SUPPORT_AGENT');
      const mine = await request(app.getHttpServer()).get(`${DASH}/my-dashboard`).set(auth(newRoleToken));
      expect(mine.status).toBe(200);
      expect(mine.body.templateKey).toBe('CUSTOMER_SERVICING');
      expect(mine.body.widgets.map((w: any) => w.widgetKey)).toEqual(
        expect.arrayContaining(['support-ticket-queue', 'customer-directory-shortcut']),
      );
    });
  });

  // =====================================================================================
  // 4. Assignment change never changes permissions
  // =====================================================================================
  describe('4. assignment change is not a permission change', () => {
    it('4a. changing TREASURY\'s dashboard template does not alter its function grants', async () => {
      const token = await loginSuperAdmin();
      const before = await grantedFunctionsFor('TREASURY');

      const res = await request(app.getHttpServer())
        .put(`${DASH}/assignments/TREASURY`)
        .set(auth(token))
        .send({ templateKey: 'EXECUTIVE_GOVERNANCE', reason: 'test: swap to a template with far more widgets' });
      expect(res.status).toBe(200);

      const after = await grantedFunctionsFor('TREASURY');
      expect([...after].sort()).toEqual([...before].sort());
      expect([...before]).toEqual(['reconciliation.view']);

      // Even though TREASURY is now assigned the EXECUTIVE_GOVERNANCE template (far more
      // widgets than it is entitled to), its resolved dashboard still marks every widget it does
      // not hold the function for as unauthorized, and only reconciliation-status as authorized.
      const { token: treasuryToken } = await provisionRole('TREASURY');
      const mine = await request(app.getHttpServer()).get(`${DASH}/my-dashboard`).set(auth(treasuryToken));
      expect(mine.body.templateKey).toBe('EXECUTIVE_GOVERNANCE');
      const byKey = new Map<string, any>(mine.body.widgets.map((w: any) => [w.widgetKey, w]));
      expect(byKey.get('reconciliation-status').authorized).toBe(true);
      expect(byKey.get('transaction-summary').authorized).toBe(false);
      expect(byKey.get('workforce-overview').authorized).toBe(false);
      expect(byKey.get('role-governance-queue').authorized).toBe(false);
    });
  });

  // =====================================================================================
  // 5. Unauthorized callers blocked from viewing/modifying dashboard configuration
  // =====================================================================================
  describe('5. configuration surface authorization', () => {
    it('5a. no bearer token returns 401 on every dashboard configuration route', async () => {
      await expect(request(app.getHttpServer()).get(`${DASH}/templates`)).resolves.toMatchObject({ status: 401 });
      await expect(request(app.getHttpServer()).get(`${DASH}/assignments`)).resolves.toMatchObject({ status: 401 });
      await expect(request(app.getHttpServer()).get(`${DASH}/my-dashboard`)).resolves.toMatchObject({ status: 401 });
      await expect(
        request(app.getHttpServer()).put(`${DASH}/assignments/TREASURY`).send({ templateKey: 'RECONCILIATION_VISIBILITY' }),
      ).resolves.toMatchObject({ status: 401 });
    });

    it('5b. a role without workforce.dashboard.view (TREASURY) is denied listing templates/assignments', async () => {
      const { token } = await provisionRole('TREASURY');
      const templates = await request(app.getHttpServer()).get(`${DASH}/templates`).set(auth(token));
      expect(templates.status).toBe(403);
      const assignments = await request(app.getHttpServer()).get(`${DASH}/assignments`).set(auth(token));
      expect(assignments.status).toBe(403);
    });

    it('5c. a role without workforce.dashboard.assign (FINANCE_AUDITOR — read-only governed role) cannot change an assignment', async () => {
      const { token } = await provisionRole('FINANCE_AUDITOR');
      const res = await request(app.getHttpServer())
        .put(`${DASH}/assignments/TREASURY`)
        .set(auth(token))
        .send({ templateKey: 'EXECUTIVE_GOVERNANCE' });
      expect(res.status).toBe(403);
      // and the assignment is provably unchanged
      const row = await dataSource.getRepository(RoleDashboardAssignment).findOne({ where: { roleKey: 'TREASURY' } as never });
      expect(row?.templateKey).toBe('RECONCILIATION_VISIBILITY');
    });

    it('5d. only SUPER_ADMIN/ADMINISTRATOR hold workforce.dashboard.assign (least-privilege check against the catalogue)', async () => {
      const rows: Array<{ role_key: string }> = await dataSource.query(
        `SELECT r.role_key FROM authorization_role_functions rf
           JOIN authorization_roles r ON r.id = rf.role_id
          WHERE rf.function_code = 'workforce.dashboard.assign' AND rf.is_active = TRUE`,
      );
      expect(rows.map((r) => r.role_key).sort()).toEqual(['ADMINISTRATOR', 'SUPER_ADMIN']);
    });
  });

  // =====================================================================================
  // 6. Tampered/forged assignment still cannot leak unauthorized widget data
  // =====================================================================================
  describe('6. tampered widget config remains backend-protected', () => {
    it('6a. directly forcing a role onto a template with widgets it is not entitled to still blocks the widget endpoints', async () => {
      // Forge the assignment directly against the DB — bypassing the assignTemplate() service
      // entirely, simulating e.g. a compromised/buggy client or stale cache.
      await dataSource.query(
        `UPDATE role_dashboard_assignments SET template_key = 'EXECUTIVE_GOVERNANCE' WHERE role_key = 'CUSTOMER_SERVICE'`,
      );
      const { token } = await provisionRole('CUSTOMER_SERVICE');
      const mine = await request(app.getHttpServer()).get(`${DASH}/my-dashboard`).set(auth(token));
      expect(mine.body.templateKey).toBe('EXECUTIVE_GOVERNANCE');
      const byKey = new Map<string, any>(mine.body.widgets.map((w: any) => [w.widgetKey, w]));
      expect(byKey.get('transaction-summary').authorized).toBe(false);

      // Even if the frontend ignored `authorized: false` and called the widget endpoint anyway:
      const widgetRes = await request(app.getHttpServer())
        .get(`${DASH}/widgets/transaction-summary`)
        .set(auth(token));
      expect(widgetRes.status).toBe(403);

      const ledgerRes = await request(app.getHttpServer()).get(`${DASH}/widgets/ledger-summary`).set(auth(token));
      expect(ledgerRes.status).toBe(403);
    });
  });

  // =====================================================================================
  // 7. Missing/inactive templates and unknown roles resolve to the safe fallback dashboard
  // =====================================================================================
  describe('7. safe fallback behaviour', () => {
    it('7a. a role with no assignment row at all falls back to DEFAULT_FALLBACK', async () => {
      await dataSource.query(`DELETE FROM role_dashboard_assignments WHERE role_key = 'OPERATIONS'`);
      const { token } = await provisionRole('OPERATIONS');
      const mine = await request(app.getHttpServer()).get(`${DASH}/my-dashboard`).set(auth(token));
      expect(mine.status).toBe(200);
      expect(mine.body.templateKey).toBe('DEFAULT_FALLBACK');
      expect(mine.body.isFallback).toBe(true);
      expect(mine.body.widgets.map((w: any) => w.widgetKey)).toEqual(['identity-session', 'entitlements-scopes']);
    });

    it('7b. a role assigned to a since-deactivated template falls back to DEFAULT_FALLBACK', async () => {
      await dataSource.query(`UPDATE dashboard_templates SET is_active = FALSE WHERE template_key = 'FRAUD_CASE_MONITORING'`);
      const { token } = await provisionRole('RISK_FRAUD');
      const mine = await request(app.getHttpServer()).get(`${DASH}/my-dashboard`).set(auth(token));
      expect(mine.status).toBe(200);
      expect(mine.body.templateKey).toBe('DEFAULT_FALLBACK');
      expect(mine.body.isFallback).toBe(true);
    });

    it('7c. a role assigned to a template key that no longer exists falls back to DEFAULT_FALLBACK', async () => {
      await dataSource.query(
        `UPDATE role_dashboard_assignments SET template_key = 'NO_SUCH_TEMPLATE_ANYMORE' WHERE role_key = 'COMPLIANCE'`,
      );
      const { token } = await provisionRole('COMPLIANCE');
      const mine = await request(app.getHttpServer()).get(`${DASH}/my-dashboard`).set(auth(token));
      expect(mine.status).toBe(200);
      expect(mine.body.templateKey).toBe('DEFAULT_FALLBACK');
    });

    it('7d. assigning (or reading) an unknown role via the config API is rejected with 400, not a crash', async () => {
      const token = await loginSuperAdmin();
      const res = await request(app.getHttpServer())
        .put(`${DASH}/assignments/NOT_A_REAL_ROLE`)
        .set(auth(token))
        .send({ templateKey: 'RECONCILIATION_VISIBILITY' });
      expect(res.status).toBe(400);
    });

    it('7e. assigning a role to an unknown/inactive template via the config API is rejected with 400', async () => {
      const token = await loginSuperAdmin();
      const unknown = await request(app.getHttpServer())
        .put(`${DASH}/assignments/TREASURY`)
        .set(auth(token))
        .send({ templateKey: 'NOT_A_REAL_TEMPLATE' });
      expect(unknown.status).toBe(400);

      await dataSource.query(`UPDATE dashboard_templates SET is_active = FALSE WHERE template_key = 'COMPLIANCE_KYC'`);
      const inactive = await request(app.getHttpServer())
        .put(`${DASH}/assignments/TREASURY`)
        .set(auth(token))
        .send({ templateKey: 'COMPLIANCE_KYC' });
      expect(inactive.status).toBe(400);
    });
  });

  // =====================================================================================
  // 8. Unauthorized widget requests rejected server-side regardless of client/dashboard state
  // =====================================================================================
  describe('8. per-widget server-side authorization', () => {
    it('8a. CUSTOMER_SERVICE cannot fetch fraud-case-summary even though it is a valid registered widget', async () => {
      const { token } = await provisionRole('CUSTOMER_SERVICE');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/fraud-case-summary`).set(auth(token));
      expect(res.status).toBe(403);
    });

    it('8b. AGENT_NETWORK_MANAGER cannot fetch kyc-queue-summary', async () => {
      const { token } = await provisionRole('AGENT_NETWORK_MANAGER');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/kyc-queue-summary`).set(auth(token));
      expect(res.status).toBe(403);
    });

    it('8c. a request for a non-existent widget key returns 404', async () => {
      const { token } = await provisionRole('SUPER_ADMIN');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/not-a-real-widget`).set(auth(token));
      expect(res.status).toBe(404);
    });

    it('8d. a "direct"-fetchMode widget cannot be pulled through the generic proxy route', async () => {
      const { token } = await provisionRole('SUPER_ADMIN');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/system-health`).set(auth(token));
      expect(res.status).toBe(400);
    });
  });

  // =====================================================================================
  // 9. Date/period filter correctness
  // =====================================================================================
  describe('9. transaction-summary period filter', () => {
    it('9a. period=today/7d/30d all succeed and echo a coherent, correctly-ordered date range', async () => {
      const { token } = await provisionRole('OPERATIONS');
      for (const period of ['today', '7d', '30d']) {
        const res = await request(app.getHttpServer())
          .get(`${DASH}/widgets/transaction-summary?period=${period}`)
          .set(auth(token));
        expect(res.status).toBe(200);
        expect(res.body.period).toBe(period);
        expect(new Date(res.body.from).getTime()).toBeLessThanOrEqual(new Date(res.body.to).getTime());
        expect(res.body.currency).toBe('NGN');
        expect(Array.isArray(res.body.byType)).toBe(true);
        expect(res.body.byType.map((t: any) => t.type).sort()).toEqual(['C2C', 'C2W', 'W2C', 'W2W']);
      }
    });

    it('9b. period=custom without from/to is rejected with 400', async () => {
      const { token } = await provisionRole('OPERATIONS');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/transaction-summary?period=custom`).set(auth(token));
      expect(res.status).toBe(400);
    });

    it('9e. [V2 regression — Defect #2] transaction-summary byType reports a numeric feeRevenueMinor for W2W/C2C (fee-bearing tables) and null for C2W/W2C (no fee column), for every supported period, with no 500', async () => {
      // This is the exact shape the V1 query crashed on with "bind message supplies 3
      // parameters, but prepared statement requires 2" for the C2W (deposits) and W2C
      // (withdrawals) branches specifically, because $3 was always bound but only ever
      // referenced in the SQL text when a fee column existed. Exercising all four types across
      // every period value is the direct regression guard for that fix.
      const { token } = await provisionRole('SUPER_ADMIN');
      for (const period of ['today', '7d', '30d']) {
        const res = await request(app.getHttpServer())
          .get(`${DASH}/widgets/transaction-summary?period=${period}`)
          .set(auth(token));
        expect(res.status).toBe(200);
        const byType = new Map<string, any>(res.body.byType.map((t: any) => [t.type, t]));
        expect(byType.get('W2W').feeRevenueMinor).toEqual(expect.any(String));
        expect(byType.get('C2C').feeRevenueMinor).toEqual(expect.any(String));
        expect(byType.get('C2W').feeRevenueMinor).toBeNull();
        expect(byType.get('W2C').feeRevenueMinor).toBeNull();
      }
    });

    it('9f. [V2 feature] compare=true returns a previousPeriod and a null (not NaN/Infinity/crash) comparison when there is no prior-period baseline', async () => {
      const { token } = await provisionRole('SUPER_ADMIN');
      const res = await request(app.getHttpServer())
        .get(`${DASH}/widgets/transaction-summary?period=7d&compare=true`)
        .set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('previousPeriod');
      expect(new Date(res.body.previousPeriod.to).getTime()).toBe(new Date(res.body.from).getTime());
      expect(res.body).toHaveProperty('comparison');
      expect(res.body.comparison).toHaveProperty('definition');
      // With an empty, freshly-truncated database both periods have zero completed transactions,
      // so there is no comparable baseline — must be null, never NaN/Infinity/thrown.
      expect(res.body.comparison.completedCountChangePercent).toBeNull();
      expect(res.body.comparison.completedValueChangePercent).toBeNull();
    });

    it('9g. compare is omitted by default (no previousPeriod/comparison keys) — opt-in only, never a behaviour change for existing callers', async () => {
      const { token } = await provisionRole('SUPER_ADMIN');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/transaction-summary?period=7d`).set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.previousPeriod).toBeUndefined();
      expect(res.body.comparison).toBeUndefined();
    });

    it('9c. period=custom with from after to is rejected with 400', async () => {
      const { token } = await provisionRole('OPERATIONS');
      const res = await request(app.getHttpServer())
        .get(`${DASH}/widgets/transaction-summary?period=custom&from=2026-01-10&to=2026-01-01`)
        .set(auth(token));
      expect(res.status).toBe(400);
    });

    it('9d. period=custom with a valid range succeeds and no invented commission/trend figures are present', async () => {
      const { token } = await provisionRole('OPERATIONS');
      const res = await request(app.getHttpServer())
        .get(`${DASH}/widgets/transaction-summary?period=custom&from=2026-01-01&to=2026-01-31`)
        .set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.period).toBe('custom');
      expect(res.body.commission).toBeNull();
      expect(typeof res.body.commissionNote).toBe('string');
    });
  });

  // =====================================================================================
  // 9.5 [V2 regressions] recent-transactions (Defects #3/#4) and transaction-trend (new widget)
  // =====================================================================================
  describe('9.5 recent-transactions and transaction-trend (V2 regression + new widget)', () => {
    it('[V2 regression — Defect #3] recent-transactions returns 200 with a well-formed array, not a UNION ALL syntax error', async () => {
      // V1 built `(SELECT ... ORDER BY ... LIMIT ...)` branches WITHOUT parentheses around each
      // UNION ALL branch, which Postgres rejects outright ("syntax error at or near UNION") on
      // every single call, unconditionally. This is the direct regression guard for that fix.
      const { token } = await provisionRole('SUPER_ADMIN');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/recent-transactions`).set(auth(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const row of res.body) {
        expect(['W2W', 'C2W', 'W2C', 'C2C']).toContain(row.type);
        expect(typeof row.amountMinor).toBe('string');
        expect(row).toHaveProperty('status');
        expect(row).toHaveProperty('createdAt');
      }
    });

    it('[V2 regression — Defect #4] recent-transactions does not fail with "column completed_at does not exist" (cash_to_cash_transfers uses claimed_at)', async () => {
      // V1 hardcoded `completed_at` for every unioned table, but cash_to_cash_transfers has no
      // such column (its completion timestamp is `claimed_at`, set on CLAIMED). Covered
      // structurally by the 200 assertion above; this test additionally pins the exact defect
      // description so a future regression surfaces with a clear, specific failure message.
      const { token } = await provisionRole('SUPER_ADMIN');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/recent-transactions?limit=50`).set(auth(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('recent-transactions clamps an invalid/non-numeric limit to a safe default rather than emitting "LIMIT NaN"', async () => {
      const { token } = await provisionRole('SUPER_ADMIN');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/recent-transactions?limit=not-a-number`).set(auth(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('[V2 feature] transaction-trend returns one zero-filled row per day in range, newest last, for a role holding reporting.transaction_summary.view', async () => {
      const { token } = await provisionRole('OPERATIONS');
      const res = await request(app.getHttpServer())
        .get(`${DASH}/widgets/transaction-trend?period=7d`)
        .set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.currency).toBe('NGN');
      expect(typeof res.body.definition).toBe('string');
      expect(Array.isArray(res.body.daily)).toBe(true);
      // 7d window spans 7 (today exclusive of time-of-day truncation) to 8 calendar days
      expect(res.body.daily.length).toBeGreaterThanOrEqual(7);
      expect(res.body.daily.length).toBeLessThanOrEqual(9);
      for (const day of res.body.daily) {
        expect(day).toHaveProperty('date');
        expect(day.completedCount).toBe(0); // no seeded transactions in this freshly-truncated suite
        expect(day.completedValueMinor).toBe('0');
      }
      // zero-filled and strictly ascending by date, not just present where data happens to exist
      const dates = res.body.daily.map((d: any) => d.date);
      expect([...dates].sort()).toEqual(dates);
    });

    it('transaction-trend rejects a custom range wider than 92 days (existing-query-limit style safeguard)', async () => {
      const { token } = await provisionRole('SUPER_ADMIN');
      const res = await request(app.getHttpServer())
        .get(`${DASH}/widgets/transaction-trend?period=custom&from=2020-01-01&to=2020-12-31`)
        .set(auth(token));
      expect(res.status).toBe(400);
    });

    it('transaction-trend is still enforced per-widget authorization (a role without reporting.transaction_summary.view is rejected)', async () => {
      const { token } = await provisionRole('TREASURY');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/transaction-trend`).set(auth(token));
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // 10. Error-shape correctness for not-found/bad-request cases
  // =====================================================================================
  describe('10. error-state correctness', () => {
    it('10a. GET a non-existent template key returns 404', async () => {
      const token = await loginSuperAdmin();
      const res = await request(app.getHttpServer()).get(`${DASH}/templates/NOT_REAL`).set(auth(token));
      expect(res.status).toBe(404);
    });

    it('10b. PUT an assignment without templateKey in the body returns 400', async () => {
      const token = await loginSuperAdmin();
      const res = await request(app.getHttpServer()).put(`${DASH}/assignments/TREASURY`).set(auth(token)).send({});
      expect(res.status).toBe(400);
    });
  });

  // =====================================================================================
  // 11. Every role's resolved dashboard is correct, complete, and leak-free
  // =====================================================================================
  describe('11. full per-role dashboard correctness (no unauthorized widget/data leakage)', () => {
    it.each(ALL_V1_ROLES)('11.%s resolves a dashboard whose authorized flags exactly match its real catalogue grants, and every authorized proxy widget is fetchable', async (roleKey) => {
      const granted = await grantedFunctionsFor(roleKey);
      const { token } = await provisionRole(roleKey);

      const mine = await request(app.getHttpServer()).get(`${DASH}/my-dashboard`).set(auth(token));
      expect(mine.status).toBe(200);
      expect(mine.body.isFallback).toBe(false);

      for (const widget of mine.body.widgets) {
        const def = DASHBOARD_WIDGET_REGISTRY.find((w) => w.widgetKey === widget.widgetKey);
        expect(def).toBeDefined();
        const expectedAuthorized = def!.requiredFunctions.every((fn) => granted.has(fn));
        expect(widget.authorized).toBe(expectedAuthorized);

        if (widget.authorized && widget.fetchMode === 'proxy') {
          const widgetRes = await request(app.getHttpServer()).get(`${DASH}/widgets/${widget.widgetKey}`).set(auth(token));
          expect(widgetRes.status).toBe(200);
        }
        if (!widget.authorized && widget.fetchMode === 'proxy') {
          const widgetRes = await request(app.getHttpServer()).get(`${DASH}/widgets/${widget.widgetKey}`).set(auth(token));
          expect(widgetRes.status).toBe(403);
        }
      }

      // self-widgets always present and always authorized (no function required)
      const byKey = new Map<string, any>(mine.body.widgets.map((w: any) => [w.widgetKey, w]));
      expect(byKey.get('identity-session')?.authorized).toBe(true);
      expect(byKey.get('entitlements-scopes')?.authorized).toBe(true);
    });

    it('11z. RISK_FRAUD never sees AML/KYC/SANCTIONS compliance-case data (category boundary)', async () => {
      const { token } = await provisionRole('RISK_FRAUD');
      const res = await request(app.getHttpServer()).get(`${DASH}/widgets/fraud-case-summary`).set(auth(token));
      expect(res.status).toBe(200);
      // fraud-case-summary itself is category='FRAUD'-only by construction (see widget data
      // service SQL); this assertion guards the boundary without asserting invented data counts.
      expect(res.body).toHaveProperty('byStatus');
      const complianceAttempt = await request(app.getHttpServer()).get(`${DASH}/widgets/compliance-case-summary`).set(auth(token));
      expect(complianceAttempt.status).toBe(403);
    });

    it('11y. TREASURY is limited to exactly reconciliation.view-backed data', async () => {
      const granted = await grantedFunctionsFor('TREASURY');
      expect([...granted]).toEqual(['reconciliation.view']);
      const { token } = await provisionRole('TREASURY');
      const ok = await request(app.getHttpServer()).get(`${DASH}/widgets/reconciliation-status`).set(auth(token));
      expect(ok.status).toBe(200);
      expect(ok.body).toHaveProperty('report');
      expect(ok.body).toHaveProperty('trialBalance');
    });
  });
});
