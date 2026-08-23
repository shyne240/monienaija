import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { RequestContext } from '../production/request-context';

export type B2FFinanceJournalState =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTING_REQUESTED'
  | 'POSTED'
  | 'FAILED'
  | 'POSTING_UNKNOWN';
export type B2FFinanceJournalClassification =
  | 'STANDARD'
  | 'ADJUSTMENT'
  | 'CLOSE_ADJUSTMENT'
  | 'REOPEN_CORRECTION';
export interface B2FFinanceJournalLineV1 {
  readonly lineNumber: number;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountMinor: string;
  readonly a5LedgerAccountId: string;
  readonly financeClassificationKey: string;
  readonly financeClassificationVersion: 1;
  readonly mappingReference: string;
  readonly mappingVersion: 1;
}
export interface B2FFinanceSourceDocumentV1 {
  readonly sourceKind: string;
  readonly sourceOwner: 'A5' | 'B1' | 'A6' | 'A7' | 'B2_FINANCE';
  readonly sourceReference: string;
  readonly sourceVersion: number;
  readonly sourceHash: string;
  readonly sourceOccurredAt: string;
}
export interface B2FFinanceJournalCreateCommandV1 {
  readonly classification: B2FFinanceJournalClassification;
  readonly periodKey: string;
  readonly periodVersion: 1;
  readonly accountingDate: string;
  readonly description: string;
  readonly sourceDocument: B2FFinanceSourceDocumentV1;
  readonly lines: readonly B2FFinanceJournalLineV1[];
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly causationId?: string;
  readonly now?: Date;
}
export interface B2FFinanceJournalLifecycleCommandV1 {
  readonly financeJournalReference: string;
  readonly expectedRecordVersion: number;
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly reason: string;
  readonly approvalId?: string;
  readonly now?: Date;
}
export interface B2FFinanceJournalViewV1 {
  readonly financeJournalReference: string;
  readonly financeJournalVersion: 1;
  readonly state: B2FFinanceJournalState;
  readonly classification: B2FFinanceJournalClassification;
  readonly bookKey: 'finance.book.ng.primary';
  readonly bookVersion: 1;
  readonly legalEntityReference: 'finance.legal-entity.ng.primary';
  readonly accountingBasis: 'ACCRUAL';
  readonly periodKey: string;
  readonly periodVersion: 1;
  readonly accountingDate: string;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly description: string;
  readonly sourceDocument: B2FFinanceSourceDocumentV1;
  readonly lines: readonly B2FFinanceJournalLineV1[];
  readonly totalDebitMinor: string;
  readonly totalCreditMinor: string;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly replayHash: string;
  readonly approvalId: string | null;
  readonly a5IdempotencyKey: string;
  readonly a5JournalId: string | null;
  readonly a5PostedAt: string | null;
  readonly postingFailureCode: string | null;
  readonly postingFailureMessage: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface B2FFinanceJournalResultV1 {
  readonly outcome: 'CREATED' | 'UPDATED' | 'POSTED' | 'UNKNOWN' | 'REPLAYED' | 'REJECTED';
  readonly journal: B2FFinanceJournalViewV1 | null;
  readonly replayed: boolean;
  readonly failure: { readonly code: string; readonly message: string } | null;
}
export interface B2FFinanceJournalConsumerPortsV1 {
  readonly contractName: 'B2F-JOURNAL-GOVERNANCE';
  readonly contractVersion: 1;
  readonly getJournal: (reference: string) => Promise<B2FFinanceJournalViewV1 | null>;
  readonly getPostingResult: (reference: string) => Promise<{
    state: B2FFinanceJournalState;
    a5JournalId: string | null;
    failureCode: string | null;
  } | null>;
  readonly getProvenance: (reference: string) => Promise<{
    sourceDocument: B2FFinanceSourceDocumentV1;
    requestHash: string;
    decisionHash: string;
    a5JournalId: string | null;
  } | null>;
}
