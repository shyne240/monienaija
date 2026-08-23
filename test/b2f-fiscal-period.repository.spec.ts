import { randomUUID } from 'node:crypto';

import {
  B2F_ACCOUNTING_UNIT,
  B2F_BOOK_KEY,
  B2F_FUNCTIONAL_CURRENCY,
  B2F_LEGAL_ENTITY_REFERENCE,
} from '../src/policy/b2f-fiscal-period.constants';
import { B2FFiscalPeriodRepository } from '../src/policy/b2f-fiscal-period.repository';
import type {
  B2FFiscalYearCreateCommandV1,
  B2FPeriodTransitionCommandV1,
} from '../src/policy/b2f-fiscal-period.types';

const principal = {
  type: 'PRIVILEGED' as const,
  principalId: 'finance-operator',
  roles: ['FINANCE_OPERATOR'],
  scopes: ['privileged:execute'],
  customerAccess: 'NONE' as const,
  assuranceLevel: 'MFA' as const,
};
const context = { requestId: randomUUID(), correlationId: randomUUID(), traceId: randomUUID() };
const createCommand = (
  overrides: Partial<B2FFiscalYearCreateCommandV1> = {},
): B2FFiscalYearCreateCommandV1 => ({
  fiscalYear: 2027,
  idempotencyKey: randomUUID(),
  principal,
  requestContext: context,
  ...overrides,
});
const transitionCommand = (
  overrides: Partial<B2FPeriodTransitionCommandV1> = {},
): B2FPeriodTransitionCommandV1 => ({
  periodReference: 'b2f-period-reference',
  targetState: 'OPEN',
  expectedRecordVersion: 1,
  idempotencyKey: randomUUID(),
  approvalId: randomUUID(),
  principal,
  reason: 'Open the approved period',
  controlEvidence: {
    legalEntityRatificationReference: 'legal-ratification-1',
    accountingPolicyApprovalReference: 'accounting-policy-approval-1',
  },
  requestContext: context,
  ...overrides,
});

describe('B2F fiscal period repository (B2F04)', () => {
  const repository = new B2FFiscalPeriodRepository();

  it('creates a deterministic fiscal year identity and twelve UTC monthly periods', () => {
    const command = createCommand({ idempotencyKey: 'same-key' });
    const first = repository.buildDefinitions(command, new Date('2026-08-09T00:00:00.000Z'));
    const second = repository.buildDefinitions(command, new Date('2026-09-01T00:00:00.000Z'));
    expect(first.fiscalYear.fiscalYearReference).toBe(second.fiscalYear.fiscalYearReference);
    expect(first.fiscalYear.definitionHash).toBe(second.fiscalYear.definitionHash);
    expect(first.periods).toHaveLength(12);
    expect(first.periods[0]!).toMatchObject({
      periodKey: 'finance.period.ng.2027-01',
      periodNumber: 1,
      startDate: '2027-01-01',
      endDateExclusive: '2027-02-01',
      state: 'PLANNED',
    });
    expect(first.periods[11]!).toMatchObject({
      periodKey: 'finance.period.ng.2027-12',
      periodNumber: 12,
      startDate: '2027-12-01',
      endDateExclusive: '2028-01-01',
    });
    expect(first.periods[11]!.cutoffAt.toISOString()).toBe('2028-01-01T00:00:00.000Z');
  });

  it('uses the frozen book, legal entity, basis, currency, unit, and calendar', () => {
    const { fiscalYear } = repository.buildDefinitions(createCommand(), new Date());
    expect(fiscalYear).toMatchObject({
      bookKey: B2F_BOOK_KEY,
      bookVersion: 1,
      legalEntityReference: B2F_LEGAL_ENTITY_REFERENCE,
      jurisdiction: 'NG',
      accountingBasis: 'ACCRUAL',
      functionalCurrency: B2F_FUNCTIONAL_CURRENCY,
      accountingUnit: B2F_ACCOUNTING_UNIT,
      calendarKey: 'finance.calendar.ng.gregorian',
      calendarVersion: 1,
    });
  });

  it('computes request hashes without now or generated references', () => {
    const command = createCommand({ idempotencyKey: 'deterministic' });
    expect(repository.computeCreateRequestHash({ ...command, now: new Date('2026-01-01') })).toBe(
      repository.computeCreateRequestHash({ ...command, now: new Date('2027-01-01') }),
    );
  });

  it('enforces the frozen period state machine', () => {
    expect(repository.canTransition('PLANNED', 'OPEN')).toBe(true);
    expect(repository.canTransition('OPEN', 'SOFT_CLOSED')).toBe(true);
    expect(repository.canTransition('SOFT_CLOSED', 'HARD_CLOSED')).toBe(true);
    expect(repository.canTransition('HARD_CLOSED', 'REOPENED')).toBe(true);
    expect(repository.canTransition('REOPENED', 'SOFT_CLOSED')).toBe(true);
    expect(repository.canTransition('HARD_CLOSED', 'OPEN')).toBe(false);
    expect(repository.canTransition('RETIRED', 'OPEN')).toBe(false);
  });

  it('rejects a hard close without reconciliation and close evidence', () => {
    const period = repository.buildDefinitions(createCommand(), new Date()).periods[0]!;
    period.state = 'SOFT_CLOSED';
    const result = repository.validateTransition(
      period,
      transitionCommand({ targetState: 'HARD_CLOSED' }),
      new Date(),
    );
    expect(result).toMatchObject({
      compatible: false,
      failure: { code: 'B2F_FISCAL_PERIOD_CONTROL_EVIDENCE_REQUIRED' },
    });
  });

  it('requires correction scope and a future expiry to reopen', () => {
    const period = repository.buildDefinitions(createCommand(), new Date()).periods[0]!;
    period.state = 'HARD_CLOSED';
    const result = repository.validateTransition(
      period,
      transitionCommand({ targetState: 'REOPENED' }),
      new Date('2027-03-01T00:00:00.000Z'),
    );
    expect(result.failure?.code).toBe('B2F_FISCAL_PERIOD_REOPEN_INVALID');
  });

  it('applies transitions additively and preserves definition identity', () => {
    const period = repository.buildDefinitions(createCommand(), new Date()).periods[0]!;
    const definitionHash = period.definitionHash;
    const command = transitionCommand();
    const decisionHash = repository.applyTransition(
      period,
      command,
      new Date('2027-01-01T00:00:00.000Z'),
      repository.computeTransitionRequestHash(command),
    );
    expect(period.state).toBe('OPEN');
    expect(period.stateVersion).toBe(2);
    expect(period.definitionHash).toBe(definitionHash);
    expect(period.lastDecisionHash).toBe(decisionHash);
    expect(period.openedAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('returns an admissible ordinary decision only for an open matching period', () => {
    const period = repository.buildDefinitions(createCommand(), new Date()).periods[0]!;
    period.state = 'OPEN';
    const decision = repository.evaluateAdmission(period, {
      periodKey: period.periodKey,
      accountingDate: '2027-01-15',
      admissionKind: 'ORDINARY',
      expectedBookKey: B2F_BOOK_KEY,
      expectedBookVersion: 1,
      expectedLegalEntityReference: B2F_LEGAL_ENTITY_REFERENCE,
      expectedCurrency: B2F_FUNCTIONAL_CURRENCY,
      expectedAccountingUnit: B2F_ACCOUNTING_UNIT,
      evaluatedAt: '2027-01-15T00:00:00.000Z',
    });
    expect(decision).toMatchObject({ outcome: 'ADMISSIBLE', compatible: true, readOnly: true });
  });

  it('blocks ordinary admission for a hard-closed period and out-of-range date', () => {
    const period = repository.buildDefinitions(createCommand(), new Date()).periods[0]!;
    period.state = 'HARD_CLOSED';
    const decision = repository.evaluateAdmission(period, {
      periodKey: period.periodKey,
      accountingDate: '2027-02-01',
      admissionKind: 'ORDINARY',
      expectedBookKey: B2F_BOOK_KEY,
      expectedBookVersion: 1,
      expectedLegalEntityReference: B2F_LEGAL_ENTITY_REFERENCE,
      expectedCurrency: B2F_FUNCTIONAL_CURRENCY,
      expectedAccountingUnit: B2F_ACCOUNTING_UNIT,
    });
    expect(decision.outcome).toBe('BLOCKED');
    expect(decision.reason).toBe('ACCOUNTING_DATE_OUTSIDE_PERIOD');
  });

  it('builds an approval fingerprint that changes with control evidence', () => {
    const command = transitionCommand();
    expect(repository.computeActionFingerprint(command)).not.toBe(
      repository.computeActionFingerprint({
        ...command,
        controlEvidence: {
          ...command.controlEvidence,
          accountingPolicyApprovalReference: 'changed',
        },
      }),
    );
  });
});
