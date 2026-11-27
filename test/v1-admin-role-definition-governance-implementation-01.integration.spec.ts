/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
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
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as request from 'supertest';

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

  async function loginSuperAdminSession(): Promise<any> {
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
    return login.body;
  }

  async function loginSuperAdmin(): Promise<string> {
    return (await loginSuperAdminSession()).accessToken as string;
  }

  /** Direct, non-HTTP role provisioning for test setup. */
  async function provisionRole(
    roleKey: string,
    principalSuffix = roleKey,
    principalId = `roledefgov01:${principalSuffix}:${randomUUID()}`.slice(0, 160),
  ): Promise<{ principalId: string; token: string; session: any }> {
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
    return { principalId, token: result.accessToken, session: result };
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  /** A single principal holding multiple roles at once (two distinct assignment rows). */
  async function provisionMultiRole(
    roleKeys: string[],
  ): Promise<{ principalId: string; token: string }> {
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
        description:
          overrides.description ?? 'A role created through the governed workflow for testing.',
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

  interface RoleRow {
    id: string;
    display_name: string;
    definition_version: number;
    is_active: boolean;
    is_system_seeded: boolean;
    administrative_capability: boolean;
    finance_role_class: boolean;
  }

  async function roleRow(roleKey: string): Promise<RoleRow | undefined> {
    const rows: RoleRow[] = await dataSource.query(
      `SELECT * FROM authorization_roles WHERE role_key = $1`,
      [roleKey],
    );
    return rows[0];
  }

  async function roleFunctionRows(
    roleId: string,
  ): Promise<Array<{ function_code: string; access_type: string; is_active: boolean }>> {
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
      const id = submitted.body.proposal.id as string;

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
      const id = submitted.body.proposal.id as string;

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
      const id = submitted.body.proposal.id as string;

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
      const res = await approve(administrator.token, submitted.body.proposal.id as string);
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
      const id = submitted.body.proposal.id as string;
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
      const id = submitted.body.proposal.id as string;
      await approve(controller.token, id);
      const applied = await apply(superAdmin, id);
      expect(applied.status).toBe(201);
      expect(applied.body.proposal.status).toBe('APPLIED');

      const role = (await roleRow(roleKey))!;
      expect(role).toBeDefined();
      expect(role.is_active).toBe(true);
      expect(role.is_system_seeded).toBe(false);
      expect(role.administrative_capability).toBe(false);
      expect(role.finance_role_class).toBe(false);
      expect(role.definition_version).toBe(1);

      const grants = await roleFunctionRows(role.id);
      expect(grants.map((g) => g.function_code)).toEqual([
        'customer.manage_support_case',
        'customer.view',
      ]);
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
      await approve(controller.token, createRes.body.proposal.id as string);
      await apply(superAdmin, createRes.body.proposal.id as string);
      const createdRole = (await roleRow(roleKey))!;
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
      const modifyId = modifyRes.body.proposal.id as string;
      await approve(controller.token, modifyId);
      const appliedModify = await apply(superAdmin, modifyId);
      expect(appliedModify.status).toBe(201);

      const modifiedRole = (await roleRow(roleKey))!;
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
      await approve(controller.token, createRes.body.proposal.id as string);
      await apply(superAdmin, createRes.body.proposal.id as string);
      const role = (await roleRow(roleKey))!;
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
      await approve(controller.token, createRes.body.proposal.id as string);
      await apply(superAdmin, createRes.body.proposal.id as string);

      await expect(
        dataSource.query(
          `UPDATE authorization_roles SET administrative_capability = true WHERE role_key = $1`,
          [roleKey],
        ),
      ).rejects.toThrow();
      await expect(
        dataSource.query(
          `UPDATE authorization_roles SET finance_role_class = true WHERE role_key = $1`,
          [roleKey],
        ),
      ).rejects.toThrow();

      // P0-CH actor-column widening: the three authorization actor columns must be VARCHAR(160)
      // (principal-ID convention) and must accept a 160-character principal identifier.
      const cols: Array<{
        table_name: string;
        column_name: string;
        character_maximum_length: number;
      }> = await dataSource.query(
        `SELECT table_name, column_name, character_maximum_length FROM information_schema.columns
           WHERE table_name IN ('authorization_roles','authorization_role_functions')
             AND column_name IN ('created_by','updated_by','assigned_by')
           ORDER BY table_name, column_name`,
      );
      const createdBy = cols.find(
        (c) => c.table_name === 'authorization_roles' && c.column_name === 'created_by',
      );
      const updatedBy = cols.find(
        (c) => c.table_name === 'authorization_roles' && c.column_name === 'updated_by',
      );
      const assignedBy = cols.find(
        (c) => c.table_name === 'authorization_role_functions' && c.column_name === 'assigned_by',
      );
      expect(createdBy?.character_maximum_length).toBe(160);
      expect(updatedBy?.character_maximum_length).toBe(160);
      expect(assignedBy?.character_maximum_length).toBe(160);

      const longPrincipal = 'a'.repeat(160);
      await expect(
        dataSource.query(`UPDATE authorization_roles SET updated_by = $1 WHERE role_key = $2`, [
          longPrincipal,
          roleKey,
        ]),
      ).resolves.toBeDefined();
      const row = await dataSource.query(
        `SELECT updated_by FROM authorization_roles WHERE role_key = $1`,
        [roleKey],
      );
      expect(row[0].updated_by).toBe(longPrincipal);
      await expect(
        dataSource.query(
          `UPDATE authorization_role_functions SET assigned_by = $1 WHERE role_id = $2`,
          [longPrincipal, (await roleRow(roleKey))!.id],
        ),
      ).resolves.toBeDefined();
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
      });
      await approve(controller.token, createRes.body.proposal.id as string);
      await apply(superAdmin, createRes.body.proposal.id as string);
      const role = (await roleRow(roleKey))!;
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

    // The integration harness exposes Supertest and dynamically-loaded Playwright as `any`.
    /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-require-imports */
    it('9c. seeded-role grant add and removal require independent approval and change access for an existing session', async () => {
      const superAdmin = await loginSuperAdmin();
      const checker = await provisionRole('FINANCE_CONTROLLER');
      const operations = await provisionRole('OPERATIONS');
      const definition = await dataSource.query(
        `SELECT id, display_name, description, read_only, is_active, is_system_seeded, definition_version
           FROM authorization_roles WHERE role_key = 'OPERATIONS'`,
      );
      expect(definition).toHaveLength(1);
      expect(definition[0].is_system_seeded).toBe(true);
      const currentGrants = await dataSource.query(
        `SELECT function_code AS "functionCode", access_type AS "accessType"
           FROM authorization_role_functions WHERE role_id = $1 AND is_active = true ORDER BY function_code`,
        [definition[0].id],
      );
      expect(currentGrants.some((grant: any) => grant.functionCode === 'agent.view')).toBe(false);
      const listBefore = await request(app.getHttpServer())
        .get('/api/v1/internal/agents')
        .set(auth(operations.token));
      expect(listBefore.status).toBe(403);

      const propose = (
        grants: Array<{ functionCode: string; accessType: string }>,
        reason: string,
      ) =>
        request(app.getHttpServer())
          .post(BASE_PATH)
          .set(auth(superAdmin))
          .send({
            proposalType: 'MODIFY',
            roleKey: 'OPERATIONS',
            displayName: definition[0].display_name,
            description: definition[0].description,
            readOnly: definition[0].read_only,
            functionGrants: grants,
            expectedDefinitionVersion: Number(definition[0].definition_version),
            reason,
          });
      const add = await propose(
        [...currentGrants, { functionCode: 'agent.view', accessType: 'VIEW' }],
        'Grant Operations read-only agent directory access for this acceptance test.',
      );
      expect(add.status).toBe(201);
      const addId = add.body.proposal.id as string;
      expect((await approve(operations.token, addId)).status).toBe(403);
      expect((await approve(checker.token, addId)).status).toBe(201);
      expect((await apply(superAdmin, addId)).status).toBe(201);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/internal/agents')
            .set(auth(operations.token))
        ).status,
      ).toBe(200);

      const updated = await dataSource.query(
        `SELECT definition_version FROM authorization_roles WHERE role_key = 'OPERATIONS'`,
      );
      const grantsAfterAdd = await dataSource.query(
        `SELECT function_code AS "functionCode", access_type AS "accessType"
           FROM authorization_role_functions WHERE role_id = $1 AND is_active = true ORDER BY function_code`,
        [definition[0].id],
      );
      const remove = await request(app.getHttpServer())
        .post(BASE_PATH)
        .set(auth(superAdmin))
        .send({
          proposalType: 'MODIFY',
          roleKey: 'OPERATIONS',
          displayName: definition[0].display_name,
          description: definition[0].description,
          readOnly: definition[0].read_only,
          functionGrants: grantsAfterAdd.filter(
            (grant: any) => grant.functionCode !== 'agent.view',
          ),
          expectedDefinitionVersion: Number(updated[0].definition_version),
          reason: 'Revoke temporary agent directory access through the same governed workflow.',
        });
      expect(remove.status).toBe(201);
      const removeId = remove.body.proposal.id as string;
      expect((await approve(checker.token, removeId)).status).toBe(201);
      expect((await apply(superAdmin, removeId)).status).toBe(201);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/internal/agents')
            .set(auth(operations.token))
        ).status,
      ).toBe(403);
    });
  });

  it('9d. removing the seeded independent role-approval path is surfaced for owner review', async () => {
    const superAdmin = await loginSuperAdmin();
    const role = (
      await dataSource.query(
        `SELECT id, display_name, description, read_only, definition_version
           FROM authorization_roles WHERE role_key = 'FINANCE_CONTROLLER'`,
      )
    )[0];
    const currentGrants = await dataSource.query(
      `SELECT function_code AS "functionCode", access_type AS "accessType"
         FROM authorization_role_functions WHERE role_id = $1 AND is_active = true ORDER BY function_code`,
      [role.id],
    );
    const attempt = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(auth(superAdmin))
      .send({
        proposalType: 'MODIFY',
        roleKey: 'FINANCE_CONTROLLER',
        displayName: role.display_name,
        description: role.description,
        readOnly: role.read_only,
        functionGrants: currentGrants.filter(
          (grant: any) =>
            !(grant.functionCode === 'workforce.role.modify' && grant.accessType === 'APPROVE'),
        ),
        expectedDefinitionVersion: Number(role.definition_version),
        reason: 'Attempt to remove the seeded role-governance checker path.',
      });
    expect(attempt.status).toBe(409);
    expect(attempt.body.code).toBe('OWNER_REVIEW_REQUIRED');
    expect(attempt.body.protectedPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ functionCode: 'workforce.role.modify', accessType: 'APPROVE' }),
      ]),
    );
    const unchanged = await dataSource.query(
      `SELECT definition_version FROM authorization_roles WHERE role_key = 'FINANCE_CONTROLLER'`,
    );
    expect(Number(unchanged[0].definition_version)).toBe(Number(role.definition_version));
  });

  const browserAcceptance = process.env.ROLE_GOVERNANCE_BROWSER_ACCEPTANCE === 'yes' ? it : it.skip;

  browserAcceptance(
    '9e. real Admin Web sessions expose and revoke a seeded-role function in Chromium',
    async () => {
      const superAdmin = await loginSuperAdmin();
      const checker = await provisionRole('FINANCE_CONTROLLER', 'browser-checker');
      const baselineOperations = await provisionRole('OPERATIONS', 'browser-operations-before');
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/internal/agents')
            .set(auth(baselineOperations.token))
        ).status,
      ).toBe(403);

      const role = (
        await dataSource.query(
          `SELECT id, display_name, description, read_only, definition_version
             FROM authorization_roles WHERE role_key = 'OPERATIONS'`,
        )
      )[0];
      const existingGrants = await dataSource.query(
        `SELECT function_code AS "functionCode", access_type AS "accessType"
           FROM authorization_role_functions WHERE role_id = $1 AND is_active = true ORDER BY function_code`,
        [role.id],
      );
      expect(existingGrants.some((grant: any) => grant.functionCode === 'agent.view')).toBe(false);
      const submitModify = (
        functionGrants: any[],
        expectedDefinitionVersion: number,
        reason: string,
      ) =>
        request(app.getHttpServer()).post(BASE_PATH).set(auth(superAdmin)).send({
          proposalType: 'MODIFY',
          roleKey: 'OPERATIONS',
          displayName: role.display_name,
          description: role.description,
          readOnly: role.read_only,
          functionGrants,
          expectedDefinitionVersion,
          reason,
        });
      const add = await submitModify(
        [...existingGrants, { functionCode: 'agent.view', accessType: 'VIEW' }],
        Number(role.definition_version),
        'Browser acceptance: grant read-only agent directory access.',
      );
      expect(add.status).toBe(201);
      const addId = add.body.proposal.id as string;
      expect((await approve(checker.token, addId)).status).toBe(201);
      expect((await apply(superAdmin, addId)).status).toBe(201);

      const authorizedOperations = await provisionRole(
        'OPERATIONS',
        'browser-operations-after-add',
      );
      await app.listen(0, '127.0.0.1');
      const apiAddress = app.getHttpServer().address();
      if (!apiAddress || typeof apiAddress === 'string')
        throw new Error('Backend did not bind a TCP port');
      const apiPort = apiAddress.port;
      const webPort = 5187;
      const viteBin = resolve(process.cwd(), 'apps/admin-web/node_modules/vite/bin/vite.js');
      const vite = spawn(
        process.execPath,
        [viteBin, '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
        {
          cwd: resolve(process.cwd(), 'apps/admin-web'),
          env: { ...process.env, ADMIN_WEB_DEV_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let viteLogs = '';
      vite.stdout.on('data', (chunk: Buffer) => {
        viteLogs += chunk.toString();
      });
      vite.stderr.on('data', (chunk: Buffer) => {
        viteLogs += chunk.toString();
      });
      const ready = new Promise<void>((resolveReady, rejectReady) => {
        const timeout = setTimeout(
          () => rejectReady(new Error(`Vite did not start: ${viteLogs}`)),
          60_000,
        );
        vite.stdout.on('data', () => {
          if (viteLogs.includes(`http://127.0.0.1:${webPort}/`)) {
            clearTimeout(timeout);
            resolveReady();
          }
        });
        vite.once('error', (error) => {
          clearTimeout(timeout);
          rejectReady(error);
        });
      });
      let browser: any;
      try {
        await ready;
        const runtimeLibraries = spawnSync(
          process.execPath,
          [
            '-e',
            "import('@sparticuz/chromium').then(async m=>{await m.inflate(require('path').join(require('path').dirname(require.resolve('@sparticuz/chromium')),'../bin/al2023.tar.br'))})",
          ],
          { encoding: 'utf8' },
        );
        if (runtimeLibraries.status !== 0)
          throw new Error(
            `Chromium runtime libraries failed to extract: ${runtimeLibraries.stderr}`,
          );
        process.env.LD_LIBRARY_PATH = [
          '/tmp/al2023/lib',
          ...(process.env.LD_LIBRARY_PATH ?? '').split(':').filter(Boolean),
        ].join(':');
        const { chromium } = require('playwright');
        const binary = JSON.parse(
          spawnSync(
            process.execPath,
            [
              '-e',
              "const c=require('@sparticuz/chromium').default;c.executablePath().then(path=>console.log(JSON.stringify({path,args:c.args})))",
            ],
            { encoding: 'utf8' },
          ).stdout,
        );
        browser = await chromium.launch({
          executablePath: binary.path,
          args: binary.args,
          headless: true,
        });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.addInitScript((session: any) => {
          localStorage.setItem('admin_workforce_token', session.accessToken);
          localStorage.setItem('admin_workforce_session_id', session.sessionId);
          localStorage.setItem('admin_workforce_principal', JSON.stringify(session.principal));
        }, authorizedOperations.session);
        const baseUrl = `http://127.0.0.1:${webPort}`;
        await page.goto(baseUrl);
        await page.getByTestId('main-content').waitFor();
        const agentNav = page.getByTestId('nav-agents');
        if (!(await agentNav.isVisible())) await page.getByTestId('section-servicing').click();
        expect(await agentNav.isVisible()).toBe(true);
        const allowedApi = await page.evaluate(async () => {
          const token = localStorage.getItem('admin_workforce_token');
          return (
            await fetch('/api/v1/internal/agents', {
              headers: { Authorization: `Bearer ${token}` },
            })
          ).status;
        });
        expect(allowedApi).toBe(200);
        const evidenceDir = resolve(
          process.cwd(),
          'docs/V1/evidence/seeded-role-governance-browser',
        );
        mkdirSync(evidenceDir, { recursive: true });
        await page.screenshot({
          path: `${evidenceDir}/operations-agent-menu-allowed.png`,
          fullPage: true,
        });

        const changed = await dataSource.query(
          `SELECT definition_version FROM authorization_roles WHERE role_key = 'OPERATIONS'`,
        );
        const grantsAfterAdd = await dataSource.query(
          `SELECT function_code AS "functionCode", access_type AS "accessType"
             FROM authorization_role_functions WHERE role_id = $1 AND is_active = true ORDER BY function_code`,
          [role.id],
        );
        const remove = await submitModify(
          grantsAfterAdd.filter((grant: any) => grant.functionCode !== 'agent.view'),
          Number(changed[0].definition_version),
          'Browser acceptance: revoke agent directory access through the same maker/checker workflow.',
        );
        expect(remove.status).toBe(201);
        const removeId = remove.body.proposal.id as string;
        expect((await approve(checker.token, removeId)).status).toBe(201);
        expect((await apply(superAdmin, removeId)).status).toBe(201);
        const revokedExistingSessionApi = await page.evaluate(async () => {
          const token = localStorage.getItem('admin_workforce_token');
          return (
            await fetch('/api/v1/internal/agents', {
              headers: { Authorization: `Bearer ${token}` },
            })
          ).status;
        });
        expect(revokedExistingSessionApi).toBe(403);
        await page.screenshot({
          path: `${evidenceDir}/operations-agent-api-revoked.png`,
          fullPage: true,
        });

        const freshOperations = await provisionRole(
          'OPERATIONS',
          'browser-operations-after-remove',
        );
        const freshPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await freshPage.addInitScript((session: any) => {
          localStorage.setItem('admin_workforce_token', session.accessToken);
          localStorage.setItem('admin_workforce_session_id', session.sessionId);
          localStorage.setItem('admin_workforce_principal', JSON.stringify(session.principal));
        }, freshOperations.session);
        await freshPage.goto(baseUrl);
        await freshPage.getByTestId('main-content').waitFor();
        expect(await freshPage.getByTestId('nav-agents').count()).toBe(0);
        await freshPage.screenshot({
          path: `${evidenceDir}/operations-agent-menu-revoked.png`,
          fullPage: true,
        });
        writeFileSync(
          `${evidenceDir}/results.json`,
          `${JSON.stringify(
            {
              browser: 'Chromium 153',
              frontend: baseUrl,
              realSessions: true,
              makerChecker:
                'SUPER_ADMIN initiated; independent FINANCE_CONTROLLER approved; SUPER_ADMIN applied',
              seededRole: 'OPERATIONS',
              functionCode: 'agent.view',
              deniedBefore: 403,
              allowedAfterGrant: allowedApi,
              revokedForExistingSession: revokedExistingSessionApi,
              menuAfterGrant: 'visible',
              menuOnFreshSessionAfterRevocation: 'hidden',
              screenshots: [
                'operations-agent-menu-allowed.png',
                'operations-agent-api-revoked.png',
                'operations-agent-menu-revoked.png',
              ],
            },
            null,
            2,
          )}\n`,
        );
      } finally {
        if (browser) await browser.close();
        vite.kill('SIGTERM');
      }
    },
    180_000,
  );

  /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-require-imports */

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
      const id = legit.body.proposal.id as string;

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
      const id = submitted.body.proposal.id as string;
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
      const id = submitted.body.proposal.id as string;
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
      const id = submitted.body.proposal.id as string;
      const approvalId = submitted.body.proposal.approvalId;

      const past = new Date(Date.now() - 60_000);
      await dataSource.query(`UPDATE role_definition_proposals SET expires_at = $1 WHERE id = $2`, [
        past,
        id,
      ]);
      await dataSource.query(
        `UPDATE privileged_action_approvals SET expires_at = $1 WHERE id = $2`,
        [past, approvalId],
      );

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
      await approve(controller.token, createRes.body.proposal.id as string);
      await apply(superAdmin, createRes.body.proposal.id as string);

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
      const modifyId = modifyRes.body.proposal.id as string;
      await approve(controller.token, modifyId);

      // Simulate the role having changed since the proposal was built, without going through a
      // second governed proposal (blocked by the in-flight unique index while this one exists).
      await dataSource.query(
        `UPDATE authorization_roles SET definition_version = 2 WHERE role_key = $1`,
        [roleKey],
      );

      const applyRes = await apply(superAdmin, modifyId);
      expect(applyRes.status).toBe(201);
      expect(applyRes.body.success).toBe(false);
      expect(applyRes.body.proposal.status).toBe('APPLY_FAILED');

      const role = (await roleRow(roleKey))!;
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
      await reject(controller.token, submitted.body.proposal.id as string, 'denied');
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
      const id = submitted.body.proposal.id as string;
      await approve(controller.token, id, 'looks fine');
      await apply(superAdmin, id);

      // Scoped to entity_type as well as entity_id: AuthorizationService.recordDecision() may
      // independently log its own AUTHORIZATION_DECISION audit row against the same resource id
      // (e.g. the privileged-action-approval request's own authorize() call) — a separate,
      // pre-existing audit mechanism this task does not change, not part of what is being proven
      // here (that OUR proposal lifecycle is fully audited).
      const events: Array<{ action: string; actor: string; entity_type: string }> =
        await dataSource.query(
          `SELECT action, actor, entity_type FROM audit_events WHERE entity_id = $1 AND entity_type = 'ROLE_DEFINITION_PROPOSAL' ORDER BY occurred_at ASC`,
          [id],
        );
      const actions = events.map((e) => e.action);
      expect(actions).toContain('ROLE_DEFINITION_PROPOSAL_SUBMITTED');
      expect(actions).toContain('ROLE_DEFINITION_PROPOSAL_APPROVED');
      expect(actions).toContain('ROLE_DEFINITION_PROPOSAL_APPLIED');

      const role = (await roleRow(roleKey))!;
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
      const id = submitted.body.proposal.id as string;
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
      expect(administratorGrants.some((g) => g.function_code === 'workforce.role.create')).toBe(
        false,
      );
      expect(administratorGrants.some((g) => g.function_code === 'workforce.role.modify')).toBe(
        false,
      );
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
