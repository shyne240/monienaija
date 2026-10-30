import { randomUUID } from 'node:crypto';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { EntityManager, Repository } from 'typeorm';

import { CashInDto } from '../src/agent/dto/cash-in.dto';
import {
  sanitizeDiagnosticIdentifier,
  stripDiagnosticUrlQueries,
} from '../src/common/sensitive-data-redaction';
import { mapEventToIntents } from '../src/notification/notification-event-map';
import { AuditService } from '../src/operations/audit.service';
import { OutboxService } from '../src/operations/outbox.service';
import type { AuditEvent } from '../src/operations/audit-event.entity';
import type { OutboxEvent } from '../src/operations/outbox-event.entity';

/**
 * Arena 4 report 26 — N-02, permanent reproductions: caller-supplied business
 * `correlationId` values (request bodies → DTOs → services → audit/outbox/notification
 * persistence) bypass the request-context choke point. `createRequestContext()` /
 * `safeIdentifier()` never see them. The audit's synthetic DTO probe showed
 * `CashInDto` accepting `Bearer abcdefgh` unchanged with zero validation errors, and a
 * synthetic event-map probe showed the value propagating into notification intents
 * unchanged; static tracing established audit/outbox/delivery persistence.
 *
 * Policy (report 26 mission): a consistent, bounded sanitization at the shared
 * persistence choke points and service ingestion points — deterministic, so legitimate
 * identifiers are preserved byte-for-byte and equality/idempotency semantics for
 * legitimate callers are unchanged. DTO contracts are NOT changed (values are still
 * accepted; they are sanitized before execution, persistence, echo and downstream
 * mapping). All credentials are synthetic.
 */

const CREDENTIAL_ID = 'Bearer abcdefgh'; // synthetic canonical credential-shaped id
const LOWER_CREDENTIAL_ID = 'bearer abc'; // synthetic short/lowercase variant
const LEGITIMATE_ID = 'corr-biz-r26-42';

function fakeManagerWithCapture<T>(): { manager: EntityManager; captured: T[] } {
  const captured: T[] = [];
  const repository = {
    create: (value: T) => value,
    save: (value: T) => {
      captured.push(value);
      return Promise.resolve(value);
    },
  };
  const manager = {
    getRepository: () => repository,
  } as unknown as EntityManager;
  return { manager, captured };
}

describe('report 26 N-02 — audit persistence choke point sanitizes caller correlation ids', () => {
  it('exact audit reproduction shape: a credential-shaped correlationId is sanitized before the audit entity is written', async () => {
    const { manager, captured } = fakeManagerWithCapture<AuditEvent>();
    const auditService = new AuditService({} as unknown as Repository<AuditEvent>);
    await auditService.record(manager, {
      entityType: 'AGENT_CASH_IN',
      entityId: randomUUID(),
      action: 'CASH_IN_COMPLETED',
      actor: randomUUID(),
      correlationId: CREDENTIAL_ID,
      newValues: { amountMinor: '100' },
    });
    expect(captured[0]?.correlationId).not.toContain('abcdefgh');
    expect(captured[0]?.correlationId).toBe('[REDACTED]');
  });

  it('the short/lowercase credential variant is sanitized too', async () => {
    const { manager, captured } = fakeManagerWithCapture<AuditEvent>();
    const auditService = new AuditService({} as unknown as Repository<AuditEvent>);
    await auditService.record(manager, {
      entityType: 'AGENT_CASH_IN',
      entityId: randomUUID(),
      action: 'CASH_IN_COMPLETED',
      actor: randomUUID(),
      correlationId: LOWER_CREDENTIAL_ID,
    });
    expect(captured[0]?.correlationId).toBe('[REDACTED]');
  });

  it('legitimate business correlation ids are preserved byte-for-byte', async () => {
    const { manager, captured } = fakeManagerWithCapture<AuditEvent>();
    const auditService = new AuditService({} as unknown as Repository<AuditEvent>);
    await auditService.record(manager, {
      entityType: 'AGENT_CASH_IN',
      entityId: randomUUID(),
      action: 'CASH_IN_COMPLETED',
      actor: randomUUID(),
      correlationId: LEGITIMATE_ID,
    });
    expect(captured[0]?.correlationId).toBe(LEGITIMATE_ID);
  });
});

describe('report 26 N-02 — outbox persistence choke point sanitizes caller correlation ids', () => {
  it('a credential-shaped correlationId is sanitized before the outbox event is written', async () => {
    const { manager, captured } = fakeManagerWithCapture<OutboxEvent>();
    const outboxService = new OutboxService({} as unknown as Repository<OutboxEvent>);
    await outboxService.enqueue(manager, {
      eventType: 'cash_to_cash.created',
      aggregateType: 'CASH_TO_CASH',
      aggregateId: randomUUID(),
      payload: { amountMinor: '100' },
      correlationId: CREDENTIAL_ID,
    });
    expect(captured[0]?.correlationId).not.toContain('abcdefgh');
    expect(captured[0]?.correlationId).toBe('[REDACTED]');
  });

  it('legitimate business correlation ids are preserved byte-for-byte', async () => {
    const { manager, captured } = fakeManagerWithCapture<OutboxEvent>();
    const outboxService = new OutboxService({} as unknown as Repository<OutboxEvent>);
    await outboxService.enqueue(manager, {
      eventType: 'cash_to_cash.created',
      aggregateType: 'CASH_TO_CASH',
      aggregateId: randomUUID(),
      payload: {},
      correlationId: LEGITIMATE_ID,
    });
    expect(captured[0]?.correlationId).toBe(LEGITIMATE_ID);
  });
});

describe('report 26 N-02 — notification intent mapping sanitizes persisted-event correlation ids', () => {
  it('exact audit reproduction: the event map propagates a credential-shaped id unchanged today and must sanitize it', () => {
    const intents = mapEventToIntents(
      'customer.funding.approved',
      { customerId: randomUUID() },
      { correlationId: CREDENTIAL_ID, causationId: null },
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]?.correlationId).not.toContain('abcdefgh');
    expect(intents[0]?.correlationId).toBe('[REDACTED]');
  });

  it('legitimate ids flow through the intent map unchanged', () => {
    const intents = mapEventToIntents(
      'customer.funding.approved',
      { customerId: randomUUID() },
      { correlationId: LEGITIMATE_ID, causationId: null },
    );
    expect(intents[0]?.correlationId).toBe(LEGITIMATE_ID);
  });
});

describe('report 26 N-02 — DTO contract is unchanged (sanitization lives at service/persistence boundaries)', () => {
  it('CashInDto still validates a credential-shaped correlationId with zero errors (documented policy)', () => {
    // The mission forbids breaking legitimate business semantics: the DTO keeps
    // accepting any <=255-char string; sanitization is enforced downstream at the
    // service ingestion points and the shared persistence choke points, so the
    // credential never reaches execution, persistence, responses or providers.
    const dto = plainToInstance(CashInDto, {
      recipientIdentifier: '08012345678',
      amountMinor: '100',
      currency: 'NGN',
      idempotencyKey: `idem-r26-${randomUUID()}`,
      pin: '0000',
      correlationId: CREDENTIAL_ID,
    });
    const errors = validateSync(dto);
    expect(errors).toHaveLength(0);
    expect(dto.correlationId).toBe(CREDENTIAL_ID);
  });
});

describe('report 26 — shared identifier sanitizer (deterministic, bounded, fail-closed)', () => {
  it('credential-shaped identifiers collapse to the canonical marker under any casing/length', () => {
    for (const value of [
      'Bearer abcdefgh',
      'bearer abc',
      'Basic dTpw',
      'bEaReR a',
      'upstream said Bearer abcdefgh today',
    ]) {
      expect(sanitizeDiagnosticIdentifier(value)).not.toContain('abcdefgh');
      expect(sanitizeDiagnosticIdentifier(value)).not.toMatch(/\bdTpw\b/);
    }
    expect(sanitizeDiagnosticIdentifier(CREDENTIAL_ID)).toBe('[REDACTED]');
    expect(sanitizeDiagnosticIdentifier(LOWER_CREDENTIAL_ID)).toBe('[REDACTED]');
  });

  it('legitimate identifiers are preserved byte-for-byte (equality/idempotency semantics intact)', () => {
    for (const value of [
      LEGITIMATE_ID,
      'corr-42',
      randomUUID(),
      'customer-funding:84f7c022-1c8a-4c56-b1a1-900911602d51',
      'CASH_IN-idem-key-001',
    ]) {
      expect(sanitizeDiagnosticIdentifier(value)).toBe(value);
    }
  });

  it('is deterministic and idempotent (repeat sanitization is a fixed point)', () => {
    const once = sanitizeDiagnosticIdentifier(CREDENTIAL_ID);
    expect(sanitizeDiagnosticIdentifier(once)).toBe(once);
    const legit = sanitizeDiagnosticIdentifier(LEGITIMATE_ID);
    expect(sanitizeDiagnosticIdentifier(legit)).toBe(legit);
  });

  it('empty, oversized and non-string values fail closed to undefined (treated as absent)', () => {
    expect(sanitizeDiagnosticIdentifier('')).toBeUndefined();
    expect(sanitizeDiagnosticIdentifier('   ')).toBeUndefined();
    expect(sanitizeDiagnosticIdentifier('x'.repeat(256))).toBeUndefined();
    expect(sanitizeDiagnosticIdentifier(undefined)).toBeUndefined();
    expect(sanitizeDiagnosticIdentifier(null)).toBeUndefined();
    expect(sanitizeDiagnosticIdentifier(42)).toBeUndefined();
    expect(sanitizeDiagnosticIdentifier({ toString: () => 'Bearer abc' })).toBeUndefined();
  });

  it('surrounding whitespace is trimmed like the legacy service idiom', () => {
    expect(sanitizeDiagnosticIdentifier(`  ${LEGITIMATE_ID}  `)).toBe(LEGITIMATE_ID);
  });
});

describe('report 26 N-01 — URL query stripper (bounded, prose-safe)', () => {
  it('strips queries and fragments from path- and scheme-shaped URL tokens', () => {
    expect(stripDiagnosticUrlQueries('Cannot GET /api/v1/no-such?x=SECRET')).toBe(
      'Cannot GET /api/v1/no-such',
    );
    expect(stripDiagnosticUrlQueries('GET /a/b?token=abc#fragment trailing prose')).toBe(
      'GET /a/b trailing prose',
    );
    expect(stripDiagnosticUrlQueries('see https://partner.example/cb?code=xyz&state=1 now')).toBe(
      'see https://partner.example/cb now',
    );
  });

  it('strips percent-encoded credential carriers with the whole query', () => {
    const out = stripDiagnosticUrlQueries('Cannot GET /api/v1/x?e=bearer%20abcdefgh');
    expect(out).toBe('Cannot GET /api/v1/x');
    expect(out).not.toContain('abcdefgh');
  });

  it('leaves ordinary prose — including question marks — untouched', () => {
    const prose = 'what is this? nothing matched';
    expect(stripDiagnosticUrlQueries(prose)).toBe(prose);
    const prose2 = 'Basic: the fundamentals of mathematics';
    expect(stripDiagnosticUrlQueries(prose2)).toBe(prose2);
  });

  it('query-free URLs and non-strings are handled without throwing', () => {
    expect(stripDiagnosticUrlQueries('Cannot GET /api/v1/plain')).toBe('Cannot GET /api/v1/plain');
    expect(stripDiagnosticUrlQueries('')).toBe('');
    expect(stripDiagnosticUrlQueries(undefined)).toBe('[REDACTED]');
    expect(stripDiagnosticUrlQueries(42)).toBe('[REDACTED]');
  });
});
