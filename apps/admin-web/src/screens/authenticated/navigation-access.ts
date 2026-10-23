export type AdminView =
  | 'dashboard'
  | 'dashboardSettings'
  | 'customers'
  | 'agents'
  | 'support'
  | 'transfers'
  | 'cashIn'
  | 'cashOut'
  | 'ledgerExplorer'
  | 'reconciliation'
  | 'feeRules'
  | 'commissionRules'
  | 'rewardRules'
  | 'productCatalogue'
  | 'limitCatalogue'
  | 'limitAssignments'
  | 'kycQueue'
  | 'complianceCases'
  | 'fraudCases'
  | 'workforceAccess'
  | 'roleGovernance'
  | 'approvalsInbox'
  | 'superAdminRecovery'
  | 'systemHealth'
  | 'auditEvents'
  // Legacy view aliases retained for existing in-app callers/bookmarks.
  | 'ledger'
  | 'transactions'
  | 'commercial'
  | 'compliance'
  | 'riskfraud'
  | 'roles'
  | 'approvals'
  | 'workforce'
  | 'system';

export interface AdminNavigationContext {
  customerId?: string;
}

const LEGACY_VIEW_ALIASES: Partial<Record<AdminView, AdminView>> = {
  ledger: 'ledgerExplorer',
  transactions: 'transfers',
  commercial: 'feeRules',
  compliance: 'kycQueue',
  riskfraud: 'fraudCases',
  roles: 'roleGovernance',
  approvals: 'approvalsInbox',
  workforce: 'workforceAccess',
  system: 'systemHealth',
};

export function canonicalAdminView(view: AdminView): AdminView {
  return LEGACY_VIEW_ALIASES[view] ?? view;
}

/**
 * Frontend navigation guard, deliberately based on the same function codes the backend routes
 * require. This controls which SPA view can be selected; it is not authorization for API calls.
 * Backend guards remain authoritative. Customer transaction history is a contextual-only route:
 * it is available to a caller with customer.view_transactions when a customer ID is supplied,
 * while the global transaction-detail screen separately requires transaction.view.
 */
export function canAccessAdminView(
  requestedView: AdminView,
  scopes: readonly string[],
  roles: readonly string[],
  context?: AdminNavigationContext,
): boolean {
  const view = canonicalAdminView(requestedView);
  const granted = new Set(scopes);
  const has = (functionCode: string) => granted.has(functionCode);
  const hasAny = (...functionCodes: string[]) => functionCodes.some(has);

  switch (view) {
    case 'dashboard':
      return true;
    case 'dashboardSettings':
      return has('workforce.dashboard.view');
    case 'customers':
      return has('customer.view');
    case 'agents':
      return has('agent.view');
    case 'support':
      return has('customer.manage_support_case');
    case 'transfers':
      return context?.customerId
        ? has('customer.view_transactions')
        : has('transaction.view');
    case 'cashIn':
    case 'cashOut':
      return has('transaction.view');
    case 'ledgerExplorer':
      return has('ledger.view');
    case 'reconciliation':
      return has('reconciliation.view');
    case 'feeRules':
      return has('fee_rule.view');
    case 'commissionRules':
      return has('commission_rule.view');
    case 'rewardRules':
      return has('reward_rule.view');
    case 'productCatalogue':
      return has('product.view');
    case 'limitCatalogue':
      return has('limit.view');
    case 'limitAssignments':
      return hasAny('limit.view', 'agent.assign_limit');
    case 'kycQueue':
      return has('kyc.view');
    case 'complianceCases':
      return has('compliance.manage_case');
    case 'fraudCases':
      return has('risk_fraud.manage_fraud_case');
    case 'workforceAccess':
      // This screen exposes only the workforce-overview widget and SUPPORT provisioning.
      return hasAny('workforce.dashboard.view', 'workforce.user.create');
    case 'roleGovernance':
      // The implemented SPA screen handles only governed FINANCE_* role assignment/revocation.
      // ADMINISTRATOR operational-role actions are implemented in the API but have no matching UI.
      return roles.includes('SUPER_ADMIN') && hasAny('workforce.role.assign', 'workforce.role.revoke');
    case 'approvalsInbox':
      // The implemented approval actions are assigned to FINANCE_CONTROLLER by the existing
      // maker-checker rules, and the approval service also checks privileged:approve.
      return roles.includes('FINANCE_CONTROLLER') && has('privileged:approve');
    case 'superAdminRecovery':
      return has('workforce.super_admin.recover');
    case 'systemHealth':
      return hasAny('metrics.view', 'diagnostics.view', 'outbox.view');
    case 'auditEvents':
      return has('audit.search');
    default:
      return false;
  }
}
