/**
 * Governed actions whose checker decision is protected by the credential-separated authority.
 *
 * This is deliberately an explicit allow-list rather than "everything with an approval": the
 * remaining maker-checker estate keeps its existing behaviour and is not silently claimed as
 * protected. Only these six actions are written through the protected authority connection and
 * require immutable checker-decision/consumption evidence (migrations 1785753600501, extended to
 * the two ARENA 4 Phase 2 actions by 1785753600502).
 */
export const PROTECTED_AUTHORITY_ACTIONS: ReadonlySet<string> = new Set([
  'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
  'INSTITUTION_AGENT_AFFILIATION_CHANGE',
  'WALLET_OWNERSHIP_RESOLUTION',
  'LEDGER_JOURNAL_REVERSAL',
  // ARENA 4 Phase 2 — institutional financial ownership. These were added after the Phase 1
  // boundary and carry the same financial consequences, so they use the same protected contract
  // (migration 1785753600502 extends the database guard and row level security to them).
  'WALLET_INSTITUTION_ATTRIBUTION',
  'CUSTOMER_INSTITUTION_ENROLMENT_CHANGE',
]);

export function isProtectedAuthorityAction(actionType: string): boolean {
  return PROTECTED_AUTHORITY_ACTIONS.has(actionType);
}
