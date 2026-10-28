/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-require-imports */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomInt, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { CreateNotificationTemplateRegistry1785753600098 } from '../src/migrations/1785753600098-CreateNotificationTemplateRegistry';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import {
  NOTIFICATION_DEFAULTS_V1,
  NOTIFICATION_SECURITY_DEFAULTS_V1,
} from '../src/notification/notification-defaults-v1';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { NotificationWorkerService } from '../src/notification/notification-worker.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const base = '/api/v1/internal/notifications';
const approvals = '/api/v1/internal/a2/workforce/approvals';
const eventType = 'customer.funding.approved';

describe('notification template/configuration foundation — real PostgreSQL and real workforce HTTP', () => {
  let db: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let dispatcher: NotificationDispatcherService;
  let worker: NotificationWorkerService;
  let provider: TestNotificationProvider;
  let maker: string;
  let checker: string;
  const originalEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = await createIntegrationDataSource('notification_registry');
    provider = new TestNotificationProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
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
    dispatcher = moduleRef.get(NotificationDispatcherService);
    worker = moduleRef.get(NotificationWorkerService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = originalEnv;
    if (app) await app.close().catch(() => undefined);
    if (db) await destroyIntegrationDataSource(db);
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(db);
    provider.clear();
    maker = await provision(['SUPER_ADMIN']);
    checker = await provision(['FINANCE_CONTROLLER']);
  });

  async function provision(
    roles: string[],
    assurance: 'MFA' | 'PASSWORD' = 'MFA',
  ): Promise<string> {
    const principalId = `notification-test:${randomUUID()}`;
    const now = new Date();
    for (const roleKey of roles) {
      await db.getRepository(A2FinanceRoleAssignment).save({
        id: randomUUID(),
        assignmentReference: `${principalId}:${roleKey}`,
        assignmentVersion: 1,
        principalId,
        roleKey,
        scopes: [],
        status: 'ACTIVE',
        initiatedScope: 'SUPER_ADMIN_SCOPE',
        interim: true,
        effectiveFrom: new Date(now.getTime() - 60_000),
        effectiveTo: new Date(now.getTime() + 86_400_000),
        assignedBy: 'test-harness',
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        bootstrapReference: null,
        approvalIds: [],
        auditReferences: [],
      } as any);
    }
    const session = await sessions.establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: assurance,
      amr: assurance === 'MFA' ? ['pwd', 'otp'] : ['pwd'],
      acr: null,
      signingKeyId: 'test-key',
    });
    return session.accessToken;
  }
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const draft = (body = 'Approved {{amount_clause}} Ref {{reference}}.', expectedVersion = 1) => ({
    type: 'TEMPLATE',
    eventType,
    channel: 'SMS',
    locale: 'en-NG',
    body,
    expectedVersion,
    reason: 'Improve notification wording',
  });
  async function propose(payload: Record<string, unknown>, token = maker): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`${base}/changes`)
      .set(auth(token))
      .send(payload);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REQUESTED');
    return res.body.approvalId as string;
  }
  async function approve(id: string, token = checker): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`${approvals}/${id}/approve`)
      .set(auth(token))
      .send({ comment: 'Reviewed' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ approved: true, reason: 'APPROVED' });
  }
  async function execute(id: string, token = checker) {
    return request(app.getHttpServer())
      .post(`${base}/changes/${id}/execute`)
      .set(auth(token))
      .send({});
  }
  async function customer(smsEnabled = true): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status)
      VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [id, `customer-${randomUUID()}`],
    );
    const phone = `8${randomInt(0, 1_000_000_000).toString().padStart(9, '0')}`;
    await db.query(
      `INSERT INTO customer_contact_methods (id,customer_id,type,value,normalized_value,is_primary)
      VALUES ($1,$2,'PHONE',$3,$3,true)`,
      [randomUUID(), id, phone],
    );
    await db.query(
      `INSERT INTO customer_preferences (id,customer_id,language_code,theme_code,notification_email_enabled,
      notification_sms_enabled,notification_push_enabled,notification_in_app_enabled,security_login_alerts,
      security_transaction_alerts,security_device_registration_alerts,security_biometric_allowed,version)
      VALUES ($1,$2,'EN','SYSTEM',true,$3,true,true,true,true,true,false,1)`,
      [randomUUID(), id, smsEnabled],
    );
    return id;
  }

  it('seeds independent channels, exposes read/preview, denies unauthorized callers and locks security events', async () => {
    const counts =
      await db.query(`SELECT (SELECT count(*)::int FROM notification_templates) AS templates,
      (SELECT count(*)::int FROM notification_event_configurations) AS configurations`);
    expect(counts[0]).toEqual({
      templates: NOTIFICATION_DEFAULTS_V1.length * 2,
      configurations:
        (NOTIFICATION_DEFAULTS_V1.length + NOTIFICATION_SECURITY_DEFAULTS_V1.length) * 2,
    });
    const noAuth = await request(app.getHttpServer()).get(`${base}/events`);
    expect(noAuth.status).toBe(401);
    const operations = await provision(['OPERATIONS']);
    const reader = await request(app.getHttpServer()).get(`${base}/events`).set(auth(operations));
    expect(reader.status).toBe(200);
    const security = reader.body.items.find((i: any) => i.eventType === 'agent.desk.customer_otp');
    expect(security).toMatchObject({
      editable: false,
      variables: [],
      channels: {
        SMS: { enabled: true, locked: true, activeTemplateVersion: null },
        EMAIL: { enabled: false, locked: true, activeTemplateVersion: null },
      },
    });
    const email = await request(app.getHttpServer())
      .get(`${base}/templates`)
      .query({ eventType, channel: 'EMAIL' })
      .set(auth(operations));
    expect(email.status).toBe(200);
    expect(email.body.items[0]).toMatchObject({
      version: 1,
      active: true,
      subject: 'MonieNaija account update',
    });
    const preview = await request(app.getHttpServer())
      .post(`${base}/templates/preview`)
      .set(auth(maker))
      .send({
        eventType,
        channel: 'EMAIL',
        subject: 'Transfer update',
        body: 'Example {{reference}}{{amount_clause}}.',
      });
    expect(preview.status).toBe(200);
    expect(preview.body.body).toContain('SAMPLE-1');
    expect(preview.body.body).toContain('NGN');
    expect(provider.sent).toHaveLength(0);
    const noPrivilege = await request(app.getHttpServer())
      .post(`${base}/changes`)
      .set(auth(operations))
      .send(draft());
    expect(noPrivilege.status).toBe(403);
    const auditor = await provision(['FINANCE_AUDITOR']);
    const auditorWrite = await request(app.getHttpServer())
      .post(`${base}/changes`)
      .set(auth(auditor))
      .send(draft());
    expect(auditorWrite.status).toBe(403);
    // The real session service rejects password-only workforce sessions before any route is reached.
    await expect(provision(['SUPER_ADMIN'], 'PASSWORD')).rejects.toThrow('requires recent MFA');
    await expect(
      db.query(`UPDATE notification_event_configurations SET is_enabled=false, version=version+1
      WHERE event_type='agent.desk.customer_otp' AND channel='SMS'`),
    ).rejects.toThrow();
    await expect(
      db.query(`INSERT INTO notification_templates(event_type,channel,locale,version,is_active,subject,body,created_by)
      VALUES ('agent.desk.customer_otp','SMS','en-NG',1,true,NULL,'hello','test')`),
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO notification_templates(event_type,channel,locale,version,is_active,subject,body,created_by)
      VALUES ($1,'SMS','en-NG',2,true,NULL,'Duplicate active','test')`,
        [eventType],
      ),
    ).rejects.toThrow();
    const securityChange = await request(app.getHttpServer())
      .post(`${base}/changes`)
      .set(auth(maker))
      .send({
        type: 'CONFIGURATION',
        eventType: 'agent.desk.customer_otp',
        channel: 'SMS',
        enabled: false,
        expectedVersion: 1,
        reason: 'Try disabling message',
      });
    expect([400, 403]).toContain(securityChange.status);
  }, 30_000);

  it('requires a distinct checker, persists and audits immutable versions, and dispatches the approved version once', async () => {
    const dual = await provision(['SUPER_ADMIN', 'FINANCE_CONTROLLER']);
    const selfId = await propose(draft('Self check {{reference}}.'), dual);
    const self = await request(app.getHttpServer())
      .post(`${approvals}/${selfId}/approve`)
      .set(auth(dual))
      .send({ comment: 'No' });
    expect(self.body).toMatchObject({ approved: false, reason: 'SELF_APPROVAL_FORBIDDEN' });
    expect((await execute(selfId, dual)).status).toBeGreaterThanOrEqual(400);

    const id = await propose(draft());
    const pending = await execute(id);
    expect(pending.status).toBeGreaterThanOrEqual(400);
    const before = await db.query(
      `SELECT version FROM notification_templates WHERE event_type=$1 AND channel='SMS' AND is_active`,
      [eventType],
    );
    expect(before[0].version).toBe(1);
    const queue = await request(app.getHttpServer())
      .get(`${base}/changes`)
      .query({ status: 'REQUESTED', limit: 10 })
      .set(auth(checker));
    expect(queue.status).toBe(200);
    expect(queue.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ approvalId: id, status: 'REQUESTED' })]),
    );
    const review = await request(app.getHttpServer())
      .get(`${base}/changes/${id}`)
      .set(auth(checker));
    expect(review.status).toBe(200);
    expect(review.body.change.body).toBe(draft().body);
    await approve(id);
    expect((await execute(id, maker)).status).toBe(403);
    const tamper = await request(app.getHttpServer())
      .post(`${base}/changes/${id}/execute`)
      .set(auth(checker))
      .send({ body: 'Altered' });
    expect(tamper.status).toBe(403);
    const applied = await execute(id);
    expect(applied.status).toBe(200);
    expect(applied.body.template).toMatchObject({ version: 2, active: true, body: draft().body });
    expect((await execute(id)).status).toBeGreaterThanOrEqual(400);
    const versions = await db.query(
      `SELECT id,version,is_active,body FROM notification_templates WHERE event_type=$1 AND channel='SMS' ORDER BY version`,
      [eventType],
    );
    expect(versions.map((v: any) => [v.version, v.is_active])).toEqual([
      [1, false],
      [2, true],
    ]);
    await expect(
      db.query(`UPDATE notification_templates SET body='altered' WHERE id=$1`, [versions[0].id]),
    ).rejects.toThrow();
    await expect(
      db.query(`DELETE FROM notification_templates WHERE id=$1`, [versions[0].id]),
    ).rejects.toThrow();
    await expect(
      db.query(`UPDATE notification_change_requests SET payload='{}'::jsonb WHERE approval_id=$1`, [
        id,
      ]),
    ).rejects.toThrow();
    const audit = await db.query(
      `SELECT id,actor,new_values FROM audit_events WHERE action='NOTIFICATION_TEMPLATE_VERSION_ACTIVATED'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toMatchObject({ version: 2, approvalId: id });
    expect(JSON.stringify(audit[0].new_values)).not.toContain(draft().body);
    await expect(db.query(`DELETE FROM audit_events WHERE id=$1`, [audit[0].id])).rejects.toThrow();

    const customerId = await customer();
    const command = {
      eventType,
      eventKey: `integration:${randomUUID()}`,
      payload: {
        customerId,
        amountMinor: '12000',
        reference: 'FUND-REF',
        password: 'very-secret',
        transferCode: '123456',
        arbitraryField: 'not-a-variable',
      },
    };
    expect((await dispatcher.dispatch(command)).dispatched).toBe(1);
    expect(provider.sent[0]!.message).toContain('Approved');
    expect(provider.sent[0]!.message).toContain('NGN 120.00');
    expect(provider.sent[0]!.message).not.toMatch(/very-secret|123456|not-a-variable/);
    await dispatcher.dispatch(command);
    expect(provider.sent).toHaveLength(1);
  }, 30_000);

  it('rolls back by appending a new independently approved version rather than reviving history', async () => {
    const first = await propose(draft('Revised {{reference}}.'));
    await approve(first);
    expect((await execute(first)).status).toBe(200);
    const rollback = await propose({
      type: 'TEMPLATE_ROLLBACK',
      eventType,
      channel: 'SMS',
      sourceVersion: 1,
      expectedVersion: 2,
      reason: 'Restore earlier wording',
    });
    await approve(rollback);
    const res = await execute(rollback);
    expect(res.status).toBe(200);
    expect(res.body.template.version).toBe(3);
    const versions = await db.query(
      `SELECT version,is_active,body FROM notification_templates WHERE event_type=$1 AND channel='SMS' ORDER BY version`,
      [eventType],
    );
    expect(versions.map((v: any) => [v.version, v.is_active])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(versions[2].body).toBe(versions[0].body);
    const page = await request(app.getHttpServer())
      .get(`${base}/templates`)
      .query({ eventType, channel: 'SMS', limit: 1 })
      .set(auth(maker));
    expect(page.body.items[0].version).toBe(3);
    expect(page.body.nextBeforeVersion).toBe(3);
    const next = await request(app.getHttpServer())
      .get(`${base}/templates`)
      .query({ eventType, channel: 'SMS', limit: 1, beforeVersion: 3 })
      .set(auth(maker));
    expect(next.body.items[0].version).toBe(2);
    await expect(
      db.query(
        `UPDATE notification_templates SET is_active=true WHERE event_type=$1 AND channel='SMS' AND version=1`,
        [eventType],
      ),
    ).rejects.toThrow();
    const audit = await db.query(
      `SELECT new_values FROM audit_events WHERE action='NOTIFICATION_TEMPLATE_VERSION_ACTIVATED' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(audit[0].new_values.sourceVersion).toBe(1);
    const runner = db.createQueryRunner();
    try {
      await runner.connect();
      await expect(
        new CreateNotificationTemplateRegistry1785753600098().down(runner),
      ).rejects.toThrow('Cannot remove notification registry');
      expect(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM notification_templates WHERE event_type=$1 AND channel='SMS'`,
            [eventType],
          )
        )[0].n,
      ).toBe(3);
    } finally {
      await runner.release();
    }
  }, 30_000);

  it('enforces event toggles on new SMS and retry, retaining customer preferences and idempotency', async () => {
    const customerId = await customer();
    const failedKey = `failed:${randomUUID()}`;
    await db.query(
      `INSERT INTO notification_deliveries(event_type,event_key,recipient_type,recipient_id,channel,destination,payload,message,status,attempts,updated_at)
      VALUES ($1,$2,'CUSTOMER',$3,'SMS','8051234567','{}','Previously failed.','FAILED',1,NOW()-INTERVAL '2 hours')`,
      [eventType, failedKey, customerId],
    );
    const disable = await propose({
      type: 'CONFIGURATION',
      eventType,
      channel: 'SMS',
      enabled: false,
      expectedVersion: 1,
      reason: 'Pause this event',
    });
    await approve(disable);
    expect((await execute(disable)).body).toMatchObject({ enabled: false, version: 2 });
    const key = `disabled:${randomUUID()}`;
    const command = { eventType, eventKey: key, payload: { customerId, amountMinor: '500' } };
    const skipped = await dispatcher.dispatch(command);
    expect(skipped).toMatchObject({ generated: 1, skipped: 1, dispatched: 0 });
    const saved = await db.query(
      `SELECT status,last_error FROM notification_deliveries WHERE event_key=$1`,
      [key],
    );
    expect(saved[0]).toEqual({ status: 'SKIPPED', last_error: 'EVENT_DISABLED' });
    const tick = await worker.tick();
    expect(tick.retriesSuppressed).toBe(1);
    expect(
      (
        await db.query(`SELECT status,last_error FROM notification_deliveries WHERE event_key=$1`, [
          failedKey,
        ])
      )[0],
    ).toEqual({ status: 'SKIPPED', last_error: 'EVENT_DISABLED' });
    expect(provider.sent).toHaveLength(0);
    const enable = await propose({
      type: 'CONFIGURATION',
      eventType,
      channel: 'SMS',
      enabled: true,
      expectedVersion: 2,
      reason: 'Resume this event',
    });
    await approve(enable);
    expect((await execute(enable)).status).toBe(200);
    await dispatcher.dispatch(command); // old skipped event remains idempotently skipped
    expect(provider.sent).toHaveLength(0);
    expect(
      (await dispatcher.dispatch({ ...command, eventKey: `enabled:${randomUUID()}` })).dispatched,
    ).toBe(1);
    const optedOut = await customer(false);
    expect(
      (
        await dispatcher.dispatch({
          eventType,
          eventKey: `optout:${randomUUID()}`,
          payload: { customerId: optedOut },
        })
      ).skipped,
    ).toBe(1);
    expect(provider.sent).toHaveLength(1);
  }, 30_000);

  it('suppresses retry of a legacy C2C message containing the old locator pair', async () => {
    const customerId = await customer();
    const key = `legacy:${randomUUID()}`;
    await db.query(
      `INSERT INTO notification_deliveries(event_type,event_key,recipient_type,recipient_id,channel,destination,payload,message,status,attempts,updated_at)
      VALUES ('cash_to_cash.created',$1,'CUSTOMER',$2,'SMS','8051234567','{}',$3,'FAILED',1,NOW()-INTERVAL '2 hours')`,
      [key, customerId, 'Cash-to-cash transfer number 000001 from 8031234567.'],
    );
    const result = await worker.tick();
    expect(result.retriesSuppressed).toBe(1);
    expect(
      (
        await db.query(`SELECT status,last_error FROM notification_deliveries WHERE event_key=$1`, [
          key,
        ])
      )[0],
    ).toEqual({ status: 'SKIPPED', last_error: 'UNSAFE_MESSAGE' });
    expect(provider.sent).toHaveLength(0);
  }, 30_000);

  it('keeps email templates/config separate without creating an email delivery path', async () => {
    const email = await propose({
      type: 'TEMPLATE',
      eventType,
      channel: 'EMAIL',
      subject: 'Funding update',
      body: 'Your funding{{amount_clause}}: {{reference}}.',
      expectedVersion: 1,
      reason: 'Update email wording',
    });
    await approve(email);
    expect((await execute(email)).body.template).toMatchObject({
      channel: 'EMAIL',
      version: 2,
      subject: 'Funding update',
    });
    const enable = await propose({
      type: 'CONFIGURATION',
      eventType,
      channel: 'EMAIL',
      enabled: true,
      expectedVersion: 1,
      reason: 'Prepare email configuration',
    });
    await approve(enable);
    expect((await execute(enable)).body).toMatchObject({ channel: 'EMAIL', enabled: true });
    const rows = await db.query(
      `SELECT channel,version,subject FROM notification_templates WHERE event_type=$1 AND is_active ORDER BY channel`,
      [eventType],
    );
    expect(rows).toEqual([
      { channel: 'EMAIL', version: 2, subject: 'Funding update' },
      { channel: 'SMS', version: 1, subject: null },
    ]);
    const customerId = await customer();
    await dispatcher.dispatch({
      eventType,
      eventKey: `email-not-wired:${randomUUID()}`,
      payload: { customerId },
    });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.channel).toBe('SMS');
    expect(
      await db.query(`SELECT id FROM notification_deliveries WHERE channel='EMAIL'`),
    ).toHaveLength(0);
  }, 30_000);

  it('fails closed on missing templates, records a safe outbox failure and retries after recovery', async () => {
    const customerId = await customer();
    const outboxId = randomUUID();
    const key = `recover:${randomUUID()}`;
    await db.query(
      `UPDATE notification_templates SET is_active=false WHERE event_type=$1 AND channel='SMS' AND is_active`,
      [eventType],
    );
    await db.query(
      `INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,event_key,schema_version,classification,retention_class,occurred_at,correlation_id,payload,status,attempts,available_at)
      VALUES ($1,$2,'CUSTOMER',$3,$4,1,'INTERNAL_OPERATIONS','OPERATIONS_DEFAULT',NOW(),'test',$5::jsonb,'PENDING',0,NOW())`,
      [outboxId, eventType, customerId, key, JSON.stringify({ customerId, reference: 'FUND-REF' })],
    );
    const before = (await db.query(`SELECT count(*)::int AS n FROM ledger_journals`))[0].n;
    expect(await dispatcher.processPendingOutboxEvents(10)).toBe(0);
    const failed = (
      await db.query(`SELECT status,attempts,last_error FROM outbox_events WHERE id=$1`, [outboxId])
    )[0];
    expect(failed).toEqual({
      status: 'FAILED',
      attempts: 1,
      last_error: 'NOTIFICATION_DISPATCH_FAILED',
    });
    expect(await dispatcher.processPendingOutboxEvents(10)).toBe(0); // respects available_at backoff
    expect(provider.sent).toHaveLength(0);
    // Simulate an approved operator repair in the isolated test database.
    await db.query(
      `INSERT INTO notification_templates(event_type,channel,locale,version,is_active,subject,body,created_by)
      VALUES ($1,'SMS','en-NG',2,true,NULL,'Recovered {{reference}}.','test-repair')`,
      [eventType],
    );
    await db.query(`UPDATE outbox_events SET available_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [
      outboxId,
    ]);
    expect(await dispatcher.processPendingOutboxEvents(10)).toBe(1);
    expect(
      (await db.query(`SELECT status,attempts FROM outbox_events WHERE id=$1`, [outboxId]))[0],
    ).toEqual({ status: 'PUBLISHED', attempts: 2 });
    expect(provider.sent).toHaveLength(1);
    expect((await db.query(`SELECT count(*)::int AS n FROM ledger_journals`))[0].n).toBe(before);
  }, 30_000);

  it('rejects unsafe variables, SECURITY edit attempts, sample-data injection, and forged generic approvals', async () => {
    for (const body of [
      '{{password}}',
      '{{sender_phone}}',
      '{{payload.reference}}',
      '{{reference + 1}}',
      'Your OTP is 123456',
      '<script>hi</script>',
    ]) {
      const res = await request(app.getHttpServer())
        .post(`${base}/changes`)
        .set(auth(maker))
        .send(draft(body));
      expect(res.status).toBe(400);
    }
    const preview = await request(app.getHttpServer())
      .post(`${base}/templates/preview`)
      .set(auth(maker))
      .send({
        eventType,
        channel: 'SMS',
        body: '{{reference}}',
        sample: { reference: 'real-customer' },
      });
    expect(preview.status).toBe(400);
    const direct = await request(app.getHttpServer())
      .post(`${base}/changes`)
      .set(auth(maker))
      .send({
        ...draft(),
        eventType: 'customer.credentials.temporary_credential',
        body: 'Hello',
      });
    expect([400, 403]).toContain(direct.status);
    await expect(
      dispatcher.dispatch({
        eventType: 'agent.desk.customer_otp',
        eventKey: 'bad-security',
        payload: { otp: '123456' },
      }),
    ).rejects.toThrow();
    expect(
      await db.query(`SELECT id FROM notification_deliveries WHERE event_key='bad-security'`),
    ).toHaveLength(0);
    const unknown = await dispatcher.dispatch({
      eventType: 'support.ticket.internal_name',
      eventKey: 'unknown',
      payload: { ticketId: randomUUID() },
    });
    expect(unknown.generated).toBe(0);
    const fake = await request(app.getHttpServer())
      .post(`${approvals}/request`)
      .set(auth(maker))
      .send({
        action: 'NOTIFICATION_TEMPLATE_CHANGE',
        resource: { type: 'NOTIFICATION_EVENT_CONFIGURATION', id: randomUUID() },
        actionFingerprint: 'a'.repeat(64),
        reason: 'Forged proposal',
      });
    expect(fake.status).toBe(201);
    await approve(fake.body.approval.id);
    expect((await execute(fake.body.approval.id)).status).toBe(404);
  }, 30_000);

  it('rejects stale concurrent approvals and rolls approval consumption back on write failure', async () => {
    const one = await propose(draft('First {{reference}}.'));
    const two = await propose(draft('Second {{reference}}.'));
    await approve(one);
    await approve(two);
    const results = await Promise.all([execute(one), execute(two)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const stale = results[0]!.status === 409 ? one : two;
    const state = await db.query(`SELECT status FROM privileged_action_approvals WHERE id=$1`, [
      stale,
    ]);
    expect(state[0].status).toBe('APPROVED');
    const active = await db.query(
      `SELECT version FROM notification_templates WHERE event_type=$1 AND channel='SMS' AND is_active`,
      [eventType],
    );
    expect(active[0].version).toBe(2);

    const id = await propose(draft('Third {{reference}}.', 2));
    await approve(id);
    await db.query(`CREATE FUNCTION test_reject_notification_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='NOTIFICATION_TEMPLATE_VERSION_ACTIVATED' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
    await db.query(
      `CREATE TRIGGER test_reject_notification_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_reject_notification_audit()`,
    );
    try {
      expect((await execute(id)).status).toBe(500);
      const after = await db.query(
        `SELECT version FROM notification_templates WHERE event_type=$1 AND channel='SMS' AND is_active`,
        [eventType],
      );
      expect(after[0].version).toBe(2);
      expect(
        (await db.query(`SELECT status FROM privileged_action_approvals WHERE id=$1`, [id]))[0]
          .status,
      ).toBe('APPROVED');
    } finally {
      await db.query(`DROP TRIGGER test_reject_notification_audit ON audit_events`);
      await db.query(`DROP FUNCTION test_reject_notification_audit()`);
    }
    const recovered = await execute(id);
    expect(recovered.status).toBe(200);
    expect(recovered.body.template.version).toBe(3);
  }, 30_000);
});
