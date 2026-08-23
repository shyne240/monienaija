import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { PrivilegedActionApprovalView } from '../authorization/privileged-action-approval.types';
import type { RequestContext } from '../production/request-context';
import type {
  B2FFinanceJournalClassification,
  B2FFinanceJournalLineV1,
} from './b2f-journal-governance.types';

export type B2FSourceCategory =
  | 'B1_COMMERCIAL_DECISION'
  | 'B1_BILLING_RECORD'
  | 'B1_INVOICE'
  | 'B1_REVENUE_RECOGNITION'
  | 'B1_TAX_VAT'
  | 'B1_COST_ACCOUNTING'
  | 'B1_PROFITABILITY'
  | 'B1_COMMERCIAL_RECONCILIATION'
  | 'A6_SETTLEMENT'
  | 'A6_SUSPENSE'
  | 'A7_PRODUCT_FINANCIAL_EFFECT';
export type B2FSourceVerificationStatus =
  | 'VERIFIED'
  | 'VERIFIED_READ_ONLY'
  | 'NOT_VERIFIED_REQUIRES_REVIEW'
  | 'PROHIBITED_DUPLICATE_AUTHORITY';
export type B2FAccountingTreatmentState = 'ADOPTED' | 'JOURNAL_DRAFT_CREATED' | 'REJECTED';
export interface B2FSourceDecisionReferenceV1 {
  readonly category: B2FSourceCategory;
  readonly sourceOwner: 'B1' | 'A6' | 'A7';
  readonly sourceReference: string;
  readonly sourceVersion: 1;
  readonly sourceHash: string;
  readonly lookupReference?: string;
  readonly effectiveAt: string;
  readonly expiresAt?: string;
}
export interface B2FAccountingTreatmentCommandV1 {
  readonly treatmentVersion: 1;
  readonly source: B2FSourceDecisionReferenceV1;
  readonly periodKey: string;
  readonly periodVersion: 1;
  readonly accountingDate: string;
  readonly journalClassification: B2FFinanceJournalClassification;
  readonly description: string;
  readonly lines: readonly B2FFinanceJournalLineV1[];
  readonly makerPrincipalId: string;
  readonly makerRoles: readonly string[];
  readonly approvals: readonly PrivilegedActionApprovalView[];
  readonly overrideEvidenceReference?: string;
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly causationId?: string;
  readonly evaluatedAt?: Date;
}
export interface B2FSourceVerificationResultV1 {
  readonly status: B2FSourceVerificationStatus;
  readonly authoritative: boolean;
  readonly current: boolean;
  readonly sourceHash: string | null;
  readonly amountMinor: string | null;
  readonly currency: string | null;
  readonly accountingUnit: string | null;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly reasons: readonly string[];
}
export interface B2FAccountingTreatmentDecisionV1 {
  readonly treatmentReference: string;
  readonly treatmentVersion: 1;
  readonly state: B2FAccountingTreatmentState;
  readonly source: B2FSourceDecisionReferenceV1;
  readonly sourceVerification: B2FSourceVerificationResultV1;
  readonly bookKey: 'finance.book.ng.primary';
  readonly bookVersion: 1;
  readonly legalEntityReference: 'finance.legal-entity.ng.primary';
  readonly accountingBasis: 'ACCRUAL';
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly periodKey: string;
  readonly periodVersion: 1;
  readonly accountingDate: string;
  readonly lines: readonly B2FFinanceJournalLineV1[];
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly controlDecisionReference: string | null;
  readonly financeJournalReference: string | null;
  readonly failureReasons: readonly string[];
  readonly correlationId: string;
  readonly createdAt: string;
  readonly replayed: boolean;
}
export interface B2FAccountingTreatmentConsumerPortsV1 {
  readonly contractName: 'B2F-ACCOUNTING-TREATMENT';
  readonly contractVersion: 1;
  readonly getTreatment: (reference: string) => Promise<B2FAccountingTreatmentDecisionV1 | null>;
  readonly getBySource: (
    category: B2FSourceCategory,
    reference: string,
    version: 1,
  ) => Promise<B2FAccountingTreatmentDecisionV1 | null>;
  readonly verifySource: (
    source: B2FSourceDecisionReferenceV1,
    evaluatedAt?: Date,
  ) => Promise<B2FSourceVerificationResultV1>;
}
