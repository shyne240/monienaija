import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { DataSource, type EntityManager } from 'typeorm';

import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { DashboardSeedService } from '../src/dashboard/dashboard-seed.service';
import { AuditService } from '../src/operations/audit.service';
import { OutboxService } from '../src/operations/outbox.service';
import type { AuditEventCommand } from '../src/operations/operations.types';
import { ProductionReadinessService } from '../src/production/production-readiness.service';

import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

/**
 * ARENA 6 — the drill-down chain on a real session, against real PostgreSQL.
 *
 * Everything else in this area has been proved either with an in-memory double (the root specs) or with
 * responses stubbed at the browser's network layer (the Chromium harness), because the shipped bootstrap
 * refuses to listen while the eight financial dependencies in `FINANCIAL_DEPENDENCY_BLOCKERS` remain
 * unverified — a refusal this suite deliberately does not touch. That left one honest gap: nobody had
 * walked the path a real operator walks using the real `AuthorizationService` checks, the real session
 * store and the real seeded catalogue.
 *
 * So this suite boots the real `AppModule` over the disposable PostgreSQL the PG harness creates and
 * migrates, seeds the eleven local role accounts with the pre-existing fixture (insert-only, loopback
 * guarded), signs in with real passwords through the real login route, and then reads:
 *
 *   dashboard card → failed-delivery queue → delivery trace → audit search by correlation id
 *
 * plus the health report, which must show at least one source it could not read and say why. A second,
 * restricted role proves the negative half: no drill-down on its card, and a direct read of each
 * protected view refused by the server rather than hidden by the client.
 *
 * What this does NOT certify, stated so the evidence file cannot be over-read: no browser renders here
 * (the client's rendering of these exact payloads is covered by the harness and the component specs),
 * no provider call is made, and the `verifyStartup()` readiness gate is asserted to still refuse — not
 * bypassed — because the app under test is created the same way every other `*.integration.spec.ts` in
 * this repository creates it.
 *
 * `LOCAL_DEV_SEED_CONFIRM` is set programmatically below. The fixture's own guards (loopback host,
 * NODE_ENV, both workers explicitly disabled, insert-only writes) all still run; the flag exists to stop
 * a human pointing the script at a real database by hand, and the database here is created and dropped by
 * `test/support/pg-harness.ts` for this run alone.
 */

interface Json {
  [key: string]: unknown;
}

interface SessionResult {
  status: number;
  token: string | null;
  body: Json;
}

interface ReadResult {
  status: number;
  body: Json | Json[] | null;
  raw: string;
}

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';
const API = '/api/v1';

// OPERATIONS would be the natural "operations desk" choice, but it holds `notification.view_deliveries`
// and NOT `audit.search`, so it can open the queue and not the audit funnel. FINANCE_AUDITOR holds both,
// which is what makes it the only seeded local role that can actually walk the whole chain — and that
// asymmetry is the point of the negative test below.
const ROLE_EMAILS = {
  authorized: 'finance-auditor@monienaija.local',
  restricted: 'risk-fraud@monienaija.local',
} as const;
const passwordFor = (roleKey: 'FINANCE_AUDITOR' | 'RISK_FRAUD'): string =>
  `MonieNaija_${roleKey}_123!`;

interface LocalRoleSeed {
  readonly ROLES: readonly string[];
  seedLocalRoles(
    ds: DataSource,
    config: { enabled: boolean; oidcIssuer?: string },
    audit: AuditService,
  ): Promise<unknown[]>;
}

const loadLocalRoleSeed = createRequire(__filename);

const localRoleSeed = loadLocalRoleSeed(
  '../scripts/local-dev-seed-11-roles.js',
) as unknown as LocalRoleSeed;

const iso = (value: unknown): boolean =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

const asJson = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
const asArray = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

describe('ARENA 6 — real-session drill-down chain (real PostgreSQL + real HTTP)', () => {
  jest.setTimeout(240_000);

  const ORIGINAL_ENV = { ...process.env };
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let baseUrl = '';
  let readinessStillRefuses = false;
  let readinessReason: string | null = null;

  // The synthetic record set, shared by both roles so the negative proof tests the same rows.
  const fixture = {
    correlationId: `arena6-real-${randomUUID()}`,
    deliveryId: randomUUID(),
    failedDeliveryId: randomUUID(),
    outboxAppended: false,
    outboxSkipReason: null as string | null,
  };

  interface EvidenceDocument {
    [key: string]: unknown;
    workflow: Json[];
  }

  const evidence: EvidenceDocument = {
    kind: 'arena6-real-session-workflow',
    generatedAt: null,
    environment: {
      nodeEnv: 'test',
      database: 'disposable, created + migrated by test/support/pg-harness.ts for this run only',
      productionGate:
        'NOT bypassed: the app is built the way every *.integration.spec.ts builds it',
    },
    workflow: [],
    restrictedRole: {},
    health: {},
    notCertified: [
      'no browser rendering in this file (see docs/integration/evidence/arena6-drilldown/ for that leg)',
      'no provider call was made, so no provider receipt can be FOUND here',
      'the shipped bootstrap still refuses to listen; no AR6 change alters that',
    ],
  };

  async function login(email: string, password: string): Promise<SessionResult> {
    const response = await fetch(`${baseUrl}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const raw = await response.text();
    let body: Json = {};
    try {
      body = JSON.parse(raw) as Json;
    } catch {
      body = { unparsed: raw.slice(0, 400) };
    }
    const token = typeof body.accessToken === 'string' ? body.accessToken : null;
    return { status: response.status, token, body };
  }

  async function read(path: string, token: string | null): Promise<ReadResult> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const raw = await response.text();
    let body: Json | Json[] | null = null;
    try {
      body = JSON.parse(raw) as Json | Json[];
    } catch {
      body = null;
    }
    return { status: response.status, body, raw };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    // No A2_WORKFORCE_* values are set here on purpose. The workforce configuration comes from the
    // repository's own test placeholder file, composed by `scripts/prepare-pg-test-env.js` — the same
    // step the CI PostgreSQL job runs before `npm run test:pg` — so this suite authenticates against the
    // configuration every other real-AppModule integration suite uses, not a private one invented below.
    // The check after the module is compiled turns a missing `.env` into a legible instruction rather than
    // a 403 the reader would misattribute to authorization.

    dataSource = await createIntegrationDataSource('arena6realsess');

    // `ConfigModule.forRoot({ cache: true })` snapshots and validates the environment when
    // `app.module.ts` is evaluated, so the module is imported only after the A2_WORKFORCE_* values above
    // are in place. A static import would read the environment before this suite had said anything.
    const { AppModule } = await import('../src/app.module');

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
    // A real socket on loopback, so every request below crosses a real HTTP boundary (parsing, hooks,
    // guards) rather than an in-process supertest shim. Port 0 lets the OS choose; nothing outside this
    // machine can reach it.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    // The production gate is asserted, not sidestepped: whatever this harness did to become listeneable,
    // `verifyStartup()` must still refuse this build. If it ever returns ok here, that is a product change
    // someone must notice, so it is recorded in the evidence rather than assumed.
    try {
      await moduleRef.get(ProductionReadinessService).verifyStartup();
      readinessStillRefuses = false;
    } catch (error) {
      readinessStillRefuses = true;
      readinessReason = error instanceof Error ? error.message : String(error);
    }

    // The dashboard catalogue is seeded by `onApplicationBootstrap`; `truncateAllTables` runs after that
    // in beforeEach, so the seed is re-issued through the real service (idempotent, insert-only) to leave
    // the templates this suite depends on in place.
    await truncateAllTables(dataSource);
    await moduleRef.get(DashboardSeedService).seedIfEmpty();

    const workforceConfig = asJson(moduleRef.get(A2_WORKFORCE_CONFIG)) as {
      enabled: boolean;
      oidcIssuer?: string;
    };
    if (!workforceConfig.enabled || !workforceConfig.oidcIssuer) {
      throw new Error(
        'Workforce authentication is not configured in this environment. Run ' +
          '`node scripts/prepare-pg-test-env.js --create-if-missing` to compose the documented test `.env` ' +
          'before `npm run test:pg` — the real login route is refused by design without it.',
      );
    }
    const seeded = await localRoleSeed.seedLocalRoles(
      dataSource,
      workforceConfig,
      moduleRef.get(AuditService),
    );
    evidence.accountsSeeded = seeded.length;

    await seedDeliveryRecords(moduleRef.get(AuditService), moduleRef.get(OutboxService));
  }, 300_000);

  /**
   * Two synthetic deliveries and the outbox event + audit trail behind the failing one. Written through
   * the real `OutboxService`/`AuditService` inside one transaction, exactly as a production write path
   * would, so the audit chain verifies and the correlation id is a real join key rather than a fixture
   * string. Nothing here invents a table: if `outbox_events` cannot accept the row, the suite records
   * why and asserts the degraded-but-honest trace instead.
   */
  async function seedDeliveryRecords(audit: AuditService, outbox: OutboxService): Promise<void> {
    const recipientId = randomUUID();
    const aggregateId = randomUUID();
    const now = new Date();

    // Three separate transactions, deliberately. PostgreSQL aborts a transaction on the first failed
    // statement, so one unsupported write (an outbox table this build may not have, say) would otherwise
    // roll back the delivery rows the rest of the suite reads and turn a capability gap into a confusing
    // empty queue.
    await dataSource.transaction(async (manager: EntityManager) => {
      await manager.query(
        `INSERT INTO notification_deliveries
           (id, event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id,
            channel, destination, payload, message, status, attempts, provider_ref,
            correlation_id, causation_id, last_error, created_at, updated_at, failed_at)
         VALUES ($1,$2,$3,$4,$5,'CUSTOMER',$6,'SMS',$7,$8::jsonb,$9,'FAILED',2,$10,$11,$12,$13,$14,$14,$14)`,
        [
          fixture.failedDeliveryId,
          'transfer.failed',
          `transfer.failed:${fixture.correlationId}`,
          'TRANSFER',
          aggregateId,
          recipientId,
          '+2348000000000',
          JSON.stringify({ template: 'transfer-failed', synthetic: true }),
          'Synthetic ARENA 6 failed delivery — no real recipient, no provider call.',
          `prov-${fixture.correlationId.slice(0, 8)}`,
          fixture.correlationId,
          `cause-${fixture.correlationId.slice(0, 8)}`,
          'PROVIDER_TIMEOUT',
          new Date(now.getTime() - 60_000),
        ],
      );
      await manager.query(
        `INSERT INTO notification_deliveries
           (id, event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id,
            channel, destination, payload, message, status, attempts, correlation_id,
            created_at, updated_at, sent_at)
         VALUES ($1,$2,$3,$4,$5,'CUSTOMER',$6,'PUSH',$7,$8::jsonb,$9,'SENT',1,$10,$11,$11,$11)`,
        [
          fixture.deliveryId,
          'transfer.completed',
          `transfer.completed:${fixture.correlationId}`,
          'TRANSFER',
          aggregateId,
          recipientId,
          'device-0000000000',
          JSON.stringify({ template: 'transfer-done', synthetic: true }),
          'Synthetic ARENA 6 sent delivery.',
          fixture.correlationId,
          now,
        ],
      );
    });

    await dataSource.transaction(async (manager: EntityManager) => {
      try {
        const event = await outbox.enqueue(manager, {
          eventType: 'transfer.failed',
          aggregateType: 'TRANSFER',
          aggregateId,
          payload: { synthetic: true, correlationId: fixture.correlationId },
          eventKey: `transfer.failed:${fixture.correlationId}`,
        });
        if (event && typeof event.id === 'string') await outbox.markPublished(manager, event.id);
        fixture.outboxAppended = true;
      } catch (error) {
        fixture.outboxSkipReason = error instanceof Error ? error.message : String(error);
      }
    });

    await dataSource.transaction(async (manager: EntityManager) => {
      const command: AuditEventCommand = {
        entityType: 'NOTIFICATION_DELIVERY',
        entityId: fixture.failedDeliveryId,
        action: 'ARENA6_SYNTHETIC_DELIVERY_RECORDED',
        actor: 'arena6-real-session-harness',
        correlationId: fixture.correlationId,
        newValues: { status: 'FAILED', channel: 'SMS', synthetic: true },
        occurredAt: now,
      };
      await audit.record(manager, command);
    });
  }

  afterAll(async () => {
    evidence.generatedAt = new Date().toISOString();
    if (process.env.ARENA6_EVIDENCE_DIR) {
      mkdirSync(process.env.ARENA6_EVIDENCE_DIR, { recursive: true });
      writeFileSync(
        join(process.env.ARENA6_EVIDENCE_DIR, 'real-session-workflow.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
    }
    process.env = { ...ORIGINAL_ENV };
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource).catch(() => undefined);
    }
  }, 120_000);

  it('boots on a real PostgreSQL session without touching the production readiness gate', () => {
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(readinessStillRefuses).toBe(true);
    expect(readinessReason).toMatch(/financial_dependencies_not_ready|Production readiness failed/);
    evidence.productionReadiness = { refuses: readinessStillRefuses, reason: readinessReason };
  });

  it('signs the authorized role in with its local password and resolves its card with a drill-down', async () => {
    const session = await login(ROLE_EMAILS.authorized, passwordFor('FINANCE_AUDITOR'));
    expect(session.status).toBe(201);
    expect(session.token).toBeTruthy();

    const dashboard = await read(
      `${API}/internal/a2/workforce/dashboard/my-dashboard`,
      session.token,
    );
    expect(dashboard.status).toBe(200);
    const body = asJson(dashboard.body);
    expect(body.templateKey).toBe('FINANCIAL_AUDIT_ASSURANCE');
    expect(body.isFallback).toBe(false);

    const widgets = asArray(body.widgets);
    const card = widgets.find((widget) => widget.widgetKey === 'notification-delivery-exceptions');
    expect(card).toBeDefined();
    expect(card?.authorized).toBe(true);
    const drilldown = asJson(card?.drilldown);
    expect(drilldown.view).toBe('notificationOperations');
    expect(typeof drilldown.label).toBe('string');
    expect(String(drilldown.label)).toMatch(/notification operations/i);
    // A preset is a string the destination translates into a server filter; nothing may smuggle an
    // object through the resolution layer, because the client spreads it into a query.
    expect(typeof drilldown.preset === 'string' || drilldown.preset === undefined).toBe(true);

    // The card's own read is a real proxied query against the real table.
    // `dataEndpoint` is relative to the ApiClient base (`/api/v1`), which is how the console states the
    // source of a number; prefixing only the origin is how the request goes out.
    const dataPath = typeof card?.dataEndpoint === 'string' ? card.dataEndpoint : '';
    expect(dataPath.startsWith('/internal/')).toBe(true);
    const cardRead = await read(`${API}${dataPath}`, session.token);
    expect(cardRead.status).toBe(200);

    const payload = asJson(cardRead.body);
    const provenance = [payload.definition, payload.source].find(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
    expect(typeof provenance).toBe('string');
    expect(asJson(payload.policy).manualRetrySupported).toBe(false);
    // ---- THE AGREEMENT THE CARD PROMISES -----------------------------------------------------
    // `MEASURED` is itself a result here: it means the card resolved the same
    // NotificationOperationsService.summary() the queue is served from. `UNAVAILABLE` would mean the
    // projection is not wired in the container, which is the defect this test exists to catch.
    expect(payload.availability).toBe('MEASURED');
    const window = asJson(payload.window);
    expect(String(window.label).length).toBeGreaterThan(0);
    expect(String(window.boundary)).toMatch(/half-open/);
    expect(typeof window.from).toBe('string');
    expect(typeof window.to).toBe('string');
    // Only the aggregate crosses to the dashboard.
    expect(asJson(payload.totals).byStatus).toBeUndefined();
    expect(payload.errorCodes).toBeUndefined();
    expect(payload.retry).toBeUndefined();
    // Same window, same table, same function gate: the card's delivery count is the queue's unfiltered
    // `total`, and its exception count is the queue's total for FAILED + DEAD + UNKNOWN summed.
    const queueWindow = `from=${encodeURIComponent(String(window.from))}&to=${encodeURIComponent(String(window.to))}`;
    const all = await read(
      `${API}/internal/notifications/deliveries?${queueWindow}&page=1&limit=1`,
      session.token,
    );
    expect(all.status).toBe(200);
    expect(Number(asJson(all.body).total)).toBe(Number(asJson(payload.totals).deliveries));
    let exceptionSum = 0;
    for (const status of ['FAILED', 'DEAD', 'UNKNOWN']) {
      const scoped = await read(
        `${API}/internal/notifications/deliveries?${queueWindow}&status=${status}&page=1&limit=1`,
        session.token,
      );
      expect(scoped.status).toBe(200);
      exceptionSum += Number(asJson(scoped.body).total);
    }
    expect(Number(asJson(payload.totals).exceptions)).toBe(exceptionSum);
    expect(Number(asJson(payload.totals).exceptions)).toBeGreaterThanOrEqual(1);
    expect(asJson(payload.totals).exceptions).toBe(1);

    // A client cannot forge its way past the card's own gate
    // A client cannot forge its way past the card's own gate: the same read with no session at all is
    // refused by the server rather than answered from a cache.
    const anonymous = await read(`${API}${dataPath}`, null);
    expect([401, 403]).toContain(anonymous.status);

    evidence.workflow.push({
      step: 'sign-in + dashboard',
      role: 'FINANCE_AUDITOR',
      status: dashboard.status,
      templateKey: body.templateKey,
      cardAuthorized: card?.authorized,
      drilldownView: drilldown.view,
      cardReadStatus: cardRead.status,
      cardAnonymousStatus: anonymous.status,
      cardPayload: payload,
    });
  });

  it('walks card → failed-delivery queue → delivery trace → audit search by correlation id', async () => {
    const session = await login(ROLE_EMAILS.authorized, passwordFor('FINANCE_AUDITOR'));
    expect(session.token).toBeTruthy();

    // 1. The queue the card's drill-down opens: the server, not the client, applies status=FAILED.
    const queue = await read(
      `${API}/internal/notifications/deliveries?status=FAILED&page=1&limit=20`,
      session.token,
    );
    expect(queue.status).toBe(200);
    const queueBody = asJson(queue.body);
    const rows = asArray(queueBody.data);
    expect(queueBody.total).toBeDefined();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row.status === 'FAILED')).toBe(true);
    const targeted = rows.find((row) => row.id === fixture.failedDeliveryId);
    expect(targeted).toBeDefined();
    expect(asJson(targeted).correlationId).toBe(fixture.correlationId);

    // 2. The trace. The related event must be stated as found or not-found, never left ambiguous.
    const trace = await read(
      `${API}/internal/notifications/deliveries/${fixture.failedDeliveryId}`,
      session.token,
    );
    expect(trace.status).toBe(200);
    const detail = asJson(trace.body);
    const related = asJson(detail.relatedEvent);
    expect(['FOUND', 'NOT_FOUND', 'UNAVAILABLE']).toContain(related.availability);
    if (fixture.outboxAppended) expect(related.availability).toBe('FOUND');
    if (related.availability !== 'FOUND') expect(String(related.reason ?? related.id)).toBeTruthy();
    const receipts = asJson(detail.providerReceipts);
    expect(['AVAILABLE', 'NONE_RECORDED', 'UNAVAILABLE']).toContain(receipts.availability);
    if (receipts.availability !== 'AVAILABLE') {
      // The absence has to be interpreted for the reader, or "no receipt" reads as "never sent".
      expect(String(receipts.reason)).toMatch(/not evidence|cannot be read|no receipt/i);
    }
    expect(asJson(detail.delivery).status).toBe('FAILED');

    // 3. The audit funnel, reached by the same correlation id the queue row carries.
    const audit = await read(
      `${API}/internal/audit/inspection?correlationId=${encodeURIComponent(fixture.correlationId)}&page=1&limit=25`,
      session.token,
    );
    expect(audit.status).toBe(200);
    const auditBody = asJson(audit.body);
    const events = asArray(auditBody.data ?? auditBody.items ?? auditBody.events);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.correlationId).toBe(fixture.correlationId);
    expect(events[0]?.action).toBe('ARENA6_SYNTHETIC_DELIVERY_RECORDED');

    evidence.workflow.push({
      step: 'queue → trace → audit',
      queueStatus: queue.status,
      queueRows: rows.length,
      queueAllFailed: rows.every((row) => row.status === 'FAILED'),
      traceStatus: trace.status,
      relatedEvent: { availability: related.availability, id: related.id, reason: related.reason },
      providerReceipts: {
        availability: receipts.availability,
        returned: receipts.returned,
        reason: receipts.reason,
      },
      outboxSkipReason: fixture.outboxSkipReason,
      auditStatus: audit.status,
      auditEvents: events.length,
      auditFirst: { action: events[0]?.action, correlationId: events[0]?.correlationId },
    });
  });

  it('reports the health sources it could not read, with the reason attached', async () => {
    const session = await login(ROLE_EMAILS.authorized, passwordFor('FINANCE_AUDITOR'));
    const diagnostics = await read(`${API}/internal/diagnostics`, session.token);
    expect(diagnostics.status).toBe(200);
    const report = asJson(diagnostics.body);
    const components = asArray(report.components);
    // Every probe the service runs appears as a component, so nothing can be silently absent.
    expect(components.length).toBeGreaterThanOrEqual(5);
    for (const component of components) {
      expect(typeof component.key).toBe('string');
      expect(['ok', 'degraded', 'error', 'unknown']).toContain(String(component.state));
      expect(['CHECKED', 'UNAVAILABLE', 'NOT_CONFIGURED']).toContain(
        String(component.availability),
      );
      expect(iso(component.checkedAt)).toBe(true);
      if (component.availability !== 'CHECKED') {
        expect(String(component.reason).length).toBeGreaterThan(0);
      }
    }
    const unread = components.filter((component) => component.availability !== 'CHECKED');
    // A process with both workers disabled cannot have observed a worker tick: the report must say so
    // instead of reporting a zero. That is the unavailable source this run shows for real.
    expect(unread.length).toBeGreaterThanOrEqual(1);

    evidence.health = {
      status: diagnostics.status,
      overall: report.status,
      components: components.map((component) => ({
        key: component.key,
        state: component.state,
        availability: component.availability,
        reason: component.reason ?? null,
        checkedAt: component.checkedAt,
      })),
    };
  });

  it('gives a restricted role no drill-down and refuses its data directly, not just the view', async () => {
    const session = await login(ROLE_EMAILS.restricted, passwordFor('RISK_FRAUD'));
    expect(session.status).toBe(201);
    expect(session.token).toBeTruthy();

    const dashboard = await read(
      `${API}/internal/a2/workforce/dashboard/my-dashboard`,
      session.token,
    );
    expect(dashboard.status).toBe(200);
    const widgets = asArray(asJson(dashboard.body).widgets);
    const offending = widgets.filter((widget) => {
      const view = asJson(widget.drilldown).view;
      return (
        widget.authorized === true && (view === 'notificationOperations' || view === 'auditEvents')
      );
    });
    expect(offending).toEqual([]);

    const protectedReads = [
      `${API}/internal/notifications/operations/summary?hours=24`,
      `${API}/internal/notifications/deliveries?status=FAILED&page=1&limit=20`,
      `${API}/internal/notifications/deliveries/${fixture.failedDeliveryId}`,
      `${API}/internal/audit/inspection?correlationId=${encodeURIComponent(fixture.correlationId)}`,
      `${API}/internal/diagnostics`,
    ];
    const results: Json[] = [];
    for (const path of protectedReads) {
      const response = await read(path, session.token);
      expect(response.status).toBe(403);
      // 403 is only a real refusal if the body carries none of the thing being asked for.
      expect(response.raw).not.toContain(fixture.correlationId);
      expect(response.raw).not.toContain(fixture.failedDeliveryId);
      expect(response.raw).not.toContain('+2348000000000');
      results.push({ path, status: response.status, bodyBytes: response.raw.length });
    }

    evidence.restrictedRole = {
      role: 'RISK_FRAUD',
      dashboardStatus: dashboard.status,
      widgetsVisible: widgets.length,
      unauthorizedDrilldowns: offending.length,
      protectedReads: results,
    };
  });

  it('writes an evidence document that states what it does and does not certify', async () => {
    await dataSource.query('DELETE FROM notification_deliveries WHERE correlation_id = $1', [
      fixture.correlationId,
    ]);
    const session = await login(ROLE_EMAILS.authorized, passwordFor('FINANCE_AUDITOR'));
    const unauthenticated = await read(`${API}/internal/notifications/deliveries`, null);
    expect([401, 403]).toContain(unauthenticated.status);
    expect(session.status).toBe(201);

    const zeroRead = await read(
      `${API}/internal/a2/workforce/dashboard/widgets/notification-delivery-exceptions`,
      session.token,
    );
    expect(zeroRead.status).toBe(200);
    expect(asJson(zeroRead.body).availability).toBe('MEASURED');
    expect(Number(asJson(asJson(zeroRead.body).totals).exceptions)).toBe(0);
    expect(Number(asJson(asJson(zeroRead.body).totals).deliveries)).toBe(0);
    evidence.workflow.push({ step: 'measured zero on an empty window', status: zeroRead.status });

    const json = JSON.stringify(evidence);
    expect(json).toContain('arena6-real-session-workflow');
    expect(json).toContain('notCertified');
    expect(asArray(evidence.workflow).length).toBeGreaterThanOrEqual(2);
  });
});
