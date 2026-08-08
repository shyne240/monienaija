import { randomUUID } from 'node:crypto';

import type { DataSource, Repository } from 'typeorm';

import type { AuditEvent } from '../src/operations/audit-event.entity';
import { ExternalDataClassificationEntity } from '../src/partner/external-data-classification.entity';
import { ExternalDataClassificationRegistry } from '../src/partner/external-data-classification.registry';
import { ExternalDataMinimizationService } from '../src/partner/external-data-minimization.service';
import {
  EXTERNAL_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE,
  EXTERNAL_DATA_MINIMIZATION_DEFAULT_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_DISCLOSURE_RETENTION_DAYS,
  EXTERNAL_DATA_MINIMIZATION_SUPPORT_TRACE_RETENTION_DAYS,
  ExternalConsentSource,
  ExternalConsentStatus,
  ExternalDataControlAction,
  ExternalDataHandlingLevel,
  ExternalDisclosureAudience,
  ExternalLegalHoldAuthority,
  ExternalLegalHoldScope,
  ExternalLegalHoldStatus,
  ExternalPartnerPayloadRejectionCode,
  ExternalSecretCategory,
} from '../src/partner/external-data-minimization.enums';
import type {
  ExternalConsentAssertion,
  ExternalDataClassificationEntry,
  ExternalDataMinimizationException as _ExtException,
  ExternalLegalHoldRecord,
  ExternalPartnerPayload,
  ExternalRetentionEntry,
  ExternalSecretClassification,
} from '../src/partner/external-data-minimization.types';
import { ExternalConsentAssertionEntity } from '../src/partner/external-consent-assertion.entity';
import { ExternalLegalHoldEntity } from '../src/partner/external-legal-hold.entity';
import { ExternalRetentionClassificationEntity } from '../src/partner/external-retention-classification.entity';
import { ExternalSecretClassificationEntity } from '../src/partner/external-secret-classification.entity';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const TARGET_ID = '00000000-0000-4000-8000-000000000002';
const REFERENCE_ID = '00000000-0000-4000-8000-000000000003';
const MANDATE_REFERENCE = 'mandate-ref-test-001';
const GRANTED_BY = 'mandate-grantor-test';
const CORRELATION_ID = 'correlation-a6t10-test';

const REQUEST_CONTEXT = {
  requestId: 'request-a6t10-1',
  correlationId: CORRELATION_ID,
  actor: 'a6-test-actor',
};

function asExtError(): typeof _ExtException {
  return {} as never;
}

function expectExtErrorCode(callable: () => unknown, code: string): void {
  try {
    callable();
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      expect((error as unknown as { code: string }).code).toBe(code);
      return;
    }
    throw error;
  }
  throw new Error(`Expected exception with code ${code} but no exception was thrown`);
}

async function expectAsyncExtErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      expect((error as unknown as { code: string }).code).toBe(code);
      return;
    }
    throw error;
  }
  throw new Error(`Expected exception with code ${code} but no exception was thrown`);
}

class FakeClassificationRepository {
  readonly records = new Map<string, ExternalDataClassificationEntity>();

  create(input: Partial<ExternalDataClassificationEntity>): ExternalDataClassificationEntity {
    return input as ExternalDataClassificationEntity;
  }

  save(
    input: Partial<ExternalDataClassificationEntity>,
  ): Promise<ExternalDataClassificationEntity> {
    const id = input.id ?? randomUUID();
    const entity = {
      ...input,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExternalDataClassificationEntity;
    this.records.set(id, entity);
    return Promise.resolve(entity);
  }

  findOne(options: {
    where: { fieldName?: string };
  }): Promise<ExternalDataClassificationEntity | null> {
    if (options.where.fieldName) {
      const found = [...this.records.values()].find(
        (entity) => entity.fieldName === options.where.fieldName,
      );
      return Promise.resolve(found ?? null);
    }
    return Promise.resolve(null);
  }
}

class FakeConsentRepository {
  readonly records = new Map<string, ExternalConsentAssertionEntity>();

  create(input: Partial<ExternalConsentAssertionEntity>): ExternalConsentAssertionEntity {
    return input as ExternalConsentAssertionEntity;
  }

  save(input: Partial<ExternalConsentAssertionEntity>): Promise<ExternalConsentAssertionEntity> {
    const id = input.id ?? randomUUID();
    const entity = {
      ...input,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExternalConsentAssertionEntity;
    this.records.set(id, entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where: { id?: string } }): Promise<ExternalConsentAssertionEntity | null> {
    if (options.where.id) {
      return Promise.resolve(this.records.get(options.where.id) ?? null);
    }
    return Promise.resolve(null);
  }
}

class FakeRetentionRepository {
  readonly records = new Map<string, ExternalRetentionClassificationEntity>();

  create(
    input: Partial<ExternalRetentionClassificationEntity>,
  ): ExternalRetentionClassificationEntity {
    return input as ExternalRetentionClassificationEntity;
  }

  save(
    input: Partial<ExternalRetentionClassificationEntity>,
  ): Promise<ExternalRetentionClassificationEntity> {
    const id = input.id ?? randomUUID();
    const entity = {
      ...input,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExternalRetentionClassificationEntity;
    this.records.set(id, entity);
    return Promise.resolve(entity);
  }
}

class FakeLegalHoldRepository {
  readonly records = new Map<string, ExternalLegalHoldEntity>();

  create(input: Partial<ExternalLegalHoldEntity>): ExternalLegalHoldEntity {
    return input as ExternalLegalHoldEntity;
  }

  save(input: Partial<ExternalLegalHoldEntity>): Promise<ExternalLegalHoldEntity> {
    const id = input.id ?? randomUUID();
    const entity = {
      ...input,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExternalLegalHoldEntity;
    this.records.set(id, entity);
    return Promise.resolve(entity);
  }

  findOne(options: {
    where: {
      id?: string;
      scope?: ExternalLegalHoldScope;
      referenceId?: string;
      status?: ExternalLegalHoldStatus;
    };
  }): Promise<ExternalLegalHoldEntity | null> {
    const { id, scope, referenceId, status } = options.where;
    const found = [...this.records.values()].find((entity) => {
      if (id !== undefined && entity.id !== id) return false;
      if (scope !== undefined && entity.scope !== scope) return false;
      if (referenceId !== undefined && entity.referenceId !== referenceId) return false;
      if (status !== undefined && entity.status !== status) return false;
      return true;
    });
    return Promise.resolve(found ?? null);
  }
}

class FakeSecretRepository {
  readonly records = new Map<string, ExternalSecretClassificationEntity>();

  create(input: Partial<ExternalSecretClassificationEntity>): ExternalSecretClassificationEntity {
    return input as ExternalSecretClassificationEntity;
  }

  save(
    input: Partial<ExternalSecretClassificationEntity>,
  ): Promise<ExternalSecretClassificationEntity> {
    const id = input.id ?? randomUUID();
    const entity = {
      ...input,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExternalSecretClassificationEntity;
    this.records.set(id, entity);
    return Promise.resolve(entity);
  }
}

class FakeManager {
  constructor(
    public readonly classification: FakeClassificationRepository,
    public readonly consent: FakeConsentRepository,
    public readonly retention: FakeRetentionRepository,
    public readonly legalHold: FakeLegalHoldRepository,
    public readonly secret: FakeSecretRepository,
  ) {}

  getRepository(target: unknown) {
    if (target === ExternalDataClassificationEntity) return this.classification;
    if (target === ExternalConsentAssertionEntity) return this.consent;
    if (target === ExternalRetentionClassificationEntity) return this.retention;
    if (target === ExternalLegalHoldEntity) return this.legalHold;
    if (target === ExternalSecretClassificationEntity) return this.secret;
    throw new Error(`Unexpected repository: ${String(target)}`);
  }

  query(): Promise<unknown[]> {
    return Promise.resolve([]);
  }
}

class FakeDataSource {
  constructor(
    private readonly manager: FakeManager,
    private readonly isolationCaptures: string[] = [],
  ) {}

  async transaction<T>(
    isolation: string,
    callback: (manager: FakeManager) => Promise<T>,
  ): Promise<T> {
    this.isolationCaptures.push(isolation);
    return callback(this.manager);
  }

  getIsolationCaptures(): readonly string[] {
    return this.isolationCaptures;
  }
}

class FakeAuditService {
  readonly events: Array<{
    entityType: string;
    entityId: string;
    action: ExternalDataControlAction;
    actor: string;
    correlationId: string | null;
    requestId: string | null;
    newValues: Record<string, unknown>;
    previousValues: Record<string, unknown> | null | undefined;
  }> = [];

  record(
    _manager: unknown,
    command: {
      entityType: string;
      entityId: string;
      action: ExternalDataControlAction;
      actor: string;
      correlationId?: string;
      requestId?: string;
      previousValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
    },
  ): Promise<AuditEvent> {
    this.events.push({
      entityType: command.entityType,
      entityId: command.entityId,
      action: command.action,
      actor: command.actor,
      correlationId: command.correlationId ?? null,
      requestId: command.requestId ?? null,
      newValues: command.newValues ?? {},
      previousValues: command.previousValues ?? null,
    });
    return Promise.resolve({
      id: randomUUID(),
      entityType: command.entityType,
      entityId: command.entityId,
      action: command.action,
      actor: command.actor,
      correlationId: command.correlationId ?? null,
      requestId: command.requestId ?? null,
      previousValues: command.previousValues ?? null,
      newValues: command.newValues ?? null,
      occurredAt: new Date(),
    } as unknown as AuditEvent);
  }
}

function makeService() {
  const classification = new FakeClassificationRepository();
  const consent = new FakeConsentRepository();
  const retention = new FakeRetentionRepository();
  const legalHold = new FakeLegalHoldRepository();
  const secret = new FakeSecretRepository();
  const manager = new FakeManager(classification, consent, retention, legalHold, secret);
  const dataSource = new FakeDataSource(manager);
  const audit = new FakeAuditService();
  const registry = new ExternalDataClassificationRegistry();
  const service = new ExternalDataMinimizationService(
    classification as unknown as Repository<ExternalDataClassificationEntity>,
    consent as unknown as Repository<ExternalConsentAssertionEntity>,
    retention as unknown as Repository<ExternalRetentionClassificationEntity>,
    legalHold as unknown as Repository<ExternalLegalHoldEntity>,
    secret as unknown as Repository<ExternalSecretClassificationEntity>,
    dataSource as unknown as DataSource,
    audit as never,
    registry,
  );
  return {
    service,
    classification,
    consent,
    retention,
    legalHold,
    secret,
    manager,
    dataSource,
    audit,
    registry,
  };
}

function makeClassificationEntry(
  overrides: Partial<ExternalDataClassificationEntry> = {},
): ExternalDataClassificationEntry {
  const audienceMaximums = {
    [ExternalDisclosureAudience.SUPPORT]: ExternalDataHandlingLevel.CONFIDENTIAL,
    [ExternalDisclosureAudience.OPERATIONS]: ExternalDataHandlingLevel.CONFIDENTIAL,
    [ExternalDisclosureAudience.RECONCILIATION]: ExternalDataHandlingLevel.CONFIDENTIAL,
    [ExternalDisclosureAudience.FINANCE]: ExternalDataHandlingLevel.RESTRICTED,
    [ExternalDisclosureAudience.COMPLIANCE]: ExternalDataHandlingLevel.RESTRICTED,
    [ExternalDisclosureAudience.LEGAL]: ExternalDataHandlingLevel.RESTRICTED,
    [ExternalDisclosureAudience.SECURITY]: ExternalDataHandlingLevel.HIGHLY_RESTRICTED,
    [ExternalDisclosureAudience.A6_TEN_INTERNAL]: ExternalDataHandlingLevel.CONFIDENTIAL,
  } as const;
  return {
    fieldName: 'amountMinor',
    level: ExternalDataHandlingLevel.CONFIDENTIAL,
    sourceDomain: 'A6T10',
    owner: 'a6-external-data-minimization',
    audienceMaximums,
    secretCategory: null,
    retentionDays: 365,
    holdSupport: true,
    ...overrides,
  };
}

function makeConsent(overrides: Partial<ExternalConsentAssertion> = {}): ExternalConsentAssertion {
  return {
    customerId: CUSTOMER_ID,
    source: ExternalConsentSource.CUSTOMER_BENEFICIARY,
    targetId: TARGET_ID,
    targetVersion: 1,
    purpose: 'OUTBOUND_BANK_SETTLEMENT',
    jurisdiction: 'NG',
    mandateReference: MANDATE_REFERENCE,
    mandateVersion: 1,
    grantedAt: new Date('2026-08-01T00:00:00.000Z'),
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    grantedBy: GRANTED_BY,
    revocable: true,
    revokedAt: null,
    ...overrides,
  };
}

function makeRetention(overrides: Partial<ExternalRetentionEntry> = {}): ExternalRetentionEntry {
  return {
    dataset: 'external_operation',
    level: ExternalDataHandlingLevel.CONFIDENTIAL,
    owner: 'a6-external-data-minimization',
    retentionDays: 365,
    holdSupport: true,
    ...overrides,
  };
}

function makeLegalHold(overrides: Partial<ExternalLegalHoldRecord> = {}): ExternalLegalHoldRecord {
  return {
    scope: ExternalLegalHoldScope.EXTERNAL_OPERATION,
    referenceId: REFERENCE_ID,
    owner: 'a6-external-data-minimization',
    authority: ExternalLegalHoldAuthority.LEGAL,
    reason: 'investigation in progress',
    imposedAt: new Date('2026-08-08T00:00:00.000Z'),
    imposedBy: 'compliance-officer-test',
    releasedAt: null,
    releasedBy: null,
    notes: null,
    ...overrides,
  };
}

function makeSecret(
  overrides: Partial<ExternalSecretClassification> = {},
): ExternalSecretClassification {
  return {
    category: ExternalSecretCategory.PARTNER_CLIENT_AUTHENTICATION,
    owner: 'security',
    reference: 'partner-credential-handle-001',
    notes: null,
    ...overrides,
  };
}

function makePartnerPayload(
  overrides: Partial<ExternalPartnerPayload> = {},
): ExternalPartnerPayload {
  return {
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    payload: {
      externalOperationReference: 'external-operation:v1:abc123',
      targetMappingReference: 'a6-target:def456',
      amountMinor: '1000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      requestId: 'request-a6t10-payload-1',
      correlationId: 'correlation-a6t10-payload-1',
      providerIdempotencyKey: 'provider-key-a6t10-1',
    },
    ...overrides,
  };
}

describe('ExternalDataMinimizationService — classification', () => {
  it('registers default A6 fields and secret categories', () => {
    const registry = new ExternalDataClassificationRegistry();
    expect(registry.registryVersion()).toBeGreaterThanOrEqual(1);
    expect(registry.isRegistered('externalOperationId')).toBe(true);
    expect(registry.isRegistered('customerId')).toBe(true);
    expect(registry.isRegistered('amountMinor')).toBe(true);
    expect(registry.isRegistered('secret.CALLBACK_SECRET')).toBe(true);
    expect(registry.isRegistered('secret.PARTNER_CLIENT_AUTHENTICATION')).toBe(true);
    expect(registry.levelFor('customerId')).toBe(ExternalDataHandlingLevel.RESTRICTED);
    expect(registry.levelFor('amountMinor')).toBe(ExternalDataHandlingLevel.CONFIDENTIAL);
    expect(registry.secretCategoryFor('secret.CALLBACK_SECRET')).toBe(
      ExternalSecretCategory.CALLBACK_SECRET,
    );
  });

  it('classifies a field into a view with a stable id and registry version', async () => {
    const { service } = makeService();
    const view = await service.recordClassification(makeClassificationEntry(), REQUEST_CONTEXT);
    expect(view.classificationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(view.fieldName).toBe('amountMinor');
    expect(view.level).toBe(ExternalDataHandlingLevel.CONFIDENTIAL);
    expect(view.sourceDomain).toBe('A6T10');
    expect(view.owner).toBe('a6-external-data-minimization');
    expect(view.classificationRegistryVersion).toBeGreaterThanOrEqual(1);
  });

  it('rejects an invalid classification level', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.classifyField(
          makeClassificationEntry({ level: 'NOT_A_LEVEL' as ExternalDataHandlingLevel }),
        ),
      'CLASSIFICATION_LEVEL_INVALID',
    );
  });

  it('rejects an empty owner for a classification', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () => service.classifyField(makeClassificationEntry({ owner: '   ' })),
      'CLASSIFICATION_NOT_REGISTERED',
    );
  });

  it('classifies a secret reference at HIGHLY_RESTRICTED only', async () => {
    const { service } = makeService();
    const view = await service.recordClassification(
      makeClassificationEntry({
        fieldName: 'secret.DEVICE_FINGERPRINT_RAW',
        level: ExternalDataHandlingLevel.HIGHLY_RESTRICTED,
        owner: 'security',
        secretCategory: ExternalSecretCategory.DEVICE_FINGERPRINT_RAW,
      }),
      REQUEST_CONTEXT,
    );
    expect(view.level).toBe(ExternalDataHandlingLevel.HIGHLY_RESTRICTED);
  });
});

describe('ExternalDataMinimizationService — consent', () => {
  it('records a valid consent assertion and returns the consent view', async () => {
    const { service } = makeService();
    const view = await service.recordConsent(makeConsent(), REQUEST_CONTEXT);
    expect(view.customerId).toBe(CUSTOMER_ID);
    expect(view.purpose).toBe('OUTBOUND_BANK_SETTLEMENT');
    expect(view.jurisdiction).toBe('NG');
    expect(view.status).toBe(ExternalConsentStatus.ACTIVE);
    expect(view.revocable).toBe(true);
  });

  it('rejects consent with an expired expiresAt', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.validateConsent(makeConsent({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })),
      'CONSENT_EXPIRED',
    );
  });

  it('rejects consent with a future grantedAt', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.validateConsent(makeConsent({ grantedAt: new Date('2099-01-01T00:00:00.000Z') })),
      'CONSENT_EXPIRED',
    );
  });

  it('rejects consent that is already revoked', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.validateConsent(makeConsent({ revokedAt: new Date('2026-08-02T00:00:00.000Z') })),
      'CONSENT_REVOKED',
    );
  });

  it('rejects consent with a purpose not in the approved set', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () => service.validateConsent(makeConsent({ purpose: 'INTERNAL_TRANSFER' })),
      'CONSENT_PURPOSE_MISMATCH',
    );
  });

  it('rejects consent with a non-approved jurisdiction', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () => service.validateConsent(makeConsent({ jurisdiction: 'GB' })),
      'CONSENT_JURISDICTION_MISMATCH',
    );
  });

  it('rejects consent with a stale target id (not a UUID)', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () => service.validateConsent(makeConsent({ targetId: 'not-a-uuid' })),
      'CONSENT_TARGET_STALE',
    );
  });

  it('rejects consent with a missing grantor principal', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () => service.validateConsent(makeConsent({ grantedBy: '   ' })),
      'CONSENT_GRANTOR_MISSING',
    );
  });

  it('revokes an existing consent and prevents re-revocation', async () => {
    const { service, consent } = makeService();
    const recorded = await service.recordConsent(makeConsent(), REQUEST_CONTEXT);
    const entity = [...consent.records.values()][0]!;
    const first = await service.revokeConsent(
      entity.id,
      new Date('2026-08-08T01:00:00.000Z'),
      REQUEST_CONTEXT,
    );
    expect(first.revokedAt).toEqual(new Date('2026-08-08T01:00:00.000Z'));
    expect(first.status).toBe(ExternalConsentStatus.REVOKED);
    await expectAsyncExtErrorCode(
      service.revokeConsent(entity.id, new Date('2026-08-08T02:00:00.000Z'), REQUEST_CONTEXT),
      'CONSENT_REVOKED',
    );
    expect(recorded.consentId).toBeDefined();
  });
});

describe('ExternalDataMinimizationService — retention', () => {
  it('records a retention classification', async () => {
    const { service } = makeService();
    const view = await service.recordRetention(makeRetention(), REQUEST_CONTEXT);
    expect(view.dataset).toBe('external_operation');
    expect(view.level).toBe(ExternalDataHandlingLevel.CONFIDENTIAL);
    expect(view.retentionDays).toBe(365);
  });

  it('rejects HIGHLY_RESTRICTED retention below the 365-day floor', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.classifyRetention(
          makeRetention({
            level: ExternalDataHandlingLevel.HIGHLY_RESTRICTED,
            retentionDays: 30,
          }),
        ),
      'RETENTION_BELOW_FLOOR',
    );
  });

  it('rejects INTERNAL retention without holdSupport', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.classifyRetention(
          makeRetention({
            level: ExternalDataHandlingLevel.INTERNAL,
            holdSupport: false,
          }),
        ),
      'RETENTION_MISSING',
    );
  });

  it('rejects negative retention days', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () => service.classifyRetention(makeRetention({ retentionDays: -1 })),
      'RETENTION_BELOW_FLOOR',
    );
  });

  it('accepts RESTRICTED retention without holdSupport requirement', () => {
    const { service } = makeService();
    const view = service.classifyRetention(
      makeRetention({
        level: ExternalDataHandlingLevel.RESTRICTED,
        holdSupport: false,
        retentionDays: 365,
      }),
    );
    expect(view.level).toBe(ExternalDataHandlingLevel.RESTRICTED);
  });
});

describe('ExternalDataMinimizationService — legal hold', () => {
  it('imposes and releases a legal hold', async () => {
    const { service, legalHold } = makeService();
    const imposed = await service.imposeLegalHold(makeLegalHold(), REQUEST_CONTEXT);
    expect(imposed.status).toBe(ExternalLegalHoldStatus.ACTIVE);
    const entity = [...legalHold.records.values()][0]!;
    const released = await service.releaseLegalHold(entity.id, 'releaser-test', REQUEST_CONTEXT);
    expect(released.status).toBe(ExternalLegalHoldStatus.RELEASED);
    expect(released.releasedBy).toBe('releaser-test');
  });

  it('rejects imposing a second active hold for the same scope/reference', async () => {
    const { service } = makeService();
    await service.imposeLegalHold(makeLegalHold(), REQUEST_CONTEXT);
    await expectAsyncExtErrorCode(
      service.imposeLegalHold(makeLegalHold(), REQUEST_CONTEXT),
      'RETENTION_HOLD_ACTIVE',
    );
  });

  it('rejects releasing a hold that is already released', async () => {
    const { service, legalHold } = makeService();
    await service.imposeLegalHold(makeLegalHold(), REQUEST_CONTEXT);
    const entity = [...legalHold.records.values()][0]!;
    await service.releaseLegalHold(entity.id, 'releaser-test', REQUEST_CONTEXT);
    await expectAsyncExtErrorCode(
      service.releaseLegalHold(entity.id, 'releaser-test-2', REQUEST_CONTEXT),
      'HOLD_ALREADY_RELEASED',
    );
  });

  it('rejects releasing a missing hold', async () => {
    const { service } = makeService();
    await expectAsyncExtErrorCode(
      service.releaseLegalHold(
        '00000000-0000-4000-8000-000000000099',
        'releaser-test',
        REQUEST_CONTEXT,
      ),
      'HOLD_NOT_FOUND',
    );
  });

  it('rejects release with a missing principal', async () => {
    const { service, legalHold } = makeService();
    await service.imposeLegalHold(makeLegalHold(), REQUEST_CONTEXT);
    const entity = [...legalHold.records.values()][0]!;
    await expectAsyncExtErrorCode(
      service.releaseLegalHold(entity.id, '   ', REQUEST_CONTEXT),
      'HOLD_RELEASED_BY_MISSING',
    );
  });

  it('rejects an impose with a missing authority', async () => {
    const { service } = makeService();
    await expectAsyncExtErrorCode(
      service.imposeLegalHold(
        makeLegalHold({ authority: '' as ExternalLegalHoldAuthority }),
        REQUEST_CONTEXT,
      ),
      'HOLD_AUTHORITY_MISSING',
    );
  });

  it('isHeld returns true while a hold is active and false after release', async () => {
    const { service, legalHold } = makeService();
    await service.imposeLegalHold(makeLegalHold(), REQUEST_CONTEXT);
    expect(await service.isHeld(ExternalLegalHoldScope.EXTERNAL_OPERATION, REFERENCE_ID)).toBe(
      true,
    );
    const entity = [...legalHold.records.values()][0]!;
    await service.releaseLegalHold(entity.id, 'releaser-test', REQUEST_CONTEXT);
    expect(await service.isHeld(ExternalLegalHoldScope.EXTERNAL_OPERATION, REFERENCE_ID)).toBe(
      false,
    );
  });
});

describe('ExternalDataMinimizationService — secret classification', () => {
  it('classifies a secret reference at HIGHLY_RESTRICTED only', () => {
    const { service } = makeService();
    const view = service.classifySecret(makeSecret());
    expect(view.category).toBe(ExternalSecretCategory.PARTNER_CLIENT_AUTHENTICATION);
    expect(view.reference).toBe('partner-credential-handle-001');
  });

  it('records a secret classification and confirms secret value is never stored', async () => {
    const { service, secret } = makeService();
    const view = await service.recordSecret(makeSecret(), REQUEST_CONTEXT);
    expect(view.classificationId).toBeDefined();
    const stored = [...secret.records.values()][0]!;
    expect(stored.reference).toBe('partner-credential-handle-001');
    expect(JSON.stringify(stored)).not.toContain('raw-secret-value');
  });

  it('rejects a secret with an empty reference handle', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () => service.classifySecret(makeSecret({ reference: '   ' })),
      'SECRET_LEVEL_INVALID',
    );
  });

  it('rejects a secret with a non-approved category', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.classifySecret(
          makeSecret({ category: 'NOT_REAL_CATEGORY' as ExternalSecretCategory }),
        ),
      'SECRET_LEVEL_INVALID',
    );
  });
});

describe('ExternalDataMinimizationService — disclosure', () => {
  it('classifies a disclosure for an audience that can receive the level', () => {
    const { service } = makeService();
    const view = service.classifyDisclosure(
      'amountMinor',
      ExternalDataHandlingLevel.CONFIDENTIAL,
      ExternalDisclosureAudience.SUPPORT,
    );
    expect(view.audience).toBe(ExternalDisclosureAudience.SUPPORT);
    expect(view.fields).toEqual({ amountMinor: ExternalDataHandlingLevel.CONFIDENTIAL });
    expect(view.maskedFields).toHaveLength(0);
  });

  it('rejects a disclosure to an audience below the field level', () => {
    const { service } = makeService();
    // RESTRICTED is not allowed for SUPPORT (max CONFIDENTIAL)
    expectExtErrorCode(
      () =>
        service.classifyDisclosure(
          'customerId',
          ExternalDataHandlingLevel.RESTRICTED,
          ExternalDisclosureAudience.SUPPORT,
        ),
      'DISCLOSURE_AUDIENCE_TOO_LOW',
    );
  });

  it('rejects a HIGHLY_RESTRICTED disclosure to non-SECURITY audience', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.classifyDisclosure(
          'secret.CALLBACK_SECRET',
          ExternalDataHandlingLevel.HIGHLY_RESTRICTED,
          ExternalDisclosureAudience.LEGAL,
        ),
      'DISCLOSURE_REJECTED_HIGHLY_RESTRICTED',
    );
  });

  it('allows a HIGHLY_RESTRICTED disclosure to SECURITY audience', () => {
    const { service } = makeService();
    const view = service.classifyDisclosure(
      'secret.CALLBACK_SECRET',
      ExternalDataHandlingLevel.HIGHLY_RESTRICTED,
      ExternalDisclosureAudience.SECURITY,
    );
    expect(view.audience).toBe(ExternalDisclosureAudience.SECURITY);
  });

  it('rejects a disclosure with a level that does not match the registered level', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.classifyDisclosure(
          'amountMinor',
          ExternalDataHandlingLevel.RESTRICTED,
          ExternalDisclosureAudience.SUPPORT,
        ),
      'CLASSIFICATION_LEVEL_INVALID',
    );
  });

  it('rejects a disclosure for an unregistered field', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.classifyDisclosure(
          'unknownFieldName',
          ExternalDataHandlingLevel.PUBLIC,
          ExternalDisclosureAudience.SUPPORT,
        ),
      'DISCLOSURE_FIELD_NOT_REGISTERED',
    );
  });

  it('projects a disclosure and masks fields that exceed the audience maximum', async () => {
    const { service } = makeService();
    const view = {
      viewId: 'view-test-1',
      externalOperationId: REFERENCE_ID,
      audience: ExternalDisclosureAudience.SUPPORT,
      fields: {
        externalOperationId: 'op-id-test-1',
        amountMinor: '1000',
        customerId: CUSTOMER_ID,
      },
      maskedFields: [],
      generatedAt: new Date(),
    };
    const projected = await service.projectDisclosure(
      view,
      ExternalDisclosureAudience.SUPPORT,
      REQUEST_CONTEXT,
    );
    expect(projected.maskedFields).toContain('customerId');
    expect(projected.fields['amountMinor']).toBe('1000');
    expect(projected.fields['customerId']).toBe('[RESTRICTED:SUPPORT]');
  });
});

describe('ExternalDataMinimizationService — support trace', () => {
  it('builds a support trace that masks fields above the audience maximum', () => {
    const { service } = makeService();
    const trace = service.buildSupportTrace(REFERENCE_ID, ExternalDisclosureAudience.SUPPORT, {
      externalOperationId: 'op-id-test-1',
      amountMinor: '1000',
      customerId: CUSTOMER_ID,
    });
    expect(trace.maskedFields).toContain('customerId');
    expect(trace.trace['amountMinor']).toBe('1000');
  });

  it('rejects a support trace that contains a secret field name', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.buildSupportTrace(REFERENCE_ID, ExternalDisclosureAudience.SUPPORT, {
          callbackSecret: 'plaintext-secret',
        }),
      'SECRET_IN_SUPPORT_TRACE',
    );
  });

  it('rejects a support trace that contains a HIGHLY_RESTRICTED field for non-SECURITY audience', () => {
    const { service } = makeService();
    expectExtErrorCode(
      () =>
        service.buildSupportTrace(REFERENCE_ID, ExternalDisclosureAudience.SUPPORT, {
          'secret.CALLBACK_SECRET': 'handle-1',
        }),
      'SECRET_IN_SUPPORT_TRACE',
    );
  });

  it('records a support trace and emits an audit event', async () => {
    const { service, audit } = makeService();
    const trace = service.buildSupportTrace(REFERENCE_ID, ExternalDisclosureAudience.SUPPORT, {
      externalOperationId: 'op-id-test-1',
      amountMinor: '1000',
    });
    await service.recordSupportTrace(trace, REQUEST_CONTEXT);
    const recorded = audit.events.find(
      (event) => event.action === ExternalDataControlAction.SUPPORT_TRACE_BUILT,
    );
    expect(recorded).toBeDefined();
    expect(recorded?.entityType).toBe(EXTERNAL_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE);
  });
});

describe('ExternalDataMinimizationService — partner payload validation', () => {
  it('accepts a well-formed partner payload', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload(),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(true);
    expect(result.rejectedFields).toHaveLength(0);
    expect(result.missingFields).toHaveLength(0);
  });

  it('rejects a partner payload with the wrong partner key', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({ partnerKey: 'OTHER_PARTNER' }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    const rejection = result.rejectedFields.find((r) => r.field === 'partnerKey');
    expect(rejection?.reason).toBe(ExternalPartnerPayloadRejectionCode.UNKNOWN_FIELD);
  });

  it('rejects a partner payload containing a raw secret field name', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          callbackSecret: 'plaintext',
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.RAW_SECRET_PRESENT,
    );
  });

  it('rejects a partner payload containing a raw secret value', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          note: 'api_key=plaintext',
          secret: 'plaintext-secret-value',
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.RAW_SECRET_PRESENT,
    );
  });

  it('rejects a partner payload containing a customer identity', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          customerId: CUSTOMER_ID,
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.CUSTOMER_IDENTITY_PRESENT,
    );
  });

  it('rejects a partner payload containing a wallet identity', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          walletAccountId: '00000000-0000-4000-8000-0000000000aa',
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.WALLET_IDENTITY_PRESENT,
    );
  });

  it('rejects a partner payload containing a ledger identity', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          ledgerAccountId: '00000000-0000-4000-8000-0000000000bb',
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.LEDGER_IDENTITY_PRESENT,
    );
  });

  it('rejects a partner payload containing a journal identity', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          journalId: '00000000-0000-4000-8000-0000000000cc',
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.JOURNAL_IDENTITY_PRESENT,
    );
  });

  it('rejects a partner payload containing a raw callback material', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          note: 'callback_secret=foo',
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.RAW_CALLBACK_SECRET,
    );
  });

  it('rejects a partner payload containing a raw risk narrative', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          riskNarrative: 'high risk customer',
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.RAW_RISK_NARRATIVE,
    );
  });

  it('rejects a partner payload containing a raw compliance note', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          complianceNote: 'case escalation',
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.RAW_COMPLIANCE_NOTE,
    );
  });

  it('rejects a partner payload containing a raw device fingerprint', async () => {
    const { service } = makeService();
    const result = await service.validateAndAuditPartnerPayload(
      makePartnerPayload({
        payload: {
          ...makePartnerPayload().payload,
          deviceFingerprint: 'fingerprint-raw-1',
        },
      }),
      REQUEST_CONTEXT,
    );
    expect(result.valid).toBe(false);
    expect(result.rejectedFields[0]?.reason).toBe(
      ExternalPartnerPayloadRejectionCode.RAW_DEVICE_FINGERPRINT,
    );
  });

  it('reports missing recommended fields', async () => {
    const { service } = makeService();
    const payload = makePartnerPayload();
    const basePayload = payload.payload as Record<string, unknown>;
    delete basePayload['amountMinor'];
    delete basePayload['currency'];
    const result = await service.validateAndAuditPartnerPayload(payload, REQUEST_CONTEXT);
    expect(result.valid).toBe(true);
    expect(result.missingFields).toContain('amountMinor');
    expect(result.missingFields).toContain('currency');
  });

  it('records an audit event when a partner payload is rejected', async () => {
    const { service, audit } = makeService();
    await service.validateAndAuditPartnerPayload(
      makePartnerPayload({ partnerKey: 'OTHER_PARTNER' }),
      REQUEST_CONTEXT,
    );
    const event = audit.events.find(
      (event) => event.action === ExternalDataControlAction.PARTNER_PAYLOAD_REJECTED,
    );
    expect(event).toBeDefined();
    expect(event?.entityType).toBe(EXTERNAL_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE);
  });
});

describe('ExternalDataMinimizationService — replay consistency', () => {
  it('produces identical classification views for identical inputs', () => {
    const { service } = makeService();
    const first = service.classifyField(makeClassificationEntry());
    const second = service.classifyField(makeClassificationEntry());
    expect(first.fieldName).toBe(second.fieldName);
    expect(first.level).toBe(second.level);
    expect(first.sourceDomain).toBe(second.sourceDomain);
    expect(first.owner).toBe(second.owner);
    expect(first.classificationRegistryVersion).toBe(second.classificationRegistryVersion);
  });

  it('produces identical retention views for identical inputs', () => {
    const { service } = makeService();
    const first = service.classifyRetention(makeRetention());
    const second = service.classifyRetention(makeRetention());
    expect(first.dataset).toBe(second.dataset);
    expect(first.level).toBe(second.level);
    expect(first.retentionDays).toBe(second.retentionDays);
    expect(first.holdSupport).toBe(second.holdSupport);
  });

  it('produces identical disclosure classifications for identical inputs', () => {
    const { service } = makeService();
    const first = service.classifyDisclosure(
      'amountMinor',
      ExternalDataHandlingLevel.CONFIDENTIAL,
      ExternalDisclosureAudience.SUPPORT,
    );
    const second = service.classifyDisclosure(
      'amountMinor',
      ExternalDataHandlingLevel.CONFIDENTIAL,
      ExternalDisclosureAudience.SUPPORT,
    );
    expect(first.audience).toBe(second.audience);
    expect(first.fields).toEqual(second.fields);
    expect(first.maskedFields).toEqual(second.maskedFields);
  });
});

describe('ExternalDataMinimizationService — audit evidence', () => {
  it('records a CLASSIFICATION_RECORDED audit event', async () => {
    const { service, audit } = makeService();
    await service.recordClassification(makeClassificationEntry(), REQUEST_CONTEXT);
    const event = audit.events.find(
      (event) => event.action === ExternalDataControlAction.CLASSIFICATION_RECORDED,
    );
    expect(event).toBeDefined();
    expect(event?.entityType).toBe(EXTERNAL_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE);
    expect(event?.actor).toBe(REQUEST_CONTEXT.actor);
  });

  it('records a CONSENT_RECORDED audit event', async () => {
    const { service, audit } = makeService();
    await service.recordConsent(makeConsent(), REQUEST_CONTEXT);
    const event = audit.events.find(
      (event) => event.action === ExternalDataControlAction.CONSENT_RECORDED,
    );
    expect(event).toBeDefined();
    expect(event?.entityType).toBe(EXTERNAL_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE);
  });

  it('records a RETENTION_RECORDED audit event', async () => {
    const { service, audit } = makeService();
    await service.recordRetention(makeRetention(), REQUEST_CONTEXT);
    const event = audit.events.find(
      (event) => event.action === ExternalDataControlAction.RETENTION_RECORDED,
    );
    expect(event).toBeDefined();
  });

  it('records a HOLD_IMPOSED audit event', async () => {
    const { service, audit } = makeService();
    await service.imposeLegalHold(makeLegalHold(), REQUEST_CONTEXT);
    const event = audit.events.find(
      (event) => event.action === ExternalDataControlAction.HOLD_IMPOSED,
    );
    expect(event).toBeDefined();
  });

  it('records a HOLD_RELEASED audit event', async () => {
    const { service, legalHold, audit } = makeService();
    await service.imposeLegalHold(makeLegalHold(), REQUEST_CONTEXT);
    const entity = [...legalHold.records.values()][0]!;
    await service.releaseLegalHold(entity.id, 'releaser-test', REQUEST_CONTEXT);
    const event = audit.events.find(
      (event) => event.action === ExternalDataControlAction.HOLD_RELEASED,
    );
    expect(event).toBeDefined();
  });

  it('records a SECRET_CLASSIFICATION_RECORDED audit event', async () => {
    const { service, audit } = makeService();
    await service.recordSecret(makeSecret(), REQUEST_CONTEXT);
    const event = audit.events.find(
      (event) => event.action === ExternalDataControlAction.SECRET_CLASSIFICATION_RECORDED,
    );
    expect(event).toBeDefined();
    expect(event?.newValues['secretStored']).toBe(false);
  });

  it('records a DISCLOSED audit event when projecting a disclosure', async () => {
    const { service, audit } = makeService();
    await service.projectDisclosure(
      {
        viewId: 'view-1',
        externalOperationId: REFERENCE_ID,
        audience: ExternalDisclosureAudience.SUPPORT,
        fields: { amountMinor: '1000' },
        maskedFields: [],
        generatedAt: new Date(),
      },
      ExternalDisclosureAudience.SUPPORT,
      REQUEST_CONTEXT,
    );
    const event = audit.events.find(
      (event) => event.action === ExternalDataControlAction.DISCLOSED,
    );
    expect(event).toBeDefined();
  });
});

describe('ExternalDataMinimizationService — read-only behavior', () => {
  it('uses a serializable/committed transaction for write operations', async () => {
    const { service, dataSource } = makeService();
    await service.recordClassification(makeClassificationEntry(), REQUEST_CONTEXT);
    const isolations = dataSource.getIsolationCaptures();
    expect(isolations.length).toBeGreaterThan(0);
    for (const isolation of isolations) {
      expect(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']).toContain(isolation);
    }
  });

  it('never mutates source data classification or external records', () => {
    const { service, classification } = makeService();
    const initialCount = classification.records.size;
    service.classifyField(makeClassificationEntry());
    service.classifyField(makeClassificationEntry({ fieldName: 'amountMinor' }));
    expect(classification.records.size).toBe(initialCount);
  });
});

describe('ExternalDataMinimizationService — contract metadata', () => {
  it('exposes contract name and version', () => {
    const { service } = makeService();
    expect(service.contractName()).toBe('A6-EXTERNAL-DATA-MINIMIZATION');
    expect(service.contractVersion()).toBe(1);
  });

  it('exposes audience maximums per audience', () => {
    const { service } = makeService();
    expect(service.audienceMaximumLevel(ExternalDisclosureAudience.SUPPORT)).toBe(
      ExternalDataHandlingLevel.CONFIDENTIAL,
    );
    expect(service.audienceMaximumLevel(ExternalDisclosureAudience.SECURITY)).toBe(
      ExternalDataHandlingLevel.HIGHLY_RESTRICTED,
    );
  });

  it('exposes static retention constants', () => {
    expect(ExternalDataMinimizationService.DEFAULT_RETENTION_DAYS).toBe(
      EXTERNAL_DATA_MINIMIZATION_DEFAULT_RETENTION_DAYS,
    );
    expect(ExternalDataMinimizationService.DISCLOSURE_RETENTION_DAYS).toBe(
      EXTERNAL_DATA_MINIMIZATION_DISCLOSURE_RETENTION_DAYS,
    );
    expect(ExternalDataMinimizationService.SUPPORT_TRACE_RETENTION_DAYS).toBe(
      EXTERNAL_DATA_MINIMIZATION_SUPPORT_TRACE_RETENTION_DAYS,
    );
  });
});

void asExtError;
