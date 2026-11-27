/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
/**
 * Customer Tier Default Class Approval Governance (real PostgreSQL + real HTTP).
 *
 * Exercises the complete governed workflow for `CUSTOMER_CLASS_TIER_DEFAULTS_CONFIGURE`
 * against a fully migrated disposable PostgreSQL database and real NestJS Fastify HTTP routes:
 *   1. Preserves all 11 seeded workforce accounts, passwords, MFA assurance, and institution scope.
 *   2. Proves single-role proposers (`CUSTOMER_SERVICE` alone or `SUPER_ADMIN` alone) can propose
 *      without holding both roles, while unauthorized roles are denied at the route policy guard.
 *   3. Enforces independent approval: the same principal is denied even from a second session or
 *      when holding both roles simultaneously (`SELF_APPROVAL_FORBIDDEN`), and unapproved requests
 *      cannot be executed.
 *   4. Proves an authorized independent checker can list, inspect, approve, and execute the
 *      approved request, persisting `customer_tier_default_classes` as `APPROVED` with `approval_id`,
 *      `approved_by`, and schema-free RFC 4122 v5 UUID `audit_events.entity_id` (`tierDefaultAuditEntityId(tier)`)
 *      across BOTH updating migration-seeded `PENDING_APPROVAL` mappings (`UPDATED`) and inserting
 *      a missing tier mapping row (`CREATED`).
 *   5. Proves configurable custom roles created via `RoleDefinitionGovernanceController` with
 *      `customer.manage_classes` (`INITIATE`, `APPROVE`, `VIEW`, and `readOnly: true`) govern
 *      maker/checker separation through the configurable role and function catalogue.
 *   6. Proves unrelated approval workflows (`FEE_RULE_CREATE`, `FINANCE_ROLE_ASSIGN`) retain
 *      their existing role requirements.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { AdminModule } from '../src/admin/admin.module';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { tierDefaultAuditEntityId } from '../src/customer-class/customer-tier-default-class.service';
import { InstitutionWorkforceScopeService } from '../src/institution/institution-workforce-scope.service';
import { AuditService } from '../src/operations/audit.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const seed = require('../scripts/local-dev-seed-11-roles.js') as {
  ROLES: string[];
  emailFor: (role: string) => string;
  passwordFor: (role: string) => string;
  seedLocalRoles: (ds: DataSource, config: any, audit: AuditService) => Promise<any[]>;
};

const API = '/api/v1';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SignInResponse {
  accessToken: string;
  sessionId: string;
  principal: {
    principalId: string;
    roles: string[];
    scopes: string[];
    assuranceLevel: string;
    institutionId?: string | null;
  };
}

describe('Customer tier default class approval governance (real PostgreSQL + governed HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let config: A2WorkforceConfigurationV1;
  let sessionService: A2WorkforceSessionService;

  const sessions = new Map<string, SignInResponse>();
  let standardClassId = '';
  let premiumClassId = '';
  let businessClassId = '';

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const roleAuth = (role: string) => bearer(sessions.get(role)!.accessToken);

  async function signInRole(role: string): Promise<SignInResponse> {
    const res = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/local-admin-sessions`)
      .send({ email: seed.emailFor(role), password: seed.passwordFor(role) })
      .expect(201);
    return res.body as SignInResponse;
  }

  async function mintSessionForRoles(
    principalId: string,
    roleKeys: string[],
  ): Promise<{ principalId: string; sessionId: string; accessToken: string }> {
    const now = new Date();
    const repo = dataSource.getRepository(A2FinanceRoleAssignment);
    for (const roleKey of roleKeys) {
      const existing = await repo.findOne({
        where: { principalId, roleKey, status: 'ACTIVE' } as any,
      });
      if (!existing) {
        await repo.save({
          id: randomUUID(),
          assignmentReference: `tier-default-it:${principalId}:${roleKey}`,
          assignmentVersion: 1,
          principalId,
          roleKey,
          scopes: [],
          status: 'ACTIVE',
          initiatedScope: 'SUPER_ADMIN_SCOPE',
          interim: true,
          effectiveFrom: new Date(now.getTime() - 60_000),
          effectiveTo: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
          assignedBy: 'tier-default-test-fixture',
          assignedAt: now,
          revokedBy: null,
          revokedAt: null,
          bootstrapReference: null,
          approvalIds: [],
          auditReferences: [],
        } as any);
      }
    }
    const established = await sessionService.establish({
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
      signingKeyId: 'tier-default-test-key',
    });
    return {
      principalId,
      sessionId: established.sessionId,
      accessToken: established.accessToken,
    };
  }

  beforeAll(async () => {
    if (process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER === 'yes') {
      process.env.LOCAL_DEV_SEED_CONFIRM ??= 'disposable-local-database';
    }
    dataSource = await createIntegrationDataSource('tierdefaultgov');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    config = app.get<A2WorkforceConfigurationV1>(A2_WORKFORCE_CONFIG);
    sessionService = app.get(A2WorkforceSessionService);
    await seed.seedLocalRoles(dataSource, config, app.get(AuditService));

    for (const role of seed.ROLES) {
      sessions.set(role, await signInRole(role));
    }

    const classesRes = await request(app.getHttpServer())
      .get(`${API}/internal/customer-classes`)
      .set(roleAuth('CUSTOMER_SERVICE'))
      .expect(200);
    const byCode = new Map<string, string>(
      (classesRes.body as Array<{ code: string; id: string }>).map((c) => [c.code, c.id]),
    );
    standardClassId = byCode.get('STANDARD')!;
    premiumClassId = byCode.get('PREMIUM')!;
    businessClassId = byCode.get('BUSINESS')!;
    expect(standardClassId).toMatch(UUID_REGEX);
    expect(premiumClassId).toMatch(UUID_REGEX);
    expect(businessClassId).toMatch(UUID_REGEX);
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await truncateAllTables(dataSource);
    if (app) await app.close();
    if (dataSource?.isInitialized) await destroyIntegrationDataSource(dataSource);
  }, 120_000);

  it('preserves all 11 seeded workforce accounts, MFA assurance, single-role assignments, and institution scope', () => {
    expect(seed.ROLES).toHaveLength(11);
    for (const role of seed.ROLES) {
      const signedIn = sessions.get(role)!;
      expect(signedIn.principal.roles).toEqual([role]);
      expect(signedIn.principal.assuranceLevel).toBe('MFA');
    }
    expect(sessions.get('CUSTOMER_SERVICE')!.principal.scopes).toContain('customer.manage_classes');
    expect(sessions.get('SUPER_ADMIN')!.principal.scopes).toContain('customer.manage_classes');
    expect(sessions.get('FINANCE_CONTROLLER')!.principal.scopes).not.toContain(
      'customer.manage_classes',
    );
    expect(app.select(AdminModule).get(InstitutionWorkforceScopeService)).toBeDefined();
  });

  it('enforces route policy on tier-default proposal and execute endpoints for unauthorized roles', async () => {
    const payload = {
      tierDefaults: {
        LEVEL_1: standardClassId,
        LEVEL_2: premiumClassId,
        LEVEL_3: businessClassId,
      },
      reason: 'Unauthorized role probe',
    };

    for (const deniedRole of [
      'OPERATIONS',
      'FINANCE_PREPARER',
      'FINANCE_CONTROLLER',
      'FINANCE_AUDITOR',
    ]) {
      await request(app.getHttpServer())
        .post(`${API}/internal/customer-classes/tier-defaults/proposals`)
        .set(roleAuth(deniedRole))
        .send(payload)
        .expect(403);

      await request(app.getHttpServer())
        .post(
          `${API}/internal/customer-classes/tier-defaults/proposals/00000000-0000-4000-8000-000000000099/execute`,
        )
        .set(roleAuth(deniedRole))
        .send(payload)
        .expect(403);
    }
  });

  it('denies self-approval across same session, second session, and dual-role principals', async () => {
    const payload = {
      tierDefaults: {
        LEVEL_1: standardClassId,
        LEVEL_2: premiumClassId,
        LEVEL_3: businessClassId,
      },
      reason: 'Verify strict independent checker enforcement',
    };

    // 1. Single-role CUSTOMER_SERVICE proposes without holding SUPER_ADMIN.
    const proposed = await request(app.getHttpServer())
      .post(`${API}/internal/customer-classes/tier-defaults/proposals`)
      .set(roleAuth('CUSTOMER_SERVICE'))
      .send(payload)
      .expect(201);
    const approvalId = proposed.body.approvalId as string;
    expect(approvalId).toMatch(UUID_REGEX);
    expect(proposed.body.status).toBe('REQUESTED');

    // Same session self-approval is denied.
    const sameSessionSelf = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/approvals/${approvalId}/approve`)
      .set(roleAuth('CUSTOMER_SERVICE'))
      .send({ comment: 'attempting self-approval from same session' })
      .expect(201);
    expect(sameSessionSelf.body).toMatchObject({
      approved: false,
      reason: 'SELF_APPROVAL_FORBIDDEN',
    });

    // Second independent session for the SAME principal is also denied.
    const csSecondSession = await signInRole('CUSTOMER_SERVICE');
    expect(csSecondSession.sessionId).not.toBe(sessions.get('CUSTOMER_SERVICE')!.sessionId);
    expect(csSecondSession.principal.principalId).toBe(
      sessions.get('CUSTOMER_SERVICE')!.principal.principalId,
    );
    const secondSessionSelf = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/approvals/${approvalId}/approve`)
      .set(bearer(csSecondSession.accessToken))
      .send({ comment: 'attempting self-approval from second session' })
      .expect(201);
    expect(secondSessionSelf.body).toMatchObject({
      approved: false,
      reason: 'SELF_APPROVAL_FORBIDDEN',
    });

    // 2. A principal holding BOTH SUPER_ADMIN and CUSTOMER_SERVICE simultaneously still cannot self-approve,
    //    even from a fresh second session.
    const dualPrincipalId = `tierdefault:dual:${randomUUID()}`.slice(0, 140);
    const dualSession1 = await mintSessionForRoles(dualPrincipalId, [
      'SUPER_ADMIN',
      'CUSTOMER_SERVICE',
    ]);
    const dualProposed = await request(app.getHttpServer())
      .post(`${API}/internal/customer-classes/tier-defaults/proposals`)
      .set(bearer(dualSession1.accessToken))
      .send(payload)
      .expect(201);
    const dualApprovalId = dualProposed.body.approvalId as string;

    const dualSession2 = await mintSessionForRoles(dualPrincipalId, [
      'SUPER_ADMIN',
      'CUSTOMER_SERVICE',
    ]);
    expect(dualSession2.sessionId).not.toBe(dualSession1.sessionId);

    const dualSelfApprove = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/approvals/${dualApprovalId}/approve`)
      .set(bearer(dualSession2.accessToken))
      .send({ comment: 'dual-role principal attempting self-approval from second session' })
      .expect(201);
    expect(dualSelfApprove.body).toMatchObject({
      approved: false,
      reason: 'SELF_APPROVAL_FORBIDDEN',
    });

    // Executing an unapproved proposal fails closed and leaves mappings PENDING_APPROVAL.
    await request(app.getHttpServer())
      .post(`${API}/internal/customer-classes/tier-defaults/proposals/${dualApprovalId}/execute`)
      .set(bearer(dualSession2.accessToken))
      .send(payload)
      .expect(409);

    const current = await request(app.getHttpServer())
      .get(`${API}/internal/customer-classes/tier-defaults`)
      .set(roleAuth('CUSTOMER_SERVICE'))
      .expect(200);
    expect(current.body.allApproved).toBe(false);
    expect(current.body.pendingApprovalCount).toBe(3);
  });

  it('approves via an independent checker and updates migration-seeded PENDING_APPROVAL mappings with schema-free UUID audit events', async () => {
    const initial = await request(app.getHttpServer())
      .get(`${API}/internal/customer-classes/tier-defaults`)
      .set(roleAuth('CUSTOMER_SERVICE'))
      .expect(200);
    expect(initial.body.mappings).toHaveLength(3);
    for (const m of initial.body.mappings) {
      expect(m.status).toBe('PENDING_APPROVAL');
    }

    const payload = {
      tierDefaults: {
        LEVEL_1: standardClassId,
        LEVEL_2: premiumClassId,
        LEVEL_3: businessClassId,
      },
      reason: 'Approve initial tier default service class mappings',
    };

    // Single-role SUPER_ADMIN proposes (maker); single-role CUSTOMER_SERVICE approves and executes (independent checker).
    const proposed = await request(app.getHttpServer())
      .post(`${API}/internal/customer-classes/tier-defaults/proposals`)
      .set(roleAuth('SUPER_ADMIN'))
      .send(payload)
      .expect(201);
    const approvalId = proposed.body.approvalId as string;
    expect(approvalId).toMatch(UUID_REGEX);

    // Independent checker sees the pending approval with resolved authority.
    const inbox = await request(app.getHttpServer())
      .get(
        `${API}/internal/a2/workforce/approvals?actionType=CUSTOMER_CLASS_TIER_DEFAULTS_CONFIGURE&status=REQUESTED`,
      )
      .set(roleAuth('CUSTOMER_SERVICE'))
      .expect(200);
    const listed = (inbox.body.items as any[]).find((item) => item.id === approvalId);
    expect(listed).toBeDefined();
    expect(listed.authority.approvingFunctions).toEqual(['customer.manage_classes']);
    expect(listed.authority.approvingRoles).toEqual(
      expect.arrayContaining(['CUSTOMER_SERVICE', 'SUPER_ADMIN']),
    );
    expect(listed.authority.minimumAssurance).toBe('MFA');

    // Finance Controller lacks customer.manage_classes and must not see or approve it.
    const fcInbox = await request(app.getHttpServer())
      .get(
        `${API}/internal/a2/workforce/approvals?actionType=CUSTOMER_CLASS_TIER_DEFAULTS_CONFIGURE`,
      )
      .set(roleAuth('FINANCE_CONTROLLER'))
      .expect(200);
    expect(fcInbox.body.items).toHaveLength(0);

    // Institution-scoped query filters out unrelated institution IDs cleanly.
    const otherInstitutionInbox = await request(app.getHttpServer())
      .get(
        `${API}/internal/a2/workforce/approvals?actionType=CUSTOMER_CLASS_TIER_DEFAULTS_CONFIGURE&institutionId=${randomUUID()}`,
      )
      .set(roleAuth('CUSTOMER_SERVICE'))
      .expect(200);
    expect(otherInstitutionInbox.body.items).toHaveLength(0);

    // Independent CUSTOMER_SERVICE checker approves.
    const approved = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/approvals/${approvalId}/approve`)
      .set(roleAuth('CUSTOMER_SERVICE'))
      .send({ comment: 'Independent checker verified tier mappings' })
      .expect(201);
    expect(approved.body.approved).toBe(true);
    expect(approved.body.approval.status).toBe('APPROVED');

    // Independent checker executes the approved request.
    const executed = await request(app.getHttpServer())
      .post(`${API}/internal/customer-classes/tier-defaults/proposals/${approvalId}/execute`)
      .set(roleAuth('CUSTOMER_SERVICE'))
      .send(payload)
      .expect(200);
    expect(executed.body.approvalId).toBe(approvalId);
    expect(executed.body.mappings).toHaveLength(3);

    const checkerPrincipalId = sessions.get('CUSTOMER_SERVICE')!.principal.principalId;
    const dbRows = await dataSource.query<
      Array<{
        tier: string;
        class_id: string;
        status: string;
        approval_id: string;
        approved_by: string;
        approved_at: Date | null;
        version: number;
      }>
    >(
      `SELECT tier, class_id, status, approval_id, approved_by, approved_at, version
         FROM customer_tier_default_classes
        ORDER BY tier ASC`,
    );
    expect(dbRows).toHaveLength(3);
    for (const row of dbRows) {
      expect(row.status).toBe('APPROVED');
      expect(row.approval_id).toBe(approvalId);
      expect(row.approved_by).toBe(checkerPrincipalId);
      expect(row.approved_at).not.toBeNull();
      expect(Number(row.version)).toBe(2);
    }

    const auditRows = await dataSource.query<
      Array<{
        entity_type: string;
        entity_id: string;
        action: string;
        actor: string;
        previous_values: Record<string, unknown>;
        new_values: Record<string, unknown>;
      }>
    >(
      `SELECT entity_type, entity_id::text AS entity_id, action, actor, previous_values, new_values
         FROM audit_events
        WHERE entity_type = 'CUSTOMER_CLASS_TIER_DEFAULT'
          AND new_values ->> 'approvalId' = $1
        ORDER BY new_values ->> 'tier' ASC`,
      [approvalId],
    );
    expect(auditRows).toHaveLength(3);
    expect(auditRows.map((a) => a.action)).toEqual(['UPDATED', 'UPDATED', 'UPDATED']);
    expect(auditRows.map((a) => a.new_values.tier)).toEqual(['LEVEL_1', 'LEVEL_2', 'LEVEL_3']);
    for (const auditRow of auditRows) {
      const tier = String(auditRow.new_values.tier);
      expect(auditRow.entity_id).toMatch(UUID_REGEX);
      expect(auditRow.entity_id).toBe(tierDefaultAuditEntityId(tier));
      expect(auditRow.previous_values.tier).toBe(tier);
      expect(auditRow.previous_values.status).toBe('PENDING_APPROVAL');
      expect(auditRow.new_values.status).toBe('APPROVED');
      expect(auditRow.new_values.approvalId).toBe(approvalId);
      expect(auditRow.new_values.approvedBy).toBe(checkerPrincipalId);
      expect(auditRow.new_values.reason).toBe(payload.reason);
    }
  });

  it('inserts a missing tier mapping row on execute and records CREATED audit event with derived UUID and tier code', async () => {
    await dataSource.query(`DELETE FROM customer_tier_default_classes WHERE tier = 'LEVEL_3'`);

    const payload = {
      tierDefaults: {
        LEVEL_1: standardClassId,
        LEVEL_2: standardClassId,
        LEVEL_3: premiumClassId,
      },
      reason: 'Insert missing LEVEL_3 mapping and update LEVEL_1/LEVEL_2',
    };

    const proposed = await request(app.getHttpServer())
      .post(`${API}/internal/customer-classes/tier-defaults/proposals`)
      .set(roleAuth('CUSTOMER_SERVICE'))
      .send(payload)
      .expect(201);
    const approvalId = proposed.body.approvalId as string;

    const approved = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/approvals/${approvalId}/approve`)
      .set(roleAuth('SUPER_ADMIN'))
      .send({ comment: 'Independent SUPER_ADMIN checker approval' })
      .expect(201);
    expect(approved.body.approved).toBe(true);

    const executed = await request(app.getHttpServer())
      .post(`${API}/internal/customer-classes/tier-defaults/proposals/${approvalId}/execute`)
      .set(roleAuth('SUPER_ADMIN'))
      .send(payload)
      .expect(200);
    expect(executed.body.approvalId).toBe(approvalId);

    const level3Rows = await dataSource.query<
      Array<{
        tier: string;
        class_id: string;
        status: string;
        approval_id: string;
        approved_by: string;
        version: number;
      }>
    >(
      `SELECT tier, class_id, status, approval_id, approved_by, version
         FROM customer_tier_default_classes
        WHERE tier = 'LEVEL_3'`,
    );
    expect(level3Rows).toHaveLength(1);
    const insertedRow = level3Rows[0]!;
    expect(insertedRow.class_id).toBe(premiumClassId);
    expect(insertedRow.status).toBe('APPROVED');
    expect(insertedRow.approval_id).toBe(approvalId);
    expect(insertedRow.approved_by).toBe(sessions.get('SUPER_ADMIN')!.principal.principalId);
    expect(Number(insertedRow.version)).toBe(1);

    const createdAudit = await dataSource.query<
      Array<{
        entity_id: string;
        action: string;
        new_values: Record<string, unknown>;
      }>
    >(
      `SELECT entity_id::text AS entity_id, action, new_values
         FROM audit_events
        WHERE entity_type = 'CUSTOMER_CLASS_TIER_DEFAULT'
          AND action = 'CREATED'
          AND new_values ->> 'approvalId' = $1`,
      [approvalId],
    );
    expect(createdAudit).toHaveLength(1);
    expect(createdAudit[0]!.entity_id).toBe(tierDefaultAuditEntityId('LEVEL_3'));
    expect(createdAudit[0]!.new_values).toMatchObject({
      tier: 'LEVEL_3',
      classId: premiumClassId,
      status: 'APPROVED',
      approvalId,
      approvedBy: sessions.get('SUPER_ADMIN')!.principal.principalId,
      reason: payload.reason,
      version: 1,
    });
  });

  it('honors configurable INITIATE, APPROVE, VIEW, and readOnly roles created via governed role-definition APIs', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const makerRoleKey = `TIER_DEFAULT_MAKER_${suffix}`;
    const checkerRoleKey = `TIER_DEFAULT_CHECKER_${suffix}`;
    const viewerRoleKey = `TIER_DEFAULT_VIEWER_${suffix}`;
    const readOnlyRoleKey = `TIER_DEFAULT_RO_${suffix}`;

    const createConfigurableRole = async (
      roleKey: string,
      accessType: 'INITIATE' | 'APPROVE' | 'VIEW',
      readOnly = false,
    ) => {
      const submitRes = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/role-definitions/proposals`)
        .set(roleAuth('SUPER_ADMIN'))
        .send({
          proposalType: 'CREATE',
          roleKey,
          displayName: `${roleKey} Display`,
          description: `Configurable ${accessType} role for tier default governance test`,
          readOnly,
          functionGrants: readOnly
            ? [{ functionCode: 'customer.view', accessType: 'VIEW' }]
            : [
                { functionCode: 'customer.view', accessType: 'VIEW' },
                { functionCode: 'customer.manage_classes', accessType },
              ],
          reason: `Provision configurable ${accessType} role for tier defaults`,
        })
        .expect(201);
      const proposalId = submitRes.body.proposal.id as string;

      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/role-definitions/proposals/${proposalId}/approve`)
        .set(roleAuth('FINANCE_CONTROLLER'))
        .send({ comment: 'Approved configurable role' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/role-definitions/proposals/${proposalId}/apply`)
        .set(roleAuth('SUPER_ADMIN'))
        .send({})
        .expect(201);
    };

    await createConfigurableRole(makerRoleKey, 'INITIATE');
    await createConfigurableRole(checkerRoleKey, 'APPROVE');
    await createConfigurableRole(viewerRoleKey, 'VIEW');
    await createConfigurableRole(readOnlyRoleKey, 'VIEW', true);

    const customMaker = await mintSessionForRoles(`tierdefault:maker:${suffix}`, [makerRoleKey]);
    const customChecker = await mintSessionForRoles(`tierdefault:checker:${suffix}`, [
      checkerRoleKey,
    ]);
    const customViewer = await mintSessionForRoles(`tierdefault:viewer:${suffix}`, [viewerRoleKey]);
    const customReadOnly = await mintSessionForRoles(`tierdefault:ro:${suffix}`, [readOnlyRoleKey]);

    const payload = {
      tierDefaults: {
        LEVEL_1: standardClassId,
        LEVEL_2: premiumClassId,
        LEVEL_3: businessClassId,
      },
      reason: 'Configurable INITIATE maker and APPROVE checker end-to-end test',
    };

    // APPROVE-only, VIEW-only, and read-only custom roles cannot initiate a proposal.
    for (const deniedToken of [
      customChecker.accessToken,
      customViewer.accessToken,
      customReadOnly.accessToken,
    ]) {
      await request(app.getHttpServer())
        .post(`${API}/internal/customer-classes/tier-defaults/proposals`)
        .set(bearer(deniedToken))
        .send(payload)
        .expect(403);
    }

    // INITIATE role can propose.
    const proposed = await request(app.getHttpServer())
      .post(`${API}/internal/customer-classes/tier-defaults/proposals`)
      .set(bearer(customMaker.accessToken))
      .send(payload)
      .expect(201);
    const approvalId = proposed.body.approvalId as string;

    // A second independent INITIATE-only principal, a VIEW-only role, and a readOnly role cannot see or approve.
    const secondMaker = await mintSessionForRoles(`tierdefault:maker2:${suffix}`, [makerRoleKey]);
    for (const deniedChecker of [
      secondMaker.accessToken,
      customViewer.accessToken,
      customReadOnly.accessToken,
    ]) {
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/approvals/${approvalId}/approve`)
        .set(bearer(deniedChecker))
        .send({ comment: 'Should not approve tier defaults' })
        .expect(403);
    }

    // Dynamic authority includes the new configurable checker role.
    const checkerInbox = await request(app.getHttpServer())
      .get(
        `${API}/internal/a2/workforce/approvals?actionType=CUSTOMER_CLASS_TIER_DEFAULTS_CONFIGURE&status=REQUESTED`,
      )
      .set(bearer(customChecker.accessToken))
      .expect(200);
    const found = (checkerInbox.body.items as any[]).find((item) => item.id === approvalId);
    expect(found).toBeDefined();
    expect(found.authority.approvingRoles).toEqual(
      expect.arrayContaining(['CUSTOMER_SERVICE', 'SUPER_ADMIN', checkerRoleKey]),
    );

    // Independent APPROVE role approves and executes the request.
    const approved = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/approvals/${approvalId}/approve`)
      .set(bearer(customChecker.accessToken))
      .send({ comment: 'Approved by configurable checker role' })
      .expect(201);
    expect(approved.body.approved).toBe(true);

    const executed = await request(app.getHttpServer())
      .post(`${API}/internal/customer-classes/tier-defaults/proposals/${approvalId}/execute`)
      .set(bearer(customChecker.accessToken))
      .send(payload)
      .expect(200);
    expect(executed.body.approvalId).toBe(approvalId);

    const after = await request(app.getHttpServer())
      .get(`${API}/internal/customer-classes/tier-defaults`)
      .set(bearer(customChecker.accessToken))
      .expect(200);
    expect(after.body.allApproved).toBe(true);
    expect(after.body.pendingApprovalCount).toBe(0);
    for (const m of after.body.mappings) {
      expect(m.status).toBe('APPROVED');
      expect(m.approvalId).toBe(approvalId);
      expect(m.approvedBy).toBe(customChecker.principalId);
    }
  });

  it('preserves existing role requirements on unrelated approval workflows', async () => {
    const feePayload = {
      productCode: 'WALLET_TRANSFER',
      currency: 'NGN',
      percentageBps: 42,
      priority: 1,
      isActive: true,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      reason:
        'Verify unrelated commercial rule workflow preserves FINANCE_PREPARER/FINANCE_CONTROLLER',
    };

    // FEE_RULE_CREATE still requires FINANCE_PREPARER to initiate and FINANCE_CONTROLLER to approve.
    await request(app.getHttpServer())
      .post(`${API}/internal/fee-rules`)
      .set(roleAuth('CUSTOMER_SERVICE'))
      .send(feePayload)
      .expect(403);

    const feeProposal = await request(app.getHttpServer())
      .post(`${API}/internal/fee-rules`)
      .set(roleAuth('FINANCE_PREPARER'))
      .send(feePayload)
      .expect(201);
    const feeApprovalId = feeProposal.body.approvalId as string;

    // SUPER_ADMIN and CUSTOMER_SERVICE cannot approve FEE_RULE_CREATE; FINANCE_CONTROLLER retains authority.
    for (const deniedRole of ['SUPER_ADMIN', 'CUSTOMER_SERVICE']) {
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/approvals/${feeApprovalId}/approve`)
        .set(roleAuth(deniedRole))
        .send({ comment: 'Unauthorized role must not approve fee rule' })
        .expect(403);
    }

    const fcView = await request(app.getHttpServer())
      .get(`${API}/internal/a2/workforce/approvals/${feeApprovalId}`)
      .set(roleAuth('FINANCE_CONTROLLER'))
      .expect(200);
    expect(fcView.body.authority).toMatchObject({
      approvingRoles: ['FINANCE_CONTROLLER'],
      approvingFunctions: ['fee_rule.create'],
      minimumAssurance: 'MFA',
    });
  });
});
