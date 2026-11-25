/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
/**
 * ARENA B9 — Configurable workforce roles, end to end (real PostgreSQL + real HTTP).
 *
 * One custom role is taken through the whole governed lifecycle with the real services, the real
 * catalogue and real workforce sign-in:
 *
 *   SUPER_ADMIN defines SOC_ANALYST and selects its catalogue functions
 *     -> FINANCE_CONTROLLER (an independent checker) approves the definition
 *     -> SUPER_ADMIN applies it (the role becomes an active, non-seeded catalogue role)
 *     -> SUPER_ADMIN prepares the assignment approval (server-computed fingerprint)
 *     -> FINANCE_CONTROLLER approves the assignment
 *     -> SUPER_ADMIN assigns the role to a workforce user
 *     -> that user signs in and receives exactly the role's function grants
 *     -> a route granted by the role works, a route it does not grant is refused
 *     -> the role is revoked through the same maker/checker path
 *     -> the same session token loses the access immediately and re-sign-in fails
 *
 * Nothing here is mocked except PostgreSQL's host process (an embedded disposable cluster). The
 * eleven local fixture accounts are seeded through the same fixture path the dev database uses and
 * are re-checked at the end, so the custom-role work cannot have disturbed them.
 */
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
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
const ROLE_KEY = 'SOC_ANALYST';
const CUSTOM_EMAIL = 'soc-analyst@monienaija.local';
const CUSTOM_PASSWORD = 'MonieNaijaCustomRole_123!';
const INSTITUTION_CODE = 'B9CUSTINST';

interface SignIn {
  accessToken: string;
  sessionId: string;
  principal: { principalId: string; roles: string[]; scopes: string[]; assuranceLevel: string };
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const iterations = 10_000;
  const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('B9 configurable workforce roles (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let config: A2WorkforceConfigurationV1;

  const sessions = new Map<string, SignIn>();
  let customPrincipalId = '';
  let customSignIn: SignIn | null = null;
  let proposalId = '';
  let assignmentApprovalId = '';
  let revocationApprovalId = '';

  // Effective immediately: the grant must be usable by the very next sign-in.
  const effectiveFrom = new Date(Date.now() - 60_000).toISOString();
  const effectiveTo = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const as = (role: string) => auth(sessions.get(role)!.accessToken);

  async function signIn(email: string, password: string) {
    const response = await request(app.getHttpServer())
      .post(`${API}/internal/a2/workforce/local-admin-sessions`)
      .send({ email, password });
    return response;
  }

  async function signInRole(role: string) {
    const response = await signIn(seed.emailFor(role), seed.passwordFor(role));
    expect(response.status).toBe(201);
    sessions.set(role, response.body as SignIn);
    return response.body as SignIn;
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('b9custom');
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
    const seeded = await seed.seedLocalRoles(dataSource, config, app.get(AuditService));
    expect(seeded).toHaveLength(11);

    customPrincipalId = seed.principalFor(CUSTOM_EMAIL, config);
    // A real local credential with NO assignment: it must be unusable until the custom role is
    // granted, which is what makes "access removed after revocation" observable.
    await dataSource.query(
      'INSERT INTO local_admin_credentials (id,email,password_hash,hash_algorithm) VALUES ($1,$2,$3,$4)',
      [randomUUID(), CUSTOM_EMAIL, hashPassword(CUSTOM_PASSWORD), 'PBKDF2'],
    );

    await signInRole('SUPER_ADMIN');
    await signInRole('FINANCE_CONTROLLER');
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await truncateAllTables(dataSource);
    if (app) await app.close();
    if (dataSource?.isInitialized) await destroyIntegrationDataSource(dataSource);
  }, 180_000);

  describe('definition', () => {
    it('the target account has no access before any role is granted', async () => {
      const response = await signIn(CUSTOM_EMAIL, CUSTOM_PASSWORD);
      expect(response.status).toBe(401);
      expect(JSON.stringify(response.body)).toContain('No valid workforce roles');
    });

    it('the catalogue exposes only assignable functions to the editor', async () => {
      const response = await request(app.getHttpServer())
        .get(`${API}/internal/a2/workforce/role-definitions/functions`)
        .set(as('SUPER_ADMIN'))
        .expect(200);
      const codes = (response.body as Array<{ functionCode: string; assignable?: boolean }>).map(
        (row) => row.functionCode,
      );
      expect(codes).toContain('fee_rule.view');
      expect(codes).toContain('audit.search');
      // Workforce-role governance functions can never be handed to a configurable role, so they
      // are not offered as choices.
      expect(codes.some((code) => code.startsWith('workforce.role.'))).toBe(false);
    });

    it('SUPER_ADMIN submits a custom role definition with selected functions', async () => {
      const response = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/role-definitions/proposals`)
        .set(as('SUPER_ADMIN'))
        .send({
          proposalType: 'CREATE',
          roleKey: ROLE_KEY,
          displayName: 'SOC Analyst',
          description:
            'Read-only commercial and audit visibility for the security operations centre.',
          readOnly: true,
          functionGrants: [
            { functionCode: 'fee_rule.view', accessType: 'VIEW' },
            { functionCode: 'audit.search', accessType: 'VIEW' },
          ],
          reason: 'B9 acceptance: configurable role with read-only commercial and audit visibility',
        })
        .expect(201);
      expect(response.body.success).toBe(true);
      expect(response.body.proposal.status).toBe('REQUESTED');
      expect(response.body.proposal.targetRoleKey).toBe(ROLE_KEY);
      proposalId = response.body.proposal.id;
    });

    it('the maker cannot approve its own role definition', async () => {
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/role-definitions/proposals/${proposalId}/approve`)
        .set(as('SUPER_ADMIN'))
        .send({ comment: 'self' })
        .expect(403);
    });

    it('an independent checker approves, and only then can the definition be applied', async () => {
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/role-definitions/proposals/${proposalId}/apply`)
        .set(as('SUPER_ADMIN'))
        .expect(409);

      const approved = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/role-definitions/proposals/${proposalId}/approve`)
        .set(as('FINANCE_CONTROLLER'))
        .send({ comment: 'Reviewed the requested functions; read-only is appropriate.' })
        .expect(201);
      expect(approved.body.success).toBe(true);
      expect(approved.body.proposal.status).toBe('APPROVED');

      const applied = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/role-definitions/proposals/${proposalId}/apply`)
        .set(as('SUPER_ADMIN'))
        .expect(201);
      expect(applied.body.success).toBe(true);
      expect(applied.body.proposal.status).toBe('APPLIED');
      expect(applied.body.proposal.appliedRoleId).toBeTruthy();

      const [role] = await dataSource.query(
        'SELECT role_key, is_active, is_system_seeded, read_only FROM authorization_roles WHERE role_key=$1',
        [ROLE_KEY],
      );
      expect(role).toMatchObject({
        role_key: ROLE_KEY,
        is_active: true,
        is_system_seeded: false,
        read_only: true,
      });
    });
  });

  describe('assignment', () => {
    it('the custom role cannot be assigned without an independent approval', async () => {
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles`)
        .set(as('SUPER_ADMIN'))
        .send({
          targetPrincipalId: customPrincipalId,
          roleKey: ROLE_KEY,
          effectiveFrom,
          effectiveTo,
        })
        .expect(403);
    });

    it('the server prepares the assignment approval with the fingerprint it will verify', async () => {
      const prepared = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles/approval-requests`)
        .set(as('SUPER_ADMIN'))
        .send({
          operation: 'ASSIGN',
          targetPrincipalId: customPrincipalId,
          roleKey: ROLE_KEY,
          effectiveFrom,
          effectiveTo,
          reason: 'B9 acceptance: grant SOC_ANALYST to the security operations analyst',
        })
        .expect(201);
      expect(prepared.body.action).toBe('FINANCE_ROLE_ASSIGN');
      expect(prepared.body.actionFingerprint).toMatch(/^[a-f0-9]{64}$/);
      assignmentApprovalId = prepared.body.approvalId;

      // Only an approving role may decide it; the maker is refused.
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/approvals/${assignmentApprovalId}/approve`)
        .set(as('SUPER_ADMIN'))
        .send({ comment: 'self' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/approvals/${assignmentApprovalId}/approve`)
        .set(as('FINANCE_CONTROLLER'))
        .send({ comment: 'Approved; scope is read-only and time-bound.' })
        .expect(201);
    });

    it('the assignment is applied once the approval exists', async () => {
      const assigned = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles`)
        .set(as('SUPER_ADMIN'))
        .send({
          targetPrincipalId: customPrincipalId,
          roleKey: ROLE_KEY,
          effectiveFrom,
          effectiveTo,
          approvalIds: [assignmentApprovalId],
        })
        .expect(201);
      expect(assigned.body.roleKey).toBe(ROLE_KEY);
      expect(assigned.body.status).toBe('ACTIVE');
      expect([...assigned.body.scopes].sort()).toEqual(['audit.search', 'fee_rule.view']);
    });
  });

  describe('effective access', () => {
    it('the user signs in and receives exactly the custom role and its grants', async () => {
      const response = await signIn(CUSTOM_EMAIL, CUSTOM_PASSWORD);
      expect(response.status).toBe(201);
      customSignIn = response.body as SignIn;
      expect(customSignIn.principal.roles).toEqual([ROLE_KEY]);
      expect([...customSignIn.principal.scopes].sort()).toEqual(['audit.search', 'fee_rule.view']);
      expect(customSignIn.principal.assuranceLevel).toBe('MFA');
    });

    it('an API action granted by the role succeeds', async () => {
      await request(app.getHttpServer())
        .get(`${API}/internal/fee-rules`)
        .set(auth(customSignIn!.accessToken))
        .expect(200);
    });

    it('an API action the role does not grant is refused', async () => {
      await request(app.getHttpServer())
        .get(`${API}/internal/workforce/directory`)
        .set(auth(customSignIn!.accessToken))
        .expect(403);
      await request(app.getHttpServer())
        .post(`${API}/internal/fee-rules`)
        .set(auth(customSignIn!.accessToken))
        .send({})
        .expect(403);
    });

    it('the directory reports the role and the institution scope of the principal', async () => {
      const institutionId = randomUUID();
      await dataSource.query(
        `INSERT INTO financial_institutions
           (id, reference, code, legal_name, display_name, institution_type, status, created_by, version, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'COMMERCIAL_BANK','REGISTERED','b9-acceptance',1,now(),now())`,
        [
          institutionId,
          `B9-INST-${INSTITUTION_CODE}`,
          INSTITUTION_CODE,
          'B9 Acceptance Bank',
          'B9 Acceptance Bank',
        ],
      );
      await dataSource.query(
        `INSERT INTO workforce_institution_assignments
           (id, principal_id, institution_id, status, granted_by, granted_at, approval_ids, version, created_at, updated_at)
         VALUES ($1,$2,$3,'ACTIVE','b9-acceptance',now(),'[]'::jsonb,1,now(),now())`,
        [randomUUID(), customPrincipalId, institutionId],
      );

      const detail = await request(app.getHttpServer())
        .get(`${API}/internal/workforce/directory/${encodeURIComponent(customPrincipalId)}`)
        .set(as('SUPER_ADMIN'))
        .expect(200);
      expect(detail.body.roles.map((r: any) => r.roleKey)).toEqual([ROLE_KEY]);
      expect(detail.body.roles[0].readOnly).toBe(true);
      expect(detail.body.institutionScope.mode).toBe('INSTITUTIONS');
      expect(detail.body.institutionScope.active[0].institutionCode).toBe(INSTITUTION_CODE);
      expect(detail.body.effectivePermissions.map((f: any) => f.functionCode).sort()).toEqual([
        'audit.search',
        'fee_rule.view',
      ]);
    });
  });

  describe('revocation', () => {
    it('the role is revoked through the same maker/checker path', async () => {
      const prepared = await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/roles/approval-requests`)
        .set(as('SUPER_ADMIN'))
        .send({
          operation: 'REVOKE',
          targetPrincipalId: customPrincipalId,
          roleKey: ROLE_KEY,
          effectiveFrom,
          effectiveTo,
          reason: 'B9 acceptance: end of the SOC rotation window',
        })
        .expect(201);
      expect(prepared.body.action).toBe('FINANCE_ROLE_REVOKE');
      revocationApprovalId = prepared.body.approvalId;

      await request(app.getHttpServer())
        .post(`${API}/internal/a2/workforce/approvals/${revocationApprovalId}/approve`)
        .set(as('FINANCE_CONTROLLER'))
        .send({ comment: 'Rotation window confirmed.' })
        .expect(201);

      const revoked = await request(app.getHttpServer())
        .delete(
          `${API}/internal/a2/workforce/roles/${encodeURIComponent(customPrincipalId)}/${ROLE_KEY}`,
        )
        .set(as('SUPER_ADMIN'))
        .send({ effectiveFrom, effectiveTo, approvalIds: [revocationApprovalId] })
        .expect(200);
      expect(revoked.body.status).toBe('REVOKED');
    });

    it('the same session token loses the access immediately', async () => {
      const token = customSignIn!.accessToken;
      await request(app.getHttpServer())
        .get(`${API}/internal/fee-rules`)
        .set(auth(token))
        .expect(401);
      await request(app.getHttpServer())
        .get(`${API}/internal/workforce/directory`)
        .set(auth(token))
        .expect(401);
    });

    it('the user can no longer sign in, and the role remains defined but unassigned', async () => {
      const response = await signIn(CUSTOM_EMAIL, CUSTOM_PASSWORD);
      expect(response.status).toBe(401);
      expect(JSON.stringify(response.body)).toContain('No valid workforce roles');

      const [role] = await dataSource.query(
        'SELECT is_active, is_system_seeded FROM authorization_roles WHERE role_key=$1',
        [ROLE_KEY],
      );
      expect(role).toMatchObject({ is_active: true, is_system_seeded: false });
      const assignments = await dataSource.query(
        `SELECT status FROM a2_finance_role_assignments WHERE role_key=$1 AND status='ACTIVE'`,
        [ROLE_KEY],
      );
      expect(assignments).toHaveLength(0);
    });
  });

  describe('regression', () => {
    it('all eleven local fixture accounts still sign in unchanged', async () => {
      const contracts = require('../scripts/local-dev-seed-11-roles.js') as typeof seed;
      for (const role of contracts.ROLES) {
        const response = await signIn(contracts.emailFor(role), contracts.passwordFor(role));
        expect(response.status).toBe(201);
        expect(response.body.principal.roles).toEqual([role]);
      }
    });
  });
});
