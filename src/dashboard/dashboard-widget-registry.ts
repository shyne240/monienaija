/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01
 *
 * The widget registry is a deliberate design decision (documented in
 * docs/V1/V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01-REPORT.md §1/§4): it is a STATIC,
 * source-controlled TypeScript table, not a database table. Reasoning: a widget "type" is
 * backed by real application code (a specific service method, a specific set of required
 * catalogue functions, a specific React component) — it cannot be created purely by inserting a
 * database row the way a template/assignment can. Templates (Layer B, DB-backed) and
 * assignments (Layer C, DB-backed) reference widget keys from this registry; every reference is
 * validated against this registry server-side (`DashboardService`), so a template can never
 * point at a widget that does not exist or whose required functions are unknown.
 *
 * Adding a new operational AREA/role requires zero new widgets if an existing widget fits — only
 * a new (or reused) `DashboardTemplate` row and a new `RoleDashboardAssignment` row (see
 * DASHBOARD_TEMPLATE_SEED / ROLE_DASHBOARD_ASSIGNMENT_SEED). Genuinely new data needs a new
 * widget entry here (source change) plus its backing handler — this is the intended V1 boundary:
 * no drag-and-drop designer, no server-authored business logic.
 */

/** Every widget declares the exact catalogue function(s) a caller must hold (ALL of, not any-of) to see it. */
export interface DashboardWidgetDefinition {
  widgetKey: string;
  displayName: string;
  description: string;
  /** Catalogue function codes from authorization-catalogue.seed.ts — never invented here. */
  requiredFunctions: readonly string[];
  /**
   * How the frontend fetches this widget's data.
   *   - 'proxy': call `GET /internal/a2/workforce/dashboard/widgets/:widgetKey`, which performs
   *     an independent `AuthorizationService.requireFunction` check per `requiredFunctions` and
   *     delegates to `DashboardWidgetDataService`.
   *   - 'direct': the widget's data already lives behind an existing, independently-authorized
   *     endpoint (listed in `endpoint`); the frontend calls it directly. No proxy duplication.
   */
  fetchMode: 'proxy' | 'direct';
  endpoint?: string;
  supportsPeriodFilter?: boolean;
  kind:
    | 'identity'
    | 'entitlements'
    | 'kpi-summary'
    | 'table'
    | 'status-breakdown'
    | 'trend'
    | 'link';
}

export const DASHBOARD_WIDGET_REGISTRY: readonly DashboardWidgetDefinition[] = [
  {
    widgetKey: 'identity-session',
    displayName: 'Session Identity',
    description: 'Your own signed-in principal, session and assurance level. No function grant required — this is always your own data.',
    requiredFunctions: [],
    fetchMode: 'direct',
    kind: 'identity',
  },
  {
    widgetKey: 'entitlements-scopes',
    displayName: 'Entitlements',
    description: 'Your own effective roles and catalogue function grants. No function grant required — this is always your own data.',
    requiredFunctions: [],
    fetchMode: 'direct',
    kind: 'entitlements',
  },
  {
    widgetKey: 'transaction-summary',
    displayName: 'Transaction Summary',
    description: 'Completed transaction value/count, success rate, and breakdown by W2W/W2C/C2W/C2C for the selected period, sourced from the authoritative transfers/deposits/withdrawals/cash-to-cash tables.',
    requiredFunctions: ['reporting.transaction_summary.view'],
    fetchMode: 'proxy',
    supportsPeriodFilter: true,
    kind: 'kpi-summary',
  },
  {
    widgetKey: 'transaction-trend',
    displayName: 'Transaction Volume Trend',
    description: 'V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02: daily completed-transaction count and value across all four V1 transaction types for the selected period (maximum 92 days), zero-filled for days with no activity, sourced from the same authoritative tables as Transaction Summary.',
    requiredFunctions: ['reporting.transaction_summary.view'],
    fetchMode: 'proxy',
    supportsPeriodFilter: true,
    kind: 'trend',
  },
  {
    widgetKey: 'recent-transactions',
    displayName: 'Recent Transactions',
    description: 'The most recent completed/failed/pending transactions across all four V1 transaction types, with reference, type, amount, status and timestamp (no customer PII).',
    requiredFunctions: ['reporting.transaction_summary.view'],
    fetchMode: 'proxy',
    kind: 'table',
  },
  {
    widgetKey: 'ledger-summary',
    displayName: 'Ledger Summary',
    description: 'Ledger debit/credit totals by currency, sourced from ledger_journals/ledger_lines.',
    requiredFunctions: ['ledger.view'],
    fetchMode: 'proxy',
    kind: 'status-breakdown',
  },
  {
    widgetKey: 'reconciliation-status',
    displayName: 'Reconciliation Status',
    description: 'The latest reconciliation run status, exceptions and trial balance, sourced from ReconciliationService.',
    requiredFunctions: ['reconciliation.view'],
    fetchMode: 'proxy',
    kind: 'status-breakdown',
  },
  {
    widgetKey: 'audit-trail',
    displayName: 'Recent Audit Activity',
    description: 'The most recent audit/security events, sourced from AuditService.',
    requiredFunctions: ['audit.view'],
    fetchMode: 'proxy',
    kind: 'table',
  },
  {
    widgetKey: 'system-health',
    displayName: 'System Health',
    description: 'Operational metrics, diagnostics and outbox backlog.',
    requiredFunctions: ['metrics.view', 'diagnostics.view', 'outbox.view'],
    fetchMode: 'direct',
    endpoint: '/internal/metrics',
    kind: 'kpi-summary',
  },
  {
    widgetKey: 'workforce-overview',
    displayName: 'Workforce Overview',
    description: 'Active workforce headcount, role distribution and currently active sessions.',
    requiredFunctions: ['workforce.user.view', 'workforce.role.view'],
    fetchMode: 'proxy',
    kind: 'kpi-summary',
  },
  {
    widgetKey: 'role-governance-queue',
    displayName: 'Role Definition Proposals',
    description: 'Pending role-definition governance proposals awaiting approval.',
    requiredFunctions: ['workforce.role.view'],
    fetchMode: 'direct',
    endpoint: '/internal/a2/workforce/role-definitions/proposals',
    kind: 'table',
  },
  {
    widgetKey: 'agent-lifecycle-summary',
    displayName: 'Agent Network Summary',
    description: 'Agent counts by lifecycle status and pending application count.',
    requiredFunctions: ['agent.view'],
    fetchMode: 'proxy',
    kind: 'status-breakdown',
  },
  {
    widgetKey: 'agent-applications-queue',
    displayName: 'Pending Agent Applications',
    description: 'Agent network applications awaiting review.',
    requiredFunctions: ['agent.review_application'],
    fetchMode: 'direct',
    endpoint: '/internal/agents/applications',
    kind: 'table',
  },
  {
    widgetKey: 'kyc-queue-summary',
    displayName: 'KYC Queue',
    description: 'Customer KYC assessment counts by status.',
    requiredFunctions: ['kyc.view'],
    fetchMode: 'proxy',
    kind: 'status-breakdown',
  },
  {
    widgetKey: 'compliance-case-summary',
    displayName: 'Compliance Case Summary',
    description: 'Non-FRAUD compliance case counts by status/category (AML, KYC, SANCTIONS and related).',
    requiredFunctions: ['compliance.manage_case'],
    fetchMode: 'proxy',
    kind: 'status-breakdown',
  },
  {
    widgetKey: 'fraud-case-summary',
    displayName: 'Fraud Case Summary',
    description: 'FRAUD-category compliance case counts by status only — no AML/SANCTIONS visibility, per the RISK_FRAUD scope boundary.',
    requiredFunctions: ['risk_fraud.manage_fraud_case'],
    fetchMode: 'proxy',
    kind: 'status-breakdown',
  },
  {
    widgetKey: 'support-ticket-queue',
    displayName: 'Support Ticket Queue',
    description: 'Open/assigned customer support tickets.',
    requiredFunctions: ['customer.manage_support_case'],
    fetchMode: 'direct',
    endpoint: '/internal/support/tickets',
    kind: 'table',
  },
  {
    widgetKey: 'customer-directory-shortcut',
    displayName: 'Customer Directory',
    description: 'Shortcut to the authorized customer directory/search workflow. No data fetch.',
    requiredFunctions: ['customer.view'],
    fetchMode: 'direct',
    kind: 'link',
  },
];

export function findWidgetDefinition(widgetKey: string): DashboardWidgetDefinition | undefined {
  return DASHBOARD_WIDGET_REGISTRY.find((w) => w.widgetKey === widgetKey);
}
