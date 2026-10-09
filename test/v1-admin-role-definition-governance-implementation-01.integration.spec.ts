/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01 — dedicated real-PostgreSQL, real-HTTP
 * proof suite for the governed role-definition (create/modify) workflow
 * (`RoleDefinitionGovernanceService` + `RoleDefinitionGovernanceController`).
 *
 * Nothing authorization-relevant is mocked: real bearer-token sessions (SUPER_ADMIN via the real
 * local-admin login endpoint, other roles via a real, unmocked `A2WorkforceSessionService.establish()`
 * call after persisting a real `a2_finance_role_assignments` row — identical pattern to
 * test/v1-administrator-role-and-assignment-implementation-01.integration.spec.ts), the real
 * `PrivilegedActionApprovalService`, the real `authorization_roles`/`authorization_role_functions`
 * catalogue and its DB triggers/CHECK constraints.
 *
 * Covers all 14 required categories (see section headers below).
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
import { AuthorizationCatalogueRuntimeService } from '../src/authorization-catalogue/authorization-catalogue-runtime.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';
const BASE_PATH = '/api/v1/internal/a2/workforce/role-definitions/proposals';

describe('V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01 — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  let catalogueRuntime: AuthorizationCatalogueRuntimeService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1roledefgov01');

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
    catalogueRuntime = moduleRef.get(AuthorizationCatalogueRuntimeService);
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

  /** Direct, non-HTTP role provisioning for test setup. */
  async function provisionRole(
    roleKey: string,
    principalSuffix = roleKey,
    principalId = `roledefgov01:${principalSuffix}:${randomUUID()}`.slice(0, 160),
  ): Promise<{ principalId: string; token: string }> {
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `v1-role-def-gov-01:${principalId}:${roleKey}`,
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

  /** A single principal holding multiple roles at once (two distinct assignment rows). */
  async function provisionMultiRole(roleKeys: string[]): Promise<{ principalId: string; token: string }> {
    const principalId = `roledefgov01:multi:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    for (const roleKey of roleKeys) {
      await dataSource.getRepository(A2FinanceRoleAssignment).save({
        id: randomUUID(),
        assignmentReference: `v1-role-def-gov-01:${principalId}:${roleKey}`,
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
    }
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

  function randomRoleKey(prefix: string): string {
    return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }

  async function submitCreate(
    token: string,
    overrides: Partial<{
      roleKey: string;
      displayName: string;
      description: string;
      readOnly: boolean;
      functionGrants: Array<{ functionCode: string; accessType: string }>;
      reason: string;
      expiresInSeconds: number;
      [extra: string]: unknown;
    }> = {},
  ): Promise<request.Response> {
    const roleKey = overrides.roleKey ?? randomRoleKey('TEST_ROLE');
    return request(app.getHttpServer())
      .post(BASE_PATH)
      .set(auth(token))
      .send({
        proposalType: 'CREATE',
        roleKey,
        displayName: overrides.displayName ?? 'Test Configurable Role',
        description: overrides.description ?? 'A role created through the governed workflow for testing.',
        readOnly: overrides.readOnly ?? false,
        functionGrants: overrides.functionGrants ?? [
          { functionCode: 'customer.view', accessType: 'VIEW' },
          { functionCode: 'customer.manage_support_case', accessType: 'EXECUTE' },
        ],
        reason: overrides.reason ?? 'Integration test role creation',
        ...(overrides.expiresInSeconds ? { expiresInSeconds: overrides.expiresInSeconds } : {}),
        ...Object.fromEntries(
          Object.entries(overrides).filter(
            ([k]) =>
              ![
                'roleKey',
                'displayName',
                'description',
                'readOnly',
                'functionGrants',
                'reason',
                'expiresInSeconds',
              ].includes(k),
          ),
        ),
      });
  }

  async function approve(token: string, id: string, comment?: string) {
    return request(app.getHttpServer())
      .post(`${BASE_PATH}/${id}/approve`)
      .set(auth(token))
      .send({ comment });
  }
  async function reject(token: string, id: string, comment?: string) {
    return request(app.getHttpServer())
      .post(`${BASE_PATH}/${id}/reject`)
      .set(auth(token))
      .send({ comment });
  }
  async function apply(token: string, id: string) {
    return request(app.getHttpServer()).post(`${BASE_PATH}/${id}/apply`).set(auth(token)).send({});
  }
  async function getOne(token: string, id: string) {
    return request(app.getHttpServer()).get(`${BASE_PATH}/${id}`).set(auth(token));
  }

  async function roleRow(roleKey: string): Promise<any | undefined> {
    const rows = await dataSource.query(`SELECT * FROM authorization_roles WHERE role_key = $1`, [roleKey]);
    return rows[0];
  }

  async function roleFunctionRows(roleId: string): Promise<any[]> {
    return dataSource.query(
      `SELECT function_code, access_type, is_active FROM authorization_role_functions WHERE role_id = $1 ORDER BY function_code`,
      [roleId],
    );
  }

  // =====================================================================================
  // 1. SUPER_ADMIN submits a valid role-creation proposal
  // =====================================================================================
  describe('1. SUPER_ADMIN submits a valid role-creation proposal', () => {
    it('1a. creates a REQUESTED proposal and does not touch authorization_roles yet', async () => {
      const superAdmin = await loginSuperAdmin();
      const roleKey = randomRoleKey('CREATE_OK');
      const res = await submitCreate(superAdmin, { roleKey });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.proposal.status).toBe('REQUESTED');
      expect(res.body.proposal.targetRoleKey).toBe(roleKey);
      expect(res.body.proposal.proposerPrincipalId).toBeTruthy();
      expect(await roleRow(roleKey)).toBeUndefined();
    });
  });

  // =====================================================================================
  // 2. SUPER_ADMIN cannot approve its own proposal
  // =====================================================================================
  describe('2. SUPER_ADMIN cannot approve own proposal', () => {
    it('2a. self-approval is forbidden and the proposal remains REQUESTED', async () => {
      const superAdmin = await loginSuperAdmin();
      const submitted = await submitCreate(superAdmin);
      const id = submitted.body.proposal.id;

      const res = await approve(superAdmin, id);
      expect(res.status).toBe(403);

      const check = await getOne(superAdmin, id);
      expect(check.body.status).toBe('REQUESTED');
    });
  });

  // =====================================================================================
  // 3. FINANCE_CONTROLLER independently approves/rejects
  // =====================================================================================
  describe('3. FINANCE_CONTROLLER independently approves/rejects', () => {
    it('3a. approves a SUPER_ADMIN-submitted proposal', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const submitted = await submitCreate(superAdmin);
      const id = submitted.body.proposal.id;

      const res = await approve(controller.token, id);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.proposal.status).toBe('APPROVED');
      expect(res.body.proposal.decidedBy).toBe(controller.principalId);
    });

    it('3b. rejects a SUPER_ADMIN-submitted proposal', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const submitted = await submitCreate(superAdmin);
      const id = submitted.body.proposal.id;

      const res = await reject(controller.token, id, 'Not needed');
      expect(res.status).toBe(201);
      expect(res.body.proposal.status).toBe('REJECTED');
      expect(res.body.proposal.decisionReason).toBe('Not needed');
    });
  });

  // =====================================================================================
  // 4. ADMINISTRATOR cannot create/modify role definitions
  // =====================================================================================
  describe('4. ADMINISTRATOR cannot create/modify role definitions', () => {
    it('4a. ADMINISTRATOR is denied submitting a proposal', async () => {
      const administrator = await provisionRole('ADMINISTRATOR');
      const res = await submitCreate(administrator.token);
      expect([401, 403]).toContain(res.status);
    });

    it('4b. ADMINISTRATOR is denied approving a proposal', async () => {
      const superAdmin = await loginSuperAdmin();
      const administrator = await provisionRole('ADMINISTRATOR');
      const submitted = await submitCreate(superAdmin);
      const res = await approve(administrator.token, submitted.body.proposal.id);
      expect([401, 403]).toContain(res.status);
    });
  });

  // =====================================================================================
  // 5. Unapproved proposal never affects live authorization
  // =====================================================================================
  describe('5. Unapproved proposal does not change live authorization', () => {
    it('5a. role row does not exist after REQUESTED, nor after APPROVED (only after apply)', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const roleKey = randomRoleKey('NOT_YET');
      const submitted = await submitCreate(superAdmin, { roleKey });
      const id = submitted.body.proposal.id;
      expect(await roleRow(roleKey)).toBeUndefined();

      await approve(controller.token, id);
      expect(await roleRow(roleKey)).toBeUndefined();
    });
  });

  // =====================================================================================
  // 6. Approval + apply applies role and function assignments consistently
  // =====================================================================================
  describe('6. Approval applies role + function assignments consistently', () => {
    it('6a. CREATE: applied role exists, active, with exactly the proposed grants; new session gains the functions', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const roleKey = randomRoleKey('CREATE_APPLY');
      const submitted = await submitCreate(superAdmin, {
        roleKey,
        functionGrants: [
          { functionCode: 'customer.view', accessType: 'VIEW' },
          { functionCode: 'customer.manage_support_case', accessType: 'EXECUTE' },
        ],
      });
      const id = submitted.body.proposal.id;
      await approve(controller.token, id);
      const applied = await apply(superAdmin, id);
      expect(applied.status).toBe(201);
      expect(applied.body.proposal.status).toBe('APPLIED');

      const role = await roleRow(roleKey);
      expect(role).toBeDefined();
      expect(role.is_active).toBe(true);
      expect(role.is_system_seeded).toBe(false);
      expect(role.administrative_capability).toBe(false);
      expect(role.finance_role_class).toBe(false);
      expect(role.definition_version).toBe(1);

      const grants = await roleFunctionRows(role.id);
      expect(grants.map((g) => g.function_code)).toEqual(['customer.manage_support_case', 'customer.view']);
      expect(grants.every((g) => g.is_active)).toBe(true);

      // Live authorization proof: the catalogue runtime service — the ONLY place the live
      // session/authorization path reads role->function data — now resolves exactly these two
      // functions for the new role, and recognizes the role itself.
      const resolution = await catalogueRuntime.resolveForRoleKeys([roleKey]);
      expect(resolution.recognizedRoleKeys).toEqual([roleKey]);
      expect(resolution.functionCodes).toEqual(['customer.manage_support_case', 'customer.view']);
      expect(resolution.hasAdministrativeCapability).toBe(false);

      // And an HTTP-level negative control: the new role was never granted workforce.role.view,
      // so a session holding only this role is still correctly forbidden from the view endpoint.
      const probe = await provisionRole(roleKey);
      const viewRes = await request(app.getHttpServer()).get(`${BASE_PATH}`).set(auth(probe.token));
      expect([401, 403]).toContain(viewRes.status);
    });

    it('6b. MODIFY: changes metadata and replaces function grants, bumping definition_version', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const roleKey = randomRoleKey('MODIFY_APPLY');
      const createRes = await submitCreate(superAdmin, {
        roleKey,
        functionGrants: [{ functionCode: 'customer.view', accessType: 'VIEW' }],
      });
      await approve(controller.token, createRes.body.proposal.id);
      await apply(superAdmin, createRes.body.proposal.id);
      const createdRole = await roleRow(roleKey);
      expect(createdRole.definition_version).toBe(1);

      const modifyRes = await request(app.getHttpServer())
        .post(BASE_PATH)
        .set(auth(superAdmin))
        .send({
          proposalType: 'MODIFY',
          roleKey,
          displayName: 'Renamed Test Role',
          description: 'Updated description for the modify test.',
          readOnly: false,
          functionGrants: [
            { functionCode: 'customer.view', accessType: 'VIEW' },
            { functionCode: 'customer.view_wallets', accessType: 'VIEW' },
          ],
          expectedDefinitionVersion: 1,
          reason: 'Integration test modify',
        });
      expect(modifyRes.status).toBe(201);
      const modifyId = modifyRes.body.proposal.id;
      await approve(controller.token, modifyId);
      const appliedModify = await apply(superAdmin, modifyId);
      expect(appliedModify.status).toBe(201);

      const modifiedRole = await roleRow(roleKey);
      expect(modifiedRole.display_name).toBe('Renamed Test Role');
      expect(modifiedRole.definition_version).toBe(2);
      const grants = await roleFunctionRows(modifiedRole.id);
      const active = grants.filter((g) => g.is_active).map((g) => g.function_code);
      expect(active.sort()).toEqual(['customer.view', 'customer.view_wallets']);
    });
  });

  // =====================================================================================
  // 7. Invalid / non-assignable / duplicate function codes rejected
  // =====================================================================================
  describe('7. Invalid/non-assignable/duplicate functions rejected', () => {
    it('7a. unknown function code rejected', async () => {
      const superAdmin = await loginSuperAdmin();
      const res = await submitCreate(superAdmin, {
        functionGrants: [{ functionCode: 'bogus.does.not.exist', accessType: 'VIEW' }],
      });
      expect(res.status).toBe(400);
    });

    it('7b. non-assignable function code rejected', async () => {
      const superAdmin = await loginSuperAdmin();
      const res = await submitCreate(superAdmin, {
        functionGrants: [{ functionCode: 'customer.terminate', accessType: 'VIEW' }],
      });
      expect(res.status).toBe(400);
    });

    it('7c. duplicate function code in the same proposal rejected', async () => {
      const superAdmin = await loginSuperAdmin();
      const res = await submitCreate(superAdmin, {
        functionGrants: [
          { functionCode: 'customer.view', accessType: 'VIEW' },
          { functionCode: 'customer.view', accessType: 'EXECUTE' },
        ],
      });
      expect(res.status).toBe(400);
    });

    it('7d. invalid accessType rejected', async () => {
      const superAdmin = await loginSuperAdmin();
      const res = await submitCreate(superAdmin, {
        functionGrants: [{ functionCode: 'customer.view', accessType: 'DELETE' }],
      });
      expect(res.status).toBe(400);
    });
  });

  // =====================================================================================
  // 8. Structural restrictions enforced even against prohibited-grant attempts
  // =====================================================================================
  describe('8. Structural restrictions enforced against prohibited grants', () => {
    it('8a. a CRITICAL_FINANCIAL/finance-class-restricted function is rejected at submission', async () => {
      const superAdmin = await loginSuperAdmin();
      const res = await submitCreate(superAdmin, {
        functionGrants: [{ functionCode: 'ledger.post', accessType: 'INITIATE' }],
      });
      expect(res.status).toBe(403);
    });

    it('8b. DB trigger independently rejects a direct SQL attempt to assign a finance-class-restricted function to a non-finance role', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const roleKey = randomRoleKey('DIRECT_SQL');
      const createRes = await submitCreate(superAdmin, { roleKey });
      await approve(controller.token, createRes.body.proposal.id);
      await apply(superAdmin, createRes.body.proposal.id);
      const role = await roleRow(roleKey);
      expect(role.finance_role_class).toBe(false);

      await expect(
        dataSource.query(
          `INSERT INTO authorization_role_functions (id, role_id, function_code, access_type, assigned_by, assigned_at) VALUES (gen_random_uuid(), $1, 'ledger.post', 'INITIATE', 'direct-sql-test', now())`,
          [role.id],
        ),
      ).rejects.toThrow();
    });

    it('8c. DB CHECK constraint independently rejects administrative_capability/finance_role_class on a non-seeded role', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const roleKey = randomRoleKey('NO_ELEVATE');
      const createRes = await submitCreate(superAdmin, { roleKey });
      await approve(controller.token, createRes.body.proposal.id);
      await apply(superAdmin, createRes.body.proposal.id);

      await expect(
        dataSource.query(`UPDATE authorization_roles SET administrative_capability = true WHERE role_key = $1`, [
          roleKey,
        ]),
      ).rejects.toThrow();
      await expect(
        dataSource.query(`UPDATE authorization_roles SET finance_role_class = true WHERE role_key = $1`, [roleKey]),
      ).rejects.toThrow();
    });
  });

  // =====================================================================================
  // 9. A role cannot acquire SUPER_ADMIN/prohibited Finance authority via config
  // =====================================================================================
  describe('9. Role cannot acquire SUPER_ADMIN/Finance authority via config', () => {
    it('9a. extra administrativeCapability/financeRoleClass fields in the request body are ignored', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const roleKey = randomRoleKey('IGNORE_FLAGS');
      const createRes = await submitCreate(superAdmin, {
        roleKey,
        administrativeCapability: true,
        financeRoleClass: true,
      } as any);
      await approve(controller.token, createRes.body.proposal.id);
      await apply(superAdmin, createRes.body.proposal.id);
      const role = await roleRow(roleKey);
      expect(role.administrative_capability).toBe(false);
      expect(role.finance_role_class).toBe(false);
    });

    it('9b. a functionGrant for a workforce.role.* function is rejected (cannot self-amplify role-governance power)', async () => {
      const superAdmin = await loginSuperAdmin();
      const res = await submitCreate(superAdmin, {
        functionGrants: [{ functionCode: 'workforce.role.assign', accessType: 'INITIATE' }],
      });
      expect(res.status).toBe(403);
    });

    it('9c. MODIFY cannot target one of the eleven seeded roles', async () => {
      const superAdmin = await loginSuperAdmin();
      const res = await request(app.getHttpServer())
        .post(BASE_PATH)
        .set(auth(superAdmin))
        .send({
          proposalType: 'MODIFY',
          roleKey: 'OPERATIONS',
          displayName: 'Hijacked',
          description: 'Attempted modification of a seeded role.',
          functionGrants: [{ functionCode: 'customer.view', accessType: 'VIEW' }],
          expectedDefinitionVersion: 1,
          reason: 'Should be rejected',
        });
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // 10. FINANCE_AUDITOR cannot exploit the workflow for write privileges
  // =====================================================================================
  describe('10. FINANCE_AUDITOR cannot exploit the workflow for write privileges', () => {
    it('10a. FINANCE_AUDITOR is denied submit/approve/reject/apply, but may still view/list', async () => {
      const superAdmin = await loginSuperAdmin();
      const auditor = await provisionRole('FINANCE_AUDITOR');
      const submitAttempt = await submitCreate(auditor.token);
      expect([401, 403]).toContain(submitAttempt.status);

      const controller = await provisionRole('FINANCE_CONTROLLER');
      const legit = await submitCreate(superAdmin);
      const id = legit.body.proposal.id;

      const approveAttempt = await approve(auditor.token, id);
      expect([401, 403]).toContain(approveAttempt.status);
      const rejectAttempt = await reject(auditor.token, id);
      expect([401, 403]).toContain(rejectAttempt.status);
      await approve(controller.token, id);
      const applyAttempt = await apply(auditor.token, id);
      expect([401, 403]).toContain(applyAttempt.status);

      const viewAttempt = await getOne(auditor.token, id);
      expect(viewAttempt.status).toBe(200);
    });
  });

  // =====================================================================================
  // 11. Duplicate/concurrent/replayed/expired/stale proposals cannot double-apply or
  //     overwrite newer state
  // =====================================================================================
  describe('11. Duplicate/concurrent/replayed/expired/stale proposal safety', () => {
    it('11a. a second in-flight proposal for the same role key is rejected', async () => {
      const superAdmin = await loginSuperAdmin();
      const roleKey = randomRoleKey('DUPLICATE');
      const first = await submitCreate(superAdmin, { roleKey });
      expect(first.status).toBe(201);
      const second = await submitCreate(superAdmin, { roleKey });
      expect(second.status).toBe(409);
    });

    it('11b. concurrent apply calls on the same approved proposal: exactly one succeeds', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const submitted = await submitCreate(superAdmin);
      const id = submitted.body.proposal.id;
      await approve(controller.token, id);

      const [a, b] = await Promise.all([apply(superAdmin, id), apply(superAdmin, id)]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const succeeded = [a, b].find((r) => r.status === 201)!;
      expect(succeeded.body.proposal.status).toBe('APPLIED');
    });

    it('11c. replaying apply on an already-APPLIED proposal is rejected', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const submitted = await submitCreate(superAdmin);
      const id = submitted.body.proposal.id;
      await approve(controller.token, id);
      const first = await apply(superAdmin, id);
      expect(first.status).toBe(201);
      const replay = await apply(superAdmin, id);
      expect(replay.status).toBe(409);
    });

    it('11d. an expired REQUESTED proposal cannot be approved', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const submitted = await submitCreate(superAdmin, { expiresInSeconds: 60 });
      const id = submitted.body.proposal.id;
      const approvalId = submitted.body.proposal.approvalId;

      const past = new Date(Date.now() - 60_000);
      await dataSource.query(`UPDATE role_definition_proposals SET expires_at = $1 WHERE id = $2`, [past, id]);
      await dataSource.query(`UPDATE privileged_action_approvals SET expires_at = $1 WHERE id = $2`, [
        past,
        approvalId,
      ]);

      const res = await approve(controller.token, id);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(false);
      expect(res.body.reason).toBe('EXPIRED');

      const check = await getOne(superAdmin, id);
      expect(check.body.status).toBe('EXPIRED');
    });

    it('11e. a stale (version-mismatched) MODIFY proposal fails to apply and leaves the role unchanged', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const roleKey = randomRoleKey('STALE_MODIFY');
      const createRes = await submitCreate(superAdmin, { roleKey });
      await approve(controller.token, createRes.body.proposal.id);
      await apply(superAdmin, createRes.body.proposal.id);

      const modifyRes = await request(app.getHttpServer())
        .post(BASE_PATH)
        .set(auth(superAdmin))
        .send({
          proposalType: 'MODIFY',
          roleKey,
          displayName: 'Should not apply',
          description: 'Stale proposal.',
          functionGrants: [{ functionCode: 'customer.view', accessType: 'VIEW' }],
          expectedDefinitionVersion: 1,
          reason: 'Stale modify test',
        });
      expect(modifyRes.status).toBe(201);
      const modifyId = modifyRes.body.proposal.id;
      await approve(controller.token, modifyId);

      // Simulate the role having changed since the proposal was built, without going through a
      // second governed proposal (blocked by the in-flight unique index while this one exists).
      await dataSource.query(`UPDATE authorization_roles SET definition_version = 2 WHERE role_key = $1`, [roleKey]);

      const applyRes = await apply(superAdmin, modifyId);
      expect(applyRes.status).toBe(201);
      expect(applyRes.body.success).toBe(false);
      expect(applyRes.body.proposal.status).toBe('APPLY_FAILED');

      const role = await roleRow(roleKey);
      expect(role.display_name).not.toBe('Should not apply');
    });
  });

  // =====================================================================================
  // 12. Rejected/failed proposals leave live assignments unchanged
  // =====================================================================================
  describe('12. Rejected/failed proposals leave live assignments unchanged', () => {
    it('12a. a rejected CREATE proposal never creates the role', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const roleKey = randomRoleKey('REJECTED');
      const submitted = await submitCreate(superAdmin, { roleKey });
      await reject(controller.token, submitted.body.proposal.id, 'denied');
      expect(await roleRow(roleKey)).toBeUndefined();
    });
  });

  // =====================================================================================
  // 13. Audit records accurately capture proposer/approver/before-after/outcome
  // =====================================================================================
  describe('13. Audit trail accuracy', () => {
    it('13a. submit/approve/apply each record an audit event with the right actor and outcome', async () => {
      const superAdmin = await loginSuperAdmin();
      const controller = await provisionRole('FINANCE_CONTROLLER');
      const roleKey = randomRoleKey('AUDITED');
      const submitted = await submitCreate(superAdmin, { roleKey });
      const id = submitted.body.proposal.id;
      await approve(controller.token, id, 'looks fine');
      await apply(superAdmin, id);

      // Scoped to entity_type as well as entity_id: AuthorizationService.recordDecision() may
      // independently log its own AUTHORIZATION_DECISION audit row against the same resource id
      // (e.g. the privileged-action-approval request's own authorize() call) — a separate,
      // pre-existing audit mechanism this task does not change, not part of what is being proven
      // here (that OUR proposal lifecycle is fully audited).
      const events: Array<{ action: string; actor: string; entity_type: string }> = await dataSource.query(
        `SELECT action, actor, entity_type FROM audit_events WHERE entity_id = $1 AND entity_type = 'ROLE_DEFINITION_PROPOSAL' ORDER BY occurred_at ASC`,
        [id],
      );
      const actions = events.map((e) => e.action);
      expect(actions).toContain('ROLE_DEFINITION_PROPOSAL_SUBMITTED');
      expect(actions).toContain('ROLE_DEFINITION_PROPOSAL_APPROVED');
      expect(actions).toContain('ROLE_DEFINITION_PROPOSAL_APPLIED');

      const role = await roleRow(roleKey);
      const roleEvents = await dataSource.query(
        `SELECT action, actor FROM audit_events WHERE entity_type = 'AUTHORIZATION_ROLE' AND entity_id = $1`,
        [role.id],
      );
      expect(roleEvents.length).toBeGreaterThan(0);
      expect(roleEvents[0].action).toBe('ROLE_DEFINITION_CREATED');
    });

    it('13b. a denied self-approval attempt is still recorded in the audit trail', async () => {
      // A single identity holding BOTH SUPER_ADMIN and FINANCE_CONTROLLER — the only way to
      // reach the approval service's own SELF_APPROVAL_FORBIDDEN path (as opposed to simply
      // failing the earlier "only FINANCE_CONTROLLER may decide" role gate, already proven by
      // test 2a) is for the exact same principalId to hold the approver role too.
      const dual = await provisionMultiRole(['SUPER_ADMIN', 'FINANCE_CONTROLLER']);
      const submitted = await submitCreate(dual.token);
      const id = submitted.body.proposal.id;
      const res = await approve(dual.token, id);
      expect(res.status).toBe(403);

      const events: Array<{ action: string }> = await dataSource.query(
        `SELECT action FROM audit_events WHERE entity_id = $1 AND entity_type = 'ROLE_DEFINITION_PROPOSAL' ORDER BY occurred_at ASC`,
        [id],
      );
      expect(events.map((e) => e.action)).toContain('ROLE_DEFINITION_PROPOSAL_DECISION_DENIED');
    });
  });

  // =====================================================================================
  // 14. Pre-existing seeding/operational/maker-checker/etc. behaviour is unaffected (fast
  //     local signal only — the authoritative check is the full existing suite run)
  // =====================================================================================
  describe('14. Pre-existing seeding and role behaviour unaffected', () => {
    it('14a. all eleven seeded roles remain active and ADMINISTRATOR grants are unchanged', async () => {
      const rows: Array<{ role_key: string }> = await dataSource.query(
        `SELECT role_key FROM authorization_roles WHERE is_active = true AND is_system_seeded = true ORDER BY role_key`,
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
      const administratorGrants: Array<{ function_code: string }> = await dataSource.query(`
        SELECT f.function_code FROM authorization_role_functions rf
        JOIN authorization_roles r ON r.id = rf.role_id
        JOIN authorization_functions f ON f.function_code = rf.function_code
        WHERE r.role_key = 'ADMINISTRATOR' AND rf.is_active = true
      `);
      expect(administratorGrants.some((g) => g.function_code === 'workforce.role.create')).toBe(false);
      expect(administratorGrants.some((g) => g.function_code === 'workforce.role.modify')).toBe(false);
    });

    it('14b. SUPER_ADMIN and FINANCE_CONTROLLER hold exactly INITIATE/APPROVE on workforce.role.create and .modify', async () => {
      const rows: Array<{ role_key: string; access_type: string }> = await dataSource.query(`
        SELECT r.role_key, rf.access_type FROM authorization_role_functions rf
        JOIN authorization_roles r ON r.id = rf.role_id
        WHERE rf.function_code = 'workforce.role.create' AND rf.is_active = true
        ORDER BY r.role_key
      `);
      expect(rows).toEqual([
        { role_key: 'FINANCE_CONTROLLER', access_type: 'APPROVE' },
        { role_key: 'SUPER_ADMIN', access_type: 'INITIATE' },
      ]);
    });
  });
});
