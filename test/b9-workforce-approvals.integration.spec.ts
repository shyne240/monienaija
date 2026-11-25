/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
/**
 * ARENA B9 — Workforce & Approvals, real PostgreSQL + real HTTP.
 *
 * The browser suite (`scripts/admin-web-workforce-b9-browser.cjs`) proves what the Admin Web client
 * does against a fixture API. This suite proves the half a browser cannot: the *server* enforces
 * identity, role, institution, MFA and maker/checker separation on the same endpoints the UI calls.
 *
 * Nothing here is mocked except PostgreSQL's host process (an embedded, disposable cluster):
 *   - all eleven local role accounts are created through the SAME fixture path the disposable
 *     dev database uses (`scripts/local-dev-seed-11-roles.js#seedLocalRoles`), so the documented
 *     passwords are the ones under test;
 *   - every request authenticates through the real `POST …/local-admin-sessions` endpoint, which
 *     mints a real workforce session via `A2WorkforceSessionService.establish`;
 *   - approvals move through the real `PrivilegedActionApprovalService` state machine and the real
 *     `RuntimeAccessGuard`, and consumption happens inside the real role-assignment service.
 *
 * The one deliberate fixture is the "self-approval" row: it is INSERTed with the checker as its
 * own requester, because no configured maker/checker rule in this deployment lists the same role as
 * both maker and checker (that is the point of the rules). Inserting the row exercises the decide()
 * separation control directly instead of inventing a rule the product does not ship.
 */
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import {
  A2FinanceRoleAdministrationService,
  financeRoleAssignmentReference,
} from '../src/authorization/finance-role-administration.service';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
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
  principalFor: (email: string, config: any) => string;
  seedLocalRoles: (ds: DataSource, config: any, audit: AuditService) => Promise<any[]>;
};

const API = '/api/v1';

interface SignIn {
  accessToken: string;
  sessionId: string;
  principal: {
    principalId: string;
    roles: string[];
    scopes: string[];
    assuranceLevel: string;
  };
}

describe('B9 Workforce & Approvals (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let config: A2WorkforceConfigurationV1;
  let roles: A2FinanceRoleAdministrationService;

  const sessions = new Map<string, SignIn>();
  const principalOf = new Map<string, string>();

  const targetPrincipal = () => principalOf.get('FINANCE_PREPARER')!;
  const checkerPrincipal = () => principalOf.get('FINANCE_CONTROLLER')!;

  let assignApprovalId = '';
  let assignFingerprint = '';
  let assignmentReference = '';
  let effectiveFrom = '';
  let effectiveTo = '';

  const auth = (role: string) => ({ Authorization: `Bearer ${sessions.get(role)!.accessToken}` });

  async function signIn(role: string) {
    const email = seed.emailFor(role);
    const response = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/local-admin-sessions`)
      .send({ email, password: seed.passwordFor(role) })
      .expect(201);
    sessions.set(role, response.body as SignIn);
    principalOf.set(role, response.body.principal.principalId);
    return response.body as SignIn;
  }

  beforeAll(async () => {
    // The seed script gates itself on LOCAL_DEV_SEED_CONFIRM. CI declares the cluster disposable
    // (PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes) but does not export this second variable, so derive it
    // from that declaration rather than demanding a duplicate in CI. Without the declaration this
    // still fails closed.
    if (process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER === 'yes') {
      process.env.LOCAL_DEV_SEED_CONFIRM ??= 'disposable-local-database';
    }
    dataSource = await createIntegrationDataSource('b9workforce');
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
    roles = app.get(A2FinanceRoleAdministrationService);

    // Exactly the disposable-database fixture: 11 accounts, documented passwords, one ACTIVE
    // assignment each (catalogue-resolved scopes for the six operational roles).
    const seeded = await seed.seedLocalRoles(dataSource, config, app.get(AuditService));
    expect(seeded).toHaveLength(11);

    for (const role of seed.ROLES) await signIn(role);

    // Maker (SUPER_ADMIN) prepares a Finance role grant for a principal that is NOT the checker.
    // FINANCE_AUDITOR already has an ACTIVE assignment in the fixture, so this is not the
    // bootstrap path: it must go through maker/checker.
    const from = new Date(Date.now() + 60_000);
    const to = new Date(from.getTime() + 7 * 24 * 3600_000);
    effectiveFrom = from.toISOString();
    effectiveTo = to.toISOString();
    assignmentReference = financeRoleAssignmentReference(
      targetPrincipal(),
      'FINANCE_AUDITOR',
      config.environment,
    );
    const command = {
      targetPrincipalId: targetPrincipal(),
      roleKey: 'FINANCE_AUDITOR',
      effectiveFrom,
      effectiveTo,
    };
    assignFingerprint = roles.fingerprint('FINANCE_ROLE_ASSIGN', command as any);

    const created = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/approvals/request`)
      .set(auth('SUPER_ADMIN'))
      .send({
        action: 'FINANCE_ROLE_ASSIGN',
        resource: { type: 'A2_FINANCE_ROLE_ASSIGNMENT', id: assignmentReference },
        actionFingerprint: assignFingerprint,
        reason: 'B9 acceptance: grant read-only audit role to the preparer for segregation review',
      })
      .expect(201);
    expect(created.body.reason).toBe('REQUESTED');
    expect(created.body.approval.status).toBe('REQUESTED');
    assignApprovalId = created.body.approval.id;
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await truncateAllTables(dataSource);
    if (app) await app.close();
    if (dataSource?.isInitialized) await destroyIntegrationDataSource(dataSource);
  }, 120_000);

  describe('sign-in and page access across the eleven local roles', () => {
    it('every documented role account authenticates and resolves exactly its catalogue grants', async () => {
      for (const role of seed.ROLES) {
        const response = await request(app.getHttpServer())
          .post(`${API}/internal/a2/workforce/local-admin-sessions`)
          .send({ email: seed.emailFor(role), password: seed.passwordFor(role) })
          .expect(201);
        const body = response.body as SignIn;
        expect(body.principal.principalId).toBe(seed.principalFor(seed.emailFor(role), config));
        expect(body.principal.roles).toEqual([role]);
        expect(body.principal.assuranceLevel).toBe('MFA');

        const grants: Array<{ function_code: string }> = await dataSource.query(
          `SELECT rf.function_code FROM authorization_role_functions rf
             JOIN authorization_roles r ON r.id = rf.role_id
            WHERE r.role_key = $1 AND r.is_active AND rf.is_active`,
          [role],
        );
        // A session carries the union of the catalogue's live function grants for the role and
        // the legacy `A2_FINANCE_ROLES_JSON` scopes for the same key — no more, no less.
        const legacy = config.roles.find((r) => r.roleKey === role);
        expect([...body.principal.scopes].sort()).toEqual(
          [...new Set([...grants.map((g) => g.function_code), ...(legacy?.scopes ?? [])])].sort(),
        );
      }
    });

    it('the navigation-critical grants are exactly as the browser matrix observed', () => {
      // This is the server-derived matrix. The browser acceptance fixture
      // (scripts/admin-web-workforce-b9-browser.cjs) carries these exact scope lists, so the
      // reachable-view matrix it produces is the matrix this deployment really grants — not a
      // hand-written approximation of it.
      const has = (role: string, scope: string) =>
        sessions.get(role)!.principal.scopes.includes(scope);
      expect(has('FINANCE_CONTROLLER', 'workforce.role.view')).toBe(true);
      expect(has('FINANCE_CONTROLLER', 'privileged:approve')).toBe(true);
      expect(has('TREASURY', 'workforce.role.view')).toBe(false);
      expect(has('TREASURY', 'privileged:approve')).toBe(false);
      expect(has('ADMINISTRATOR', 'workforce.role.view')).toBe(true);
      expect(has('ADMINISTRATOR', 'privileged:approve')).toBe(false);
      expect(has('ADMINISTRATOR', 'workforce.super_admin.recover')).toBe(true);
      expect(has('OPERATIONS', 'workforce.role.view')).toBe(false);
      expect(has('SUPER_ADMIN', 'workforce.role.assign')).toBe(true);
      expect(has('SUPER_ADMIN', 'privileged:approve')).toBe(false);
      expect(has('FINANCE_PREPARER', 'workforce.role.assign')).toBe(false);
      expect(has('FINANCE_AUDITOR', 'workforce.role.view')).toBe(true);
      expect(has('FINANCE_AUDITOR', 'privileged:approve')).toBe(false);
    });

    it('rejects a wrong password and does not leak whether the account exists', async () => {
      for (const email of [seed.emailFor('TREASURY'), 'nobody@monienaija.local']) {
        const response = await request(app.getHttpServer())
          .post(`${API}/internal/a2/workforce/local-admin-sessions`)
          .send({ email, password: 'not-the-password' })
          .expect(401);
        expect(response.body.message).toBe('Invalid local administrator credentials');
      }
    });

    it('a session token is required — an unauthenticated directory read is refused', async () => {
      await request(app.getHttpServer()).get(`${API}/internal/workforce/directory`).expect(401);
    });
  });

  describe('approval visibility and authority', () => {
    it('the checker sees the pending change with its required authority', async () => {
      const list = await request(app.getHttpServer())
        .get(`${API}/internal/a2/workforce/approvals?status=REQUESTED`)
        .set(auth('FINANCE_CONTROLLER'))
        .expect(200);
      const row = list.body.items.find((item: any) => item.id === assignApprovalId);
      expect(row).toBeDefined();
      expect(row.actionType).toBe('FINANCE_ROLE_ASSIGN');
      expect(row.resourceId).toBe(assignmentReference);
      expect(row.requesterPrincipalId).toBe(principalOf.get('SUPER_ADMIN'));
      expect(row.authority).toMatchObject({
        approvingRoles: ['FINANCE_CONTROLLER'],
        minimumApprovals: 1,
        selfApprovalProhibited: true,
        minimumAssurance: 'MFA',
        approvalScope: 'privileged:approve',
        governed: false,
      });

      const one = await request(app.getHttpServer())
        .get(`${API}/internal/a2/workforce/approvals/${assignApprovalId}`)
        .set(auth('FINANCE_CONTROLLER'))
        .expect(200);
      expect(one.body.id).toBe(assignApprovalId);
      expect(one.body.status).toBe('REQUESTED');
      expect(one.body.actionFingerprint).toBe(assignFingerprint);
    });

    it('a role without the approving authority cannot see the row', async () => {
      const list = await request(app.getHttpServer())
        .get(`${API}/internal/a2/workforce/approvals`)
        .set(auth('TREASURY'))
        .expect(200);
      expect(list.body.items).toHaveLength(0);
      expect(list.body.items.some((item: any) => item.id === assignApprovalId)).toBe(false);

      await request(app.getHttpServer())
        .get(`${API}/internal/a2/workforce/approvals/${assignApprovalId}`)
        .set(auth('TREASURY'))
        .expect(404);

      // The maker can see its own request, but is not an approving role for it.
      const makerList = await request(app.getHttpServer())
        .get(`${API}/internal/a2/workforce/approvals`)
        .set(auth('SUPER_ADMIN'))
        .expect(200);
      expect(makerList.body.items.some((item: any) => item.id === assignApprovalId)).toBe(false);
    });

    it('an unknown approval id is a 404, not an existence oracle', async () => {
      await request(app.getHttpServer())
        .get(`${API}/internal/a2/workforce/approvals/${randomUUID()}`)
        .set(auth('FINANCE_CONTROLLER'))
        .expect(404);
    });

    it('the maker cannot approve its own request', async () => {
      const response = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/approvals/${assignApprovalId}/approve`)
        .set(auth('SUPER_ADMIN'))
        .send({ comment: 'self' })
        .expect(403);
      expect(response.body.message).toContain('Approval authorization denied');
    });
  });

  describe('maker-checker completion of a governed access change', () => {
    it('refuses the assignment before an independent checker decides', async () => {
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles`)
        .set(auth('SUPER_ADMIN'))
        .send({
          targetPrincipalId: targetPrincipal(),
          roleKey: 'FINANCE_AUDITOR',
          effectiveFrom,
          effectiveTo,
        })
        .expect(403);
    });

    it('the checker approves, and the approval is then consumed exactly once', async () => {
      const approved = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/approvals/${assignApprovalId}/approve`)
        .set(auth('FINANCE_CONTROLLER'))
        .send({ comment: 'Verified against the segregation-of-duties matrix.' })
        .expect(201);
      expect(approved.body.approved).toBe(true);
      expect(approved.body.approval.status).toBe('APPROVED');
      expect(approved.body.approval.approvedBy).toBe(checkerPrincipal());

      const second = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/approvals/${assignApprovalId}/approve`)
        .set(auth('FINANCE_CONTROLLER'))
        .send({ comment: 'again' })
        .expect(201);
      expect(second.body.approved).toBe(false);
    });

    it('applies the change with the approval, and only with that approval', async () => {
      const assigned = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles`)
        .set(auth('SUPER_ADMIN'))
        .send({
          targetPrincipalId: targetPrincipal(),
          roleKey: 'FINANCE_AUDITOR',
          effectiveFrom,
          effectiveTo,
          approvalIds: [assignApprovalId],
        })
        .expect(201);
      expect(assigned.body.roleKey).toBe('FINANCE_AUDITOR');
      expect(assigned.body.status).toBe('ACTIVE');
      expect(assigned.body.approvalIds).toEqual([assignApprovalId]);

      const row = await dataSource
        .getRepository(PrivilegedActionApproval)
        .findOneOrFail({ where: { id: assignApprovalId } });
      expect(row.status).toBe('CONSUMED');
      expect(row.consumedAt).toBeInstanceOf(Date);

      // The same approval cannot authorise a second change.
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles`)
        .set(auth('SUPER_ADMIN'))
        .send({
          targetPrincipalId: targetPrincipal(),
          roleKey: 'FINANCE_AUDITOR',
          effectiveFrom,
          effectiveTo,
          approvalIds: [assignApprovalId],
        })
        .expect(403);
    });

    it('the workforce directory shows the applied role and the effective permissions', async () => {
      const detail = await request(app.getHttpServer())
        .get(`${API}/internal/workforce/directory/${encodeURIComponent(targetPrincipal())}`)
        .set(auth('FINANCE_CONTROLLER'))
        .expect(200);
      expect(detail.body.accessMode).toBeUndefined();
      expect(detail.body.roles.map((r: any) => r.roleKey).sort()).toEqual([
        'FINANCE_AUDITOR',
        'FINANCE_PREPARER',
      ]);
      expect(detail.body.effectivePermissions.length).toBeGreaterThan(0);
      expect(detail.body.institutionScope.mode).toBe('NONE');

      const page = await request(app.getHttpServer())
        .get(`${API}/internal/workforce/directory?roleKey=FINANCE_AUDITOR`)
        .set(auth('FINANCE_CONTROLLER'))
        .expect(200);
      expect(page.body.accessMode).toBe('READ_ONLY');
      expect(page.body.data.some((entry: any) => entry.principalId === targetPrincipal())).toBe(
        true,
      );
    });
  });

  describe('maker-checker separation is enforced by the server', () => {
    it('a checker cannot approve a decision it raised itself, even with every grant', async () => {
      const repository = dataSource.getRepository(PrivilegedActionApproval);
      const selfRow = repository.create({
        actionType: 'FINANCE_ROLE_ASSIGN',
        resourceType: 'A2_FINANCE_ROLE_ASSIGNMENT',
        resourceId: assignmentReference,
        customerId: null,
        actionFingerprint: assignFingerprint,
        payload: {},
        approvalScope: 'privileged:approve',
        requiredAssurance: 'MFA',
        requesterPrincipalId: checkerPrincipal(),
        requesterSessionId: sessions.get('FINANCE_CONTROLLER')!.sessionId,
        reason: 'B9 acceptance fixture: a checker raised this decision itself',
        approvedBy: null,
        approverSessionId: null,
        decisionComment: null,
        status: 'REQUESTED',
        isEmergency: false,
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      } as any);
      const saved: PrivilegedActionApproval = await repository.save(selfRow as any);

      const response = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/approvals/${saved.id}/approve`)
        .set(auth('FINANCE_CONTROLLER'))
        .send({ comment: 'approving my own request' })
        .expect(201);
      expect(response.body.approved).toBe(false);
      expect(response.body.reason).toBe('SELF_APPROVAL_FORBIDDEN');

      const after = await repository.findOneOrFail({ where: { id: saved.id } });
      expect(after.status).toBe('REQUESTED');
      expect(after.approvedBy).toBeNull();
    });

    it('the assignee cannot make its own access change', async () => {
      const response = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles`)
        .set(auth('FINANCE_AUDITOR'))
        .send({
          targetPrincipalId: principalOf.get('FINANCE_AUDITOR'),
          roleKey: 'FINANCE_PREPARER',
          effectiveFrom,
          effectiveTo,
        })
        .expect(403);
      expect(JSON.stringify(response.body)).not.toContain('Insufficient approvals');
    });
  });

  describe('role and institution restrictions', () => {
    it('a role with no directory grant is refused, while the auditor role is read-only', async () => {
      await request(app.getHttpServer())
        .get(`${API}/internal/workforce/directory`)
        .set(auth('OPERATIONS'))
        .expect(403);
      // ADMINISTRATOR holds `workforce.role.view` in this deployment (it governs operational
      // roles) and therefore reads the same read-only projection as everyone else.
      await request(app.getHttpServer())
        .get(`${API}/internal/workforce/directory`)
        .set(auth('ADMINISTRATOR'))
        .expect(200);
      const readOnly = await request(app.getHttpServer())
        .get(`${API}/internal/workforce/directory`)
        .set(auth('FINANCE_AUDITOR'))
        .expect(200);
      expect(readOnly.body.accessMode).toBe('READ_ONLY');
    });

    it('a role without the assignment function cannot start a Finance role change', async () => {
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles`)
        .set(auth('OPERATIONS'))
        .send({
          targetPrincipalId: targetPrincipal(),
          roleKey: 'FINANCE_AUDITOR',
          effectiveFrom,
          effectiveTo,
        })
        .expect(403);
    });

    it('SUPER_ADMIN cannot be granted or revoked through the workforce role surface', async () => {
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles`)
        .set(auth('SUPER_ADMIN'))
        .send({
          targetPrincipalId: targetPrincipal(),
          roleKey: 'SUPER_ADMIN',
          effectiveFrom,
          effectiveTo,
        })
        .expect(403);
    });
  });
});
