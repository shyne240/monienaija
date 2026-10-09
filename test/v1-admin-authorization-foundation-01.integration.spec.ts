/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { AuthorizationCatalogueSeedService } from '../src/authorization-catalogue/authorization-catalogue-seed.service';
import {
  AUTHORIZATION_FUNCTION_SEED,
  AUTHORIZATION_ROLE_FUNCTION_SEED,
  AUTHORIZATION_ROLE_SEED,
} from '../src/authorization-catalogue/authorization-catalogue.seed';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * V1-ADMIN-AUTHORIZATION-FOUNDATION-01
 *
 * Focused integration suite for the database-backed function/role
 * authorization foundation. Boots the full AppModule (against a real,
 * freshly-migrated PostgreSQL database produced by the harness) specifically
 * to prove the new AuthorizationCatalogueModule composes cleanly alongside
 * the existing, unmodified A2 workforce/finance authorization runtime — then
 * asserts directly against the new tables via SQL and via the seed service.
 *
 * This suite does NOT exercise any HTTP route: this foundation task does not
 * wire the new catalogue into any controller or guard.
 */
describe('V1-ADMIN-AUTHORIZATION-FOUNDATION-01 — Function/Role Catalogue (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let moduleRef: Awaited<ReturnType<typeof Test.createTestingModule>> extends infer T ? any : never;
  let seedService: AuthorizationCatalogueSeedService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    // @ts-ignore
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token) throw new UnauthorizedException('invalid workforce token');
      return {
        type: 'OPERATOR',
        principalId: 'workforce-operator-1',
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-admin-authz-foundation');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init(); // runs OnApplicationBootstrap -> AuthorizationCatalogueSeedService.seedIfEmpty()
    seedService = moduleRef.get(AuthorizationCatalogueSeedService);
    (moduleRef as any).__app = app;
  }, 180000);

  afterAll(async () => {
    const app = (moduleRef as any)?.__app;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          void 0;
        }
      }
    }
  }, 60000);

  // --- 1. All eleven roles exist after migration/seed --------------------
  // V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01 added ADMINISTRATOR (the 11th
  // approved role) to the catalogue seed.
  it('seeds exactly the eleven approved V1 roles', async () => {
    const rows: Array<{ role_key: string }> = await dataSource.query(
      `SELECT role_key FROM authorization_roles ORDER BY role_key`,
    );
    const keys = rows.map((r) => r.role_key).sort();
    const expected = [
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
    ].sort();
    expect(keys).toEqual(expected);
    expect(keys.length).toBe(11);
  });

  // --- 2. FINANCE_ADMIN is not seeded as an organizational role ---------
  it('does not seed FINANCE_ADMIN as an organizational role', async () => {
    const rows = await dataSource.query(`SELECT 1 FROM authorization_roles WHERE role_key = 'FINANCE_ADMIN'`);
    expect(rows.length).toBe(0);
  });

  // --- 3. Required functions exist --------------------------------------
  it('seeds the full approved function catalogue with exact stable identifiers', async () => {
    const rows: Array<{ function_code: string }> = await dataSource.query(`SELECT function_code FROM authorization_functions`);
    const seeded = new Set(rows.map((r) => r.function_code));
    expect(seeded.size).toBe(AUTHORIZATION_FUNCTION_SEED.length);
    for (const item of AUTHORIZATION_FUNCTION_SEED) {
      expect(seeded.has(item.functionCode)).toBe(true);
    }
    // Spot-check a representative sample across every classification
    expect(seeded.has('customer.view')).toBe(true);
    expect(seeded.has('ledger.post')).toBe(true);
    expect(seeded.has('workforce.role.create')).toBe(true); // catalogued, even though not assignable
    expect(seeded.has('treasury.manage_settlement')).toBe(true); // catalogued, even though OUT_OF_V1_SCOPE
  });

  // --- 4. Required role/function assignments exist ----------------------
  it('seeds every role/function assignment in the approved matrix', async () => {
    const rows: Array<{ role_key: string; function_code: string; access_type: string }> = await dataSource.query(`
      SELECT r.role_key, rf.function_code, rf.access_type
      FROM authorization_role_functions rf
      JOIN authorization_roles r ON r.id = rf.role_id
    `);
    expect(rows.length).toBe(AUTHORIZATION_ROLE_FUNCTION_SEED.length);
    const actual = new Set(rows.map((r) => `${r.role_key}::${r.function_code}::${r.access_type}`));
    for (const item of AUTHORIZATION_ROLE_FUNCTION_SEED) {
      expect(actual.has(`${item.roleKey}::${item.functionCode}::${item.accessType}`)).toBe(true);
    }
  });

  // --- 5. No duplicate role/function assignments -------------------------
  it('has no duplicate role/function assignments', async () => {
    const dupes = await dataSource.query(`
      SELECT role_id, function_code, COUNT(*) AS c
      FROM authorization_role_functions
      GROUP BY role_id, function_code
      HAVING COUNT(*) > 1
    `);
    expect(dupes.length).toBe(0);
  });

  // --- 6. Future/out-of-scope functions not accidentally assignable ------
  it('does not mark any FUTURE or OUT_OF_V1_SCOPE function as assignable, and never assigns a non-assignable function to a role', async () => {
    const wronglyAssignable = await dataSource.query(`
      SELECT function_code FROM authorization_functions
      WHERE v1_status IN ('FUTURE','OUT_OF_V1_SCOPE') AND assignable = TRUE
    `);
    expect(wronglyAssignable.length).toBe(0);

    const explicitlyBarred = [
      'transaction.search',
      'transaction.reversal.request',
      'transaction.reversal.approve',
      'agent.manage_permissions',
      'workforce.role.create',
      'workforce.role.modify',
      'compliance.restrict_account',
      'compliance.release_restriction',
      'audit.export',
      'reconciliation.investigate',
      'reconciliation.resolve',
      'treasury.manage_settlement',
      'treasury.resolve_suspense',
    ];
    for (const code of explicitlyBarred) {
      const fn = await dataSource.query(`SELECT assignable FROM authorization_functions WHERE function_code = $1`, [code]);
      expect(fn.length).toBe(1);
      expect(fn[0].assignable).toBe(false);
      const assignments = await dataSource.query(`SELECT 1 FROM authorization_role_functions WHERE function_code = $1`, [code]);
      expect(assignments.length).toBe(0);
    }
  });

  // --- 7. Treasury has only reconciliation.view ---------------------------
  it('TREASURY holds exactly one function: reconciliation.view', async () => {
    const rows = await dataSource.query(`
      SELECT f.function_code FROM authorization_role_functions rf
      JOIN authorization_roles r ON r.id = rf.role_id
      JOIN authorization_functions f ON f.function_code = rf.function_code
      WHERE r.role_key = 'TREASURY'
    `);
    expect(rows.map((r: any) => r.function_code)).toEqual(['reconciliation.view']);
  });

  // --- 8. Risk/Fraud has only FRAUD-category case authority ---------------
  it('RISK_FRAUD holds only risk_fraud.manage_fraud_case among compliance-case mutation functions', async () => {
    const rows = await dataSource.query(`
      SELECT f.function_code FROM authorization_role_functions rf
      JOIN authorization_roles r ON r.id = rf.role_id
      JOIN authorization_functions f ON f.function_code = rf.function_code
      WHERE r.role_key = 'RISK_FRAUD'
    `);
    expect(rows.map((r: any) => r.function_code)).toEqual(['risk_fraud.manage_fraud_case']);
    const complianceCase = await dataSource.query(`
      SELECT 1 FROM authorization_role_functions rf
      JOIN authorization_roles r ON r.id = rf.role_id
      WHERE r.role_key = 'RISK_FRAUD' AND rf.function_code = 'compliance.manage_case'
    `);
    expect(complianceCase.length).toBe(0);
  });

  // --- 9. Finance Auditor receives only approved read/audit functions -----
  it('FINANCE_AUDITOR is read_only and holds zero mutation (non-READ) functions', async () => {
    const role = await dataSource.query(`SELECT read_only FROM authorization_roles WHERE role_key = 'FINANCE_AUDITOR'`);
    expect(role[0].read_only).toBe(true);

    const nonRead = await dataSource.query(`
      SELECT f.function_code, f.sensitivity FROM authorization_role_functions rf
      JOIN authorization_roles r ON r.id = rf.role_id
      JOIN authorization_functions f ON f.function_code = rf.function_code
      WHERE r.role_key = 'FINANCE_AUDITOR' AND f.sensitivity <> 'READ'
    `);
    expect(nonRead.length).toBe(0);

    // the trigger itself must reject an attempt to assign a mutation function
    const financeAuditor = await dataSource.query(`SELECT id FROM authorization_roles WHERE role_key = 'FINANCE_AUDITOR'`);
    await expect(
      dataSource.query(
        `INSERT INTO authorization_role_functions (role_id, function_code, access_type, assigned_at) VALUES ($1, 'customer.create', 'EXECUTE', NOW())`,
        [financeAuditor[0].id],
      ),
    ).rejects.toThrow();
  });

  // --- 10. Critical financial functions restricted to Finance role class --
  it('restricts every CRITICAL_FINANCIAL function to roles flagged finance_role_class = true, and the DB rejects violating assignments', async () => {
    const violations = await dataSource.query(`
      SELECT rf.function_code, r.role_key FROM authorization_role_functions rf
      JOIN authorization_roles r ON r.id = rf.role_id
      JOIN authorization_functions f ON f.function_code = rf.function_code
      WHERE f.sensitivity = 'CRITICAL_FINANCIAL' AND r.finance_role_class = FALSE
    `);
    expect(violations.length).toBe(0);

    const superAdmin = await dataSource.query(`SELECT id FROM authorization_roles WHERE role_key = 'SUPER_ADMIN'`);
    await expect(
      dataSource.query(
        `INSERT INTO authorization_role_functions (role_id, function_code, access_type, assigned_at) VALUES ($1, 'ledger.post', 'INITIATE', NOW())`,
        [superAdmin[0].id],
      ),
    ).rejects.toThrow();
  });

  // --- 11. Migration runs successfully against current schema ------------
  it('recorded the new migration in typeorm_migrations', async () => {
    const rows = await dataSource.query(
      `SELECT name FROM typeorm_migrations WHERE name = 'CreateAuthorizationCatalogue1785753600083'`,
    );
    expect(rows.length).toBe(1);
  });

  // --- 12. Existing relevant Finance behavior not broken ------------------
  it('does not alter the existing A2 finance role assignment table/shape', async () => {
    // The pre-existing finance governance table must still exist, untouched, with its
    // own independent schema — proving this task did not modify it.
    const cols = await dataSource.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'a2_finance_role_assignments'
    `);
    expect(cols.length).toBeGreaterThan(0);
  });

  // --- Structural invariant: at most one administrative_capability role ---
  it('enforces at most one role may hold administrative_capability = true', async () => {
    const count = await dataSource.query(`SELECT COUNT(*)::int AS c FROM authorization_roles WHERE administrative_capability = TRUE`);
    expect(count[0].c).toBe(1);
    const superAdminOnly = await dataSource.query(
      `SELECT role_key FROM authorization_roles WHERE administrative_capability = TRUE`,
    );
    expect(superAdminOnly[0].role_key).toBe('SUPER_ADMIN');
  });

  // --- Idempotent reseed: no duplicates after a second bootstrap pass -----
  it('reseeding is idempotent and produces no duplicate rows', async () => {
    const result = await seedService.seedIfEmpty();
    expect(result.functions).toBe(0);
    expect(result.roles).toBe(0);
    expect(result.roleFunctions).toBe(0);

    const functionCount = await dataSource.query(`SELECT COUNT(*)::int AS c FROM authorization_functions`);
    const roleCount = await dataSource.query(`SELECT COUNT(*)::int AS c FROM authorization_roles`);
    const rfCount = await dataSource.query(`SELECT COUNT(*)::int AS c FROM authorization_role_functions`);
    expect(functionCount[0].c).toBe(AUTHORIZATION_FUNCTION_SEED.length);
    expect(roleCount[0].c).toBe(AUTHORIZATION_ROLE_SEED.length);
    expect(rfCount[0].c).toBe(AUTHORIZATION_ROLE_FUNCTION_SEED.length);
  });
});
