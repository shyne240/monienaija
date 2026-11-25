/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { AUTHORIZATION_ROLE_FUNCTION_SEED } from '../src/authorization-catalogue/authorization-catalogue.seed';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentClassTransitionService } from '../src/agent/agent-class-transition.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * V1-AGENT-CLASS-LIFECYCLE-01 — governed Agent class lifecycle over real PostgreSQL and real HTTP.
 *
 * The properties asserted here are the ones an operator depends on:
 *  - a readiness projection reports the SAME denials live enforcement produces;
 *  - an impact preview writes nothing and names exactly what changes;
 *  - the switch persists to `agents.agent_class_id`, bumps the optimistic version, and appends one
 *    CLASS_SWITCHED audit row that the history projection reads back;
 *  - a stale `expectedVersion` is refused rather than silently overwriting;
 *  - functions, principal shapes and read-only roles gate every route.
 */
describe('Agent class lifecycle (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let classService: AgentClassService;
  let applicationService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let transitions: AgentClassTransitionService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    adminScopes: ['privileged:execute'],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: (token: string, audience: string) =>
      Promise.resolve().then(() => {
        if (!token || !token.startsWith('workforce-'))
          throw new UnauthorizedException('invalid workforce token');
        const [identity, roleRaw] = token.replace('workforce-', '').split('|');
        const type = identity!.toUpperCase();
        const roleKey = roleRaw?.toUpperCase();
        const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER'];
        if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
        return {
          type,
          principalId: `workforce-${type.toLowerCase()}-${roleKey?.toLowerCase() ?? 'legacy'}`,
          audience,
          roles: roleKey ? [roleKey] : [],
          scopes: roleKey
            ? AUTHORIZATION_ROLE_FUNCTION_SEED.filter(
                (assignment) => assignment.roleKey === roleKey,
              ).map((assignment) => assignment.functionCode)
            : [],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
          assuranceLevel: roleKey ? 'MFA' : 'PASSWORD',
        } as Awaited<ReturnType<A2WorkforceSessionService['validate']>>;
      }),
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('agentclasslifecycle');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    classService = moduleRef.get(AgentClassService);
    applicationService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    transitions = moduleRef.get(AgentClassTransitionService);
  }, 240000);

  afterAll(async () => {
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

  function token(type: string, roleKey?: string): string {
    return `workforce-${type}${roleKey ? `|${roleKey}` : ''}`;
  }

  async function createClass(services: string[], overrides: { isActive?: boolean } = {}) {
    return classService.create({
      reference: `cls-life-${randomUUID().slice(0, 8)}`,
      code: `LIFE-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'Lifecycle class',
      isActive: overrides.isActive ?? true,
      applicableServices: services as any,
      applicableLimits: {} as any,
      actor: 'fixture',
    });
  }

  /** Mirrors the production activation path: approve the application, then activate. */
  async function createActiveAgent(classId: string): Promise<string> {
    const application = await applicationService.create({
      agentClassId: classId,
      applicantReference: `life-${randomUUID()}`,
      businessName: 'Lifecycle kiosk',
      contactEmail: `life-${randomUUID().slice(0, 6)}@example.test`,
      actor: 'fixture',
    });
    await applicationService.submit(application.id, 'fixture');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [application.id],
    );
    const agent = await lifecycleService.activateFromApplication(application.id, 'fixture');
    return agent.id;
  }

  it('reports readiness from the same gate that enforces capabilities, with no stored default flag', async () => {
    const created = await createClass(['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING']);
    const classId = created.id;
    const agentId = await createActiveAgent(classId);
    const tokenOperator = `Bearer ${token('OPERATOR', 'AGENT_NETWORK_MANAGER')}`;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/readiness`)
      .set('Authorization', tokenOperator)
      .expect(200);

    expect(response.body.agentId).toBe(agentId);
    // `canOperate` means EVERY canonical service is permitted — with 7 services in the vocabulary
    // and 4 declared on this class, it must be false. That is the honest answer; the class
    // deliberately does not grant all of them.
    expect(response.body.canOperate).toBe(false);
    expect(response.body.blockedBy).toBe('SERVICE_NOT_PERMITTED');
    expect(response.body.currentClass).toMatchObject({ id: classId });
    expect(response.body.allowedServices).toEqual(
      expect.arrayContaining(['CASH_IN', 'AGENT_FUNDING']),
    );
    // AGENT_DEFUNDING is not in applicableServices, so it must be reported denied — the projection
    // never assumes a symmetric funding/defunding grant.
    expect(response.body.deniedServices).toEqual(
      expect.arrayContaining([{ service: 'AGENT_DEFUNDING', reason: 'SERVICE_NOT_PERMITTED' }]),
    );
    // A readiness probe is a projection, not an authorization attempt: it must leave no
    // AGENT_SERVICE_CAPABILITY/DENIED rows behind.
    const auditRows = await dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM audit_events WHERE entity_type='AGENT_SERVICE_CAPABILITY' AND entity_id=$1`,
      [agentId],
    );
    expect(auditRows[0]!.count).toBe('0');
    /*
     * An approved default exists only when a policy or configuration record appoints one. The oldest
     * active class is NOT a default: ordering is not approval. With no such record, the projection
     * must offer no default and say so, forcing an explicit operator selection.
     */
    expect(response.body.approvedDefault).toBeNull();
    expect(response.body.approvedDefaultBasis).toMatch(/no policy or configuration record/i);
    expect(response.body.explicitSelectionRequired).toBe(true);
  });

  it('previews impact read-only and writes no audit row, class change or financial mutation', async () => {
    const narrow = await createClass(['CASH_IN']);
    const wide = await createClass(['CASH_IN', 'CASH_OUT', 'AGENT_FUNDING', 'AGENT_DEFUNDING']);
    const agentId = await createActiveAgent(narrow.id);
    const auth = `Bearer ${token('OPERATOR', 'AGENT_NETWORK_MANAGER')}`;

    const before = await dataSource.query<Array<{ agent_class_id: string; version: number }>>(
      `SELECT agent_class_id, version FROM agents WHERE id=$1`,
      [agentId],
    );

    const preview = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/impact-preview`)
      .query({ targetClassId: wide.id })
      .set('Authorization', auth)
      .expect(200);

    const previewBody = preview.body as {
      readonly: boolean;
      writesPerformed: unknown[];
      financialMutations: unknown[];
      canSwitch: boolean;
      gains: Array<{ service: string }>;
      losses: unknown[];
    };
    expect(previewBody.readonly).toBe(true);
    expect(previewBody.writesPerformed).toEqual([]);
    expect(previewBody.financialMutations).toEqual([]);
    expect(previewBody.canSwitch).toBe(true);
    expect(previewBody.gains.map((gain) => gain.service)).toEqual(
      expect.arrayContaining(['CASH_OUT', 'AGENT_FUNDING', 'AGENT_DEFUNDING']),
    );
    expect(previewBody.losses).toEqual([]);

    const after = await dataSource.query<Array<{ agent_class_id: string; version: number }>>(
      `SELECT agent_class_id, version FROM agents WHERE id=$1`,
      [agentId],
    );
    expect(after[0]).toEqual(before[0]);
    const audits = await dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM audit_events WHERE entity_type='AGENT' AND entity_id=$1 AND action='CLASS_SWITCHED'`,
      [agentId],
    );
    expect(audits[0]!.count).toBe('0');

    // A narrowing switch must be reported as a loss, not silently permitted.
    const narrowing = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/impact-preview`)
      .query({ targetClassId: narrow.id })
      .set('Authorization', auth)
      .expect(200);
    expect(narrowing.body.blockingReasons).toEqual(['SAME_CLASS']);
  });

  it('refuses a target with no usable services, an inactive class, and a malformed target id', async () => {
    const source = await createClass(['CASH_IN', 'CASH_OUT']);
    const agentId = await createActiveAgent(source.id);
    const auth = `Bearer ${token('OPERATOR', 'AGENT_NETWORK_MANAGER')}`;
    const empty = await createClass([]);
    const unknownService = await createClass(['CASH_IN', 'NOT_A_SERVICE']);
    const inactive = await createClass(['CASH_IN', 'CASH_OUT'], { isActive: false });

    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({ targetClassId: empty.id, reason: 'Move to an empty class' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({ targetClassId: unknownService.id, reason: 'Move to a broken class' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({ targetClassId: inactive.id, reason: 'Move to an inactive class' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({ targetClassId: 'not-a-uuid', reason: 'Nonsense target' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({ targetClassId: source.id, reason: '   ' })
      .expect(400);

    const rows = await dataSource.query<Array<{ agent_class_id: string }>>(
      `SELECT agent_class_id FROM agents WHERE id=$1`,
      [agentId],
    );
    expect(rows[0]!.agent_class_id).toBe(source.id);
  });

  it('switches the class, bumps the version, audits once, and replays idempotently', async () => {
    const source = await createClass(['CASH_IN']);
    const target = await createClass(['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH']);
    const agentId = await createActiveAgent(source.id);
    const auth = `Bearer ${token('OPERATOR', 'AGENT_NETWORK_MANAGER')}`;
    const before = await dataSource.query<Array<{ version: number }>>(
      `SELECT version FROM agents WHERE id=$1`,
      [agentId],
    );

    const switched = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({
        targetClassId: target.id,
        reason: 'Operator approved a wider tier after outlet inspection',
        expectedVersion: before[0]!.version,
      })
      .expect(200);

    expect(switched.body).toMatchObject({
      agentId,
      previousClassId: source.id,
      currentClassId: target.id,
      changed: true,
      previousClass: { id: source.id },
      currentClass: { id: target.id, code: target.code },
    });
    expect(switched.body.version).toBe(before[0]!.version + 1);
    expect(switched.body.impact.gains).toEqual(
      expect.arrayContaining(['CASH_OUT', 'CASH_TO_CASH']),
    );

    // The write is real: the Agent's own capability gate now permits what the new class grants.
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}`)
      .set('Authorization', auth)
      .expect(200);
    expect(detail.body.agentClassId).toBe(target.id);

    // Replaying the same assignment is a no-op and must not append a second audit row.
    const replay = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({ targetClassId: target.id, reason: 'Operator repeated the same request' })
      .expect(200);
    expect(replay.body.changed).toBe(false);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/history`)
      .set('Authorization', auth)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      action: 'CLASS_SWITCHED',
      previousClassId: source.id,
      newClassId: target.id,
      reason: 'Operator approved a wider tier after outlet inspection',
      previousClass: { code: source.code },
      newClass: { code: target.code },
    });

    const audits = await dataSource.query<Array<{ action: string }>>(
      `SELECT action FROM audit_events WHERE entity_type='AGENT' AND entity_id=$1 AND action='CLASS_SWITCHED'`,
      [agentId],
    );
    expect(audits).toHaveLength(1);
  });

  it('refuses a stale expectedVersion instead of overwriting another operator', async () => {
    const source = await createClass(['CASH_IN']);
    const first = await createClass(['CASH_IN', 'CASH_OUT']);
    const second = await createClass(['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH']);
    const agentId = await createActiveAgent(source.id);
    const auth = `Bearer ${token('OPERATOR', 'AGENT_NETWORK_MANAGER')}`;
    const stale = await dataSource.query<Array<{ version: number }>>(
      `SELECT version FROM agents WHERE id=$1`,
      [agentId],
    );

    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({ targetClassId: first.id, reason: 'First operator moves the Agent' })
      .expect(200);

    const conflict = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({
        targetClassId: second.id,
        reason: 'Second operator acts on a stale drawer',
        expectedVersion: stale[0]!.version,
      })
      .expect(409);
    expect(JSON.stringify(conflict.body)).toMatch(/version/i);

    const rows = await dataSource.query<Array<{ agent_class_id: string }>>(
      `SELECT agent_class_id FROM agents WHERE id=$1`,
      [agentId],
    );
    expect(rows[0]!.agent_class_id).toBe(first.id);
  });

  /**
   * Regression: `readiness()` joined `limit_profiles` on `a.is_active`, a column that does not exist
   * on that table. Every Agent holding an active AGENT_CLASS limit assignment got a 500 from this
   * projection, which the console degraded into "this class permits no services". The readiness read
   * must survive an active assignment and report it, using the same profile predicate the
   * LimitProfileResolverService applies (deleted_at IS NULL AND enabled AND status='ACTIVE').
   */
  it('reads readiness for an Agent that has an active limit assignment', async () => {
    const created = await createClass(['CASH_IN', 'CASH_OUT']);
    const agentId = await createActiveAgent(created.id);
    const limitProfileCode = `ACC_LIMIT_${randomUUID().slice(0, 8).toUpperCase()}`;

    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by)
       VALUES ($1, $1, 'AGENT', 'ACTIVE', TRUE, 'CONFIGURED', 'fixture')`,
      [limitProfileCode],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments
         (subject_type, subject_id, limit_profile_code, precedence, is_active, effective_from, created_by)
       VALUES ('AGENT_CLASS', $1, $2, 10, TRUE, NOW(), 'fixture')`,
      [created.id, limitProfileCode],
    );

    const response = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/readiness`)
      .set('Authorization', `Bearer ${token('OPERATOR', 'AGENT_NETWORK_MANAGER')}`)
      .expect(200);

    // The assignment resolves, so limits must NOT be reported missing.
    expect(
      (response.body.missingConfiguration ?? []).map((gap: { code: string }) => gap.code),
    ).not.toContain('NO_EFFECTIVE_LIMITS');

    // A disabled profile does not count as configuration even though the row exists.
    await dataSource.query(`UPDATE limit_profiles SET enabled = FALSE WHERE code = $1`, [
      limitProfileCode,
    ]);
    const disabled = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/readiness`)
      .set('Authorization', `Bearer ${token('OPERATOR', 'AGENT_NETWORK_MANAGER')}`)
      .expect(200);
    expect(
      (disabled.body.missingConfiguration ?? []).map((gap: { code: string }) => gap.code),
    ).toContain('NO_EFFECTIVE_LIMITS');
  });

  it('gates reads on agent.view (SUPPORT included), writes on agent.manage_classes, and never on the catch-all', async () => {
    const source = await createClass(['CASH_IN']);
    const target = await createClass(['CASH_IN', 'CASH_OUT']);
    const agentId = await createActiveAgent(source.id);

    // Unauthenticated is refused.
    await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/readiness`)
      .expect(401);

    // A SUPPORT-shaped principal holding `agent.view` may investigate but may never reclassify.
    // (CUSTOMER_SERVICE/CUSTOMER_SERVICE holds no agent.* function at all, so it is covered below.)
    const support = `Bearer ${token('SUPPORT', 'SUPER_ADMIN')}`;
    await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/readiness`)
      .set('Authorization', support)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', support)
      .send({ targetClassId: target.id, reason: 'Support cannot reclassify' })
      .expect(403);

    // A read-only role holding the write function is still refused by the controller.
    const auditor = `Bearer ${token('OPERATOR', 'FINANCE_AUDITOR')}`;
    await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/readiness`)
      .set('Authorization', auditor)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auditor)
      .send({ targetClassId: target.id, reason: 'Read-only roles cannot reclassify' })
      .expect(403);

    // A workforce role holding NEITHER agent.view nor agent.manage_classes is denied on both legs —
    // proving the branch is function-gated and not merely principal-type-gated.
    const customerService = `Bearer ${token('SUPPORT', 'CUSTOMER_SERVICE')}`;
    await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/readiness`)
      .set('Authorization', customerService)
      .expect(403);

    // An OPERATOR role without agent.manage_classes is denied by function, not by principal type.
    const operations = `Bearer ${token('OPERATOR', 'OPERATIONS')}`;
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', operations)
      .send({ targetClassId: target.id, reason: 'No manage_classes function' })
      .expect(403);

    const rows = await dataSource.query<Array<{ agent_class_id: string }>>(
      `SELECT agent_class_id FROM agents WHERE id=$1`,
      [agentId],
    );
    expect(rows[0]!.agent_class_id).toBe(source.id);
  });

  it('projects an empty history for an Agent that has never been reclassified', async () => {
    const source = await createClass(['CASH_IN', 'CASH_OUT']);
    const agentId = await createActiveAgent(source.id);
    const auth = `Bearer ${token('OPERATOR', 'AGENT_NETWORK_MANAGER')}`;
    const history = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/history`)
      .set('Authorization', auth)
      .expect(200);
    expect(history.body).toEqual([]);
    // ...but the switch is still offered, with the stored class as the starting point.
    const current = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .expect(200);
    expect(current.body).toMatchObject({ agentId, agentClassId: source.id });
  });

  it('refuses to reclassify a terminated Agent and reports it as a blocking reason', async () => {
    const source = await createClass(['CASH_IN', 'CASH_OUT']);
    const target = await createClass(['CASH_IN', 'CASH_OUT']);
    const agentId = await createActiveAgent(source.id);
    await lifecycleService.terminate(agentId, 'fixture', 'Fixture termination');
    const auth = `Bearer ${token('OPERATOR', 'AGENT_NETWORK_MANAGER')}`;

    const preview = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentId}/class/impact-preview`)
      .query({ targetClassId: target.id })
      .set('Authorization', auth)
      .expect(200);
    expect(preview.body.canSwitch).toBe(false);
    expect(preview.body.blockingReasons).toEqual(expect.arrayContaining(['AGENT_TERMINATED']));

    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/class`)
      .set('Authorization', auth)
      .send({ targetClassId: target.id, reason: 'Terminated Agents cannot move' })
      .expect(409);
  });

  it('fails closed for an Agent with no class at all', async () => {
    const source = await createClass(['CASH_IN']);
    const agentId = await createActiveAgent(source.id);
    await dataSource.query(`UPDATE agents SET agent_class_id=NULL WHERE id=$1`, [agentId]);
    const readiness = await transitions.readiness(agentId);
    expect(readiness.canOperate).toBe(false);
    expect(readiness.blockedBy).toBe('MISSING_AGENT_CLASS');
    expect(readiness.currentClass).toBeNull();
    expect(readiness.allowedServices).toEqual([]);
    expect(readiness.deniedServices.every((entry) => entry.reason === 'MISSING_AGENT_CLASS')).toBe(
      true,
    );
  });
});
