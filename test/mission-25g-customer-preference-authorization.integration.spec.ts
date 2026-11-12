/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports */
/**
 * Mission 25G: real HTTP, the actual RuntimeAccessGuard, persisted customer/A2 sessions,
 * seeded role catalogue and disposable PostgreSQL. Only the notification transport is fake.
 */
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import {
  CustomerLanguage,
  CustomerTheme,
} from '../src/customer-preference/customer-preference.enums';
import { CustomerPreferenceService } from '../src/customer-preference/customer-preference.service';
import { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import { NotificationDeliveryProcessor } from '../src/notification/notification-delivery-processor';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { NotificationTemplateService } from '../src/notification/notification-template.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { AuditService } from '../src/operations/audit.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const ROLES = [
  'SUPER_ADMIN',
  'FINANCE_PREPARER',
  'FINANCE_CONTROLLER',
  'FINANCE_AUDITOR',
  'OPERATIONS',
  'AGENT_NETWORK_MANAGER',
  'COMPLIANCE',
  'RISK_FRAUD',
  'CUSTOMER_SERVICE',
  'TREASURY',
  'ADMINISTRATOR',
];
const CREATE = {
  language: CustomerLanguage.EN,
  theme: CustomerTheme.SYSTEM,
  notifications: { email: true, sms: true, push: true, inApp: true },
  security: {
    loginAlerts: true,
    transactionAlerts: true,
    deviceRegistrationAlerts: true,
    biometricAllowed: false,
  },
};
const CUSTOMER_PASSWORD = 'synthetic-25g-test-password';

function passwordHash(): string {
  const salt = Buffer.from('mission-25g-test-salt');
  const digest = pbkdf2Sync(CUSTOMER_PASSWORD, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function path(id: string): string {
  return `/api/v1/customers/${id}/preferences`;
}

describe('Mission 25G preference authorization and attribution (real guard + PostgreSQL)', () => {
  let ds: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let preferences: CustomerPreferenceService;
  let dispatcher: NotificationDispatcherService;
  let resolver: NotificationChannelResolverService;
  let templates: NotificationTemplateService;
  let audit: AuditService;
  let provider: TestNotificationProvider;
  let phoneCounter = 1000000;

  beforeAll(async () => {
    ds = await createIntegrationDataSource('mission25gpreferences');
    provider = new TestNotificationProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(ds)
      // This is the transport, not an authentication/authorization dependency.
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = moduleRef.get(A2WorkforceSessionService);
    preferences = moduleRef.get(CustomerPreferenceService);
    dispatcher = moduleRef.get(NotificationDispatcherService);
    resolver = moduleRef.get(NotificationChannelResolverService);
    templates = moduleRef.get(NotificationTemplateService);
    audit = moduleRef.get(AuditService);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (ds) await destroyIntegrationDataSource(ds);
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(ds);
    provider.clear();
  });

  async function customer(
    withSession = true,
  ): Promise<{ id: string; token: string; phone: string }> {
    const id = randomUUID();
    const phone = `801${String(phoneCounter++).padStart(7, '0')}`;
    await ds.query(
      `INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status)
       VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [id, `m25g-${id}`],
    );
    await ds.query(
      `INSERT INTO customer_profiles (customer_id,display_name,is_active) VALUES ($1,'Synthetic Customer',true)`,
      [id],
    );
    await ds.query(
      `INSERT INTO customer_contact_methods (customer_id,type,value,normalized_value,is_primary,verified_at)
       VALUES ($1,'PHONE',$2,$2,true,NOW())`,
      [id, phone],
    );
    if (!withSession) return { id, token: '', phone };
    await ds.query(
      `INSERT INTO customer_authentication_credentials
       (customer_id,password_hash,hash_algorithm,password_version,password_changed_at,status,account_locked,failed_authentication_count,version)
       VALUES ($1,$2,'PBKDF2',1,NOW(),'ACTIVE',false,0,1)`,
      [id, passwordHash()],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId: id, password: CUSTOMER_PASSWORD })
      .expect(200);
    expect(login.body.customerId).toBe(id);
    return { id, token: login.body.accessToken as string, phone };
  }

  async function workforce(roleKey: string): Promise<string> {
    const principalId = `mission25g:${roleKey}:${randomUUID()}`;
    const now = new Date();
    await ds.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `mission25g:${principalId}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 86_400_000),
      assignedBy: 'synthetic-test',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    } as any);
    const result = await sessions.establish({
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
      signingKeyId: 'synthetic-test-key',
    });
    const resolved = await sessions.validate(result.accessToken, 'workforce-admin');
    expect(resolved.roles).toContain(roleKey);
    if (roleKey === 'CUSTOMER_SERVICE') expect(resolved.scopes).toContain('customer.view');
    if (roleKey === 'TREASURY') expect(resolved.scopes).not.toContain('customer.view');
    if (roleKey === 'FINANCE_AUDITOR') expect(resolved.readOnlyPrincipal).toBe(true);
    return result.accessToken;
  }

  async function agentToken(): Promise<string> {
    const classes: Array<{ id: string }> = await ds.query(
      `INSERT INTO agent_classes (reference,code,name,is_active,applicable_services,applicable_limits)
       VALUES ($1,$2,'Synthetic 25G agent class',true,$3,$4) RETURNING id`,
      [
        `m25g-class-${randomUUID()}`,
        `25G-${randomUUID().slice(0, 6)}`,
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agents: Array<{ id: string }> = await ds.query(
      `INSERT INTO agents (reference,status,agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`m25g-agent-${randomUUID()}`, classes[0]!.id],
    );
    const agentId = agents[0]!.id;
    await ds.query(
      `INSERT INTO agent_authentication_credentials
       (agent_id,password_hash,hash_algorithm,password_version,password_changed_at,status)
       VALUES ($1,$2,'PBKDF2',1,NOW(),'ACTIVE')`,
      [agentId, passwordHash()],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: CUSTOMER_PASSWORD })
      .expect(200);
    return login.body.accessToken as string;
  }

  async function supportToken(): Promise<string> {
    const administrator = await workforce('SUPER_ADMIN');
    const username = `m25g.support.${randomUUID().slice(0, 8)}`;
    const provision = await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .set(auth(administrator))
      .send({ username })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/internal/support/workforce-sessions')
      .send({ username, password: provision.body.temporaryPassword })
      .expect(200);
    return login.body.accessToken as string;
  }

  async function seedLegacyPreference(
    customerId: string,
    actor = 'legacy-original-actor',
  ): Promise<void> {
    await preferences.createPreferences(customerId, { ...CREATE, actor });
  }

  async function preferenceState(): Promise<unknown> {
    return {
      preferences: await ds.query('SELECT * FROM customer_preferences ORDER BY id'),
      histories: await ds.query('SELECT * FROM preference_histories ORDER BY id'),
      // Guard authorization-decision records are expected even for denied requests; business
      // preference/history audit records, like the underlying rows, must not change on denial.
      businessAudit: await ds.query(
        `SELECT * FROM audit_events WHERE entity_type IN ('CUSTOMER_PREFERENCE','PREFERENCE_HISTORY') ORDER BY id`,
      ),
    };
  }

  async function expectDeniedSurface(
    token: string,
    existingId: string,
    emptyId: string,
  ): Promise<void> {
    await request(app.getHttpServer()).get(path(existingId)).set(auth(token)).expect(403);
    await request(app.getHttpServer()).head(path(existingId)).set(auth(token)).expect(403);
    await request(app.getHttpServer())
      .get(`${path(existingId)}/history`)
      .set(auth(token))
      .expect(403);
    await request(app.getHttpServer())
      .head(`${path(existingId)}/history`)
      .set(auth(token))
      .expect(403);
    await request(app.getHttpServer())
      .post(path(emptyId))
      .set(auth(token))
      .send({ ...CREATE, actor: 'caller-spoof' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(path(existingId))
      .set(auth(token))
      .send({ theme: CustomerTheme.DARK, actor: 'caller-spoof' })
      .expect(403);
  }

  it('preserves customer self-service and attributes spoofed and omitted actors to the real session', async () => {
    const a = await customer();
    const b = await customer();
    await request(app.getHttpServer())
      .post(path(a.id))
      .set(auth(a.token))
      .send({ ...CREATE, actor: 'pretend-to-be-an-administrator' })
      .expect(201);
    const createdHistory = await request(app.getHttpServer())
      .get(`${path(a.id)}/history`)
      .set(auth(a.token))
      .expect(200);
    expect(createdHistory.body[0].actor).toBe(a.id);
    await request(app.getHttpServer()).post(path(b.id)).set(auth(b.token)).send(CREATE).expect(201);
    const read = await request(app.getHttpServer()).get(path(a.id)).set(auth(a.token)).expect(200);
    expect(read.body).toMatchObject({
      customerId: a.id,
      language: 'EN',
      notifications: CREATE.notifications,
      security: CREATE.security,
    });
    await request(app.getHttpServer()).head(path(a.id)).set(auth(a.token)).expect(200);
    await request(app.getHttpServer())
      .patch(path(a.id))
      .set(auth(a.token))
      .send({
        notifications: { email: false },
        security: { biometricAllowed: true },
        actor: 'another-spoof',
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch(path(b.id))
      .set(auth(b.token))
      .send({ theme: 'DARK' })
      .expect(200);
    const history = await request(app.getHttpServer())
      .get(`${path(a.id)}/history`)
      .set(auth(a.token))
      .expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body.every((row: { actor: string }) => row.actor === a.id)).toBe(true);
    await request(app.getHttpServer())
      .head(`${path(a.id)}/history`)
      .set(auth(a.token))
      .expect(200);
    const rows = await ds.query(
      `SELECT p.customer_id,h.action,h.actor FROM preference_histories h
       JOIN customer_preferences p ON p.id=h.preference_id ORDER BY p.customer_id,h.action`,
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.actor).toBe(row.customer_id);
    const audits = await ds.query(
      `SELECT actor FROM audit_events WHERE entity_type IN ('CUSTOMER_PREFERENCE','PREFERENCE_HISTORY')`,
    );
    expect(audits).toHaveLength(8);
    expect(audits.every((row: { actor: string }) => row.actor === a.id || row.actor === b.id)).toBe(
      true,
    );
    expect(JSON.stringify({ rows, audits })).not.toContain('spoof');
  });

  it('preserves legacy history and audit rows without rewriting their historical actor', async () => {
    const owner = await customer();
    await seedLegacyPreference(owner.id);
    const before = await ds.query('SELECT * FROM preference_histories');
    const auditsBefore = await ds.query(
      `SELECT * FROM audit_events WHERE entity_type IN ('CUSTOMER_PREFERENCE','PREFERENCE_HISTORY') ORDER BY id`,
    );
    await request(app.getHttpServer())
      .patch(path(owner.id))
      .set(auth(owner.token))
      .send({ theme: 'DARK', actor: 'forged-new-actor' })
      .expect(200);
    const after = await ds.query('SELECT * FROM preference_histories WHERE id=$1', [before[0].id]);
    expect(after).toEqual(before);
    const oldAuditsAfter = await ds.query(
      `SELECT * FROM audit_events WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [auditsBefore.map((row: { id: string }) => row.id)],
    );
    expect(oldAuditsAfter).toEqual(auditsBefore);
    const history = await request(app.getHttpServer())
      .get(`${path(owner.id)}/history`)
      .set(auth(owner.token))
      .expect(200);
    expect(history.body.map((row: { actor: string }) => row.actor)).toEqual(
      expect.arrayContaining(['legacy-original-actor', owner.id]),
    );
  });

  it('denies cross-customer and anonymous reads/history and writes without changing preference data', async () => {
    const caller = await customer();
    const target = await customer(false);
    const empty = await customer(false);
    await seedLegacyPreference(target.id);
    const before = await preferenceState();
    await expectDeniedSurface(caller.token, target.id, empty.id);
    const nonexistentId = randomUUID();
    await expectDeniedSurface(caller.token, nonexistentId, nonexistentId);
    const existingResponse = await request(app.getHttpServer())
      .get(path(target.id))
      .set(auth(caller.token));
    const absentResponse = await request(app.getHttpServer())
      .get(path(nonexistentId))
      .set(auth(caller.token));
    expect(absentResponse.body).toEqual(existingResponse.body);
    for (const suffix of ['', '/history']) {
      await request(app.getHttpServer())
        .get(`${path(target.id)}${suffix}`)
        .expect(401);
      await request(app.getHttpServer())
        .head(`${path(target.id)}${suffix}`)
        .expect(401);
    }
    await request(app.getHttpServer()).post(path(empty.id)).send(CREATE).expect(401);
    await request(app.getHttpServer()).patch(path(target.id)).send({ theme: 'DARK' }).expect(401);
    expect(await preferenceState()).toEqual(before);
  });

  it.each(ROLES)(
    'denies real %s workforce reads, history, HEAD, POST and PATCH without business mutations',
    async (role) => {
      const target = await customer(false);
      const empty = await customer(false);
      await seedLegacyPreference(target.id);
      const token = await workforce(role);
      const before = await preferenceState();
      await expectDeniedSurface(token, target.id, empty.id);
      expect(await preferenceState()).toEqual(before);
      if (role === 'FINANCE_AUDITOR') {
        const denial = await request(app.getHttpServer())
          .patch(path(target.id))
          .set(auth(token))
          .send({ theme: 'DARK' })
          .expect(403);
        expect(denial.body.message).toBe('Read-only principal may not perform this operation');
      }
    },
  );

  it('denies real AGENT and SUPPORT sessions on the full preference surface', async () => {
    const target = await customer(false);
    const empty = await customer(false);
    await seedLegacyPreference(target.id);
    const agent = await agentToken();
    const support = await supportToken();
    const before = await preferenceState();
    await expectDeniedSurface(agent, target.id, empty.id);
    await expectDeniedSurface(support, target.id, empty.id);
    expect(await preferenceState()).toEqual(before);
  });

  it('applies the preference boundary to encoded routes, descendants and the unimplemented me alias', async () => {
    const owner = await customer();
    await seedLegacyPreference(owner.id);
    const workforceToken = await workforce('CUSTOMER_SERVICE');
    const before = await preferenceState();
    for (const encoded of [
      `/api/v1/customers/${owner.id}/%70references`,
      `/api/v1/customers/${owner.id}/prefer%65nces/%68istory`,
      `/%61pi/v1/%63ustomers/${owner.id}/preferences`,
    ]) {
      await request(app.getHttpServer()).get(encoded).set(auth(workforceToken)).expect(403);
    }
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/preferences')
      .set(auth(owner.token))
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/v1/customers/me/preferences')
      .set(auth(owner.token))
      .send({ theme: 'DARK' })
      .expect(403);
    expect(await preferenceState()).toEqual(before);
  });

  it('keeps preference audit/history out of workforce audit projections while preserving the records and unrelated audit', async () => {
    const owner = await customer();
    await request(app.getHttpServer())
      .post(path(owner.id))
      .set(auth(owner.token))
      .send(CREATE)
      .expect(201);
    await request(app.getHttpServer())
      .patch(path(owner.id))
      .set(auth(owner.token))
      .send({ notifications: { sms: false }, security: { biometricAllowed: true } })
      .expect(200);
    await request(app.getHttpServer())
      .get(`${path(owner.id)}/history`)
      .set(auth(owner.token))
      .expect(200);
    const preferenceRows = await ds.query(
      'SELECT id FROM customer_preferences WHERE customer_id=$1',
      [owner.id],
    );
    const preferenceId = preferenceRows[0].id as string;
    const historyRows = await ds.query(
      'SELECT id FROM preference_histories WHERE preference_id=$1',
      [preferenceId],
    );
    // Reproduce normal and fully percent-encoded legacy guard decisions, which used the
    // generic customer resource type before 25G. The current decision uses customer-preference.
    const encodedPreferences = [...'preferences']
      .map((character) => `%${character.charCodeAt(0).toString(16)}`)
      .join('');
    const legacyActions = [
      `GET:/api/v1/customers/${owner.id}/preferences`,
      `HEAD:/api/v1/%63ustomers/${owner.id}/${encodedPreferences}/history`,
    ];
    const legacyDecisionIds: string[] = [];
    for (const action of legacyActions) {
      const rows: Array<{ id: string }> = await ds.query(
        `INSERT INTO audit_events (entity_type,entity_id,action,actor,new_values,occurred_at)
         VALUES ('AUTHORIZATION_DECISION',$1,'ALLOWED',$2,$3::jsonb,NOW()) RETURNING id`,
        [owner.id, owner.id, JSON.stringify({ resourceType: 'customer', action })],
      );
      legacyDecisionIds.push(rows[0]!.id);
    }
    const unrelatedDecision = await ds.query(
      `INSERT INTO audit_events (entity_type,entity_id,action,actor,new_values,occurred_at)
       VALUES ('AUTHORIZATION_DECISION',$1,'ALLOWED',$2,$3::jsonb,NOW()) RETURNING id`,
      [
        owner.id,
        owner.id,
        JSON.stringify({
          resourceType: 'customer',
          action: `GET:/api/v1/customers/${owner.id}/preferences-old`,
        }),
      ],
    );
    const controlId = randomUUID();
    await ds.query(
      `INSERT INTO audit_events (entity_type,entity_id,action,actor,new_values,occurred_at)
       VALUES ('M25G_UNRELATED_CONTROL',$1,'CREATED','test-auditor','{"state":"retained"}'::jsonb,NOW())`,
      [controlId],
    );
    const storedBefore = await ds.query(
      `SELECT * FROM audit_events WHERE entity_type IN ('CUSTOMER_PREFERENCE','PREFERENCE_HISTORY') ORDER BY id`,
    );
    expect(storedBefore).toHaveLength(4);
    // Only a trusted in-process aggregate consumer may opt in; the HTTP query cannot set it.
    const trustedRecords = await audit.list(
      { entityType: 'CUSTOMER_PREFERENCE' },
      { includePreferenceRecords: true },
    );
    expect(trustedRecords).toHaveLength(2);
    const superAdmin = await workforce('SUPER_ADMIN');
    const auditor = await workforce('FINANCE_AUDITOR');
    const support = await supportToken();
    for (const token of [support, auditor, superAdmin]) {
      for (const type of ['CUSTOMER_PREFERENCE', 'PREFERENCE_HISTORY']) {
        const response = await request(app.getHttpServer())
          .get(`/api/v1/internal/audit?entityType=${type}&limit=200&includePreferenceRecords=true`)
          .set(auth(token))
          .expect(200);
        expect(response.body).toEqual([]);
      }
      for (const entityId of [preferenceId, historyRows[0].id as string]) {
        const response = await request(app.getHttpServer())
          .get(`/api/v1/internal/audit?entityId=${entityId}&limit=200`)
          .set(auth(token))
          .expect(200);
        expect(response.body).toEqual([]);
      }
      const all = await request(app.getHttpServer())
        .get('/api/v1/internal/audit?limit=200')
        .set(auth(token))
        .expect(200);
      expect(
        all.body.some((row: { entityType: string }) => row.entityType === 'M25G_UNRELATED_CONTROL'),
      ).toBe(true);
      expect(all.body.some((row: { id: string }) => row.id === unrelatedDecision[0].id)).toBe(true);
      expect(all.body.some((row: { id: string }) => legacyDecisionIds.includes(row.id))).toBe(
        false,
      );
      expect(JSON.stringify(all.body)).not.toMatch(
        /CUSTOMER_PREFERENCE|PREFERENCE_HISTORY|customer-preference|\/preferences(?:\/|")/i,
      );
    }
    for (const token of [superAdmin, auditor]) {
      const widget = await request(app.getHttpServer())
        .get('/api/v1/internal/a2/workforce/dashboard/widgets/audit-trail?limit=50')
        .set(auth(token))
        .expect(200);
      expect(
        widget.body.some(
          (row: { entityType: string }) => row.entityType === 'M25G_UNRELATED_CONTROL',
        ),
      ).toBe(true);
      expect(widget.body.some((row: { id: string }) => row.id === unrelatedDecision[0].id)).toBe(
        true,
      );
      expect(widget.body.some((row: { id: string }) => legacyDecisionIds.includes(row.id))).toBe(
        false,
      );
      expect(JSON.stringify(widget.body)).not.toMatch(
        /CUSTOMER_PREFERENCE|PREFERENCE_HISTORY|customer-preference|\/preferences(?:\/|")/i,
      );
    }
    expect(
      await ds.query(
        `SELECT * FROM audit_events WHERE entity_type IN ('CUSTOMER_PREFERENCE','PREFERENCE_HISTORY') ORDER BY id`,
      ),
    ).toEqual(storedBefore);
  });

  it('keeps approved workforce customer profile access distinct from preferences', async () => {
    const target = await customer(false);
    await seedLegacyPreference(target.id);
    const servicing = await workforce('CUSTOMER_SERVICE');
    const treasury = await workforce('TREASURY');
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${target.id}`)
      .set(auth(servicing))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${target.id}/profile`)
      .set(auth(servicing))
      .expect(200);
    await request(app.getHttpServer()).get(path(target.id)).set(auth(servicing)).expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${target.id}`)
      .set(auth(treasury))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${target.id}/profile`)
      .set(auth(treasury))
      .expect(403);
  });

  it('honors an API opt-out at materialization and pre-send, and sends only via a fake provider after opt-in', async () => {
    const owner = await customer();
    await request(app.getHttpServer())
      .post(path(owner.id))
      .set(auth(owner.token))
      .send(CREATE)
      .expect(201);
    const materialize = async () =>
      ds.transaction((manager) =>
        dispatcher.dispatch(
          {
            eventType: 'customer.funding.approved',
            eventKey: `m25g:${randomUUID()}`,
            payload: { customerId: owner.id, amountMinor: '25000', reference: 'SYNTHETIC' },
          },
          manager,
        ),
      );
    const first = await materialize();
    expect(first.deliveries).toHaveLength(1);
    expect(first.deliveries[0]!.status).toBe('PENDING');
    await request(app.getHttpServer())
      .patch(path(owner.id))
      .set(auth(owner.token))
      .send({ notifications: { sms: false } })
      .expect(200);
    const processor = new NotificationDeliveryProcessor({
      dataSource: ds,
      resolver,
      templates,
      smsProvider: provider,
      emailProvider: null,
      maxAttempts: 3,
      baseDelaySeconds: 1,
      leaseSeconds: 30,
    });
    await processor.processBatch(10);
    expect(
      await ds.query('SELECT status,last_error FROM notification_deliveries WHERE id=$1', [
        first.deliveries[0]!.id,
      ]),
    ).toEqual([{ status: 'SKIPPED', last_error: 'SMS_OPT_OUT' }]);
    const optedOut = await materialize();
    expect(optedOut.deliveries[0]!.status).toBe('SKIPPED');
    expect(provider.sent).toHaveLength(0);
    await request(app.getHttpServer())
      .patch(path(owner.id))
      .set(auth(owner.token))
      .send({ notifications: { sms: true } })
      .expect(200);
    const optedIn = await materialize();
    expect(optedIn.deliveries[0]!.status).toBe('PENDING');
    expect((await processor.processBatch(10)).sent).toBe(1);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.destination).toBe(owner.phone);
  });
});
