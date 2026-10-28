/* eslint-disable @typescript-eslint/require-await */
import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';

import { validateEnvironment } from '../src/config/environment';
import {
  BrevoEmailProvider,
  type BrevoFetchFn,
  parseSenderIdentity,
  verifyBrevoConnection,
} from '../src/notification/brevo-email-provider';
import {
  computeKeyFingerprint,
  NotificationSecretEncryptionError,
  NotificationSecretEncryptionService,
} from '../src/notification/notification-secret-encryption.service';
import type { NotificationSendRequest } from '../src/notification/notification.types';

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
