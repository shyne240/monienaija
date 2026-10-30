import type { DataSource, EntityManager, Repository } from 'typeorm';

import { REDACTED_VALUE, redactSensitiveText } from '../src/common/sensitive-data-redaction';
import type { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { NotificationTemplateService } from '../src/notification/notification-template.service';
import {
  SAFE_PROVIDER_REF_PATTERN,
  deriveSafeVendorProviderRef,
  sanitizeProviderRefForBoundary,
} from '../src/notification/provider-security';
import type { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';

describe('Sprint 1 F-01 — Historical & Cross-Boundary Provider Reference Sanitization (unit)', () => {
  const ENV_KEYS = [
    'NODE_ENV',
    'NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON',
    'NOTIFICATION_PROVIDER_ENCRYPTION_KEY',
    'ROBASE_API_KEY',
    'BREVO_API_KEY',
    'RESEND_API_KEY',
  ] as const;

  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  });

  it('preserves already-safe pvr1 references across all scopes while sanitizing legacy and unknown-provider sentinels', () => {
    const key = Buffer.alloc(32, 0x41).toString('base64');
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEY'] = key;

    const safeRefs = [
      'pvr1:robase:0123456789abcdef0123456789abcdef',
      'pvr1:brevo:fedcba9876543210fedcba9876543210',
      'pvr1:resend:abcdef0123456789abcdef0123456789',
      'pvr1:external:11223344556677889900aabbccddeeff',
    ];
    for (const ref of safeRefs) {
      expect(sanitizeProviderRefForBoundary(ref)).toBe(ref);
      expect(sanitizeProviderRefForBoundary(ref, 'robase')).toBe(ref);
      expect(sanitizeProviderRefForBoundary(ref, 'unknown_gateway')).toBe(ref);
    }

    const sentinel = 'xkeysib-HISTORICAL_SENTINEL_TX_NGN_750000_ACCT_1234567890';
    const dRobase = sanitizeProviderRefForBoundary(sentinel, 'robase');
    const dBrevo = sanitizeProviderRefForBoundary(sentinel, 'brevo');
    const dResend = sanitizeProviderRefForBoundary(sentinel, 'resend');
    const dUnknownA = sanitizeProviderRefForBoundary(sentinel, 'twilio_legacy');
    const dUnknownB = sanitizeProviderRefForBoundary(sentinel, 'termii_legacy');
    const dUnscoped = sanitizeProviderRefForBoundary(sentinel);

    expect(dRobase).toMatch(/^pvr1:robase:[0-9a-f]{32}$/);
    expect(dBrevo).toMatch(/^pvr1:brevo:[0-9a-f]{32}$/);
    expect(dResend).toMatch(/^pvr1:resend:[0-9a-f]{32}$/);
    expect(dUnknownA).toMatch(/^pvr1:external:[0-9a-f]{32}$/);
    expect(dUnknownB).toMatch(/^pvr1:external:[0-9a-f]{32}$/);
    expect(dUnscoped).toMatch(/^pvr1:external:[0-9a-f]{32}$/);

    // Domain separation across known vendors, distinct unknown providers, and unscoped rows
    const unique = new Set([dRobase, dBrevo, dResend, dUnknownA, dUnknownB, dUnscoped]);
    expect(unique.size).toBe(6);

    // Determinism for fixed key + provider scope
    expect(sanitizeProviderRefForBoundary(sentinel, 'twilio_legacy')).toBe(dUnknownA);
    expect(sanitizeProviderRefForBoundary(sentinel)).toBe(dUnscoped);

    const joined = [dRobase, dBrevo, dResend, dUnknownA, dUnknownB, dUnscoped].join('|');
    expect(joined).not.toContain('HISTORICAL_SENTINEL');
    expect(joined).not.toContain('750000');
    expect(joined).not.toContain('1234567890');
    expect(joined).not.toContain('twilio_legacy');
    expect(joined).not.toContain('termii_legacy');
  });

  it('never passes local harness-like patterns through for unknown providers or in NODE_ENV=production', () => {
    const harnessLike = 'test-1793267152798-abc123';
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEY'] = Buffer.alloc(32, 0x52).toString('base64');

    // Non-production + genuine local harness passes through
    expect(sanitizeProviderRefForBoundary(harnessLike, 'test')).toBe(harnessLike);
    expect(sanitizeProviderRefForBoundary(harnessLike)).toBe(harnessLike);

    // Unknown provider name NEVER passes through raw even in test mode
    const unknownSanitized = sanitizeProviderRefForBoundary(harnessLike, 'unknown_sms_vendor');
    expect(unknownSanitized).toMatch(/^pvr1:external:[0-9a-f]{32}$/);
    expect(unknownSanitized).not.toContain('test-');

    // NODE_ENV=production NEVER passes local harness patterns through raw
    process.env['NODE_ENV'] = 'production';
    const prodSanitized = sanitizeProviderRefForBoundary(harnessLike);
    expect(prodSanitized).toMatch(/^pvr1:external:[0-9a-f]{32}$/);
    expect(prodSanitized).not.toContain('test-');
  });

  it('fails closed in NODE_ENV=production when no durable secret material is configured (no silent ephemeral fallback)', () => {
    process.env['NODE_ENV'] = 'production';

    expect(() =>
      sanitizeProviderRefForBoundary('xkeysib-HISTORICAL_SENTINEL_TX_NGN_750000_ACCT_1234567890'),
    ).toThrow(/Durable notification secret material is required in production/);

    expect(() =>
      deriveSafeVendorProviderRef('robase', 'msg_12345'),
    ).toThrow(/Durable notification secret material is required in production/);

    // Already-safe opaque tokens still pass through without error
    const alreadySafe = 'pvr1:robase:0123456789abcdef0123456789abcdef';
    expect(sanitizeProviderRefForBoundary(alreadySafe)).toBe(alreadySafe);

    // Configuring durable env provider secret (e.g. ROBASE_API_KEY in env-mode production) succeeds deterministically
    process.env['ROBASE_API_KEY'] = `robe_${'k'.repeat(48)}`;
    const prodFromRobase = sanitizeProviderRefForBoundary(
      'xkeysib-HISTORICAL_SENTINEL_TX_NGN_750000_ACCT_1234567890',
    );
    expect(prodFromRobase).toMatch(SAFE_PROVIDER_REF_PATTERN);
    expect(
      sanitizeProviderRefForBoundary(
        'xkeysib-HISTORICAL_SENTINEL_TX_NGN_750000_ACCT_1234567890',
      ),
    ).toBe(prodFromRobase);
    expect(deriveSafeVendorProviderRef('robase', 'msg_12345')).toBe(
      deriveSafeVendorProviderRef('robase', 'msg_12345', process.env['ROBASE_API_KEY']),
    );
  });

  it('sanitizes NotificationDispatcherService duplicate conflict results and listDeliveriesForEventKey()', async () => {
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEY'] = Buffer.alloc(32, 0x33).toString('base64');
    const rawHistorical = 'robe_HISTORICAL_DUPLICATE_SENTINEL_TX_NGN_640000_ACCT_1111222233';
    const customerId = '11111111-1111-4111-8111-111111111111';

    const txQuery = jest
      .fn()
      // INSERT ... ON CONFLICT DO NOTHING -> conflict (empty result)
      .mockResolvedValueOnce([])
      // SELECT id, status, provider_ref, destination FROM notification_deliveries ...
      .mockResolvedValueOnce([
        {
          id: '22222222-2222-4222-8222-222222222222',
          status: 'SENT',
          provider_ref: rawHistorical,
          destination: '+2348012345678',
        },
      ]);
    const txManager = { query: txQuery } as unknown as EntityManager;

    const dsQuery = jest.fn().mockResolvedValueOnce([
      {
        id: '22222222-2222-4222-8222-222222222222',
        event_key: 'customer.funding.approved:dup-1',
        status: 'SENT',
        provider_ref: rawHistorical,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        event_key: 'customer.funding.approved:dup-1',
        status: 'SENT',
        provider_ref: 'pvr1:robase:0123456789abcdef0123456789abcdef',
      },
    ]);
    const dataSource = {
      query: dsQuery,
      transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) => cb(txManager)),
    } as unknown as DataSource;

    const resolver = {
      resolve: jest.fn().mockResolvedValue({ destination: '+2348012345678', reason: null }),
    } as unknown as NotificationChannelResolverService;
    const templates = new NotificationTemplateService();
    jest.spyOn(templates, 'isEventEnabled').mockResolvedValue(true);
    jest.spyOn(templates, 'renderActive').mockResolvedValue({
      subject: null,
      body: 'Funding approved.',
      variablesUsed: [],
    });

    const dispatcher = new NotificationDispatcherService(
      dataSource,
      resolver,
      templates,
      null,
      null,
      null,
    );

    const dupResult = await dispatcher.dispatch({
      eventType: 'customer.funding.approved',
      eventKey: 'customer.funding.approved:dup-1',
      payload: { customerId, reference: 'REF-1', amountMinor: '1000' },
    });

    expect(dupResult.deliveries).toHaveLength(1);
    expect(dupResult.deliveries[0]?.providerRef).toMatch(SAFE_PROVIDER_REF_PATTERN);
    expect(JSON.stringify(dupResult)).not.toContain('HISTORICAL_DUPLICATE_SENTINEL');
    expect(JSON.stringify(dupResult)).not.toContain('640000');

    const byKey = await dispatcher.listDeliveriesForEventKey('customer.funding.approved:dup-1');
    expect(byKey).toHaveLength(2);
    expect(byKey[0]?.['provider_ref']).toBe(dupResult.deliveries[0]?.providerRef);
    expect(byKey[1]?.['provider_ref']).toBe('pvr1:robase:0123456789abcdef0123456789abcdef');
    expect(JSON.stringify(byKey)).not.toContain('HISTORICAL_DUPLICATE_SENTINEL');
  });

  it('recursively sanitizes stored provider references across all AuditService entity types and redactSensitiveText', async () => {
    process.env['NOTIFICATION_PROVIDER_ENCRYPTION_KEY'] = Buffer.alloc(32, 0x77).toString('base64');

    const savedEvents: AuditEvent[] = [];
    const qb = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => Promise.resolve(savedEvents)),
    };
    const repo = {
      create: jest.fn((input: Partial<AuditEvent>) => input as AuditEvent),
      save: jest.fn((event: AuditEvent) => {
        savedEvents.push(event);
        return Promise.resolve(event);
      }),
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<AuditEvent>;
    const manager = {
      getRepository: jest.fn(() => repo),
    } as unknown as EntityManager;

    const auditService = new AuditService(repo);

    // 1. Write-time sanitization on non-provider entityType with nested provider_ref & unknown provider
    await auditService.record(manager, {
      entityType: 'NOTIFICATION_DELIVERY',
      entityId: '44444444-4444-4444-8444-444444444444',
      action: 'DELIVERY_RECONCILED',
      actor: 'ops-1',
      newValues: {
        provider: 'unknown_vendor_x',
        provider_ref: 'unknown_vendor_x:SECRET_SENTINEL_TX_NGN_510000',
        nested: {
          providerRef: 're_NESTED_SENTINEL_ACCT_9988776655',
        },
      },
    });
    expect(JSON.stringify(savedEvents[0])).not.toContain('SECRET_SENTINEL');
    expect(JSON.stringify(savedEvents[0])).not.toContain('NESTED_SENTINEL');

    // 2. Simulate historical pre-remediation row already stored raw in audit_events
    savedEvents.push({
      id: '55555555-5555-4555-8555-555555555555',
      entityType: 'CUSTOM_LEGACY_DELIVERY_AUDIT',
      entityId: '66666666-6666-4666-8666-666666666666',
      action: 'LEGACY_SENT',
      actor: 'legacy-worker',
      correlationId: null,
      requestId: null,
      previousValues: {
        last_tested_provider_ref: 'xkeysib-LEGACY_AUDIT_SENTINEL_TX_NGN_333000',
      },
      newValues: {
        deliveries: [
          {
            provider: 'brevo',
            provider_ref: 'xkeysib-LEGACY_AUDIT_SENTINEL_TX_NGN_333000',
          },
        ],
      },
      occurredAt: new Date('2026-10-20T00:00:00.000Z'),
      createdAt: new Date('2026-10-20T00:00:00.000Z'),
    });

    const listed = await auditService.list();
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain('LEGACY_AUDIT_SENTINEL');
    expect(serialized).not.toContain('333000');
    const legacyView = listed.find((e) => e.id === '55555555-5555-4555-8555-555555555555');
    expect(legacyView?.previousValues?.['last_tested_provider_ref']).toMatch(
      /^pvr1:external:[0-9a-f]{32}$/,
    );
    const nestedDeliveries = legacyView?.newValues?.['deliveries'] as Array<Record<string, unknown>>;
    expect(nestedDeliveries[0]?.['provider_ref']).toMatch(/^pvr1:brevo:[0-9a-f]{32}$/);

    // 3. Exception/log text redaction preserves pvr1:* while redacting raw providerRef=...
    const redactedRaw = redactSensitiveText(
      'Delivery failed with providerRef=legacy-raw-token-9999 and provider_ref=unknown:secret123',
    );
    expect(redactedRaw).toContain(`providerRef=${REDACTED_VALUE}`);
    expect(redactedRaw).toContain(`provider_ref=${REDACTED_VALUE}`);
    expect(redactedRaw).not.toContain('legacy-raw-token-9999');
    expect(redactedRaw).not.toContain('secret123');

    const safeToken = 'pvr1:robase:0123456789abcdef0123456789abcdef';
    expect(redactSensitiveText(`Delivery recorded providerRef=${safeToken}`)).toBe(
      `Delivery recorded providerRef=${safeToken}`,
    );
  });

  /**
   * R-03 (Arena 4 report 13, final F-01 acceptance of 30c3445): the text-redactor exemption
   * previously accepted any value STARTING with a canonical `pvr1:<scope>:<32 hex>` prefix
   * (`\b` word boundary after the digest), so a malformed value such as
   * `pvr1:brevo:<32hex>:F01_SUFFIX_SENTINEL_TX_NGN_999000` bypassed redaction IN FULL.
   * The exemption now requires the ENTIRE captured value to be a canonical token: it must be
   * followed by a value terminator (comma, closing brace, whitespace, quote) or end of string.
   */
  it('R-03: redacts malformed pvr1-prefixed values in full — colon suffixes, appended credentials and financial sentinels', () => {
    const digest = '0123456789abcdef0123456789abcdef';
    const cases: Array<[string, string]> = [
      // The exact audit finding: valid token + colon suffix carrying a financial sentinel.
      [`providerRef=pvr1:brevo:${digest}:F01_SUFFIX_SENTINEL_TX_NGN_999000`, 'F01_SUFFIX_SENTINEL_TX_NGN_999000'],
      // Appended credential material directly after the digest (no separator).
      [`provider_ref=pvr1:robase:${digest}xkeysib-APPENDED_CREDENTIAL_123456`, 'APPENDED_CREDENTIAL_123456'],
      // Appended financial prose/sentinel after a non-canonical separator.
      [`lastTestProviderRef=pvr1:external:${digest}-NGN_999000_JOURNAL_LEAK`, 'NGN_999000_JOURNAL_LEAK'],
      [`last_test_provider_ref=pvr1:resend:${digest}:SUFFIX`, 'SUFFIX'],
      [`last_tested_provider_ref=pvr1:brevo:${digest};TRAILING_SECRET_777`, 'TRAILING_SECRET_777'],
    ];
    for (const [input, forbidden] of cases) {
      const redacted = redactSensitiveText(input);
      expect(redacted).not.toContain(forbidden);
      expect(redacted).not.toContain(digest);
      expect(redacted).toContain(REDACTED_VALUE);
    }
  });

  it('R-03: redacts JSON-quoted malformed provider references while keeping output JSON-parseable', () => {
    const digest = 'fedcba9876543210fedcba9876543210';
    const malicious = `{"status":"SENT","providerRef":"pvr1:brevo:${digest}:F01_JSON_SUFFIX_TX_NGN_999000"}`;
    const redacted = redactSensitiveText(malicious);
    expect(redacted).not.toContain('F01_JSON_SUFFIX_TX_NGN_999000');
    expect(redacted).not.toContain(digest);
    // Separator (including the JSON quotes/colon) is preserved, so structure stays parseable.
    const parsed = JSON.parse(redacted) as Record<string, unknown>;
    expect(parsed.status).toBe('SENT');
    expect(parsed.providerRef).toBe(REDACTED_VALUE);

    // A legitimate JSON-quoted canonical token is preserved verbatim and stays parseable.
    const legitimate = `{"status":"SENT","providerRef":"pvr1:brevo:${digest}"}`;
    expect(redactSensitiveText(legitimate)).toBe(legitimate);
  });

  it('R-03: whitespace and delimiter boundaries — exempt canonical tokens end at the value boundary only', () => {
    const digest = 'abcdef0123456789abcdef0123456789';
    const token = `pvr1:resend:${digest}`;
    // R-03 (Arena 4 report 14): an UNQUOTED canonical token followed by whitespace is ambiguous
    // (a malformed reference with a whitespace suffix cannot be ruled out), so the whole region
    // through the next hard delimiter fails safe and is redacted — the old expectation that
    // `token and more text` stays unchanged was the exact gap report 14 rejected. Hard
    // boundaries (comma/brace/quote/end-of-string) remain unambiguous and are preserved.
    expect(redactSensitiveText(`providerRef = ${token} and more text`)).toBe(`providerRef = ${REDACTED_VALUE}`);
    expect(redactSensitiveText(`providerRef=${token}, status=SENT`)).toBe(`providerRef=${token}, status=SENT`);
    expect(redactSensitiveText(`{"providerRef":"${token}"}`)).toBe(`{"providerRef":"${token}"}`);
    expect(redactSensitiveText(`providerRef=${token}`)).toBe(`providerRef=${token}`);
    // A malicious value whose suffix contains whitespace still loses everything up to the boundary.
    const spaced = redactSensitiveText(`providerRef=${token}:SECRET suffix after space`);
    expect(spaced).not.toContain('SECRET');
    expect(spaced).toContain(`providerRef=${REDACTED_VALUE}`);
  });

  it('R-03: malformed scopes and digests are never exempt', () => {
    const digest = '11223344556677889900aabbccddeeff';
    const malformed: string[] = [
      `providerRef=pvr1:mailgun:${digest}`, // non-canonical scope
      `providerRef=pvr1:brevo:${digest.slice(0, 31)}`, // 31-hex digest
      `providerRef=pvr1:brevo:${digest}0`, // 33-hex digest
      `providerRef=pvr1:brevo:${digest.replace('f', 'z')}`, // non-hex character in digest
      `providerRef=pvr2:brevo:${digest}`, // wrong token version
      `providerRef=PVR1:brevo:${digest}:SUFFIX_SENTINEL_999`, // suffix still redacts despite casing
    ];
    for (const input of malformed) {
      const redacted = redactSensitiveText(input);
      expect(redacted).toContain(`providerRef=${REDACTED_VALUE}`);
      expect(redacted).not.toContain('SUFFIX_SENTINEL_999');
      expect(redacted).not.toMatch(/pvr\d:brevo:[0-9a-f]{8}/i);
    }
  });

  it('R-03: preserves legitimate exact canonical tokens for every scope in both separator forms', () => {
    const tokens = [
      'pvr1:robase:0123456789abcdef0123456789abcdef',
      'pvr1:brevo:fedcba9876543210fedcba9876543210',
      'pvr1:resend:abcdef0123456789abcdef0123456789',
      'pvr1:external:11223344556677889900aabbccddeeff',
    ];
    for (const token of tokens) {
      expect(redactSensitiveText(`providerRef=${token}`)).toBe(`providerRef=${token}`);
      expect(redactSensitiveText(`provider_ref: ${token}`)).toBe(`provider_ref: ${token}`);
      expect(redactSensitiveText(`delivered providerRef=${token}, attempts=1`)).toBe(
        `delivered providerRef=${token}, attempts=1`,
      );
    }
  });
});
