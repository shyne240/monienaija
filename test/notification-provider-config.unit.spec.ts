/* eslint-disable @typescript-eslint/require-await */
import { randomBytes, randomUUID } from 'node:crypto';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';

import type { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { redactRecord, redactSensitiveText } from '../src/common/sensitive-data-redaction';
import { type Environment, validateEnvironment } from '../src/config/environment';
import {
  BrevoEmailProvider,
  type BrevoFetchFn,
  parseSenderIdentity,
  verifyBrevoConnection,
} from '../src/notification/brevo-email-provider';
import { NotificationProviderConfigService } from '../src/notification/notification-provider-config.service';
import {
  computeKeyFingerprint,
  NotificationSecretEncryptionError,
  NotificationSecretEncryptionService,
} from '../src/notification/notification-secret-encryption.service';
import type { NotificationSendRequest } from '../src/notification/notification.types';
import type { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';

const KEY_V1 = randomBytes(32).toString('base64');
const KEY_V2 = randomBytes(32).toString('base64');
const SAMPLE_ROBASE_KEY = 'robe_' + '9f8e7d6c5b4a3210'.repeat(4);
const SAMPLE_BREVO_KEY = 'xkeysib-' + 'a1b2c3d4e5f60718'.repeat(4) + '-XyZ9';

function makeConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function emailRequest(overrides: Partial<NotificationSendRequest> = {}): NotificationSendRequest {
  return {
    channel: 'EMAIL',
    destination: 'Customer.One@Example.com',
    subject: 'MonieNaija Transfer Completed',
    message: 'Transfer of NGN 5,000.00 completed. Ref TX889900.',
    html: '<p>Transfer of <strong>NGN 5,000.00</strong> completed. Ref TX889900.</p>',
    payload: {},
    correlationId: 'corr-brevo-1',
    eventType: 'transfer.completed',
    eventKey: 'transfer.completed:tx-1',
    recipientType: 'CUSTOMER',
    recipientId: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

describe('NotificationSecretEncryptionService (AES-256-GCM at rest)', () => {
  it('1. encrypts and decrypts secrets with versioned keyring and supports seamless key rotation', () => {
    const svcV1 = new NotificationSecretEncryptionService(
      makeConfig({
        NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON: JSON.stringify({ v1: KEY_V1 }),
        NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
      }),
    );

    const encSms = svcV1.encrypt(SAMPLE_ROBASE_KEY, 'SMS');
    expect(encSms.envelope.startsWith('MNNPS1:v1:')).toBe(true);
    expect(encSms.envelope).not.toContain(SAMPLE_ROBASE_KEY);
    expect(encSms.envelope).not.toContain('robe_');
    expect(encSms.keyVersion).toBe('v1');
    expect(encSms.fingerprint).toBe(`****${SAMPLE_ROBASE_KEY.slice(-4)}`);
    expect(svcV1.decrypt(encSms.envelope, 'SMS', 'v1')).toBe(SAMPLE_ROBASE_KEY);

    // Rotate active key to v2 while retaining v1 in keyring: existing v1 ciphertexts still decrypt,
    // new encryptions use v2.
    const svcV2 = new NotificationSecretEncryptionService(
      makeConfig({
        NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON: JSON.stringify({
          v1: KEY_V1,
          v2: KEY_V2,
        }),
        NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION: 'v2',
      }),
    );

    expect(svcV2.decrypt(encSms.envelope, 'SMS', 'v1')).toBe(SAMPLE_ROBASE_KEY);
    const encEmailV2 = svcV2.encrypt(SAMPLE_BREVO_KEY, 'EMAIL');
    expect(encEmailV2.keyVersion).toBe('v2');
    expect(encEmailV2.envelope.startsWith('MNNPS1:v2:')).toBe(true);
    expect(svcV2.decrypt(encEmailV2.envelope, 'EMAIL', 'v2')).toBe(SAMPLE_BREVO_KEY);
  });

  it('2. enforces channel-bound AAD and fails closed on tampering or missing key without leaking secrets', () => {
    const svc = new NotificationSecretEncryptionService(
      makeConfig({
        NOTIFICATION_PROVIDER_ENCRYPTION_KEY: KEY_V1,
        NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
      }),
    );

    const enc = svc.encrypt(SAMPLE_BREVO_KEY, 'EMAIL');

    // Cross-channel substitution (EMAIL envelope used as SMS) fails GCM authentication
    expect(() => svc.decrypt(enc.envelope, 'SMS', 'v1')).toThrow(
      NotificationSecretEncryptionError,
    );

    // Tampered ciphertext fails GCM authentication without echoing secret or envelope
    const segments = enc.envelope.split(':');
    const flipped =
      segments[4]!.slice(0, -2) + (segments[4]!.endsWith('AA') ? 'BB' : 'AA');
    const tampered = [segments[0], segments[1], segments[2], segments[3], flipped].join(':');
    try {
      svc.decrypt(tampered, 'EMAIL', 'v1');
      fail('Expected tampered envelope to fail decryption');
    } catch (err) {
      expect(err).toBeInstanceOf(NotificationSecretEncryptionError);
      expect((err as NotificationSecretEncryptionError).code).toBe(
        'PROVIDER_SECRET_DECRYPT_FAILED',
      );
      expect((err as Error).message).not.toContain(SAMPLE_BREVO_KEY);
      expect((err as Error).message).not.toContain('MNNPS1');
    }

    // Missing server key fails closed with PROVIDER_ENCRYPTION_KEY_MISSING
    const missingKeySvc = new NotificationSecretEncryptionService(makeConfig({}));
    expect(missingKeySvc.isAvailable()).toBe(false);
    expect(() => missingKeySvc.encrypt(SAMPLE_BREVO_KEY, 'EMAIL')).toThrow(
      /Server-side notification provider encryption key is not configured/,
    );
    expect(() => missingKeySvc.decrypt(enc.envelope, 'EMAIL', 'v1')).toThrow(
      /Server-side notification provider encryption key is not configured/,
    );
  });

  it('3. computeKeyFingerprint masks all but final 4 safe characters', () => {
    expect(computeKeyFingerprint(SAMPLE_BREVO_KEY)).toBe('****XyZ9');
    expect(computeKeyFingerprint(SAMPLE_ROBASE_KEY)).toBe('****3210');
  });
});

describe('BrevoEmailProvider & verifyBrevoConnection (documented v3 contract, mocked transport)', () => {
  it('1. sends transactional email via POST /v3/smtp/email with api-key header and returns messageId', async () => {
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }> = [];

    const mockFetch: BrevoFetchFn = async (url, init) => {
      calls.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
      });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          messageId: '<202610281200.998877@smtp-relay.mailin.fr>',
        }),
      };
    };

    const provider = new BrevoEmailProvider(
      {
        baseUrl: 'https://api.brevo.com/',
        apiKey: SAMPLE_BREVO_KEY,
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija Alerts',
        replyTo: 'support@monienaija.ng',
        requestTimeoutMs: 5000,
      },
      mockFetch,
    );

    const res = await provider.send(
      emailRequest({
        subject: 'Transfer Completed\r\nBcc: injected@evil.example',
      }),
    );

    expect(res).toEqual({
      success: true,
      providerRef: '<202610281200.998877@smtp-relay.mailin.fr>',
    });
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['api-key']).toBe(SAMPLE_BREVO_KEY);
    expect(calls[0]!.headers['content-type']).toBe('application/json');

    const sentBody = JSON.parse(calls[0]!.body!) as Record<string, unknown>;
    expect(sentBody['sender']).toEqual({
      email: 'notifications@monienaija.ng',
      name: 'MonieNaija Alerts',
    });
    expect(sentBody['to']).toEqual([{ email: 'customer.one@example.com' }]);
    expect(sentBody['replyTo']).toEqual({ email: 'support@monienaija.ng' });
    // CR/LF stripped from subject (header-injection safe)
    expect(String(sentBody['subject'])).not.toMatch(/[\r\n]/);
    expect(sentBody['textContent']).toContain('Ref TX889900.');
    expect(sentBody['htmlContent']).toContain('<strong>NGN 5,000.00</strong>');
    expect(sentBody['tags']).toEqual(['transfer.completed']);
  });

  it('2. rejects xsmtpsib- SMTP relay keys immediately without network call', async () => {
    let called = false;
    const provider = new BrevoEmailProvider(
      {
        baseUrl: 'https://api.brevo.com',
        apiKey: 'xsmtpsib-1234567890abcdef1234567890abcdef',
        fromEmail: 'notifications@monienaija.ng',
        requestTimeoutMs: 5000,
      },
      async () => {
        called = true;
        return { ok: true, status: 201, json: async () => ({ messageId: 'x' }) };
      },
    );

    const res = await provider.send(emailRequest());
    expect(res).toEqual({ success: false, error: 'BREVO_SMTP_KEY_NOT_SUPPORTED' });
    expect(called).toBe(false);
  });

  it('3. redacts credentials and provider prose across HTTP failure and network error paths', async () => {
    const httpFail = await new BrevoEmailProvider(
      {
        baseUrl: 'https://api.brevo.com',
        apiKey: SAMPLE_BREVO_KEY,
        fromEmail: 'notifications@monienaija.ng',
        requestTimeoutMs: 5000,
      },
      async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          code: 'unauthorized',
          message: `Key ${SAMPLE_BREVO_KEY} is not authorized for Customer.One@Example.com`,
        }),
      }),
    ).send(emailRequest());

    expect(httpFail).toEqual({
      success: false,
      error: 'BREVO_HTTP_401:unauthorized',
    });
    expect(JSON.stringify(httpFail)).not.toContain(SAMPLE_BREVO_KEY);
    expect(JSON.stringify(httpFail)).not.toContain('Customer.One');

    const netFail = await new BrevoEmailProvider(
      {
        baseUrl: 'https://api.brevo.com',
        apiKey: SAMPLE_BREVO_KEY,
        fromEmail: 'notifications@monienaija.ng',
        requestTimeoutMs: 5000,
      },
      async () => {
        throw new TypeError(`TLS socket error with ${SAMPLE_BREVO_KEY}`);
      },
    ).send(emailRequest());

    expect(netFail).toEqual({
      success: false,
      error: 'BREVO_NETWORK:TypeError',
    });
    expect(JSON.stringify(netFail)).not.toContain(SAMPLE_BREVO_KEY);
  });

  it('4. verifyBrevoConnection checks GET /v3/account and GET /v3/senders for active verified sender', async () => {
    const okResult = await verifyBrevoConnection(
      {
        baseUrl: 'https://api.brevo.com',
        apiKey: SAMPLE_BREVO_KEY,
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija',
        requestTimeoutMs: 5000,
      },
      async (url) => {
        if (url.endsWith('/v3/account')) {
          return { ok: true, status: 200, json: async () => ({ email: 'owner@monienaija.ng' }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            senders: [
              { email: 'notifications@monienaija.ng', name: 'MonieNaija', active: true },
            ],
          }),
        };
      },
    );
    expect(okResult).toEqual({
      ok: true,
      accountReachable: true,
      senderVerified: true,
      errorCode: null,
    });

    const unverifiedSender = await verifyBrevoConnection(
      {
        baseUrl: 'https://api.brevo.com',
        apiKey: SAMPLE_BREVO_KEY,
        fromEmail: 'unverified@monienaija.ng',
        requestTimeoutMs: 5000,
      },
      async (url) => {
        if (url.endsWith('/v3/account')) {
          return { ok: true, status: 200, json: async () => ({ email: 'owner@monienaija.ng' }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            senders: [{ email: 'notifications@monienaija.ng', active: true }],
          }),
        };
      },
    );
    expect(unverifiedSender).toEqual({
      ok: false,
      accountReachable: true,
      senderVerified: false,
      errorCode: 'BREVO_SENDER_NOT_VERIFIED',
    });
  });

  it('5. parseSenderIdentity supports both bare email and RFC-5322 Display Name <email>', () => {
    expect(parseSenderIdentity('MonieNaija <Notifications@MonieNaija.ng>')).toEqual({
      email: 'notifications@monienaija.ng',
      name: 'MonieNaija',
    });
    expect(parseSenderIdentity('alerts@monienaija.ng', 'MonieNaija Ops')).toEqual({
      email: 'alerts@monienaija.ng',
      name: 'MonieNaija Ops',
    });
  });
});

describe('Environment validation for Brevo and Notification Secret Encryption', () => {
  const baseEnv: Record<string, unknown> = {
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_NAME: 'monienaija',
    DB_USER: 'postgres',
    DB_PASSWORD: 'postgres',
  };

  it('validates BREVO_API_KEY prefix (rejecting xsmtpsib-) and NOTIFICATION_EMAIL_FROM', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NOTIFICATION_EMAIL_PROVIDER: 'brevo',
      }),
    ).toThrow(/BREVO_API_KEY is required/);

    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NOTIFICATION_EMAIL_PROVIDER: 'brevo',
        BREVO_API_KEY: 'xsmtpsib-1234567890abcdef',
        NOTIFICATION_EMAIL_FROM: 'notifications@monienaija.ng',
      }),
    ).toThrow(/SMTP relay key/);

    const valid = validateEnvironment({
      ...baseEnv,
      NOTIFICATION_EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: SAMPLE_BREVO_KEY,
      NOTIFICATION_EMAIL_FROM: 'notifications@monienaija.ng',
      NOTIFICATION_PROVIDER_ENCRYPTION_KEY: KEY_V1,
    });
    expect(valid.NOTIFICATION_EMAIL_PROVIDER).toBe('brevo');
    expect(valid.BREVO_API_BASE_URL).toBe('https://api.brevo.com');
  });

  it('enforces 32-byte base64 key when NOTIFICATION_SMS_PROVIDER=managed or NOTIFICATION_EMAIL_PROVIDER=managed', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NOTIFICATION_SMS_PROVIDER: 'managed',
      }),
    ).toThrow(/NOTIFICATION_PROVIDER_ENCRYPTION_KEY/);

    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NOTIFICATION_PROVIDER_ENCRYPTION_KEY: 'too-short',
      }),
    ).toThrow(/32-byte key/);

    const validManaged = validateEnvironment({
      ...baseEnv,
      NOTIFICATION_SMS_PROVIDER: 'managed',
      NOTIFICATION_EMAIL_PROVIDER: 'managed',
      NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON: JSON.stringify({ v1: KEY_V1 }),
      NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
    });
    expect(validManaged.NOTIFICATION_SMS_PROVIDER).toBe('managed');
    expect(validManaged.NOTIFICATION_EMAIL_PROVIDER).toBe('managed');
  });
});

describe('Provider Configuration Security Hardening (redaction, safeTransaction, AuditService.list)', () => {
  it('redacts MNNPS1 encrypted envelopes, provider API key tokens, and encryptedApiKey fields', () => {
    const enc = new NotificationSecretEncryptionService(
      makeConfig({
        NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON: JSON.stringify({ v1: KEY_V1 }),
        NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
      }),
    );
    const { envelope } = enc.encrypt(SAMPLE_ROBASE_KEY, 'SMS');

    const scrubbedRecord = redactRecord({
      channel: 'SMS',
      encryptedApiKey: envelope,
      proposed_encrypted_api_key: envelope,
      apiKey: SAMPLE_BREVO_KEY,
    });
    expect(scrubbedRecord.encryptedApiKey).toBe('[REDACTED]');
    expect(scrubbedRecord.proposed_encrypted_api_key).toBe('[REDACTED]');
    expect(scrubbedRecord.apiKey).toBe('[REDACTED]');

    const scrubbedText = redactSensitiveText(
      `Query failed: row=(${envelope}) robase=${SAMPLE_ROBASE_KEY} brevo=${SAMPLE_BREVO_KEY} smtp=xsmtpsib-abcdef1234567890 resend=re_abcdef1234567890`,
    );
    expect(scrubbedText).not.toContain('MNNPS1:');
    expect(scrubbedText).not.toContain(SAMPLE_ROBASE_KEY);
    expect(scrubbedText).not.toContain(SAMPLE_BREVO_KEY);
    expect(scrubbedText).not.toContain('xsmtpsib-abcdef1234567890');
    expect(scrubbedText).not.toContain('re_abcdef1234567890');
  });

  it('prevents SQL driver errors, bound parameters, and MNNPS1 envelopes from leaking in exceptions or logs while cancelling orphan approvals', async () => {
    const enc = new NotificationSecretEncryptionService(
      makeConfig({
        NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON: JSON.stringify({ v1: KEY_V1 }),
        NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
      }),
    );

    const approvalId = randomUUID();
    let cancelCalled = false;
    const mockApprovals = {
      request: async () => ({
        approved: false,
        reason: 'REQUESTED',
        approval: { id: approvalId },
      }),
      cancel: async () => {
        cancelCalled = true;
        return { approved: false, reason: 'CANCELLED' };
      },
    } as unknown as PrivilegedActionApprovalService;

    const driverSentinelError = Object.assign(
      new Error(
        `Failing row contains (SMS, robase, MNNPS1:v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:SENTINEL_CIPHERTEXT_9911, PG_INTERNAL_DETAIL_8822)`,
      ),
      {
        code: '23514',
        detail: 'SENTINEL_DRIVER_DETAIL_7733',
        query: 'INSERT INTO notification_provider_config_proposals VALUES ($1)',
        parameters: [
          'MNNPS1:v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:SENTINEL_CIPHERTEXT_9911',
          SAMPLE_ROBASE_KEY,
        ],
      },
    );

    const mockDs = {
      isInitialized: true,
      query: async (sql: string) => {
        if (sql.includes('FROM notification_provider_configurations')) {
          return [];
        }
        throw driverSentinelError;
      },
      transaction: async () => {
        throw driverSentinelError;
      },
    } as unknown as DataSource;

    const svc = new NotificationProviderConfigService(
      makeConfig({
        NODE_ENV: 'test',
        NOTIFICATION_SMS_PROVIDER: 'managed',
        NOTIFICATION_EMAIL_PROVIDER: 'managed',
      }) as unknown as ConfigService<Environment, true>,
      enc,
      mockDs,
      mockApprovals,
    );

    const loggedPayloads: string[] = [];
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((...args: unknown[]) => {
        loggedPayloads.push(JSON.stringify(args));
      });
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        loggedPayloads.push(JSON.stringify(args));
      });

    const superAdmin: AuthorizationPrincipal = {
      type: 'PRIVILEGED',
      principalId: 'super-admin-unit-1',
      audience: 'workforce-admin',
      assuranceLevel: 'MFA',
      roles: ['SUPER_ADMIN'],
      scopes: ['notification.provider.view', 'notification.provider.configure'],
      customerAccess: 'ANY',
    };

    try {
      let caught: unknown;
      try {
        await svc.proposeChange(superAdmin, {
          channel: 'SMS',
          expectedVersion: 0,
          provider: 'robase',
          enabled: false,
          senderId: 'MonieNaija',
          credentialAction: 'SET_ENCRYPTED',
          apiKey: SAMPLE_ROBASE_KEY,
          reason: 'Unit test driver failure redaction check',
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(InternalServerErrorException);
      expect(cancelCalled).toBe(true);

      const serializedError = JSON.stringify({
        message: (caught as Error).message,
        response: (caught as InternalServerErrorException).getResponse(),
      });
      const combinedLogs = loggedPayloads.join('\n');

      for (const blob of [serializedError, combinedLogs]) {
        expect(blob).not.toContain('SENTINEL_CIPHERTEXT_9911');
        expect(blob).not.toContain('PG_INTERNAL_DETAIL_8822');
        expect(blob).not.toContain('SENTINEL_DRIVER_DETAIL_7733');
        expect(blob).not.toContain('MNNPS1:');
        expect(blob).not.toContain(SAMPLE_ROBASE_KEY);
        expect(blob).not.toContain('notification_provider_config_proposals');
      }
      expect(combinedLogs).toContain('"sqlState":"23514"');

      await expect(svc.listProposals()).rejects.toThrow(InternalServerErrorException);
      await expect(svc.getProposal(randomUUID())).rejects.toThrow(InternalServerErrorException);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('excludes NOTIFICATION_PROVIDER_CONFIG, NOTIFICATION_TEST_SEND, and NOTIFICATION_TEST_SEND_QUOTA from AuditService.list by default unless includeNotificationProviderRecords is true', async () => {
    const andWhereCalls: Array<{ clause: string; params?: Record<string, unknown> }> = [];
    const mockQb = {
      andWhere: (clause: string, params?: Record<string, unknown>) => {
        andWhereCalls.push({ clause, params });
        return mockQb;
      },
      orderBy: () => mockQb,
      take: () => mockQb,
      getMany: async () => [],
    };
    const mockRepo = {
      createQueryBuilder: () => mockQb,
    } as unknown as Repository<AuditEvent>;

    const auditService = new AuditService(mockRepo);

    await auditService.list({});
    expect(
      andWhereCalls.some(
        (c) =>
          c.clause.includes('providerAuditTypes') &&
          Array.isArray(c.params?.providerAuditTypes) &&
          (c.params?.providerAuditTypes as string[]).includes('NOTIFICATION_PROVIDER_CONFIG') &&
          (c.params?.providerAuditTypes as string[]).includes('NOTIFICATION_TEST_SEND_QUOTA'),
      ),
    ).toBe(true);

    andWhereCalls.length = 0;
    await auditService.listWithNotificationProviderOversight({});
    expect(andWhereCalls.some((c) => c.clause.includes('providerAuditTypes'))).toBe(false);
  });
});

describe('Sprint 1 Remediation F-01 & F-02 — Closed error-code allowlist & pinned vendor egress guards', () => {
  const SAMPLE_BREVO_KEY = 'xkeysib-' + 'b'.repeat(48);

  it('F-01: Brevo adapter and verifyBrevoConnection discard credential/financial sentinels in upstream error codes and logs', async () => {
    const logged: string[] = [];
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((...args: unknown[]) => {
        logged.push(JSON.stringify(args));
      });

    try {
      const sentinelCode = 'xkeysib-SENTINEL_CREDENTIAL_998877.TX_NGN_950000_ACCT_0123456789';
      const customErr = new Error('Socket error');
      customErr.name = sentinelCode;

      const sendRejected = await new BrevoEmailProvider(
        {
          baseUrl: 'https://api.brevo.com',
          apiKey: SAMPLE_BREVO_KEY,
          fromEmail: 'notifications@monienaija.ng',
          requestTimeoutMs: 5000,
        },
        async () => ({
          ok: false,
          status: 401,
          json: async () => ({
            code: sentinelCode,
            message: `Rejected key ${SAMPLE_BREVO_KEY} for TX_NGN_950000`,
          }),
        }),
      ).send({
        channel: 'EMAIL',
        destination: 'ops@monienaija.ng',
        subject: 'Alert',
        message: 'Body',
        payload: {},
        correlationId: 'corr-f01',
        eventType: 'notification.test_send',
        eventKey: 'evt-f01',
        recipientType: 'CUSTOMER',
        recipientId: 'cust-1',
      });

      expect(sendRejected).toEqual({
        success: false,
        error: 'BREVO_HTTP_401',
      });

      const sendThrown = await new BrevoEmailProvider(
        {
          baseUrl: 'https://api.brevo.com',
          apiKey: SAMPLE_BREVO_KEY,
          fromEmail: 'notifications@monienaija.ng',
          requestTimeoutMs: 5000,
        },
        async () => {
          throw customErr;
        },
      ).send({
        channel: 'EMAIL',
        destination: 'ops@monienaija.ng',
        subject: 'Alert',
        message: 'Body',
        payload: {},
        correlationId: 'corr-f01-net',
        eventType: 'notification.test_send',
        eventKey: 'evt-f01-net',
        recipientType: 'CUSTOMER',
        recipientId: 'cust-1',
      });

      expect(sendThrown).toEqual({
        success: false,
        error: 'BREVO_NETWORK:Error',
      });

      const verifyRejected = await verifyBrevoConnection(
        {
          baseUrl: 'https://api.brevo.com',
          apiKey: SAMPLE_BREVO_KEY,
          fromEmail: 'notifications@monienaija.ng',
          requestTimeoutMs: 5000,
        },
        async () => ({
          ok: false,
          status: 401,
          json: async () => ({ code: sentinelCode }),
        }),
      );
      expect(verifyRejected.errorCode).toBe('BREVO_VERIFY_HTTP_401');

      const combinedLogs = logged.join('\n');
      for (const blob of [
        JSON.stringify(sendRejected),
        JSON.stringify(sendThrown),
        JSON.stringify(verifyRejected),
        combinedLogs,
      ]) {
        expect(blob).not.toContain('SENTINEL_CREDENTIAL_998877');
        expect(blob).not.toContain('TX_NGN_950000');
        expect(blob).not.toContain('ACCT_0123456789');
        expect(blob).not.toContain('xkeysib-');
      }
      expect(combinedLogs).toContain('"errorCode":"unclassified"');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('F-02: pinned origin validation, redirect blocking, private/metadata IP denylist, and DNS-rebinding protection block credential exfiltration', async () => {
    const {
      validatePinnedProviderBaseUrl,
      isForbiddenOutboundIp,
      createPinnedProviderHttpFetch,
      normalizeProviderErrorCode,
    } = await import('../src/notification/provider-security');

    expect(validatePinnedProviderBaseUrl('robase', 'https://api.robase.dev/')).toBe(
      'https://api.robase.dev',
    );
    expect(validatePinnedProviderBaseUrl('brevo', 'https://api.brevo.com')).toBe(
      'https://api.brevo.com',
    );

    const rejectedBaseUrls = [
      'https://attacker-controlled.example.test',
      'https://api.robase.dev.attacker.test',
      'https://evil-robase.dev',
      'https://api.robase.dev:8443',
      'https://api.robase.dev:443',
      'https://api.robase.dev/v1',
      'https://user:pass@api.robase.dev',
      'https://api.robase.dev?leak=1',
      'https://api.robase.dev#frag',
      'http://api.robase.dev',
      'https://127.0.0.1',
      'https://10.0.0.1',
      'https://169.254.169.254',
      'https://[::1]',
      'https://[fe80::1]',
      'https://api.brevo.com', // wrong vendor for robase
    ];
    for (const badUrl of rejectedBaseUrls) {
      expect(() => validatePinnedProviderBaseUrl('robase', badUrl)).toThrow();
    }

    // Exhaustive IPv4/IPv6 private, loopback, link-local, metadata, NAT64, 6to4 checks
    for (const forbiddenIp of [
      '127.0.0.1',
      '10.24.0.5',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456:789a::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '64:ff9b::10.0.0.1',
      '2002:7f00:0001::1',
    ]) {
      expect(isForbiddenOutboundIp(forbiddenIp)).toBe(true);
    }
    expect(isForbiddenOutboundIp('93.184.216.34')).toBe(false);
    expect(isForbiddenOutboundIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);

    // Adapter blocks unpinned baseUrl and 3xx redirects without forwarding credentials
    let fetchInvocations = 0;
    const unpinnedAdapter = new BrevoEmailProvider(
      {
        baseUrl: 'https://attacker-controlled.example.test',
        apiKey: SAMPLE_BREVO_KEY,
        fromEmail: 'notifications@monienaija.ng',
        requestTimeoutMs: 5000,
      },
      async () => {
        fetchInvocations += 1;
        return { ok: true, status: 200, json: async () => ({ messageId: 'leak' }) };
      },
    );
    const blockedRes = await unpinnedAdapter.send({
      channel: 'EMAIL',
      destination: 'ops@monienaija.ng',
      subject: 'Subj',
      message: 'Body',
      payload: {},
      correlationId: 'corr-egress',
      eventType: 'notification.test_send',
      eventKey: 'evt-egress',
      recipientType: 'CUSTOMER',
      recipientId: 'cust-1',
    });
    expect(blockedRes).toEqual({ success: false, error: 'BREVO_EGRESS_BLOCKED' });
    expect(fetchInvocations).toBe(0);

    const redirectAdapter = new BrevoEmailProvider(
      {
        baseUrl: 'https://api.brevo.com',
        apiKey: SAMPLE_BREVO_KEY,
        fromEmail: 'notifications@monienaija.ng',
        requestTimeoutMs: 5000,
      },
      async (_url, init) => {
        expect(init.redirect).toBe('error');
        return { ok: false, status: 302, json: async () => null };
      },
    );
    const redirectRes = await redirectAdapter.send({
      channel: 'EMAIL',
      destination: 'ops@monienaija.ng',
      subject: 'Subj',
      message: 'Body',
      payload: {},
      correlationId: 'corr-redir',
      eventType: 'notification.test_send',
      eventKey: 'evt-redir',
      recipientType: 'CUSTOMER',
      recipientId: 'cust-1',
    });
    expect(redirectRes).toEqual({ success: false, error: 'BREVO_EGRESS_BLOCKED' });

    // DNS-rebinding guard blocks resolution of api.brevo.com -> 169.254.169.254 BEFORE socket open
    let socketOpened = false;
    const rebindingFetch = createPinnedProviderHttpFetch({
      lookupImpl: async () => [{ address: '169.254.169.254', family: 4 }],
      requestImpl: (() => {
        socketOpened = true;
        throw new Error('Socket must never open');
      }) as never,
    });
    const rebindingAdapter = new BrevoEmailProvider(
      {
        baseUrl: 'https://api.brevo.com',
        apiKey: SAMPLE_BREVO_KEY,
        fromEmail: 'notifications@monienaija.ng',
        requestTimeoutMs: 5000,
      },
      rebindingFetch,
    );
    const rebindingRes = await rebindingAdapter.send({
      channel: 'EMAIL',
      destination: 'ops@monienaija.ng',
      subject: 'Subj',
      message: 'Body',
      payload: {},
      correlationId: 'corr-rebind',
      eventType: 'notification.test_send',
      eventKey: 'evt-rebind',
      recipientType: 'CUSTOMER',
      recipientId: 'cust-1',
    });
    expect(rebindingRes).toEqual({ success: false, error: 'BREVO_EGRESS_BLOCKED' });
    expect(socketOpened).toBe(false);

    // Boundary normalizer collapses unrecognized suffixes and arbitrary strings
    expect(normalizeProviderErrorCode('BREVO_HTTP_401:xkeysib-leak')).toBe('BREVO_HTTP_401');
    expect(normalizeProviderErrorCode('ROBASE_HTTP_401:robe_secret')).toBe(
      'ROBASE_HTTP_401:unknown',
    );
    expect(normalizeProviderErrorCode('TX_NGN_950000_RAW_LEAK')).toBe('PROVIDER_FAILURE');
  });
});
