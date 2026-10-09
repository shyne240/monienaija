import { FunctionSensitivity, FunctionV1Status, RoleFunctionAccessType } from './authorization-catalogue.enums';

/**
 * V1-ADMIN-AUTHORIZATION-FOUNDATION-01 seed data.
 *
 * SOURCE OF TRUTH: every function_code below is taken verbatim from
 * docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md §7 (function catalogue).
 * No function identifiers are invented here. Role boundaries and the
 * role→function assignments below are taken from that same document's §6
 * per-role definitions and §9 matrix, as finalized (non-reopenable) by
 * docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md.
 *
 * EXCEPTION — three functions added by a later task: `customer.view_address`,
 * `customer.view_contact_methods`, `customer.view_identity_documents` were not
 * present in the original SPEC-01 §7 catalogue (a gap documented by
 * V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01). Their function identifiers,
 * sensitivity classification, and exact role assignments are instead sourced
 * from docs/V1/V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01.md (approved),
 * implemented by V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01.
 *
 * IMPORTANT — what `assignable` does and does not mean here:
 *   - `assignable: false` is used for every FUTURE / OUT_OF_V1_SCOPE
 *     function, and for the explicit non-assignable list named in the
 *     V1-ADMIN-AUTHORIZATION-FOUNDATION-01 task (transaction.search,
 *     transaction-level reversal, agent.manage_permissions,
 *     compliance.restrict_account/
 *     release_restriction, audit.export, reconciliation.investigate/resolve,
 *     dedicated fraud-engine functions, external Treasury/settlement
 *     functions). None of these receive any row in ROLE_FUNCTION_SEED.
 *   - `workforce.role.create`/`workforce.role.modify` were FUTURE/
 *     non-assignable as of V1-ADMIN-AUTHORIZATION-FOUNDATION-01 ("Decision
 *     10: when built, requires dual-control governance"). They became
 *     IMPLEMENTED/assignable under
 *     V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01, which built
 *     exactly that dual-control governance (SUPER_ADMIN initiates,
 *     FINANCE_CONTROLLER independently approves, via
 *     RoleDefinitionGovernanceService) — see role assignments below.
 *   - `assignable: true` on a BACKEND_ONLY function (e.g. ledger.post,
 *     ledger.reverse, transaction.view, reconciliation.view) means the
 *     approved role→function matrix intentionally assigns catalogue
 *     OWNERSHIP of that function now (so the correct future maker/checker
 *     owner is already represented), while the function itself remains
 *     unreachable/unenforced at runtime until a later, dedicated task wires
 *     it up. This catalogue is NOT wired into the live
 *     AuthorizationService/RoutePolicyRegistry in this task, so no runtime
 *     behavior changes as a result of any `assignable: true` value here.
 *   - `ledger.approve_adjustment` is the one BACKEND/ledger-domain exception:
 *     it is classified FUTURE (no governed action exists for it at all
 *     today, unlike ledger.post/reverse which exist as backend code paths),
 *     so per the task's explicit instruction it is seeded as
 *     `assignable: false` and is not assigned to any role, including
 *     FINANCE_CONTROLLER. This intentional asymmetry (FINANCE_PREPARER holds
 *     ledger.post/reverse as INITIATE, but no role yet holds a matching
 *     APPROVE function) is documented in the task report and will be
 *     resolved when a later task creates the actual governed action.
 */

export interface AuthorizationFunctionSeed {
  functionCode: string;
  domain: string;
  name: string;
  description: string;
  sensitivity: FunctionSensitivity;
  v1Status: FunctionV1Status;
  assignable: boolean;
  financeClassRestricted?: boolean;
  makerCheckerRequired?: boolean;
  approvalRequired?: boolean;
  superAdminExcluded?: boolean;
  auditorVisible?: boolean;
  notes?: string;
}

export interface AuthorizationRoleSeed {
  roleKey: string;
  displayName: string;
  description: string;
  financeRoleClass?: boolean;
  administrativeCapability?: boolean;
  readOnly?: boolean;
  makerEligible?: boolean;
  checkerEligible?: boolean;
}

export interface AuthorizationRoleFunctionSeed {
  roleKey: string;
  functionCode: string;
  accessType: RoleFunctionAccessType;
}

const { READ, OPERATIONAL, SENSITIVE, PRIVILEGED, CRITICAL_FINANCIAL } = FunctionSensitivity;
const { IMPLEMENTED, PARTIALLY_IMPLEMENTED, BACKEND_ONLY, FUTURE, OUT_OF_V1_SCOPE } = FunctionV1Status;

export const AUTHORIZATION_FUNCTION_SEED: AuthorizationFunctionSeed[] = [
  // ---------------------------------------------------------------- CUSTOMER
  { functionCode: 'customer.view', domain: 'CUSTOMER', name: 'View customer profile', description: 'View a customer profile and KYC tier.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'customer.create', domain: 'CUSTOMER', name: 'Create customer', description: 'Create a new customer record.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'customer.suspend', domain: 'CUSTOMER', name: 'Suspend customer', description: 'Transition a customer to SUSPENDED status.', sensitivity: OPERATIONAL, v1Status: PARTIALLY_IMPLEMENTED, assignable: true, notes: 'Decision 4: distinct function from activate/close though the route may remain unified.' },
  { functionCode: 'customer.activate', domain: 'CUSTOMER', name: 'Activate customer', description: 'Transition a customer back to ACTIVE status.', sensitivity: OPERATIONAL, v1Status: PARTIALLY_IMPLEMENTED, assignable: true, notes: 'Decision 4: distinct function from suspend/close though the route may remain unified.' },
  { functionCode: 'customer.close', domain: 'CUSTOMER', name: 'Close customer', description: 'Transition a customer to CLOSED status.', sensitivity: OPERATIONAL, v1Status: PARTIALLY_IMPLEMENTED, assignable: true, notes: 'Decision 4: distinct function from suspend/activate though the route may remain unified.' },
  { functionCode: 'customer.terminate', domain: 'CUSTOMER', name: 'Terminate customer', description: 'Future finer-grained terminal customer status, distinct from close.', sensitivity: OPERATIONAL, v1Status: FUTURE, assignable: false },
  { functionCode: 'customer.view_transactions', domain: 'CUSTOMER', name: 'View customer transaction history', description: 'View a customer transaction history.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'customer.view_wallets', domain: 'CUSTOMER', name: 'View customer wallets', description: 'View a customer wallet balances.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'customer.create_wallet', domain: 'CUSTOMER', name: 'Create customer wallet', description: 'Create an additional wallet for a customer.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'customer.manage_support_case', domain: 'CUSTOMER', name: 'Manage customer support case', description: 'Create/update/close a customer support ticket.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01: closes the three catalogue gaps
  // V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01 deliberately left open (no existing function's
  // description covered this PII) — approved by
  // docs/V1/V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01.md. Each is its own distinct
  // function (never a repurposing of customer.view, whose documented scope is "profile and
  // KYC tier" only). customer.view_identity_documents is classified SENSITIVE (not READ) —
  // government document numbers are materially more sensitive than address/contact PII — and
  // is intentionally NOT assigned to FINANCE_AUDITOR (unlike customer.view_address/
  // .view_contact_methods, which are READ-sensitivity and FINANCE_AUDITOR-eligible), per the
  // approved decision's narrower SUPER_ADMIN/COMPLIANCE-only matrix for identity documents.
  { functionCode: 'customer.view_address', domain: 'CUSTOMER', name: 'View customer address', description: 'View a customer physical/mailing address.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'customer.view_contact_methods', domain: 'CUSTOMER', name: 'View customer contact methods', description: 'View a customer phone/email contact methods.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'customer.view_identity_documents', domain: 'CUSTOMER', name: 'View customer identity documents', description: 'View a customer identity document records, including document numbers.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, notes: 'Decision V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01: SUPER_ADMIN/COMPLIANCE only — explicitly narrower than customer.view, including FINANCE_AUDITOR exclusion.' },

  // -------------------------------------------------------------------- AGENT
  { functionCode: 'agent.view', domain: 'AGENT', name: 'View agent profile', description: 'View an agent profile and status.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'agent.review_application', domain: 'AGENT', name: 'Review agent application', description: 'Review/approve/reject an agent network application.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'agent.activate', domain: 'AGENT', name: 'Activate agent', description: 'Activate an agent.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'agent.suspend', domain: 'AGENT', name: 'Suspend agent', description: 'Suspend an agent.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'agent.terminate', domain: 'AGENT', name: 'Terminate agent', description: 'Terminate an agent.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'agent.reactivate', domain: 'AGENT', name: 'Reactivate agent', description: 'Reactivate a previously suspended/terminated agent.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'agent.manage_credentials', domain: 'AGENT', name: 'Manage agent credentials', description: 'Issue/rotate/revoke agent authentication credentials.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'agent.manage_outlets_terminals', domain: 'AGENT', name: 'Manage agent outlets/terminals', description: 'Create/update agent outlets and terminals.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'agent.assign_limit', domain: 'AGENT', name: 'Assign agent limit profile', description: 'Assign an existing limit profile to an agent.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true, notes: 'Decision 2: ordinary assignment of an existing profile — not maker/checker governed (only limit *catalogue definition* is).' },
  { functionCode: 'agent.fund', domain: 'AGENT', name: 'Fund agent float', description: 'Initiate a direct credit funding movement to an agent float/wallet.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true, notes: 'Decision 7: AGENT_NETWORK_MANAGER initiates, FINANCE_CONTROLLER approves. Approval workflow runtime not implemented in this task; ledger posting already occurs via LedgerService.postJournalInTransaction and is not duplicated here.' },
  { functionCode: 'agent.defund', domain: 'AGENT', name: 'Defund agent float', description: 'Initiate a direct debit funding movement from an agent float/wallet.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true, notes: 'Decision 7: AGENT_NETWORK_MANAGER initiates, FINANCE_CONTROLLER approves. Approval workflow runtime not implemented in this task.' },
  { functionCode: 'agent.manage_permissions', domain: 'AGENT', name: 'Manage agent permissions', description: 'Future fine-grained agent permission management.', sensitivity: SENSITIVE, v1Status: FUTURE, assignable: false },

  // --------------------------------------------------------------- AGGREGATOR
  { functionCode: 'aggregator.view', domain: 'AGGREGATOR', name: 'View aggregator', description: 'View an aggregator profile and status.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'aggregator.manage', domain: 'AGGREGATOR', name: 'Manage aggregator', description: 'Create/update/suspend an aggregator record.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },

  // --------------------------------------------------------------- TRANSACTION
  { functionCode: 'transaction.view', domain: 'TRANSACTION', name: 'View transaction', description: 'View an individual transaction record.', sensitivity: READ, v1Status: BACKEND_ONLY, assignable: true, notes: 'Blocked today by the internal:access reachability gap; not remediated in this task.' },
  { functionCode: 'transaction.search', domain: 'TRANSACTION', name: 'Search transactions', description: 'Search/filter across transaction records.', sensitivity: READ, v1Status: FUTURE, assignable: false },
  { functionCode: 'transaction.reversal.request', domain: 'TRANSACTION', name: 'Request transaction reversal', description: 'Future transaction-level reversal initiation.', sensitivity: CRITICAL_FINANCIAL, v1Status: FUTURE, assignable: false, financeClassRestricted: true, superAdminExcluded: true },
  { functionCode: 'transaction.reversal.approve', domain: 'TRANSACTION', name: 'Approve transaction reversal', description: 'Future transaction-level reversal approval.', sensitivity: CRITICAL_FINANCIAL, v1Status: FUTURE, assignable: false, financeClassRestricted: true, superAdminExcluded: true },

  // -------------------------------------------------------------------- LEDGER
  { functionCode: 'ledger.view', domain: 'LEDGER', name: 'View ledger', description: 'View ledger journals/entries.', sensitivity: READ, v1Status: BACKEND_ONLY, assignable: true, notes: 'Blocked today by the internal:access reachability gap; not remediated in this task.' },
  { functionCode: 'ledger.post', domain: 'LEDGER', name: 'Post ledger journal', description: 'Initiate (maker) a manual ledger journal posting.', sensitivity: CRITICAL_FINANCIAL, v1Status: BACKEND_ONLY, assignable: true, financeClassRestricted: true, makerCheckerRequired: true, approvalRequired: true, superAdminExcluded: true, notes: 'Generic POST /ledger/journals is unreachable (internal:access gap) and has no maker/checker gate or actor capture today. Not remediated in this task.' },
  { functionCode: 'ledger.reverse', domain: 'LEDGER', name: 'Reverse ledger journal', description: 'Initiate (maker) a manual ledger journal reversal.', sensitivity: CRITICAL_FINANCIAL, v1Status: BACKEND_ONLY, assignable: true, financeClassRestricted: true, makerCheckerRequired: true, approvalRequired: true, superAdminExcluded: true, notes: 'Not remediated in this task; see ledger.post notes.' },
  { functionCode: 'ledger.approve_adjustment', domain: 'LEDGER', name: 'Approve ledger adjustment', description: 'Checker approval of a manual ledger posting/reversal.', sensitivity: CRITICAL_FINANCIAL, v1Status: FUTURE, assignable: false, financeClassRestricted: true, makerCheckerRequired: true, approvalRequired: true, superAdminExcluded: true, notes: 'No governed action exists for this at all today (distinct from ledger.post/reverse, which at least exist as unreachable backend code). Not assignable per explicit task instruction; intentionally not assigned to FINANCE_CONTROLLER yet.' },

  // ------------------------------------------------------------------- FINANCE
  { functionCode: 'finance.control_policy.activate', domain: 'FINANCE', name: 'Activate finance control policy', description: 'Maker/checker governed finance control policy activation (already live today).', sensitivity: PRIVILEGED, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true, superAdminExcluded: false },
  { functionCode: 'fee_rule.create', domain: 'FINANCE', name: 'Create fee rule', description: 'Create a new fee rule.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true, notes: 'Decision 2: now maker/checker governed under Finance roles.' },
  { functionCode: 'fee_rule.modify', domain: 'FINANCE', name: 'Modify fee rule', description: 'Modify an existing fee rule.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true },
  { functionCode: 'fee_rule.view', domain: 'FINANCE', name: 'View fee rule', description: 'View fee rule configuration.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'commission_rule.create', domain: 'FINANCE', name: 'Create commission rule', description: 'Create a new commission rule.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true },
  { functionCode: 'commission_rule.modify', domain: 'FINANCE', name: 'Modify commission rule', description: 'Modify an existing commission rule.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true },
  { functionCode: 'commission_rule.view', domain: 'FINANCE', name: 'View commission rule', description: 'View commission rule configuration.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'reward_rule.create', domain: 'FINANCE', name: 'Create reward rule', description: 'Create a new reward rule.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true },
  { functionCode: 'reward_rule.modify', domain: 'FINANCE', name: 'Modify reward rule', description: 'Modify an existing reward rule.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true },
  { functionCode: 'reward_rule.view', domain: 'FINANCE', name: 'View reward rule', description: 'View reward rule configuration.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'product.modify', domain: 'FINANCE', name: 'Modify product', description: 'Modify a commercial product configuration.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true },
  { functionCode: 'product.governance', domain: 'FINANCE', name: 'Govern product', description: 'Product governance actions (activate/deprecate).', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true },
  { functionCode: 'product.view', domain: 'FINANCE', name: 'View product', description: 'View product configuration.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'limit.modify', domain: 'FINANCE', name: 'Modify limit catalogue', description: 'Create/modify a limit profile or rule definition in the catalogue.', sensitivity: SENSITIVE, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true, notes: 'Decision 2: catalogue/definition-level change — distinct from agent.assign_limit, which merely assigns an existing profile.' },
  { functionCode: 'limit.view', domain: 'FINANCE', name: 'View limit catalogue', description: 'View limit profile/rule catalogue.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },

  // ----------------------------------------------------------------- WORKFORCE
  { functionCode: 'workforce.role.view', domain: 'WORKFORCE', name: 'View workforce role assignments', description: 'View workforce role assignment records.', sensitivity: READ, v1Status: PARTIALLY_IMPLEMENTED, assignable: true },
  { functionCode: 'workforce.role.assign', domain: 'WORKFORCE', name: 'Assign workforce role', description: 'Grant a role to a workforce principal (maker side).', sensitivity: PRIVILEGED, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true },
  { functionCode: 'workforce.role.revoke', domain: 'WORKFORCE', name: 'Revoke workforce role', description: 'Revoke a role from a workforce principal (maker side).', sensitivity: PRIVILEGED, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true },
  { functionCode: 'workforce.role.create', domain: 'WORKFORCE', name: 'Create workforce role', description: 'Create a new configurable role (dynamic role creation).', sensitivity: PRIVILEGED, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true, notes: 'Decision 10: dual-control governance. Implemented by V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01 via RoleDefinitionGovernanceService: SUPER_ADMIN holds this as INITIATE, FINANCE_CONTROLLER holds it as APPROVE. Not assigned to ADMINISTRATOR or any other role.' },
  { functionCode: 'workforce.role.modify', domain: 'WORKFORCE', name: 'Modify workforce role', description: 'Modify an existing role definition/bundle.', sensitivity: PRIVILEGED, v1Status: IMPLEMENTED, assignable: true, makerCheckerRequired: true, approvalRequired: true, notes: 'Decision 10: dual-control governance. Implemented by V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01 via RoleDefinitionGovernanceService; only ever targets roles created through that same workflow (is_system_seeded = FALSE) — the eleven V1-seeded roles are immutable through this path. SUPER_ADMIN holds this as INITIATE, FINANCE_CONTROLLER holds it as APPROVE. Not assigned to ADMINISTRATOR or any other role.' },
  // V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01 (GOVERNANCE-DECISIONS-01 Decision 2):
  // deliberately DISTINCT function codes from workforce.role.assign/.revoke, not a reuse of them
  // with a different accessType — overloading one function code with two different authorization
  // meanings (SUPER_ADMIN/FINANCE-scope maker/checker vs. ADMINISTRATOR-scope direct EXECUTE)
  // would make the two code paths impossible to independently audit or independently revoke as
  // catalogue grants. No maker/checker metadata here: this is a direct-EXECUTE action gated by
  // the `initiated_scope` DB CHECK constraint (migration 1785753600085), not a human approver.
  { functionCode: 'workforce.role.assign_operational', domain: 'WORKFORCE', name: 'Assign operational workforce role', description: 'Grant one of the six ADMINISTRATOR-delegable operational roles (OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY) to a workforce principal. Never SUPER_ADMIN or any FINANCE_* role — enforced by a database CHECK constraint, not merely by this grant.', sensitivity: PRIVILEGED, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'workforce.role.revoke_operational', domain: 'WORKFORCE', name: 'Revoke operational workforce role', description: 'Revoke one of the six ADMINISTRATOR-delegable operational roles from a workforce principal. Never SUPER_ADMIN or any FINANCE_* role — enforced by a database CHECK constraint, not merely by this grant.', sensitivity: PRIVILEGED, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'workforce.user.view', domain: 'WORKFORCE', name: 'View workforce user', description: 'View a workforce user/identity record.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'workforce.user.create', domain: 'WORKFORCE', name: 'Create workforce user', description: 'Provision a new workforce user identity.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'workforce.user.suspend', domain: 'WORKFORCE', name: 'Suspend workforce user', description: 'Suspend/disable a workforce user identity.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },

  // ----------------------------------------------------------------- COMPLIANCE
  { functionCode: 'kyc.view', domain: 'COMPLIANCE', name: 'View KYC assessment', description: 'View a customer KYC assessment.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'kyc.review', domain: 'COMPLIANCE', name: 'Review KYC assessment', description: 'Record a KYC review decision.', sensitivity: OPERATIONAL, v1Status: PARTIALLY_IMPLEMENTED, assignable: true, notes: 'Decision 5: distinct function from approve/reject; no second reviewer in V1.' },
  { functionCode: 'kyc.approve', domain: 'COMPLIANCE', name: 'Approve KYC assessment', description: 'Approve a customer KYC assessment.', sensitivity: OPERATIONAL, v1Status: PARTIALLY_IMPLEMENTED, assignable: true, notes: 'Decision 5.' },
  { functionCode: 'kyc.reject', domain: 'COMPLIANCE', name: 'Reject KYC assessment', description: 'Reject a customer KYC assessment.', sensitivity: OPERATIONAL, v1Status: PARTIALLY_IMPLEMENTED, assignable: true, notes: 'Decision 5.' },
  { functionCode: 'compliance.manage_case', domain: 'COMPLIANCE', name: 'Manage compliance case', description: 'Create/update/comment/close a non-FRAUD compliance case (AML/KYC/SANCTIONS categories).', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'compliance.manage_risk_profile', domain: 'COMPLIANCE', name: 'Manage customer risk profile', description: 'Administer a customer risk profile/score.', sensitivity: OPERATIONAL, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'compliance.restrict_account', domain: 'COMPLIANCE', name: 'Restrict account', description: 'Future dedicated account restriction action.', sensitivity: SENSITIVE, v1Status: FUTURE, assignable: false },
  { functionCode: 'compliance.release_restriction', domain: 'COMPLIANCE', name: 'Release account restriction', description: 'Future dedicated account restriction release action.', sensitivity: SENSITIVE, v1Status: FUTURE, assignable: false },

  // ----------------------------------------------------------------- RISK/FRAUD
  { functionCode: 'risk_fraud.manage_fraud_case', domain: 'RISK_FRAUD', name: 'Manage fraud case', description: 'Create/update/comment/close a FRAUD-category compliance case only.', sensitivity: OPERATIONAL, v1Status: PARTIALLY_IMPLEMENTED, assignable: true, notes: 'Decisions 8/9: FRAUD-category case authority only; no AML/SANCTIONS authority.' },

  // ---------------------------------------------------------------------- AUDIT
  { functionCode: 'audit.view', domain: 'AUDIT', name: 'View audit record', description: 'View an individual audit/security-event record.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'audit.search', domain: 'AUDIT', name: 'Search audit records', description: 'Search/filter audit and security-event records.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'audit.export', domain: 'AUDIT', name: 'Export audit records', description: 'Bulk-export audit/security-event records.', sensitivity: READ, v1Status: FUTURE, assignable: false },

  // ----------------------------------------------------------- RECONCILIATION
  { functionCode: 'reconciliation.view', domain: 'RECONCILIATION', name: 'View reconciliation status', description: 'View reconciliation run status/exceptions.', sensitivity: READ, v1Status: BACKEND_ONLY, assignable: true, notes: 'Decision 6: TREASURY role holds exactly this one function and nothing else.' },
  { functionCode: 'reconciliation.investigate', domain: 'RECONCILIATION', name: 'Investigate reconciliation exception', description: 'Future reconciliation-exception investigation workflow.', sensitivity: OPERATIONAL, v1Status: FUTURE, assignable: false },
  { functionCode: 'reconciliation.resolve', domain: 'RECONCILIATION', name: 'Resolve reconciliation exception', description: 'Future reconciliation-exception resolution workflow.', sensitivity: SENSITIVE, v1Status: FUTURE, assignable: false },

  // ----------------------------------------------------------------- TREASURY
  { functionCode: 'treasury.manage_settlement', domain: 'TREASURY', name: 'Manage settlement', description: 'External bank/NIBSS settlement functionality (not built).', sensitivity: SENSITIVE, v1Status: OUT_OF_V1_SCOPE, assignable: false },
  { functionCode: 'treasury.resolve_suspense', domain: 'TREASURY', name: 'Resolve suspense', description: 'External suspense-account resolution functionality (not built).', sensitivity: SENSITIVE, v1Status: OUT_OF_V1_SCOPE, assignable: false },

  // --------------------------------------------------------------- OPERATIONS
  { functionCode: 'outbox.view', domain: 'OPERATIONS', name: 'View outbox', description: 'View the transactional outbox/event delivery queue.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'metrics.view', domain: 'OPERATIONS', name: 'View metrics', description: 'View operational metrics.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'diagnostics.view', domain: 'OPERATIONS', name: 'View diagnostics', description: 'View operational diagnostics endpoints.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
  { functionCode: 'notification.view_deliveries', domain: 'OPERATIONS', name: 'View notification deliveries', description: 'View notification delivery records.', sensitivity: READ, v1Status: IMPLEMENTED, assignable: true },
];

export const AUTHORIZATION_ROLE_SEED: AuthorizationRoleSeed[] = [
  {
    roleKey: 'SUPER_ADMIN',
    displayName: 'Super Admin',
    description:
      'Broad administrative, governance and visibility authority. Replaces FINANCE_ADMIN as the single reserved administrative role. Does not directly execute or approve CRITICAL_FINANCIAL functions, does not hold Finance maker/checker approval authority, and cannot self-escalate.',
    administrativeCapability: true,
  },
  {
    roleKey: 'FINANCE_PREPARER',
    displayName: 'Finance Preparer',
    description: 'Maker role for Finance-governed functions (ledger postings, commercial-rule changes). Never holds checker/approval authority for the same governed action.',
    financeRoleClass: true,
    makerEligible: true,
  },
  {
    roleKey: 'FINANCE_CONTROLLER',
    displayName: 'Finance Controller',
    description: 'Checker role for Finance-governed functions. Never holds maker/initiation authority for the same governed action.',
    financeRoleClass: true,
    checkerEligible: true,
  },
  {
    roleKey: 'FINANCE_AUDITOR',
    displayName: 'Finance Auditor',
    description: 'Read/audit-only Finance role. Holds zero mutation functions by design, enforced generically by the read_only flag.',
    financeRoleClass: true,
    readOnly: true,
  },
  {
    roleKey: 'OPERATIONS',
    displayName: 'Operations',
    description: 'Operational administration (customer/aggregator/support-workforce administration, observability). No financial mutation authority, no agent-network lifecycle ownership.',
  },
  {
    roleKey: 'AGENT_NETWORK_MANAGER',
    displayName: 'Agent Network Manager',
    description: 'Owns agent network lifecycle and agent fund/defund initiation (maker side only; FINANCE_CONTROLLER approves per Decision 7).',
    makerEligible: true,
  },
  {
    roleKey: 'COMPLIANCE',
    displayName: 'Compliance',
    description: 'KYC and non-FRAUD compliance case/risk-profile administration.',
  },
  {
    roleKey: 'RISK_FRAUD',
    displayName: 'Risk & Fraud',
    description: 'FRAUD-category compliance case authority only. No AML/SANCTIONS case authority.',
  },
  {
    roleKey: 'CUSTOMER_SERVICE',
    displayName: 'Customer Service',
    description: 'Customer viewing/history/support-case authority. No customer lifecycle mutation, no financial mutation.',
  },
  {
    roleKey: 'TREASURY',
    displayName: 'Treasury',
    description: 'Decision 6: holds exactly reconciliation.view and nothing else in V1. No external settlement/suspense functionality exists yet.',
  },
  {
    roleKey: 'ADMINISTRATOR',
    displayName: 'Administrator',
    description:
      'Delegated day-to-day workforce administration, not a second SUPER_ADMIN. May assign/revoke exactly the six operational roles (OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY); never SUPER_ADMIN or any FINANCE_* role, DB-enforced. No workforce.role.create/modify, no ledger/finance/KYC/compliance decision authority.',
  },
];

const nowAssign = (roleKey: string, functionCode: string, accessType: RoleFunctionAccessType): AuthorizationRoleFunctionSeed => ({
  roleKey,
  functionCode,
  accessType,
});

const { VIEW, EXECUTE, INITIATE, APPROVE } = RoleFunctionAccessType;

export const AUTHORIZATION_ROLE_FUNCTION_SEED: AuthorizationRoleFunctionSeed[] = [
  // ------------------------------------------------------------- SUPER_ADMIN
  nowAssign('SUPER_ADMIN', 'workforce.role.assign', INITIATE),
  nowAssign('SUPER_ADMIN', 'workforce.role.revoke', INITIATE),
  nowAssign('SUPER_ADMIN', 'workforce.role.view', VIEW),
  // V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01: SUPER_ADMIN may INITIATE a role
  // definition proposal (create a new role, or modify a role previously created through this
  // same workflow) but never approve its own proposal — FINANCE_CONTROLLER is the sole
  // independent approver, mirroring workforce.role.assign/.revoke immediately above.
  nowAssign('SUPER_ADMIN', 'workforce.role.create', INITIATE),
  nowAssign('SUPER_ADMIN', 'workforce.role.modify', INITIATE),
  // Decision 2: SUPER_ADMIN "retains unrestricted use of all role-assignment actions, including
  // this new one" — it is a strict superset of ADMINISTRATOR's capability, not a narrower path.
  nowAssign('SUPER_ADMIN', 'workforce.role.assign_operational', EXECUTE),
  nowAssign('SUPER_ADMIN', 'workforce.role.revoke_operational', EXECUTE),
  nowAssign('SUPER_ADMIN', 'customer.view', VIEW),
  nowAssign('SUPER_ADMIN', 'customer.create', EXECUTE),
  nowAssign('SUPER_ADMIN', 'customer.suspend', EXECUTE),
  nowAssign('SUPER_ADMIN', 'customer.activate', EXECUTE),
  nowAssign('SUPER_ADMIN', 'customer.close', EXECUTE),
  nowAssign('SUPER_ADMIN', 'customer.view_transactions', VIEW),
  nowAssign('SUPER_ADMIN', 'customer.view_wallets', VIEW),
  nowAssign('SUPER_ADMIN', 'customer.create_wallet', EXECUTE),
  nowAssign('SUPER_ADMIN', 'customer.manage_support_case', EXECUTE),
  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01
  nowAssign('SUPER_ADMIN', 'customer.view_address', VIEW),
  nowAssign('SUPER_ADMIN', 'customer.view_contact_methods', VIEW),
  nowAssign('SUPER_ADMIN', 'customer.view_identity_documents', VIEW),
  nowAssign('SUPER_ADMIN', 'agent.view', VIEW),
  nowAssign('SUPER_ADMIN', 'agent.review_application', EXECUTE),
  nowAssign('SUPER_ADMIN', 'agent.activate', EXECUTE),
  nowAssign('SUPER_ADMIN', 'agent.suspend', EXECUTE),
  nowAssign('SUPER_ADMIN', 'agent.terminate', EXECUTE),
  nowAssign('SUPER_ADMIN', 'agent.reactivate', EXECUTE),
  nowAssign('SUPER_ADMIN', 'agent.manage_credentials', EXECUTE),
  nowAssign('SUPER_ADMIN', 'agent.manage_outlets_terminals', EXECUTE),
  nowAssign('SUPER_ADMIN', 'agent.assign_limit', EXECUTE),
  nowAssign('SUPER_ADMIN', 'aggregator.view', VIEW),
  nowAssign('SUPER_ADMIN', 'aggregator.manage', EXECUTE),
  nowAssign('SUPER_ADMIN', 'workforce.user.view', VIEW),
  nowAssign('SUPER_ADMIN', 'workforce.user.create', EXECUTE),
  nowAssign('SUPER_ADMIN', 'workforce.user.suspend', EXECUTE),
  nowAssign('SUPER_ADMIN', 'kyc.view', VIEW),
  nowAssign('SUPER_ADMIN', 'kyc.review', EXECUTE),
  nowAssign('SUPER_ADMIN', 'kyc.approve', EXECUTE),
  nowAssign('SUPER_ADMIN', 'kyc.reject', EXECUTE),
  nowAssign('SUPER_ADMIN', 'compliance.manage_case', EXECUTE),
  nowAssign('SUPER_ADMIN', 'compliance.manage_risk_profile', EXECUTE),
  nowAssign('SUPER_ADMIN', 'audit.view', VIEW),
  nowAssign('SUPER_ADMIN', 'audit.search', VIEW),
  nowAssign('SUPER_ADMIN', 'outbox.view', VIEW),
  nowAssign('SUPER_ADMIN', 'metrics.view', VIEW),
  nowAssign('SUPER_ADMIN', 'diagnostics.view', VIEW),
  nowAssign('SUPER_ADMIN', 'notification.view_deliveries', VIEW),
  nowAssign('SUPER_ADMIN', 'ledger.view', VIEW),
  nowAssign('SUPER_ADMIN', 'reconciliation.view', VIEW),
  nowAssign('SUPER_ADMIN', 'transaction.view', VIEW),
  nowAssign('SUPER_ADMIN', 'fee_rule.view', VIEW),
  nowAssign('SUPER_ADMIN', 'commission_rule.view', VIEW),
  nowAssign('SUPER_ADMIN', 'reward_rule.view', VIEW),
  nowAssign('SUPER_ADMIN', 'product.view', VIEW),
  nowAssign('SUPER_ADMIN', 'limit.view', VIEW),
  // NOTE: SUPER_ADMIN deliberately does NOT hold ledger.post/reverse/approve_adjustment,
  // fee_rule/commission_rule/reward_rule/product/limit create-or-modify, finance.control_policy.activate,
  // agent.fund/defund, or risk_fraud.manage_fraud_case. This is intentional, per the approved
  // boundary ("no direct critical financial execution, no maker/checker approval, no self-escalation").

  // ----------------------------------------------------------- FINANCE_PREPARER
  nowAssign('FINANCE_PREPARER', 'ledger.post', INITIATE),
  nowAssign('FINANCE_PREPARER', 'ledger.reverse', INITIATE),
  nowAssign('FINANCE_PREPARER', 'ledger.view', VIEW),
  nowAssign('FINANCE_PREPARER', 'fee_rule.create', INITIATE),
  nowAssign('FINANCE_PREPARER', 'fee_rule.modify', INITIATE),
  nowAssign('FINANCE_PREPARER', 'fee_rule.view', VIEW),
  nowAssign('FINANCE_PREPARER', 'commission_rule.create', INITIATE),
  nowAssign('FINANCE_PREPARER', 'commission_rule.modify', INITIATE),
  nowAssign('FINANCE_PREPARER', 'commission_rule.view', VIEW),
  nowAssign('FINANCE_PREPARER', 'reward_rule.create', INITIATE),
  nowAssign('FINANCE_PREPARER', 'reward_rule.modify', INITIATE),
  nowAssign('FINANCE_PREPARER', 'reward_rule.view', VIEW),
  nowAssign('FINANCE_PREPARER', 'product.modify', INITIATE),
  nowAssign('FINANCE_PREPARER', 'product.governance', INITIATE),
  nowAssign('FINANCE_PREPARER', 'product.view', VIEW),
  nowAssign('FINANCE_PREPARER', 'limit.modify', INITIATE),
  nowAssign('FINANCE_PREPARER', 'limit.view', VIEW),
  nowAssign('FINANCE_PREPARER', 'finance.control_policy.activate', INITIATE),

  // ---------------------------------------------------------- FINANCE_CONTROLLER
  nowAssign('FINANCE_CONTROLLER', 'ledger.view', VIEW),
  nowAssign('FINANCE_CONTROLLER', 'fee_rule.view', VIEW),
  nowAssign('FINANCE_CONTROLLER', 'commission_rule.view', VIEW),
  nowAssign('FINANCE_CONTROLLER', 'reward_rule.view', VIEW),
  nowAssign('FINANCE_CONTROLLER', 'product.view', VIEW),
  nowAssign('FINANCE_CONTROLLER', 'limit.view', VIEW),
  nowAssign('FINANCE_CONTROLLER', 'fee_rule.create', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'fee_rule.modify', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'commission_rule.create', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'commission_rule.modify', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'reward_rule.create', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'reward_rule.modify', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'product.modify', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'product.governance', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'limit.modify', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'finance.control_policy.activate', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'workforce.role.assign', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'workforce.role.revoke', APPROVE),
  // V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01: sole independent approver of a
  // SUPER_ADMIN-initiated role definition proposal; also needs VIEW to review proposal content
  // before deciding, mirroring the view+approve pairing used throughout this role's other grants.
  nowAssign('FINANCE_CONTROLLER', 'workforce.role.create', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'workforce.role.modify', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'workforce.role.view', VIEW),
  nowAssign('FINANCE_CONTROLLER', 'agent.fund', APPROVE),
  nowAssign('FINANCE_CONTROLLER', 'agent.defund', APPROVE),
  // NOTE: FINANCE_CONTROLLER deliberately does NOT hold ledger.post/reverse (maker-only
  // functions) nor ledger.approve_adjustment (not assignable yet — see module header notes).

  // ------------------------------------------------------------- FINANCE_AUDITOR
  // All rows below are VIEW access to READ-sensitivity functions only — this role
  // is flagged read_only = true, and a DB trigger rejects any non-READ assignment.
  nowAssign('FINANCE_AUDITOR', 'customer.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'customer.view_transactions', VIEW),
  nowAssign('FINANCE_AUDITOR', 'customer.view_wallets', VIEW),
  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01: FINANCE_AUDITOR holds
  // customer.view_address/.view_contact_methods (both READ-sensitivity, consistent with this
  // read_only role) but deliberately does NOT hold customer.view_identity_documents — the
  // approved decision narrows identity-document access to SUPER_ADMIN/COMPLIANCE only.
  nowAssign('FINANCE_AUDITOR', 'customer.view_address', VIEW),
  nowAssign('FINANCE_AUDITOR', 'customer.view_contact_methods', VIEW),
  nowAssign('FINANCE_AUDITOR', 'agent.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'aggregator.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'transaction.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'ledger.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'fee_rule.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'commission_rule.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'reward_rule.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'product.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'limit.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'workforce.role.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'kyc.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'audit.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'audit.search', VIEW),
  nowAssign('FINANCE_AUDITOR', 'outbox.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'metrics.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'diagnostics.view', VIEW),
  nowAssign('FINANCE_AUDITOR', 'notification.view_deliveries', VIEW),
  nowAssign('FINANCE_AUDITOR', 'reconciliation.view', VIEW),

  // ------------------------------------------------------------------ OPERATIONS
  nowAssign('OPERATIONS', 'customer.view', VIEW),
  nowAssign('OPERATIONS', 'customer.create', EXECUTE),
  nowAssign('OPERATIONS', 'customer.suspend', EXECUTE),
  nowAssign('OPERATIONS', 'customer.activate', EXECUTE),
  nowAssign('OPERATIONS', 'customer.close', EXECUTE),
  nowAssign('OPERATIONS', 'customer.view_transactions', VIEW),
  nowAssign('OPERATIONS', 'customer.manage_support_case', EXECUTE),
  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01
  nowAssign('OPERATIONS', 'customer.view_address', VIEW),
  nowAssign('OPERATIONS', 'customer.view_contact_methods', VIEW),
  nowAssign('OPERATIONS', 'aggregator.view', VIEW),
  nowAssign('OPERATIONS', 'aggregator.manage', EXECUTE),
  nowAssign('OPERATIONS', 'workforce.user.view', VIEW),
  nowAssign('OPERATIONS', 'workforce.user.create', EXECUTE),
  nowAssign('OPERATIONS', 'workforce.user.suspend', EXECUTE),
  nowAssign('OPERATIONS', 'outbox.view', VIEW),
  nowAssign('OPERATIONS', 'metrics.view', VIEW),
  nowAssign('OPERATIONS', 'diagnostics.view', VIEW),
  nowAssign('OPERATIONS', 'notification.view_deliveries', VIEW),
  nowAssign('OPERATIONS', 'transaction.view', VIEW),

  // ------------------------------------------------------- AGENT_NETWORK_MANAGER
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.view', VIEW),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.review_application', EXECUTE),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.activate', EXECUTE),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.suspend', EXECUTE),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.terminate', EXECUTE),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.reactivate', EXECUTE),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.manage_credentials', EXECUTE),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.manage_outlets_terminals', EXECUTE),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.assign_limit', EXECUTE),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.fund', INITIATE),
  nowAssign('AGENT_NETWORK_MANAGER', 'agent.defund', INITIATE),
  nowAssign('AGENT_NETWORK_MANAGER', 'limit.view', VIEW),

  // ------------------------------------------------------------------- COMPLIANCE
  nowAssign('COMPLIANCE', 'kyc.view', VIEW),
  nowAssign('COMPLIANCE', 'kyc.review', EXECUTE),
  nowAssign('COMPLIANCE', 'kyc.approve', EXECUTE),
  nowAssign('COMPLIANCE', 'kyc.reject', EXECUTE),
  nowAssign('COMPLIANCE', 'compliance.manage_case', EXECUTE),
  nowAssign('COMPLIANCE', 'compliance.manage_risk_profile', EXECUTE),
  nowAssign('COMPLIANCE', 'customer.view', VIEW),
  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01: COMPLIANCE is one of exactly two
  // roles (with SUPER_ADMIN) holding customer.view_identity_documents, per the approved
  // decision's narrower identity-document matrix.
  nowAssign('COMPLIANCE', 'customer.view_address', VIEW),
  nowAssign('COMPLIANCE', 'customer.view_contact_methods', VIEW),
  nowAssign('COMPLIANCE', 'customer.view_identity_documents', VIEW),

  // ------------------------------------------------------------------- RISK_FRAUD
  nowAssign('RISK_FRAUD', 'risk_fraud.manage_fraud_case', EXECUTE),

  // --------------------------------------------------------------- CUSTOMER_SERVICE
  nowAssign('CUSTOMER_SERVICE', 'customer.view', VIEW),
  nowAssign('CUSTOMER_SERVICE', 'customer.view_wallets', VIEW),
  nowAssign('CUSTOMER_SERVICE', 'customer.view_transactions', VIEW),
  nowAssign('CUSTOMER_SERVICE', 'customer.manage_support_case', EXECUTE),
  // V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01
  nowAssign('CUSTOMER_SERVICE', 'customer.view_address', VIEW),
  nowAssign('CUSTOMER_SERVICE', 'customer.view_contact_methods', VIEW),

  // ----------------------------------------------------------------------- TREASURY
  nowAssign('TREASURY', 'reconciliation.view', VIEW),

  // ---------------------------------------------------------------- ADMINISTRATOR
  // GOVERNANCE-01 §2.2/§3: every function below already exists in the catalogue (except the two
  // dedicated operational-scope role-assignment functions added alongside this role — see the
  // WORKFORCE section above); no function is invented purely to pass a test. Explicitly excluded,
  // by design: workforce.role.create/.modify, workforce.role.assign/.revoke (SUPER_ADMIN/FINANCE
  // scope — unscoped), every ledger.*/agent.fund/.defund APPROVE/finance.control_policy.activate,
  // kyc.approve/.reject, compliance.manage_case/.manage_risk_profile, risk_fraud.manage_fraud_case.
  nowAssign('ADMINISTRATOR', 'workforce.user.view', VIEW),
  nowAssign('ADMINISTRATOR', 'workforce.user.create', EXECUTE),
  nowAssign('ADMINISTRATOR', 'workforce.user.suspend', EXECUTE),
  nowAssign('ADMINISTRATOR', 'workforce.role.view', VIEW),
  nowAssign('ADMINISTRATOR', 'workforce.role.assign_operational', EXECUTE),
  nowAssign('ADMINISTRATOR', 'workforce.role.revoke_operational', EXECUTE),
  nowAssign('ADMINISTRATOR', 'customer.view', VIEW),
  nowAssign('ADMINISTRATOR', 'agent.view', VIEW),
  nowAssign('ADMINISTRATOR', 'aggregator.view', VIEW),
];
