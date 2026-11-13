/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
/**
 * ARENA 3 — protected checker authority acceptance.
 *
 * This suite is deliberately different from every other integration suite: the Nest application
 * itself connects with the PROVISIONED ORDINARY RUNTIME role, while the protected authority
 * component connects with the separate AUTHORITY role. Migrations run as the MIGRATION role against
 * a database it owns. No test-only grant is issued to make a negative pass.
 *
 * Resulting guarantees proven here:
 *  - the three logins are distinct, non-privileged (except the migration role's ownership) roles;
 *  - runtime cannot rewrite session hashes, role assignments, catalogue grants, approvals,
 *    execution evidence or protected checker evidence;
 *  - legitimate authenticated MFA checker operations still work end to end through HTTP;
 *  - production readiness reports `verified` only for this configuration and refuses the
 *    single-credential (unconfigured) configuration.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import type { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { ProtectedAuthorityService } from '../src/authorization/protected-authority.service';
import { ProductionReadinessService } from '../src/production/production-readiness.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  integrationDatabaseName,
} from './support/pg-harness';
import {
  adminConnectionTo,
  createMigratorOwnedDatabase,
  migratorDataSource,
  provisionClusterRoles,
  provisionDatabaseAfterMigrations,
  provisionDatabaseBeforeMigrations,
  provisionedRoleSet,
  roleConnection,
} from './support/protected-authority-provisioning';
import type { ProvisionedRoles } from './support/protected-authority-provisioning';

const INSTITUTIONS = '/api/v1/internal/institutions';
const APPROVALS = '/api/v1/internal/a2/workforce/approvals';

describe('Protected checker authority (ARENA 3) — provisioned runtime/authority roles', () => {
  let admin: DataSource;
  let adminOnDatabase: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let readiness: ProductionReadinessService;
  let reconciliation: ReconciliationService;
  let runtime: DataSource;
  let authority: DataSource;
  let roles: ProvisionedRoles;
  let database: string;
  let operator: { principalId: string; token: string };
  let controller: { principalId: string; token: string };
  let superAdmin: { principalId: string; token: string };
  const savedEnvironment: Record<string, string | undefined> = {};
  const ENVIRONMENT_KEYS = [
    'NODE_ENV',
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_SSL',
    'PROTECTED_AUTHORITY_DB_USER',
    'PROTECTED_AUTHORITY_DB_PASSWORD',
  ];

  beforeAll(async () => {
    admin = await createIntegrationDataSource('authbound');
    roles = provisionedRoleSet('authbd');
    await provisionClusterRoles(admin, roles);
    database = integrationDatabaseName('authbd');
    await createMigratorOwnedDatabase(admin, database, roles.migratorRole);
    adminOnDatabase = adminConnectionTo(admin, database);
    await adminOnDatabase.initialize();
    await provisionDatabaseBeforeMigrations(adminOnDatabase, roles, database);

    const migrator = migratorDataSource(admin, roles, database);
    await migrator.initialize();
    try {
      await migrator.runMigrations({ transaction: 'all' });
    } finally {
      await migrator.destroy();
    }
    await provisionDatabaseAfterMigrations(adminOnDatabase, roles, database);

    for (const key of ENVIRONMENT_KEYS) savedEnvironment[key] = process.env[key];
    const options = admin.options;
    if (options.type !== 'postgres') throw new Error('PostgreSQL required');
    process.env.NODE_ENV = 'test';
    process.env.DB_HOST = String(options.host);
    process.env.DB_PORT = String(options.port);
    process.env.DB_NAME = database;
    process.env.DB_USER = roles.runtimeRole;
    process.env.DB_PASSWORD = roles.runtimePassword;
    process.env.DB_SSL = 'false';
    process.env.PROTECTED_AUTHORITY_DB_USER = roles.authorityRole;
    process.env.PROTECTED_AUTHORITY_DB_PASSWORD = roles.authorityPassword;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = moduleRef.get(A2WorkforceSessionService);
    readiness = moduleRef.get(ProductionReadinessService);
    reconciliation = moduleRef.get(ReconciliationService);

    runtime = roleConnection(
      adminOnDatabase,
      { user: roles.runtimeRole, password: roles.runtimePassword },
      database,
    );
    await runtime.initialize();
    authority = roleConnection(
      adminOnDatabase,
      { user: roles.authorityRole, password: roles.authorityPassword },
      database,
    );
    await authority.initialize();

    superAdmin = await provisionPrincipal('SUPER_ADMIN');
    operator = await provisionPrincipal('OPERATIONS');
    controller = await provisionPrincipal('FINANCE_CONTROLLER');
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (runtime?.isInitialized) await runtime.destroy().catch(() => undefined);
    if (authority?.isInitialized) await authority.destroy().catch(() => undefined);
    if (adminOnDatabase?.isInitialized) await adminOnDatabase.destroy().catch(() => undefined);
    for (const key of ENVIRONMENT_KEYS) {
      if (savedEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnvironment[key];
    }
    if (admin) {
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      } catch {
        // The next run drops it.
      }
      await destroyIntegrationDataSource(admin).catch(() => undefined);
    }
  }, 120_000);

  /** A role assignment written by the AUTHORITY credential plus a real application-minted session. */
  async function provisionPrincipal(
    roleKey: string,
  ): Promise<{ principalId: string; token: string }> {
    const principalId = `authbd:${roleKey}:${randomUUID()}`.slice(0, 160);
    await authority.query(
      `INSERT INTO a2_finance_role_assignments
        (id, assignment_reference, assignment_version, principal_id, role_key, scopes, status,
         initiated_scope, interim, effective_from, effective_to, assigned_by, assigned_at,
         approval_ids, audit_references)
       VALUES ($1,$2,1,$3,$4,'[]','ACTIVE','SUPER_ADMIN_SCOPE',true,
               now()-interval '1 minute', now()+interval '1 year', 'authority-provisioning', now(),
               '[]','[]')`,
      [randomUUID(), `authbd-${principalId}`, principalId, roleKey],
    );
    const now = new Date();
    const established = await sessions.establish({
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
      signingKeyId: 'protected-authority-suite',
    });
    return { principalId, token: established.accessToken };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function registerInstitution(): Promise<{ id: string; reference: string }> {
    const reference = `PAFI-${randomUUID().slice(0, 8).toUpperCase()}`;
    const response = await request(app.getHttpServer())
      .post(INSTITUTIONS)
      .set(auth(superAdmin.token))
      .send({
        reference,
        code: reference.replace(/-/g, '_'),
        legalName: `Protected Authority ${reference} Limited`,
        institutionType: 'MICROFINANCE_BANK',
        regulatorName: 'Central Bank',
        licenceReference: `LIC/${reference}`,
      });
    expect(response.status).toBe(201);
    return { id: response.body.id as string, reference };
  }

  async function approvedInstitution(): Promise<string> {
    const institution = await registerInstitution();
    const evidence = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institution.id}/evidence`)
      .set(auth(superAdmin.token))
      .send({
        evidenceReference: `EVID-${institution.reference}`,
        regulatorName: 'Central Bank',
        licenceReference: `LIC/${institution.reference}`,
      });
    expect(evidence.status).toBe(201);
    const scope = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institution.id}/workforce`)
      .set(auth(superAdmin.token))
      .send({ principalId: operator.principalId });
    expect(scope.status).toBe(201);
    return institution.id;
  }

  const requestLifecycle = (institutionId: string, targetStatus: string, reason: string) =>
    request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle/request`)
      .set(auth(operator.token))
      .send({ targetStatus, reason });

  // ------------------------------------------------------------------ role separation

  it('provisions three distinct non-privileged logins and the authority is the only writer', async () => {
    const runtimeFacts = await runtime.query<any[]>(
      `SELECT current_user, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
         FROM pg_roles WHERE rolname=current_user`,
    );
    const authorityFacts = await authority.query<any[]>(
      `SELECT current_user, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
         FROM pg_roles WHERE rolname=current_user`,
    );
    expect(runtimeFacts[0].current_user).toBe(roles.runtimeRole);
    expect(authorityFacts[0].current_user).toBe(roles.authorityRole);
    expect(runtimeFacts[0].current_user).not.toBe(authorityFacts[0].current_user);
    for (const facts of [runtimeFacts[0], authorityFacts[0]]) {
      expect(facts).toMatchObject({
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
      });
    }
    const ownership = await adminOnDatabase.query<any[]>(
      `SELECT pg_get_userbyid(datdba) AS database_owner,
              (SELECT rolname FROM pg_roles WHERE oid=(SELECT nspowner FROM pg_namespace WHERE nspname='public')) AS schema_owner
         FROM pg_database WHERE datname=current_database()`,
    );
    expect(ownership[0]).toEqual({
      database_owner: roles.migratorRole,
      schema_owner: roles.migratorRole,
    });
    const protectedWrites = await authority.query<any[]>(
      `SELECT has_table_privilege('protected_authority.checker_decisions','INSERT') AS decisions,
              has_table_privilege('protected_authority.approval_consumptions','INSERT') AS consumptions`,
    );
    expect(protectedWrites[0]).toEqual({ decisions: true, consumptions: true });
  });

  it('denies the ordinary runtime credential every protected write path', async () => {
    const denied = async (sql: string, parameters: unknown[] = []) => {
      await expect(runtime.query(sql, parameters)).rejects.toThrow(
        /permission denied|row-level security|must be owner|must be member/i,
      );
    };
    await denied(`SELECT token_hash FROM a2_workforce_sessions LIMIT 1`);
    await denied(`UPDATE a2_workforce_sessions SET status='REVOKED'`);
    await denied(`UPDATE a2_finance_role_assignments SET role_key='SUPER_ADMIN'`);
    await denied(
      `INSERT INTO a2_finance_role_assignments (id,assignment_reference,assignment_version,principal_id,role_key,scopes,status,effective_from,effective_to,assigned_by,assigned_at,approval_ids,audit_references) VALUES (gen_random_uuid(),'forged',1,'forged','SUPER_ADMIN','[]','ACTIVE',now(),now()+interval '1 day','forged',now(),'[]','[]')`,
    );
    await denied(`UPDATE authorization_role_functions SET function_code='workforce.role.assign'`);
    await denied(
      `INSERT INTO protected_authority.checker_decisions (approval_id,action_type,action_fingerprint,payload_digest,decision,checker_principal_id,checker_session_id,assurance_level,decided_at,expires_at) VALUES (gen_random_uuid(),'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',repeat('a',64),repeat('b',64),'APPROVED','forged',gen_random_uuid(),'MFA',now(),now()+interval '1 day')`,
    );
    await denied(`SELECT * FROM protected_authority.checker_decisions`);
    await denied(
      `INSERT INTO governed_institution_lifecycle_executions (approval_id,legacy_reserved) VALUES (gen_random_uuid(), true)`,
    );
    await denied(`SET ROLE monienaija_authority_core`);
    await denied(`TRUNCATE privileged_action_approvals`);
  });

  it('cannot manufacture a protected approval request, decision, consumption or execution', async () => {
    const institutionId = await approvedInstitution();
    const created = await requestLifecycle(
      institutionId,
      'APPROVED',
      'Regulatory evidence verified by compliance and operational approval recorded',
    );
    expect(created.status).toBe(201);
    const approvalId = created.body.approvalId as string;

    // Inserting a protected approval as runtime is refused by row level security.
    await expect(
      runtime.query(
        `INSERT INTO privileged_action_approvals
          (id, action_type, resource_type, resource_id, action_fingerprint, policy, approval_scope,
           required_assurance, requester_principal_id, reason, status, requested_at, expires_at)
         VALUES ($1,'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE','FINANCIAL_INSTITUTION',$2,
                 repeat('a',64),'{}','privileged:approve','MFA','forged','forged','APPROVED',now(),
                 now()+interval '1 day')`,
        [randomUUID(), institutionId],
      ),
    ).rejects.toThrow(/row-level security|permission denied|protected authority/i);

    // Updating the real protected approval to APPROVED changes nothing and leaves it REQUESTED.
    await runtime.query(
      `UPDATE privileged_action_approvals
          SET status='APPROVED', approved_by=$2, approved_at=now()
        WHERE id=$1`,
      [approvalId, controller.principalId],
    );
    expect(
      await adminOnDatabase.query(
        `SELECT status, approved_by FROM privileged_action_approvals WHERE id=$1`,
        [approvalId],
      ),
    ).toEqual([{ status: 'REQUESTED', approved_by: null }]);

    // Directly consuming or executing it is refused too.
    await runtime.query(
      `UPDATE privileged_action_approvals SET status='CONSUMED', consumed_at=now() WHERE id=$1`,
      [approvalId],
    );
    await expect(
      adminOnDatabase.query(
        `UPDATE financial_institutions
            SET status='APPROVED', status_reason='forged', lifecycle_approval_id=$2
          WHERE id=$1`,
        [institutionId, approvalId],
      ),
    ).rejects.toThrow(/consumed approval|protected approval|requires a consumed|lacks/i);
  });

  it('records immutable checker evidence and executes a legitimate MFA checker flow', async () => {
    const institutionId = await approvedInstitution();
    const created = await requestLifecycle(
      institutionId,
      'APPROVED',
      'Regulatory evidence verified by compliance and operational approval recorded',
    );
    expect(created.status).toBe(201);
    const approvalId = created.body.approvalId as string;
    expect((await approve(controller.token, approvalId)).status).toBe(201);
    const executed = await execute(institutionId, controller.token, approvalId, 'APPROVED');
    expect(executed.status).toBe(201);
    expect(executed.body.status).toBe('APPROVED');

    const decisions = await adminOnDatabase.query<any[]>(
      `SELECT decision, checker_principal_id, assurance_level
         FROM protected_authority.checker_decisions WHERE approval_id=$1`,
      [approvalId],
    );
    expect(decisions).toEqual([
      {
        decision: 'APPROVED',
        checker_principal_id: controller.principalId,
        assurance_level: 'MFA',
      },
    ]);
    const consumptions = await adminOnDatabase.query<any[]>(
      `SELECT executor_principal_id FROM protected_authority.approval_consumptions WHERE approval_id=$1`,
      [approvalId],
    );
    expect(consumptions).toEqual([{ executor_principal_id: controller.principalId }]);
    const evidence = await adminOnDatabase.query<any[]>(
      `SELECT count(*)::int AS count FROM governed_institution_lifecycle_executions WHERE approval_id=$1 AND NOT legacy_reserved`,
      [approvalId],
    );
    expect(evidence[0].count).toBe(1);

    // Replaying the identical authorized execution is still idempotent.
    const replay = await execute(institutionId, controller.token, approvalId, 'APPROVED');
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(executed.body);

    // A changed payload never reaches the consumed approval.
    const changed = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle`)
      .set(auth(controller.token))
      .send({
        approvalId,
        targetStatus: 'SUSPENDED',
        reason: 'Changed payload after approval',
      });
    expect(changed.status).not.toBe(201);

    // Reusing the consumed approval for a new transition is refused.
    const reused = await execute(institutionId, controller.token, approvalId, 'SUSPENDED');
    expect(reused.status).not.toBe(201);
  });

  it('still allows a legitimately newly approved transition', async () => {
    const institutionId = await approvedInstitution();
    const activ = await requestLifecycle(
      institutionId,
      'APPROVED',
      'Regulatory evidence verified by compliance and operational approval recorded',
    );
    expect(activ.status).toBe(201);
    expect((await approve(controller.token, activ.body.approvalId)).status).toBe(201);
    expect(
      (await execute(institutionId, controller.token, activ.body.approvalId, 'APPROVED')).status,
    ).toBe(201);
    const susp = await requestLifecycle(
      institutionId,
      'SUSPENDED',
      'Suspension approved after an independent regulatory review',
    );
    expect(susp.status).toBe(201);
    expect((await approve(controller.token, susp.body.approvalId)).status).toBe(201);
    const suspended = await execute(
      institutionId,
      controller.token,
      susp.body.approvalId,
      'SUSPENDED',
      'Suspension approved after an independent regulatory review',
    );
    expect(suspended.status).toBe(201);
    expect(suspended.body.status).toBe('SUSPENDED');
  });

  it('verifies the implemented boundary in production readiness', async () => {
    const inspection = await app.get(ProtectedAuthorityService).inspect();
    expect(inspection.status).toBe('verified');
    expect(inspection.observed.runtimeLoginRole).toBe(roles.runtimeRole);
    expect(inspection.observed.authorityLoginRole).toBe(roles.authorityRole);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await readiness.getReadiness();
      expect(result.protectedCheckerAuthority).toMatchObject({ status: 'verified' });
      expect(result.runtimeDatabaseRole.status).toBe('no_obvious_escalation');
      expect(result.status).toBe('ok');
      expect(result.reason).toBeNull();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('fails production readiness closed without a separate authority credential', async () => {
    const unconfigured = new ProtectedAuthorityService(runtime);
    expect(await unconfigured.inspect()).toMatchObject({ status: 'not_configured' });
    const singleRoleReadiness = new ProductionReadinessService(
      runtime,
      reconciliation,
      unconfigured,
    );
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await singleRoleReadiness.getReadiness();
      expect(result.status).toBe('error');
      expect(result.reason).toBe('protected_checker_authority_not_configured');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  // ------------------------------------------------------------------ helpers

  async function approve(token: string, approvalId: string) {
    return request(app.getHttpServer())
      .post(`${APPROVALS}/${approvalId}/approve`)
      .set(auth(token))
      .send({ comment: 'independent checker decision under protected authority' });
  }

  async function execute(
    institutionId: string,
    token: string,
    approvalId: string,
    targetStatus: string,
    reason = 'Regulatory evidence verified by compliance and operational approval recorded',
  ) {
    return request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle`)
      .set(auth(token))
      .send({ approvalId, targetStatus, reason });
  }
});
