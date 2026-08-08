import { createHash, randomUUID } from 'node:crypto';

import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { OutboxService } from '../operations/outbox.service';
import { SettlementAccountRole } from '../payment/payment.enums';
import { SettlementAccountService } from '../payment/settlement-account.service';
import type { RequestContext } from '../production/request-context';
import { ExternalOperation } from './external-operation.entity';
import { ExternalOperationLifecycleState } from './external-operation-lifecycle.enums';
import { ExternalOperationReferenceSource } from './external-operation.enums';
import { ExternalOperationService } from './external-operation.service';
import { ExternalSettlement } from './external-settlement.entity';
import {
  ExternalSettlementDecision,
  ExternalSettlementStatus,
  ExternalSuspenseStatus,
  EXTERNAL_SETTLEMENT_SUSPENSE_REASONS,
  type ExternalSettlementRejectionCode,
  type ExternalSettlementSuspenseReason,
} from './external-settlement.enums';
import type {
  ExternalSettlementCompensatingResult,
  ExternalSettlementEvidence,
  ExternalSettlementResult,
  ExternalSettlementView,
  ExternalSuspenseEntryView,
  RecordCompensatingEntryCommand,
  SettleVerifiedOutcomeCommand,
  SuspenseVerifiedOutcomeCommand,
} from './external-settlement.types';
import {
  EXTERNAL_COMPENSATING_IDEMPOTENCY_SCOPE,
  EXTERNAL_SETTLEMENT_ACCOUNTING_UNIT,
  EXTERNAL_SETTLEMENT_IDEMPOTENCY_SCOPE,
  EXTERNAL_SETTLEMENT_INTERNAL_COMMAND_ACTOR,
  EXTERNAL_SETTLEMENT_OWNER,
  EXTERNAL_SETTLEMENT_OWNER_PRINCIPAL,
  EXTERNAL_SETTLEMENT_RETENTION_SECONDS,
  ExternalSettlementException,
} from './external-settlement.types';
import { ExternalSuspenseEntry } from './external-suspense-entry.entity';
import { PartnerConnectionService } from './partner-connection.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TEXT_PATTERN = /^[\x20-\x7E]+$/;
const SETTLEMENT_KEY_PATTERN = /^a6-settlement:[a-f0-9]{64}$/;
const COMPENSATING_KEY_PATTERN = /^a6-compensating:[a-f0-9]{64}$/;
const EVIDENCE_REFERENCE_TYPES = new Set(['OPERATION', 'TRANSACTION', 'SETTLEMENT']);
const EVIDENCE_SOURCES = new Set([
  'ACKNOWLEDGEMENT',
  'STATUS_QUERY',
  'CALLBACK',
  'STATEMENT',
  'REPORT',
]);
const NAMESPACE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/;
const OWNER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/;
const OUTBOX_SETTLEMENT_EVENT = 'A6_EXTERNAL_SETTLEMENT_POSTED';
const OUTBOX_COMPENSATING_EVENT = 'A6_EXTERNAL_SETTLEMENT_COMPENSATED';
const OUTBOX_SUSPENSE_EVENT = 'A6_EXTERNAL_SETTLEMENT_SUSPENSE';

type EvidenceType = 'OPERATION' | 'TRANSACTION' | 'SETTLEMENT';

interface NormalizedSettleCommand {
  externalOperationId: string;
  expectedVersion: number;
  decision: ExternalSettlementDecision;
  requestContext: RequestContext;
  evidence: NormalizedEvidence;
  ownerPrincipal: string;
  requestHash: string;
  settlementKey: string;
  evidenceHash: string;
}

interface NormalizedEvidence {
  referenceType: EvidenceType;
  referenceValue: string;
  namespace: string;
  source: ExternalOperationReferenceSource;
  observedAt: Date;
  hash: string;
}

interface NormalizedSuspenseCommand {
  externalOperationId: string;
  expectedVersion: number;
  reason: ExternalSettlementSuspenseReason;
  rejectionCode: ExternalSettlementRejectionCode;
  requestContext: RequestContext;
  evidence: NormalizedEvidence;
  owner: string;
  ownerPrincipal: string;
  requestHash: string;
}

interface NormalizedCompensatingCommand {
  externalOperationId: string;
  settlementId: string;
  suspenseEntryId: string;
  expectedVersion: number;
  requestContext: RequestContext;
  reason: string;
  requestHash: string;
  compensatingKey: string;
}

@Injectable()
export class ExternalSettlementService {
  constructor(
    @InjectRepository(ExternalSettlement)
    private readonly settlementRepository: Repository<ExternalSettlement>,
    @InjectRepository(ExternalSuspenseEntry)
    private readonly suspenseRepository: Repository<ExternalSuspenseEntry>,
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly settlementAccountService: SettlementAccountService,
    private readonly externalOperationService: ExternalOperationService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly partnerConnectionService: PartnerConnectionService,
    @Optional() private readonly outboxService?: OutboxService,
  ) {}

  async settleVerifiedOutcome(
    command: SettleVerifiedOutcomeCommand,
  ): Promise<ExternalSettlementResult> {
    const normalized = this.normalizeSettleCommand(command);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.settleWithinTransaction(manager, normalized),
    );
  }

  async recordSuspense(
    command: SuspenseVerifiedOutcomeCommand,
  ): Promise<ExternalSuspenseEntryView> {
    const normalized = this.normalizeSuspenseCommand(command);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.recordSuspenseWithinTransaction(manager, normalized),
    );
  }

  async recordCompensatingEntry(
    command: RecordCompensatingEntryCommand,
  ): Promise<ExternalSettlementCompensatingResult> {
    const normalized = this.normalizeCompensatingCommand(command);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.compensateWithinTransaction(manager, normalized),
    );
  }

  async getByOperation(externalOperationId: string): Promise<ExternalSettlementView | null> {
    const id = this.normalizeUuid(externalOperationId, 'externalOperationId');
    const settlement = await this.settlementRepository.findOne({
      where: { externalOperationId: id },
    });
    return settlement ? this.toSettlementView(settlement, false) : null;
  }

  async getSuspenseForOperation(externalOperationId: string): Promise<ExternalSuspenseEntryView[]> {
    const id = this.normalizeUuid(externalOperationId, 'externalOperationId');
    const entries = await this.suspenseRepository.find({
      where: { externalOperationId: id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return entries.map((entry) => this.toSuspenseView(entry));
  }

  private async settleWithinTransaction(
    manager: EntityManager,
    command: NormalizedSettleCommand,
  ): Promise<ExternalSettlementResult> {
    this.assertPartnerEnabled();

    const reservation = await this.idempotencyService.reserve(manager, {
      scope: EXTERNAL_SETTLEMENT_IDEMPOTENCY_SCOPE,
      key: command.settlementKey,
      requestHash: command.requestHash,
      retentionSeconds: EXTERNAL_SETTLEMENT_RETENTION_SECONDS,
    });
    if (reservation.kind === 'IN_PROGRESS') {
      throw new ExternalSettlementException(
        'SETTLEMENT_IDEMPOTENCY_IN_PROGRESS',
        'A settlement request for this verified outcome is already in progress',
      );
    }
    if (reservation.kind === 'REPLAY') {
      const existing = await this.findSettlementByIdempotency(manager, command.settlementKey);
      if (!existing) {
        throw new ExternalSettlementException(
          'LEDGER_REPLAY_CONFLICT',
          'The settlement replay evidence is incomplete',
        );
      }
      return {
        decision: existing.decision,
        settlement: this.toSettlementView(existing, true),
        suspense: null,
        replayed: true,
      };
    }

    const operation = await this.lockOperation(manager, command.externalOperationId);
    if (!operation) {
      await this.completeFailedIdempotency(manager, reservation.record.id, command, {
        code: 'EXTERNAL_OPERATION_NOT_FOUND',
      });
      throw new ExternalSettlementException(
        'EXTERNAL_OPERATION_NOT_FOUND',
        `External operation ${command.externalOperationId} was not found`,
      );
    }
    if (operation.version !== command.expectedVersion) {
      await this.completeFailedIdempotency(manager, reservation.record.id, command, {
        code: 'STALE_OPERATION_VERSION',
      });
      throw new ExternalSettlementException(
        'STALE_OPERATION_VERSION',
        'The external operation version is stale',
      );
    }
    if (
      operation.lifecycleState === ExternalOperationLifecycleState.FAILED ||
      operation.lifecycleState === ExternalOperationLifecycleState.CANCELLED
    ) {
      await this.completeFailedIdempotency(manager, reservation.record.id, command, {
        code: 'INVALID_SETTLEMENT_STATE',
      });
      throw new ExternalSettlementException(
        'INVALID_SETTLEMENT_STATE',
        `Cannot settle an external operation in state ${operation.lifecycleState}`,
      );
    }
    if (operation.lifecycleState !== ExternalOperationLifecycleState.PENDING_VERIFICATION) {
      await this.completeFailedIdempotency(manager, reservation.record.id, command, {
        code: 'INVALID_SETTLEMENT_STATE',
      });
      throw new ExternalSettlementException(
        'INVALID_SETTLEMENT_STATE',
        `Settlement requires a verified PENDING_VERIFICATION state, received ${operation.lifecycleState}`,
      );
    }

    const existingSettlement = await manager
      .getRepository(ExternalSettlement)
      .createQueryBuilder('settlement')
      .where('settlement.external_operation_id = :id', { id: command.externalOperationId })
      .setLock('pessimistic_write')
      .getOne();
    if (existingSettlement) {
      await this.completeFailedIdempotency(manager, reservation.record.id, command, {
        code: 'DUPLICATE_SETTLEMENT',
      });
      throw new ExternalSettlementException(
        'DUPLICATE_SETTLEMENT',
        'The external operation already has a settlement record',
      );
    }

    const evidence = await this.resolveEvidence(manager, command.evidence);
    if (!evidence) {
      const settlement = await this.persistSettlementRow(manager, {
        command,
        operation,
        evidenceHash: command.evidenceHash,
        evidence: command.evidence,
        journalId: null,
        postedAt: null,
        decision: ExternalSettlementDecision.REJECT,
      });
      const suspense = await this.persistSuspense(manager, command, {
        operation,
        reason: 'EVIDENCE_REFERENCE_MISSING',
        rejectionCode: 'EVIDENCE_REFERENCE_MISSING',
        status: ExternalSuspenseStatus.OPEN,
      });
      await this.linkSuspenseToSettlement(manager, settlement.settlementId, suspense.suspenseId);
      await this.completeFailedIdempotency(manager, reservation.record.id, command, {
        code: 'EVIDENCE_REFERENCE_MISSING',
        suspenseId: suspense.suspenseId,
      });
      await this.auditSettlement(manager, {
        action: 'SUSPENSE_RECORDED',
        entityId: suspense.suspenseId,
        requestContext: command.requestContext,
        settlement,
        suspense,
        failureCode: 'EVIDENCE_REFERENCE_MISSING',
        newValues: {
          externalOperationId: command.externalOperationId,
          reason: suspense.reason,
          rejectionCode: suspense.rejectionCode,
          owner: suspense.owner,
          ownerPrincipal: suspense.ownerPrincipal,
          evidenceHash: suspense.evidenceHash,
          lifecycleState: suspense.lifecycleState,
        },
      });
      await this.recordOutboxFact({
        manager,
        eventType: OUTBOX_SUSPENSE_EVENT,
        aggregateId: suspense.suspenseId,
        payload: {
          suspenseId: suspense.suspenseId,
          externalOperationId: suspense.externalOperationId,
          reason: suspense.reason,
          rejectionCode: suspense.rejectionCode,
          amountMinor: suspense.amountMinor,
          currency: suspense.currency,
          accountingUnit: suspense.accountingUnit,
          owner: suspense.owner,
          ownerPrincipal: suspense.ownerPrincipal,
        },
        correlationId: command.requestContext.correlationId,
        requestContext: command.requestContext,
      });
      return {
        decision: settlement.decision,
        settlement,
        suspense,
        replayed: false,
      };
    }

    if (command.decision === ExternalSettlementDecision.SETTLE) {
      const settlement = await this.postSettlementJournal(
        manager,
        reservation.record.id,
        command,
        operation,
        command.evidenceHash,
      );
      await this.auditSettlement(manager, {
        action: 'SETTLEMENT_POSTED',
        entityId: settlement.settlementId,
        requestContext: command.requestContext,
        settlement,
        newValues: {
          externalOperationId: settlement.externalOperationId,
          decision: settlement.decision,
          status: settlement.status,
          amountMinor: settlement.amountMinor,
          currency: settlement.currency,
          accountingUnit: settlement.accountingUnit,
          journalId: settlement.journalId,
          customerLedgerAccountId: settlement.customerLedgerAccountId,
          settlementAssetLedgerAccountId: settlement.settlementAssetLedgerAccountId,
          evidenceHash: settlement.evidence.evidenceHash,
          evidenceType: settlement.evidence.referenceType,
          evidenceSource: settlement.evidence.source,
        },
      });
      await this.recordOutboxFact({
        manager,
        eventType: OUTBOX_SETTLEMENT_EVENT,
        aggregateId: settlement.settlementId,
        payload: {
          settlementId: settlement.settlementId,
          externalOperationId: settlement.externalOperationId,
          externalOperationReference: settlement.externalOperationReference,
          journalId: settlement.journalId,
          amountMinor: settlement.amountMinor,
          currency: settlement.currency,
          accountingUnit: settlement.accountingUnit,
          partnerKey: settlement.partnerKey,
          capabilityKey: settlement.capabilityKey,
        },
        correlationId: command.requestContext.correlationId,
        requestContext: command.requestContext,
      });
      await this.idempotencyService.complete(manager, reservation.record.id, {
        statusCode: 201,
        responseBody: settlement as unknown as Record<string, unknown>,
        resourceType: 'EXTERNAL_SETTLEMENT',
        resourceId: settlement.settlementId,
      });
      return {
        decision: settlement.decision,
        settlement,
        suspense: null,
        replayed: false,
      };
    }

    const settlement = await this.persistSettlementRow(manager, {
      command,
      operation,
      evidenceHash: command.evidenceHash,
      evidence: command.evidence,
      journalId: null,
      postedAt: null,
      decision: ExternalSettlementDecision.REJECT,
    });
    const suspense = await this.persistSuspense(manager, command, {
      operation,
      reason: 'INVALID_SETTLEMENT_STATE',
      rejectionCode: 'INVALID_SETTLEMENT_STATE',
      status: ExternalSuspenseStatus.HELD,
    });
    await this.linkSuspenseToSettlement(manager, settlement.settlementId, suspense.suspenseId);
    await this.auditSettlement(manager, {
      action: 'SETTLEMENT_REJECTED',
      entityId: settlement.settlementId,
      requestContext: command.requestContext,
      settlement,
      suspense,
      failureCode: 'INVALID_SETTLEMENT_STATE',
      newValues: {
        externalOperationId: settlement.externalOperationId,
        decision: settlement.decision,
        status: settlement.status,
        suspenseReason: suspense.reason,
        suspenseOwner: suspense.owner,
      },
    });
    await this.recordOutboxFact({
      manager,
      eventType: OUTBOX_SUSPENSE_EVENT,
      aggregateId: suspense.suspenseId,
      payload: {
        suspenseId: suspense.suspenseId,
        externalOperationId: suspense.externalOperationId,
        reason: suspense.reason,
        rejectionCode: suspense.rejectionCode,
        amountMinor: suspense.amountMinor,
        currency: suspense.currency,
        accountingUnit: suspense.accountingUnit,
        owner: suspense.owner,
        ownerPrincipal: suspense.ownerPrincipal,
      },
      correlationId: command.requestContext.correlationId,
      requestContext: command.requestContext,
    });
    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 409,
      responseBody: {
        settlement: settlement as unknown as Record<string, unknown>,
        suspense: suspense as unknown as Record<string, unknown>,
      },
      resourceType: 'EXTERNAL_SETTLEMENT',
      resourceId: settlement.settlementId,
    });
    return {
      decision: settlement.decision,
      settlement,
      suspense,
      replayed: false,
    };
  }

  private async recordSuspenseWithinTransaction(
    manager: EntityManager,
    command: NormalizedSuspenseCommand,
  ): Promise<ExternalSuspenseEntryView> {
    const operation = await this.lockOperation(manager, command.externalOperationId);
    if (!operation) {
      throw new ExternalSettlementException(
        'EXTERNAL_OPERATION_NOT_FOUND',
        `External operation ${command.externalOperationId} was not found`,
      );
    }
    if (operation.version !== command.expectedVersion) {
      throw new ExternalSettlementException(
        'STALE_OPERATION_VERSION',
        'The external operation version is stale',
      );
    }
    const entry = manager.getRepository(ExternalSuspenseEntry).create({
      id: randomUUID(),
      externalOperationId: operation.id,
      externalOperationReference: this.externalOperationReference(operation.id),
      customerId: operation.customerId,
      amountMinor: operation.amountMinor,
      currency: operation.currency,
      accountingUnit: operation.accountingUnit,
      reason: command.reason,
      status: ExternalSuspenseStatus.OPEN,
      owner: command.owner,
      ownerPrincipal: command.ownerPrincipal,
      evidenceHash: command.evidence.hash,
      lifecycleState: operation.lifecycleState,
      rejectionCode: command.rejectionCode,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      reversalJournalId: null,
      settlementId: null,
      clearedAt: null,
    });
    const saved = await manager.getRepository(ExternalSuspenseEntry).save(entry);
    const view = this.toSuspenseView(saved);
    await this.auditService.record(manager, {
      entityType: 'A6_EXTERNAL_SUSPENSE',
      entityId: view.suspenseId,
      action: 'SUSPENSE_RECORDED',
      actor: EXTERNAL_SETTLEMENT_INTERNAL_COMMAND_ACTOR,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      newValues: {
        externalOperationId: view.externalOperationId,
        amountMinor: view.amountMinor,
        currency: view.currency,
        accountingUnit: view.accountingUnit,
        reason: view.reason,
        rejectionCode: view.rejectionCode,
        owner: view.owner,
        ownerPrincipal: view.ownerPrincipal,
        evidenceHash: view.evidenceHash,
        lifecycleState: view.lifecycleState,
      },
    });
    await this.recordOutboxFact({
      manager,
      eventType: OUTBOX_SUSPENSE_EVENT,
      aggregateId: view.suspenseId,
      payload: {
        suspenseId: view.suspenseId,
        externalOperationId: view.externalOperationId,
        reason: view.reason,
        rejectionCode: view.rejectionCode,
        amountMinor: view.amountMinor,
        currency: view.currency,
        accountingUnit: view.accountingUnit,
        owner: view.owner,
        ownerPrincipal: view.ownerPrincipal,
      },
      correlationId: command.requestContext.correlationId,
      requestContext: command.requestContext,
    });
    return view;
  }

  private async compensateWithinTransaction(
    manager: EntityManager,
    command: NormalizedCompensatingCommand,
  ): Promise<ExternalSettlementCompensatingResult> {
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: EXTERNAL_COMPENSATING_IDEMPOTENCY_SCOPE,
      key: command.compensatingKey,
      requestHash: command.requestHash,
      retentionSeconds: EXTERNAL_SETTLEMENT_RETENTION_SECONDS,
    });
    if (reservation.kind === 'IN_PROGRESS') {
      throw new ExternalSettlementException(
        'COMPENSATING_NOT_PERMITTED',
        'A compensating entry for this settlement is already in progress',
      );
    }
    if (reservation.kind === 'REPLAY') {
      const settlement = await manager
        .getRepository(ExternalSettlement)
        .findOne({ where: { id: command.settlementId } });
      const suspense = await manager
        .getRepository(ExternalSuspenseEntry)
        .findOne({ where: { id: command.suspenseEntryId } });
      if (!settlement || !settlement.reversalJournalId || !suspense) {
        throw new ExternalSettlementException(
          'COMPENSATING_DUPLICATE',
          'The compensating replay evidence is incomplete',
        );
      }
      return {
        settlement: this.toSettlementView(settlement, true),
        suspense: this.toSuspenseView(suspense),
        reversalJournalId: settlement.reversalJournalId,
        replayed: true,
      };
    }

    const operation = await this.lockOperation(manager, command.externalOperationId);
    if (!operation) {
      await this.completeFailedCompensatingIdempotency(manager, reservation.record.id, command);
      throw new ExternalSettlementException(
        'EXTERNAL_OPERATION_NOT_FOUND',
        `External operation ${command.externalOperationId} was not found`,
      );
    }
    if (operation.version !== command.expectedVersion) {
      await this.completeFailedCompensatingIdempotency(manager, reservation.record.id, command);
      throw new ExternalSettlementException(
        'STALE_OPERATION_VERSION',
        'The external operation version is stale',
      );
    }

    const settlement = await manager
      .getRepository(ExternalSettlement)
      .createQueryBuilder('settlement')
      .where('settlement.id = :id', { id: command.settlementId })
      .setLock('pessimistic_write')
      .getOne();
    if (!settlement) {
      await this.completeFailedCompensatingIdempotency(manager, reservation.record.id, command);
      throw new ExternalSettlementException(
        'COMPENSATING_REVERSAL_NOT_FOUND',
        'The original settlement could not be found',
      );
    }
    if (settlement.status === ExternalSettlementStatus.REVERSED) {
      await this.completeFailedCompensatingIdempotency(manager, reservation.record.id, command);
      throw new ExternalSettlementException(
        'COMPENSATING_ALREADY_RECORDED',
        'The settlement has already been reversed',
      );
    }
    if (!settlement.journalId) {
      await this.completeFailedCompensatingIdempotency(manager, reservation.record.id, command);
      throw new ExternalSettlementException(
        'COMPENSATING_NOT_PERMITTED',
        'The original settlement has no journal to reverse',
      );
    }

    const suspense = await manager
      .getRepository(ExternalSuspenseEntry)
      .createQueryBuilder('suspense')
      .where('suspense.id = :id', { id: command.suspenseEntryId })
      .setLock('pessimistic_write')
      .getOne();
    if (!suspense) {
      await this.completeFailedCompensatingIdempotency(manager, reservation.record.id, command);
      throw new ExternalSettlementException(
        'COMPENSATING_SUSPENSE_NOT_FOUND',
        'The suspense entry for the compensating reversal was not found',
      );
    }
    if (
      suspense.status !== ExternalSuspenseStatus.OPEN &&
      suspense.status !== ExternalSuspenseStatus.HELD
    ) {
      await this.completeFailedCompensatingIdempotency(manager, reservation.record.id, command);
      throw new ExternalSettlementException(
        'SUSPENSE_NOT_OPEN',
        'The suspense entry is not eligible for compensating reversal',
      );
    }
    if (suspense.reversalJournalId) {
      await this.completeFailedCompensatingIdempotency(manager, reservation.record.id, command);
      throw new ExternalSettlementException(
        'SUSPENSE_REVERSAL_ALREADY_RECORDED',
        'The suspense entry has already been reversed',
      );
    }

    const originalJournal = await this.ledgerService.getJournal(settlement.journalId);
    const reversalLines = originalJournal.lines.map((line) => ({
      accountId: line.accountId,
      direction:
        line.direction === LedgerEntryDirection.DEBIT
          ? LedgerEntryDirection.CREDIT
          : LedgerEntryDirection.DEBIT,
      amountMinor: line.amountMinor,
    }));
    const reversalJournalId = await this.ledgerService.postJournalInTransaction(manager, {
      idempotencyKey: command.compensatingKey,
      currency: originalJournal.currency,
      accountingUnit: originalJournal.accountingUnit,
      reference: originalJournal.reference ?? undefined,
      description: command.reason ? command.reason : `Reversal of settlement ${settlement.id}`,
      correlationId: command.requestContext.correlationId,
      metadata: {
        ...originalJournal.metadata,
        settlementId: settlement.id,
        externalOperationId: settlement.externalOperationId,
        suspenseEntryId: suspense.id,
        originalJournalId: originalJournal.id,
        compensatingEntry: true,
      },
      reversalOfJournalId: originalJournal.id,
      lines: reversalLines,
    });

    settlement.reversalJournalId = reversalJournalId;
    settlement.reversalPostedAt = new Date();
    settlement.status = ExternalSettlementStatus.REVERSED;
    settlement.lifecycleState = 'COMPENSATED';
    await manager.getRepository(ExternalSettlement).save(settlement);

    suspense.reversalJournalId = reversalJournalId;
    suspense.settlementId = settlement.id;
    suspense.status = ExternalSuspenseStatus.CLEARED;
    suspense.clearedAt = new Date();
    await manager.getRepository(ExternalSuspenseEntry).save(suspense);

    const settlementView = this.toSettlementView(settlement, false);
    const suspenseView = this.toSuspenseView(suspense);

    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 200,
      responseBody: {
        settlement: settlementView as unknown as Record<string, unknown>,
        suspense: suspenseView as unknown as Record<string, unknown>,
        reversalJournalId,
      },
      resourceType: 'EXTERNAL_SETTLEMENT',
      resourceId: settlement.id,
    });

    await this.auditSettlement(manager, {
      action: 'COMPENSATING_POSTED',
      entityId: settlement.id,
      requestContext: command.requestContext,
      settlement: settlementView,
      suspense: suspenseView,
      newValues: {
        externalOperationId: settlement.externalOperationId,
        originalJournalId: originalJournal.id,
        reversalJournalId,
        settlementStatus: settlement.status,
        suspenseStatus: suspense.status,
      },
    });

    await this.recordOutboxFact({
      manager,
      eventType: OUTBOX_COMPENSATING_EVENT,
      aggregateId: settlement.id,
      payload: {
        settlementId: settlement.id,
        externalOperationId: settlement.externalOperationId,
        externalOperationReference: settlement.externalOperationReference,
        originalJournalId: originalJournal.id,
        reversalJournalId,
        suspenseEntryId: suspense.id,
      },
      correlationId: command.requestContext.correlationId,
      requestContext: command.requestContext,
    });

    return {
      settlement: settlementView,
      suspense: suspenseView,
      reversalJournalId,
      replayed: false,
    };
  }

  private async postSettlementJournal(
    manager: EntityManager,
    idempotencyRecordId: string,
    command: NormalizedSettleCommand,
    operation: ExternalOperation,
    evidenceHash: string,
  ): Promise<ExternalSettlementView> {
    let settlementAssetAccountId: string;
    try {
      settlementAssetAccountId = await this.settlementAccountService.getAccountId(
        manager,
        operation.currency,
        SettlementAccountRole.SETTLEMENT_ASSET,
      );
    } catch (error) {
      await this.completeFailedIdempotency(manager, idempotencyRecordId, command, {
        code: 'SETTLEMENT_ACCOUNT_UNAVAILABLE',
        error,
      });
      throw new ExternalSettlementException(
        'SETTLEMENT_ACCOUNT_UNAVAILABLE',
        error instanceof Error ? error.message : 'The settlement asset account is not configured',
      );
    }

    let journalId: string;
    try {
      journalId = await this.ledgerService.postJournalInTransaction(manager, {
        idempotencyKey: command.settlementKey,
        currency: operation.currency,
        accountingUnit: operation.accountingUnit,
        reference: operation.id,
        description: `a6-settlement:${operation.partnerKey}:${operation.capabilityKey}:${operation.operationType}`,
        correlationId: command.requestContext.correlationId,
        metadata: {
          externalOperationId: operation.id,
          externalOperationReference: this.externalOperationReference(operation.id),
          partnerKey: operation.partnerKey,
          capabilityKey: operation.capabilityKey,
          operationType: operation.operationType,
          verifiedProviderReferenceHash: evidenceHash,
          verifiedProviderReferenceType: command.evidence.referenceType,
          verifiedProviderReferenceValue: command.evidence.referenceValue,
          verifiedProviderReferenceNamespace: command.evidence.namespace,
          verifiedProviderSource: command.evidence.source,
        },
        lines: [
          {
            accountId: operation.ledgerAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: operation.amountMinor,
          },
          {
            accountId: settlementAssetAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: operation.amountMinor,
          },
        ],
      });
    } catch (error) {
      const code = this.ledgerFailureCode(error);
      await this.completeFailedIdempotency(manager, idempotencyRecordId, command, {
        code,
        error,
      });
      throw error instanceof ExternalSettlementException
        ? error
        : new ExternalSettlementException(
            code,
            error instanceof Error ? error.message : 'The settlement journal could not be posted',
          );
    }

    return this.persistSettlementRow(manager, {
      command,
      operation,
      evidenceHash,
      evidence: command.evidence,
      journalId,
      postedAt: new Date(),
      decision: ExternalSettlementDecision.SETTLE,
      settlementAssetAccountId,
    });
  }

  private async persistSettlementRow(
    manager: EntityManager,
    input: {
      command: NormalizedSettleCommand;
      operation: ExternalOperation;
      evidenceHash: string;
      evidence: ExternalSettlementEvidence;
      journalId: string | null;
      postedAt: Date | null;
      decision: ExternalSettlementDecision;
      settlementAssetAccountId?: string;
    },
  ): Promise<ExternalSettlementView> {
    let settlementAssetAccountId = input.settlementAssetAccountId;
    if (!settlementAssetAccountId) {
      try {
        settlementAssetAccountId = await this.settlementAccountService.getAccountId(
          manager,
          input.operation.currency,
          SettlementAccountRole.SETTLEMENT_ASSET,
        );
      } catch {
        throw new ExternalSettlementException(
          'SETTLEMENT_ACCOUNT_UNAVAILABLE',
          'The settlement asset account is not configured',
        );
      }
    }

    const settlement = manager.getRepository(ExternalSettlement).create({
      id: randomUUID(),
      externalOperationId: input.operation.id,
      externalOperationReference: this.externalOperationReference(input.operation.id),
      partnerKey: input.operation.partnerKey,
      capabilityKey: input.operation.capabilityKey,
      operationType: input.operation.operationType,
      customerId: input.operation.customerId,
      walletAccountId: input.operation.walletAccountId,
      customerLedgerAccountId: input.operation.ledgerAccountId,
      settlementAssetLedgerAccountId: settlementAssetAccountId,
      decision: input.decision,
      status: ExternalSettlementStatus.POSTED,
      amountMinor: input.operation.amountMinor,
      currency: input.operation.currency,
      accountingUnit: input.operation.accountingUnit,
      lifecycleState: input.decision === ExternalSettlementDecision.SETTLE ? 'SETTLED' : 'REJECTED',
      journalId: input.journalId,
      reversalJournalId: null,
      evidenceType: input.evidence.referenceType,
      evidenceValue: input.evidence.referenceValue,
      evidenceNamespace: input.evidence.namespace,
      evidenceSource: input.evidence.source,
      evidenceHash: input.evidenceHash,
      idempotencyScope: EXTERNAL_SETTLEMENT_IDEMPOTENCY_SCOPE,
      idempotencyKey: input.command.settlementKey,
      requestHash: input.command.requestHash,
      correlationId: input.command.requestContext.correlationId,
      requestId: input.command.requestContext.requestId,
      ownerPrincipal: input.command.ownerPrincipal,
      postedAt: input.postedAt,
      reversalPostedAt: null,
    });
    try {
      const saved = await manager.getRepository(ExternalSettlement).save(settlement);
      return this.toSettlementView(saved, false);
    } catch (error) {
      if (this.isUniqueViolation(error, 'uq_external_settlements_operation_id')) {
        throw new ExternalSettlementException(
          'DUPLICATE_SETTLEMENT',
          'The external operation already has a settlement record',
        );
      }
      if (this.isUniqueViolation(error, 'uq_external_settlements_idempotency')) {
        throw new ExternalSettlementException(
          'SETTLEMENT_IDEMPOTENCY_CONFLICT',
          'The settlement idempotency key was already used for another settlement',
        );
      }
      if (this.isUniqueViolation(error, 'uq_external_settlements_journal_id') && input.journalId) {
        throw new ExternalSettlementException(
          'LEDGER_REPLAY_CONFLICT',
          'The journal is already linked to another settlement',
        );
      }
      throw error;
    }
  }

  private async persistSuspense(
    manager: EntityManager,
    command: NormalizedSettleCommand,
    input: {
      operation: ExternalOperation;
      reason: ExternalSettlementSuspenseReason;
      rejectionCode: ExternalSettlementRejectionCode;
      status: ExternalSuspenseStatus;
    },
  ): Promise<ExternalSuspenseEntryView> {
    const entry = manager.getRepository(ExternalSuspenseEntry).create({
      id: randomUUID(),
      externalOperationId: input.operation.id,
      externalOperationReference: this.externalOperationReference(input.operation.id),
      customerId: input.operation.customerId,
      amountMinor: input.operation.amountMinor,
      currency: input.operation.currency,
      accountingUnit: input.operation.accountingUnit,
      reason: input.reason,
      status: input.status,
      owner: EXTERNAL_SETTLEMENT_OWNER,
      ownerPrincipal: command.ownerPrincipal,
      evidenceHash: command.evidence.hash,
      lifecycleState: input.operation.lifecycleState,
      rejectionCode: input.rejectionCode,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      reversalJournalId: null,
      settlementId: null,
      clearedAt: null,
    });
    const saved = await manager.getRepository(ExternalSuspenseEntry).save(entry);
    return this.toSuspenseView(saved);
  }

  private async linkSuspenseToSettlement(
    manager: EntityManager,
    settlementId: string,
    suspenseId: string,
  ): Promise<void> {
    void suspenseId;
    const repository = manager.getRepository(ExternalSettlement);
    const settlement = await repository.findOne({ where: { id: settlementId } });
    if (!settlement) {
      return;
    }
    settlement.lifecycleState = 'REJECTED';
    await repository.save(settlement);
  }

  private async findSettlementByIdempotency(
    manager: EntityManager,
    settlementKey: string,
  ): Promise<ExternalSettlement | null> {
    return manager
      .getRepository(ExternalSettlement)
      .createQueryBuilder('settlement')
      .where('settlement.idempotency_scope = :scope', {
        scope: EXTERNAL_SETTLEMENT_IDEMPOTENCY_SCOPE,
      })
      .andWhere('settlement.idempotency_key = :key', { key: settlementKey })
      .getOne();
  }

  private async lockOperation(
    manager: EntityManager,
    externalOperationId: string,
  ): Promise<ExternalOperation | null> {
    return manager
      .getRepository(ExternalOperation)
      .createQueryBuilder('operation')
      .where('operation.id = :id', { id: externalOperationId })
      .setLock('pessimistic_write')
      .getOne();
  }

  private async resolveEvidence(
    manager: EntityManager,
    evidence: NormalizedEvidence,
  ): Promise<{ evidenceHash: string } | null> {
    const operationId = await this.lookupOperationId(manager, evidence);
    if (!operationId) {
      return null;
    }
    try {
      await this.externalOperationService.getInTransaction(manager, operationId);
    } catch {
      return null;
    }
    return { evidenceHash: evidence.hash };
  }

  private async lookupOperationId(
    manager: EntityManager,
    evidence: NormalizedEvidence,
  ): Promise<string | null> {
    const rows: Array<{ external_operation_id: string }> = await manager.query(
      `SELECT external_operation_id
         FROM external_operation_references
        WHERE partner_key = 'NIBSS_NIP'
          AND reference_type = $1
          AND reference_value = $2
          AND namespace = $3
        LIMIT 1`,
      [evidence.referenceType, evidence.referenceValue, evidence.namespace],
    );
    return rows[0]?.external_operation_id ?? null;
  }

  private async completeFailedIdempotency(
    manager: EntityManager,
    recordId: string,
    command: NormalizedSettleCommand,
    details: {
      code: ExternalSettlementRejectionCode;
      error?: unknown;
      suspenseId?: string;
    },
  ): Promise<void> {
    await this.idempotencyService.fail(manager, recordId, {
      statusCode: 409,
      responseBody: {
        failureCode: details.code,
        message: details.error instanceof Error ? details.error.message : details.code,
        externalOperationId: command.externalOperationId,
        requestHash: command.requestHash,
        ...(details.suspenseId ? { suspenseId: details.suspenseId } : {}),
      },
      resourceType: 'EXTERNAL_SETTLEMENT',
      resourceId: command.externalOperationId,
    });
  }

  private async completeFailedCompensatingIdempotency(
    manager: EntityManager,
    recordId: string,
    command: NormalizedCompensatingCommand,
  ): Promise<void> {
    await this.idempotencyService.fail(manager, recordId, {
      statusCode: 409,
      responseBody: {
        externalOperationId: command.externalOperationId,
        settlementId: command.settlementId,
        suspenseEntryId: command.suspenseEntryId,
      },
      resourceType: 'EXTERNAL_SETTLEMENT',
      resourceId: command.settlementId,
    });
  }

  private assertPartnerEnabled(): void {
    const profile = this.partnerConnectionService.getProfile();
    if (!profile.enabled) {
      throw new ExternalSettlementException(
        'PARTNER_DISABLED',
        'The A6 external partner capability is disabled',
      );
    }
  }

  private ledgerFailureCode(error: unknown): ExternalSettlementRejectionCode {
    if (error instanceof ExternalSettlementException) {
      return error.code;
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('insufficient')) return 'LEDGER_BALANCE_INSUFFICIENT';
      if (message.includes('inactive')) return 'LEDGER_ACCOUNT_INACTIVE';
      if (message.includes('currency')) return 'LEDGER_ACCOUNT_CURRENCY_MISMATCH';
      if (message.includes('accounting unit') || message.includes('accounting_unit'))
        return 'LEDGER_ACCOUNT_UNIT_MISMATCH';
    }
    return 'LEDGER_REPLAY_CONFLICT';
  }

  private isUniqueViolation(error: unknown, constraintName: string): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string; constraint?: string };
    return driverError.code === '23505' && driverError.constraint === constraintName;
  }

  private async recordOutboxFact(input: {
    manager: EntityManager;
    eventType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    correlationId: string;
    requestContext: RequestContext;
  }): Promise<void> {
    if (!this.outboxService) {
      return;
    }
    await this.outboxService.enqueue(input.manager, {
      eventType: input.eventType,
      aggregateType: 'A6_EXTERNAL_SETTLEMENT',
      aggregateId: input.aggregateId,
      payload: input.payload,
      eventKey: `${input.eventType}:${input.aggregateId}`,
      schemaVersion: 1,
      classification: 'CONFIDENTIAL',
      retentionClass: 'FINANCIAL_CONTROL',
      correlationId: input.correlationId,
      causationId: input.requestContext.requestId,
    });
  }

  private async auditSettlement(
    manager: EntityManager,
    input: {
      action:
        | 'SETTLEMENT_POSTED'
        | 'SETTLEMENT_REPLAYED'
        | 'SETTLEMENT_REJECTED'
        | 'SUSPENSE_RECORDED'
        | 'COMPENSATING_POSTED'
        | 'COMPENSATING_REPLAYED'
        | 'COMPENSATING_REJECTED'
        | 'SETTLEMENT_DISABLED';
      entityId: string;
      requestContext: RequestContext;
      settlement?: ExternalSettlementView;
      suspense?: ExternalSuspenseEntryView;
      failureCode?: string;
      previousValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
    },
  ): Promise<void> {
    const newValues: Record<string, unknown> = { ...(input.newValues ?? {}) };
    if (input.settlement) {
      newValues.settlement = {
        settlementId: input.settlement.settlementId,
        externalOperationId: input.settlement.externalOperationId,
        decision: input.settlement.decision,
        status: input.settlement.status,
        amountMinor: input.settlement.amountMinor,
        currency: input.settlement.currency,
        accountingUnit: input.settlement.accountingUnit,
        journalId: input.settlement.journalId,
        reversalJournalId: input.settlement.reversalJournalId,
        postedAt: input.settlement.postedAt,
        evidenceHash: input.settlement.evidence.evidenceHash,
        evidenceType: input.settlement.evidence.referenceType,
        evidenceSource: input.settlement.evidence.source,
        idempotencyKey: input.settlement.idempotencyKey,
        replayed: input.settlement.replayed,
      };
    }
    if (input.suspense) {
      newValues.suspense = {
        suspenseId: input.suspense.suspenseId,
        externalOperationId: input.suspense.externalOperationId,
        reason: input.suspense.reason,
        rejectionCode: input.suspense.rejectionCode,
        owner: input.suspense.owner,
        ownerPrincipal: input.suspense.ownerPrincipal,
        evidenceHash: input.suspense.evidenceHash,
        status: input.suspense.status,
      };
    }
    if (input.failureCode) {
      newValues.failureCode = input.failureCode;
    }
    await this.auditService.record(manager, {
      entityType: 'A6_EXTERNAL_SETTLEMENT',
      entityId: input.entityId,
      action: input.action,
      actor: EXTERNAL_SETTLEMENT_INTERNAL_COMMAND_ACTOR,
      correlationId: input.requestContext.correlationId,
      requestId: input.requestContext.requestId,
      previousValues: input.previousValues,
      newValues,
    });
  }

  private normalizeSettleCommand(command: SettleVerifiedOutcomeCommand): NormalizedSettleCommand {
    const externalOperationId = this.normalizeUuid(
      command.externalOperationId,
      'externalOperationId',
    );
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw new ExternalSettlementException(
        'STALE_OPERATION_VERSION',
        'expectedVersion must be a positive integer',
      );
    }
    if (
      command.decision !== ExternalSettlementDecision.SETTLE &&
      command.decision !== ExternalSettlementDecision.REJECT
    ) {
      throw new ExternalSettlementException(
        'INVALID_SETTLEMENT_STATE',
        'decision must be SETTLE or REJECT',
      );
    }
    const evidence = this.normalizeEvidence(command.evidence);
    const ownerPrincipal = this.normalizeText(
      command.ownerPrincipal ?? EXTERNAL_SETTLEMENT_OWNER_PRINCIPAL,
      'ownerPrincipal',
      160,
    );
    const requestContext = this.normalizeRequestContext(command.requestContext);
    const requestHash = this.computeSettleRequestHash({
      externalOperationId,
      decision: command.decision,
      expectedVersion: command.expectedVersion,
      evidence,
      requestContext,
    });
    const settlementKey = this.settlementKey(
      externalOperationId,
      evidence.hash,
      command.decision,
      ExternalOperationLifecycleState.PENDING_VERIFICATION,
    );
    return {
      externalOperationId,
      expectedVersion: command.expectedVersion,
      decision: command.decision,
      requestContext,
      evidence,
      ownerPrincipal,
      requestHash,
      settlementKey,
      evidenceHash: evidence.hash,
    };
  }

  private normalizeSuspenseCommand(
    command: SuspenseVerifiedOutcomeCommand,
  ): NormalizedSuspenseCommand {
    const externalOperationId = this.normalizeUuid(
      command.externalOperationId,
      'externalOperationId',
    );
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw new ExternalSettlementException(
        'STALE_OPERATION_VERSION',
        'expectedVersion must be a positive integer',
      );
    }
    if (!EXTERNAL_SETTLEMENT_SUSPENSE_REASONS.includes(command.reason as never)) {
      throw new ExternalSettlementException(
        'SUSPENSE_REASON_INVALID',
        `The suspense reason is invalid: ${command.reason}`,
      );
    }
    if (!command.rejectionCode) {
      throw new ExternalSettlementException('SUSPENSE_REASON_INVALID', 'rejectionCode is required');
    }
    const evidence = this.normalizeEvidence(command.evidence);
    const owner = this.normalizeOwner(command.owner ?? EXTERNAL_SETTLEMENT_OWNER);
    const ownerPrincipal = this.normalizeText(
      command.ownerPrincipal ?? EXTERNAL_SETTLEMENT_OWNER_PRINCIPAL,
      'ownerPrincipal',
      160,
    );
    const requestContext = this.normalizeRequestContext(command.requestContext);
    const requestHash = this.computeSuspenseRequestHash({
      externalOperationId,
      reason: command.reason,
      rejectionCode: command.rejectionCode,
      expectedVersion: command.expectedVersion,
      evidence,
      requestContext,
    });
    return {
      externalOperationId,
      expectedVersion: command.expectedVersion,
      reason: command.reason as ExternalSettlementSuspenseReason,
      rejectionCode: command.rejectionCode,
      requestContext,
      evidence,
      owner,
      ownerPrincipal,
      requestHash,
    };
  }

  private normalizeCompensatingCommand(
    command: RecordCompensatingEntryCommand,
  ): NormalizedCompensatingCommand {
    const externalOperationId = this.normalizeUuid(
      command.externalOperationId,
      'externalOperationId',
    );
    const settlementId = this.normalizeUuid(command.settlementId, 'settlementId');
    const suspenseEntryId = this.normalizeUuid(command.suspenseEntryId, 'suspenseEntryId');
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw new ExternalSettlementException(
        'STALE_OPERATION_VERSION',
        'expectedVersion must be a positive integer',
      );
    }
    const requestContext = this.normalizeRequestContext(command.requestContext);
    const reason = command.reason ? this.normalizeText(command.reason, 'reason', 255) : '';
    const requestHash = this.computeCompensatingRequestHash({
      externalOperationId,
      settlementId,
      suspenseEntryId,
      expectedVersion: command.expectedVersion,
      reason,
    });
    const compensatingKey = this.compensatingKey(settlementId, suspenseEntryId);
    return {
      externalOperationId,
      settlementId,
      suspenseEntryId,
      expectedVersion: command.expectedVersion,
      requestContext,
      reason,
      requestHash,
      compensatingKey,
    };
  }

  private normalizeEvidence(evidence: ExternalSettlementEvidence): NormalizedEvidence {
    if (!evidence || typeof evidence !== 'object') {
      throw new ExternalSettlementException('EVIDENCE_REFERENCE_MISSING', 'evidence is required');
    }
    if (!EVIDENCE_REFERENCE_TYPES.has(evidence.referenceType)) {
      throw new ExternalSettlementException(
        'EVIDENCE_REFERENCE_MISSING',
        'evidence.referenceType is invalid',
      );
    }
    if (!EVIDENCE_SOURCES.has(evidence.source)) {
      throw new ExternalSettlementException(
        'EVIDENCE_REFERENCE_MISSING',
        'evidence.source is invalid',
      );
    }
    const referenceValue = this.normalizeText(
      evidence.referenceValue,
      'evidence.referenceValue',
      255,
    );
    const namespace = this.normalizeText(evidence.namespace, 'evidence.namespace', 120);
    if (!NAMESPACE_PATTERN.test(namespace)) {
      throw new ExternalSettlementException(
        'EVIDENCE_REFERENCE_MISSING',
        'evidence.namespace is invalid',
      );
    }
    const observedAt = this.normalizeTimestamp(evidence.observedAt);
    const hash = this.sha256(referenceValue);
    return {
      referenceType: evidence.referenceType as EvidenceType,
      referenceValue,
      namespace,
      source: evidence.source,
      observedAt,
      hash,
    };
  }

  private normalizeRequestContext(context: RequestContext): RequestContext {
    return {
      requestId: this.normalizeText(context.requestId, 'requestId', 255),
      correlationId: this.normalizeText(context.correlationId, 'correlationId', 255),
      traceId: this.normalizeText(context.traceId, 'traceId', 255),
    };
  }

  private normalizeUuid(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new ExternalSettlementException('SETTLEMENT_KEY_INVALID', `${field} is invalid`);
    }
    return normalized;
  }

  private normalizeText(value: string, field: string, maxLength = 255): string {
    const normalized = (value ?? '').trim();
    if (!normalized || normalized.length > maxLength || !SAFE_TEXT_PATTERN.test(normalized)) {
      throw new ExternalSettlementException('SETTLEMENT_KEY_INVALID', `${field} is invalid`);
    }
    return normalized;
  }

  private normalizeOwner(value: string): string {
    const normalized = value.trim();
    if (!OWNER_PATTERN.test(normalized)) {
      throw new ExternalSettlementException('SUSPENSE_OWNER_REQUIRED', 'owner is invalid');
    }
    return normalized;
  }

  private normalizeTimestamp(value: string | Date | undefined): Date {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? new Date() : value;
    }
    const parsed = new Date(value ?? new Date().toISOString());
    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }
    return parsed;
  }

  private computeSettleRequestHash(input: {
    externalOperationId: string;
    decision: ExternalSettlementDecision;
    expectedVersion: number;
    evidence: NormalizedEvidence;
    requestContext: RequestContext;
  }): string {
    return this.sha256(
      this.canonicalJson({
        externalOperationId: input.externalOperationId,
        decision: input.decision,
        expectedVersion: input.expectedVersion,
        evidence: {
          referenceType: input.evidence.referenceType,
          referenceValue: input.evidence.referenceValue,
          namespace: input.evidence.namespace,
          source: input.evidence.source,
          hash: input.evidence.hash,
        },
        requestContext: input.requestContext,
      }),
    );
  }

  private computeSuspenseRequestHash(input: {
    externalOperationId: string;
    reason: string;
    rejectionCode: string;
    expectedVersion: number;
    evidence: NormalizedEvidence;
    requestContext: RequestContext;
  }): string {
    return this.sha256(
      this.canonicalJson({
        externalOperationId: input.externalOperationId,
        reason: input.reason,
        rejectionCode: input.rejectionCode,
        expectedVersion: input.expectedVersion,
        evidence: {
          referenceType: input.evidence.referenceType,
          referenceValue: input.evidence.referenceValue,
          namespace: input.evidence.namespace,
          source: input.evidence.source,
          hash: input.evidence.hash,
        },
        requestContext: input.requestContext,
      }),
    );
  }

  private computeCompensatingRequestHash(input: {
    externalOperationId: string;
    settlementId: string;
    suspenseEntryId: string;
    expectedVersion: number;
    reason: string;
  }): string {
    return this.sha256(
      this.canonicalJson({
        externalOperationId: input.externalOperationId,
        settlementId: input.settlementId,
        suspenseEntryId: input.suspenseEntryId,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }),
    );
  }

  private settlementKey(
    externalOperationId: string,
    evidenceHash: string,
    decision: ExternalSettlementDecision,
    lifecycleState: string,
  ): string {
    const suffix = this.sha256(
      `${externalOperationId}:${evidenceHash}:${decision}:${lifecycleState}`,
    );
    const key = `a6-settlement:${suffix}`;
    if (!SETTLEMENT_KEY_PATTERN.test(key)) {
      throw new ExternalSettlementException(
        'SETTLEMENT_KEY_INVALID',
        'The settlement key is invalid',
      );
    }
    return key;
  }

  private compensatingKey(settlementId: string, suspenseEntryId: string): string {
    const suffix = this.sha256(`${settlementId}:${suspenseEntryId}`);
    const key = `a6-compensating:${suffix}`;
    if (!COMPENSATING_KEY_PATTERN.test(key)) {
      throw new ExternalSettlementException(
        'COMPENSATING_NOT_PERMITTED',
        'The compensating key is invalid',
      );
    }
    return key;
  }

  private externalOperationReference(externalOperationId: string): string {
    return `external-operation:v1:${this.sha256(
      `NIBSS_NIP:${externalOperationId}:external-operation`,
    )}`;
  }

  private toSettlementView(
    settlement: ExternalSettlement,
    replayed: boolean,
  ): ExternalSettlementView {
    return {
      settlementVersion: 1,
      settlementId: settlement.id,
      externalOperationId: settlement.externalOperationId,
      externalOperationReference: settlement.externalOperationReference,
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      customerId: settlement.customerId,
      walletAccountId: settlement.walletAccountId,
      customerLedgerAccountId: settlement.customerLedgerAccountId,
      settlementAssetLedgerAccountId: settlement.settlementAssetLedgerAccountId,
      decision: settlement.decision,
      status: settlement.status,
      amountMinor: settlement.amountMinor.toString(),
      currency: settlement.currency,
      accountingUnit: EXTERNAL_SETTLEMENT_ACCOUNTING_UNIT,
      lifecycleState: settlement.lifecycleState,
      journalId: settlement.journalId,
      reversalJournalId: settlement.reversalJournalId,
      evidence: {
        referenceType: settlement.evidenceType as EvidenceType,
        referenceValue: settlement.evidenceValue,
        namespace: settlement.evidenceNamespace,
        source: settlement.evidenceSource as ExternalOperationReferenceSource,
        observedAt: new Date(0),
        evidenceHash: settlement.evidenceHash,
      },
      idempotencyScope: settlement.idempotencyScope,
      idempotencyKey: settlement.idempotencyKey,
      requestHash: settlement.requestHash,
      correlationId: settlement.correlationId,
      requestId: settlement.requestId,
      ownerPrincipal: settlement.ownerPrincipal,
      postedAt: settlement.postedAt,
      reversalPostedAt: settlement.reversalPostedAt,
      createdAt: settlement.createdAt,
      updatedAt: settlement.updatedAt,
      replayed,
    };
  }

  private toSuspenseView(entry: ExternalSuspenseEntry): ExternalSuspenseEntryView {
    return {
      suspenseId: entry.id,
      externalOperationId: entry.externalOperationId,
      externalOperationReference: entry.externalOperationReference,
      customerId: entry.customerId,
      amountMinor: entry.amountMinor.toString(),
      currency: entry.currency,
      accountingUnit: entry.accountingUnit,
      reason: entry.reason,
      status: entry.status,
      owner: entry.owner,
      ownerPrincipal: entry.ownerPrincipal,
      evidenceHash: entry.evidenceHash,
      lifecycleState: entry.lifecycleState,
      rejectionCode: entry.rejectionCode,
      correlationId: entry.correlationId,
      requestId: entry.requestId,
      reversalJournalId: entry.reversalJournalId,
      settlementId: entry.settlementId,
      clearedAt: entry.clearedAt,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`)
      .join(',')}}`;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
