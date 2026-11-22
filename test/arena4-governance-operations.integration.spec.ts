/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { ValidationPipe } from '@nestjs/common';
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
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * ARENA 4 — real PostgreSQL + real HTTP authorization and governance suite for the three
 * administrative surfaces: Notification Operations, Workforce Administration visibility and
 * Operational Audit inspection.
 *
 * Every assertion is about the authoritative boundary: which catalogue function admits a
 * principal, which records are hidden by default, and which sensitive fields never cross the
 * read boundary. No test double stands in for PostgreSQL, and no route is mocked.
 */
describe('Arena 4 governance and operations (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

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
        if (!token || !token.startsWith('workforce-')) throw new Error('invalid token');
        const [identity, roleRaw] = token.replace('workforce-', '').split('|');
        const type = identity!.toUpperCase();
        const roleKey = roleRaw?.toUpperCase();
        // DELIVERY_ONLY models a principal holding exactly the delivery-visibility function
        // without notification.provider.view, to prove the two-tier provider projection.
        const catalogueScopes =
          roleKey === 'DELIVERY_ONLY'
            ? ['notification.view_deliveries']
            : roleKey
              ? AUTHORIZATION_ROLE_FUNCTION_SEED.filter(
                  (assignment) => assignment.roleKey === roleKey,
                ).map((assignment) => assignment.functionCode)
              : [];
        return {
          type,
          principalId: `workforce-${type.toLowerCase()}-${roleKey?.toLowerCase() ?? 'legacy'}`,
          audience,
          roles: roleKey && roleKey !== 'DELIVERY_ONLY' ? [roleKey] : [],
          scopes: catalogueScopes,
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
          assuranceLevel: 'MFA',
        } as Awaited<ReturnType<A2WorkforceSessionService['validate']>>;
      }),
  };

  const deliveryId = randomUUID();
  const approvalId = randomUUID();
  const allowedDecisionId = randomUUID();
  const deniedDecisionId = randomUUID();
  const complianceCaseAuditId = randomUUID();
  const providerAuditId = randomUUID();
  const approvalAuditId = randomUUID();
  const institutionId = randomUUID();
  const institutionScopedAuditId = randomUUID();
  const workforcePrincipalId = 'workforce-principal-a';

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('arena4gov');
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await seed();
  }, 180000);

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

  async function seed(): Promise<void> {
    await dataSource.query(
      `INSERT INTO notification_deliveries
        (id, event_type, event_key, aggregate_type, recipient_type, recipient_id, channel,
         destination, payload, message, rendered_html, status, attempts, provider_ref,
         correlation_id, last_error, next_attempt_at, created_at, updated_at, failed_at)
       VALUES ($1,'PAYMENT_RECEIVED','evt-arena4-1','TRANSFER','PHONE','+2348012345678','SMS',
         '+2348012345678','{"pin":"do-not-leak"}','Internal message body','<p>rendered secret</p>',
         'FAILED',2,'raw-provider-reference-secret','corr-arena4-1','ATTEMPTS_EXHAUSTED',
         NOW() + INTERVAL '60 seconds', NOW(), NOW(), NOW())`,
      [deliveryId],
    );
    await dataSource.query(
      `INSERT INTO notification_delivery_attempts
        (delivery_id, attempt_number, lease_token, status, reason, claimed_at, started_at, finished_at)
       VALUES
        ($1,1,$2,'FAILED','ROBASE_HTTP_500: raw upstream body',NOW(),NOW(),NOW()),
        ($1,2,$3,'FAILED','ATTEMPTS_EXHAUSTED',NOW(),NOW(),NOW())`,
      [deliveryId, randomUUID(), randomUUID()],
    );

    await dataSource.query(
      `INSERT INTO privileged_action_approvals
        (id, action_type, resource_type, resource_id, action_fingerprint, policy, approval_scope,
         requester_principal_id, reason, status, requested_at, expires_at, approved_at, approved_by)
       VALUES ($1,'FINANCE_ROLE_ASSIGN','A2_FINANCE_ROLE_ASSIGNMENT',$2,$3,'{}'::jsonb,
         'FINANCE_ROLE_ASSIGN:single','workforce-operator-finance_controller',
         'Grant finance role under two-person control','APPROVED',NOW(),NOW() + INTERVAL '1 hour',
         NOW(),'workforce-operator-super_admin')`,
      [approvalId, workforcePrincipalId, 'a'.repeat(64)],
    );

    const insertAudit = (
      id: string,
      entityType: string,
      entityId: string,
      action: string,
      actor: string,
      correlationId: string | null,
      newValues: unknown,
    ) =>
      dataSource.query(
        `INSERT INTO audit_events (id, entity_type, entity_id, action, actor, correlation_id, new_values)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [id, entityType, entityId, action, actor, correlationId, JSON.stringify(newValues)],
      );

    await insertAudit(
      allowedDecisionId,
      'AUTHORIZATION_DECISION',
      allowedDecisionId,
      'READ',
      'operator-arena4',
      'corr-arena4-1',
      { allowed: true, resourceType: 'customer', action: 'customer.view' },
    );
    await insertAudit(
      deniedDecisionId,
      'AUTHORIZATION_DECISION',
      deniedDecisionId,
      'EXECUTE',
      'operator-arena4',
      'operator@example.com',
      {
        allowed: false,
        resourceType: 'ledger',
        action: 'ledger.post',
        institutionId,
      },
    );
    await insertAudit(
      institutionScopedAuditId,
      'BANKING_RECONCILIATION_RUN',
      institutionScopedAuditId,
      'RECONCILE',
      'operator-arena4',
      null,
      { institutionId },
    );
    await insertAudit(
      complianceCaseAuditId,
      'CUSTOMER_COMPLIANCE_CASE',
      complianceCaseAuditId,
      'OPEN',
      'operator-arena4',
      null,
      { category: 'AML', customerId: allowedDecisionId },
    );
    await insertAudit(
      providerAuditId,
      'NOTIFICATION_PROVIDER_CONFIG',
      providerAuditId,
      'PROPOSE',
      'operator-arena4',
      null,
      { provider: 'robase', keyFingerprint: 'masked', baseUrl: 'https://provider.example' },
    );
    await insertAudit(
      approvalAuditId,
      'PRIVILEGED_ACTION_APPROVAL',
      approvalId,
      'APPROVE',
      'workforce-operator-super_admin',
      'corr-approval-arena4',
      { status: 'APPROVED', approvalIds: [approvalId] },
    );

    await dataSource.query(
      `INSERT INTO financial_institutions
        (id, reference, code, legal_name, institution_type, created_by)
       VALUES ($1,'INST-ARENA4','AR4','Arena 4 Test Bank','PSP','test-suite')`,
      [institutionId],
    );
    await dataSource.query(
      `INSERT INTO a2_finance_role_assignments
        (id, assignment_reference, assignment_version, principal_id, role_key, scopes, status,
         interim, effective_from, effective_to, assigned_by, assigned_at, approval_ids,
         audit_references)
       VALUES ($1,'ARENA4-ASSIGN-1',1,$2,'SUPER_ADMIN','[]'::jsonb,'ACTIVE',false,
         NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'test-suite', NOW(),
         '[]'::jsonb, '[]'::jsonb)`,
      [randomUUID(), workforcePrincipalId],
    );
    await dataSource.query(
      `INSERT INTO a2_workforce_sessions
        (id, principal_id, issuer, subject, token_hash, audience, status, assurance_level,
         roles, scopes, assertion_evidence, authenticated_at, issued_at, expires_at, last_seen_at)
       VALUES ($1,$2,'https://workforce.test','subject-arena4',$3,'workforce-admin','ACTIVE','MFA',
         '["SUPER_ADMIN"]'::jsonb,'[]'::jsonb,'{}'::jsonb,NOW(),NOW(),
         NOW() + INTERVAL '15 minutes',NOW())`,
      [randomUUID(), workforcePrincipalId, 'b'.repeat(64)],
    );
    await dataSource.query(
      `INSERT INTO workforce_institution_assignments
        (principal_id, institution_id, status, granted_by)
       VALUES ($1,$2,'ACTIVE','test-suite')`,
      [workforcePrincipalId, institutionId],
    );
  }

  const token = (type: string, roleKey: string) => `workforce-${type}|${roleKey}`;
  const get = (path: string, bearer?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return bearer ? req.set('Authorization', `Bearer ${bearer}`) : req;
  };

  describe('unauthenticated and unprivileged rejection', () => {
    it('rejects every new administrative surface without a credential', async () => {
      await get('/api/v1/internal/notifications/operations/summary').expect(401);
      await get(`/api/v1/internal/notifications/deliveries/${deliveryId}`).expect(401);
      await get('/api/v1/internal/workforce/directory').expect(401);
      await get('/api/v1/internal/audit/inspection').expect(401);
    });

    it('denies a role that does not hold the required catalogue functions', async () => {
      // OPERATIONS holds notification.view_deliveries but neither workforce.role.view nor
      // audit.view/audit.search.
      await get('/api/v1/internal/workforce/directory', token('OPERATOR', 'OPERATIONS')).expect(
        403,
      );
      await get('/api/v1/internal/audit/inspection', token('OPERATOR', 'OPERATIONS')).expect(403);
    });

    it('rejects non-workforce principal types on the audit inspection surface', async () => {
      await get('/api/v1/internal/audit/inspection', 'workforce-CUSTOMER').expect(403);
      const agent = await get('/api/v1/internal/workforce/directory', 'workforce-AGENT');
      expect([401, 403]).toContain(agent.status);
    });
  });

  describe('Notification Operations', () => {
    it('reports delivery status, failure diagnostics and retry backlog to OPERATIONS', async () => {
      const res = await get(
        '/api/v1/internal/notifications/operations/summary?hours=24',
        token('OPERATOR', 'OPERATIONS'),
      ).expect(200);
      expect(res.body.retryPolicy.manualRetrySupported).toBe(false);
      // OPERATIONS holds notification.provider.view in the approved catalogue, so it correctly
      // receives the FULL provider projection. The MINIMAL tier is proven separately below.
      expect(res.body.provider.projectionScope).toBe('FULL');
      expect(
        res.body.failureDiagnostics.some(
          (row: { errorCode: string }) => row.errorCode === 'ATTEMPTS_EXHAUSTED',
        ),
      ).toBe(true);
      expect(res.body.retryBacklog.failedAwaitingRetry).toBeGreaterThanOrEqual(1);
    });

    it('projects provider identity only for notification.provider.view holders', async () => {
      const deliveryOnly = await get(
        '/api/v1/internal/notifications/operations/summary',
        token('OPERATOR', 'DELIVERY_ONLY'),
      ).expect(200);
      expect(deliveryOnly.body.provider.projectionScope).toBe('MINIMAL');
      expect(JSON.stringify(deliveryOnly.body)).not.toContain('robase');

      const superAdmin = await get(
        '/api/v1/internal/notifications/operations/summary',
        token('OPERATOR', 'SUPER_ADMIN'),
      ).expect(200);
      expect(superAdmin.body.provider.projectionScope).toBe('FULL');
      expect(superAdmin.body.retryPolicy.automaticRetry.visibility).toBe('FULL');
    });

    it('returns per-attempt retry history with the read boundary enforced', async () => {
      const res = await get(
        `/api/v1/internal/notifications/deliveries/${deliveryId}`,
        token('OPERATOR', 'SUPER_ADMIN'),
      ).expect(200);

      expect(res.body.attempts).toHaveLength(2);
      expect(res.body.attempts[0].attemptNumber).toBe(1);
      expect(res.body.attempts[0].reason).toBe('UNCLASSIFIED');
      expect(res.body.attempts[1].reason).toBe('ATTEMPTS_EXHAUSTED');
      expect(res.body.retry.manualRetrySupported).toBe(false);
      expect(res.body.idempotency.uniqueOn).toBe('EVENT_KEY_RECIPIENT_CHANNEL');
      expect(res.body.idempotency.eventKey).toBe('evt-arena4-1');

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('do-not-leak');
      expect(serialized).not.toContain('Internal message body');
      expect(serialized).not.toContain('rendered secret');
      expect(serialized).not.toContain('raw-provider-reference-secret');
      expect(serialized).not.toContain('+2348012345678');
      expect(serialized).not.toContain('raw upstream body');
      expect(serialized).not.toContain('leaseToken');
    });

    it('has no retry mutation surface at all', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/internal/notifications/deliveries/${deliveryId}/retry`)
        .set('Authorization', `Bearer ${token('OPERATOR', 'SUPER_ADMIN')}`)
        .send({ reason: 'operator requested retry' })
        .expect(404);
      const rows = await dataSource.query<Array<{ status: string; attempts: number }>>(
        `SELECT status, attempts FROM notification_deliveries WHERE id=$1`,
        [deliveryId],
      );
      expect(rows[0]).toEqual({ status: 'FAILED', attempts: 2 });
    });

    it('validates filters and identifiers', async () => {
      await get(
        '/api/v1/internal/notifications/operations/summary?hours=0',
        token('OPERATOR', 'OPERATIONS'),
      ).expect(400);
      await get(
        '/api/v1/internal/notifications/deliveries/not-a-uuid',
        token('OPERATOR', 'OPERATIONS'),
      ).expect(400);
      await get(
        `/api/v1/internal/notifications/deliveries/${randomUUID()}`,
        token('OPERATOR', 'OPERATIONS'),
      ).expect(404);
      await get(
        '/api/v1/internal/notifications/deliveries?from=not-a-date',
        token('OPERATOR', 'OPERATIONS'),
      ).expect(400);
    });
  });

  describe('Workforce Administration visibility', () => {
    it('shows roles, effective permissions and institution scope to an authorized reader', async () => {
      const res = await get(
        '/api/v1/internal/workforce/directory',
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(200);
      expect(res.body.accessMode).toBe('READ_ONLY');
      const entry = res.body.data.find(
        (row: { principalId: string }) => row.principalId === workforcePrincipalId,
      );
      expect(entry).toBeDefined();
      expect(entry.roles[0].roleKey).toBe('SUPER_ADMIN');
      expect(entry.institutionScope.mode).toBe('INSTITUTIONS');
      expect(entry.institutionScope.active[0].institutionId).toBe(institutionId);
      expect(entry.permissionCount).toBeGreaterThan(0);

      const detail = await get(
        `/api/v1/internal/workforce/directory/${workforcePrincipalId}`,
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(200);
      expect(detail.body.boundaries.readOnly).toBe(true);
      expect(
        detail.body.effectivePermissions.some(
          (permission: { functionCode: string }) => permission.functionCode === 'audit.view',
        ),
      ).toBe(true);
      expect(detail.body.administrativeAuthorizations.length).toBeGreaterThan(0);
      expect(detail.body.sessions[0].status).toBe('ACTIVE');
      // Session evidence must never include the token hash or OIDC subject.
      const serialized = JSON.stringify(detail.body);
      expect(serialized).not.toContain('bbbbbbbb');
      expect(serialized).not.toContain('subject-arena4');
    });

    it('supports role, institution and status filters', async () => {
      const byRole = await get(
        '/api/v1/internal/workforce/directory?roleKey=SUPER_ADMIN',
        token('OPERATOR', 'ADMINISTRATOR'),
      ).expect(200);
      expect(
        byRole.body.data.some(
          (row: { principalId: string }) => row.principalId === workforcePrincipalId,
        ),
      ).toBe(true);

      const byInstitution = await get(
        `/api/v1/internal/workforce/directory?institutionId=${institutionId}`,
        token('OPERATOR', 'ADMINISTRATOR'),
      ).expect(200);
      expect(byInstitution.body.data).toHaveLength(1);

      const byStatus = await get(
        '/api/v1/internal/workforce/directory?status=NO_CURRENT_GRANT',
        token('OPERATOR', 'ADMINISTRATOR'),
      ).expect(200);
      expect(byStatus.body.data).toHaveLength(0);
    });

    it('does not expose a write surface for grants', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/internal/workforce/directory')
        .set('Authorization', `Bearer ${token('OPERATOR', 'ADMINISTRATOR')}`)
        .send({ principalId: workforcePrincipalId, roleKey: 'SUPER_ADMIN' })
        .expect(404);
      const rows = await dataSource.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM a2_finance_role_assignments WHERE principal_id=$1`,
        [workforcePrincipalId],
      );
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('Operational Audit inspection', () => {
    it('filters by outcome, actor and institution while enforcing default exclusions', async () => {
      const allowed = await get(
        '/api/v1/internal/audit/inspection?outcome=ALLOWED&actor=operator-arena4',
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(200);
      expect(allowed.body.accessMode).toBe('READ_ONLY');
      expect(allowed.body.data).toHaveLength(1);
      expect(allowed.body.data[0].outcome).toBe('ALLOWED');

      const denied = await get(
        '/api/v1/internal/audit/inspection?outcome=DENIED&actor=operator-arena4',
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(200);
      expect(denied.body.data).toHaveLength(1);
      expect(denied.body.data[0].outcome).toBe('DENIED');
      expect(denied.body.data[0].id).toBe(deniedDecisionId);
      expect(denied.body.data[0].institutionId).toBe(institutionId);
      // A credential-shaped correlation id must never be echoed.
      expect(denied.body.data[0].correlationId).not.toContain('@');

      const institution = await get(
        `/api/v1/internal/audit/inspection?institutionId=${institutionId}`,
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(200);
      const institutionIds = institution.body.data.map((row: { id: string }) => row.id);
      expect(institutionIds).toContain(deniedDecisionId);
      expect(institutionIds).toContain(institutionScopedAuditId);
      expect(institution.body.total).toBeGreaterThanOrEqual(2);

      const compliance = await get(
        '/api/v1/internal/audit/inspection?entityType=CUSTOMER_COMPLIANCE_CASE',
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(200);
      expect(compliance.body.data).toHaveLength(0);
      expect(compliance.body.excludedCategories).toContain('CUSTOMER_COMPLIANCE_CASE');

      const provider = await get(
        '/api/v1/internal/audit/inspection?entityType=NOTIFICATION_PROVIDER_CONFIG',
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(200);
      expect(provider.body.data).toHaveLength(0);
    });

    it('returns approval history for a governed action and never returns an excluded record', async () => {
      const detail = await get(
        `/api/v1/internal/audit/inspection/${approvalAuditId}`,
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(200);
      expect(detail.body.event.entityType).toBe('PRIVILEGED_ACTION_APPROVAL');
      expect(detail.body.approvalHistory).toHaveLength(1);
      expect(detail.body.approvalHistory[0].id).toBe(approvalId);
      expect(detail.body.approvalHistory[0].status).toBe('APPROVED');
      expect(detail.body.accessMode).toBe('READ_ONLY');

      await get(
        `/api/v1/internal/audit/inspection/${complianceCaseAuditId}`,
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(404);
      await get(
        `/api/v1/internal/audit/inspection/${providerAuditId}`,
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(404);
      await get(
        `/api/v1/internal/audit/inspection/${randomUUID()}`,
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(404);
    });

    it('validates filters before querying', async () => {
      await get(
        '/api/v1/internal/audit/inspection?institutionId=not-a-uuid',
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(400);
      await get(
        '/api/v1/internal/audit/inspection?outcome=MAYBE',
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(400);
      await get(
        '/api/v1/internal/audit/inspection?from=2026-11-22T00:00:00Z&to=2026-11-21T00:00:00Z',
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(400);
      await get(
        '/api/v1/internal/audit/inspection?limit=500',
        token('OPERATOR', 'FINANCE_AUDITOR'),
      ).expect(400);
    });
  });
});
