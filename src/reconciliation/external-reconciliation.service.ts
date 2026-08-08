import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { ExternalOperation } from '../partner/external-operation.entity';
import { ExternalOperationReferenceType } from '../partner/external-operation.enums';
import { ExternalOperationService } from '../partner/external-operation.service';
import { ExternalSettlementService } from '../partner/external-settlement.service';
import type {
  ExternalSettlementView,
  ExternalSuspenseEntryView,
} from '../partner/external-settlement.types';
import {
  buildExternalReconciliationBatchReport,
  evaluateExternalReconciliation,
} from './external-reconciliation.evaluator';
import type {
  ExternalReconciliationAuditFact,
  ExternalReconciliationBatchReport,
  ExternalReconciliationCallbackFact,
  ExternalReconciliationFacts,
  ExternalReconciliationIdempotencyHint,
  ExternalReconciliationJournalFact,
  ExternalReconciliationJournalLineFact,
  ExternalReconciliationOperationFact,
  ExternalReconciliationOutboxFact,
  ExternalReconciliationReferenceFact,
  ExternalReconciliationReport,
  ExternalReconciliationSettlementFact,
  ExternalReconciliationSuspenseFact,
} from './external-reconciliation.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTLEMENT_IDEMPOTENCY_SCOPE = 'external.partner.settlement.v1';
const OUTBOX_AGGREGATE_TYPE = 'A6_EXTERNAL_SETTLEMENT';
const AUDIT_ENTITY_TYPE = 'A6_EXTERNAL_SETTLEMENT';
const AUDIT_ENTITY_TYPE_SUSPENSE = 'A6_EXTERNAL_SUSPENSE';

type SqlRow = Record<string, unknown>;

@Injectable()
export class ExternalReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly externalOperationService: ExternalOperationService,
    private readonly externalSettlementService: ExternalSettlementService,
  ) {}

  async reconcileOperation(externalOperationId: string): Promise<ExternalReconciliationReport> {
    const normalized = this.normalizeUuid(externalOperationId);
    return this.withReadOnlyTransaction((manager) =>
      this.reconcileWithinTransaction(manager, normalized, new Date().toISOString()),
    );
  }

  async reconcileOperationAt(
    externalOperationId: string,
    generatedAt: string,
  ): Promise<ExternalReconciliationReport> {
    const normalized = this.normalizeUuid(externalOperationId);
    return this.withReadOnlyTransaction((manager) =>
      this.reconcileWithinTransaction(manager, normalized, generatedAt),
    );
  }

  async reconcileAll(): Promise<ExternalReconciliationBatchReport> {
    return this.withReadOnlyTransaction(async (manager) => {
      const rows = await this.queryRows<SqlRow>(
        manager,
        `
          SELECT id::text AS external_operation_id
            FROM external_operations
           ORDER BY created_at, id
        `,
      );
      const generatedAt = new Date().toISOString();
      const reports: ExternalReconciliationReport[] = [];
      for (const row of rows) {
        const id = this.textValue(row.external_operation_id);
        if (id) {
          reports.push(await this.reconcileWithinTransaction(manager, id, generatedAt));
        }
      }
      return buildExternalReconciliationBatchReport(reports, generatedAt);
    });
  }

  private async reconcileWithinTransaction(
    manager: EntityManager,
    externalOperationId: string,
    generatedAt: string,
  ): Promise<ExternalReconciliationReport> {
    const facts = await this.loadFacts(manager, externalOperationId, generatedAt);
    return evaluateExternalReconciliation(facts, generatedAt);
  }

  private async loadFacts(
    manager: EntityManager,
    externalOperationId: string,
    generatedAt: string,
  ): Promise<ExternalReconciliationFacts> {
    const operation = await this.loadOperation(manager, externalOperationId);
    const references = await this.loadReferences(manager, externalOperationId);
    const callbacks = await this.loadCallbacks(manager, externalOperationId);
    const settlement = await this.loadSettlement(externalOperationId);
    const suspenseEntries = await this.loadSuspense(externalOperationId);
    const journal = await this.loadJournal(manager, settlement?.journalId ?? null);
    const journalLines = journal ? await this.loadJournalLines(manager, journal.id) : [];
    const auditEvents = await this.loadAuditEvents(
      manager,
      externalOperationId,
      settlement?.settlementId ?? null,
    );
    const outboxEvents = await this.loadOutboxEvents(
      manager,
      externalOperationId,
      settlement?.settlementId ?? null,
    );
    const idempotencyHints = settlement ? await this.loadIdempotencyHints(manager, settlement) : [];

    return {
      externalOperationId,
      operation: operation ? this.toOperationFact(operation) : null,
      references,
      callbacks,
      settlement: settlement ? this.toSettlementFact(settlement) : null,
      suspenseEntries: suspenseEntries.map((entry) => this.toSuspenseFact(entry, generatedAt)),
      journal,
      journalLines,
      auditEvents,
      outboxEvents,
      idempotencyHints,
    };
  }

  private async loadOperation(
    manager: EntityManager,
    externalOperationId: string,
  ): Promise<ExternalOperation | null> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT id::text AS id,
               operation_version,
               partner_key,
               capability_key,
               operation_type,
               resource_type,
               resource_id::text AS resource_id,
               internal_command_id::text AS internal_command_id,
               customer_id::text AS customer_id,
               wallet_account_id::text AS wallet_account_id,
               ledger_account_id::text AS ledger_account_id,
               target_mapping_reference,
               amount_minor::text AS amount_minor,
               currency,
               accounting_unit,
               internal_idempotency_scope,
               internal_idempotency_key,
               provider_idempotency_scope,
               provider_idempotency_key,
               request_hash,
               request_id,
               correlation_id,
               trace_id,
               causation_id,
               lifecycle_state,
               attempt_count,
               max_attempts,
               next_retry_at,
               last_attempt_at,
               provider_status,
               failure_code,
               failure_message,
               failure_status_code,
               recovery_reference,
               submitting_at,
               pending_at,
               pending_verification_at,
               unknown_at,
               manual_review_at,
               failed_at,
               cancelled_at,
               version,
               created_at,
               updated_at
          FROM external_operations
         WHERE id = $1::uuid
      `,
      [externalOperationId],
    );
    if (rows.length === 0) return null;
    return this.toOperationEntity(rows[0]!);
  }

  private async loadReferences(
    manager: EntityManager,
    externalOperationId: string,
  ): Promise<ExternalReconciliationReferenceFact[]> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT id::text AS id,
               external_operation_id::text AS external_operation_id,
               partner_key,
               reference_type,
               reference_value,
               namespace,
               source,
               observed_at
          FROM external_operation_references
         WHERE external_operation_id = $1::uuid
         ORDER BY created_at, id
      `,
      [externalOperationId],
    );
    return rows.map((row) => this.toReferenceFact(row));
  }

  private async loadCallbacks(
    manager: EntityManager,
    externalOperationId: string,
  ): Promise<ExternalReconciliationCallbackFact[]> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT id::text AS id,
               external_operation_id::text AS external_operation_id,
               partner_key,
               callback_event_id,
               payload_hash,
               signature_hash,
               provider_reference_type,
               provider_reference_value,
               provider_reference_namespace,
               provider_status,
               provider_occurred_at,
               received_at,
               correlation_id,
               status,
               rejection_code
          FROM external_callback_receipts
         WHERE external_operation_id = $1::uuid
            OR correlation_id = $2
         ORDER BY received_at, id
      `,
      [externalOperationId, externalOperationId],
    );
    return rows.map((row) => this.toCallbackFact(row));
  }

  private async loadSettlement(
    externalOperationId: string,
  ): Promise<ExternalSettlementView | null> {
    try {
      return await this.externalSettlementService.getByOperation(externalOperationId);
    } catch {
      return null;
    }
  }

  private async loadSuspense(externalOperationId: string): Promise<ExternalSuspenseEntryView[]> {
    try {
      return await this.externalSettlementService.getSuspenseForOperation(externalOperationId);
    } catch {
      return [];
    }
  }

  private async loadJournal(
    manager: EntityManager,
    journalId: string | null,
  ): Promise<ExternalReconciliationJournalFact | null> {
    if (!journalId) return null;
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT id::text AS id,
               idempotency_key,
               request_hash,
               currency,
               accounting_unit,
               status,
               reference,
               description,
               correlation_id,
               reversal_of_journal_id::text AS reversal_of_journal_id,
               total_minor::text AS total_minor,
               posted_at,
               metadata
          FROM ledger_journals
         WHERE id = $1::uuid
      `,
      [journalId],
    );
    if (rows.length === 0) return null;
    return this.toJournalFact(rows[0]!);
  }

  private async loadJournalLines(
    manager: EntityManager,
    journalId: string,
  ): Promise<ExternalReconciliationJournalLineFact[]> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT id::text AS id,
               journal_id::text AS journal_id,
               ledger_account_id::text AS account_id,
               direction,
               amount_minor::text AS amount_minor,
               currency,
               accounting_unit
          FROM ledger_lines
         WHERE journal_id = $1::uuid
         ORDER BY line_number, id
      `,
      [journalId],
    );
    return rows.map((row) => this.toJournalLineFact(row));
  }

  private async loadAuditEvents(
    manager: EntityManager,
    externalOperationId: string,
    settlementId: string | null,
  ): Promise<ExternalReconciliationAuditFact[]> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT id::text AS id,
               entity_type,
               entity_id::text AS entity_id,
               action,
               correlation_id,
               new_values
          FROM audit_events
         WHERE (entity_type = $1 AND entity_id = $2::uuid)
            OR (entity_type = $3 AND entity_id = $4::uuid)
            OR (entity_type = 'A6_EXTERNAL_OPERATION' AND entity_id = $2::uuid)
         ORDER BY occurred_at, id
      `,
      [
        AUDIT_ENTITY_TYPE,
        settlementId ?? externalOperationId,
        AUDIT_ENTITY_TYPE_SUSPENSE,
        externalOperationId,
      ],
    );
    return rows.map((row) => this.toAuditFact(row));
  }

  private async loadOutboxEvents(
    manager: EntityManager,
    externalOperationId: string,
    settlementId: string | null,
  ): Promise<ExternalReconciliationOutboxFact[]> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT id::text AS id,
               event_type,
               aggregate_type,
               aggregate_id::text AS aggregate_id,
               event_key,
               schema_version,
               correlation_id,
               causation_id,
               payload
          FROM outbox_events
         WHERE (aggregate_type = $1 AND aggregate_id = $2::uuid)
            OR (aggregate_type = $1 AND aggregate_id = $3::uuid)
         ORDER BY created_at, id
      `,
      [OUTBOX_AGGREGATE_TYPE, settlementId ?? externalOperationId, externalOperationId],
    );
    return rows.map((row) => this.toOutboxFact(row));
  }

  private async loadIdempotencyHints(
    manager: EntityManager,
    settlement: ExternalSettlementView,
  ): Promise<ExternalReconciliationIdempotencyHint[]> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT scope,
               idempotency_key AS key,
               status,
               request_hash,
               resource_id::text AS resource_id,
               expires_at
          FROM idempotency_records
         WHERE scope = $1
           AND idempotency_key = $2
         ORDER BY last_seen_at DESC, id DESC
         LIMIT 1
      `,
      [SETTLEMENT_IDEMPOTENCY_SCOPE, settlement.idempotencyKey],
    );
    if (rows.length === 0) {
      return [
        {
          scope: SETTLEMENT_IDEMPOTENCY_SCOPE,
          key: settlement.idempotencyKey,
          status: 'MISSING',
          requestHash: '',
          resourceId: null,
          expiresAt: null,
          match: 'MISSING',
        },
      ];
    }
    const row = rows[0]!;
    const hint: ExternalReconciliationIdempotencyHint = {
      scope: this.textValue(row.scope),
      key: this.textValue(row.key),
      status: this.textValue(row.status),
      requestHash: this.textValue(row.request_hash),
      resourceId: this.nullableText(row.resource_id),
      expiresAt: this.timestampValue(row.expires_at),
      match: 'MATCH',
    };
    if (hint.status === 'IN_PROGRESS') {
      hint.match = 'IN_PROGRESS';
    } else if (hint.expiresAt !== null && hint.expiresAt.getTime() <= Date.now()) {
      hint.match = 'EXPIRED';
    } else if (hint.requestHash.toLowerCase() !== settlement.requestHash.toLowerCase()) {
      hint.match = 'MISMATCH';
    }
    return [hint];
  }

  private toOperationEntity(row: SqlRow): ExternalOperation {
    return {
      id: this.textValue(row.id),
      operationVersion: this.numberValue(row.operation_version),
      partnerKey: this.textValue(row.partner_key),
      capabilityKey: this.textValue(row.capability_key),
      operationType: this.textValue(row.operation_type),
      resourceType: this.textValue(row.resource_type) as ExternalOperation['resourceType'],
      resourceId: this.textValue(row.resource_id),
      internalCommandId: this.textValue(row.internal_command_id),
      customerId: this.textValue(row.customer_id),
      walletAccountId: this.textValue(row.wallet_account_id),
      ledgerAccountId: this.textValue(row.ledger_account_id),
      targetMappingReference: this.textValue(row.target_mapping_reference),
      amountMinor: this.textValue(row.amount_minor),
      currency: this.textValue(row.currency),
      accountingUnit: this.textValue(row.accounting_unit),
      internalIdempotencyScope: this.textValue(row.internal_idempotency_scope),
      internalIdempotencyKey: this.textValue(row.internal_idempotency_key),
      providerIdempotencyScope: this.textValue(row.provider_idempotency_scope),
      providerIdempotencyKey: this.textValue(row.provider_idempotency_key),
      requestHash: this.textValue(row.request_hash),
      requestId: this.textValue(row.request_id),
      correlationId: this.textValue(row.correlation_id),
      traceId: this.nullableText(row.trace_id),
      causationId: this.nullableText(row.causation_id),
      lifecycleState: this.textValue(row.lifecycle_state) as ExternalOperation['lifecycleState'],
      attemptCount: this.numberValue(row.attempt_count),
      maxAttempts: this.numberValue(row.max_attempts),
      nextRetryAt: this.timestampValue(row.next_retry_at),
      lastAttemptAt: this.timestampValue(row.last_attempt_at),
      providerStatus: this.nullableText(row.provider_status),
      failureCode: this.nullableText(row.failure_code),
      failureMessage: this.nullableText(row.failure_message),
      failureStatusCode: this.numberValue(row.failure_status_code) || null,
      recoveryReference: this.nullableText(row.recovery_reference),
      submittingAt: this.timestampValue(row.submitting_at),
      pendingAt: this.timestampValue(row.pending_at),
      pendingVerificationAt: this.timestampValue(row.pending_verification_at),
      unknownAt: this.timestampValue(row.unknown_at),
      manualReviewAt: this.timestampValue(row.manual_review_at),
      failedAt: this.timestampValue(row.failed_at),
      cancelledAt: this.timestampValue(row.cancelled_at),
      version: this.numberValue(row.version),
      createdAt: this.timestampValue(row.created_at) ?? new Date(0),
      updatedAt: this.timestampValue(row.updated_at) ?? new Date(0),
    };
  }

  private toOperationFact(operation: ExternalOperation): ExternalReconciliationOperationFact {
    return {
      id: operation.id,
      operationVersion: operation.operationVersion,
      partnerKey: operation.partnerKey,
      capabilityKey: operation.capabilityKey,
      operationType: operation.operationType,
      resourceType: operation.resourceType,
      resourceId: operation.resourceId,
      internalCommandId: operation.internalCommandId,
      customerId: operation.customerId,
      walletAccountId: operation.walletAccountId,
      ledgerAccountId: operation.ledgerAccountId,
      targetMappingReference: operation.targetMappingReference,
      amountMinor: operation.amountMinor,
      currency: operation.currency,
      accountingUnit: operation.accountingUnit,
      lifecycleState: operation.lifecycleState,
      requestHash: operation.requestHash,
      correlationId: operation.correlationId,
      requestId: operation.requestId,
      attemptCount: operation.attemptCount,
      maxAttempts: operation.maxAttempts,
      version: operation.version,
    };
  }

  private toReferenceFact(row: SqlRow): ExternalReconciliationReferenceFact {
    return {
      id: this.textValue(row.id),
      externalOperationId: this.textValue(row.external_operation_id),
      partnerKey: this.textValue(row.partner_key),
      referenceType: this.textValue(
        row.reference_type,
      ) as ExternalReconciliationReferenceFact['referenceType'],
      referenceValueHash: this.sha256Like(this.textValue(row.reference_value)),
      referenceValue: this.textValue(row.reference_value),
      namespace: this.textValue(row.namespace),
      source: this.textValue(row.source) as ExternalReconciliationReferenceFact['source'],
      observedAt: this.timestampValue(row.observed_at) ?? new Date(0),
    };
  }

  private toCallbackFact(row: SqlRow): ExternalReconciliationCallbackFact {
    return {
      id: this.textValue(row.id),
      externalOperationId: this.nullableText(row.external_operation_id),
      partnerKey: this.textValue(row.partner_key),
      callbackEventId: this.textValue(row.callback_event_id),
      payloadHash: this.textValue(row.payload_hash),
      signatureHash: this.textValue(row.signature_hash),
      providerReferenceType: this.textValue(
        row.provider_reference_type,
      ) as ExternalReconciliationCallbackFact['providerReferenceType'],
      providerReferenceValueHash: this.sha256Like(this.textValue(row.provider_reference_value)),
      providerReferenceNamespace: this.textValue(row.provider_reference_namespace),
      providerStatus: this.textValue(row.provider_status),
      providerOccurredAt: this.timestampValue(row.provider_occurred_at) ?? new Date(0),
      receivedAt: this.timestampValue(row.received_at) ?? new Date(0),
      correlationId: this.textValue(row.correlation_id),
      status: this.textValue(row.status) as ExternalReconciliationCallbackFact['status'],
      rejectionCode: this.nullableText(row.rejection_code),
    };
  }

  private toSettlementFact(
    settlement: ExternalSettlementView,
  ): ExternalReconciliationSettlementFact {
    return {
      id: settlement.settlementId,
      externalOperationId: settlement.externalOperationId,
      externalOperationReference: settlement.externalOperationReference,
      partnerKey: settlement.partnerKey,
      capabilityKey: settlement.capabilityKey,
      operationType: settlement.operationType,
      customerId: settlement.customerId,
      walletAccountId: settlement.walletAccountId,
      customerLedgerAccountId: settlement.customerLedgerAccountId,
      settlementAssetLedgerAccountId: settlement.settlementAssetLedgerAccountId,
      decision: settlement.decision,
      status: settlement.status,
      amountMinor: settlement.amountMinor,
      currency: settlement.currency,
      accountingUnit: settlement.accountingUnit,
      lifecycleState: settlement.lifecycleState,
      journalId: settlement.journalId,
      reversalJournalId: settlement.reversalJournalId,
      evidenceType: settlement.evidence.referenceType as ExternalOperationReferenceType,
      evidenceValueHash: settlement.evidence.evidenceHash,
      evidenceValue: settlement.evidence.referenceValue,
      evidenceNamespace: settlement.evidence.namespace,
      evidenceSource: settlement.evidence.source,
      evidenceHash: settlement.evidence.evidenceHash,
      idempotencyScope: settlement.idempotencyScope,
      idempotencyKey: settlement.idempotencyKey,
      requestHash: settlement.requestHash,
      correlationId: settlement.correlationId,
      requestId: settlement.requestId,
      ownerPrincipal: settlement.ownerPrincipal,
      postedAt: settlement.postedAt,
      reversalPostedAt: settlement.reversalPostedAt,
    };
  }

  private toSuspenseFact(
    entry: ExternalSuspenseEntryView,
    generatedAt: string,
  ): ExternalReconciliationSuspenseFact {
    const opened = entry.createdAt instanceof Date ? entry.createdAt : new Date(entry.createdAt);
    const observedAt = entry.clearedAt ?? new Date(generatedAt);
    const agedHours = Math.max(
      0,
      Math.round((observedAt.getTime() - opened.getTime()) / (60 * 60 * 1000)),
    );
    return {
      id: entry.suspenseId,
      externalOperationId: entry.externalOperationId,
      externalOperationReference: entry.externalOperationReference,
      customerId: entry.customerId,
      amountMinor: entry.amountMinor,
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
      agedHours,
    };
  }

  private toJournalFact(row: SqlRow): ExternalReconciliationJournalFact {
    const metadata = this.objectValue(row.metadata);
    return {
      id: this.textValue(row.id),
      idempotencyKey: this.textValue(row.idempotency_key),
      requestHash: this.textValue(row.request_hash),
      currency: this.textValue(row.currency),
      accountingUnit: this.textValue(row.accounting_unit),
      status: this.textValue(row.status),
      reference: this.nullableText(row.reference),
      description: this.nullableText(row.description),
      correlationId: this.nullableText(row.correlation_id),
      reversalOfJournalId: this.nullableText(row.reversal_of_journal_id),
      totalMinor: this.textValue(row.total_minor),
      postedAt: this.timestampValue(row.posted_at),
      externalOperationReference: this.nullableText(metadata['externalOperationReference']),
      evidenceHash: this.nullableText(metadata['verifiedProviderReferenceHash']),
      partnerKey: this.nullableText(metadata['partnerKey']),
      capabilityKey: this.nullableText(metadata['capabilityKey']),
      operationType: this.nullableText(metadata['operationType']),
      verifiedProviderReferenceType: this.nullableText(metadata['verifiedProviderReferenceType']),
      verifiedProviderReferenceValue: this.nullableText(metadata['verifiedProviderReferenceValue']),
      verifiedProviderReferenceNamespace: this.nullableText(
        metadata['verifiedProviderReferenceNamespace'],
      ),
      verifiedProviderSource: this.nullableText(metadata['verifiedProviderSource']),
      settlementId: this.nullableText(metadata['settlementId']),
      externalOperationId: this.nullableText(metadata['externalOperationId']),
    };
  }

  private toJournalLineFact(row: SqlRow): ExternalReconciliationJournalLineFact {
    return {
      id: this.textValue(row.id),
      journalId: this.textValue(row.journal_id),
      accountId: this.textValue(row.account_id),
      direction: this.textValue(row.direction) as 'DEBIT' | 'CREDIT',
      amountMinor: this.textValue(row.amount_minor),
      currency: this.textValue(row.currency),
      accountingUnit: this.textValue(row.accounting_unit),
    };
  }

  private toAuditFact(row: SqlRow): ExternalReconciliationAuditFact {
    return {
      id: this.textValue(row.id),
      entityType: this.textValue(row.entity_type),
      entityId: this.textValue(row.entity_id),
      action: this.textValue(row.action),
      correlationId: this.nullableText(row.correlation_id),
      newValuesSummary: this.summarizeAuditValues(row.new_values),
    };
  }

  private toOutboxFact(row: SqlRow): ExternalReconciliationOutboxFact {
    return {
      id: this.textValue(row.id),
      eventType: this.textValue(row.event_type),
      aggregateType: this.textValue(row.aggregate_type),
      aggregateId: this.textValue(row.aggregate_id),
      eventKey: this.nullableText(row.event_key),
      schemaVersion: this.numberValue(row.schema_version),
      correlationId: this.nullableText(row.correlation_id),
      causationId: this.nullableText(row.causation_id),
      payloadSummary: this.summarizeOutboxPayload(row.payload),
    };
  }

  private summarizeOutboxPayload(value: unknown): Record<string, unknown> {
    const object = this.objectValue(value);
    return {
      externalOperationId: object['externalOperationId'] ?? null,
      externalOperationReference: object['externalOperationReference'] ?? null,
      settlementId: object['settlementId'] ?? null,
      suspenseId: object['suspenseId'] ?? null,
      journalId: object['journalId'] ?? null,
      reversalJournalId: object['reversalJournalId'] ?? null,
      amountMinor: object['amountMinor'] ?? null,
      currency: object['currency'] ?? null,
      accountingUnit: object['accountingUnit'] ?? null,
      partnerKey: object['partnerKey'] ?? null,
      capabilityKey: object['capabilityKey'] ?? null,
      operationType: object['operationType'] ?? null,
    };
  }

  private summarizeAuditValues(value: unknown): Record<string, unknown> | null {
    const object = this.objectValue(value);
    if (Object.keys(object).length === 0) return null;
    return {
      externalOperationId: object['externalOperationId'] ?? null,
      settlementId: object['settlementId'] ?? null,
      suspenseId: object['suspenseId'] ?? null,
      journalId: object['journalId'] ?? null,
      decision: object['decision'] ?? null,
      status: object['status'] ?? null,
      evidenceHash: object['evidenceHash'] ?? null,
      reason: object['reason'] ?? null,
      rejectionCode: object['rejectionCode'] ?? null,
      failureCode: object['failureCode'] ?? null,
    };
  }

  private objectValue(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async withReadOnlyTransaction<T>(
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return callback(manager);
    });
  }

  private async queryRows<T extends SqlRow>(
    manager: EntityManager,
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    return manager.query(sql, parameters);
  }

  private normalizeUuid(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new BadRequestException('externalOperationId must be a UUID');
    }
    return normalized;
  }

  private textValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    return JSON.stringify(value) ?? '';
  }

  private nullableText(value: unknown): string | null {
    const text = this.textValue(value);
    return text.length > 0 ? text : null;
  }

  private numberValue(value: unknown): number {
    if (typeof value === 'number') return value;
    const parsed = Number(this.textValue(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private timestampValue(value: unknown): Date | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const date = new Date(this.textValue(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private sha256Like(value: string): string {
    if (!value) return '';
    if (value.length === 64 && /^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
    return value;
  }
}
