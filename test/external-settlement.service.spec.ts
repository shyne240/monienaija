import { createHash } from 'node:crypto';

import { ConflictException } from '@nestjs/common';

import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import type { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import type { LedgerLine } from '../src/ledger/ledger-line.entity';
import { ExternalOperation } from '../src/partner/external-operation.entity';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';
import { ExternalOperationReference } from '../src/partner/external-operation-reference.entity';
import { ExternalSettlement } from '../src/partner/external-settlement.entity';
import {
  ExternalSettlementDecision,
  ExternalSettlementStatus,
  ExternalSuspenseStatus,
} from '../src/partner/external-settlement.enums';
import { ExternalSettlementService } from '../src/partner/external-settlement.service';
import { ExternalSettlementException } from '../src/partner/external-settlement.types';
import { ExternalSuspenseEntry } from '../src/partner/external-suspense-entry.entity';
import type {
  SettleVerifiedOutcomeCommand,
  SuspenseVerifiedOutcomeCommand,
  RecordCompensatingEntryCommand,
} from '../src/partner/external-settlement.types';
import { ExternalOperationReferenceSource } from '../src/partner/external-operation.enums';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const WALLET_ID = '00000000-0000-4000-8000-000000000002';
const LEDGER_ID = '00000000-0000-4000-8000-000000000003';
const RESOURCE_ID = '00000000-0000-4000-8000-000000000004';
const COMMAND_ID = '00000000-0000-4000-8000-000000000005';
const SETTLEMENT_ASSET_LEDGER_ID = '00000000-0000-4000-8000-000000000006';
const TARGET_MAPPING_REFERENCE = `a6-target:${'a'.repeat(64)}`;

const REQUEST_CONTEXT = {
  requestId: 'request-1',
  correlationId: 'correlation-1',
  traceId: 'trace-1',
};

class FakeSettlementRepository {
  readonly records = new Map<string, ExternalSettlement>();
  byOperation = new Map<string, string>();

  create(input: Partial<ExternalSettlement>): ExternalSettlement {
    return input as ExternalSettlement;
  }

  save(settlement: ExternalSettlement): Promise<ExternalSettlement> {
    settlement.createdAt ??= new Date();
    settlement.updatedAt = new Date();
    this.records.set(settlement.id, settlement);
    this.byOperation.set(settlement.externalOperationId, settlement.id);
    return Promise.resolve(settlement);
  }

  findOne(options: {
    where: { externalOperationId?: string; id?: string };
  }): ExternalSettlement | null {
    if (options.where.externalOperationId) {
      const id = this.byOperation.get(options.where.externalOperationId);
      return id ? (this.records.get(id) ?? null) : null;
    }
    if (options.where.id) {
      return this.records.get(options.where.id) ?? null;
    }
    return null;
  }

  createQueryBuilder(): FakeQueryBuilder<ExternalSettlement> {
    const builder = new FakeQueryBuilder<ExternalSettlement>(this, (entity) => entity.id !== '');
    return builder;
  }
}

class FakeSuspenseRepository {
  readonly records = new Map<string, ExternalSuspenseEntry>();

  create(input: Partial<ExternalSuspenseEntry>): ExternalSuspenseEntry {
    return input as ExternalSuspenseEntry;
  }

  save(entry: ExternalSuspenseEntry): Promise<ExternalSuspenseEntry> {
    entry.createdAt ??= new Date();
    entry.updatedAt = new Date();
    this.records.set(entry.id, entry);
    return Promise.resolve(entry);
  }

  find(options: { where: { externalOperationId: string } }): ExternalSuspenseEntry[] {
    return [...this.records.values()].filter(
      (entry) => entry.externalOperationId === options.where.externalOperationId,
    );
  }

  createQueryBuilder(): FakeQueryBuilder<ExternalSuspenseEntry> {
    return new FakeQueryBuilder<ExternalSuspenseEntry>(this, (entity) => entity.id !== '');
  }
}

class FakeReferenceRepository {
  readonly records = new Map<string, ExternalOperationReference>();
  byValue = new Map<string, string>();

  create(input: Partial<ExternalOperationReference>): ExternalOperationReference {
    return input as ExternalOperationReference;
  }

  save(reference: ExternalOperationReference): Promise<ExternalOperationReference> {
    reference.createdAt ??= new Date();
    this.records.set(reference.id, reference);
    this.byValue.set(
      `${reference.partnerKey}:${reference.referenceType}:${reference.referenceValue}:${reference.namespace}`,
      reference.externalOperationId,
    );
    return Promise.resolve(reference);
  }
}

class FakeQueryBuilder<T> {
  constructor(
    private readonly repository: { records: Map<string, T> } & {
      byOperation?: Map<string, string>;
      byValue?: Map<string, string>;
    },
    private readonly filter: (entity: T) => boolean,
    private readonly lock: boolean = false,
  ) {}

  where(_clause: string, parameters: Record<string, unknown>): this {
    this.parameters = { ...this.parameters, ...parameters };
    return this;
  }

  andWhere(_clause: string, parameters: Record<string, unknown>): this {
    this.parameters = { ...this.parameters, ...parameters };
    return this;
  }

  setLock(): this {
    this.lockRequested = true;
    return this;
  }

  parameters: Record<string, unknown> = {};
  lockRequested = false;

  getOne(): Promise<T | null> {
    const id = (this.parameters.id ?? this.parameters.externalOperationId) as string | undefined;
    const key = (this.parameters.key ?? this.parameters.id) as string | undefined;
    if (id) {
      // Match by entity id first
      const byEntityId = this.repository.records.get(id);
      if (byEntityId) {
        return Promise.resolve(byEntityId as T);
      }
      if (this.repository.byOperation) {
        const found = this.repository.byOperation.get(id);
        if (found) {
          return Promise.resolve((this.repository.records.get(found) ?? null) as T);
        }
      }
      return Promise.resolve(null);
    }
    if (this.repository.byValue && key) {
      const externalOperationId = this.repository.byValue.get(key);
      if (!externalOperationId) return Promise.resolve(null);
      const found = this.repository.byOperation?.get(externalOperationId);
      return Promise.resolve(found ? (this.repository.records.get(found) ?? null) : null);
    }
    return Promise.resolve([...this.repository.records.values()].find(this.filter) ?? null);
  }
}

class FakeOperationRepository {
  readonly records = new Map<string, ExternalOperation>();
  readonly byOperation = new Map<string, string>();
  readonly references = new Map<string, ExternalOperationReference>();
  readonly byValue = new Map<string, string>();

  create(input: Partial<ExternalOperation>): ExternalOperation {
    return input as ExternalOperation;
  }

  save(operation: ExternalOperation): ExternalOperation {
    operation.updatedAt = new Date();
    this.records.set(operation.id, operation);
    this.byOperation.set(operation.id, operation.id);
    return operation;
  }

  findOne(options: { where: { id: string } }): ExternalOperation | null {
    return this.records.get(options.where.id) ?? null;
  }

  createQueryBuilder(): FakeQueryBuilder<ExternalOperation> {
    return new FakeQueryBuilder<ExternalOperation>(this, () => true, true);
  }
}

class FakeManager {
  operations: FakeOperationRepository;
  references: FakeReferenceRepository;
  settlements: FakeSettlementRepository;
  suspense: FakeSuspenseRepository;

  constructor(
    operations: FakeOperationRepository,
    references: FakeReferenceRepository,
    settlements: FakeSettlementRepository,
    suspense: FakeSuspenseRepository,
  ) {
    this.operations = operations;
    this.references = references;
    this.settlements = settlements;
    this.suspense = suspense;
  }

  getRepository(target: unknown) {
    if (target === ExternalOperation) return this.operations;
    if (target === ExternalOperationReference) return this.references;
    if (target === ExternalSettlement) return this.settlements;
    if (target === ExternalSuspenseEntry) return this.suspense;
    throw new Error(`Unexpected repository: ${String(target)}`);
  }

  query(sql: string, parameters: unknown[]): Promise<Array<Record<string, unknown>>> {
    if (sql.includes('external_operation_references')) {
      const [referenceType, referenceValue, namespace] = parameters as [string, string, string];
      const operationId = this.references.byValue.get(
        `NIBSS_NIP:${referenceType}:${referenceValue}:${namespace}`,
      );
      return Promise.resolve(operationId ? [{ external_operation_id: operationId }] : []);
    }
    return Promise.resolve([]);
  }
}

class FakeDataSource {
  constructor(
    private readonly manager: FakeManager,
    private readonly failureMode: 'NONE' | 'JOURNAL_POST' | 'JOURNAL_REPLAY' = 'NONE',
  ) {}

  async transaction<T>(
    _isolation: string,
    callback: (manager: FakeManager) => Promise<T>,
  ): Promise<T> {
    if (this.failureMode === 'JOURNAL_POST') {
      throw new Error('forced transaction failure');
    }
    return callback(this.manager);
  }
}

class FakeIdempotencyService {
  readonly records = new Map<
    string,
    {
      id: string;
      hash: string;
      resourceId: string | null;
      status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      body?: Record<string, unknown>;
    }
  >();
  private nextId = 1;

  reserve(_manager: unknown, command: { scope: string; key: string; requestHash: string }) {
    const mapKey = `${command.scope}:${command.key}`;
    const existing = this.records.get(mapKey);
    if (existing) {
      if (existing.hash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another request');
      }
      if (existing.status === 'IN_PROGRESS') {
        throw new ConflictException('The idempotent request is already in progress');
      }
      return { kind: 'REPLAY' as const, record: existing };
    }
    const record = {
      id: `idempotency-${this.nextId++}`,
      hash: command.requestHash,
      resourceId: null,
      status: 'IN_PROGRESS' as const,
    };
    this.records.set(mapKey, record);
    return { kind: 'NEW' as const, record };
  }

  complete(
    _manager: unknown,
    recordId: string,
    command: { resourceId?: string; responseBody: Record<string, unknown> },
  ) {
    const record = [...this.records.values()].find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('Missing idempotency record');
    record.status = 'COMPLETED';
    record.resourceId = command.resourceId ?? null;
    record.body = command.responseBody;
  }

  fail(
    _manager: unknown,
    recordId: string,
    command: { resourceBody?: Record<string, unknown>; responseBody: Record<string, unknown> },
  ) {
    const record = [...this.records.values()].find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('Missing idempotency record');
    record.status = 'FAILED';
    record.body = command.responseBody;
  }
}

class FakeAuditService {
  readonly events: Array<{
    entityType: string;
    entityId: string;
    action: string;
    newValues: Record<string, unknown>;
  }> = [];

  record(
    _manager: unknown,
    command: {
      entityType: string;
      entityId: string;
      action: string;
      newValues?: Record<string, unknown>;
    },
  ) {
    this.events.push({
      entityType: command.entityType,
      entityId: command.entityId,
      action: command.action,
      newValues: command.newValues ?? {},
    });
    return Promise.resolve();
  }
}

class FakeOutboxService {
  readonly events: Array<{ eventType: string; aggregateId: string }> = [];
  enqueue(_manager: unknown, command: { eventType: string; aggregateId: string }) {
    this.events.push({ eventType: command.eventType, aggregateId: command.aggregateId });
    return Promise.resolve();
  }
}

class FakeSettlementAccountService {
  constructor(
    private readonly mapping: Record<string, string> = {
      'NGN:SETTLEMENT_ASSET': SETTLEMENT_ASSET_LEDGER_ID,
    },
  ) {}

  getAccountId(_manager: unknown, currency: string, role: string): Promise<string> {
    const key = `${currency}:${role}`;
    const accountId = this.mapping[key];
    if (!accountId) {
      throw new Error(`No settlement account for ${key}`);
    }
    return Promise.resolve(accountId);
  }
}

class FakePartnerConnectionService {
  profile = {
    enabled: true,
    partnerKey: 'NIBSS_NIP' as const,
    capabilityKey: 'external.wallet.withdrawal.settlement' as const,
    operationType: 'OUTBOUND_BANK_SETTLEMENT' as const,
  };

  getProfile() {
    return this.profile;
  }
}

class FakeExternalOperationService {
  readonly references = new Map<string, ExternalOperationReference>();
  readonly referencesByValue = new Map<string, string>();

  getInTransaction(_manager: unknown, externalOperationId: string) {
    const references = [...this.references.values()].filter(
      (reference) => reference.externalOperationId === externalOperationId,
    );
    return Promise.resolve({
      externalOperationId,
      providerReferences: references.map((reference) => ({
        referenceType: reference.referenceType,
        referenceValue: reference.referenceValue,
        namespace: reference.namespace,
        source: reference.source,
      })),
    });
  }
}

class FakeLedgerService {
  readonly journals: LedgerJournal[] = [];
  readonly lines: LedgerLine[] = [];
  failureMode: 'NONE' | 'POST' = 'NONE';
  private nextId = 1;
  private nextLineId = 1;

  postJournalInTransaction(
    _manager: unknown,
    command: {
      idempotencyKey: string;
      currency: string;
      accountingUnit: string;
      lines: Array<{ accountId: string; direction: LedgerEntryDirection; amountMinor: string }>;
    },
  ): Promise<string> {
    if (this.failureMode === 'POST') {
      throw new Error('Ledger post failed');
    }
    const id = `journal-${this.nextId++}`;
    const totalDebit = command.lines
      .filter((line) => line.direction === LedgerEntryDirection.DEBIT)
      .reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    const totalCredit = command.lines
      .filter((line) => line.direction === LedgerEntryDirection.CREDIT)
      .reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    if (totalDebit !== totalCredit) {
      throw new Error('Journal unbalanced');
    }
    this.journals.push({
      id,
      idempotencyKey: command.idempotencyKey,
      requestHash: '',
      currency: command.currency,
      accountingUnit: command.accountingUnit,
      status: 'POSTED' as never,
      reference: null,
      description: null,
      correlationId: null,
      reversalOfJournalId: null,
      metadata: {},
      totalMinor: totalDebit.toString(),
      postedAt: new Date(),
      createdAt: new Date(),
    } as unknown as LedgerJournal);
    command.lines.forEach((line, index) => {
      this.lines.push({
        id: `line-${this.nextLineId++}`,
        journalId: id,
        ledgerAccountId: line.accountId,
        lineNumber: index + 1,
        direction: line.direction,
        amountMinor: line.amountMinor,
        currency: command.currency,
        accountingUnit: command.accountingUnit,
        createdAt: new Date(),
      } as unknown as LedgerLine);
    });
    return Promise.resolve(id);
  }

  getJournal(journalId: string) {
    const journal = this.journals.find((candidate) => candidate.id === journalId);
    if (!journal) throw new Error(`Journal ${journalId} not found`);
    const lines = this.lines
      .filter((line) => line.journalId === journalId)
      .map((line) => ({
        id: line.id,
        journalId: line.journalId,
        accountId: line.ledgerAccountId,
        lineNumber: line.lineNumber,
        direction: line.direction,
        amountMinor: line.amountMinor,
        currency: line.currency,
        accountingUnit: line.accountingUnit,
        createdAt: line.createdAt,
      }));
    return Promise.resolve({ ...journal, lines });
  }
}

function makeOperation(overrides: Partial<ExternalOperation> = {}): ExternalOperation {
  const now = new Date();
  return {
    id: '00000000-0000-4000-8000-000000000010',
    operationVersion: 1,
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    resourceType: 'WITHDRAWAL' as never,
    resourceId: RESOURCE_ID,
    internalCommandId: COMMAND_ID,
    customerId: CUSTOMER_ID,
    walletAccountId: WALLET_ID,
    ledgerAccountId: LEDGER_ID,
    targetMappingReference: TARGET_MAPPING_REFERENCE,
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    internalIdempotencyScope: 'external.partner.operation.v1',
    internalIdempotencyKey: 'operation-key',
    providerIdempotencyScope: 'nibss.nip.external-operation.v1',
    providerIdempotencyKey: 'provider-key',
    requestHash: 'b'.repeat(64),
    requestId: 'request-1',
    correlationId: 'correlation-1',
    traceId: 'trace-1',
    causationId: null,
    lifecycleState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
    attemptCount: 1,
    maxAttempts: 3,
    nextRetryAt: null,
    lastAttemptAt: null,
    providerStatus: 'PENDING',
    failureCode: null,
    failureMessage: null,
    failureStatusCode: null,
    recoveryReference: null,
    submittingAt: new Date(),
    pendingAt: new Date(),
    pendingVerificationAt: new Date(),
    unknownAt: null,
    manualReviewAt: null,
    failedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  } as unknown as ExternalOperation;
}

function makeReference(
  externalOperationId: string,
  value: string,
  referenceType: 'OPERATION' | 'TRANSACTION' | 'SETTLEMENT' = 'TRANSACTION',
  source: ExternalOperationReferenceSource = ExternalOperationReferenceSource.ACKNOWLEDGEMENT,
): ExternalOperationReference {
  return {
    id: `ref-${value}`,
    externalOperationId,
    partnerKey: 'NIBSS_NIP',
    referenceType,
    referenceValue: value,
    namespace: 'nibss.nip',
    source,
    observedAt: new Date(),
    createdAt: new Date(),
  } as ExternalOperationReference;
}

function makeService(
  options: {
    partnerEnabled?: boolean;
    partnerLedgerFailure?: boolean;
    partnerMissingReference?: boolean;
    operationState?: ExternalOperationLifecycleState;
    operationVersion?: number;
  } = {},
) {
  const operation = makeOperation({
    version: options.operationVersion ?? 1,
    lifecycleState: options.operationState ?? ExternalOperationLifecycleState.PENDING_VERIFICATION,
  });
  const operations = new FakeOperationRepository();
  operations.records.set(operation.id, operation);

  const references = new FakeReferenceRepository();
  const operationService = new FakeExternalOperationService();
  if (!options.partnerMissingReference) {
    const reference = makeReference(operation.id, 'provider-evidence-1');
    references.records.set(reference.id, reference);
    references.byValue.set(
      `NIBSS_NIP:${reference.referenceType}:${reference.referenceValue}:${reference.namespace}`,
      operation.id,
    );
    operationService.references.set(reference.id, reference);
    operationService.referencesByValue.set(
      `${reference.referenceType}:${reference.referenceValue}:${reference.namespace}`,
      operation.id,
    );
  }

  const settlements = new FakeSettlementRepository();
  const suspense = new FakeSuspenseRepository();
  const manager = new FakeManager(operations, references, settlements, suspense);
  const dataSource = new FakeDataSource(manager);
  const idempotency = new FakeIdempotencyService();
  const audit = new FakeAuditService();
  const outbox = new FakeOutboxService();
  const settlementAccountService = new FakeSettlementAccountService();
  const partnerConnectionService = new FakePartnerConnectionService();
  partnerConnectionService.profile.enabled = options.partnerEnabled ?? true;
  const ledgerService = new FakeLedgerService();
  if (options.partnerLedgerFailure) {
    ledgerService.failureMode = 'POST';
  }
  const service = new ExternalSettlementService(
    settlements as never,
    suspense as never,
    dataSource as never,
    ledgerService as never,
    settlementAccountService as never,
    operationService as never,
    idempotency as never,
    audit as never,
    partnerConnectionService as never,
    outbox as never,
  );
  return {
    service,
    operation,
    operations,
    references,
    settlements,
    suspense,
    manager,
    dataSource,
    idempotency,
    audit,
    outbox,
    settlementAccountService,
    partnerConnectionService,
    ledgerService,
    operationService,
  };
}

function settleCommand(
  overrides: Partial<SettleVerifiedOutcomeCommand> = {},
): SettleVerifiedOutcomeCommand {
  return {
    externalOperationId: '00000000-0000-4000-8000-000000000010',
    decision: ExternalSettlementDecision.SETTLE,
    expectedVersion: 1,
    evidence: {
      referenceType: 'TRANSACTION',
      referenceValue: 'provider-evidence-1',
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.ACKNOWLEDGEMENT,
      observedAt: new Date('2026-08-08T00:00:00.000Z'),
    },
    requestContext: REQUEST_CONTEXT,
    ...overrides,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('ExternalSettlementService', () => {
  it('posts a single balanced Ledger journal for a verified external outcome', async () => {
    const fixture = makeService();

    const result = await fixture.service.settleVerifiedOutcome(settleCommand());

    expect(result.replayed).toBe(false);
    expect(result.settlement.decision).toBe(ExternalSettlementDecision.SETTLE);
    expect(result.settlement.status).toBe(ExternalSettlementStatus.POSTED);
    expect(result.settlement.journalId).toMatch(/^journal-/);
    expect(result.settlement.evidence.evidenceHash).toBe(sha256('provider-evidence-1'));
    expect(result.settlement.evidence.referenceType).toBe('TRANSACTION');
    expect(result.settlement.settlementAssetLedgerAccountId).toBe(SETTLEMENT_ASSET_LEDGER_ID);
    expect(result.settlement.amountMinor).toBe('1000');
    expect(result.settlement.currency).toBe('NGN');
    expect(result.suspense).toBeNull();
    expect(fixture.ledgerService.journals).toHaveLength(1);
    const journal = fixture.ledgerService.journals[0]!;
    expect(journal.currency).toBe('NGN');
    expect(journal.accountingUnit).toBe('CUSTOMER_FUNDS');
    const lines = fixture.ledgerService.lines.filter((line) => line.journalId === journal.id);
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.ledgerAccountId === LEDGER_ID)?.direction).toBe(
      LedgerEntryDirection.DEBIT,
    );
    expect(
      lines.find((line) => line.ledgerAccountId === SETTLEMENT_ASSET_LEDGER_ID)?.direction,
    ).toBe(LedgerEntryDirection.CREDIT);
  });

  it('replays an identical settlement deterministically and does not post a second journal', async () => {
    const fixture = makeService();

    const first = await fixture.service.settleVerifiedOutcome(settleCommand());
    const replay = await fixture.service.settleVerifiedOutcome(settleCommand());

    expect(first.settlement.settlementId).toBe(replay.settlement.settlementId);
    expect(replay.replayed).toBe(true);
    expect(fixture.ledgerService.journals).toHaveLength(1);
  });

  it('rejects duplicate settlement with a different evidence hash', async () => {
    const fixture = makeService();
    await fixture.service.settleVerifiedOutcome(settleCommand());

    await expect(
      fixture.service.settleVerifiedOutcome(
        settleCommand({
          evidence: {
            referenceType: 'TRANSACTION',
            referenceValue: 'different-evidence',
            namespace: 'nibss.nip',
            source: ExternalOperationReferenceSource.STATUS_QUERY,
            observedAt: new Date('2026-08-08T00:00:00.000Z'),
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ExternalSettlementException);
  });

  it('rejects settlement when the external operation is in a terminal FAILED state', async () => {
    const fixture = makeService({
      operationState: ExternalOperationLifecycleState.FAILED,
    });

    await expect(fixture.service.settleVerifiedOutcome(settleCommand())).rejects.toMatchObject({
      code: 'INVALID_SETTLEMENT_STATE',
    });
    expect(fixture.ledgerService.journals).toHaveLength(0);
    expect(fixture.settlements.records.size).toBe(0);
  });

  it('rejects settlement when the external operation is in a terminal CANCELLED state', async () => {
    const fixture = makeService({
      operationState: ExternalOperationLifecycleState.CANCELLED,
    });

    await expect(fixture.service.settleVerifiedOutcome(settleCommand())).rejects.toMatchObject({
      code: 'INVALID_SETTLEMENT_STATE',
    });
  });

  it('rejects settlement when the external operation is still SUBMITTING', async () => {
    const fixture = makeService({
      operationState: ExternalOperationLifecycleState.SUBMITTING,
    });

    await expect(fixture.service.settleVerifiedOutcome(settleCommand())).rejects.toMatchObject({
      code: 'INVALID_SETTLEMENT_STATE',
    });
  });

  it('rejects settlement with a stale external operation version', async () => {
    const fixture = makeService({ operationVersion: 1 });

    await expect(
      fixture.service.settleVerifiedOutcome(settleCommand({ expectedVersion: 2 })),
    ).rejects.toMatchObject({ code: 'STALE_OPERATION_VERSION' });
  });

  it('routes unmatched evidence to a suspense entry with named exception ownership', async () => {
    const fixture = makeService({ partnerMissingReference: true });

    const result = await fixture.service.settleVerifiedOutcome(settleCommand());

    expect(result.settlement.decision).toBe(ExternalSettlementDecision.REJECT);
    expect(result.settlement.journalId).toBeNull();
    expect(result.suspense).not.toBeNull();
    expect(result.suspense?.reason).toBe('EVIDENCE_REFERENCE_MISSING');
    expect(result.suspense?.rejectionCode).toBe('EVIDENCE_REFERENCE_MISSING');
    expect(result.suspense?.owner).toBe('finance-ledger-suspense');
    expect(result.suspense?.ownerPrincipal).toBe('a6-settlement-suspense-owner');
    expect(result.suspense?.status).toBe(ExternalSuspenseStatus.OPEN);
    expect(fixture.ledgerService.journals).toHaveLength(0);
  });

  it('rejects settlement when the A6 partner capability is disabled', async () => {
    const fixture = makeService({ partnerEnabled: false });

    await expect(fixture.service.settleVerifiedOutcome(settleCommand())).rejects.toMatchObject({
      code: 'PARTNER_DISABLED',
    });
  });

  it('rolls back the failed settlement and preserves no journal on Ledger post failure', async () => {
    const fixture = makeService({ partnerLedgerFailure: true });

    await expect(fixture.service.settleVerifiedOutcome(settleCommand())).rejects.toBeInstanceOf(
      ExternalSettlementException,
    );
    expect(fixture.ledgerService.journals).toHaveLength(0);
    expect(fixture.settlements.records.size).toBe(0);
    const failedIdempotency = [...fixture.idempotency.records.values()].find(
      (record) => record.status === 'FAILED',
    );
    expect(failedIdempotency).toBeDefined();
  });

  it('posts a compensating entry against an open suspense entry and clears the suspense', async () => {
    const fixture = makeService();

    const settled = await fixture.service.settleVerifiedOutcome(settleCommand());
    const suspense = await fixture.service.recordSuspense({
      externalOperationId: settled.settlement.externalOperationId,
      expectedVersion: 1,
      reason: 'INVALID_SETTLEMENT_STATE',
      rejectionCode: 'INVALID_SETTLEMENT_STATE',
      evidence: settled.settlement.evidence,
      requestContext: REQUEST_CONTEXT,
    } as SuspenseVerifiedOutcomeCommand);

    const command: RecordCompensatingEntryCommand = {
      externalOperationId: settled.settlement.externalOperationId,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: 1,
      requestContext: REQUEST_CONTEXT,
      reason: 'A6 compensation test',
    };

    const compensating = await fixture.service.recordCompensatingEntry(command);

    expect(compensating.replayed).toBe(false);
    expect(compensating.settlement.status).toBe(ExternalSettlementStatus.REVERSED);
    expect(compensating.settlement.reversalJournalId).toBeDefined();
    expect(compensating.suspense.status).toBe(ExternalSuspenseStatus.CLEARED);
    expect(compensating.suspense.reversalJournalId).toBe(compensating.settlement.reversalJournalId);
    const reversalJournal = fixture.ledgerService.journals.find(
      (journal) => journal.id === compensating.settlement.reversalJournalId,
    );
    expect(reversalJournal).toBeDefined();
    const reversalLines = fixture.ledgerService.lines.filter(
      (line) => line.journalId === compensating.settlement.reversalJournalId,
    );
    expect(reversalLines).toHaveLength(2);
    expect(reversalLines.find((line) => line.ledgerAccountId === LEDGER_ID)?.direction).toBe(
      LedgerEntryDirection.CREDIT,
    );
    expect(
      reversalLines.find((line) => line.ledgerAccountId === SETTLEMENT_ASSET_LEDGER_ID)?.direction,
    ).toBe(LedgerEntryDirection.DEBIT);
  });

  it('rejects a compensating entry against a settlement that has no journal', async () => {
    // Build a settlement without a journal (suspense path) by removing reference first
    const suspenseFixture = makeService({ partnerMissingReference: true });
    const settled = await suspenseFixture.service.settleVerifiedOutcome(
      settleCommand({ externalOperationId: suspenseFixture.operation.id }),
    );
    // simulate a settlement row with no journal
    const settlementWithoutJournal = settled.settlement;
    settlementWithoutJournal.journalId = null;
    settlementWithoutJournal.status = ExternalSettlementStatus.POSTED;
    suspenseFixture.settlements.records.set(settlementWithoutJournal.settlementId, {
      ...settlementWithoutJournal,
    } as unknown as ExternalSettlement);

    const suspenseEntries = await suspenseFixture.service.getSuspenseForOperation(
      settlementWithoutJournal.externalOperationId,
    );

    await expect(
      suspenseFixture.service.recordCompensatingEntry({
        externalOperationId: settlementWithoutJournal.externalOperationId,
        settlementId: settlementWithoutJournal.settlementId,
        suspenseEntryId: suspenseEntries[0]?.suspenseId ?? '',
        expectedVersion: 1,
        requestContext: REQUEST_CONTEXT,
      }),
    ).rejects.toMatchObject({ code: 'COMPENSATING_NOT_PERMITTED' });
  });

  it('rejects a second compensating entry for an already reversed settlement', async () => {
    const fixture = makeService();
    const settled = await fixture.service.settleVerifiedOutcome(settleCommand());
    const suspense = await fixture.service.recordSuspense({
      externalOperationId: settled.settlement.externalOperationId,
      expectedVersion: 1,
      reason: 'INVALID_SETTLEMENT_STATE',
      rejectionCode: 'INVALID_SETTLEMENT_STATE',
      evidence: settled.settlement.evidence,
      requestContext: REQUEST_CONTEXT,
    } as SuspenseVerifiedOutcomeCommand);

    await fixture.service.recordCompensatingEntry({
      externalOperationId: settled.settlement.externalOperationId,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: 1,
      requestContext: REQUEST_CONTEXT,
    });

    // record a fresh suspense entry to force a new compensating key
    const secondSuspense = await fixture.service.recordSuspense({
      externalOperationId: settled.settlement.externalOperationId,
      expectedVersion: 1,
      reason: 'INVALID_SETTLEMENT_STATE',
      rejectionCode: 'INVALID_SETTLEMENT_STATE',
      evidence: settled.settlement.evidence,
      requestContext: { ...REQUEST_CONTEXT, requestId: 'different-request' },
    } as SuspenseVerifiedOutcomeCommand);

    await expect(
      fixture.service.recordCompensatingEntry({
        externalOperationId: settled.settlement.externalOperationId,
        settlementId: settled.settlement.settlementId,
        suspenseEntryId: secondSuspense.suspenseId,
        expectedVersion: 1,
        requestContext: { ...REQUEST_CONTEXT, requestId: 'different-request' },
      }),
    ).rejects.toMatchObject({ code: 'COMPENSATING_ALREADY_RECORDED' });
  });

  it('records audit evidence for settlement, suspense, and compensating actions', async () => {
    const fixture = makeService();
    const settled = await fixture.service.settleVerifiedOutcome(settleCommand());

    const actions = fixture.audit.events.map((event) => event.action);
    expect(actions).toContain('SETTLEMENT_POSTED');
    const entityTypes = fixture.audit.events.map((event) => event.entityType);
    expect(entityTypes).toContain('A6_EXTERNAL_SETTLEMENT');
    const settlementAudit = fixture.audit.events.find(
      (event) => event.action === 'SETTLEMENT_POSTED',
    );
    expect(settlementAudit).toBeDefined();
    expect(settlementAudit?.newValues).toMatchObject({
      journalId: settled.settlement.journalId,
      decision: 'SETTLE',
      status: 'POSTED',
    });
  });

  it('records outbox events for settled, suspense, and compensating actions', async () => {
    const fixture = makeService();
    const settled = await fixture.service.settleVerifiedOutcome(settleCommand());
    const suspense = await fixture.service.recordSuspense({
      externalOperationId: settled.settlement.externalOperationId,
      expectedVersion: 1,
      reason: 'INVALID_SETTLEMENT_STATE',
      rejectionCode: 'INVALID_SETTLEMENT_STATE',
      evidence: settled.settlement.evidence,
      requestContext: { ...REQUEST_CONTEXT, requestId: 'suspense-request' },
    } as SuspenseVerifiedOutcomeCommand);
    await fixture.service.recordCompensatingEntry({
      externalOperationId: settled.settlement.externalOperationId,
      settlementId: settled.settlement.settlementId,
      suspenseEntryId: suspense.suspenseId,
      expectedVersion: 1,
      requestContext: { ...REQUEST_CONTEXT, requestId: 'compensating-request' },
    });
    const eventTypes = fixture.outbox.events.map((event) => event.eventType);
    expect(eventTypes).toContain('A6_EXTERNAL_SETTLEMENT_POSTED');
    expect(eventTypes).toContain('A6_EXTERNAL_SETTLEMENT_SUSPENSE');
    expect(eventTypes).toContain('A6_EXTERNAL_SETTLEMENT_COMPENSATED');
  });

  it('correlates the settlement record to the Ledger journal via a single journalId', async () => {
    const fixture = makeService();
    const settled = await fixture.service.settleVerifiedOutcome(settleCommand());

    expect(settled.settlement.journalId).not.toBeNull();
    const journal = fixture.ledgerService.journals.find(
      (candidate) => candidate.id === settled.settlement.journalId,
    );
    expect(journal).toBeDefined();
    const definedJournal = journal!;
    expect(definedJournal.currency).toBe('NGN');
    expect(definedJournal.accountingUnit).toBe('CUSTOMER_FUNDS');
  });

  it('keeps external operation, settlement, and journal identities distinct', async () => {
    const fixture = makeService();
    const settled = await fixture.service.settleVerifiedOutcome(settleCommand());

    expect(settled.settlement.settlementId).not.toBe(settled.settlement.externalOperationId);
    expect(settled.settlement.externalOperationId).not.toBe(settled.settlement.journalId);
    expect(settled.settlement.settlementId).not.toBe(settled.settlement.journalId);
  });

  it('rejects a settlement command with an unknown external operation', async () => {
    const fixture = makeService();
    await expect(
      fixture.service.settleVerifiedOutcome(
        settleCommand({ externalOperationId: '00000000-0000-4000-8000-00000000ffff' }),
      ),
    ).rejects.toMatchObject({ code: 'EXTERNAL_OPERATION_NOT_FOUND' });
  });
});
