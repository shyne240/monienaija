/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01 seed data.
 *
 * Eleven operational-area templates (one per the areas listed in the task) plus one safe
 * DEFAULT_FALLBACK template used whenever a role has no valid assignment (missing, inactive, or
 * pointing at an unknown template). Every `widgetKey` below MUST exist in
 * `DASHBOARD_WIDGET_REGISTRY` — `DashboardTemplateSeedService` validates this at bootstrap and
 * refuses to seed an invalid layout.
 *
 * Templates are reusable by design: `ROLE_DASHBOARD_ASSIGNMENT_SEED` below is a SEPARATE array
 * that merely points role keys at template keys. A future role can be assigned any existing
 * template (e.g. a new "junior auditor" role could reuse FINANCIAL_AUDIT_ASSURANCE) by adding one
 * row to that array (or, post-deployment, via the Admin Web dashboard settings screen) — zero
 * frontend or widget code changes required.
 */

export interface DashboardTemplateSeed {
  templateKey: string;
  displayName: string;
  description: string;
  operationalArea: string;
  widgets: Array<{ widgetKey: string; order: number; title?: string }>;
}

const SELF_WIDGETS = [
  { widgetKey: 'identity-session', order: 0 },
  { widgetKey: 'entitlements-scopes', order: 1 },
];

export const DASHBOARD_TEMPLATE_SEED: DashboardTemplateSeed[] = [
  {
    templateKey: 'DEFAULT_FALLBACK',
    displayName: 'Default Dashboard',
    description: 'Safe minimum dashboard shown whenever a role has no valid, active template assignment. Shows only the signed-in principal\'s own identity and entitlements — never any other widget.',
    operationalArea: 'FALLBACK',
    widgets: [...SELF_WIDGETS],
  },
  {
    templateKey: 'EXECUTIVE_GOVERNANCE',
    displayName: 'Executive & Governance',
    description: 'Platform-wide executive overview: transaction/financial summary, ledger position, reconciliation health, workforce overview, role-governance queue, audit activity and system health.',
    operationalArea: 'EXECUTIVE_GOVERNANCE',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'transaction-summary', order: 2 },
      { widgetKey: 'transaction-trend', order: 3, title: 'Platform Volume Trend' },
      { widgetKey: 'recent-transactions', order: 4 },
      { widgetKey: 'ledger-summary', order: 5 },
      { widgetKey: 'reconciliation-status', order: 6 },
      { widgetKey: 'workforce-overview', order: 7 },
      { widgetKey: 'role-governance-queue', order: 8 },
      { widgetKey: 'audit-trail', order: 9 },
      { widgetKey: 'system-health', order: 10 },
    ],
  },
  {
    templateKey: 'WORKFORCE_ADMINISTRATION',
    displayName: 'Workforce Administration',
    description: 'Workforce headcount/role distribution and the delegable operational-role assignment surface.',
    operationalArea: 'WORKFORCE_ADMINISTRATION',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'workforce-overview', order: 2 },
    ],
  },
  {
    templateKey: 'FINANCE_PREPARATION',
    displayName: 'Finance Preparation',
    description: 'Ledger position and recognized transaction/fee summary relevant to preparing ledger postings and commercial-rule changes.',
    operationalArea: 'FINANCE_PREPARATION',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'transaction-summary', order: 2 },
      { widgetKey: 'ledger-summary', order: 3 },
    ],
  },
  {
    templateKey: 'FINANCIAL_CONTROL_APPROVALS',
    displayName: 'Financial Control & Approvals',
    description: 'Ledger position, transaction summary and the pending role-governance approval queue this role independently checks.',
    operationalArea: 'FINANCIAL_CONTROL_APPROVALS',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'transaction-summary', order: 2 },
      { widgetKey: 'ledger-summary', order: 3 },
      { widgetKey: 'role-governance-queue', order: 4 },
    ],
  },
  {
    templateKey: 'FINANCIAL_AUDIT_ASSURANCE',
    displayName: 'Financial Audit & Assurance',
    description: 'Read-only platform financial/transaction/ledger/reconciliation visibility plus audit trail and system health, for independent assurance review.',
    operationalArea: 'FINANCIAL_AUDIT_ASSURANCE',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'transaction-summary', order: 2 },
      { widgetKey: 'recent-transactions', order: 3 },
      { widgetKey: 'ledger-summary', order: 4 },
      { widgetKey: 'reconciliation-status', order: 5 },
      { widgetKey: 'audit-trail', order: 6 },
      { widgetKey: 'system-health', order: 7 },
    ],
  },
  {
    templateKey: 'TRANSACTION_OPERATIONS',
    displayName: 'Transaction Operations',
    description: 'Transaction volumes/success rate, recent transactions and support/system health relevant to day-to-day operations.',
    operationalArea: 'TRANSACTION_OPERATIONS',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'transaction-summary', order: 2 },
      { widgetKey: 'transaction-trend', order: 3, title: 'Operational Volume Trend' },
      { widgetKey: 'recent-transactions', order: 4 },
      { widgetKey: 'support-ticket-queue', order: 5 },
      { widgetKey: 'system-health', order: 6 },
      { widgetKey: 'customer-directory-shortcut', order: 7 },
    ],
  },
  {
    templateKey: 'AGENT_NETWORK_MANAGEMENT',
    displayName: 'Agent Network Management',
    description: 'Agent lifecycle summary and pending agent-network applications.',
    operationalArea: 'AGENT_NETWORK_MANAGEMENT',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'agent-lifecycle-summary', order: 2 },
      { widgetKey: 'agent-applications-queue', order: 3 },
    ],
  },
  {
    templateKey: 'COMPLIANCE_KYC',
    displayName: 'Compliance & KYC',
    description: 'KYC assessment queue and non-FRAUD compliance case summary (AML/KYC/SANCTIONS).',
    operationalArea: 'COMPLIANCE_KYC',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'kyc-queue-summary', order: 2 },
      { widgetKey: 'compliance-case-summary', order: 3 },
    ],
  },
  {
    templateKey: 'FRAUD_CASE_MONITORING',
    displayName: 'Fraud Case Monitoring',
    description: 'FRAUD-category case summary only — no AML/KYC/SANCTIONS case visibility.',
    operationalArea: 'FRAUD_CASE_MONITORING',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'fraud-case-summary', order: 2 },
    ],
  },
  {
    templateKey: 'CUSTOMER_SERVICING',
    displayName: 'Customer Servicing',
    description: 'Support ticket queue and a shortcut into the authorized customer directory/lookup workflow.',
    operationalArea: 'CUSTOMER_SERVICING',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'support-ticket-queue', order: 2 },
      { widgetKey: 'customer-directory-shortcut', order: 3 },
    ],
  },
  {
    templateKey: 'RECONCILIATION_VISIBILITY',
    displayName: 'Reconciliation Visibility',
    description: 'Reconciliation run status, exceptions and trial balance only — the single function this role holds.',
    operationalArea: 'RECONCILIATION_VISIBILITY',
    widgets: [
      ...SELF_WIDGETS,
      { widgetKey: 'reconciliation-status', order: 2 },
    ],
  },
];

/** Layer C seed: initial role -> template assignment for all eleven V1 roles. */
export const ROLE_DASHBOARD_ASSIGNMENT_SEED: Array<{ roleKey: string; templateKey: string; reason: string }> = [
  { roleKey: 'SUPER_ADMIN', templateKey: 'EXECUTIVE_GOVERNANCE', reason: 'V1 initial seed' },
  { roleKey: 'ADMINISTRATOR', templateKey: 'WORKFORCE_ADMINISTRATION', reason: 'V1 initial seed' },
  { roleKey: 'FINANCE_PREPARER', templateKey: 'FINANCE_PREPARATION', reason: 'V1 initial seed' },
  { roleKey: 'FINANCE_CONTROLLER', templateKey: 'FINANCIAL_CONTROL_APPROVALS', reason: 'V1 initial seed' },
  { roleKey: 'FINANCE_AUDITOR', templateKey: 'FINANCIAL_AUDIT_ASSURANCE', reason: 'V1 initial seed' },
  { roleKey: 'OPERATIONS', templateKey: 'TRANSACTION_OPERATIONS', reason: 'V1 initial seed' },
  { roleKey: 'AGENT_NETWORK_MANAGER', templateKey: 'AGENT_NETWORK_MANAGEMENT', reason: 'V1 initial seed' },
  { roleKey: 'COMPLIANCE', templateKey: 'COMPLIANCE_KYC', reason: 'V1 initial seed' },
  { roleKey: 'RISK_FRAUD', templateKey: 'FRAUD_CASE_MONITORING', reason: 'V1 initial seed' },
  { roleKey: 'CUSTOMER_SERVICE', templateKey: 'CUSTOMER_SERVICING', reason: 'V1 initial seed' },
  { roleKey: 'TREASURY', templateKey: 'RECONCILIATION_VISIBILITY', reason: 'V1 initial seed' },
];
