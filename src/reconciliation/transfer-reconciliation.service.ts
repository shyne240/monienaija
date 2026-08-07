import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { TransferStatus } from '../transfer/transfer.enums';
import {
  TransferReconciliationDiscrepancyCode,
  type TransferReconciliationAuditFact,
  type TransferReconciliationBatchReport,
  type TransferReconciliationFacts,
  type TransferReconciliationJournalFact,
  type TransferReconciliationLineFact,
  type TransferReconciliationOutboxFact,
  type TransferReconciliationReport,
  type TransferReconciliationStatus,
  type TransferReconciliationTransferFact,
} from './transfer-reconciliation.types';
import type {
  TransferReconciliationDiscrepancy,
  TransferReconciliationTrace,
} from './transfer-reconciliation.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SqlRow = Record<string, unknown>;

@Injectable()
export class TransferReconciliationService {
  constructor(private readonly dataSource: DataSource) {}

  async reconcileTransfer(transferId: string): Promise<TransferReconciliationReport> {
    const normalizedTransferId = this.normalizeUuid(transferId);
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const facts = await this.loadFacts(manager, normalizedTransferId);
      return evaluateTransferReconciliation(facts);
    });
  }

  async reconcileAll(): Promise<TransferReconciliationBatchReport> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const rows = await this.queryRows<SqlRow>(
        manager,
        `
          SELECT id::text AS transfer_id
            FROM transfers
           WHERE command_id IS NOT NULL
           ORDER BY id
        `,
      );
      const reports: TransferReconciliationReport[] = [];
      for (const row of rows) {
        const transferId = this.textValue(row.transfer_id);
        if (transferId) {
          reports.push(evaluateTransferReconciliation(await this.loadFacts(manager, transferId)));
        }
      }
      return {
        status: this.aggregateStatus(reports),
        generatedAt: new Date().toISOString(),
        readOnly: true,
        reports,
        discrepancies: reports.reduce((total, report) => total + report.discrepancies.length, 0),
      };
    });
  }

  private async loadFacts(
    manager: EntityManager,
    transferId: string,
  ): Promise<TransferReconciliationFacts> {
    const transferRows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT id::text AS id,
               command_id::text AS command_id,
               status,
               source_customer_id::text AS source_customer_id,
               destination_customer_id::text AS destination_customer_id,
               source_wallet_id::text AS source_wallet_account_id,
               destination_wallet_id::text AS destination_wallet_account_id,
               source_ledger_account_id::text AS source_ledger_account_id,
               destination_ledger_account_id::text AS destination_ledger_account_id,
               amount_minor::text AS amount_minor,
               currency,
               accounting_unit,
               journal_id::text AS journal_id,
               request_hash,
               correlation_id,
               causation_id
          FROM transfers
         WHERE id = $1::uuid
      `,
      [transferId],
    );
    const transfer = transferRows[0] ? this.toTransferFact(transferRows[0]) : null;
    const expectedCorrelation = transfer?.correlationId ?? `transfer:${transferId}`;
    const journalRows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT j.id::text AS id,
               j.idempotency_key,
               j.currency,
               j.accounting_unit,
               j.total_minor::text AS total_minor,
               j.correlation_id,
               j.metadata->>'transferId' AS transfer_id
          FROM ledger_journals j
         WHERE j.id = $3::uuid
            OR j.metadata->>'transferId' = $1
            OR j.correlation_id = $2
         ORDER BY j.id
      `,
      [transferId, expectedCorrelation, transfer?.journalId ?? transferId],
    );
    const journalCandidates = journalRows.map((row) => this.toJournalFact(row));
    const journal = transfer?.journalId
      ? (journalCandidates.find((candidate) => candidate.id === transfer.journalId) ?? null)
      : null;
    const lines = journal
      ? (
          await this.queryRows<SqlRow>(
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
               ORDER BY line_number
            `,
            [journal.id],
          )
        ).map((row) => this.toLineFact(row))
      : [];
    const outboxEvents = (
      await this.queryRows<SqlRow>(
        manager,
        `
          SELECT id::text AS id,
                 event_key,
                 event_type,
                 schema_version,
                 aggregate_type,
                 aggregate_id::text AS aggregate_id,
                 correlation_id,
                 causation_id,
                 payload
            FROM outbox_events
           WHERE aggregate_type = 'TRANSFER'
             AND aggregate_id = $1::uuid
           ORDER BY id
        `,
        [transferId],
      )
    ).map((row) => this.toOutboxFact(row));
    const auditEvents = (
      await this.queryRows<SqlRow>(
        manager,
        `
          SELECT id::text AS id,
                 entity_type,
                 entity_id::text AS entity_id,
                 action,
                 correlation_id,
                 new_values
            FROM audit_events
           WHERE entity_type = 'TRANSFER'
             AND entity_id = $1::uuid
           ORDER BY occurred_at, id
        `,
        [transferId],
      )
    ).map((row) => this.toAuditFact(row));

    return { transfer, journal, journalCandidates, lines, outboxEvents, auditEvents };
  }

  private toTransferFact(row: SqlRow): TransferReconciliationTransferFact {
    return {
      id: this.textValue(row.id),
      commandId: this.nullableText(row.command_id),
      status: this.textValue(row.status) as TransferStatus,
      sourceCustomerId: this.nullableText(row.source_customer_id),
      destinationCustomerId: this.nullableText(row.destination_customer_id),
      sourceWalletAccountId: this.textValue(row.source_wallet_account_id),
      destinationWalletAccountId: this.textValue(row.destination_wallet_account_id),
      sourceLedgerAccountId: this.nullableText(row.source_ledger_account_id),
      destinationLedgerAccountId: this.nullableText(row.destination_ledger_account_id),
      amountMinor: this.textValue(row.amount_minor),
      currency: this.textValue(row.currency),
      accountingUnit: this.nullableText(row.accounting_unit),
      journalId: this.nullableText(row.journal_id),
      requestHash: this.textValue(row.request_hash),
      correlationId: this.nullableText(row.correlation_id),
      causationId: this.nullableText(row.causation_id),
    };
  }

  private toJournalFact(row: SqlRow): TransferReconciliationJournalFact {
    return {
      id: this.textValue(row.id),
      idempotencyKey: this.textValue(row.idempotency_key),
      currency: this.textValue(row.currency),
      accountingUnit: this.textValue(row.accounting_unit),
      totalMinor: this.textValue(row.total_minor),
      correlationId: this.nullableText(row.correlation_id),
      transferId: this.nullableText(row.transfer_id),
    };
  }

  private toLineFact(row: SqlRow): TransferReconciliationLineFact {
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

  private toOutboxFact(row: SqlRow): TransferReconciliationOutboxFact {
    return {
      id: this.textValue(row.id),
      eventKey: this.nullableText(row.event_key),
      eventType: this.textValue(row.event_type),
      schemaVersion: this.numberValue(row.schema_version),
      aggregateType: this.textValue(row.aggregate_type),
      aggregateId: this.textValue(row.aggregate_id),
      correlationId: this.nullableText(row.correlation_id),
      causationId: this.nullableText(row.causation_id),
      payload: this.objectValue(row.payload),
    };
  }

  private toAuditFact(row: SqlRow): TransferReconciliationAuditFact {
    return {
      id: this.textValue(row.id),
      entityType: this.textValue(row.entity_type),
      entityId: this.textValue(row.entity_id),
      action: this.textValue(row.action),
      correlationId: this.nullableText(row.correlation_id),
      newValues: this.nullableObjectValue(row.new_values),
    };
  }

  private async queryRows<T extends SqlRow>(
    executor: EntityManager,
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    return executor.query(sql, parameters);
  }

  private aggregateStatus(
    reports: readonly TransferReconciliationReport[],
  ): TransferReconciliationStatus {
    if (reports.some((report) => report.status === 'ERROR')) return 'ERROR';
    if (reports.some((report) => report.status === 'WARNING')) return 'WARNING';
    return 'PASS';
  }

  private normalizeUuid(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) throw new BadRequestException('transferId must be a UUID');
    return normalized;
  }

  private textValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return typeof value === 'bigint' ? value.toString() : (JSON.stringify(value) ?? '');
  }

  private nullableText(value: unknown): string | null {
    const text = this.textValue(value);
    return text.length > 0 ? text : null;
  }

  private numberValue(value: unknown): number {
    const parsed = Number(this.textValue(value));
    return Number.isFinite(parsed) ? parsed : 0;
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

  private nullableObjectValue(value: unknown): Record<string, unknown> | null {
    if (value === null || value === undefined) return null;
    return this.objectValue(value);
  }
}

export function evaluateTransferReconciliation(
  facts: TransferReconciliationFacts,
  generatedAt = new Date().toISOString(),
): TransferReconciliationReport {
  const transfer = facts.transfer;
  const discrepancies: TransferReconciliationDiscrepancy[] = [];
  if (!transfer) {
    addDiscrepancy(
      discrepancies,
      facts,
      TransferReconciliationDiscrepancyCode.TRANSFER_NOT_FOUND,
      'ERROR',
      'The requested internal transfer does not exist',
    );
    for (let index = 0; index < facts.journalCandidates.length; index += 1) {
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.ORPHAN_JOURNAL,
        'ERROR',
        'A Ledger journal candidate has no matching transfer',
      );
    }
    return makeReport(facts, generatedAt, discrepancies);
  }

  if (transfer.status !== TransferStatus.COMPLETED) {
    if (facts.journalCandidates.length > 0 || facts.journal) {
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.ORPHAN_JOURNAL,
        'ERROR',
        'A non-completed transfer has Ledger journal evidence',
      );
    }
    return makeReport(facts, generatedAt, discrepancies);
  }

  if (!transfer.journalId) {
    addDiscrepancy(
      discrepancies,
      facts,
      TransferReconciliationDiscrepancyCode.ORPHAN_TRANSFER,
      'ERROR',
      'A completed transfer has no journal reference',
    );
  } else if (!facts.journal) {
    addDiscrepancy(
      discrepancies,
      facts,
      TransferReconciliationDiscrepancyCode.MISSING_JOURNAL,
      'ERROR',
      'The transfer journal reference does not resolve to a Ledger journal',
    );
  }
  if (facts.journalCandidates.length > 1) {
    addDiscrepancy(
      discrepancies,
      facts,
      TransferReconciliationDiscrepancyCode.DUPLICATE_JOURNAL,
      'ERROR',
      'Multiple Ledger journals correlate to one transfer',
    );
  }

  const journal = facts.journal;
  if (journal) {
    const expectedCorrelation = transfer.correlationId ?? `transfer:${transfer.id}`;
    if (journal.correlationId !== expectedCorrelation || journal.transferId !== transfer.id) {
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.JOURNAL_CORRELATION_MISMATCH,
        'ERROR',
        'The Ledger journal correlation does not match the transfer',
      );
    }
    if (
      journal.currency !== transfer.currency ||
      facts.lines.some((line) => line.currency !== transfer.currency)
    ) {
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.CURRENCY_MISMATCH,
        'ERROR',
        'Transfer, journal, and journal lines do not use one currency',
      );
    }
    if (
      journal.accountingUnit !== transfer.accountingUnit ||
      facts.lines.some((line) => line.accountingUnit !== transfer.accountingUnit)
    ) {
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.ACCOUNTING_UNIT_MISMATCH,
        'ERROR',
        'Transfer, journal, and journal lines do not use one accounting unit',
      );
    }
    if (facts.lines.length !== 2) {
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.JOURNAL_LINE_COUNT_MISMATCH,
        'ERROR',
        'The transfer journal does not contain exactly two lines',
      );
    }
    const sourceLine = facts.lines.find(
      (line) => line.accountId === transfer.sourceLedgerAccountId && line.direction === 'DEBIT',
    );
    const destinationLine = facts.lines.find(
      (line) =>
        line.accountId === transfer.destinationLedgerAccountId && line.direction === 'CREDIT',
    );
    if (!sourceLine)
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.SOURCE_ACCOUNT_MISMATCH,
        'ERROR',
        'The source debit line does not match the transfer source Ledger account',
      );
    if (!destinationLine)
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.DESTINATION_ACCOUNT_MISMATCH,
        'ERROR',
        'The destination credit line does not match the transfer destination Ledger account',
      );
    const debits = facts.lines
      .filter((line) => line.direction === 'DEBIT')
      .reduce((total, line) => total + BigInt(line.amountMinor), 0n);
    const credits = facts.lines
      .filter((line) => line.direction === 'CREDIT')
      .reduce((total, line) => total + BigInt(line.amountMinor), 0n);
    if (debits !== credits)
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.DEBIT_CREDIT_UNBALANCED,
        'ERROR',
        'Journal debit and credit totals differ',
      );
    if (
      journal.totalMinor !== transfer.amountMinor ||
      sourceLine?.amountMinor !== transfer.amountMinor ||
      destinationLine?.amountMinor !== transfer.amountMinor
    ) {
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.AMOUNT_MISMATCH,
        'ERROR',
        'Transfer amount does not match journal total and lines',
      );
    }
  }

  const expectedEventKey = `transfer.completed:${transfer.id}:v1`;
  const completedEvents = facts.outboxEvents.filter(
    (event) => event.eventType === 'transfer.completed',
  );
  if (completedEvents.length === 0) {
    addDiscrepancy(
      discrepancies,
      facts,
      TransferReconciliationDiscrepancyCode.MISSING_OUTBOX_EVENT,
      'ERROR',
      'Completed transfer has no transfer.completed outbox event',
    );
  } else {
    if (completedEvents.length > 1)
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.DUPLICATE_OUTBOX_EVENT,
        'ERROR',
        'Completed transfer has duplicate transfer.completed outbox events',
      );
    const event = (completedEvents.find((candidate) => candidate.eventKey === expectedEventKey) ??
      completedEvents[0])!;
    const payload = event.payload;
    const payloadMatches =
      event.eventKey === expectedEventKey &&
      event.schemaVersion === 1 &&
      event.aggregateType === 'TRANSFER' &&
      event.aggregateId === transfer.id &&
      payload.eventKey === expectedEventKey &&
      payload.eventType === 'transfer.completed' &&
      payload.schemaVersion === 1 &&
      payload.transferId === transfer.id &&
      payload.commandId === transfer.commandId &&
      payload.journalId === transfer.journalId &&
      payload.amountMinor === transfer.amountMinor &&
      payload.currency === transfer.currency &&
      payload.accountingUnit === transfer.accountingUnit &&
      payload.requestHash === transfer.requestHash;
    if (!payloadMatches)
      addDiscrepancy(
        discrepancies,
        facts,
        TransferReconciliationDiscrepancyCode.OUTBOX_PAYLOAD_MISMATCH,
        'ERROR',
        'The transfer.completed outbox identity or payload does not match the transfer',
      );
  }

  const postedAudits = facts.auditEvents.filter(
    (event) =>
      event.entityType === 'TRANSFER' &&
      event.entityId === transfer.id &&
      event.action === 'LEDGER_POSTED',
  );
  if (postedAudits.length === 0) {
    addDiscrepancy(
      discrepancies,
      facts,
      TransferReconciliationDiscrepancyCode.MISSING_AUDIT_EVENT,
      'ERROR',
      'Completed transfer has no LEDGER_POSTED audit evidence',
    );
  } else if (!postedAudits.some((event) => event.correlationId === transfer.correlationId)) {
    addDiscrepancy(
      discrepancies,
      facts,
      TransferReconciliationDiscrepancyCode.AUDIT_CORRELATION_MISMATCH,
      'ERROR',
      'Transfer audit evidence does not use the transfer correlation ID',
    );
  }
  return makeReport(facts, generatedAt, discrepancies);
}

function makeReport(
  facts: TransferReconciliationFacts,
  generatedAt: string,
  discrepancies: TransferReconciliationDiscrepancy[],
): TransferReconciliationReport {
  const transfer = facts.transfer;
  const trace: TransferReconciliationTrace = {
    transferId: transfer?.id ?? null,
    commandId: transfer?.commandId ?? null,
    sourceCustomerId: transfer?.sourceCustomerId ?? null,
    destinationCustomerId: transfer?.destinationCustomerId ?? null,
    sourceLedgerAccountId: transfer?.sourceLedgerAccountId ?? null,
    destinationLedgerAccountId: transfer?.destinationLedgerAccountId ?? null,
    journalId: transfer?.journalId ?? null,
    outboxEventIds: facts.outboxEvents.map((event) => event.id).sort(),
    auditEventIds: facts.auditEvents.map((event) => event.id).sort(),
    correlationId: transfer?.correlationId ?? null,
    causationId: transfer?.causationId ?? null,
  };
  const sorted = [...discrepancies].sort((left, right) =>
    `${left.code}:${left.journalId ?? ''}:${left.outboxEventId ?? ''}`.localeCompare(
      `${right.code}:${right.journalId ?? ''}:${right.outboxEventId ?? ''}`,
    ),
  );
  return {
    status: sorted.length === 0 ? 'PASS' : 'ERROR',
    generatedAt,
    readOnly: true,
    transfer,
    trace,
    discrepancies: sorted,
  };
}

function addDiscrepancy(
  discrepancies: TransferReconciliationDiscrepancy[],
  facts: TransferReconciliationFacts,
  code: TransferReconciliationDiscrepancyCode,
  severity: 'WARNING' | 'ERROR',
  message: string,
): void {
  discrepancies.push({
    code,
    severity,
    message,
    transferId: facts.transfer?.id ?? null,
    journalId:
      facts.transfer?.journalId ?? facts.journal?.id ?? facts.journalCandidates[0]?.id ?? null,
    outboxEventId: facts.outboxEvents[0]?.id ?? null,
    auditEventId: facts.auditEvents[0]?.id ?? null,
  });
}
