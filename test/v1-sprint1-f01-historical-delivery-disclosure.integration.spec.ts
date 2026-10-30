/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import request = require('supertest');
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import {
  NOTIFICATION_EMAIL_PROVIDER_TOKEN,
  NOTIFICATION_PROVIDER_TOKEN,
} from '../src/notification/notification.constants';
import { seedNotificationDefaultsV1 } from '../src/notification/notification-defaults-v1';
import { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import { NotificationDelivery } from '../src/notification/notification-delivery.entity';
import { NotificationDeliveryProcessor } from '../src/notification/notification-delivery-processor';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { NotificationTemplateService } from '../src/notification/notification-template.service';
import {
  SAFE_PROVIDER_REF_PATTERN,
  sanitizeProviderRefForBoundary,
} from '../src/notification/provider-security';
import type {
  NotificationProvider,
  NotificationSendRequest,
  NotificationSendResult,
} from '../src/notification/notification.types';
import { AuditService } from '../src/operations/audit.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

class SyntheticSentinelProvider implements NotificationProvider {
  public readonly sent: NotificationSendRequest[] = [];
  constructor(
    public name: string,
    public rawProviderRef: string,
  ) {}

  async send(req: NotificationSendRequest): Promise<NotificationSendResult> {
    this.sent.push(req);
    return {
      success: true,
      providerRef: this.rawProviderRef,
    };
  }
}

const KEY_V1_B64 = Buffer.alloc(32, 0x2a).toString('base64');
const KEY_V2_B64 = Buffer.alloc(32, 0x9c).toString('base64');
const KEYRING_V1 = JSON.stringify({ v1: KEY_V1_B64 });
const KEYRING_V1_V2 = JSON.stringify({ v1: KEY_V1_B64, v2: KEY_V2_B64 });

const RAW_SENTINELS = {
  robase: 'robe_HISTORICAL_ROBASE_SENTINEL_TX_NGN_750000_ACCT_1234567890',
  brevo: 'xkeysib-HISTORICAL_SENTINEL_TX_NGN_750000_ACCT_1234567890',
  resend: 're_HISTORICAL_RESEND_SENTINEL_TX_NGN_825000_ACCT_9876543210',
  unknownGateway: 'unknown_sms_gateway:sk_live_HISTORICAL_UNKNOWN_SENTINEL_TX_NGN_950000_ACCT_5555555555',
  unknownHarnessLookalike:
    'termii_legacy:test-1793267152798-abc123:HISTORICAL_TERMII_SENTINEL_ACCT_4444333322',
  liveRobaseProcessor: 'robe_LIVE_PROCESSOR_SENTINEL_TX_NGN_310000_ACCT_1020304050',
  liveBrevoProcessor: 'xkeysib-LIVE_PROCESSOR_SENTINEL_TX_NGN_420000_ACCT_2030405060',
  liveResendProcessor: 're_LIVE_PROCESSOR_SENTINEL_TX_NGN_530000_ACCT_3040506070',
  liveUnknownProcessor: 'acme_unknown_v0:LIVE_UNKNOWN_SENTINEL_TX_NGN_640000_ACCT_4050607080',
  rawErrorLeak: 'Upstream HTTP 500: api_key=RAW_ERROR_SECRET_SENTINEL_99999 rejected',
  renderedMessageSecret: 'Your transfer of NGN 750,000.00 to ACCT 1234567890 is complete.',
} as const;

const FORBIDDEN_SUBSTRINGS = [
  'HISTORICAL_ROBASE_SENTINEL',
  'HISTORICAL_SENTINEL_TX_NGN_750000',
  'HISTORICAL_RESEND_SENTINEL',
  'HISTORICAL_UNKNOWN_SENTINEL',
  'HISTORICAL_TERMII_SENTINEL',
  'LIVE_PROCESSOR_SENTINEL',
  'LIVE_UNKNOWN_SENTINEL',
  'RAW_ERROR_SECRET_SENTINEL_99999',
  'ACCT_1234567890',
  'ACCT_9876543210',
  'ACCT_5555555555',
  'ACCT_4444333322',
  'ACCT_1020304050',
  'ACCT_2030405060',
  'ACCT_3040506070',
  'ACCT_4050607080',
  'unknown_sms_gateway',
  'termii_legacy',
  'acme_unknown_v0',
  'NGN 750,000.00 to ACCT 1234567890',
] as const;

const SAFE_OPAQUE_FIXTURES = {
  robase: 'pvr1:robase:0123456789abcdef0123456789abcdef',
  brevo: 'pvr1:brevo:fedcba9876543210fedcba9876543210',
  resend: 'pvr1:resend:abcdef0123456789abcdef0123456789',
  external: 'pvr1:external:11223344556677889900aabbccddeeff',
} as const;

const PERMITTED_DIAGNOSTIC_KEYS = [
  'aggregateId',
  'aggregateType',
  'attempts',
  'causationId',
  'channel',
  'correlationId',
  'createdAt',
  'errorCode',
  'eventKey',
  'eventType',
  'failedAt',
  'id',
  'providerRef',
  'recipientId',
  'recipientType',
  'sentAt',
  'status',
  'updatedAt',
];

function assertZeroSentinelExposure(serializedSurface: string, surfaceName: string): void {
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (serializedSurface.includes(needle)) {
      throw new Error(`Raw sentinel substring "${needle}" leaked on surface "${surfaceName}"`);
    }
  }
}

describe('SPRINT-1 F-01 Historical Delivery Disclosure Remediation (disposable PostgreSQL + synthetic providers)', () => {
  let dataSource: DataSource;
  let capturedLogChunks: string[] = [];
  let origStdoutWrite: typeof process.stdout.write;
  let origStderrWrite: typeof process.stderr.write;

  const ENV_KEYS = [
    'NODE_ENV',
    'NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON',
    'NOTIFICATION_PROVIDER_ENCRYPTION_KEY',
    'NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION',
    'ROBASE_API_KEY',
    'BREVO_API_KEY',
    'RESEND_API_KEY',
  ] as const;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  const workforceConfig = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  };

  const workforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token.startsWith('wf:')) throw new UnauthorizedException('invalid token');
      const [, rawType = '', mode = ''] = token.split(':');
      const type = rawType.toUpperCase();
      if (mode === 'NOSCOPE') {
        return {
          type,
          principalId: `wf-${type.toLowerCase()}-noscope`,
          audience,
          roles: [type],
          scopes: ['customer.view'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        };
      }
      if (mode === 'PROVIDER_VIEW') {
        return {
          type,
          principalId: `wf-${type.toLowerCase()}-prov`,
          audience,
          roles: [type],
          scopes: ['notification.view_deliveries', 'notification.provider.view'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
          assuranceLevel: 'MFA',
        };
      }
      if (['CUSTOMER', 'AGENT', 'AGGREGATOR'].includes(type)) {
        const id = '99999999-9999-4999-8999-999999999999';
        return {
          type,
          principalId: id,
          customerId: type === 'CUSTOMER' ? id : undefined,
          agentId: type === 'AGENT' ? id : undefined,
          aggregatorId: type === 'AGGREGATOR' ? id : undefined,
          audience,
          roles: [type],
          scopes: ['notification.view_deliveries'],
          customerAccess: type === 'CUSTOMER' ? 'SELF' : 'NONE',
          agentAccess: type === 'AGENT' ? 'SELF' : 'NONE',
          aggregatorAccess: type === 'AGGREGATOR' ? 'SELF' : 'NONE',
        };
      }
      return {
        type,
        principalId: `wf-${type.toLowerCase()}`,
        audience,
        roles: [type],
        scopes: ['notification.view_deliveries'],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
        assuranceLevel: 'MFA',
      };
    },
  };

  async function bootAppInstance(options?: {
    smsProvider?: NotificationProvider;
    emailProvider?: NotificationProvider;
  }): Promise<{
    app: NestFastifyApplication;
    dispatcher: NotificationDispatcherService;
    resolver: NotificationChannelResolverService;
    templates: NotificationTemplateService;
    auditService: AuditService;
  }> {
    const sms =
      options?.smsProvider ??
      new SyntheticSentinelProvider('robase', RAW_SENTINELS.liveRobaseProcessor);
    const email =
      options?.emailProvider ??
      new SyntheticSentinelProvider('brevo', RAW_SENTINELS.liveBrevoProcessor);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(workforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(sms)
      .overrideProvider(NOTIFICATION_EMAIL_PROVIDER_TOKEN)
      .useValue(email)
      .compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    return {
      app,
      dispatcher: moduleRef.get(NotificationDispatcherService),
      resolver: moduleRef.get(NotificationChannelResolverService),
      templates: moduleRef.get(NotificationTemplateService),
      auditService: moduleRef.get(AuditService),
    };
  }

  async function closeAppInstance(app: NestFastifyApplication): Promise<void> {
    await app.close();
    if (dataSource && !dataSource.isInitialized) {
      await dataSource.initialize();
    }
  }

  async function createCustomerFixture(phone80: string, emailAddress: string): Promise<string> {
    const cid = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1, $2, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED')`,
      [cid, `cust-${cid}`],
    );
    await dataSource.query(
      `INSERT INTO customer_profiles (id, customer_id, display_name, is_active)
       VALUES ($1, $2, 'F01 Test Customer', true)`,
      [randomUUID(), cid],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1, $2, 'PHONE', $3, $3, true, NOW()),
              ($4, $2, 'EMAIL', $5, $5, true, NOW())`,
      [randomUUID(), cid, phone80, randomUUID(), emailAddress],
    );
    await dataSource.query(
      `INSERT INTO customer_preferences
        (id, customer_id, language_code, theme_code, notification_email_enabled, notification_sms_enabled,
         notification_push_enabled, notification_in_app_enabled, security_login_alerts, security_transaction_alerts,
         security_device_registration_alerts, security_biometric_allowed, version)
       VALUES ($1, $2, 'EN', 'SYSTEM', true, true, true, true, true, true, true, false, 1)`,
      [randomUUID(), cid],
    );
    return cid;
  }

  async function seedHistoricalDeliveryRow(params: {
    eventKey: string;
    recipientType: 'CUSTOMER' | 'AGENT' | 'PHONE';
    recipientId: string;
    channel: 'SMS' | 'EMAIL' | 'PUSH';
    destination: string;
    providerRef: string | null;
    status?: 'SENT' | 'FAILED' | 'PENDING' | 'SKIPPED';
    lastError?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const status = params.status ?? 'SENT';
    await dataSource.query(
      `INSERT INTO notification_deliveries
        (id, event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id,
         channel, destination, payload, message, status, attempts, provider_ref, last_error,
         created_at, updated_at, sent_at, failed_at)
       VALUES ($1, 'customer.funding.approved', $2, 'CUSTOMER_FUNDING', $3, $4, $5,
               $6, $7, $8::jsonb, $9, $10::varchar, 1, $11, $12, NOW(), NOW(),
               CASE WHEN $10::varchar='SENT' THEN NOW() ELSE NULL END,
               CASE WHEN $10::varchar='FAILED' THEN NOW() ELSE NULL END)`,
      [
        id,
        params.eventKey,
        randomUUID(),
        params.recipientType,
        params.recipientId,
        params.channel,
        params.destination,
        JSON.stringify({ reference: 'REF-HIST', _templateKey: 'customer.funding.approved' }),
        RAW_SENTINELS.renderedMessageSecret,
        status,
        params.providerRef,
        params.lastError ?? null,
      ],
    );
    return id;
  }

  beforeAll(async () => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env['NODE_ENV'] = 'test';
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON'] = KEYRING_V1;
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION'] = 'v1';

    origStdoutWrite = process.stdout.write.bind(process.stdout);
    origStderrWrite = process.stderr.write.bind(process.stderr);
    (process.stdout as any).write = (chunk: any, ...rest: any[]) => {
      capturedLogChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return origStdoutWrite(chunk, ...rest);
    };
    (process.stderr as any).write = (chunk: any, ...rest: any[]) => {
      capturedLogChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return origStderrWrite(chunk, ...rest);
    };

    dataSource = await createIntegrationDataSource('v1sprint1f01hist');
  }, 180_000);

  afterAll(async () => {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
    }
  }, 60_000);

  beforeEach(async () => {
    capturedLogChunks = [];
    process.env['NODE_ENV'] = 'test';
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON'] = KEYRING_V1;
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION'] = 'v1';
    delete process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEY'];
    delete process.env['ROBASE_API_KEY'];
    delete process.env['BREVO_API_KEY'];
    delete process.env['RESEND_API_KEY'];
    await truncateAllTables(dataSource);
    await seedNotificationDefaultsV1(dataSource.manager);
  });

  it('1. zero raw sentinel exposure across HTTP diagnostics, duplicate dispatch, listDeliveriesForEventKey(), ORM loads, logs, and audit projections while preserving safe pvr1 refs', async () => {
    const inst = await bootAppInstance();
    try {
      const cid1 = await createCustomerFixture('8031000001', 'f01-c1@example.com');
      const cid2 = await createCustomerFixture('8031000002', 'f01-c2@example.com');
      const cid3 = await createCustomerFixture('8031000003', 'f01-c3@example.com');
      const cid4 = await createCustomerFixture('8031000004', 'f01-c4@example.com');

      const robaseEventKey = `customer.funding.approved:hist-robase-${randomUUID()}`;
      const brevoEventKey = `customer.funding.approved:hist-brevo-${randomUUID()}`;
      const resendEventKey = `customer.funding.approved:hist-resend-${randomUUID()}`;
      const unknownEventKey = `customer.funding.approved:hist-unknown-${randomUUID()}`;

      // Historical raw rows for Robase, Brevo, Resend, and unknown provider names
      const idRobase = await seedHistoricalDeliveryRow({
        eventKey: robaseEventKey,
        recipientType: 'CUSTOMER',
        recipientId: cid1,
        channel: 'SMS',
        destination: '+2348031000001',
        providerRef: RAW_SENTINELS.robase,
      });
      const idBrevo = await seedHistoricalDeliveryRow({
        eventKey: brevoEventKey,
        recipientType: 'CUSTOMER',
        recipientId: cid2,
        channel: 'EMAIL',
        destination: 'f01-c2@example.com',
        providerRef: RAW_SENTINELS.brevo,
      });
      const idResend = await seedHistoricalDeliveryRow({
        eventKey: resendEventKey,
        recipientType: 'CUSTOMER',
        recipientId: cid3,
        channel: 'EMAIL',
        destination: 'f01-c3@example.com',
        providerRef: RAW_SENTINELS.resend,
      });
      const idUnknown = await seedHistoricalDeliveryRow({
        eventKey: unknownEventKey,
        recipientType: 'CUSTOMER',
        recipientId: cid4,
        channel: 'SMS',
        destination: '+2348031000004',
        providerRef: RAW_SENTINELS.unknownGateway,
      });
      const idPhoneUnknown = await seedHistoricalDeliveryRow({
        eventKey: `cash_to_cash.created:hist-phone-${randomUUID()}`,
        recipientType: 'PHONE',
        recipientId: '8099887678',
        channel: 'SMS',
        destination: '+2348099887678',
        providerRef: RAW_SENTINELS.unknownHarnessLookalike,
      });
      const idFailedRawErr = await seedHistoricalDeliveryRow({
        eventKey: `customer.funding.approved:hist-failed-${randomUUID()}`,
        recipientType: 'CUSTOMER',
        recipientId: cid1,
        channel: 'SMS',
        destination: '+2348031000001',
        providerRef: null,
        status: 'FAILED',
        lastError: RAW_SENTINELS.rawErrorLeak,
      });

      // Already-safe opaque references across all 4 scopes (must be preserved unchanged)
      const idSafeRobase = await seedHistoricalDeliveryRow({
        eventKey: `safe-robase:${randomUUID()}`,
        recipientType: 'CUSTOMER',
        recipientId: cid1,
        channel: 'SMS',
        destination: '+2348031000001',
        providerRef: SAFE_OPAQUE_FIXTURES.robase,
      });
      const idSafeBrevo = await seedHistoricalDeliveryRow({
        eventKey: `safe-brevo:${randomUUID()}`,
        recipientType: 'CUSTOMER',
        recipientId: cid2,
        channel: 'EMAIL',
        destination: 'f01-c2@example.com',
        providerRef: SAFE_OPAQUE_FIXTURES.brevo,
      });
      const idSafeResend = await seedHistoricalDeliveryRow({
        eventKey: `safe-resend:${randomUUID()}`,
        recipientType: 'CUSTOMER',
        recipientId: cid3,
        channel: 'EMAIL',
        destination: 'f01-c3@example.com',
        providerRef: SAFE_OPAQUE_FIXTURES.resend,
      });
      const idSafeExternal = await seedHistoricalDeliveryRow({
        eventKey: `safe-external:${randomUUID()}`,
        recipientType: 'CUSTOMER',
        recipientId: cid4,
        channel: 'SMS',
        destination: '+2348031000004',
        providerRef: SAFE_OPAQUE_FIXTURES.external,
      });

      // Historical audit_events + notification_provider_configurations rows with raw sentinels
      await dataSource.query(
        `INSERT INTO audit_events (id, entity_type, entity_id, action, actor, previous_values, new_values, occurred_at)
         VALUES
           ($1, 'NOTIFICATION_TEST_SEND', $2, 'TEST_SENT', 'legacy-ops', NULL, $3::jsonb, NOW()),
           ($4, 'NOTIFICATION_DELIVERY', $5, 'LEGACY_DELIVERY_AUDIT', 'legacy-worker', $6::jsonb, $7::jsonb, NOW())`,
        [
          randomUUID(),
          randomUUID(),
          JSON.stringify({
            channel: 'SMS',
            provider: 'unknown_sms_gateway',
            providerRef: RAW_SENTINELS.unknownGateway,
          }),
          randomUUID(),
          idBrevo,
          JSON.stringify({ provider_ref: RAW_SENTINELS.robase }),
          JSON.stringify({
            provider: 'brevo',
            providerRef: RAW_SENTINELS.brevo,
            nested: [{ provider: 'resend', provider_ref: RAW_SENTINELS.resend }],
          }),
        ],
      );
      await dataSource.query(
        `INSERT INTO notification_provider_configurations
          (channel, provider, enabled, last_test_status, last_test_destination_masked, last_test_provider_ref, updated_by, approved_by)
         VALUES
          ('SMS', 'robase', false, 'SENT', '***0001', $1, 'seed', 'seed-checker'),
          ('EMAIL', 'brevo', false, 'SENT', 'f0***@example.com', $2, 'seed', 'seed-checker')
         ON CONFLICT (channel) DO UPDATE
           SET provider = EXCLUDED.provider,
               last_test_status = EXCLUDED.last_test_status,
               last_test_provider_ref = EXCLUDED.last_test_provider_ref`,
        [RAW_SENTINELS.robase, RAW_SENTINELS.brevo],
      );

      // (A) Authorized GET /api/v1/internal/notifications/deliveries (SUPPORT + OPERATOR)
      for (const token of ['wf:SUPPORT', 'wf:OPERATOR', 'wf:PRIVILEGED']) {
        const res = await request(inst.app.getHttpServer())
          .get('/api/v1/internal/notifications/deliveries?limit=50')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        assertZeroSentinelExposure(JSON.stringify(res.body), `HTTP deliveries (${token})`);

        for (const item of res.body.data as Array<Record<string, unknown>>) {
          expect(Object.keys(item).sort()).toEqual(PERMITTED_DIAGNOSTIC_KEYS);
          if (item['providerRef'] !== null) {
            expect(item['providerRef']).toMatch(SAFE_PROVIDER_REF_PATTERN);
          }
        }

        const byId = new Map<string, any>(res.body.data.map((d: any) => [d.id, d]));
        expect(byId.get(idRobase)?.providerRef).toBe(
          sanitizeProviderRefForBoundary(RAW_SENTINELS.robase),
        );
        expect(byId.get(idBrevo)?.providerRef).toBe(
          sanitizeProviderRefForBoundary(RAW_SENTINELS.brevo),
        );
        expect(byId.get(idResend)?.providerRef).toBe(
          sanitizeProviderRefForBoundary(RAW_SENTINELS.resend),
        );
        expect(byId.get(idUnknown)?.providerRef).toBe(
          sanitizeProviderRefForBoundary(RAW_SENTINELS.unknownGateway),
        );
        expect(byId.get(idPhoneUnknown)?.recipientId).toBe('*******678');
        expect(byId.get(idPhoneUnknown)?.providerRef).toMatch(SAFE_PROVIDER_REF_PATTERN);
        expect(byId.get(idFailedRawErr)?.errorCode).toBe('UNCLASSIFIED');

        // Already-safe opaque references preserved verbatim
        expect(byId.get(idSafeRobase)?.providerRef).toBe(SAFE_OPAQUE_FIXTURES.robase);
        expect(byId.get(idSafeBrevo)?.providerRef).toBe(SAFE_OPAQUE_FIXTURES.brevo);
        expect(byId.get(idSafeResend)?.providerRef).toBe(SAFE_OPAQUE_FIXTURES.resend);
        expect(byId.get(idSafeExternal)?.providerRef).toBe(SAFE_OPAQUE_FIXTURES.external);
      }

      // (B) Duplicate dispatch results (top-level + caller-supplied transaction manager)
      for (const [cid, eventKey, expectedChannel, expectedRaw] of [
        [cid1, robaseEventKey, 'SMS', RAW_SENTINELS.robase],
        [cid2, brevoEventKey, 'EMAIL', RAW_SENTINELS.brevo],
        [cid3, resendEventKey, 'EMAIL', RAW_SENTINELS.resend],
        [cid4, unknownEventKey, 'SMS', RAW_SENTINELS.unknownGateway],
      ] as const) {
        const dupDirect = await inst.dispatcher.dispatch({
          eventType: 'customer.funding.approved',
          eventKey,
          payload: { customerId: cid, reference: 'REF-DUP', amountMinor: '1000' },
        });
        assertZeroSentinelExposure(JSON.stringify(dupDirect), `dispatcher duplicate (${eventKey})`);
        for (const d of dupDirect.deliveries) {
          if (d.providerRef !== null) {
            expect(d.providerRef).toMatch(SAFE_PROVIDER_REF_PATTERN);
          }
        }
        const matched = dupDirect.deliveries.find((d) => d.channel === expectedChannel);
        expect(matched).toBeDefined();
        expect(matched?.providerRef).toBe(sanitizeProviderRefForBoundary(expectedRaw));

        const dupTx = await dataSource.transaction((tx) =>
          inst.dispatcher.dispatch(
            {
              eventType: 'customer.funding.approved',
              eventKey,
              payload: { customerId: cid, reference: 'REF-DUP', amountMinor: '1000' },
            },
            tx,
          ),
        );
        assertZeroSentinelExposure(JSON.stringify(dupTx), `dispatcher tx duplicate (${eventKey})`);
      }

      // (C) listDeliveriesForEventKey()
      for (const eventKey of [robaseEventKey, brevoEventKey, resendEventKey, unknownEventKey]) {
        const rows = await inst.dispatcher.listDeliveriesForEventKey(eventKey);
        expect(rows.length).toBeGreaterThanOrEqual(1);
        assertZeroSentinelExposure(JSON.stringify(rows), `listDeliveriesForEventKey (${eventKey})`);
        expect(rows.some((r) => r['provider_ref'] !== null)).toBe(true);
        for (const r of rows) {
          if (r['provider_ref'] !== null) {
            expect(r['provider_ref']).toMatch(SAFE_PROVIDER_REF_PATTERN);
          }
        }
      }

      // (D) TypeORM NotificationDelivery entity load boundary
      const entityRows = await dataSource.getRepository(NotificationDelivery).find();
      assertZeroSentinelExposure(
        JSON.stringify(entityRows.map((e) => ({ id: e.id, providerRef: e.providerRef }))),
        'TypeORM NotificationDelivery repository load',
      );
      for (const entity of entityRows) {
        if (entity.providerRef !== null) {
          expect(entity.providerRef).toMatch(SAFE_PROVIDER_REF_PATTERN);
        }
      }

      // (E) Audit & Provider Diagnostics projections
      const standardAudit = await inst.auditService.list({ limit: 50 });
      assertZeroSentinelExposure(JSON.stringify(standardAudit), 'AuditService.list');
      const oversightAudit = await inst.auditService.listWithNotificationProviderOversight({
        limit: 50,
      });
      assertZeroSentinelExposure(
        JSON.stringify(oversightAudit),
        'AuditService.listWithNotificationProviderOversight',
      );
      const provRes = await request(inst.app.getHttpServer())
        .get('/api/v1/internal/notifications/provider-status')
        .set('Authorization', 'Bearer wf:OPERATOR:PROVIDER_VIEW')
        .expect(200);
      assertZeroSentinelExposure(
        JSON.stringify(provRes.body),
        'GET /internal/notifications/provider-status',
      );
      expect(provRes.body.sms.lastTest.providerRef).toMatch(/^pvr1:robase:[0-9a-f]{32}$/);
      expect(provRes.body.email.lastTest.providerRef).toMatch(/^pvr1:brevo:[0-9a-f]{32}$/);

      // (F) Underlying historical DB evidence was NOT mutated by reads
      const rawStillIntact = await dataSource.query<Array<{ provider_ref: string }>>(
        `SELECT provider_ref FROM notification_deliveries WHERE id = $1`,
        [idBrevo],
      );
      expect(rawStillIntact[0]?.provider_ref).toBe(RAW_SENTINELS.brevo);

      // (G) Application logs emitted zero sentinel substrings
      assertZeroSentinelExposure(capturedLogChunks.join(''), 'application stdout/stderr logs');
    } finally {
      await closeAppInstance(inst.app);
    }
  });

  it('2. internal delivery processor & dispatcher return paths sanitize Robase, Brevo, Resend, and unknown synthetic providers on write and read', async () => {
    const unknownSms = new SyntheticSentinelProvider(
      'acme_unknown_v0',
      RAW_SENTINELS.liveUnknownProcessor,
    );
    const resendEmail = new SyntheticSentinelProvider(
      'resend',
      RAW_SENTINELS.liveResendProcessor,
    );
    const inst = await bootAppInstance({ smsProvider: unknownSms, emailProvider: resendEmail });
    try {
      await dataSource.query(
        `UPDATE notification_event_configurations
            SET is_enabled = true, version = version + 1, updated_by = 'f01-test'
          WHERE event_type = 'customer.funding.approved' AND channel = 'EMAIL'`,
      );
      const cid = await createCustomerFixture('8032000001', 'f01-proc@example.com');
      const eventKey = `customer.funding.approved:live-proc-${randomUUID()}`;
      const dispatchRes = await inst.dispatcher.dispatch({
        eventType: 'customer.funding.approved',
        eventKey,
        payload: { customerId: cid, reference: 'REF-PROC', amountMinor: '2500' },
      });

      assertZeroSentinelExposure(JSON.stringify(dispatchRes), 'live dispatcher result');
      expect(dispatchRes.dispatched).toBe(2);
      const smsDelivery = dispatchRes.deliveries.find((d) => d.channel === 'SMS')!;
      const emailDelivery = dispatchRes.deliveries.find((d) => d.channel === 'EMAIL')!;
      expect(smsDelivery.providerRef).toMatch(/^pvr1:external:[0-9a-f]{32}$/);
      expect(emailDelivery.providerRef).toMatch(/^pvr1:resend:[0-9a-f]{32}$/);

      // Also exercise NotificationDeliveryProcessor directly with synthetic Robase + Brevo
      const cid2 = await createCustomerFixture('8032000002', 'f01-proc2@example.com');
      const manualKey = `customer.funding.approved:manual-proc-${randomUUID()}`;
      const materialized = await dataSource.transaction((tx) =>
        inst.dispatcher.dispatch(
          {
            eventType: 'customer.funding.approved',
            eventKey: manualKey,
            payload: { customerId: cid2, reference: 'REF-MAN', amountMinor: '5000' },
          },
          tx,
        ),
      );
      expect(materialized.deliveries.every((d) => d.status === 'PENDING')).toBe(true);

      const processor = new NotificationDeliveryProcessor({
        dataSource,
        resolver: inst.resolver,
        templates: inst.templates,
        smsProvider: new SyntheticSentinelProvider('robase', RAW_SENTINELS.liveRobaseProcessor),
        emailProvider: new SyntheticSentinelProvider('brevo', RAW_SENTINELS.liveBrevoProcessor),
        maxAttempts: 3,
        baseDelaySeconds: 60,
      });
      const batch = await processor.processBatch(10);
      expect(batch.sent).toBe(2);

      const stored = await inst.dispatcher.listDeliveriesForEventKey(manualKey);
      assertZeroSentinelExposure(JSON.stringify(stored), 'manual processor stored rows');
      const smsStored = stored.find((r) => r['channel'] === 'SMS');
      const emailStored = stored.find((r) => r['channel'] === 'EMAIL');
      expect(smsStored?.['provider_ref']).toMatch(/^pvr1:robase:[0-9a-f]{32}$/);
      expect(emailStored?.['provider_ref']).toMatch(/^pvr1:brevo:[0-9a-f]{32}$/);

      assertZeroSentinelExposure(capturedLogChunks.join(''), 'processor stdout/stderr logs');
    } finally {
      await closeAppInstance(inst.app);
    }
  });

  it('3. unauthorized callers remain blocked (401 unauthenticated / non-workforce, 403 FUNCTION_MISSING without notification.view_deliveries)', async () => {
    const inst = await bootAppInstance();
    try {
      const cid = await createCustomerFixture('8033000001', 'f01-auth@example.com');
      await seedHistoricalDeliveryRow({
        eventKey: `auth-test:${randomUUID()}`,
        recipientType: 'CUSTOMER',
        recipientId: cid,
        channel: 'EMAIL',
        destination: 'f01-auth@example.com',
        providerRef: RAW_SENTINELS.brevo,
      });

      // Unauthenticated -> 401
      const unauth = await request(inst.app.getHttpServer())
        .get('/api/v1/internal/notifications/deliveries')
        .expect(401);
      assertZeroSentinelExposure(JSON.stringify(unauth.body), '401 unauthenticated');

      // Non-workforce principals (even with forged scopes) -> 401
      for (const nonWf of ['wf:CUSTOMER', 'wf:AGENT', 'wf:AGGREGATOR']) {
        const denied = await request(inst.app.getHttpServer())
          .get('/api/v1/internal/notifications/deliveries')
          .set('Authorization', `Bearer ${nonWf}`)
          .expect(401);
        assertZeroSentinelExposure(JSON.stringify(denied.body), `401 ${nonWf}`);
      }

      // Workforce principals lacking notification.view_deliveries -> 403 FUNCTION_MISSING
      for (const wfNoScope of [
        'wf:SUPPORT:NOSCOPE',
        'wf:OPERATOR:NOSCOPE',
        'wf:SERVICE:NOSCOPE',
        'wf:PRIVILEGED:NOSCOPE',
      ]) {
        const forbidden = await request(inst.app.getHttpServer())
          .get('/api/v1/internal/notifications/deliveries?status=INVALID_ORACLE_CHECK')
          .set('Authorization', `Bearer ${wfNoScope}`)
          .expect(403);
        expect(String(forbidden.body.message ?? '')).toContain('FUNCTION_MISSING');
        assertZeroSentinelExposure(JSON.stringify(forbidden.body), `403 ${wfNoScope}`);
      }
    } finally {
      await closeAppInstance(inst.app);
    }
  });

  it('4. deterministic across application restarts for fixed keyring; preserves stored pvr1 tokens across synthetic key rotation; fails closed in production without durable secrets', async () => {
    const cid = await createCustomerFixture('8034000001', 'f01-restart@example.com');
    const histKey = `restart-hist:${randomUUID()}`;
    const safeKey = `restart-safe:${randomUUID()}`;
    const idHist = await seedHistoricalDeliveryRow({
      eventKey: histKey,
      recipientType: 'CUSTOMER',
      recipientId: cid,
      channel: 'EMAIL',
      destination: 'f01-restart@example.com',
      providerRef: RAW_SENTINELS.brevo,
    });
    const idSafe = await seedHistoricalDeliveryRow({
      eventKey: safeKey,
      recipientType: 'CUSTOMER',
      recipientId: cid,
      channel: 'SMS',
      destination: '+2348034000001',
      providerRef: SAFE_OPAQUE_FIXTURES.robase,
    });

    // Boot #1 with KEYRING_V1
    const inst1 = await bootAppInstance();
    let boot1HistRef = '';
    try {
      const res1 = await request(inst1.app.getHttpServer())
        .get('/api/v1/internal/notifications/deliveries?limit=20')
        .set('Authorization', 'Bearer wf:SUPPORT')
        .expect(200);
      assertZeroSentinelExposure(JSON.stringify(res1.body), 'boot #1 deliveries');
      boot1HistRef = res1.body.data.find((d: any) => d.id === idHist)?.providerRef;
      const boot1SafeRef = res1.body.data.find((d: any) => d.id === idSafe)?.providerRef;
      expect(boot1HistRef).toMatch(SAFE_PROVIDER_REF_PATTERN);
      expect(boot1SafeRef).toBe(SAFE_OPAQUE_FIXTURES.robase);
    } finally {
      await closeAppInstance(inst1.app);
    }

    // Boot #2 (simulated application restart) with identical KEYRING_V1 -> identical digest
    const inst2 = await bootAppInstance();
    try {
      const res2 = await request(inst2.app.getHttpServer())
        .get('/api/v1/internal/notifications/deliveries?limit=20')
        .set('Authorization', 'Bearer wf:SUPPORT')
        .expect(200);
      assertZeroSentinelExposure(JSON.stringify(res2.body), 'boot #2 deliveries');
      const boot2HistRef = res2.body.data.find((d: any) => d.id === idHist)?.providerRef;
      const boot2SafeRef = res2.body.data.find((d: any) => d.id === idSafe)?.providerRef;
      expect(boot2HistRef).toBe(boot1HistRef);
      expect(boot2SafeRef).toBe(SAFE_OPAQUE_FIXTURES.robase);
    } finally {
      await closeAppInstance(inst2.app);
    }

    // Boot #3 with rotated synthetic keyring KEYRING_V1_V2 (R-01 verification):
    // - Already-safe pvr1:* rows remain 100% unchanged.
    // - Un-backfilled legacy raw rows never expose sentinels and deterministically reflect the active keyring.
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON'] = KEYRING_V1_V2;
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION'] = 'v2';
    const inst3 = await bootAppInstance();
    try {
      const res3 = await request(inst3.app.getHttpServer())
        .get('/api/v1/internal/notifications/deliveries?limit=20')
        .set('Authorization', 'Bearer wf:SUPPORT')
        .expect(200);
      assertZeroSentinelExposure(JSON.stringify(res3.body), 'boot #3 rotated-key deliveries');
      const boot3HistRef = res3.body.data.find((d: any) => d.id === idHist)?.providerRef;
      const boot3SafeRef = res3.body.data.find((d: any) => d.id === idSafe)?.providerRef;
      expect(boot3SafeRef).toBe(SAFE_OPAQUE_FIXTURES.robase);
      expect(boot3HistRef).toMatch(SAFE_PROVIDER_REF_PATTERN);
      expect(boot3HistRef).not.toBe(boot1HistRef);

      // Production fail-closed check: removing all durable secrets under NODE_ENV=production
      // refuses to fall back to a process-ephemeral secret and never leaks raw sentinels.
      delete process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON'];
      delete process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEY'];
      delete process.env['ROBASE_API_KEY'];
      delete process.env['BREVO_API_KEY'];
      delete process.env['RESEND_API_KEY'];
      process.env['NODE_ENV'] = 'production';

      const failClosed = await request(inst3.app.getHttpServer())
        .get('/api/v1/internal/notifications/deliveries?limit=20')
        .set('Authorization', 'Bearer wf:SUPPORT')
        .expect(500);
      assertZeroSentinelExposure(
        JSON.stringify(failClosed.body),
        'NODE_ENV=production fail-closed 500',
      );
    } finally {
      process.env['NODE_ENV'] = 'test';
      process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON'] = KEYRING_V1;
      process.env['NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION'] = 'v1';
      await closeAppInstance(inst3.app);
    }

    assertZeroSentinelExposure(capturedLogChunks.join(''), 'restart & rotation logs');
  });
});
