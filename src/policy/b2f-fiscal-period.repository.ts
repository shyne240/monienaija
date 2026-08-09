import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import {
  B2F_ACCOUNTING_BASIS,
  B2F_ACCOUNTING_UNIT,
  B2F_BOOK_KEY,
  B2F_BOOK_VERSION,
  B2F_CALENDAR_KEY,
  B2F_CALENDAR_VERSION,
  B2F_FUNCTIONAL_CURRENCY,
  B2F_FISCAL_YEAR_REFERENCE_PREFIX,
  B2F_JURISDICTION,
  B2F_LEGAL_ENTITY_REFERENCE,
  B2F_PERIOD_ACTIONS,
  B2F_PERIOD_DECISION_REFERENCE_PREFIX,
  B2F_PERIOD_REFERENCE_PREFIX,
} from './b2f-fiscal-period.constants';
import { B2FFinanceAccountingPeriod } from './b2f-accounting-period.entity';
import type {
  B2FAccountingPeriodState,
  B2FAccountingPeriodViewV1,
  B2FFiscalPeriodCompatibilityResultV1,
  B2FFiscalPeriodFailureV1,
  B2FFiscalYearCreateCommandV1,
  B2FFiscalYearViewV1,
  B2FPeriodAdmissionDecisionV1,
  B2FPeriodAdmissionRequestV1,
  B2FPeriodTransitionCommandV1,
} from './b2f-fiscal-period.types';
import { B2FFinanceFiscalYear } from './b2f-fiscal-year.entity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[\x20-\x7e]{1,255}$/;

export function b2fStableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => b2fStableJson(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${b2fStableJson(object[key])}`)
    .join(',')}}`;
}

export function b2fSha256(value: unknown): string {
  return createHash('sha256').update(b2fStableJson(value), 'utf8').digest('hex');
}

@Injectable()
export class B2FFiscalPeriodRepository {
  computeCreateRequestHash(command: B2FFiscalYearCreateCommandV1): string {
    return b2fSha256({
      fiscalYear: command.fiscalYear,
      bookKey: B2F_BOOK_KEY,
      bookVersion: B2F_BOOK_VERSION,
      legalEntityReference: B2F_LEGAL_ENTITY_REFERENCE,
      jurisdiction: B2F_JURISDICTION,
      accountingBasis: B2F_ACCOUNTING_BASIS,
      functionalCurrency: B2F_FUNCTIONAL_CURRENCY,
      accountingUnit: B2F_ACCOUNTING_UNIT,
      calendarKey: B2F_CALENDAR_KEY,
      calendarVersion: B2F_CALENDAR_VERSION,
      idempotencyKey: command.idempotencyKey,
    });
  }

  computeTransitionRequestHash(command: B2FPeriodTransitionCommandV1): string {
    return b2fSha256({
      periodReference: command.periodReference,
      targetState: command.targetState,
      expectedRecordVersion: command.expectedRecordVersion,
      idempotencyKey: command.idempotencyKey,
      approvalId: command.approvalId,
      reason: command.reason.trim(),
      controlEvidence: command.controlEvidence,
    });
  }

  actionFor(target: B2FAccountingPeriodState): string | null {
    if (target === 'OPEN') return B2F_PERIOD_ACTIONS.OPEN;
    if (target === 'SOFT_CLOSED') return B2F_PERIOD_ACTIONS.SOFT_CLOSE;
    if (target === 'HARD_CLOSED') return B2F_PERIOD_ACTIONS.HARD_CLOSE;
    if (target === 'REOPENED') return B2F_PERIOD_ACTIONS.REOPEN;
    if (target === 'RETIRED') return B2F_PERIOD_ACTIONS.RETIRE;
    return null;
  }

  computeActionFingerprint(command: B2FPeriodTransitionCommandV1): string {
    return b2fSha256({
      action: this.actionFor(command.targetState),
      periodReference: command.periodReference,
      targetState: command.targetState,
      expectedRecordVersion: command.expectedRecordVersion,
      reason: command.reason.trim(),
      controlEvidence: command.controlEvidence,
    });
  }

  validateCreate(command: B2FFiscalYearCreateCommandV1): B2FFiscalPeriodCompatibilityResultV1 {
    if (
      !Number.isInteger(command.fiscalYear) ||
      command.fiscalYear < 2000 ||
      command.fiscalYear > 9999
    )
      return this.failure(
        'B2F_FISCAL_PERIOD_INVALID_COMMAND',
        'fiscalYear must be 2000..9999',
        'fiscalYear',
      );
    if (!command.idempotencyKey || command.idempotencyKey.length > 255)
      return this.failure(
        'B2F_FISCAL_PERIOD_INVALID_COMMAND',
        'idempotencyKey is required',
        'idempotencyKey',
      );
    if (!command.principal?.principalId || !KEY_PATTERN.test(command.principal.principalId))
      return this.failure(
        'B2F_FISCAL_PERIOD_INVALID_COMMAND',
        'principal is required',
        'principal',
      );
    if (!command.requestContext?.requestId || !command.requestContext?.correlationId)
      return this.failure(
        'B2F_FISCAL_PERIOD_INVALID_COMMAND',
        'request context is required',
        'requestContext',
      );
    return { compatible: true, failure: null };
  }

  buildDefinitions(
    command: B2FFiscalYearCreateCommandV1,
    now: Date,
  ): {
    fiscalYear: B2FFinanceFiscalYear;
    periods: B2FFinanceAccountingPeriod[];
  } {
    const year = command.fiscalYear;
    const fiscalYearKey = `finance.fiscal-year.ng.${year}`;
    const fiscalYearReference = `${B2F_FISCAL_YEAR_REFERENCE_PREFIX}-${b2fSha256({ fiscalYearKey, version: 1 }).slice(0, 32)}`;
    const fiscalYearDefinition = {
      fiscalYearKey,
      fiscalYearVersion: 1,
      fiscalYear: year,
      bookKey: B2F_BOOK_KEY,
      bookVersion: B2F_BOOK_VERSION,
      legalEntityReference: B2F_LEGAL_ENTITY_REFERENCE,
      jurisdiction: B2F_JURISDICTION,
      accountingBasis: B2F_ACCOUNTING_BASIS,
      functionalCurrency: B2F_FUNCTIONAL_CURRENCY,
      accountingUnit: B2F_ACCOUNTING_UNIT,
      calendarKey: B2F_CALENDAR_KEY,
      calendarVersion: B2F_CALENDAR_VERSION,
      startDate: `${year}-01-01`,
      endDateExclusive: `${year + 1}-01-01`,
    };
    const fiscal = Object.assign(new B2FFinanceFiscalYear(), {
      fiscalYearReference,
      ...fiscalYearDefinition,
      state: 'PLANNED' as const,
      definitionHash: b2fSha256(fiscalYearDefinition),
      createdBy: command.principal.principalId,
      lastCorrelationId: command.requestContext.correlationId,
      recordVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const periods = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const label = `${year}-${String(month).padStart(2, '0')}`;
      const nextYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      const startDate = `${label}-01`;
      const endDateExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
      const periodKey = `finance.period.ng.${label}`;
      const periodReference = `${B2F_PERIOD_REFERENCE_PREFIX}-${b2fSha256({ periodKey, version: 1 }).slice(0, 32)}`;
      const definition = {
        periodKey,
        periodVersion: 1,
        fiscalYearReference,
        periodNumber: month,
        periodLabel: label,
        startDate,
        endDateExclusive,
        cutoffAt: `${endDateExclusive}T00:00:00.000Z`,
      };
      return Object.assign(new B2FFinanceAccountingPeriod(), {
        periodReference,
        ...definition,
        fiscalYearId: fiscal.id,
        cutoffAt: new Date(definition.cutoffAt),
        state: 'PLANNED' as const,
        stateVersion: 1,
        definitionHash: b2fSha256(definition),
        lastDecisionHash: null,
        openedAt: null,
        softClosedAt: null,
        hardClosedAt: null,
        reopenedAt: null,
        reopenExpiresAt: null,
        retiredAt: null,
        lastApprovalId: null,
        lastReason: null,
        lastControlEvidence: {},
        lastCorrelationId: command.requestContext.correlationId,
        lastRequestId: command.requestContext.requestId,
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    });
    return { fiscalYear: fiscal, periods };
  }

  canTransition(current: B2FAccountingPeriodState, target: B2FAccountingPeriodState): boolean {
    const allowed: Record<B2FAccountingPeriodState, readonly B2FAccountingPeriodState[]> = {
      PLANNED: ['OPEN', 'RETIRED'],
      OPEN: ['SOFT_CLOSED', 'RETIRED'],
      SOFT_CLOSED: ['OPEN', 'HARD_CLOSED', 'RETIRED'],
      HARD_CLOSED: ['REOPENED', 'RETIRED'],
      REOPENED: ['SOFT_CLOSED'],
      RETIRED: [],
    };
    return allowed[current].includes(target);
  }

  validateTransition(
    period: B2FFinanceAccountingPeriod,
    command: B2FPeriodTransitionCommandV1,
    now: Date,
  ): B2FFiscalPeriodCompatibilityResultV1 {
    if (!this.actionFor(command.targetState))
      return this.failure(
        'B2F_FISCAL_PERIOD_INVALID_TRANSITION',
        'target state is not commandable',
        'targetState',
      );
    if (period.recordVersion !== command.expectedRecordVersion)
      return this.failure(
        'B2F_FISCAL_PERIOD_VERSION_CONFLICT',
        'period record version changed',
        'expectedRecordVersion',
      );
    if (!this.canTransition(period.state, command.targetState))
      return this.failure(
        'B2F_FISCAL_PERIOD_INVALID_TRANSITION',
        `invalid transition ${period.state} -> ${command.targetState}`,
        'targetState',
      );
    if (!UUID_PATTERN.test(command.approvalId))
      return this.failure(
        'B2F_FISCAL_PERIOD_APPROVAL_REQUIRED',
        'approvalId must be uuid',
        'approvalId',
      );
    if (!command.reason.trim() || command.reason.trim().length > 500)
      return this.failure('B2F_FISCAL_PERIOD_INVALID_COMMAND', 'reason is required', 'reason');
    if (
      !command.controlEvidence.legalEntityRatificationReference ||
      !command.controlEvidence.accountingPolicyApprovalReference
    )
      return this.failure(
        'B2F_FISCAL_PERIOD_CONTROL_EVIDENCE_REQUIRED',
        'legal entity and accounting policy evidence are required',
        'controlEvidence',
      );
    if (
      command.targetState === 'HARD_CLOSED' &&
      (!command.controlEvidence.reconciliationReference ||
        !command.controlEvidence.closeChecklistReference)
    )
      return this.failure(
        'B2F_FISCAL_PERIOD_CONTROL_EVIDENCE_REQUIRED',
        'hard close requires reconciliation and close checklist evidence',
        'controlEvidence',
      );
    if (command.targetState === 'REOPENED') {
      const expires = new Date(command.controlEvidence.reopenExpiresAt ?? '');
      if (
        !command.controlEvidence.correctionScope ||
        Number.isNaN(expires.getTime()) ||
        expires <= now
      )
        return this.failure(
          'B2F_FISCAL_PERIOD_REOPEN_INVALID',
          'reopen requires correction scope and future expiry',
          'controlEvidence',
        );
    }
    return { compatible: true, failure: null };
  }

  applyTransition(
    period: B2FFinanceAccountingPeriod,
    command: B2FPeriodTransitionCommandV1,
    now: Date,
    requestHash: string,
  ): string {
    const previous = period.state;
    period.state = command.targetState;
    period.stateVersion += 1;
    if (command.targetState === 'OPEN') period.openedAt = period.openedAt ?? now;
    if (command.targetState === 'SOFT_CLOSED') period.softClosedAt = now;
    if (command.targetState === 'HARD_CLOSED') period.hardClosedAt = now;
    if (command.targetState === 'REOPENED') {
      period.reopenedAt = now;
      period.reopenExpiresAt = new Date(command.controlEvidence.reopenExpiresAt!);
    } else period.reopenExpiresAt = null;
    if (command.targetState === 'RETIRED') period.retiredAt = now;
    period.lastApprovalId = command.approvalId;
    period.lastReason = command.reason.trim();
    period.lastControlEvidence = { ...command.controlEvidence };
    period.lastCorrelationId = command.requestContext.correlationId;
    period.lastRequestId = command.requestContext.requestId;
    period.lastDecisionHash = b2fSha256({
      periodReference: period.periodReference,
      previousState: previous,
      resultingState: period.state,
      stateVersion: period.stateVersion,
      requestHash,
      approvalId: command.approvalId,
    });
    period.updatedAt = now;
    return period.lastDecisionHash;
  }

  decisionReference(requestHash: string): string {
    return `${B2F_PERIOD_DECISION_REFERENCE_PREFIX}-${requestHash.slice(0, 32)}`;
  }

  evaluateAdmission(
    period: B2FFinanceAccountingPeriod | null,
    request: B2FPeriodAdmissionRequestV1,
  ): B2FPeriodAdmissionDecisionV1 {
    const evaluatedAt = request.evaluatedAt ?? new Date().toISOString();
    if (!period)
      return {
        outcome: 'BLOCKED',
        readOnly: true,
        periodReference: null,
        periodKey: request.periodKey,
        periodState: null,
        admissionKind: request.admissionKind,
        accountingDate: request.accountingDate,
        compatible: false,
        reason: 'PERIOD_NOT_FOUND',
        definitionHash: null,
        stateVersion: null,
        evaluatedAt,
      };
    const scopeCompatible =
      request.expectedBookKey === B2F_BOOK_KEY &&
      request.expectedBookVersion === 1 &&
      request.expectedLegalEntityReference === B2F_LEGAL_ENTITY_REFERENCE &&
      request.expectedCurrency === B2F_FUNCTIONAL_CURRENCY &&
      request.expectedAccountingUnit === B2F_ACCOUNTING_UNIT;
    const dateCompatible =
      request.accountingDate >= period.startDate &&
      request.accountingDate < period.endDateExclusive;
    const stateCompatible =
      (request.admissionKind === 'ORDINARY' && period.state === 'OPEN') ||
      (request.admissionKind === 'CLOSE_ADJUSTMENT' && period.state === 'SOFT_CLOSED') ||
      (request.admissionKind === 'REOPEN_CORRECTION' &&
        period.state === 'REOPENED' &&
        !!period.reopenExpiresAt &&
        new Date(evaluatedAt) <= period.reopenExpiresAt);
    const compatible = scopeCompatible && dateCompatible && stateCompatible;
    return {
      outcome: compatible ? 'ADMISSIBLE' : 'BLOCKED',
      readOnly: true,
      periodReference: period.periodReference,
      periodKey: period.periodKey,
      periodState: period.state,
      admissionKind: request.admissionKind,
      accountingDate: request.accountingDate,
      compatible,
      reason: !scopeCompatible
        ? 'SCOPE_INCOMPATIBLE'
        : !dateCompatible
          ? 'ACCOUNTING_DATE_OUTSIDE_PERIOD'
          : !stateCompatible
            ? 'PERIOD_LOCKED'
            : 'ADMISSIBLE',
      definitionHash: period.definitionHash,
      stateVersion: period.stateVersion,
      evaluatedAt,
    };
  }

  async findFiscalYear(
    source: DataSource | EntityManager,
    fiscalYearKey: string,
  ): Promise<B2FFinanceFiscalYear | null> {
    return source
      .getRepository(B2FFinanceFiscalYear)
      .findOne({ where: { fiscalYearKey, fiscalYearVersion: 1 } });
  }

  async findPeriodByReference(
    source: DataSource | EntityManager,
    reference: string,
    lock = false,
  ): Promise<B2FFinanceAccountingPeriod | null> {
    const builder = source
      .getRepository(B2FFinanceAccountingPeriod)
      .createQueryBuilder('period')
      .where('period.period_reference = :reference', { reference });
    if (lock) builder.setLock('pessimistic_write');
    return builder.getOne();
  }

  async findPeriodByKey(
    source: DataSource | EntityManager,
    key: string,
  ): Promise<B2FFinanceAccountingPeriod | null> {
    return source
      .getRepository(B2FFinanceAccountingPeriod)
      .findOne({ where: { periodKey: key, periodVersion: 1 } });
  }

  async listPeriods(
    source: DataSource | EntityManager,
    fiscalYearId: string,
  ): Promise<B2FFinanceAccountingPeriod[]> {
    return source
      .getRepository(B2FFinanceAccountingPeriod)
      .find({ where: { fiscalYearId }, order: { periodNumber: 'ASC' } });
  }

  toPeriodView(period: B2FFinanceAccountingPeriod): B2FAccountingPeriodViewV1 {
    return {
      periodReference: period.periodReference,
      periodKey: period.periodKey,
      periodVersion: 1,
      fiscalYearReference: period.fiscalYearReference,
      periodNumber: period.periodNumber,
      periodLabel: period.periodLabel,
      startDate: period.startDate,
      endDateExclusive: period.endDateExclusive,
      cutoffAt: period.cutoffAt.toISOString(),
      state: period.state,
      stateVersion: period.stateVersion,
      definitionHash: period.definitionHash,
      lastDecisionHash: period.lastDecisionHash,
      openedAt: period.openedAt?.toISOString() ?? null,
      softClosedAt: period.softClosedAt?.toISOString() ?? null,
      hardClosedAt: period.hardClosedAt?.toISOString() ?? null,
      reopenedAt: period.reopenedAt?.toISOString() ?? null,
      reopenExpiresAt: period.reopenExpiresAt?.toISOString() ?? null,
      retiredAt: period.retiredAt?.toISOString() ?? null,
      lastApprovalId: period.lastApprovalId,
      lastCorrelationId: period.lastCorrelationId,
      recordVersion: period.recordVersion,
      createdAt: period.createdAt.toISOString(),
      updatedAt: period.updatedAt.toISOString(),
    };
  }

  toFiscalYearView(
    fiscal: B2FFinanceFiscalYear,
    periods: B2FFinanceAccountingPeriod[],
  ): B2FFiscalYearViewV1 {
    return {
      fiscalYearReference: fiscal.fiscalYearReference,
      fiscalYearKey: fiscal.fiscalYearKey,
      fiscalYearVersion: 1,
      fiscalYear: fiscal.fiscalYear,
      state: fiscal.state,
      bookKey: B2F_BOOK_KEY,
      bookVersion: 1,
      legalEntityReference: B2F_LEGAL_ENTITY_REFERENCE,
      jurisdiction: B2F_JURISDICTION,
      accountingBasis: B2F_ACCOUNTING_BASIS,
      functionalCurrency: B2F_FUNCTIONAL_CURRENCY,
      accountingUnit: B2F_ACCOUNTING_UNIT,
      calendarKey: B2F_CALENDAR_KEY,
      calendarVersion: 1,
      startDate: fiscal.startDate,
      endDateExclusive: fiscal.endDateExclusive,
      definitionHash: fiscal.definitionHash,
      recordVersion: fiscal.recordVersion,
      createdAt: fiscal.createdAt.toISOString(),
      updatedAt: fiscal.updatedAt.toISOString(),
      periods: periods.map((period) => this.toPeriodView(period)),
    };
  }

  private failure(
    code: B2FFiscalPeriodFailureV1['code'],
    message: string,
    field: string | null,
  ): B2FFiscalPeriodCompatibilityResultV1 {
    return { compatible: false, failure: { code, message, field } };
  }
}
