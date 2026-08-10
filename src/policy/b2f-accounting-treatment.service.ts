import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ExternalSettlementService } from '../partner/external-settlement.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { B1BillingEngineService } from './b1-billing-engine.service';
import { B1CommercialAnalyticsEngineService } from './b1-commercial-analytics-engine.service';
import { B1FeeEngineService } from './b1-fee-engine.service';
import { B1RevenueRecognitionEngineService } from './b1-revenue-recognition-engine.service';
import { B2FFinanceAccountingTreatment } from './b2f-accounting-treatment.entity';
import type {
  B2FAccountingTreatmentCommandV1,
  B2FAccountingTreatmentConsumerPortsV1,
  B2FAccountingTreatmentDecisionV1,
  B2FSourceCategory,
  B2FSourceDecisionReferenceV1,
  B2FSourceVerificationResultV1,
} from './b2f-accounting-treatment.types';
import { B2FFinanceControlService } from './b2f-finance-control.service';
import { B2FFiscalPeriodService } from './b2f-fiscal-period.service';
import { B2FJournalGovernanceService } from './b2f-journal-governance.service';

const SCOPE = 'b2.finance.accounting-treatment.idempotency.v1',
  RETENTION = 86_400,
  HASH = /^[a-f0-9]{64}$/;
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}
function sha(v: unknown) {
  return createHash('sha256').update(stable(v)).digest('hex');
}
@Injectable()
export class B2FAccountingTreatmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly fee: B1FeeEngineService,
    private readonly billing: B1BillingEngineService,
    private readonly recognition: B1RevenueRecognitionEngineService,
    private readonly analytics: B1CommercialAnalyticsEngineService,
    private readonly settlement: ExternalSettlementService,
    private readonly periods: B2FFiscalPeriodService,
    private readonly controls: B2FFinanceControlService,
    private readonly journals: B2FJournalGovernanceService,
  ) {}
  getConsumerPorts(): B2FAccountingTreatmentConsumerPortsV1 {
    return {
      contractName: 'B2F-ACCOUNTING-TREATMENT',
      contractVersion: 1,
      getTreatment: (r) => this.getTreatment(r),
      getBySource: (c, r, v) => this.getBySource(c, r, v),
      verifySource: (s, e) => this.verifySource(s, e),
    };
  }
  computeRequestHash(c: B2FAccountingTreatmentCommandV1) {
    return sha({
      treatmentVersion: c.treatmentVersion,
      source: c.source,
      periodKey: c.periodKey,
      periodVersion: c.periodVersion,
      accountingDate: c.accountingDate,
      journalClassification: c.journalClassification,
      description: c.description.trim(),
      lines: [...c.lines].sort((a, b) => a.lineNumber - b.lineNumber),
      bookKey: 'finance.book.ng.primary',
      bookVersion: 1,
      legalEntityReference: 'finance.legal-entity.ng.primary',
      accountingBasis: 'ACCRUAL',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      makerPrincipalId: c.makerPrincipalId,
      makerRoles: [...c.makerRoles].sort(),
      approvalIds: c.approvals.map((a) => a.id).sort(),
      overrideEvidenceReference: c.overrideEvidenceReference ?? null,
      idempotencyKey: c.idempotencyKey,
    });
  }
  async adopt(command: B2FAccountingTreatmentCommandV1): Promise<B2FAccountingTreatmentDecisionV1> {
    const requestHash = this.computeRequestHash(command);
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const reservation = await this.idempotency.reserve(manager, {
        scope: SCOPE,
        key: command.idempotencyKey,
        requestHash,
        retentionSeconds: RETENTION,
      });
      if (reservation.kind === 'REPLAY') {
        const body = reservation.record.responseBody as unknown as B2FAccountingTreatmentDecisionV1;
        if (!body) throw new ConflictException('Accounting treatment replay body missing');
        return { ...body, replayed: true };
      }
      const now = command.evaluatedAt ?? new Date();
      const source = await this.verifySource(command.source, now);
      const failures = [...source.reasons];
      if (
        source.status === 'NOT_VERIFIED_REQUIRES_REVIEW' ||
        !source.authoritative ||
        !source.current
      )
        failures.push('SOURCE_NOT_ADOPTABLE');
      const admission = await this.periods.checkAdmission({
        periodKey: command.periodKey,
        accountingDate: command.accountingDate,
        admissionKind:
          command.journalClassification === 'CLOSE_ADJUSTMENT'
            ? 'CLOSE_ADJUSTMENT'
            : command.journalClassification === 'REOPEN_CORRECTION'
              ? 'REOPEN_CORRECTION'
              : 'ORDINARY',
        expectedBookKey: 'finance.book.ng.primary',
        expectedBookVersion: 1,
        expectedLegalEntityReference: 'finance.legal-entity.ng.primary',
        expectedCurrency: 'NGN',
        expectedAccountingUnit: 'CUSTOMER_FUNDS',
        evaluatedAt: now.toISOString(),
      });
      if (!admission.compatible) failures.push(`PERIOD_${admission.reason}`);
      const treatmentReference = `b2f-treatment-${requestHash.slice(0, 32)}`;
      let controlReference: string | null = null;
      if (!failures.length) {
        const control = await this.controls.evaluate({
          action: 'FINANCE_ACCOUNTING_TREATMENT_ADOPT',
          amountMinor: this.totalDebit(command.lines),
          resourceType: 'B2F_FINANCE_ACCOUNTING_TREATMENT',
          resourceId: treatmentReference,
          resourceVersion: 1,
          resourceHash: requestHash,
          makerPrincipalId: command.makerPrincipalId,
          makerRoles: command.makerRoles,
          executorPrincipal: command.principal,
          approvals: command.approvals,
          overrideEvidenceReference: command.overrideEvidenceReference,
          idempotencyKey: `${command.idempotencyKey}:control`,
          requestContext: command.requestContext,
          evaluatedAt: now,
        });
        controlReference = control.decisionReference;
        if (control.outcome !== 'ALLOW')
          failures.push(...control.reasons.map((r) => `CONTROL_${r}`));
      }
      let financeJournalReference: string | null = null,
        state: B2FAccountingTreatmentDecisionV1['state'] = failures.length ? 'REJECTED' : 'ADOPTED';
      if (!failures.length) {
        const journal = await this.journals.createJournal({
          classification: command.journalClassification,
          periodKey: command.periodKey,
          periodVersion: 1,
          accountingDate: command.accountingDate,
          description: command.description,
          sourceDocument: {
            sourceKind: command.source.category,
            sourceOwner: command.source.sourceOwner,
            sourceReference: command.source.sourceReference,
            sourceVersion: 1,
            sourceHash: command.source.sourceHash,
            sourceOccurredAt: command.source.effectiveAt,
          },
          lines: command.lines,
          idempotencyKey: `${command.idempotencyKey}:journal`,
          principal: command.principal,
          requestContext: command.requestContext,
          causationId: command.causationId,
          now,
        });
        if (journal.outcome !== 'CREATED' && journal.outcome !== 'REPLAYED')
          failures.push(`JOURNAL_${journal.failure?.code ?? 'REJECTED'}`);
        else {
          financeJournalReference = journal.journal?.financeJournalReference ?? null;
          state = 'JOURNAL_DRAFT_CREATED';
        }
      }
      if (failures.length) state = 'REJECTED';
      const payload = {
        treatmentReference,
        treatmentVersion: 1 as const,
        state,
        source: command.source,
        sourceVerification: source,
        bookKey: 'finance.book.ng.primary' as const,
        bookVersion: 1 as const,
        legalEntityReference: 'finance.legal-entity.ng.primary' as const,
        accountingBasis: 'ACCRUAL' as const,
        currency: 'NGN' as const,
        accountingUnit: 'CUSTOMER_FUNDS' as const,
        periodKey: command.periodKey,
        periodVersion: 1 as const,
        accountingDate: command.accountingDate,
        lines: command.lines,
        requestHash,
        controlDecisionReference: controlReference,
        financeJournalReference,
        failureReasons: [...new Set(failures)].sort(),
        correlationId: command.requestContext.correlationId,
        createdAt: now.toISOString(),
        replayed: false,
      };
      const decisionHash = sha(payload);
      const decision: B2FAccountingTreatmentDecisionV1 = { ...payload, decisionHash };
      const entity = manager.getRepository(B2FFinanceAccountingTreatment).create({
        id: randomUUID(),
        treatmentReference,
        treatmentVersion: 1,
        state,
        sourceCategory: command.source.category,
        sourceOwner: command.source.sourceOwner,
        sourceReference: command.source.sourceReference,
        sourceVersion: 1,
        sourceHash: command.source.sourceHash,
        sourceEffectiveAt: new Date(command.source.effectiveAt),
        bookKey: 'finance.book.ng.primary',
        bookVersion: 1,
        legalEntityReference: 'finance.legal-entity.ng.primary',
        accountingBasis: 'ACCRUAL',
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        periodKey: command.periodKey,
        periodVersion: 1,
        accountingDate: command.accountingDate,
        requestHash,
        decisionHash,
        controlDecisionReference: controlReference,
        financeJournalReference,
        decision,
        correlationId: command.requestContext.correlationId,
        createdAt: now,
      });
      const saved = await manager.getRepository(B2FFinanceAccountingTreatment).save(entity);
      await this.audit.record(manager, {
        entityType: 'B2F_FINANCE_ACCOUNTING_TREATMENT',
        entityId: saved.id,
        action: state === 'REJECTED' ? 'FINANCE_TREATMENT_REJECTED' : 'FINANCE_TREATMENT_ADOPTED',
        actor: command.principal.principalId,
        correlationId: command.requestContext.correlationId,
        newValues: {
          treatmentReference,
          state,
          sourceCategory: command.source.category,
          sourceReference: command.source.sourceReference,
          sourceVerificationStatus: source.status,
          controlDecisionReference: controlReference,
          financeJournalReference,
          failureReasons: decision.failureReasons,
        },
      });
      await this.idempotency.complete(manager, reservation.record.id, {
        statusCode: state === 'REJECTED' ? 422 : 201,
        responseBody: decision as unknown as Record<string, unknown>,
        resourceType: 'B2F_FINANCE_ACCOUNTING_TREATMENT',
        resourceId: saved.id,
      });
      return decision;
    });
  }
  async verifySource(
    source: B2FSourceDecisionReferenceV1,
    evaluatedAt = new Date(),
  ): Promise<B2FSourceVerificationResultV1> {
    const reasons: string[] = [];
    if (!HASH.test(source.sourceHash) || !source.sourceReference || source.sourceVersion !== 1)
      return this.verification('NOT_VERIFIED_REQUIRES_REVIEW', false, false, null, {}, [
        'SOURCE_IDENTITY_INVALID',
      ]);
    const effective = new Date(source.effectiveAt),
      expires = source.expiresAt ? new Date(source.expiresAt) : null;
    const current =
      !Number.isNaN(effective.getTime()) &&
      effective <= evaluatedAt &&
      (!expires || expires > evaluatedAt);
    if (!current) reasons.push('SOURCE_STALE_OR_NOT_EFFECTIVE');
    try {
      const record = await this.readSource(source);
      if (!record)
        return this.verification(
          source.category === 'A7_PRODUCT_FINANCIAL_EFFECT'
            ? 'NOT_VERIFIED_REQUIRES_REVIEW'
            : 'VERIFIED_READ_ONLY',
          false,
          current,
          null,
          {},
          [
            source.category === 'A7_PRODUCT_FINANCIAL_EFFECT'
              ? 'A7_CANONICAL_READ_INTERFACE_NOT_VERIFIED'
              : 'SOURCE_NOT_FOUND',
            ...reasons,
          ],
        );
      const actualHash = this.extractHash(record);
      if (actualHash !== source.sourceHash) reasons.push('SOURCE_HASH_MISMATCH');
      const dimensions = this.extractDimensions(record);
      if (dimensions.currency && dimensions.currency !== 'NGN')
        reasons.push('SOURCE_CURRENCY_INCOMPATIBLE');
      if (dimensions.accountingUnit && dimensions.accountingUnit !== 'CUSTOMER_FUNDS')
        reasons.push('SOURCE_ACCOUNTING_UNIT_INCOMPATIBLE');
      return this.verification(
        'VERIFIED_READ_ONLY',
        reasons.length === 0,
        current,
        actualHash,
        record,
        reasons,
        dimensions.amountMinor,
        dimensions.currency,
        dimensions.accountingUnit,
      );
    } catch {
      return this.verification('NOT_VERIFIED_REQUIRES_REVIEW', false, current, null, {}, [
        'SOURCE_QUERY_UNAVAILABLE',
        ...reasons,
      ]);
    }
  }
  private async readSource(
    source: B2FSourceDecisionReferenceV1,
  ): Promise<Record<string, unknown> | null> {
    if (source.sourceOwner === 'B1') {
      let record: unknown = null;
      if (source.category === 'B1_COMMERCIAL_DECISION')
        record = await this.fee.getPersistenceRecordByReference(source.sourceReference, 1);
      else if (['B1_BILLING_RECORD', 'B1_INVOICE'].includes(source.category))
        record = await this.billing.getPersistenceRecordByReference(source.sourceReference, 1);
      else if (
        ['B1_REVENUE_RECOGNITION', 'B1_TAX_VAT', 'B1_COST_ACCOUNTING'].includes(source.category)
      )
        record = await this.recognition.getPersistenceRecordByReference(source.sourceReference, 1);
      else if (['B1_PROFITABILITY', 'B1_COMMERCIAL_RECONCILIATION'].includes(source.category))
        record = await this.analytics.getPersistenceRecordByReference(source.sourceReference, 1);
      return record as Record<string, unknown> | null;
    }
    if (source.sourceOwner === 'A6') {
      const operation = source.lookupReference;
      if (!operation) return null;
      if (source.category === 'A6_SETTLEMENT') {
        const settlement = await this.settlement.getByOperation(operation);
        return settlement as unknown as Record<string, unknown> | null;
      }
      if (source.category === 'A6_SUSPENSE') {
        const entries = await this.settlement.getSuspenseForOperation(operation);
        return (entries.find((e) => e.suspenseId === source.sourceReference) ??
          null) as unknown as Record<string, unknown> | null;
      }
    }
    return null;
  }
  private extractHash(record: Record<string, unknown>): string | null {
    for (const key of [
      'decisionHash',
      'documentHash',
      'definitionHash',
      'evidenceHash',
      'requestHash',
    ]) {
      const v = record[key];
      if (typeof v === 'string' && HASH.test(v)) return v;
    }
    const nested = record.record;
    if (nested && typeof nested === 'object')
      return this.extractHash(nested as Record<string, unknown>);
    const evidence = record.evidence;
    if (evidence && typeof evidence === 'object')
      return this.extractHash(evidence as Record<string, unknown>);
    return null;
  }
  private extractDimensions(record: Record<string, unknown>) {
    const nested = (
      record.record && typeof record.record === 'object' ? record.record : record
    ) as Record<string, unknown>;
    const string = (...keys: string[]) => {
      for (const k of keys) {
        const v = nested[k] ?? record[k];
        if (typeof v === 'string') return v;
      }
      return null;
    };
    return {
      amountMinor: string('amountMinor', 'baseAmountMinor', 'recognizedAmountMinor', 'totalMinor'),
      currency: string('currency', 'baseCurrency'),
      accountingUnit: string('accountingUnit'),
    };
  }
  private verification(
    status: B2FSourceVerificationResultV1['status'],
    authoritative: boolean,
    current: boolean,
    sourceHash: string | null,
    provenance: Record<string, unknown>,
    reasons: string[],
    amountMinor: string | null = null,
    currency: string | null = null,
    accountingUnit: string | null = null,
  ): B2FSourceVerificationResultV1 {
    return {
      status,
      authoritative,
      current,
      sourceHash,
      amountMinor,
      currency,
      accountingUnit,
      provenance,
      reasons: [...new Set(reasons)].sort(),
    };
  }
  private totalDebit(lines: B2FAccountingTreatmentCommandV1['lines']) {
    return lines
      .filter((l) => l.direction === 'DEBIT')
      .reduce((n, l) => n + BigInt(l.amountMinor), 0n)
      .toString();
  }
  async getTreatment(reference: string) {
    const row = await this.dataSource
      .getRepository(B2FFinanceAccountingTreatment)
      .findOne({ where: { treatmentReference: reference } });
    return row?.decision ?? null;
  }
  async getBySource(category: B2FSourceCategory, reference: string, version: 1) {
    const row = await this.dataSource.getRepository(B2FFinanceAccountingTreatment).findOne({
      where: { sourceCategory: category, sourceReference: reference, sourceVersion: version },
    });
    return row?.decision ?? null;
  }
}
