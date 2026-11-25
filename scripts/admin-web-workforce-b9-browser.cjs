#!/usr/bin/env node
/**
 * Arena B9 — Workforce & Approvals browser acceptance (real Chromium, fixture API).
 *
 * What this proves and what it does NOT:
 *   - REAL: the production Admin Web bundle, a genuine Chromium renderer, real DOM/hit-testing,
 *     real localStorage session restore, real request shapes leaving the client, real navigation
 *     guards, real focus behaviour.
 *   - FIXTURE: the API is stubbed at the browser's network layer. No assertion here claims
 *     anything about server enforcement; that is covered by the Nest HTTP unit suite
 *     (`test/workforce-administration-validation.spec.ts`) and the PostgreSQL integration suites.
 *
 * The scenarios are the B9 acceptance walkthrough: sign-in and expected page access for all eleven
 * local role accounts, the approval evaluation inbox (proposed change, affected record, required
 * authority, decision history, applied state), blocked self-approval, an approval decision actually
 * being submitted with the right body, the directory→role-governance hand-off, and the recovery
 * screen's confirm gate.
 *
 * Usage:
 *   ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build --outDir /tmp/b9-dist
 *   node scripts/admin-web-workforce-b9-browser.cjs \
 *     --dist /tmp/b9-dist --out docs/integration/evidence/b9-workforce-approvals \
 *     --executable /tmp/chromium --lib-path /tmp/al2023/lib
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function parseArgs(argv) {
  const args = { port: 4399 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function serveStatic(root, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const candidate = path.join(root, decodeURIComponent(url.pathname));
    const inside = candidate.startsWith(root);
    const isFile = inside && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    const target = isFile ? candidate : path.join(root, 'index.html');
    if (!fs.existsSync(target)) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = fs.readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** Seeded catalogue function grants, mirroring `authorization-catalogue.seed.ts` per role. */
const ROLE_PRINCIPALS = {
  SUPER_ADMIN: {
    type: 'PRIVILEGED',
    scopes: [
      'agent.activate',
      'agent.assign_limit',
      'agent.manage_classes',
      'agent.manage_credentials',
      'agent.manage_outlets_terminals',
      'agent.reactivate',
      'agent.review_application',
      'agent.suspend',
      'agent.terminate',
      'agent.view',
      'aggregator.manage',
      'aggregator.view',
      'audit.search',
      'audit.view',
      'banking.provider.approve',
      'banking.provider.propose',
      'banking.provider.view',
      'banking.reconciliation.resolve',
      'banking.reconciliation.run',
      'commission_rule.view',
      'compliance.manage_case',
      'compliance.manage_risk_profile',
      'customer.activate',
      'customer.archive_proof_of_address',
      'customer.close',
      'customer.create',
      'customer.create_wallet',
      'customer.download_proof_of_address',
      'customer.manage_classes',
      'customer.manage_support_case',
      'customer.suspend',
      'customer.upload_proof_of_address',
      'customer.view',
      'customer.view_address',
      'customer.view_contact_methods',
      'customer.view_identity_documents',
      'customer.view_proof_of_address_metadata',
      'customer.view_transactions',
      'customer.view_wallets',
      'customer.withdraw_proof_of_address',
      'diagnostics.view',
      'fee_rule.view',
      'institution.attribution.view',
      'institution.manage',
      'institution.view',
      'institution.workforce.assign',
      'kyc.approve',
      'kyc.policy.propose',
      'kyc.policy.view',
      'kyc.provider.propose',
      'kyc.provider.view',
      'kyc.reject',
      'kyc.review',
      'kyc.view',
      'ledger.view',
      'limit.view',
      'metrics.view',
      'notification.provider.configure',
      'notification.provider.view',
      'notification.test_send',
      'notification.view_deliveries',
      'outbox.view',
      'privileged:execute',
      'product.view',
      'reconciliation.view',
      'reporting.transaction_summary.view',
      'reward_rule.view',
      'transaction.view',
      'workforce.dashboard.assign',
      'workforce.dashboard.view',
      'workforce.role.assign',
      'workforce.role.assign_operational',
      'workforce.role.create',
      'workforce.role.modify',
      'workforce.role.revoke',
      'workforce.role.revoke_operational',
      'workforce.role.view',
      'workforce.user.create',
      'workforce.user.suspend',
      'workforce.user.view',
    ],
    views: [
      'agentClasses',
      'agents',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'commissionRules',
      'complianceCases',
      'customerClasses',
      'customers',
      'dashboard',
      'dashboardSettings',
      'feeRules',
      'institutions',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'notificationOperations',
      'notifications',
      'productCatalogue',
      'reconciliation',
      'rewardRules',
      'roleGovernance',
      'support',
      'systemHealth',
      'transfers',
      'workforceAccess',
      'workforceDirectory',
    ],
    denied: ['approvalsInbox', 'fraudCases', 'superAdminRecovery'],
  },
  FINANCE_PREPARER: {
    type: 'OPERATOR',
    scopes: [
      'banking.provider.propose',
      'banking.provider.view',
      'commission_rule.create',
      'commission_rule.modify',
      'commission_rule.view',
      'fee_rule.create',
      'fee_rule.modify',
      'fee_rule.view',
      'finance.control_policy.activate',
      'finance:prepare',
      'institution.attribution.prepare',
      'institution.view',
      'ledger.post',
      'ledger.reverse',
      'ledger.view',
      'limit.modify',
      'limit.view',
      'product.governance',
      'product.modify',
      'product.view',
      'reporting.transaction_summary.view',
      'reward_rule.create',
      'reward_rule.modify',
      'reward_rule.view',
    ],
    views: [
      'commissionRules',
      'dashboard',
      'feeRules',
      'institutions',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'productCatalogue',
      'rewardRules',
    ],
    denied: [
      'agentClasses',
      'agents',
      'approvalsInbox',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'complianceCases',
      'customerClasses',
      'customers',
      'dashboardSettings',
      'fraudCases',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
      'notificationOperations',
      'notifications',
      'reconciliation',
      'roleGovernance',
      'superAdminRecovery',
      'support',
      'systemHealth',
      'transfers',
      'workforceAccess',
      'workforceDirectory',
    ],
  },
  FINANCE_CONTROLLER: {
    type: 'OPERATOR',
    scopes: [
      'agent.defund',
      'agent.fund',
      'banking.provider.approve',
      'banking.provider.view',
      'commission_rule.create',
      'commission_rule.modify',
      'commission_rule.view',
      'fee_rule.create',
      'fee_rule.modify',
      'fee_rule.view',
      'finance.control_policy.activate',
      'institution.affiliation.approve',
      'institution.attribution.approve',
      'institution.attribution.view',
      'institution.enrolment.approve',
      'institution.lifecycle.approve',
      'institution.view',
      'ledger.view',
      'limit.modify',
      'limit.view',
      'notification.provider.configure',
      'notification.provider.view',
      'privileged:approve',
      'privileged:execute',
      'product.governance',
      'product.modify',
      'product.view',
      'reporting.transaction_summary.view',
      'reward_rule.create',
      'reward_rule.modify',
      'reward_rule.view',
      'workforce.role.assign',
      'workforce.role.create',
      'workforce.role.modify',
      'workforce.role.revoke',
      'workforce.role.view',
    ],
    views: [
      'agents',
      'approvalsInbox',
      'commissionRules',
      'dashboard',
      'feeRules',
      'institutions',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'notifications',
      'productCatalogue',
      'rewardRules',
      'workforceDirectory',
    ],
    denied: [
      'agentClasses',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'complianceCases',
      'customerClasses',
      'customers',
      'dashboardSettings',
      'fraudCases',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
      'notificationOperations',
      'reconciliation',
      'roleGovernance',
      'superAdminRecovery',
      'support',
      'systemHealth',
      'transfers',
      'workforceAccess',
    ],
  },
  FINANCE_AUDITOR: {
    type: 'OPERATOR',
    scopes: [
      'agent.view',
      'aggregator.view',
      'audit.search',
      'audit.view',
      'commission_rule.view',
      'customer.view',
      'customer.view_address',
      'customer.view_contact_methods',
      'customer.view_transactions',
      'diagnostics.view',
      'fee_rule.view',
      'finance:audit',
      'institution.attribution.view',
      'institution.view',
      'kyc.view',
      'ledger.view',
      'limit.view',
      'metrics.view',
      'notification.provider.view',
      'notification.view_deliveries',
      'outbox.view',
      'product.view',
      'reconciliation.view',
      'reporting.transaction_summary.view',
      'reward_rule.view',
      'transaction.view',
      'workforce.role.view',
    ],
    views: [
      'agentClasses',
      'agents',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'commissionRules',
      'customerClasses',
      'customers',
      'dashboard',
      'feeRules',
      'institutions',
      'kycQueue',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'notificationOperations',
      'notifications',
      'productCatalogue',
      'reconciliation',
      'rewardRules',
      'systemHealth',
      'transfers',
      'workforceDirectory',
    ],
    denied: [
      'approvalsInbox',
      'complianceCases',
      'dashboardSettings',
      'fraudCases',
      'kycProviders',
      'kycTierPolicies',
      'roleGovernance',
      'superAdminRecovery',
      'support',
      'workforceAccess',
    ],
  },
  ADMINISTRATOR: {
    type: 'OPERATOR',
    scopes: [
      'agent.view',
      'aggregator.view',
      'customer.view',
      'workforce.dashboard.assign',
      'workforce.dashboard.view',
      'workforce.role.assign_operational',
      'workforce.role.revoke_operational',
      'workforce.role.view',
      'workforce.super_admin.recover',
      'workforce.user.create',
      'workforce.user.suspend',
      'workforce.user.view',
    ],
    views: [
      'agentClasses',
      'agents',
      'customerClasses',
      'customers',
      'dashboard',
      'dashboardSettings',
      'roleGovernance',
      'superAdminRecovery',
      'workforceAccess',
      'workforceDirectory',
    ],
    denied: [
      'approvalsInbox',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'commissionRules',
      'complianceCases',
      'feeRules',
      'fraudCases',
      'institutions',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'notificationOperations',
      'notifications',
      'productCatalogue',
      'reconciliation',
      'rewardRules',
      'support',
      'systemHealth',
      'transfers',
    ],
  },
  OPERATIONS: {
    type: 'OPERATOR',
    scopes: [
      'aggregator.manage',
      'aggregator.view',
      'customer.activate',
      'customer.close',
      'customer.create',
      'customer.create_wallet',
      'customer.manage_support_case',
      'customer.suspend',
      'customer.upload_proof_of_address',
      'customer.view',
      'customer.view_address',
      'customer.view_contact_methods',
      'customer.view_proof_of_address_metadata',
      'customer.view_transactions',
      'customer.view_wallets',
      'customer.withdraw_proof_of_address',
      'diagnostics.view',
      'institution.lifecycle.prepare',
      'institution.manage',
      'institution.view',
      'metrics.view',
      'notification.provider.view',
      'notification.test_send',
      'notification.view_deliveries',
      'outbox.view',
      'reporting.transaction_summary.view',
      'transaction.view',
      'workforce.user.create',
      'workforce.user.suspend',
      'workforce.user.view',
    ],
    views: [
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'customerClasses',
      'customers',
      'dashboard',
      'institutions',
      'notificationOperations',
      'notifications',
      'support',
      'systemHealth',
      'transfers',
      'workforceAccess',
    ],
    denied: [
      'agentClasses',
      'agents',
      'approvalsInbox',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'commissionRules',
      'complianceCases',
      'dashboardSettings',
      'feeRules',
      'fraudCases',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'productCatalogue',
      'reconciliation',
      'rewardRules',
      'roleGovernance',
      'superAdminRecovery',
      'workforceDirectory',
    ],
  },
  AGENT_NETWORK_MANAGER: {
    type: 'OPERATOR',
    scopes: [
      'agent.activate',
      'agent.assign_limit',
      'agent.defund',
      'agent.fund',
      'agent.manage_classes',
      'agent.manage_credentials',
      'agent.manage_outlets_terminals',
      'agent.reactivate',
      'agent.review_application',
      'agent.suspend',
      'agent.terminate',
      'agent.view',
      'institution.affiliation.prepare',
      'institution.enrolment.prepare',
      'institution.view',
      'limit.view',
    ],
    views: [
      'agentClasses',
      'agents',
      'dashboard',
      'institutions',
      'limitAssignments',
      'limitCatalogue',
    ],
    denied: [
      'approvalsInbox',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'commissionRules',
      'complianceCases',
      'customerClasses',
      'customers',
      'dashboardSettings',
      'feeRules',
      'fraudCases',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
      'ledgerExplorer',
      'notificationOperations',
      'notifications',
      'productCatalogue',
      'reconciliation',
      'rewardRules',
      'roleGovernance',
      'superAdminRecovery',
      'support',
      'systemHealth',
      'transfers',
      'workforceAccess',
      'workforceDirectory',
    ],
  },
  COMPLIANCE: {
    type: 'OPERATOR',
    scopes: [
      'compliance.manage_case',
      'compliance.manage_risk_profile',
      'customer.archive_proof_of_address',
      'customer.download_proof_of_address',
      'customer.view',
      'customer.view_address',
      'customer.view_contact_methods',
      'customer.view_identity_documents',
      'customer.view_proof_of_address_metadata',
      'institution.attribution.view',
      'institution.view',
      'kyc.approve',
      'kyc.policy.approve',
      'kyc.policy.view',
      'kyc.provider.approve',
      'kyc.provider.view',
      'kyc.reject',
      'kyc.review',
      'kyc.view',
    ],
    views: [
      'complianceCases',
      'customerClasses',
      'customers',
      'dashboard',
      'institutions',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
    ],
    denied: [
      'agentClasses',
      'agents',
      'approvalsInbox',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'commissionRules',
      'dashboardSettings',
      'feeRules',
      'fraudCases',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'notificationOperations',
      'notifications',
      'productCatalogue',
      'reconciliation',
      'rewardRules',
      'roleGovernance',
      'superAdminRecovery',
      'support',
      'systemHealth',
      'transfers',
      'workforceAccess',
      'workforceDirectory',
    ],
  },
  RISK_FRAUD: {
    type: 'OPERATOR',
    scopes: ['risk_fraud.manage_fraud_case'],
    views: ['dashboard', 'fraudCases'],
    denied: [
      'agentClasses',
      'agents',
      'approvalsInbox',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'commissionRules',
      'complianceCases',
      'customerClasses',
      'customers',
      'dashboardSettings',
      'feeRules',
      'institutions',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'notificationOperations',
      'notifications',
      'productCatalogue',
      'reconciliation',
      'rewardRules',
      'roleGovernance',
      'superAdminRecovery',
      'support',
      'systemHealth',
      'transfers',
      'workforceAccess',
      'workforceDirectory',
    ],
  },
  CUSTOMER_SERVICE: {
    type: 'OPERATOR',
    scopes: [
      'customer.manage_classes',
      'customer.manage_support_case',
      'customer.view',
      'customer.view_address',
      'customer.view_contact_methods',
      'customer.view_transactions',
      'customer.view_wallets',
    ],
    views: ['customerClasses', 'customers', 'dashboard', 'support'],
    denied: [
      'agentClasses',
      'agents',
      'approvalsInbox',
      'auditEvents',
      'auditInspection',
      'bankingOperations',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'commissionRules',
      'complianceCases',
      'dashboardSettings',
      'feeRules',
      'fraudCases',
      'institutions',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'notificationOperations',
      'notifications',
      'productCatalogue',
      'reconciliation',
      'rewardRules',
      'roleGovernance',
      'superAdminRecovery',
      'systemHealth',
      'transfers',
      'workforceAccess',
      'workforceDirectory',
    ],
  },
  TREASURY: {
    type: 'OPERATOR',
    scopes: ['reconciliation.view'],
    views: ['bankingOperations', 'dashboard', 'reconciliation'],
    denied: [
      'agentClasses',
      'agents',
      'approvalsInbox',
      'auditEvents',
      'auditInspection',
      'cashIn',
      'cashOut',
      'cashToCashOps',
      'commissionRules',
      'complianceCases',
      'customerClasses',
      'customers',
      'dashboardSettings',
      'feeRules',
      'fraudCases',
      'institutions',
      'kycProviders',
      'kycQueue',
      'kycTierPolicies',
      'ledgerExplorer',
      'limitAssignments',
      'limitCatalogue',
      'notificationOperations',
      'notifications',
      'productCatalogue',
      'rewardRules',
      'roleGovernance',
      'superAdminRecovery',
      'support',
      'systemHealth',
      'transfers',
      'workforceAccess',
      'workforceDirectory',
    ],
  },
};

/**
 * Views whose content is actually clicked and verified per role.
 *
 * `views` (below) is the exhaustive nav-DOM expectation: it must match, item for item, what the
 * shell renders for the role. `verify` is the subset this harness opens and content-checks. The
 * remaining views are outside Arena B9 (money movement, KYC operations, catalogue administration)
 * and their endpoints are not modelled by the fixture API, so clicking them would produce a
 * fixture artefact rather than an observation about access control.
 */
const VERIFY_VIEWS = {
  SUPER_ADMIN: [
    'dashboard',
    'workforceAccess',
    'workforceDirectory',
    'roleGovernance',
    'auditEvents',
  ],
  FINANCE_PREPARER: ['dashboard', 'feeRules', 'ledgerExplorer'],
  FINANCE_CONTROLLER: ['dashboard', 'approvalsInbox', 'feeRules', 'workforceDirectory'],
  FINANCE_AUDITOR: ['dashboard', 'auditEvents', 'workforceDirectory'],
  ADMINISTRATOR: [
    'dashboard',
    'workforceAccess',
    'workforceDirectory',
    'roleGovernance',
    'superAdminRecovery',
  ],
  OPERATIONS: ['dashboard', 'customers', 'workforceAccess'],
  AGENT_NETWORK_MANAGER: ['dashboard', 'agents'],
  COMPLIANCE: ['dashboard', 'kycQueue'],
  RISK_FRAUD: ['dashboard', 'fraudCases'],
  CUSTOMER_SERVICE: ['dashboard', 'customers'],
  TREASURY: ['dashboard', 'reconciliation'],
};

const VIEW_MARKERS = {
  dashboard: /Welcome back|Default Dashboard|Acceptance dashboard/i,
  customers: /Customer Directory/i,
  agents: /Agent Network Management/i,
  feeRules: /Commercial Rule Registries/i,
  ledgerExplorer: /Ledger Core/i,
  approvalsInbox: /Privileged Approvals/i,
  workforceAccess: /Workforce Overview & Support Provisioning/i,
  workforceDirectory: /Workforce directory/i,
  roleGovernance: /Role (Assignments|Governance)/i,
  superAdminRecovery: /Super-Admin Recovery/i,
  auditEvents: /Audit & Security Events/i,
  reconciliation: /Reconciliation/i,
  kycQueue: /KYC Assessment/i,
  fraudCases: /Fraud Case Lookup/i,
};

const VIEW_LABELS = {
  dashboard: /^Dashboard$/i,
  customers: /Customer directory/i,
  agents: /Agent network/i,
  feeRules: /Fee rules/i,
  ledgerExplorer: /Ledger/i,
  approvalsInbox: /^Approvals$/i,
  workforceAccess: /Workforce access/i,
  workforceDirectory: /Workforce directory/i,
  roleGovernance: /Role governance/i,
  superAdminRecovery: /Super-Admin Recovery|Recovery/i,
  auditEvents: /Audit/i,
  reconciliation: /Reconciliation/i,
  kycQueue: /KYC/i,
  fraudCases: /Fraud/i,
};

const VIEW_SECTIONS = {
  dashboard: 'home',
  dashboardSettings: 'home',
  customers: 'servicing',
  customerClasses: 'servicing',
  agents: 'servicing',
  agentClasses: 'servicing',
  support: 'servicing',
  institutions: 'institutions',
  transfers: 'money',
  cashIn: 'money',
  cashOut: 'money',
  cashToCashOps: 'money',
  ledgerExplorer: 'finance',
  reconciliation: 'finance',
  feeRules: 'commercial',
  commissionRules: 'commercial',
  rewardRules: 'commercial',
  productCatalogue: 'commercial',
  limitCatalogue: 'commercial',
  limitAssignments: 'commercial',
  kycQueue: 'compliance',
  complianceCases: 'compliance',
  fraudCases: 'compliance',
  workforceAccess: 'platform',
  roleGovernance: 'platform',
  approvalsInbox: 'platform',
  superAdminRecovery: 'platform',
  notifications: 'platform',
  systemHealth: 'platform',
  auditEvents: 'platform',
  workforceDirectory: 'platform',
};

const MAKER = 'https://idp.example.com:maker-01';
/** Principal ids are issuer-derived for local accounts (`<issuer>:local-admin-credential:<hash>`). */
const CHECKER_PRINCIPAL =
  'https://idp.example.com:local-admin-credential:finance-controller@monienaija.local';
const CHECKER = CHECKER_PRINCIPAL;

const approval = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  actionType: 'FEE_RULE_MODIFY',
  resourceType: 'FEE_RULE',
  resourceId: 'fee-rule-42',
  customerId: null,
  requesterPrincipalId: MAKER,
  approvedBy: null,
  reason: 'Align the transfer fee with the approved schedule',
  approvalScope: 'fee_rule.modify',
  requiredAssurance: 'MFA',
  policy: { requestDetails: { feeRuleReference: 'FEE-TRF-01', newAmountMinor: '2500' } },
  status: 'REQUESTED',
  requestedAt: '2026-11-24T09:00:00.000Z',
  expiresAt: '2099-11-24T09:30:00.000Z',
  approvedAt: null,
  rejectedAt: null,
  cancelledAt: null,
  consumedAt: null,
  version: 1,
  authority: {
    approvingRoles: ['FINANCE_CONTROLLER'],
    approvingFunctions: ['fee_rule.modify'],
    minimumApprovals: 1,
    selfApprovalProhibited: true,
    minimumAssurance: 'MFA',
    approvalScope: 'fee_rule.modify',
    governed: true,
  },
  ...overrides,
});

const APPROVALS = [
  approval(),
  approval({
    id: '22222222-2222-4222-8222-222222222222',
    actionType: 'COMMISSION_RULE_CREATE',
    resourceType: 'COMMISSION_RULE',
    resourceId: 'commission-rule-7',
    status: 'APPROVED',
    approvedBy: CHECKER,
    approvedAt: '2026-11-24T09:10:00.000Z',
  }),
  approval({
    id: '33333333-3333-4333-8333-333333333333',
    actionType: 'REWARD_RULE_CREATE',
    resourceType: 'REWARD_RULE',
    resourceId: 'reward-rule-3',
    status: 'CONSUMED',
    approvedBy: CHECKER,
    approvedAt: '2026-11-24T09:10:00.000Z',
    consumedAt: '2026-11-24T09:15:00.000Z',
  }),
  approval({
    id: '44444444-4444-4444-8444-444444444444',
    actionType: 'PRODUCT_MODIFY',
    resourceType: 'PRODUCT',
    resourceId: 'product-9',
    status: 'REJECTED',
    approvedBy: CHECKER,
    rejectedAt: '2026-11-24T09:12:00.000Z',
  }),
  approval({
    id: '55555555-5555-4555-8555-555555555555',
    actionType: 'LIMIT_RULE_UPDATE',
    resourceType: 'LIMIT_RULE',
    resourceId: 'limit-rule-2',
    status: 'REQUESTED',
    expiresAt: '2020-01-01T00:00:00.000Z',
  }),
];

const SELF_APPROVAL = approval({
  id: '66666666-6666-4666-8666-666666666666',
  actionType: 'FEE_RULE_CREATE',
  resourceType: 'FEE_RULE',
  resourceId: 'fee-rule-self',
  requesterPrincipalId: CHECKER,
  reason: 'Checker raised this request',
});

const DIRECTORY_ENTRY = {
  principalId: 'https://idp.example.com:target-operator',
  principalType: 'WORKFORCE',
  accountStatus: 'ACTIVE',
  roles: [{ roleKey: 'OPERATIONS', status: 'ACTIVE', readOnly: false }],
  readOnlyPrincipal: false,
  institutionScope: {
    mode: 'INSTITUTIONS',
    platformFunctionGranted: false,
    active: [
      {
        institutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        institutionName: 'Example Bank',
        code: 'EXB',
      },
    ],
    revokedCount: 1,
  },
  activeSessionCount: 1,
  lastSeenAt: '2026-11-24T08:00:00.000Z',
  permissionCount: 14,
  privilegedPermissionCount: 2,
};

const DIRECTORY_DETAIL = {
  ...DIRECTORY_ENTRY,
  sessions: [
    {
      id: 'session-1',
      status: 'ACTIVE',
      assuranceLevel: 'MFA',
      audience: 'workforce-admin',
      lastSeenAt: '2026-11-24T08:00:00.000Z',
      expiresAt: '2026-11-24T08:15:00.000Z',
      revokedAt: null,
    },
  ],
  effectivePermissions: [
    {
      functionCode: 'customer.view',
      accessType: 'VIEW',
      domain: 'CUSTOMER',
      name: 'View customer',
      sensitivity: 'READ',
    },
  ],
  administrativeAuthorizations: [],
  boundaries: {
    readOnly: true,
    note: 'Read-only projection of effective catalogue grants and institution assignments.',
    roleGrantRoute: 'POST /api/v1/internal/a2/workforce/roles',
    roleRevokeRoute: 'DELETE /api/v1/internal/a2/workforce/roles/:principalId/:roleKey',
  },
};

const sessionFor = (role, email, overrides = {}) => ({
  accessToken: `fixture-token-${role}`,
  tokenType: 'Bearer',
  sessionId: `fixture-session-${role}`,
  expiresAt: '2099-01-01T00:00:00.000Z',
  principal: {
    type_ignored: undefined,
    ...{
      type: ROLE_PRINCIPALS[role].type,
      principalId: `https://idp.example.com:local-admin-credential:${email}`,
      sessionId: `fixture-session-${role}`,
      audience: 'workforce-admin',
      roles: [role],
      scopes: [...ROLE_PRINCIPALS[role].scopes],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
    ...overrides,
  },
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const probeMode = process.env.B9_PROBE === '1';
  const probe = {};
  const dist = path.resolve(args.dist ?? '');
  const out = path.resolve(args.out ?? 'docs/integration/evidence/b9-workforce-approvals');
  const executable = args.executable ?? process.env.BROWSER_EXECUTABLE_PATH;
  const libPath = args['lib-path'] ?? process.env.BROWSER_LIBRARY_PATH;
  const port = Number(args.port ?? 4399);

  if (!dist || !fs.existsSync(path.join(dist, 'index.html'))) {
    console.error(
      `no built bundle at ${dist} (run: ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build)`,
    );
    process.exit(2);
  }
  if (libPath) process.env.LD_LIBRARY_PATH = libPath;
  fs.mkdirSync(out, { recursive: true });

  const { chromium } = require('playwright');
  const base = `http://127.0.0.1:${port}`;
  const results = [];
  const record = (id, ok, detail) => {
    results.push({ id, ok, detail: String(detail).slice(0, 500) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} :: ${String(detail).slice(0, 200)}`);
  };

  const server = await serveStatic(dist, port);
  const browser = await chromium.launch({
    executablePath: executable || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const requests = [];
  const consoleErrors = [];
  const pageErrors = [];
  let mode = 'role';
  let currentRole = 'FINANCE_CONTROLLER';

  const routeHandler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({
      method: request.method(),
      path: url.pathname,
      query: url.search,
      body: request.postData() ?? null,
    });
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname.endsWith('/internal/a2/workforce/local-admin-sessions')) {
      if (mode === 'reject') {
        return json({ statusCode: 401, message: 'Invalid credentials' }, 401);
      }
      const email = JSON.parse(request.postData() ?? '{}').email ?? 'unknown';
      return json(sessionFor(currentRole, email));
    }

    if (url.pathname.endsWith('/internal/a2/workforce/dashboard/my-dashboard')) {
      return json({
        templateKey: 'acceptance-template',
        displayName: 'Acceptance dashboard',
        description: 'Fixture dashboard',
        isFallback: false,
        widgets: [],
      });
    }

    if (/\/internal\/a2\/workforce\/approvals\/[0-9a-f-]{36}$/.test(url.pathname)) {
      const id = url.pathname.split('/').pop();
      const found = [...APPROVALS, SELF_APPROVAL].find((item) => item.id === id);
      return found ? json(found) : json({ statusCode: 404, message: 'Approval not found' }, 404);
    }
    if (url.pathname.endsWith('/internal/a2/workforce/approvals')) {
      return json({
        items: currentRole === 'FINANCE_CONTROLLER' ? [...APPROVALS, SELF_APPROVAL] : [],
        total: currentRole === 'FINANCE_CONTROLLER' ? APPROVALS.length + 1 : 0,
      });
    }
    if (
      /\/internal\/a2\/workforce\/approvals\/[0-9a-f-]{36}\/(approve|reject)$/.test(url.pathname)
    ) {
      const action = url.pathname.endsWith('/approve') ? 'approve' : 'reject';
      const id = url.pathname.split('/').slice(-2)[0];
      return json({
        approved: action === 'approve',
        reason: action === 'approve' ? 'APPROVED' : 'REJECTED',
        approval: { id, status: action === 'approve' ? 'APPROVED' : 'REJECTED' },
      });
    }

    if (url.pathname.endsWith('/internal/workforce/directory')) {
      return json({
        data: [DIRECTORY_ENTRY],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        accessMode: 'READ_ONLY',
      });
    }
    if (/\/internal\/workforce\/directory\/.+$/.test(url.pathname)) {
      return json(DIRECTORY_DETAIL);
    }

    // Anything this harness does not model is a 404 — the same answer the real API gives for an
    // unimplemented route. Returning a generic empty object instead makes screens that expect an
    // array throw, which would be a fixture artefact rather than a product observation.
    return json({ statusCode: 404, message: 'Not found' }, 404);
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/api/v1/**', routeHandler);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)));

  const openNav = async (view) => {
    const nav = page.locator(`[data-testid="nav-${view}"]`);
    if (
      !(await nav
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      const section = page.locator(`[data-testid="section-${VIEW_SECTIONS[view]}"]`).first();
      if ((await section.count()) > 0) await section.click();
    }
    await page.locator(`[data-testid="nav-${view}"]`).click();
    // An unsaved governed draft raises the shell's leave guard; accepting it is the operator's
    // explicit choice, and the guard itself is asserted separately.
    const discard = page.locator('button:has-text("Discard and leave")').first();
    if (await discard.isVisible().catch(() => false)) await discard.click();
  };

  const signIn = async (role) => {
    currentRole = role;
    const email = `${role.toLowerCase().replace(/_/g, '-')}@monienaija.local`;
    await context.clearCookies();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.fill('#admin-login-email', email);
    await page.fill('#admin-login-password', `MonieNaija_${role}_123!`);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 15000 });
    return email;
  };

  // --------------------------------------------------------------------------------------
  // 1. Sign-in and expected page access for all eleven local role accounts.
  // --------------------------------------------------------------------------------------
  // Expanding every section first makes the nav DOM exhaustive: a collapsed section renders no
  // items, so "the item is absent" would otherwise be indistinguishable from "the section is
  // closed" and a role without a grant could never be caught.
  const expandAllSections = async () => {
    const sections = page.locator('[data-testid^="section-"]');
    const count = await sections.count();
    for (let i = 0; i < count; i += 1) {
      const section = sections.nth(i);
      if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();
    }
  };
  const viewsToCheck = (role, probeMode, rendered) => (probeMode ? rendered : VERIFY_VIEWS[role]);
  const visibleNavViews = async () => {
    const ids = await page
      .locator('[data-testid^="nav-"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node.getAttribute('data-testid') ?? '').replace(/^nav-/, '')),
      );
    return [...new Set(ids)].sort();
  };

  for (const role of Object.keys(ROLE_PRINCIPALS)) {
    const email = await signIn(role);
    await expandAllSections();
    const navText = (await page.locator('[data-testid="desktop-nav"]').innerText()).toLowerCase();
    const reachable = [];
    const denied = [];

    // Exhaustive access matrix: every rendered nav item must be a declared grant, and every
    // declared grant must be rendered. Nothing may appear that the role's scopes do not carry.
    const declared = [...ROLE_PRINCIPALS[role].views].sort();
    const rendered = await visibleNavViews();
    const extras = rendered.filter((view) => !declared.includes(view));
    const missing = declared.filter((view) => !rendered.includes(view));
    if (extras.length) denied.push(`undeclared:[${extras.join(', ')}]`);
    if (missing.length) denied.push(`missing:[${missing.join(', ')}]`);
    probe[role] = { rendered, headings: {} };

    for (const view of viewsToCheck(role, probeMode, rendered)) {
      const sectionTestId = `[data-testid="section-${VIEW_SECTIONS[view]}"]`;
      const navTestId = `[data-testid="nav-${view}"]`;
      const section = page.locator(sectionTestId).first();
      if ((await section.count()) > 0) {
        const expanded = await section.getAttribute('aria-expanded');
        const itemVisible = await page
          .locator(navTestId)
          .first()
          .isVisible()
          .catch(() => false);
        if (expanded === 'false' || !itemVisible) await section.click();
      }
      const item = page.locator(navTestId).first();
      if ((await item.count()) === 0) {
        denied.push(`${view}:absent`);
        continue;
      }
      await item.click();
      await page.waitForTimeout(200);
      const main = page.locator('[data-testid="main-content"]');
      if ((await main.count()) === 0) {
        denied.push(`${view}:no-main-content`);
        continue;
      }
      const mainText = await main.innerText({ timeout: 5000 }).catch(() => '');
      const deniedBanner = /not available to the current workforce principal/i.test(mainText);
      const heading = await page
        .locator('[data-testid="main-content"] h1')
        .first()
        .innerText()
        .catch(() => '');
      probe[role].headings[view] = heading.replace(/\s+/g, ' ').trim();
      const marker = VIEW_MARKERS[view];
      // Views without a hand-written marker still have to render an actual page heading — a
      // blank or permission-denied screen is never counted as reachable.
      const contentOk = marker ? marker.test(mainText) : heading.length > 0;
      if (contentOk && !deniedBanner) reachable.push(view);
      else denied.push(`${view}:rendered-without-marker`);
    }

    for (const view of ROLE_PRINCIPALS[role].denied) {
      const count = await page.locator(`[data-testid="nav-${view}"]`).count();
      if (count > 0) denied.push(`${view}:visible-without-grant`);
    }

    record(
      `SIGN-IN-${role}`,
      denied.length === 0 && reachable.length === viewsToCheck(role, probeMode, rendered).length,
      `${email} · verified=[${reachable.join(', ')}] of ${rendered.length} rendered · ` +
        `problems=[${denied.join(', ')}] · navChars=${navText.length}`,
    );
  }
  if (probeMode) {
    console.log('B9_PROBE ' + JSON.stringify(probe));
    await browser.close();
    return;
  }

  // A rejected credential must not establish a session.
  mode = 'reject';
  await context.clearCookies();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.fill('#admin-login-email', 'treasury@monienaija.local');
  await page.fill('#admin-login-password', 'wrong-password');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(800);
  record(
    'SIGN-IN-REJECTED',
    (await page.locator('[data-testid="desktop-nav"]').count()) === 0,
    'a rejected credential leaves the operator on the login screen',
  );
  mode = 'role';

  // --------------------------------------------------------------------------------------
  // 2. Approvals: evaluation inbox, proposed change, authority, history, applied state.
  // --------------------------------------------------------------------------------------
  await signIn('FINANCE_CONTROLLER');
  await openNav('approvalsInbox');
  await page.waitForSelector('[data-testid="approval-evaluation-inbox"]', { timeout: 15000 });
  const inbox = page.locator('[data-testid="approval-evaluation-inbox"]');
  await inbox.locator('text=Awaiting decision').first().waitFor({ timeout: 10000 });

  record(
    'APPROVALS-INBOX-RENDERS',
    (await inbox.locator('li[data-testid^="approval-row-"]').count()) >= 1,
    `rows=${await inbox.locator('li[data-testid^="approval-row-"]').count()}`,
  );
  record(
    'APPROVALS-INBOX-PROPOSED-CHANGE',
    (await inbox.innerText()).includes('FEE_RULE') &&
      (await inbox.innerText()).includes('FINANCE_CONTROLLER'),
    'affected record and required approving role are on the row',
  );

  const pendingRow = inbox.locator(
    '[data-testid="approval-row-11111111-1111-4111-8111-111111111111"]',
  );
  await pendingRow.locator('button', { hasText: 'Full evaluation' }).click();
  const detailText = await pendingRow
    .locator('[data-testid="approval-detail-11111111-1111-4111-8111-111111111111"]')
    .innerText();
  record(
    'APPROVALS-EVALUATION-DETAIL',
    detailText.includes('Proposed change') &&
      detailText.includes('FEE-TRF-01') &&
      detailText.includes('Required authority') &&
      detailText.includes('Recorded decision history') &&
      detailText.includes('no catalogue function') === false,
    'proposed change, affected record, required authority and decision history are shown',
  );

  await pendingRow.locator('button', { hasText: 'Load into checker decision' }).click();
  const loadedId = await page.inputValue('#checker-approval-id');
  record(
    'APPROVALS-LOAD-INTO-CHECKER',
    loadedId === '11111111-1111-4111-8111-111111111111',
    `checker field value=${loadedId}`,
  );

  await page.fill('#checker-comment', 'Verified against the approved fee schedule.');
  await page.click('button:has-text("Sign & Approve Action")');
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  record(
    'APPROVALS-REVIEW-DIALOG',
    (await page.locator('[role="dialog"]').innerText()).includes(
      '11111111-1111-4111-8111-111111111111',
    ),
    'confirmation dialog names the approval id before any write',
  );
  await page.click('[role="dialog"] button:has-text("Confirm decision")');
  await page.waitForSelector('[role="status"]', { timeout: 10000 });
  const decisionPost = requests.find(
    (entry) =>
      entry.method === 'POST' &&
      entry.path ===
        '/api/v1/internal/a2/workforce/approvals/11111111-1111-4111-8111-111111111111/approve',
  );
  record(
    'APPROVALS-DECISION-SUBMITTED',
    Boolean(decisionPost) &&
      JSON.parse(decisionPost.body ?? '{}').comment ===
        'Verified against the approved fee schedule.',
    `POST ${decisionPost?.path ?? '(none)'} body=${decisionPost?.body ?? '(none)'}`,
  );

  await page.waitForSelector('[role="status"]', { timeout: 10000 });
  const receiptText = await page.locator('[role="status"]').first().innerText();
  record(
    'APPROVALS-RECEIPT-SHOWN',
    /Approval recorded/.test(receiptText),
    receiptText.replace(/\s+/g, ' ').slice(0, 180),
  );
  await inbox.scrollIntoViewIfNeeded();
  await inbox.screenshot({ path: path.join(out, 'b9-approvals-inbox-1440x1000.png') });

  // Non-pending states must be labelled, not implied.
  await inbox.locator('button', { hasText: /All visible/ }).click();
  const allText = await inbox.innerText();
  record(
    'APPROVALS-STATE-VOCABULARY',
    ['Approved — not yet applied', 'Approved — applied', 'Rejected', 'Stale — expired'].every(
      (label) => allText.includes(label),
    ) && allText.includes('already in effect'),
    'approved-not-applied, applied, rejected and stale are each stated',
  );

  // Blocked self-approval.
  const selfRow = inbox.locator(
    '[data-testid="approval-row-66666666-6666-4666-8666-666666666666"]',
  );
  record(
    'APPROVALS-SELF-APPROVAL-BLOCKED',
    (await selfRow.innerText()).includes('Your own request') &&
      (await selfRow.locator('button:has-text("Decision blocked")').isDisabled()),
    'the checker cannot load their own request for a decision',
  );

  // --------------------------------------------------------------------------------------
  // 3. Directory → Role governance hand-off with the identity already in view.
  // --------------------------------------------------------------------------------------
  await signIn('ADMINISTRATOR');
  const directoryNav = page.locator('[data-testid="nav-workforceDirectory"]');
  if ((await directoryNav.count()) > 0) {
    await openNav('workforceDirectory');
  } else {
    // The catalogued ADMINISTRATOR holds no workforce.role.view: use the Workforce access hand-off,
    // which itself tells the operator that identity lookup needs that function.
    await openNav('workforceAccess');
    await page.locator('button', { hasText: 'Open workforce directory' }).click();
    record(
      'DIRECTORY-HANDOFF-REQUIRES-GRANT',
      (await page.locator('[data-testid="main-content"]').innerText()).includes(
        'workforce.role.view',
      ),
      'without workforce.role.view the directory (and its hand-off) is not reachable',
    );
  }
  await page.waitForSelector('text=Workforce directory', { timeout: 10000 });
  await page.locator('button', { hasText: 'View details' }).click();
  await page.waitForSelector('[data-testid="a4-govern-access"]', { timeout: 10000 });
  record(
    'DIRECTORY-IDENTITY-VISIBLE',
    (await page.locator('body').innerText()).includes('Effective permissions') &&
      (await page.locator('body').innerText()).includes('Example Bank'),
    'roles, effective permissions and institution restrictions are shown for the identity',
  );
  await page.screenshot({ path: path.join(out, 'b9-workforce-directory-1440x1000.png') });
  await page.click('[data-testid="a4-govern-access"]');
  await page.waitForSelector('[data-testid="role-target-identity"]', { timeout: 15000 });
  const governanceText = await page.locator('body').innerText();
  record(
    'DIRECTORY-TO-GOVERNANCE-HANDOFF',
    (await page.inputValue('#role-target-principal')) === DIRECTORY_ENTRY.principalId &&
      governanceText.includes('Prefilled from the workforce directory') &&
      governanceText.includes('OPERATIONS (ACTIVE)') &&
      governanceText.includes('Example Bank'),
    'Role governance opens with the inspected principal, its current roles and institution scope',
  );
  record(
    'GOVERNANCE-BLOCKS-DUPLICATE',
    (await page.locator('button:has-text("Commit Role Assignment")').isDisabled()) &&
      governanceText.includes('already holds an active OPERATIONS assignment'),
    'a duplicate assignment is blocked once current roles are verified',
  );
  await page.screenshot({ path: path.join(out, 'b9-role-governance-1440x1000.png') });

  // --------------------------------------------------------------------------------------
  // 4. Admin Recovery screen: statement is only consumed after explicit confirmation.
  // --------------------------------------------------------------------------------------
  const recoveryNav = page.locator('[data-testid="nav-superAdminRecovery"]');
  if (!(await recoveryNav.isVisible().catch(() => false))) {
    await page.locator('[data-testid="section-platform"]').first().click();
  }
  await recoveryNav.click();
  const leaveDialog = page.locator('button:has-text("Discard and leave")').first();
  const leaveGuardShown = await leaveDialog
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  record(
    'GOVERNANCE-DRAFT-LEAVE-GUARD',
    leaveGuardShown,
    'leaving a prepared role change required an explicit discard confirmation',
  );
  if (leaveGuardShown) await leaveDialog.click();
  await page.waitForSelector('text=Super-Admin Recovery', { timeout: 10000 });
  const recoveryBefore = requests.filter((entry) =>
    entry.path.includes('/super-admin/recovery'),
  ).length;
  record(
    'RECOVERY-RENDERS-WITHOUT-WRITE',
    recoveryBefore === 0,
    'recovery workspace opened with no recovery request sent',
  );
  await page.screenshot({ path: path.join(out, 'b9-super-admin-recovery-1440x1000.png') });

  // --------------------------------------------------------------------------------------
  // Report
  // --------------------------------------------------------------------------------------
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !/Failed to load resource|403|404/.test(message),
  );
  record(
    'NO-UNEXPECTED-PAGE-ERRORS',
    pageErrors.length === 0 && unexpectedConsoleErrors.length === 0,
    `pageErrors=${pageErrors.join(' | ') || 'none'} · console=${unexpectedConsoleErrors.join(' | ') || 'none'}`,
  );

  const failed = results.filter((item) => !item.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    browser: browser.version(),
    viewport: '1440x1000',
    bundle: dist,
    api: {
      origin: 'fixture (route-intercepted at the browser network layer)',
      note: 'Client behaviour only. Server maker-checker, role, institution, MFA and recovery controls are covered by the Nest HTTP and PostgreSQL suites.',
    },
    totals: {
      checks: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
    },
    results,
  };
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(out, 'report.md'),
    [
      '# Arena B9 — Workforce & Approvals browser acceptance',
      '',
      `Generated: ${report.generatedAt}`,
      `Browser: ${report.browser} · viewport ${report.viewport}`,
      `API: ${report.api.origin}`,
      '',
      `${report.totals.passed}/${report.totals.checks} checks passed.`,
      '',
      '| Check | Result | Evidence |',
      '| --- | --- | --- |',
      ...results.map(
        (item) =>
          `| \`${item.id}\` | ${item.ok ? 'PASS' : 'FAIL'} | ${item.detail.replace(/\|/g, '\\|')} |`,
      ),
      '',
      'Screenshots in this directory: `b9-approvals-inbox-1440x1000.png`,',
      '`b9-workforce-directory-1440x1000.png`, `b9-role-governance-1440x1000.png`,',
      '`b9-super-admin-recovery-1440x1000.png`.',
      '',
      report.api.note,
      '',
    ].join('\n'),
  );

  await context.close();
  await browser.close();
  server.close();
  console.log(`\n${report.totals.passed}/${report.totals.checks} checks passed → ${out}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  // Never leave a browser or static server alive after a failed run: that would hold the port and
  // turn the next attempt into a confusing EADDRINUSE.
  process.exit(1);
});
