import { createHash } from 'node:crypto';

import {
  EXTERNAL_RECONCILIATION_ADAPTER_VERSION,
  EXTERNAL_RECONCILIATION_CAPABILITY_KEY,
  EXTERNAL_RECONCILIATION_CAPABILITY_VERSION,
  EXTERNAL_RECONCILIATION_CONTRACT_DOCUMENT,
  EXTERNAL_RECONCILIATION_CONTRACT_NAME,
  EXTERNAL_RECONCILIATION_CONTRACT_REFERENCE,
  EXTERNAL_RECONCILIATION_CONTRACT_VERSION,
  EXTERNAL_RECONCILIATION_EXPECTED_CHECKS,
  EXTERNAL_RECONCILIATION_PARTNER_KEY,
  EXTERNAL_RECONCILIATION_SUSPENSE_AGED_HOURS,
  ExternalReconciliationDiscrepancyCode,
} from './external-reconciliation.enums';
import { ExternalCallbackReceiptStatus } from '../partner/external-callback.enums';
import { ExternalOperationLifecycleState } from '../partner/external-operation-lifecycle.enums';
import {
  ExternalSettlementStatus,
  ExternalSuspenseStatus,
} from '../partner/external-settlement.enums';
import type {
  ExternalReconciliationAuditFact,
  ExternalReconciliationBatchReport,
  ExternalReconciliationCallbackFact,
  ExternalReconciliationDiscrepancy,
  ExternalReconciliationFacts,
  ExternalReconciliationIdempotencyHint,
  ExternalReconciliationJournalFact,
  ExternalReconciliationJournalLineFact,
  ExternalReconciliationOperationFact,
  ExternalReconciliationOutboxFact,
  ExternalReconciliationOwner,
  ExternalReconciliationReferenceFact,
  ExternalReconciliationReport,
  ExternalReconciliationSettlementFact,
  ExternalReconciliationSeverity,
  ExternalReconciliationTrace,
  PartnerCertificationEvidence,
} from './external-reconciliation.types';
import { VerificationStatus } from './reconciliation.types';

const ZERO_HASH = '0'.repeat(64);
const VERIFIED_LIFECYCLE_STATES = new Set<ExternalOperationLifecycleState>([
  ExternalOperationLifecycleState.PENDING_VERIFICATION,
  'SETTLED' as ExternalOperationLifecycleState,
]);
const TERMINAL_LIFECYCLE_STATES = new Set<ExternalOperationLifecycleState>([
  ExternalOperationLifecycleState.FAILED,
  ExternalOperationLifecycleState.CANCELLED,
]);
const POSTED_SETTLEMENT_STATES = new Set<ExternalSettlementStatus>([
  ExternalSettlementStatus.POSTED,
  ExternalSettlementStatus.REVERSED,
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bigIntFromMinor(value: string): bigint {
  if (!value || value.length === 0) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function normalizeHex(value: string | null | undefined): string {
  if (!value) return ZERO_HASH;
  return value.toLowerCase();
}

function makeDiscrepancy(
  facts: ExternalReconciliationFacts,
  code: ExternalReconciliationDiscrepancyCode,
  severity: ExternalReconciliationSeverity,
  owner: ExternalReconciliationOwner,
  message: string,
  scopeValue: string | null,
): ExternalReconciliationDiscrepancy {
  const operation = facts.operation;
  const settlement = facts.settlement;
  const firstReference = facts.references[0] ?? null;
  const firstCallback = facts.callbacks[0] ?? null;
  const firstSuspense = facts.suspenseEntries[0] ?? null;
  const key = [
    code,
    scopeValue ?? '',
    operation?.id ?? '',
    settlement?.id ?? '',
    firstReference?.id ?? '',
    firstCallback?.id ?? '',
    firstSuspense?.id ?? '',
  ].join(':');
  return {
    key,
    code,
    severity,
    owner,
    recoveryState: 'NO_AUTOMATIC_REPAIR',
    externalOperationId: operation?.id ?? null,
    settlementId: settlement?.id ?? null,
    journalId: settlement?.journalId ?? facts.journal?.id ?? null,
    suspenseEntryId: firstSuspense?.id ?? null,
    providerReferenceId: firstReference?.id ?? null,
    callbackReceiptId: firstCallback?.id ?? null,
    scopeValue,
    message,
  };
}

function pushDiscrepancy(
  discrepancies: ExternalReconciliationDiscrepancy[],
  facts: ExternalReconciliationFacts,
  code: ExternalReconciliationDiscrepancyCode,
  severity: ExternalReconciliationSeverity,
  owner: ExternalReconciliationOwner,
  message: string,
  scopeValue: string | null,
): void {
  discrepancies.push(makeDiscrepancy(facts, code, severity, owner, message, scopeValue));
}

function aggregateStatus(
  discrepancies: readonly ExternalReconciliationDiscrepancy[],
): VerificationStatus {
  if (discrepancies.some((discrepancy) => discrepancy.severity === 'ERROR')) {
    return VerificationStatus.ERROR;
  }
  if (discrepancies.length > 0) {
    return VerificationStatus.WARNING;
  }
  return VerificationStatus.PASS;
}

function buildOperationFact(
  operation: ExternalReconciliationOperationFact,
): ExternalReconciliationOperationFact {
  return { ...operation };
}

function buildReferenceFact(
  reference: ExternalReconciliationReferenceFact,
): ExternalReconciliationReferenceFact {
  return { ...reference };
}

function buildCallbackFact(
  callback: ExternalReconciliationCallbackFact,
): ExternalReconciliationCallbackFact {
  return { ...callback };
}

function buildSettlementFact(
  settlement: ExternalReconciliationSettlementFact,
): ExternalReconciliationSettlementFact {
  return { ...settlement };
}

function buildJournalFact(
  journal: ExternalReconciliationJournalFact,
): ExternalReconciliationJournalFact {
  return { ...journal };
}

function buildJournalLineFact(
  line: ExternalReconciliationJournalLineFact,
): ExternalReconciliationJournalLineFact {
  return { ...line };
}

function buildAuditFact(audit: ExternalReconciliationAuditFact): ExternalReconciliationAuditFact {
  return { ...audit };
}

function buildOutboxFact(
  outbox: ExternalReconciliationOutboxFact,
): ExternalReconciliationOutboxFact {
  return { ...outbox };
}

function buildIdempotencyHint(
  hint: ExternalReconciliationIdempotencyHint,
): ExternalReconciliationIdempotencyHint {
  return { ...hint };
}

export function evaluateExternalReconciliation(
  facts: ExternalReconciliationFacts,
  generatedAt = new Date().toISOString(),
): ExternalReconciliationReport {
  const discrepancies: ExternalReconciliationDiscrepancy[] = [];

  // 1. external_operation_loaded
  if (!facts.operation) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.OPERATION_NOT_FOUND,
      'ERROR',
      'RECONCILIATION',
      'External operation was not found in the source table',
      facts.externalOperationId,
    );
    return buildReport(facts, generatedAt, discrepancies);
  }

  const operation = facts.operation;
  // 2. operation_currency_consistent
  if (operation.currency !== 'NGN') {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.OPERATION_CURRENCY_MISMATCH,
      'ERROR',
      'FINANCE',
      `Operation currency ${operation.currency} is not NGN`,
      operation.currency,
    );
  }
  // 3. operation_accounting_unit_consistent
  if (operation.accountingUnit !== 'CUSTOMER_FUNDS') {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.OPERATION_ACCOUNTING_UNIT_MISMATCH,
      'ERROR',
      'FINANCE',
      `Operation accounting unit ${operation.accountingUnit} is not CUSTOMER_FUNDS`,
      operation.accountingUnit,
    );
  }
  // 4. partner_capability_consistent
  if (
    operation.partnerKey !== EXTERNAL_RECONCILIATION_PARTNER_KEY ||
    operation.capabilityKey !== EXTERNAL_RECONCILIATION_CAPABILITY_KEY
  ) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.PARTNER_CAPABILITY_MISMATCH,
      'ERROR',
      'PARTNER_OWNER',
      `Operation partner/capability ${operation.partnerKey}/${operation.capabilityKey} does not match A6T01 selection`,
      `${operation.partnerKey}:${operation.capabilityKey}`,
    );
  }
  // 5. lifecycle_state_consistent
  if (TERMINAL_LIFECYCLE_STATES.has(operation.lifecycleState)) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.LIFECYCLE_TERMINAL,
      'ERROR',
      'PARTNER_OWNER',
      `Operation lifecycle is terminal at ${operation.lifecycleState} and cannot be reconciled`,
      operation.lifecycleState,
    );
  } else if (!VERIFIED_LIFECYCLE_STATES.has(operation.lifecycleState)) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.LIFECYCLE_NOT_VERIFIED,
      'ERROR',
      'PARTNER_OWNER',
      `Operation lifecycle ${operation.lifecycleState} is not verified`,
      operation.lifecycleState,
    );
  }

  // 6. provider_reference_present
  if (facts.references.length === 0) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.MISSING_PROVIDER_REFERENCE,
      'ERROR',
      'PARTNER_OWNER',
      'External operation has no recorded provider references',
      operation.id,
    );
  }
  // 7. provider_reference_unique
  const referenceKeySet = new Set<string>();
  let duplicateReference = false;
  for (const reference of facts.references) {
    const key = `${reference.partnerKey}:${reference.referenceType}:${reference.referenceValue}:${reference.namespace}`;
    if (referenceKeySet.has(key)) {
      duplicateReference = true;
      break;
    }
    referenceKeySet.add(key);
  }
  if (duplicateReference) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.DUPLICATE_PROVIDER_REFERENCE,
      'ERROR',
      'PARTNER_OWNER',
      'External operation has duplicate provider references',
      operation.id,
    );
  }

  // 8. callback_receipt_present
  if (facts.callbacks.length === 0) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.MISSING_CALLBACK_RECEIPT,
      'WARNING',
      'PARTNER_OWNER',
      'External operation has no authenticated callback receipts',
      operation.id,
    );
  }
  // 9. callback_authenticity_consistent
  const rejectedCallback = facts.callbacks.find(
    (callback) => callback.status === ExternalCallbackReceiptStatus.REJECTED,
  );
  if (rejectedCallback) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.CALLBACK_AUTHENTICITY_REJECTED,
      'ERROR',
      'SECURITY',
      `Callback receipt ${rejectedCallback.id} was rejected during authenticity check`,
      rejectedCallback.id,
    );
  }
  // 10. callback_reference_consistent
  const callbacksForOperation = facts.callbacks.filter(
    (callback) => callback.externalOperationId === operation.id,
  );
  const referenceValueHashSet = new Set(
    facts.references.map((reference) => normalizeHex(reference.referenceValueHash)),
  );
  const callbackReferenceMismatched = callbacksForOperation.find(
    (callback) => !referenceValueHashSet.has(normalizeHex(callback.providerReferenceValueHash)),
  );
  if (callbackReferenceMismatched) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.CALLBACK_REFERENCE_MISMATCH,
      'ERROR',
      'PARTNER_OWNER',
      `Callback receipt ${callbackReferenceMismatched.id} provider reference does not match an internal reference`,
      callbackReferenceMismatched.id,
    );
  }
  // 11. callback_amount_consistent — verified via settlement evidence (no direct amount in A6T06 receipts)
  // 12. callback_currency_consistent — verified via settlement evidence (no direct currency in A6T06 receipts)

  // 13. settlement_record_present
  const settlement = facts.settlement;
  const settlementExpected = VERIFIED_LIFECYCLE_STATES.has(operation.lifecycleState);
  if (settlementExpected && !settlement) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.MISSING_SETTLEMENT,
      'WARNING',
      'RECONCILIATION',
      `Verified operation ${operation.id} has no settlement record`,
      operation.id,
    );
  }
  // 14. settlement_unique — enforced by `uq_external_settlements_operation_id` constraint
  if (settlement) {
    // 14a. settlement_journal_consistent
    if (settlement.journalId === null) {
      pushDiscrepancy(
        discrepancies,
        facts,
        ExternalReconciliationDiscrepancyCode.MISSING_JOURNAL,
        'ERROR',
        'FINANCE',
        `Settlement ${settlement.id} has no journal reference`,
        settlement.id,
      );
    }
    // 15. settlement_amount_consistent
    if (bigIntFromMinor(settlement.amountMinor) !== bigIntFromMinor(operation.amountMinor)) {
      pushDiscrepancy(
        discrepancies,
        facts,
        ExternalReconciliationDiscrepancyCode.SETTLEMENT_AMOUNT_MISMATCH,
        'ERROR',
        'FINANCE',
        `Settlement amount ${settlement.amountMinor} does not match operation amount ${operation.amountMinor}`,
        settlement.id,
      );
    }
    // 16. settlement_currency_consistent
    if (settlement.currency !== operation.currency) {
      pushDiscrepancy(
        discrepancies,
        facts,
        ExternalReconciliationDiscrepancyCode.SETTLEMENT_CURRENCY_MISMATCH,
        'ERROR',
        'FINANCE',
        `Settlement currency ${settlement.currency} does not match operation currency ${operation.currency}`,
        settlement.id,
      );
    }
    // 17. settlement_accounting_unit_consistent
    if (settlement.accountingUnit !== operation.accountingUnit) {
      pushDiscrepancy(
        discrepancies,
        facts,
        ExternalReconciliationDiscrepancyCode.SETTLEMENT_ACCOUNTING_UNIT_MISMATCH,
        'ERROR',
        'FINANCE',
        `Settlement accounting unit ${settlement.accountingUnit} does not match operation accounting unit ${operation.accountingUnit}`,
        settlement.id,
      );
    }
    // 18. settlement_evidence_consistent
    const evidenceMatched = facts.references.some(
      (reference) =>
        reference.partnerKey === settlement.partnerKey &&
        reference.namespace === settlement.evidenceNamespace &&
        reference.referenceType === settlement.evidenceType,
    );
    if (!evidenceMatched) {
      pushDiscrepancy(
        discrepancies,
        facts,
        ExternalReconciliationDiscrepancyCode.SETTLEMENT_EVIDENCE_MISMATCH,
        'ERROR',
        'FINANCE',
        `Settlement evidence ${settlement.evidenceValue} does not match any recorded provider reference`,
        settlement.id,
      );
    }
    // 19. settlement_correlation_consistent
    if (settlement.correlationId !== operation.correlationId) {
      pushDiscrepancy(
        discrepancies,
        facts,
        ExternalReconciliationDiscrepancyCode.SETTLEMENT_CORRELATION_MISMATCH,
        'ERROR',
        'RECONCILIATION',
        `Settlement correlation ${settlement.correlationId} does not match operation correlation ${operation.correlationId}`,
        settlement.id,
      );
    }
    // 20. settlement_reversal_consistent
    if (
      settlement.status === ExternalSettlementStatus.REVERSED &&
      (!settlement.reversalJournalId || facts.journal?.id !== settlement.reversalJournalId)
    ) {
      pushDiscrepancy(
        discrepancies,
        facts,
        ExternalReconciliationDiscrepancyCode.SETTLEMENT_REVERSAL_ORPHAN,
        'ERROR',
        'FINANCE',
        `Settlement ${settlement.id} is REVERSED but its reversal journal is not correlated to the operation`,
        settlement.id,
      );
    }
  }

  // 21. journal_correlation_consistent
  const journal = facts.journal;
  if (journal && journal.correlationId !== operation.correlationId) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.JOURNAL_CORRELATION_MISMATCH,
      'ERROR',
      'RECONCILIATION',
      `Journal ${journal.id} correlation does not match operation correlation`,
      journal.id,
    );
  }
  // 22. journal_balance_consistent
  const debits = facts.journalLines
    .filter((line) => line.direction === 'DEBIT')
    .reduce((total, line) => total + bigIntFromMinor(line.amountMinor), 0n);
  const credits = facts.journalLines
    .filter((line) => line.direction === 'CREDIT')
    .reduce((total, line) => total + bigIntFromMinor(line.amountMinor), 0n);
  const expectedTotal =
    settlement && POSTED_SETTLEMENT_STATES.has(settlement.status)
      ? bigIntFromMinor(settlement.amountMinor)
      : 0n;
  if (
    journal &&
    (facts.journalLines.length < 2 || debits !== credits || debits !== expectedTotal)
  ) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.JOURNAL_BALANCE_MISMATCH,
      'ERROR',
      'FINANCE',
      `Journal ${journal.id} debit/credit totals differ or do not match the settlement amount`,
      journal.id,
    );
  }
  // 23. journal_reversal_consistent
  const reversalJournalId = settlement?.reversalJournalId ?? null;
  if (reversalJournalId && reversalJournalId !== journal?.id) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.JOURNAL_REVERSAL_ORPHAN,
      'ERROR',
      'FINANCE',
      `Reversal journal ${reversalJournalId} is not the loaded journal for the settlement`,
      reversalJournalId,
    );
  }

  // 24. suspense_reversal_consistent
  const clearedSuspense = facts.suspenseEntries.find(
    (entry) => entry.status === ExternalSuspenseStatus.CLEARED,
  );
  if (
    clearedSuspense &&
    clearedSuspense.reversalJournalId &&
    facts.journal?.id !== clearedSuspense.reversalJournalId
  ) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.SUSPENSE_REVERSAL_MISSING,
      'ERROR',
      'FINANCE',
      `Cleared suspense ${clearedSuspense.id} has no reversal journal correlated to the settlement reversal`,
      clearedSuspense.id,
    );
  }
  // 25. suspense_aging_consistent
  const agedOpen = facts.suspenseEntries.find(
    (entry) =>
      entry.status === ExternalSuspenseStatus.OPEN &&
      entry.agedHours >= EXTERNAL_RECONCILIATION_SUSPENSE_AGED_HOURS,
  );
  const agedHeld = facts.suspenseEntries.find(
    (entry) =>
      entry.status === ExternalSuspenseStatus.HELD &&
      entry.agedHours >= EXTERNAL_RECONCILIATION_SUSPENSE_AGED_HOURS,
  );
  if (agedHeld) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.SUSPENSE_AGED_HELD,
      'ERROR',
      'FINANCE',
      `Suspense entry ${agedHeld.id} is HELD for ${agedHeld.agedHours} hours without resolution`,
      agedHeld.id,
    );
  } else if (agedOpen) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.SUSPENSE_AGED_OPEN,
      'WARNING',
      'RECONCILIATION',
      `Suspense entry ${agedOpen.id} is OPEN for ${agedOpen.agedHours} hours without resolution`,
      agedOpen.id,
    );
  }

  // 26. audit_evidence_present
  const expectedAuditActions = new Set<string>();
  if (settlementExpected && settlement) {
    expectedAuditActions.add('SETTLEMENT_POSTED');
    if (settlement.status === ExternalSettlementStatus.REVERSED) {
      expectedAuditActions.add('COMPENSATING_POSTED');
    }
  }
  if (facts.suspenseEntries.length > 0) {
    expectedAuditActions.add('SUSPENSE_RECORDED');
    if (facts.suspenseEntries.some((entry) => entry.status === ExternalSuspenseStatus.CLEARED)) {
      expectedAuditActions.add('COMPENSATING_POSTED');
    }
  }
  const presentActions = new Set(facts.auditEvents.map((event) => event.action));
  const missingActions = [...expectedAuditActions].filter((action) => !presentActions.has(action));
  if (settlementExpected && missingActions.length > 0) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.MISSING_AUDIT_EVIDENCE,
      'WARNING',
      'RECONCILIATION',
      `Expected audit actions ${missingActions.join(', ')} are missing for the operation`,
      missingActions.join(',') || null,
    );
  }
  // 27. audit_correlation_consistent
  const mismatchedAudit = facts.auditEvents.find(
    (event) =>
      event.entityType === 'A6_EXTERNAL_SETTLEMENT' &&
      event.entityId === settlement?.id &&
      event.correlationId !== operation.correlationId,
  );
  if (mismatchedAudit) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.AUDIT_CORRELATION_MISMATCH,
      'WARNING',
      'RECONCILIATION',
      `Audit event ${mismatchedAudit.id} correlation does not match the operation correlation`,
      mismatchedAudit.id,
    );
  }

  // 28. outbox_fact_present
  const expectedOutboxTypes = new Set<string>();
  if (settlementExpected) {
    expectedOutboxTypes.add('A6_EXTERNAL_SETTLEMENT_POSTED');
    if (settlement && settlement.status === ExternalSettlementStatus.REVERSED) {
      expectedOutboxTypes.add('A6_EXTERNAL_SETTLEMENT_COMPENSATED');
    }
  }
  if (facts.suspenseEntries.length > 0) {
    expectedOutboxTypes.add('A6_EXTERNAL_SETTLEMENT_SUSPENSE');
  }
  if (facts.suspenseEntries.some((entry) => entry.status === ExternalSuspenseStatus.CLEARED)) {
    expectedOutboxTypes.add('A6_EXTERNAL_SETTLEMENT_COMPENSATED');
  }
  const presentOutboxTypes = new Set(facts.outboxEvents.map((event) => event.eventType));
  const missingOutboxTypes = [...expectedOutboxTypes].filter(
    (type) => !presentOutboxTypes.has(type),
  );
  if (settlementExpected && missingOutboxTypes.length > 0) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.MISSING_OUTBOX_FACT,
      'WARNING',
      'RECONCILIATION',
      `Expected outbox event types ${missingOutboxTypes.join(', ')} are missing`,
      missingOutboxTypes.join(',') || null,
    );
  }

  // 28a. suspense_entry_required_when_outbox_indicates
  const suspenseOutboxExists = facts.outboxEvents.some(
    (event) => event.eventType === 'A6_EXTERNAL_SETTLEMENT_SUSPENSE',
  );
  if (suspenseOutboxExists && facts.suspenseEntries.length === 0) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.MISSING_SUSPENSE_ENTRY,
      'WARNING',
      'RECONCILIATION',
      'A suspense outbox event is recorded but no suspense entry exists',
      operation.id,
    );
  }
  // 29. outbox_correlation_consistent
  const settlementOutbox = facts.outboxEvents.find(
    (event) =>
      event.aggregateType === 'A6_EXTERNAL_SETTLEMENT' && event.aggregateId === settlement?.id,
  );
  if (settlementOutbox && settlementOutbox.correlationId !== operation.correlationId) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.OUTBOX_CORRELATION_MISMATCH,
      'WARNING',
      'RECONCILIATION',
      `Outbox event ${settlementOutbox.id} correlation does not match the operation correlation`,
      settlementOutbox.id,
    );
  }
  // 30. outbox_payload_consistent
  const settlementOutboxPayload = settlementOutbox?.payloadSummary ?? null;
  if (
    settlementOutbox &&
    (settlementOutboxPayload === null ||
      settlementOutboxPayload['externalOperationId'] !== operation.id ||
      (settlement !== null && settlementOutboxPayload['settlementId'] !== settlement.id) ||
      (settlement !== null && settlementOutboxPayload['amountMinor'] !== settlement.amountMinor) ||
      (settlement !== null && settlementOutboxPayload['currency'] !== settlement.currency))
  ) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.OUTBOX_PAYLOAD_MISMATCH,
      'ERROR',
      'RECONCILIATION',
      `Outbox event ${settlementOutbox.id} payload does not match the settlement and operation facts`,
      settlementOutbox.id,
    );
  }

  // 31. idempotency_replay_consistent
  const settlementIdempotencyHint = facts.idempotencyHints.find(
    (hint) =>
      hint.scope === 'external.partner.settlement.v1' && hint.key === settlement?.idempotencyKey,
  );
  if (
    settlement &&
    (settlementIdempotencyHint?.match !== 'MATCH' ||
      normalizeHex(settlementIdempotencyHint?.requestHash) !== normalizeHex(settlement.requestHash))
  ) {
    pushDiscrepancy(
      discrepancies,
      facts,
      ExternalReconciliationDiscrepancyCode.IDEMPOTENCY_HASH_MISMATCH,
      'ERROR',
      'RECONCILIATION',
      `Settlement idempotency record ${settlementIdempotencyHint?.key ?? ''} does not replay the settlement request hash`,
      settlementIdempotencyHint?.key ?? null,
    );
  }

  return buildReport(facts, generatedAt, discrepancies);
}

function buildReport(
  facts: ExternalReconciliationFacts,
  generatedAt: string,
  discrepancies: ExternalReconciliationDiscrepancy[],
): ExternalReconciliationReport {
  const sorted = [...discrepancies].sort((left, right) => left.key.localeCompare(right.key));
  const status = aggregateStatus(sorted);
  const trace = buildTrace(facts, generatedAt, sorted);
  const certification = buildCertification(facts, sorted, generatedAt);
  const replayHash = sha256(
    sorted
      .map((discrepancy) => `${discrepancy.code}:${discrepancy.message}`)
      .sort()
      .join('|'),
  );
  return {
    contractName: 'A6-EXTERNAL-RECONCILIATION',
    contractVersion: 1,
    generatedAt,
    readOnly: true,
    status,
    externalOperationId: facts.externalOperationId,
    operation: facts.operation ? buildOperationFact(facts.operation) : null,
    references: facts.references.map(buildReferenceFact),
    callbacks: facts.callbacks.map(buildCallbackFact),
    settlement: facts.settlement ? buildSettlementFact(facts.settlement) : null,
    suspenseEntries: facts.suspenseEntries,
    journal: facts.journal ? buildJournalFact(facts.journal) : null,
    journalLines: facts.journalLines.map(buildJournalLineFact),
    auditEvents: facts.auditEvents.map(buildAuditFact),
    outboxEvents: facts.outboxEvents.map(buildOutboxFact),
    idempotencyHints: facts.idempotencyHints.map(buildIdempotencyHint),
    discrepancies: sorted,
    trace,
    certification,
    replayHash,
    repairPerformed: false,
  };
}

function buildTrace(
  facts: ExternalReconciliationFacts,
  generatedAt: string,
  discrepancies: ExternalReconciliationDiscrepancy[],
): ExternalReconciliationTrace {
  const operation = facts.operation;
  const settlement = facts.settlement;
  const hasError = discrepancies.some((discrepancy) => discrepancy.severity === 'ERROR');
  const hasWarning = discrepancies.some((discrepancy) => discrepancy.severity === 'WARNING');
  return {
    externalOperationId: operation?.id ?? facts.externalOperationId,
    internalCommandId: operation?.internalCommandId ?? '',
    customerId: operation?.customerId ?? '',
    walletAccountId: operation?.walletAccountId ?? '',
    customerLedgerAccountId: operation?.ledgerAccountId ?? '',
    settlementAssetLedgerAccountId: settlement?.settlementAssetLedgerAccountId ?? null,
    partnerKey: operation?.partnerKey ?? EXTERNAL_RECONCILIATION_PARTNER_KEY,
    capabilityKey: operation?.capabilityKey ?? EXTERNAL_RECONCILIATION_CAPABILITY_KEY,
    operationType: operation?.operationType ?? 'OUTBOUND_BANK_SETTLEMENT',
    externalOperationReference: operation
      ? `external-operation:v1:${sha256(`NIBSS_NIP:${operation.id}:external-operation`)}`
      : '',
    externalSettlementId: settlement?.id ?? null,
    externalSettlementJournalId: settlement?.journalId ?? null,
    externalSettlementReversalJournalId: settlement?.reversalJournalId ?? null,
    externalSettlementReference: settlement?.id ?? null,
    externalSettlementIdempotencyKey: settlement?.idempotencyKey ?? null,
    providerReferenceIds: facts.references.map((reference) => reference.id),
    callbackReceiptIds: facts.callbacks.map((callback) => callback.id),
    suspenseEntryIds: facts.suspenseEntries.map((entry) => entry.id),
    outboxEventIds: facts.outboxEvents.map((event) => event.id),
    auditEventIds: facts.auditEvents.map((event) => event.id),
    correlationId: operation?.correlationId ?? '',
    supportClassification: hasError ? 'RESTRICTED' : hasWarning ? 'CONFIDENTIAL' : 'INTERNAL',
    generatedAt,
  };
}

function buildCertification(
  facts: ExternalReconciliationFacts,
  discrepancies: ExternalReconciliationDiscrepancy[],
  generatedAt: string,
): PartnerCertificationEvidence {
  const status = aggregateStatus(discrepancies);
  const failedChecks = new Set(
    discrepancies.map((discrepancy) => discrepancyToCheck(discrepancy.code)),
  );
  const observedChecks = EXTERNAL_RECONCILIATION_EXPECTED_CHECKS.filter(
    (check) => !failedChecks.has(check),
  );
  const fingerprint = sha256(
    [
      EXTERNAL_RECONCILIATION_PARTNER_KEY,
      EXTERNAL_RECONCILIATION_CAPABILITY_KEY,
      String(EXTERNAL_RECONCILIATION_CONTRACT_VERSION),
      EXTERNAL_RECONCILIATION_ADAPTER_VERSION,
      [...EXTERNAL_RECONCILIATION_EXPECTED_CHECKS].sort().join('|'),
      [...observedChecks].sort().join('|'),
      status,
    ].join('::'),
  );
  const evidenceHash = sha256(
    [
      facts.operation?.id ?? '',
      facts.settlement?.id ?? '',
      facts.settlement?.journalId ?? '',
      facts.outboxEvents
        .map((event) => event.id)
        .sort()
        .join('|'),
      facts.auditEvents
        .map((event) => event.id)
        .sort()
        .join('|'),
      facts.callbacks
        .map((callback) => callback.id)
        .sort()
        .join('|'),
      facts.references
        .map((reference) => reference.id)
        .sort()
        .join('|'),
    ].join('::'),
  );
  return {
    partnerKey: EXTERNAL_RECONCILIATION_PARTNER_KEY,
    capabilityKey: EXTERNAL_RECONCILIATION_CAPABILITY_KEY,
    capabilityVersion: EXTERNAL_RECONCILIATION_CAPABILITY_VERSION,
    adapterVersion: EXTERNAL_RECONCILIATION_ADAPTER_VERSION,
    contractName: EXTERNAL_RECONCILIATION_CONTRACT_NAME,
    contractVersion: EXTERNAL_RECONCILIATION_CONTRACT_VERSION,
    contractReference: EXTERNAL_RECONCILIATION_CONTRACT_REFERENCE,
    contractDocument: EXTERNAL_RECONCILIATION_CONTRACT_DOCUMENT,
    expectedChecks: [...EXTERNAL_RECONCILIATION_EXPECTED_CHECKS],
    observedChecks,
    reportStatus: status,
    fingerprint,
    evidenceHash,
    producedAt: generatedAt,
    notes: 'Read-only certification evidence; not a release gate on its own',
  };
}

function discrepancyToCheck(code: ExternalReconciliationDiscrepancyCode): string | null {
  const map: Partial<Record<ExternalReconciliationDiscrepancyCode, string>> = {
    [ExternalReconciliationDiscrepancyCode.OPERATION_NOT_FOUND]: 'external_operation_loaded',
    [ExternalReconciliationDiscrepancyCode.OPERATION_CURRENCY_MISMATCH]:
      'operation_currency_consistent',
    [ExternalReconciliationDiscrepancyCode.OPERATION_ACCOUNTING_UNIT_MISMATCH]:
      'operation_accounting_unit_consistent',
    [ExternalReconciliationDiscrepancyCode.PARTNER_CAPABILITY_MISMATCH]:
      'partner_capability_consistent',
    [ExternalReconciliationDiscrepancyCode.LIFECYCLE_NOT_VERIFIED]: 'lifecycle_state_consistent',
    [ExternalReconciliationDiscrepancyCode.LIFECYCLE_TERMINAL]: 'lifecycle_state_consistent',
    [ExternalReconciliationDiscrepancyCode.MISSING_PROVIDER_REFERENCE]:
      'provider_reference_present',
    [ExternalReconciliationDiscrepancyCode.DUPLICATE_PROVIDER_REFERENCE]:
      'provider_reference_unique',
    [ExternalReconciliationDiscrepancyCode.MISSING_CALLBACK_RECEIPT]: 'callback_receipt_present',
    [ExternalReconciliationDiscrepancyCode.CALLBACK_AUTHENTICITY_REJECTED]:
      'callback_authenticity_consistent',
    [ExternalReconciliationDiscrepancyCode.CALLBACK_REFERENCE_MISMATCH]:
      'callback_reference_consistent',
    [ExternalReconciliationDiscrepancyCode.MISSING_SETTLEMENT]: 'settlement_record_present',
    [ExternalReconciliationDiscrepancyCode.SETTLEMENT_AMOUNT_MISMATCH]:
      'settlement_amount_consistent',
    [ExternalReconciliationDiscrepancyCode.SETTLEMENT_CURRENCY_MISMATCH]:
      'settlement_currency_consistent',
    [ExternalReconciliationDiscrepancyCode.SETTLEMENT_ACCOUNTING_UNIT_MISMATCH]:
      'settlement_accounting_unit_consistent',
    [ExternalReconciliationDiscrepancyCode.SETTLEMENT_EVIDENCE_MISMATCH]:
      'settlement_evidence_consistent',
    [ExternalReconciliationDiscrepancyCode.SETTLEMENT_CORRELATION_MISMATCH]:
      'settlement_correlation_consistent',
    [ExternalReconciliationDiscrepancyCode.SETTLEMENT_REVERSAL_ORPHAN]:
      'settlement_reversal_consistent',
    [ExternalReconciliationDiscrepancyCode.JOURNAL_CORRELATION_MISMATCH]:
      'journal_correlation_consistent',
    [ExternalReconciliationDiscrepancyCode.JOURNAL_BALANCE_MISMATCH]: 'journal_balance_consistent',
    [ExternalReconciliationDiscrepancyCode.JOURNAL_REVERSAL_ORPHAN]: 'journal_reversal_consistent',
    [ExternalReconciliationDiscrepancyCode.SUSPENSE_REVERSAL_MISSING]:
      'suspense_reversal_consistent',
    [ExternalReconciliationDiscrepancyCode.SUSPENSE_AGED_OPEN]: 'suspense_aging_consistent',
    [ExternalReconciliationDiscrepancyCode.SUSPENSE_AGED_HELD]: 'suspense_aging_consistent',
    [ExternalReconciliationDiscrepancyCode.MISSING_AUDIT_EVIDENCE]: 'audit_evidence_present',
    [ExternalReconciliationDiscrepancyCode.AUDIT_CORRELATION_MISMATCH]:
      'audit_correlation_consistent',
    [ExternalReconciliationDiscrepancyCode.MISSING_OUTBOX_FACT]: 'outbox_fact_present',
    [ExternalReconciliationDiscrepancyCode.OUTBOX_CORRELATION_MISMATCH]:
      'outbox_correlation_consistent',
    [ExternalReconciliationDiscrepancyCode.OUTBOX_PAYLOAD_MISMATCH]: 'outbox_payload_consistent',
    [ExternalReconciliationDiscrepancyCode.IDEMPOTENCY_HASH_MISMATCH]:
      'idempotency_replay_consistent',
  };
  return map[code] ?? null;
}

export function aggregateExternalReconciliationStatus(
  reports: readonly ExternalReconciliationReport[],
): VerificationStatus {
  if (reports.some((report) => report.status === VerificationStatus.ERROR)) {
    return VerificationStatus.ERROR;
  }
  if (reports.some((report) => report.status === VerificationStatus.WARNING)) {
    return VerificationStatus.WARNING;
  }
  return VerificationStatus.PASS;
}

export function buildExternalReconciliationBatchReport(
  reports: readonly ExternalReconciliationReport[],
  generatedAt = new Date().toISOString(),
): ExternalReconciliationBatchReport {
  const status = aggregateExternalReconciliationStatus(reports);
  return {
    contractName: 'A6-EXTERNAL-RECONCILIATION',
    contractVersion: 1,
    generatedAt,
    readOnly: true,
    status,
    reports: [...reports],
    discrepancies: reports.reduce((total, report) => total + report.discrepancies.length, 0),
    repairPerformed: false,
  };
}

export function isVerifiedSettlementStatus(status: string | null | undefined): boolean {
  return (
    status !== null &&
    status !== undefined &&
    POSTED_SETTLEMENT_STATES.has(status as ExternalSettlementStatus)
  );
}
