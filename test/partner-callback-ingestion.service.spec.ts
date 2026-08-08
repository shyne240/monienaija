import { createHash, createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { ExternalCallbackReceipt } from '../src/partner/external-callback-receipt.entity';
import {
  EXTERNAL_CALLBACK_CONTRACT_NAME,
  EXTERNAL_CALLBACK_CONTRACT_VERSION,
} from '../src/partner/external-callback.types';
import { ExternalCallbackReceiptStatus } from '../src/partner/external-callback.enums';
import {
  PartnerCallbackAuthenticationService,
  PartnerCallbackAuthenticationException,
} from '../src/partner/partner-callback-authentication.service';
import {
  PartnerCallbackIngestionService,
  PartnerCallbackRejectedException,
} from '../src/partner/partner-callback-ingestion.service';

const SECRET = 'sandbox-callback-secret-123';
const EXTERNAL_OPERATION_ID = '00000000-0000-4000-8000-000000000001';
const CORRELATION_ID = 'correlation-external-1';
const CALLBACK_EVENT_ID = 'callback-event-1';
const REQUEST_CONTEXT = {
  requestId: 'callback-request-1',
  correlationId: CORRELATION_ID,
  traceId: 'callback-trace-1',
};

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function externalOperationReference(operationId = EXTERNAL_OPERATION_ID): string {
  return `external-operation:v1:${hash(`NIBSS_NIP:${operationId}:external-operation`)}`;
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    contractName: EXTERNAL_CALLBACK_CONTRACT_NAME,
    contractVersion: EXTERNAL_CALLBACK_CONTRACT_VERSION,
    partnerKey: 'NIBSS_NIP',
    callbackEventId: CALLBACK_EVENT_ID,
    externalOperationId: EXTERNAL_OPERATION_ID,
    externalOperationReference: externalOperationReference(),
    correlationId: CORRELATION_ID,
    providerReference: {
      referenceType: 'TRANSACTION',
      value: 'provider-transaction-1',
      namespace: 'nibss.nip',
    },
    providerStatus: 'PROCESSING',
    amountMinor: '1000',
    currency: 'NGN',
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeHeaders(
  payload: Record<string, unknown>,
  secret = SECRET,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const canonical = canonicalJson(payload);
  const signedValue = `NIBSS_NIP.${String(payload.callbackEventId)}.${timestamp}.${canonical}`;
  const signature = createHmac('sha256', secret).update(signedValue).digest('hex');
  return {
    partnerKey: 'NIBSS_NIP',
    callbackEventId: String(payload.callbackEventId),
    callbackTimestamp: String(timestamp),
    callbackSignature: `sha256=${signature}`,
  };
}

function expectAuthenticationError(action: () => void, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PartnerCallbackAuthenticationException);
  expect((caught as PartnerCallbackAuthenticationException).code).toBe(code);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

class FakeReceiptRepository {
  readonly records = new Map<string, ExternalCallbackReceipt>();

  create(input: Partial<ExternalCallbackReceipt>): ExternalCallbackReceipt {
    return input as ExternalCallbackReceipt;
  }

  save(receipt: ExternalCallbackReceipt): ExternalCallbackReceipt {
    receipt.createdAt ??= new Date();
    this.records.set(receipt.id, receipt);
    return receipt;
  }

  findOne(options: { where: { id?: string; partnerKey?: string; callbackEventId?: string } }) {
    if (options.where.id) return this.records.get(options.where.id) ?? null;
    return (
      [...this.records.values()].find(
        (receipt) =>
          receipt.partnerKey === options.where.partnerKey &&
          receipt.callbackEventId === options.where.callbackEventId,
      ) ?? null
    );
  }
}

class FakeManager {
  constructor(readonly receipts: FakeReceiptRepository) {}

  getRepository(target: unknown) {
    if (target === ExternalCallbackReceipt) return this.receipts;
    throw new Error('Unexpected repository');
  }
}

class FakeDataSource {
  constructor(private readonly manager: FakeManager) {}

  transaction<T>(_isolation: string, callback: (manager: FakeManager) => Promise<T>): Promise<T> {
    return callback(this.manager);
  }
}

class FakeIdempotencyService {
  readonly records = new Map<
    string,
    {
      id: string;
      requestHash: string;
      resourceId: string | null;
      status: 'IN_PROGRESS' | 'COMPLETED';
      responseBody?: Record<string, unknown>;
    }
  >();
  private nextId = 1;

  reserve(_manager: unknown, command: { scope: string; key: string; requestHash: string }) {
    const key = `${command.scope}:${command.key}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new PartnerCallbackRejectedException(
          'CALLBACK_IDEMPOTENCY_CONFLICT',
          'The callback event payload changed under the same event ID',
        );
      }
      if (existing.status === 'IN_PROGRESS') {
        throw new PartnerCallbackRejectedException(
          'CALLBACK_IDEMPOTENCY_CONFLICT',
          'The callback event is already in progress',
        );
      }
      return { kind: 'REPLAY' as const, record: existing };
    }
    const record = {
      id: `callback-idempotency-${this.nextId++}`,
      requestHash: command.requestHash,
      resourceId: null,
      status: 'IN_PROGRESS' as const,
    };
    this.records.set(key, record);
    return { kind: 'NEW' as const, record };
  }

  complete(
    _manager: unknown,
    recordId: string,
    command: { responseBody: Record<string, unknown>; resourceId?: string },
  ) {
    const record = [...this.records.values()].find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('Callback idempotency record is missing');
    record.status = 'COMPLETED';
    record.resourceId = command.resourceId ?? null;
    record.responseBody = command.responseBody;
  }
}

function makeAuthenticationService() {
  const config = new ConfigService({
    A6_PARTNER_ENABLED: true,
    A6_PARTNER_ENVIRONMENT: 'sandbox',
    A6_PARTNER_CALLBACK_MAX_SKEW_SECONDS: 300,
  });
  return new PartnerCallbackAuthenticationService({ load: () => SECRET }, config);
}

function makeOperationView(overrides: Record<string, unknown> = {}) {
  return {
    operationVersion: 1,
    externalOperationId: EXTERNAL_OPERATION_ID,
    externalOperationReference: externalOperationReference(),
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    resourceType: 'WITHDRAWAL',
    resourceId: '00000000-0000-4000-8000-000000000002',
    internalCommandId: '00000000-0000-4000-8000-000000000003',
    customerId: '00000000-0000-4000-8000-000000000004',
    walletAccountId: '00000000-0000-4000-8000-000000000005',
    ledgerAccountId: '00000000-0000-4000-8000-000000000006',
    targetMappingReference: `a6-target:${'a'.repeat(64)}`,
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    internalIdempotencyScope: 'external.partner.operation.v1',
    internalIdempotencyKey: 'operation-key',
    providerIdempotencyScope: 'nibss.nip.external-operation.v1',
    providerIdempotencyKey: 'provider-key',
    requestHash: 'a'.repeat(64),
    requestContext: REQUEST_CONTEXT,
    causationId: null,
    providerReferences: [],
    replayed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

function makeIngestionFixture() {
  const receipts = new FakeReceiptRepository();
  const manager = new FakeManager(receipts);
  const idempotency = new FakeIdempotencyService();
  const externalOperationService = {
    getInTransaction: jest.fn().mockResolvedValue(makeOperationView()),
    recordProviderReferenceInTransaction: jest.fn().mockResolvedValue({
      replayed: false,
      reference: {
        id: '00000000-0000-4000-8000-000000000010',
        externalOperationId: EXTERNAL_OPERATION_ID,
        partnerKey: 'NIBSS_NIP',
        referenceType: 'TRANSACTION',
        referenceValue: 'provider-transaction-1',
        namespace: 'nibss.nip',
        source: 'CALLBACK',
        observedAt: new Date(),
        createdAt: new Date(),
        replayed: false,
      },
    }),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new PartnerCallbackIngestionService(
    receipts as never,
    new FakeDataSource(manager) as never,
    makeAuthenticationService(),
    idempotency as never,
    externalOperationService as never,
    auditService as never,
  );
  return { service, receipts, idempotency, externalOperationService, auditService };
}

describe('PartnerCallbackAuthenticationService', () => {
  it('authenticates a valid signed callback', () => {
    const service = makeAuthenticationService();
    const payload = makePayload();

    const result = service.authenticate(makeHeaders(payload), payload);

    expect(result.callbackEventId).toBe(CALLBACK_EVENT_ID);
    expect(result.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.signatureHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects invalid signatures', () => {
    const service = makeAuthenticationService();
    const payload = makePayload();
    const headers = makeHeaders(payload);
    headers.callbackSignature = `sha256=${'b'.repeat(64)}`;

    expectAuthenticationError(
      () => service.authenticate(headers, payload),
      'CALLBACK_SIGNATURE_INVALID',
    );
  });

  it('rejects stale callbacks', () => {
    const service = makeAuthenticationService();
    const payload = makePayload();
    const staleTimestamp = Math.floor(Date.now() / 1000) - 301;

    expectAuthenticationError(
      () => service.authenticate(makeHeaders(payload, SECRET, staleTimestamp), payload),
      'CALLBACK_STALE',
    );
  });

  it('rejects malformed callback payloads', () => {
    const service = makeAuthenticationService();
    const payload = makePayload({ amountMinor: 'not-an-amount' });

    expect(() => service.authenticate(makeHeaders(payload), payload)).not.toThrow();
  });
});

describe('PartnerCallbackIngestionService', () => {
  it('accepts a valid callback without advancing lifecycle or financial state', async () => {
    const fixture = makeIngestionFixture();
    const payload = makePayload();

    const result = await fixture.service.ingest(makeHeaders(payload), payload);

    expect(result).toMatchObject({
      accepted: true,
      status: ExternalCallbackReceiptStatus.RECEIVED,
      replayed: false,
      duplicate: false,
      externalOperationId: EXTERNAL_OPERATION_ID,
      correlationId: CORRELATION_ID,
      providerStatus: 'PROCESSING',
    });
    expect(
      fixture.externalOperationService.recordProviderReferenceInTransaction,
    ).toHaveBeenCalled();
    expect(fixture.receipts.records.size).toBe(1);
    expect(fixture.auditService.record).toHaveBeenCalled();
  });

  it('replays the same callback event deterministically', async () => {
    const fixture = makeIngestionFixture();
    const payload = makePayload();
    const headers = makeHeaders(payload);

    const first = await fixture.service.ingest(headers, payload);
    const replay = await fixture.service.ingest(headers, payload);

    expect(replay.replayed).toBe(true);
    expect(replay.receiptId).toBe(first.receiptId);
    expect(fixture.receipts.records.size).toBe(1);
    expect(
      fixture.externalOperationService.recordProviderReferenceInTransaction,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate provider callback with a different event ID', async () => {
    const fixture = makeIngestionFixture();
    const firstPayload = makePayload();
    await fixture.service.ingest(makeHeaders(firstPayload), firstPayload);
    const duplicatePayload = makePayload({ callbackEventId: 'callback-event-2' });
    fixture.externalOperationService.recordProviderReferenceInTransaction.mockResolvedValueOnce({
      replayed: true,
      reference: {
        id: '00000000-0000-4000-8000-000000000010',
        externalOperationId: EXTERNAL_OPERATION_ID,
        partnerKey: 'NIBSS_NIP',
        referenceType: 'TRANSACTION',
        referenceValue: 'provider-transaction-1',
        namespace: 'nibss.nip',
        source: 'CALLBACK',
        observedAt: new Date(),
        createdAt: new Date(),
        replayed: true,
      },
    });

    const result = await fixture.service.ingest(makeHeaders(duplicatePayload), duplicatePayload);

    expect(result).toMatchObject({
      accepted: false,
      status: ExternalCallbackReceiptStatus.REJECTED,
      duplicate: true,
      rejectionCode: 'DUPLICATE_CALLBACK',
    });
    expect(fixture.receipts.records.size).toBe(2);
  });

  it('rejects an unknown external-operation/provider reference', async () => {
    const fixture = makeIngestionFixture();
    fixture.externalOperationService.getInTransaction.mockRejectedValue(new Error('not found'));
    const payload = makePayload({ callbackEventId: 'callback-event-unknown' });

    const result = await fixture.service.ingest(makeHeaders(payload), payload);

    expect(result).toMatchObject({
      accepted: false,
      status: ExternalCallbackReceiptStatus.REJECTED,
      rejectionCode: 'UNKNOWN_PROVIDER_REFERENCE',
      externalOperationId: null,
    });
  });

  it('rejects a mismatched external-operation reference and does not record a provider reference', async () => {
    const fixture = makeIngestionFixture();
    const payload = makePayload({
      callbackEventId: 'callback-event-mismatch',
      externalOperationReference: externalOperationReference(
        '00000000-0000-4000-8000-000000000099',
      ),
    });

    const result = await fixture.service.ingest(makeHeaders(payload), payload);

    expect(result.rejectionCode).toBe('EXTERNAL_OPERATION_REFERENCE_MISMATCH');
    expect(
      fixture.externalOperationService.recordProviderReferenceInTransaction,
    ).not.toHaveBeenCalled();
  });

  it('rejects malformed signed payloads before any operation lookup', async () => {
    const fixture = makeIngestionFixture();
    const payload = makePayload({ callbackEventId: 'callback-event-malformed', currency: 'USD' });

    await expect(fixture.service.ingest(makeHeaders(payload), payload)).rejects.toMatchObject({
      code: 'CALLBACK_MALFORMED',
    });
    expect(fixture.externalOperationService.getInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a changed payload under the same callback event ID', async () => {
    const fixture = makeIngestionFixture();
    const firstPayload = makePayload();
    await fixture.service.ingest(makeHeaders(firstPayload), firstPayload);
    const changedPayload = makePayload({ providerStatus: 'SETTLED' });

    await expect(
      fixture.service.ingest(makeHeaders(changedPayload), changedPayload),
    ).rejects.toMatchObject({
      code: 'CALLBACK_IDEMPOTENCY_CONFLICT',
    });
  });
});
