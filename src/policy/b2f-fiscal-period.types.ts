import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { RequestContext } from '../production/request-context';
import type {
  B2F_ACCOUNTING_BASIS,
  B2F_ACCOUNTING_UNIT,
  B2F_BOOK_KEY,
  B2F_BOOK_VERSION,
  B2F_CALENDAR_KEY,
  B2F_CALENDAR_VERSION,
  B2F_FUNCTIONAL_CURRENCY,
  B2F_JURISDICTION,
  B2F_LEGAL_ENTITY_REFERENCE,
} from './b2f-fiscal-period.constants';

export type B2FFiscalYearState = 'PLANNED' | 'ACTIVE' | 'CLOSED' | 'RETIRED';
export type B2FAccountingPeriodState =
  | 'PLANNED'
  | 'OPEN'
  | 'SOFT_CLOSED'
  | 'HARD_CLOSED'
  | 'REOPENED'
  | 'RETIRED';
export type B2FPeriodAdmissionKind = 'ORDINARY' | 'CLOSE_ADJUSTMENT' | 'REOPEN_CORRECTION';
export type B2FPeriodAdmissionOutcome = 'ADMISSIBLE' | 'BLOCKED';
export type B2FPeriodTransitionOutcome = 'APPLIED' | 'REPLAYED' | 'REJECTED';

export interface B2FFiscalYearCreateCommandV1 {
  readonly fiscalYear: number;
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly causationId?: string;
  readonly now?: Date;
}

export interface B2FPeriodControlEvidenceV1 {
  readonly legalEntityRatificationReference: string;
  readonly accountingPolicyApprovalReference: string;
  readonly reconciliationReference?: string;
  readonly closeChecklistReference?: string;
  readonly correctionScope?: string;
  readonly materialityReference?: string;
  readonly reopenExpiresAt?: string;
}

export interface B2FPeriodTransitionCommandV1 {
  readonly periodReference: string;
  readonly targetState: B2FAccountingPeriodState;
  readonly expectedRecordVersion: number;
  readonly idempotencyKey: string;
  readonly approvalId: string;
  readonly principal: AuthorizationPrincipal;
  readonly reason: string;
  readonly controlEvidence: B2FPeriodControlEvidenceV1;
  readonly requestContext: RequestContext;
  readonly causationId?: string;
  readonly now?: Date;
}

export interface B2FFiscalYearViewV1 {
  readonly fiscalYearReference: string;
  readonly fiscalYearKey: string;
  readonly fiscalYearVersion: 1;
  readonly fiscalYear: number;
  readonly state: B2FFiscalYearState;
  readonly bookKey: typeof B2F_BOOK_KEY;
  readonly bookVersion: typeof B2F_BOOK_VERSION;
  readonly legalEntityReference: typeof B2F_LEGAL_ENTITY_REFERENCE;
  readonly jurisdiction: typeof B2F_JURISDICTION;
  readonly accountingBasis: typeof B2F_ACCOUNTING_BASIS;
  readonly functionalCurrency: typeof B2F_FUNCTIONAL_CURRENCY;
  readonly accountingUnit: typeof B2F_ACCOUNTING_UNIT;
  readonly calendarKey: typeof B2F_CALENDAR_KEY;
  readonly calendarVersion: typeof B2F_CALENDAR_VERSION;
  readonly startDate: string;
  readonly endDateExclusive: string;
  readonly definitionHash: string;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly periods: readonly B2FAccountingPeriodViewV1[];
}

export interface B2FAccountingPeriodViewV1 {
  readonly periodReference: string;
  readonly periodKey: string;
  readonly periodVersion: 1;
  readonly fiscalYearReference: string;
  readonly periodNumber: number;
  readonly periodLabel: string;
  readonly startDate: string;
  readonly endDateExclusive: string;
  readonly cutoffAt: string;
  readonly state: B2FAccountingPeriodState;
  readonly stateVersion: number;
  readonly definitionHash: string;
  readonly lastDecisionHash: string | null;
  readonly openedAt: string | null;
  readonly softClosedAt: string | null;
  readonly hardClosedAt: string | null;
  readonly reopenedAt: string | null;
  readonly reopenExpiresAt: string | null;
  readonly retiredAt: string | null;
  readonly lastApprovalId: string | null;
  readonly lastCorrelationId: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface B2FFiscalYearCreateResultV1 {
  readonly outcome: 'CREATED' | 'REPLAYED' | 'REJECTED';
  readonly fiscalYear: B2FFiscalYearViewV1 | null;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly replayed: boolean;
  readonly failure: B2FFiscalPeriodFailureV1 | null;
}

export interface B2FPeriodTransitionDecisionV1 {
  readonly decisionReference: string;
  readonly outcome: B2FPeriodTransitionOutcome;
  readonly periodReference: string;
  readonly previousState: B2FAccountingPeriodState;
  readonly targetState: B2FAccountingPeriodState;
  readonly resultingState: B2FAccountingPeriodState;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly approvalId: string;
  readonly reason: string;
  readonly controlEvidence: B2FPeriodControlEvidenceV1;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly decidedAt: string;
  readonly recordVersion: number;
  readonly replayed: boolean;
  readonly failure: B2FFiscalPeriodFailureV1 | null;
}

export interface B2FPeriodAdmissionRequestV1 {
  readonly periodKey: string;
  readonly accountingDate: string;
  readonly admissionKind: B2FPeriodAdmissionKind;
  readonly expectedBookKey: typeof B2F_BOOK_KEY;
  readonly expectedBookVersion: typeof B2F_BOOK_VERSION;
  readonly expectedLegalEntityReference: typeof B2F_LEGAL_ENTITY_REFERENCE;
  readonly expectedCurrency: typeof B2F_FUNCTIONAL_CURRENCY;
  readonly expectedAccountingUnit: typeof B2F_ACCOUNTING_UNIT;
  readonly evaluatedAt?: string;
}

export interface B2FPeriodAdmissionDecisionV1 {
  readonly outcome: B2FPeriodAdmissionOutcome;
  readonly readOnly: true;
  readonly periodReference: string | null;
  readonly periodKey: string;
  readonly periodState: B2FAccountingPeriodState | null;
  readonly admissionKind: B2FPeriodAdmissionKind;
  readonly accountingDate: string;
  readonly compatible: boolean;
  readonly reason: string;
  readonly definitionHash: string | null;
  readonly stateVersion: number | null;
  readonly evaluatedAt: string;
}

export interface B2FFiscalPeriodCompatibilityResultV1 {
  readonly compatible: boolean;
  readonly failure: B2FFiscalPeriodFailureV1 | null;
}

export interface B2FFiscalPeriodFailureV1 {
  readonly code:
    | 'B2F_FISCAL_PERIOD_INVALID_COMMAND'
    | 'B2F_FISCAL_PERIOD_INCOMPATIBLE'
    | 'B2F_FISCAL_YEAR_ALREADY_EXISTS'
    | 'B2F_FISCAL_YEAR_NOT_FOUND'
    | 'B2F_FISCAL_PERIOD_NOT_FOUND'
    | 'B2F_FISCAL_PERIOD_INVALID_TRANSITION'
    | 'B2F_FISCAL_PERIOD_VERSION_CONFLICT'
    | 'B2F_FISCAL_PERIOD_APPROVAL_REQUIRED'
    | 'B2F_FISCAL_PERIOD_CONTROL_EVIDENCE_REQUIRED'
    | 'B2F_FISCAL_PERIOD_REOPEN_INVALID'
    | 'B2F_FISCAL_PERIOD_REPLAY_CONFLICT'
    | 'B2F_FISCAL_PERIOD_QUERY_UNAVAILABLE';
  readonly message: string;
  readonly field: string | null;
}

export interface B2FFiscalPeriodConsumerPortsV1 {
  readonly contractName: 'B2F-FISCAL-PERIOD';
  readonly contractVersion: 1;
  readonly lifecycleIdempotencyScope: string;
  readonly checkAdmission: (
    request: B2FPeriodAdmissionRequestV1,
  ) => Promise<B2FPeriodAdmissionDecisionV1>;
  readonly getPeriodByKey: (periodKey: string) => Promise<B2FAccountingPeriodViewV1 | null>;
}
