/**
 * Governed actions whose checker decision is protected by the credential-separated authority.
 *
 * This is deliberately an explicit allow-list rather than "everything with an approval": the
 * remaining maker-checker estate keeps its existing behaviour and is not silently claimed as
 * protected. Only these four actions are written through the protected authority connection and
 * require immutable checker-decision/consumption evidence (migration 1785753600501).
 */
export const PROTECTED_AUTHORITY_ACTIONS: ReadonlySet<string> = new Set([
  'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
  'INSTITUTION_AGENT_AFFILIATION_CHANGE',
  'WALLET_OWNERSHIP_RESOLUTION',
  'LEDGER_JOURNAL_REVERSAL',
]);

export function isProtectedAuthorityAction(actionType: string): boolean {
  return PROTECTED_AUTHORITY_ACTIONS.has(actionType);
}
