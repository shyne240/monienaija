import type { AccountingOutcome } from './commercial-accounting.service';

/**
 * V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — snapshot-decision annotation AFTER accounting.
 *
 * Pure merge functions the flows call (only when accounting is enabled) to replace the
 * evidence-only "family not provisioned" postings with the truthful posting evidence: journal
 * identity, treatment/timing config that governed the legs, and the fee-collection state.
 * Nothing is recomputed; the decision values are the same authoritative objects the flow
 * already held — these only carry the posting outcome.
 */
export function annotateFeeDecisionWithPosting(
  feeDecision: Record<string, unknown>,
  outcome: AccountingOutcome,
): Record<string, unknown> {
  return {
    ...feeDecision,
    posting: outcome.feePosting,
  };
}

export interface CommissionAccountingAnnotationExtras {
  commissionEvent: 'TRANSACTION_COMPLETION' | 'CASH_TO_CASH_INITIATION';
}

export function annotateCommissionDecisionWithPosting(
  commissionDecision: Record<string, unknown>,
  outcome: AccountingOutcome,
  extras: CommissionAccountingAnnotationExtras,
): Record<string, unknown> {
  const posted = outcome.commissionPosting.journalLegsPosted === true;
  const status = typeof commissionDecision.status === 'string' ? commissionDecision.status : 'NONE';

  // Fee-collection state, honest per posting reality: collected only when the fee legs posted.
  const feeCollectionState =
    outcome.feeCollected === true
      ? 'FEE_COLLECTED'
      : typeof (commissionDecision as { feeCollectionState?: unknown }).feeCollectionState === 'string'
        ? (commissionDecision as { feeCollectionState?: unknown }).feeCollectionState
        : 'FEE_NOT_CONFIGURED';

  if (status !== 'ALLOCATED') {
    return { ...commissionDecision, posting: outcome.commissionPosting };
  }

  // ALLOCATED: payable truth depends on the configured treatment outcome.
  //  - EXPENSE_PAYABLE(accrue-now/settle-later): a REAL payable liability now stands → payable:true,
  //    with the V2-scope note that no settlement rail exists yet.
  //  - AGENT_WALLET_NETTING(at completion): settled instantly → payable:false with the explicit
  //    "settled by netting" reason.
  //  - Not posted (zero amount / blocked would have thrown): keep payable:false with the recorded
  //    reason — never faked.
  const treatment = posted ? (outcome.commissionPosting as { treatment?: unknown }).treatment : null;

  return {
    ...commissionDecision,
    payable: posted && treatment === 'EXPENSE_PAYABLE',
    payableBlockers: posted
      ? []
      : ((commissionDecision as { payableBlockers?: unknown }).payableBlockers ?? []),
    feeCollectionState,
    commissionEvent: extras.commissionEvent,
    posting: outcome.commissionPosting,
  };
}
