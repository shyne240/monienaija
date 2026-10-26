# MonieNaija V1 — End-to-End Functionality Audit

- **Type:** AUDIT ONLY. No application code, schema, migration, permission, navigation, or environment configuration was changed. This report is not staged, committed, or pushed.
- **Branch / commit audited:** `arena/edba26d6-monienaija` @ `2ccc17b04351c6669872a43e0a2b110086bb1d5a` (verified this session with `git rev-parse HEAD`).
- **Date:** 2026-10-21 (Africa/Lagos).
- **Scope of inspection:** all V1 requirement/scope documents (`docs/V1/`, 83 documents), backend (`src/`, 80+ controllers, 150 entities, 90 migrations), Admin Web (`apps/admin-web`, 7 sections / 26 submenus / 17 screens / 11 roles), Customer Mobile (`apps/customer-mobile`, 12 screens), Agent Mobile (`apps/agent-mobile`, 27 screens), authorization catalogue (`src/authorization-catalogue/authorization-catalogue.seed.ts`: 85 functions, 11 roles, 186 assignments), route policy (`src/authorization/route-policy-registry.ts`), and the full test tree (174 unit suites + 105 integration suites).

---

## Evidence conventions (read before the matrix)

Evidence tags used in the **Tests** column and elsewhere:

| Tag | Meaning |
|---|---|
| **V-NOW** | Verified in **this audit session** (command and result in §D). |
| **MOCK** | Passes only as a mocked/unit test (no real DB/HTTP). |
| **CODE** | Code inspection only — no test demonstrates it. |
| **PRIOR** | A previous test report claims a real-DB/real-HTTP pass at a named commit; **not re-run in this audit**. Treated as supporting evidence, never as proof. |
| **BLOCKED** | Testing attempted this session and blocked by environment (PostgreSQL unreachable). |

**Status convention (applied strictly per the six required definitions):**

- PostgreSQL is unavailable in this sandbox (§D). Therefore **no backend/database feature could be re-demonstrated during this audit**, and per the rule *"Do not classify functionality as WORKING solely because a screen exists, code has been written, a build passes, or a mocked test succeeds"* and *"Do not claim database-backed tests passed based solely on previous reports"*, rows whose only end-to-end demonstration is a previous test report are classified **BLOCKED FROM VERIFICATION** — with the prior evidence recorded so a single verification run (P0-1) can promote them.
- Where code inspection finds a **missing or incorrect required step**, the row is classified by that defect (**PARTIALLY WORKING / UI ONLY / NOT IMPLEMENTED**) regardless of the environment blocker — an environment problem is never used to disguise a code defect.
- **UI ONLY** means the underlying business operation is missing or incorrectly wired in code (not merely "unverified"). **BLOCKED FROM VERIFICATION** means the operation appears complete in code but could not be tested.
- **WORKING** is reserved for features demonstrated end-to-end including real DB operations during this audit. **No row achieves WORKING in this session** — that is a property of the audit environment, and §D states the minimum safe verification to change it.
- **OUT OF V1 SCOPE** rows are backed by explicit scope documentation and are not counted as defects.

**Disambiguation note:** the six statuses overlap at the edges ("UI ONLY … has not been demonstrated" vs "BLOCKED FROM VERIFICATION"). This audit uses: missing/incorrect wiring → UI ONLY / PARTIALLY WORKING; complete-but-untestable-here → BLOCKED FROM VERIFICATION. This is stated once here and applied consistently.

---

## A. Executive summary

### A.1 Overall state of V1

MonieNaija V1 is a **largely code-complete, well-structured product with strong test volume that has never been re-proven end-to-end in the current environment**, plus **two real control defects found by this audit** and a handful of known UI gaps. After six months of work the repository contains: 90 migrations, 150 entities, 80+ controllers, an 85-function authorization catalogue with 11 roles, a 7-section/26-submenu Admin Web driven by catalogue functions, Customer and Agent mobile apps with PIN-secured money movement, 174 unit suites (1,831 tests) and 105 PostgreSQL integration suites. Builds pass for all three apps' code paths audited (admin web + backend). The product is close, but it is **not currently provable as usable** and it contains at least one financial-control gap that must be closed before real money is involved.

### A.2 What can demonstrably be used today (verified in this audit)

Verified **now** (V-NOW, exact results in §D):

1. Backend compiles cleanly (`nest build`, exit 0). Admin Web builds (305.73 kB, exit 0).
2. All mocked Admin Web tests pass: **9 suites / 65 tests** (includes the 24-test 11-role menu-visibility suite and 7-test Customer-360 suite).
3. All backend unit tests pass: **174 suites / 1,831 tests** (includes authorization, commercial engine, ledger service logic — mocked/DB-less).
4. The 7-section / 26-submenu navigation and its 11-role least-privilege gating are correct against the live catalogue scopes (rendered-DOM tests).
5. All 17 Admin Web screens call the real API client (no mock-data screens); the single hardcoded-mock artifact found is isolated (Ledger preparer path — see §E).

Everything financial (login → session → money movement → ledger → reconciliation) is **code-complete and supported by prior real-DB test claims**, but **not re-demonstrable here** (PostgreSQL blocker). Per the classification rules those rows are BLOCKED FROM VERIFICATION, not WORKING.

### A.3 What prevents the application from being considered a usable V1

1. **No live verification of anything touching the database** — the entire evidence base for money movement, auth, and persistence is prior reports. Until `npm run test:pg` (105 suites) runs green on an isolated DB, V1 cannot honestly be declared usable. *(Environmental — first thing to fix.)*
2. **Commercial rule maker-checker is declared but NOT enforced** (§E-1). The catalogue marks `fee_rule.create/modify`, `commission_rule.*`, `reward_rule.*`, `product.modify/governance` as `makerCheckerRequired: true, approvalRequired: true` with FINANCE_PREPARER=INITIATE / FINANCE_CONTROLLER=APPROVE, but the runtime ignores access type and the registry services write directly. A single FINANCE_PREPARER can change live fee/commission rules unilaterally. *(Code defect — found by this audit; contradicts `REMAINING-DEFECTS-PRIORITIZED.md` R10's claim that maker/checker exists.)*
3. **The ledger-reversal maker-request path in the UI is placeholder** (§E-2): hardcoded mock `actionFingerprint`, and the request uses the wrong action/resource types (role-approval types instead of journal-reversal types), so preparer-initiated reversal approval cannot work as intended.
4. **Commercial governance has no operator UI** — the Commercial Rules screens are read-only; combined with (2), the approved "preparer proposes / controller approves" workflow is not deliverable today from either UI or a governed API path.
5. **Open product decisions never ratified** (aggregator login §23-9, reconciliation-break resolver §25-1, reward accounting §25-2, ops-reversal workflow V1-017, platform/aggregator commission D-C-009/010) — these are explicitly **not** silent defects (V1-SCOPE-CHALLENGE-01), but they leave scope ambiguity that must be closed in writing.

### A.4 Most important remaining gaps (by consequence)

| # | Gap | Consequence |
|---|---|---|
| 1 | DB-backed verification unavailable / never re-run at HEAD | No honest WORKING classification for any financial flow |
| 2 | Commercial maker-checker not enforced at runtime | Separation of duties on fee/commission rules fails open |
| 3 | Ledger reversal preparer path mis-wired (mock fingerprint, wrong action types) | The maker half of the only privileged financial workflow is non-functional |
| 4 | Commercial propose/approve UI absent (R10) | Even after (2) is fixed, controllers cannot perform the governed flow from the portal |
| 5 | Customer 360 PII tabs absent (R8); Compliance/Risk deep-linking absent (R9) | Servicing workflows require direct API calls / manual UUID entry |

### A.5 Major risks and unresolved requirements

- **Evidence risk:** six months of accumulated "PASS" claims rest on test reports; this audit could re-verify only mocked/unit layers. Any claim stronger than that is an assumption until P0-1 runs.
- **Financial-control risk:** item (2) above is the only finding that can directly move money wrongly through a governance bypass; treat it as the top engineering priority.
- **Requirement conflicts flagged (not silently resolved):** see §E.7 — ten-vs-eleven roles (spec header vs catalogue), R10 maker-checker claim vs code, stale "agent unified history missing" claim in V1-SCOPE-CHALLENGE-01 (now implemented), IA label drift (6 labels), legacy 5-role workforce config vs 11 organizational roles.
- **Documented-but-unresolved wallet-route items** (kept unchanged per standing instruction): wallet PATCH status/alias, SUPPORT read-scope, cash-out binding, C2C transfer, `internal:access` ownership — see §E.6.

---

## B. Full feature matrix

### B.0 Requirement source index

| Short name | Document |
|---|---|
| SPEC-01 | `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` (roles/functions; note: header says "ten" roles — catalogue implements 11) |
| DEC-01 | `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md` |
| IA-26 | `docs/V1/ADMIN-INFORMATION-ARCHITECTURE-PROPOSAL.md` §3.2 (7×26 IA) |
| SCOPE-CH | `docs/V1/V1-SCOPE-CHALLENGE-01.md` (deferred-feature classifications) |
| PROD-COMP | `docs/V1/V1-PRODUCT-COMPLETION-AUDIT.md` |
| MATRIX | `docs/V1/FULL-ADMIN-WEB-COMPLETION-MATRIX.md` |
| A21 | `docs/V1/A21-AGENT-APP-CONTRACT.md` |
| A23 | `docs/V1/A23-CUSTOMER-APP-CONTRACT.md` |
| CAT | `src/authorization-catalogue/authorization-catalogue.seed.ts` (source of truth per SPEC-01 §6–7) |
| DP-08/25 | `docs/V1/V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01.md` / `V1-COMMERCIAL-POLICY-DECISION-PACK.md` |
| AG-GOV | `docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01.md` + `...-DECISIONS-01.md` |
| P1H | `docs/V1/REMAINING-DEFECTS-PRIORITIZED.md` (P1 hardening record) |

### B.1 Platform, authentication, session

| Requirement / Feature | Source | Role(s) | Frontend | Backend | Database | Tests | Overall status | Gap | Next action |
|---|---|---|---|---|---|---|---|---|---|
| Workforce local login (email/password) | SPEC-01, `V1-ADMIN-LOCAL-LOGIN-01` | All 11 | Login screen loads, posts to API (**CODE**) | `local-admin-authentication.controller` + workforce session service (**CODE**) | `workforce_*` session entities + migrations present (**CODE**) | 174 unit suites include auth logic (MOCK); `v1-admin-local-login-01.integration.spec.ts` exists (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Cannot demonstrate login → token → session on real DB here | Run `npm run test:pg -- v1-admin-local-login` on isolated PG |
| Session issuance / scope resolution (legacy + catalogue union) | SPEC-01 §3, AG-GOV | All 11 | N/A (apiClient attaches bearer) | `workforce-session.service` resolves roles→functionCodes union (**CODE**, explicit design comment) | `authorization_roles` / `authorization_role_functions` (90 migrations incl. `CreateAuthorizationCatalogue`) | `a2-workforce-session.integration.spec.ts` exists (**BLOCKED**); menu suite proves scope semantics (MOCK/V-NOW) | **BLOCKED FROM VERIFICATION** | Real session end-to-end not demonstrated here | P0-1 full integration run |
| Logout / session revoke | SPEC-01 | All 11 | Logout control in Layout (**CODE**) | revoke path in session service (**CODE**) | token hash rows (**CODE**) | covered inside integration suites (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Same | P0-1 |
| MFA / privileged action assurance (PRIVILEGED + MFA gate) | SPEC-01 §19 | SUPER_ADMIN, FINANCE_CONTROLLER | ApprovalsScreen (**CODE**) | `privileged-action-approval.service` lines 251–252 require `type==='PRIVILEGED' && assuranceLevel==='MFA'` (**CODE**) | approval entity + migrations | unit/integration coverage (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Gate exists in code but unproven live | P0-1 (approve/reject integration tests exist) |
| Super-admin recovery | SPEC-01, `V1-SECURITY-SUPER-ADMIN-RECOVERY-01` | SUPER_ADMIN | SuperAdminRecoveryScreen (real ApiClient) (**CODE**) | `super-admin-recovery.controller/service` (**CODE**) | entities present (**CODE**) | prior report claims complete (**PRIOR**) | **BLOCKED FROM VERIFICATION** | Not re-demonstrable | P0-1 |

### B.2 Admin Web — all 26 submenus (screens verified this session)

Screen↔submenu mapping (verified in `Layout.tsx` this session): §1 Home (2): dashboard, dashboardSettings. §2 Customer & Agent Servicing (3): customers, agents, support. §3 Money Movement (4): transfers, cashIn, cashOut, cashToCash — four submenus over `TransactionObservabilityScreen` filters. §4 Finance & Ledger (2): ledgerExplorer, reconciliation. §5 Commercial & Risk Controls (6): feeRules, commissionRules, rewardRules, productCatalogue, limitCatalogue, limitAssignments (first five = tabs of `CommercialRulesScreen`). §6 Compliance & Risk (3): kycQueue, complianceCases, fraudCases (`ComplianceScreen`, `RiskFraudScreen`). §7 Platform Administration (6): workforceAccess, roleGovernance, approvalsInbox, superAdminRecovery, systemHealth, auditEvents. **Total 26 = 17 screen components.** Per-role visible counts (26/13/15/19/7/9/4/4/2/3/2) proven by `menu-visibility-11-roles.test.tsx` 24/24 (V-NOW).

| Requirement / Feature | Source | Role(s) | Frontend | Backend | Database | Tests | Overall status | Gap | Next action |
|---|---|---|---|---|---|---|---|---|---|
| 1.1 Operational Dashboard (per-role templates + widgets) | SPEC-01 `reporting.*`,`metrics.view`; `V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01` | All 11 | DashboardScreen renders resolved template; loading/error/empty handled (**CODE**) | `GET /dashboard/my-dashboard` + widget proxies; per-widget `requireFunction` (**CODE**) | template/assignment tables + seeds | 47 dashboard integration tests claimed (**PRIOR**); widget data service unit-tested (MOCK) | **BLOCKED FROM VERIFICATION** | Live widget data not demonstrated here | P0-1 |
| 1.2 Dashboard Settings (template↔role assignment) | SPEC-01 `workforce.dashboard.view/.assign` | SUPER_ADMIN, ADMINISTRATOR | DashboardSettingsScreen list/assign/error states (**CODE**) | `PUT /assignments/:roleKey` audited (**CODE**) | assignment rows persisted | hardening test 5d claimed (**PRIOR**) | **BLOCKED FROM VERIFICATION** | Same | P0-1 |
| 2.1 Customer & KYC Servicing (list/search/create/lifecycle/wallets/KYC/transactions/tickets) | SPEC-01 `customer.*`, `kyc.*`; A23; `V1-ADMIN-CUSTOMER-PII` | CUSTOMER_SERVICE, OPERATIONS, COMPLIANCE, ADMINISTRATOR(read), SUPER_ADMIN | CustomerDirectoryScreen 763 lines: filters, create, detail drawer (wallets/KYC/status) — real API (**CODE**) | `AdminCustomerController` + `requireFunction` per endpoint; SUPPORT excluded from lifecycle per UAT-DEFECT-001 (**CODE**) | customer/wallet/kyc tables (migrations `CreateCustomer*`) | customer-360 7/7 (MOCK/V-NOW); read-surface + PII + hardening integration suites exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | PII tabs (address/contact/identity-doc) not shown in drawer (known R8) — backend endpoints exist | P1: add PII tabs (R8) |
| 2.1b PII read endpoints (addresses/contact-methods/identity-documents) | `V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-*` | SUPER_ADMIN, COMPLIANCE | **Absent in UI** (direct-API only) | `GET /customers/:id/addresses|contact-methods|identity-documents` gated by `customer.view_address` etc. (**CODE**) | tables present | PII integration suite exists (**BLOCKED**) | **PARTIALLY WORKING** (backend complete; UI step missing) | Documented gap R8 | P1: PII tabs in Customer Directory drawer |
| 2.2 Agent Network (list, lifecycle, credentials, applications, outlets/terminals, funding, classes) | SPEC-01 `agent.*` (incl. sensitive `.fund/.defund`) | AGENT_NETWORK_MANAGER, OPERATIONS, ADMINISTRATOR(read), SUPER_ADMIN | AgentNetworkScreen with actions, real API (**CODE**) | `AdminAgentController`/`AdminAgentLifecycleController`/`admin-agent-credentials` + `requireFunction('agent.view')` etc. (**CODE**) | agents, outlets, terminals, funding tables | P1 hardening A-group claimed 16/16 (**PRIOR**); a8–a21 agent integration suites exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Not re-demonstrable | P0-1 |
| 2.2b Aggregator administration (create, relationships, funding attribution) | SPEC-01 `aggregator.view/.manage`; SCOPE-CH §B | OPERATIONS, SUPER_ADMIN | Tab inside Agent Network (**CODE**) | `admin-aggregator.controller` list+manage (**CODE**) | aggregator tables (H1–H5) | a18 aggregator foundation suite exists (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Aggregator **self-service login** is DECISION REQUIRED (§23-9) — not counted as defect | P1: ratify §23-9 |
| 2.3 Support Inbox (ticket queue, assign/status/messages) | SPEC-01 `customer.manage_support_case` | CUSTOMER_SERVICE, OPERATIONS, SUPER_ADMIN | SupportTicketsScreen, real API (**CODE**) | `support-internal.controller` + `requireFunction` (**CODE**) | support tables | P1 C-group claimed (**PRIOR**); support suites exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | In-ticket read status + FAQ are documented non-blocking polish | P2 polish |
| 3.1–3.4 Transaction & Fee Ops (W2W/C2W/W2C/C2C trace + fee simulator + sandbox override) | SPEC-01 `transaction.view`, `fee_rule.view` | OPERATIONS, FINANCE_*(view), SUPER_ADMIN | TransactionObservabilityScreen (4 filters), UUID search, fee simulator — real API (**CODE**) | `GET /transfers|deposits|withdrawals/:id` + `transaction.view` (route-policy WORKFORCE_SESSION branches) (**CODE**) | transfers/deposits/withdrawals tables | P1 E-group claimed (**PRIOR**); a5 lifecycle suites exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | `/fees/calculate`,`/limits/evaluate` deliberately unrestricted for workforce (documented P1 decision) — noted §E.5 | P0-1 |
| 4.1 Ledger & Reversals (accounts, journal search, reversal) | SPEC-01 `ledger.view/.post/.reverse` (posting = Future per SCOPE-CH) | FINANCE_AUDITOR(view), FINANCE_PREPARER(init), FINANCE_CONTROLLER(approve), SUPER_ADMIN(view) | LedgerOperationsScreen 587 lines, real API; **preparer reversal-request path contains hardcoded mock fingerprint and wrong action/resource types** | `GET /ledger/*` gated `ledger.view`; privileged reversal via `PrivilegedActionApprovalService` machinery exists for approved path (**CODE**) | ledger_accounts/journals/lines (double-entry) | ledger unit tests (MOCK); a5-ledger-reversal integration suite exists (**BLOCKED**) | **PARTIALLY WORKING** | Maker-request leg mis-wired (§E-2): `actionFingerprint:'4db33…'` mock const; action `FINANCE_CONTROL_POLICY_ACTIVATE` / resource `A2_FINANCE_ROLE_ASSIGNMENT` used for journal reversal | P0-3: rewire preparer request to real journal-reversal action + real fingerprint |
| 4.2 Reconciliation & Breaks (9-check report, trial balance, account activity) | SPEC-01 `reconciliation.view`; SCOPE-CH §C | FINANCE_AUDITOR, TREASURY, SUPER_ADMIN | ReconciliationObservabilityScreen (run, trial-balance tabs, WARNING vs ERROR vs PASS) (**CODE**) | `reconciliation.controller` + `requireFunction('reconciliation.view')` (**CODE**) | reconciliation tables + 9 checks incl. binding integrity | recon integration suites exist (**BLOCKED**); WARNING behavior documented | **BLOCKED FROM VERIFICATION** | Break **resolve/acknowledge workflow** = DECISION REQUIRED (§25-1) — reporting tier is complete per SCOPE-CH | P1: ratify §25-1 |
| 5.1 Fee Rules (definitions) | SPEC-01 `fee_rule.*` (makerCheckerRequired) | FINANCE_PREPARER(init), FINANCE_CONTROLLER(approve), FINANCE_AUDITOR(view), SUPER_ADMIN(view) | CommercialRulesScreen Fee tab — **read-only, no propose/approve controls** (**CODE**) | `FeeRuleRegistryController` create/modify gated by function code only; **no approval queue** (**CODE** — §E.1) | fee rule tables + resolver | `v1-commercial-03/04` integration suites exist (**BLOCKED**) | **PARTIALLY WORKING** | Single-actor create/modify violates declared maker-checker; UI has no governed propose/approve | P0-2 enforce maker-checker; P1 propose/approve UI |
| 5.2 Commission Rules | SPEC-01 `commission_rule.*` (makerCheckerRequired) | as above | Commission tab — read-only (**CODE**) | `CommissionRuleRegistryController` same pattern as fee (**CODE**) | commission tables | commercial suites (**BLOCKED**) | **PARTIALLY WORKING** | Same as 5.1 | P0-2 |
| 5.3 Reward Rules | SPEC-01 `reward_rule.*` (makerCheckerRequired); `V1-REWARD-01` machinery-only | as above | Reward tab — read-only (**CODE**) | registry same pattern; **reward crediting/wiring explicitly V2** (SCOPE-CH #7) | reward tables | reward registry suites exist (**BLOCKED**) | **PARTIALLY WORKING** (governance gap only; crediting is OUT OF SCOPE) | Same as 5.1; crediting correctly excluded | P0-2 |
| 5.4 Product Catalogue / governance | SPEC-01 `product.modify/.governance` (makerCheckerRequired) | as above | Product tab — read-only (**CODE**) | `product-governance.controller` exists; same single-actor pattern (**CODE**) | product tables + `a7-product-*` suites | product suites exist (**BLOCKED**) | **PARTIALLY WORKING** | Same as 5.1 | P0-2 |
| 5.5 Limit Catalogue | SPEC-01 `limit.view/.modify` | FINANCE_PREPARER, FINANCE_CONTROLLER, AGENT_NETWORK_MANAGER, SUPER_ADMIN | Limit tab — read-only (**CODE**) | `limit-catalog.controller` + `requireFunction` (**CODE**) | limit tables | P1 E-group (**PRIOR**) | **BLOCKED FROM VERIFICATION** | Same maker-checker question applies to `limit.modify` (CAT flags many limit functions SENSITIVE) — include in P0-2 scope check | P0-2 (verify `limit.modify` governance) |
| 5.6 Limit Assignments | SPEC-01 `limit.assign` (`agent.assign_limit`) | AGENT_NETWORK_MANAGER, SUPER_ADMIN | LimitAssignmentScreen real API (**CODE**) | `limit-assignment.controller` (**CODE**) | assignment tables | unit + integration exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| 6.1 KYC Queue | SPEC-01 `kyc.view/.review/.approve/.reject` (single-actor per DEC-01 Decision 5) | COMPLIANCE, SUPER_ADMIN | ComplianceScreen KYC tab, real API (**CODE**) | `POST /customers/:id/kyc-assessment` single-actor by design (**CODE**, documented decision) | kyc tables | KYC integration suite exists (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Two-step KYC = documented FUTURE, not a defect | P0-1 |
| 6.2 Compliance Cases | SPEC-01 `compliance.manage_case/.manage_risk_profile` | COMPLIANCE (non-FRAUD), SUPER_ADMIN | ComplianceScreen cases tab (**CODE**) | customer-compliance controller with category isolation (**CODE**) | compliance tables | compliance suites exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Manual UUID entry (no deep-link from Customer 360) — R9 | P1: deep-link (R9) |
| 6.3 Fraud Cases (FRAUD-category isolation) | SPEC-01 `risk_fraud.manage_fraud_case` | RISK_FRAUD only | RiskFraudScreen FRAUD-filtered (**CODE**) | category isolation enforced in backend per prior hardening (**CODE**) | same tables | leak test in menu suite proves COMPLIANCE cannot see menu (V-NOW); backend category isolation claimed (**PRIOR**) | **BLOCKED FROM VERIFICATION** | Backend category-filter enforcement not re-proven here | P0-1 (adversarial case) |
| 7.1 Workforce Admin (SUPPORT provisioning, workforce overview) | SPEC-01 `workforce.user.*`; AG-GOV | ADMINISTRATOR, OPERATIONS, SUPER_ADMIN | WorkforceAdminScreen real API (**CODE**) | `admin-support-credentials.controller` + workforce-administration controller (**CODE**) | workforce tables | P1 suites (**PRIOR**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| 7.2 Finance Role Admin (assign/revoke with maker-checker) | SPEC-01 `workforce.role.assign/.revoke` (PRIVILEGED, maker≠checker) | SUPER_ADMIN(init), FINANCE_CONTROLLER(approve) for finance roles; `workforce.role.assign_operational` for 6 operational roles (DB CHECK) | RoleAssignmentScreen real API (**CODE**) | `finance-role-administration.service` routes through `PrivilegedActionApprovalService` (**CODE**) | `a2_finance_role_assignments` + approval rows | 36 hardening tests claimed (**PRIOR**) | **BLOCKED FROM VERIFICATION** | This flow **does** enforce maker≠checker in code (positive finding §E.3) | P0-1 |
| 7.3 Privileged Approvals (queue approve/reject) | SPEC-01 §19 | FINANCE_CONTROLLER, SUPER_ADMIN | ApprovalsScreen real API (**CODE**) | approval service: requester≠approver (line 137/207), MFA gate (251–252), fingerprint match (220) (**CODE**) | approval entity | integration suites exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Ledger preparer path never reaches this queue correctly (§E-2) | P0-3 |
| 7.4 Super-Admin Recovery | SPEC-01 | SUPER_ADMIN | SuperAdminRecoveryScreen (**CODE**) | recovery controller/service (**CODE**) | entities | prior report (**PRIOR**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| 7.5 System Health (metrics, diagnostics, outbox, notification deliveries) | SPEC-01 `metrics.view`,`diagnostics.view`,`outbox.view`,`notification.view_deliveries` | OPERATIONS, SUPER_ADMIN | SystemHealthScreen real API (**CODE**) | `/internal/metrics` etc. reachable via internal route + function checks (**CODE**) | outbox/deliveries tables | ops suites exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| 7.6 Audit & Security Events | SPEC-01 `audit.view` | SUPER_ADMIN, FINANCE_AUDITOR | AuditTrailScreen real API (**CODE**) | `AuditService.list` via widget + routes (**CODE**) | audit tables | audit suites exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Audit **export** = documented FUTURE | P0-1 |
| Role-based menu gating (11 roles × 26) | IA-26, SPEC-01 §6–7 | All 11 | Layout canView* predicates per catalogue scopes | Catalogue scopes via session (CODE) | catalogue tables | **menu-visibility 24/24 V-NOW**; customer-360 7/7 V-NOW | **WORKING** *(UI-gating layer only — mocked principals; the only WORKING row because it is fully demonstrated at its own layer without DB)* | Real-session scope fetch not re-proven (subsumed by P0-1) | Keep; fold proof into P0-1 |

### B.3 Customer money movement & servicing (backend + Customer Mobile)

| Requirement / Feature | Source | Role(s) | Frontend | Backend | Database | Tests | Overall status | Gap | Next action |
|---|---|---|---|---|---|---|---|---|---|
| Customer registration / onboarding | `V1-CUSTOMER-04-REGISTRATION-COMPLETION-01`, A23 | CUSTOMER | customer-mobile RegistrationScreen (**CODE**) | `customer-registration.controller` + onboarding services (**CODE**) | `CreateCustomerOnboarding` migrations | registration suites exist (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Customer login / session | A23 §1 | CUSTOMER | LoginScreen (**CODE**) | `customer-authentication.controller` (`/customers/sessions`), PBKDF2, audience `customer-api` (**CODE**) | auth session tables | `a23-customer-app.integration.spec.ts` exists (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Wallet / balance (ledger-derived) | A23 #4 | CUSTOMER | HomeScreen balance (**CODE**) | `/customers/me/wallets*` → `WalletService` → `LedgerService.getAccountBalance` — **no cached balance** (positive) (**CODE**) | wallet + ledger tables | wallet suites (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Receiving identity / recipient resolution | A23 #5–6 | CUSTOMER | SendMoneyScreen recipient step (**CODE**) | `/customers/me/receiving-identity`, `/recipients` resolution service (**CODE**) | contact_methods + resolution | resolution suites (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| **Wallet→Wallet transfer (PIN, idempotent, double-entry)** | A23 #7; `V1-CUSTOMER-02`; `V1-CUSTOMER-05` | CUSTOMER | SendMoneyScreen: `POST /customers/me/transfers` with required PIN (rewired per A23) (**CODE**) | `TransferService.createTransfer` SERIALIZABLE, pessimistic locks, idempotency key + requestHash, `postJournalInTransaction`, audit+outbox (**CODE**) | transfers + journals + lines | `a5-transfer-lifecycle` + `a23` + `a24-pin-hardening` suites exist (**BLOCKED**); prior claims PASS (**PRIOR**) | **BLOCKED FROM VERIFICATION** | Highest-value flow; must be first in P0-1 evidence | P0-1 |
| Transaction history / detail (unified) | `V1-CUSTOMER-07`, A23 #8–9 | CUSTOMER | TransactionsScreen (**CODE**) | `/customers/me/transfers*` read-only projections (**CODE**) | transfers table | `a25-history-hardening` exists (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Transaction PIN security (PBKDF2, lockout) | `V1-CUSTOMER-05`, `V1-CUSTOMER-06` | CUSTOMER | TransactionPinScreen (**CODE**) | `CustomerTransactionPinService` timing-safe, MAX_FAILED_PINS=5 (**CODE**) | pin tables | `a24` suite (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Limits & account controls | `V1-CUSTOMER-08` | CUSTOMER | ProfileScreen controls (**CODE**) | limit evaluation services (**CODE**) | limit tables | limit suites (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Support (create/list/messages) | `V1-CUSTOMER-09`, A23 Support row | CUSTOMER | SupportScreen + CreateSupportTicketScreen + detail (**CODE**) | `support-customer.controller` ownership-scoped (**CODE**) | support tables | support suites (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Help/FAQ + read status = documented polish | P2 |

### B.4 Agent operations (backend + Agent Mobile)

| Requirement / Feature | Source | Role(s) | Frontend | Backend | Database | Tests | Overall status | Gap | Next action |
|---|---|---|---|---|---|---|---|---|---|
| Agent login / session / PIN | A21 §2.1; `V1-AGENT-05` | AGENT | Login + PIN screens (**CODE**) | `agent-authentication.controller`, PBKDF2, audience `agent-api` (**CODE**) | agent auth tables | `a7-agent-authentication-http` exists (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Agent profile / capabilities | A21 #1 | AGENT | HomeScreen/AccountScreen (**CODE**) | `/agents/me/profile`, `/capabilities` fail-closed evaluator (**CODE**) | agent + class tables | `a10-agent-service-capability` (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| **Cash-in (C2W)** | A21 §2.2; `V1-AGENT-MOBILE-COMPLETENESS-MATRIX-01` | AGENT | CashToWallet 4-step flow (**CODE**) | `agent-cash-in.controller` + idempotency + journals (**CODE**) | deposits + journals | `a13-agent-cash-in` (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| **Cash-out (W2C)** | A21; completeness matrix | AGENT | WalletToCash 4-step flow (**CODE**) | `agent-cash-out.controller` + authorization service (**CODE**) | withdrawals + journals | `a14-agent-cash-out` (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Cash-out binding item documented unresolved (standing list §E.6) | P0-1 |
| **Cash-to-Cash + claim + expiry** | A21; `V1-C2C-SECURITY-02` | AGENT | C2C 4-step + claim flows (**CODE**) | `agent-cash-to-cash(-claim).controller`, OTP/claim/expiry sweep (**CODE**) | c2c tables | `a15/a16/a17` suites (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | C2C transfer route item documented unresolved (§E.6) | P0-1 |
| Agent unified transaction history | A21 (`V1-AGENT-HISTORY-01`) | AGENT | TransactionsScreen (**CODE**) | `GET /agents/me/transactions` + `AgentTransactionHistoryService` (**CODE** — verified present) | transfers etc. | `v1-agent-history-01.integration.spec.ts` exists (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | SCOPE-CH still calls this "the single concrete missing V1 engineering feature" — **stale claim** (now implemented); doc fix only | P2 doc correction |
| Agent funding / defunding (sensitive) | SPEC-01 `agent.fund/.defund`; A21 | AGENT_NETWORK_MANAGER, FINANCE | via Agent Network screen (**CODE**) | `agent-funding.controller` + attribution (**CODE**) | funding tables | `a19-agent-funding` (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Outlets / terminals | A21; SPEC-01 `agent.manage_outlets_terminals` | AGENT_NETWORK_MANAGER, AGENT(self read) | Agent Network + agent app (**CODE**) | outlets/terminals controllers (**CODE**) | tables | `a20` (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Receiving number | A21 | AGENT | AccountScreen (**CODE**) | `agent-receiving-number.controller` 10-digit rules (**CODE**) | tables | `a9` (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Agent application review | SPEC-01 `agent.review_application` | AGENT_NETWORK_MANAGER | Agent Network applications (**CODE**) | `agent-application-admin.controller` (**CODE**) | tables | `a8` (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Agent app placeholder destinations | `V1-AGENT-MOBILE-COMPLETENESS-MATRIX-01` | AGENT | `PlaceholderScreen.tsx` generic component exists (used for non-core tabs) (**CODE**) | N/A | N/A | mobile build not run this session | **PARTIALLY WORKING** (cosmetic dead-ends where used) | Which tabs route to Placeholder was not fully enumerated | P2: enumerate + real destinations |

### B.5 Commercial engine (fees, commissions, limits, rewards — runtime)

| Requirement / Feature | Source | Role(s) | Frontend | Backend | Database | Tests | Overall status | Gap | Next action |
|---|---|---|---|---|---|---|---|---|---|
| Fee calculation engine + resolver | DP-08; PROD-COMP | system (during money movement) | fee simulator in Transaction screen (**CODE**) | `FeeEngine` + resolver services; `/fees/calculate` workforce-observability (**CODE**) | fee tables | `v1-commercial-04-fee-rule-resolver` + commercial accounting **170/170 claimed** (**PRIOR**) | **BLOCKED FROM VERIFICATION** | Engine is definition-complete; runtime charging proven only in prior real-DB runs | P0-1 |
| Commission accrual (internal netting) | DP-08 D-C-014 (`ACCRUE_NOW_SETTLE_LATER` / `AGENT_WALLET_NETTING`) | system | n/a | commercial-accounting service, EXPENSE_PAYABLE recognition (**CODE**) | journal tables | settlement-01 **8/8 claimed** (**PRIOR**) | **BLOCKED FROM VERIFICATION** | External settlement/payout rail = **OUT OF V1 SCOPE** (documented) | P0-1 |
| Limit evaluation | PROD-COMP | system + workforce | limit tabs (**CODE**) | `/limits/evaluate` + catalog services (**CODE**) | limit tables | P1 E-group (**PRIOR**) | **BLOCKED FROM VERIFICATION** | — | P0-1 |
| Reward engine (machinery only) | `V1-REWARD-01` | n/a | Reward tab (definitions) | registry/resolver only; **no crediting/wiring — deliberate** (**CODE**) | reward tables | REWARD-01 claimed (**PRIOR**) | **OUT OF V1 SCOPE** (crediting) / definitions covered under B.2 5.3 | — | Ratify §25-2 accounting treatment (V2) |
| Aggregator / platform commission participation | SCOPE-CH #6, D-C-009/010 | n/a | n/a | fail-closed (`COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED`) (**CODE**) | n/a | S04 claimed (**PRIOR**) | **OUT OF V1 SCOPE** | Formalize D-C-009/010 decisions | P1 decision ratification |

### B.6 Ledger, reconciliation, treasury, notifications, audit

| Requirement / Feature | Source | Role(s) | Frontend | Backend | Database | Tests | Overall status | Gap | Next action |
|---|---|---|---|---|---|---|---|---|---|
| Double-entry ledger (post journal) | SPEC-01 (BACKEND_ONLY/Future posting per SCOPE-CH) | system | via flows only | `LedgerService.postJournal(InTransaction)` (**CODE**) | ledger tables | `a5-payment-lifecycle` etc. (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Direct `ledger.post` UI intentionally absent (Future) — not a defect | P0-1 |
| Journal reversal primitive | SCOPE-CH #4 | privileged | see B.2 4.1 (preparer leg broken) | `reverseJournal` SERIALIZABLE, compensating entries, unique `reversal_of_journal_id` (**CODE**) | journal tables | `a5-ledger-reversal` (**BLOCKED**) | **PARTIALLY WORKING** | Ops reversal **workflow** (reason capture/maker-checker/notifications) = DECISION REQUIRED (V1-017) | P0-3 + P1 ratify V1-017 |
| Reconciliation reporting (9 checks + trial balance + finance verification) | MATRIX §2 8; SCOPE-CH §C | FINANCE_AUDITOR, TREASURY, SUPER_ADMIN | ReconciliationObservabilityScreen (**CODE**) | `ReconciliationService.runReconciliation` (**CODE**) | recon tables | recon suites (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Break resolver workflow DECISION REQUIRED | P0-1 |
| Notifications: outbox + SMS delivery + inbox + opt-out | A7 contracts; `V1-005` | system + CUSTOMER | inbox surfaces in mobile apps (**CODE**) | notification resolver/event-map/dispatcher/worker/retry/idempotency (**CODE**) | outbox + deliveries + inbox | sms-v1-01 **10/10 claimed** (**PRIOR**) | **BLOCKED FROM VERIFICATION** | Push channel = **OUT OF V1 SCOPE** (PUSH_TOKEN_DEPENDENCY_MISSING documented, never faked) | P0-1 |
| Audit trail persistence (who/what/when/approver/why) | SPEC-01 §2 principle 6 | SUPER_ADMIN, FINANCE_AUDITOR | AuditTrailScreen (**CODE**) | audit writes embedded in services (verified pattern in registry + approval services) (**CODE**) | audit tables | suites (**BLOCKED**) | **BLOCKED FROM VERIFICATION** | Audit export = FUTURE | P0-1 |
| Treasury settlement / suspense | SPEC-01 `treasury.manage_settlement` | TREASURY (read-only today) | none (correctly absent) | **no controller** (external-settlement entity exists, zero exposure) — correctly absent per MATRIX §2 17 | entity only | n/a | **OUT OF V1 SCOPE** | — | Keep excluded |

### B.7 Explicitly out of V1 scope (verified against scope documentation — not defects)

| Exclusion | Source |
|---|---|
| Wallet↔Bank/NIBSS, provider settlement rails, external payout execution | MATRIX §1; DP-08 A18 |
| Cards / dollar cards, bills / airtime / data / electricity / cable / betting | MATRIX §1 |
| Push-only delivery / push notifications / device tokens | SCOPE-CH #1 (DEFER V2) |
| Non-NGN | MATRIX §1 |
| Aggregator self-service login / scoped position | SCOPE-CH #2 — **DECISION REQUIRED** (§23-9), provisional V2 |
| Reconciliation-break resolver workflow | SCOPE-CH #3 — **DECISION REQUIRED** (§25-1) |
| Operations reversal workflow (full) | SCOPE-CH #4 — **DECISION REQUIRED** (V1-017), primitive exists |
| Commission settlement payout rail | SCOPE-CH #5 — V2 for external rails; internal settle-later mechanism **DECISION REQUIRED** (D-C-014) |
| Aggregator/platform commission accounting | SCOPE-CH #6 — DEFER V2 (fail-closed already correct) |
| Reward crediting / accounting | SCOPE-CH #7 — DEFER V2 (machinery delivered) |
| Direct `ledger.post` admin UI; `customer.terminate`; two-step KYC; audit export; per-agent granular permissions | CAT `v1Status: FUTURE` markers; DEC-01 |

---

## C. Complete workflow assessment

Each workflow: (1) initiator/role, (2) starting conditions, (3) screens/actions, (4) endpoints, (5) expected DB state changes, (6) auth/business rules, (7) expected result, (8) demonstrated?, (9) missing/failure/blocker. Status vocabulary matches §B.

**C.1 Workforce login → role-based portal**
(1) Any of 11 workforce roles. (2) Seeded workforce user + role assignment. (3) LoginScreen → Layout menu. (4) `POST /internal/a2/workforce/local-admin-sessions` → session endpoints. (5) session row, token hash. (6) PBKDF2; scope resolution legacy+catalogue union; menu gated by `canView*`. (7) correct 7×26 menu per role. (8) Menu layer demonstrated (24/24 V-NOW with live catalogue scopes); login end-to-end **not demonstrated** (BLOCKED). (9) Only PG availability.

**C.2 Customer onboarding → KYC review**
(1) CUSTOMER registers; COMPLIANCE reviews KYC. (2) Registration screens; KYC PENDING. (3) customer-mobile RegistrationScreen; Admin 6.1 KYC Queue. (4) registration controllers; `POST /customers/:id/kyc-assessment`. (5) customer + profile + kyc rows; audit. (6) single-actor per DEC-01 Decision 5; `kyc.review/approve/reject` functions. (7) customer reaches APPROVED kycLevel. (8) **BLOCKED FROM VERIFICATION** (code complete; KYC integration suite exists). (9) PG; two-step KYC is FUTURE by decision, not missing.

**C.3 Customer servicing (status lifecycle, wallets, PII)**
(1) CUSTOMER_SERVICE/OPERATIONS (COMPLIANCE for PII). (2) Existing customer. (3) Customer Directory drawer. (4) `GET /internal/customers*`, `PATCH /customers/:id`, PII endpoints. (5) status transitions + audit. (6) `customer.suspend/activate/close` (OPERATIONS/SUPER_ADMIN); SUPPORT excluded from lifecycle (UAT-DEFECT-001); PII by `customer.view_*`. (7) lifecycle change visible in drawer. (8) **BLOCKED FROM VERIFICATION**; PII display step = **PARTIALLY WORKING** (R8). (9) PII tabs absent in UI (P1).

**C.4 Wallet→Wallet transfer (customer)**
(1) CUSTOMER. (2) funded source wallet, recipient resolved, PIN set, within limits. (3) SendMoneyScreen (amount → recipient → PIN confirm). (4) `POST /customers/me/transfers` (Idempotency-Key). (5) transfer row; journal DR source/CREDIT dest on CUSTOMER_FUNDS; fee/commission journals; audit; outbox notification. (6) PIN verify (PBKDF2, lockout 5), SERIALIZABLE + wallet locks, idempotency, limit/eligibility checks. (7) COMPLETED transfer + history entry + SMS/inbox. (8) **BLOCKED FROM VERIFICATION** — code path complete and previously claimed passing (a5/a23/a24), not re-run. (9) PG. **This is the single most important workflow to re-verify first.**

**C.5 Agent cash-in (C2W)**
(1) AGENT. (2) ACTIVE agent, capability CASH_IN, customer wallet recipient. (3) Agent app CashToWallet flow. (4) `POST /agents/me/cash-in` (idempotency). (5) deposit + journal + agent float movement + audit. (6) capability fail-closed evaluation, PIN, idempotency. (7) customer wallet credited, receipt. (8) **BLOCKED FROM VERIFICATION** (a13 exists). (9) PG.

**C.6 Agent cash-out (W2C)**
As C.5 with withdrawals; standing unresolved item: cash-out binding documentation (§E.6). Status **BLOCKED FROM VERIFICATION** (a14 exists).

**C.7 Cash-to-Cash + claim + expiry**
(1) AGENT (sender), recipient claims with OTP. (2) C2C capability. (3) C2C flow + claim screens. (4) `/agents/me/cash-to-cash`, claim, expiry sweep. (5) c2c rows + journals + expiry transitions. (6) OTP/claim windows, idempotency, C2C security audit identity claims (`V1-C2C-SECURITY-02`). (7) claimed or expired with correct ledger effect. (8) **BLOCKED FROM VERIFICATION** (a15/16/17 exist). (9) PG.

**C.8 Customer funding (maker/checker)**
(1) Customer requests funding; workforce maker + checker. (2) funding instrument. (3) Customer app request; admin funding desks. (4) `customer-funding-customer/internal` controllers. (5) funding request → APPROVED/REJECTED + journal on approval + audit + notification. (6) maker≠checker; `denyUnsafeMethodForReadOnlyPrincipal`. (7) funded wallet or documented rejection. (8) **BLOCKED FROM VERIFICATION** (suites exist). (9) PG.

**C.9 Agent funding / defunding (sensitive)**
(1) AGENT_NETWORK_MANAGER initiates; governed approval. (2) agent float account. (3) Agent Network screen. (4) `agent-funding.controller`. (5) funding journal + attribution + audit. (6) `agent.fund/.defund` SENSITIVE functions. (7) float adjusted, auditable. (8) **BLOCKED FROM VERIFICATION** (a19 exists). (9) PG.

**C.10 Commercial rule governance (fee/commission/reward/product)**
(1) FINANCE_PREPARER initiates, FINANCE_CONTROLLER approves. (2) product exists. (3) Commercial Rules screens — **read-only today** (no propose/approve buttons). (4) `POST/PATCH /internal/fee-rules|commission-rules|…` — **direct writes after `requireFunction` only**. (5) rule row written + audit (single-actor). (6) CAT declares `makerCheckerRequired` + `approvalRequired` + INITIATE/APPROVE split — **NOT enforced at runtime** (`AuthorizationCatalogueRuntimeService` explicitly flattens access types; scope check is membership-only). (7) should be: PREPARER creates PENDING → CONTROLLER approves → active. Actual: PREPARER's create is immediately active. (8) **PARTIALLY WORKING** — defect proven by code (§E.1); not a test-environment issue. (9) Missing approval gate (P0-2) + missing UI (P1).

**C.11 Limit assignment**
(1) AGENT_NETWORK_MANAGER. (2) limit catalogue defined. (3) LimitAssignmentScreen. (4) `limit-assignment.controller`. (5) assignment rows + audit. (6) `agent.assign_limit`. (7) agent class/agent limits enforced in evaluation. (8) **BLOCKED FROM VERIFICATION**. (9) PG.

**C.12 Reconciliation reporting**
(1) FINANCE_AUDITOR/TREASURY. (2) operational data exists. (3) Reconciliation & Breaks screen (run, trial balance). (4) `/internal/reconciliation/report|trial-balance|finance|accounts/:id/activity`. (5) read-only computations (report rows). (6) `reconciliation.view`. (7) 9-check report + balanced trial balance; WARNINGs surfaced not suppressed. (8) **BLOCKED FROM VERIFICATION** (reporting tier claimed complete in SCOPE-CH). (9) Break **resolution** workflow absent pending §25-1 decision (not a silent defect).

**C.13 Ledger exploration + journal reversal (privileged)**
(1) FINANCE_AUDITOR views; FINANCE_PREPARER initiates reversal; FINANCE_CONTROLLER approves. (2) existing journal. (3) Ledger & Reversals screen. (4) `GET /ledger/accounts|journals/:id`; approval request → approve/execute → `POST /ledger/journals/:id/reversal`. (5) compensating journal, `reversal_of_journal_id`, audit. (6) maker≠checker + MFA + fingerprint (in `PrivilegedActionApprovalService`); `ledger.reverse` CRITICAL_FINANCIAL. (7) reversal posted after controller approval. (8) **PARTIALLY WORKING** — controller/approval machinery exists and enforces maker≠checker, but the preparer request from the screen is mis-wired (mock fingerprint `4db33…`, action `FINANCE_CONTROL_POLICY_ACTIVATE`, resource `A2_FINANCE_ROLE_ASSIGNMENT`) so step "initiate" cannot produce a valid journal-reversal approval. (9) P0-3 rewiring.

**C.14 Workforce role administration (maker/checker)**
(1) SUPER_ADMIN (or `assign_operational` holder) initiates; FINANCE_CONTROLLER approves finance roles. (2) target user exists. (3) Finance Role Admin screen. (4) `POST/DELETE /internal/a2/workforce/roles` → approvals → execute. (5) `a2_finance_role_assignments` + approval rows + audit; DB CHECK prevents cross-boundary assignment. (6) maker≠checker structurally (line 137/207), MFA gate, fingerprint. (7) role assigned after second actor. (8) **BLOCKED FROM VERIFICATION** — code enforcement verified positive (§E.3); 36 tests claimed (**PRIOR**). (9) PG.

**C.15 Support ticket lifecycle**
(1) CUSTOMER creates; CUSTOMER_SERVICE/OPERATIONS manage. (2) authenticated customer. (3) customer/agent app Support screens; Admin Support Inbox. (4) `support-customer.controller` + `support-internal.controller`. (5) ticket + message rows + status transitions + audit. (6) ownership-scoped customer read; `customer.manage_support_case` for internal. (7) resolved ticket with full thread. (8) **BLOCKED FROM VERIFICATION**. (9) PG; polish items P2.

**C.16 Compliance / fraud case management**
(1) COMPLIANCE (non-FRAUD) / RISK_FRAUD (FRAUD). (2) case exists or created. (3) 6.2/6.3 screens. (4) customer-compliance endpoints. (5) case rows + transitions + audit. (6) category isolation: COMPLIANCE denied FRAUD category (menu-level proven V-NOW; backend claimed PRIOR). (7) case closed with audit. (8) **BLOCKED FROM VERIFICATION** (backend category enforcement needs adversarial re-run). (9) PG; R9 deep-linking P1.

**C.17 Notifications (transactional + security)**
(1) system. (2) events from flows. (3) inbox surfaces in mobile apps; admin deliveries in System Health. (4) outbox → dispatcher → provider (SMS) → inbox. (5) outbox/deliveries/inbox rows + retry state. (6) opt-out incl. `notification_push_enabled`; push channel resolves `PUSH_TOKEN_DEPENDENCY_MISSING` (never faked). (7) SMS+inbox received for funding/transfer/ticket/C2C events. (8) **BLOCKED FROM VERIFICATION** (sms-v1 10/10 claimed PRIOR). (9) PG; push = OUT OF SCOPE.

**C.18 Audit & system health**
(1) OPERATIONS/SUPER_ADMIN/AUDITOR. (2) activity exists. (3) 7.5/7.6 screens. (4) `/internal/metrics|diagnostics|outbox|notifications/deliveries`, audit list. (5) read-only. (6) `metrics.view` etc. (7) accurate operational picture. (8) **BLOCKED FROM VERIFICATION**. (9) PG.

**C.19 Super-admin recovery**
(1) SUPER_ADMIN (or break-glass per design). (2) recovery scenario. (3) Super-Admin Recovery screen. (4) `authorization/super-admin-recovery.controller`. (5) recovery actions + audit. (6) strict governance per `V1-SECURITY-SUPER-ADMIN-RECOVERY-01`. (7) controlled recovery, fully audited. (8) **BLOCKED FROM VERIFICATION** (prior report). (9) PG.

**C.20 Dashboard configuration**
(1) SUPER_ADMIN/ADMINISTRATOR. (2) templates seeded (12). (3) Dashboard Settings. (4) `PUT /assignments/:roleKey`. (5) assignment rows + audit. (6) `workforce.dashboard.assign` (2 roles only). (7) role's dashboard resolves assigned template. (8) **BLOCKED FROM VERIFICATION** (prior hardening 5d). (9) PG.

**C.21 Agent self-service (app)**
(1) AGENT. (2) ACTIVE agent + PIN. (3) agent-mobile tabs. (4) A21 thin adapters. (5) per-flow above. (6) AGENT SELF only; fail-closed capabilities. (7) complete servicing without workforce. (8) **BLOCKED FROM VERIFICATION** (a21 suite exists). (9) PG; some tabs route to PlaceholderScreen (P2).

---

## D. Test and build results (this audit session)

All commands run on `arena/edba26d6-monienaija` @ `2ccc17b04351c6669872a43e0a2b110086bb1d5a`, 2026-10-21.

| # | Command | Result | Evidence class |
|---|---|---|---|
| 1 | `npm --prefix apps/admin-web run build` | **PASS** — `dist/assets/index-B_-iyc12.js 305.73 kB │ gzip: 81.59 kB`, built in 1.23s, exit 0 | V-NOW |
| 2 | `npm --prefix apps/admin-web test` | **PASS** — 9 suites, **65/65 tests** (includes `menu-visibility-11-roles` 24/24 and `customer-360` 7/7) | V-NOW (mocked ApiClient) |
| 3 | `npm run build` (nest) | **PASS** — exit 0 | V-NOW |
| 4 | `npm run test` (backend unit) | **PASS** — 174 suites, **1,831/1,831 tests** in 26.3s | V-NOW (unit/mocked) |
| 5 | `npm run test:pg -- test/v1-admin-p1-authorization-hardening.integration.spec.ts` (representative) | **BLOCKED** — harness: *"Real PostgreSQL is required for integration suites but is not reachable at 127.0.0.1:5432 as monienaija… connect ECONNREFUSED 127.0.0.1:5432"* and *"Invalid environment configuration: DB_HOST/DB_NAME/DB_USER/DB_PASSWORD undefined"* | BLOCKED (environment) |
| 6 | Inventory | 105 `*.integration.spec.ts` + 174 unit suites exist (279 spec files total); 90 migrations; 150 entities | V-NOW (inventory) |

**Reassessment of the previous report's claim (as instructed):** the previous statement is *accurate as stated* — frontend tests do pass (re-verified now: 65/65), and PostgreSQL-dependent integration tests **cannot be rerun in the Arena sandbox** (re-verified now: ECONNREFUSED + missing `DB_*` env). This is an **environment/dependency problem, not a code defect** (the harness deliberately refuses to mock or skip — a good safety property). Nothing in this audit disguises a code failure as an environment problem: the code failures found (§E.1–E.2) were found by inspection independent of the blocker, and the blocker itself prevents *verification*, not *execution of the product* per se.

**Claims from previous test reports (recorded, NOT counted as passes here):** P1 authorization hardening 16/16 PASS on real PG+HTTP at ~`0584cdb` (`v1-admin-p1-authorization-hardening.integration.spec.ts`); commercial accounting 170/170 + settlement 8/8; sms-v1 10/10; dashboard 47; various module suites. These are **[PRIOR]** evidence only.

**Minimum safe verification (no destructive operations, isolated only):**

1. Provision PostgreSQL 14+ reachable at `127.0.0.1:5432` with a **dedicated non-production** role/database (the harness creates isolated `mn_it_*_${pid}` databases — verified safe by inspection; it must not point at any real environment).
2. Export `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` for that disposable instance only.
3. `npm run test:pg` (all 105 suites). Record exact counts. Any failure = code defect to triage, not to skip.
4. Promote rows in §B from BLOCKED to WORKING only for suites green at HEAD.

No migrations were run, no database reset/truncated, no environment configuration modified during this audit.

---

## E. Security and authorization findings

### E.1 (Material, code defect) Commercial rule maker-checker is declared but not enforced

- **Declared (CAT):** `fee_rule.create/modify`, `commission_rule.create/modify`, `reward_rule.create/modify`, `product.modify/governance` — each `makerCheckerRequired: true, approvalRequired: true`; FINANCE_PREPARER holds INITIATE (lines 399–410 of CAT), FINANCE_CONTROLLER holds APPROVE (lines 425–432).
- **Actual runtime:** `AuthorizationCatalogueRuntimeService` (comment, lines 37–40) *"Deliberately does not distinguish INITIATE vs APPROVE… in `functionCodes`"*; `AuthorizationService.evaluate` checks only `principal.scopes.includes(fn)`; `FeeRuleRegistryController.create` → `requireFunction('fee_rule.create')` → `FeeRuleRegistryService.createRule` **direct DB write** (transaction + audit, no approval row). `PrivilegedActionApprovalService` is consumed only by workforce-administration, finance-role-administration, role-definition-governance, and AR-control provisioning — **not** by any commercial registry.
- **Consequence:** a single FINANCE_PREPARER can create/modify fee, commission, reward, and product rules that take effect immediately — separation of duties on financial controls fails open. This **contradicts** `REMAINING-DEFECTS-PRIORITIZED.md` R10 ("registries have maker/checker") — flagged as a requirement/claim conflict, not silently resolved.
- **Not an environment issue; proven by code at HEAD.** Priority P0-2.

### E.2 (Material, code defect) Ledger reversal preparer path is placeholder

`LedgerOperationsScreen.tsx` (~line 136): preparer branch posts to `/internal/a2/workforce/approvals/request` with `action: 'FINANCE_CONTROL_POLICY_ACTIVATE'`, `resource: {type:'A2_FINANCE_ROLE_ASSIGNMENT', id: journal.id}`, and `actionFingerprint: '4db33761…'` — an explicitly commented **"Mock valid 64-hex SHA256 fingerprint"** constant. The approval machinery later verifies the fingerprint (approval service line 220) and action/resource identity (lines 213–216), so this request cannot correctly represent a journal reversal. The maker half of the only privileged financial workflow is non-functional as wired. Priority P0-3.

### E.3 (Positive) Maker≠checker structurally enforced where PrivilegedActionApprovalService is used

Requester identity check (line 137), approver distinctness (line 207), action/resource/fingerprint binding (213–220), PRIVILEGED+MFA gate (251–252). Workforce role administration and role-definition governance route through it. The gap is that **commercial registries do not** (E.1).

### E.4 (Positive) Least-privilege and read-only enforcement

- Controller-level `requireFunction` added across 14 controllers (P1 hardening, [PRIOR] tests 16/16).
- `denyUnsafeMethodForReadOnlyPrincipal` blocks FINANCE_AUDITOR writes ([PRIOR]).
- Menu-layer least privilege proven live this session (24/24), incl. COMPLIANCE cannot see Fraud Cases; AGENT_NETWORK_MANAGER limited to 4 entries after the granular commercial fix.
- PII endpoints gated by dedicated `customer.view_address|view_contact_methods|view_identity_documents` (SUPER_ADMIN + COMPLIANCE only).

### E.5 (Noted, documented decision) Unrestricted workforce-observability computations

`/fees/calculate` and `/limits/evaluate` are deliberately unrestricted for workforce principals (P1 record: restricting them broke legitimate OPERATIONS tracing). Any workforce session can compute fee/limit outcomes; they cannot mutate definitions through these routes. Accepted per documentation; no action unless policy changes.

### E.6 (Standing unresolved items — preserved, unchanged)

Wallet PATCH status/alias; SUPPORT read-scope boundary; cash-out binding; C2C transfer; `internal:access` catch-all ownership. Each is documented in prior audits (UAT-DEFECT-001, `V1-ADMIN-AUTHORIZATION-*`); the catch-all remains for truly public routes with controller-level `requireFunction` covering V1 surfaces. **Left exactly as documented** per standing instruction.

### E.7 Requirement/claim conflicts flagged (not resolved here)

1. **Ten vs eleven roles:** SPEC-01 header says "ten named V1 roles"; catalogue + IA + tests implement **11** (ADMINISTRATOR added by AG-GOV). Later documents govern, but the spec header is stale — flag.
2. **R10 maker-checker claim vs code** (E.1) — material.
3. **SCOPE-CH "agent unified history is the single concrete missing V1 engineering feature"** vs `AgentTransactionHistoryService` + `GET /agents/me/transactions` + `v1-agent-history-01` now present — stale claim; feature appears implemented (verification pending P0-1).
4. **IA label drift** (6 label wording deviations, structure identical) — documented in `MENU-VERIFICATION-ALL-11-ROLES.md`.
5. **Legacy 5-role workforce config vs 11 organizational roles** — documented; must not be conflated (standing instruction).
6. **CAT marks `ledger.post/reverse` FINANCE_PREPARER/CONTROLLER** while SCOPE-CH defers ledger posting UI to Future — resolved in practice (no post UI; reversal via privileged workflow), but the two documents should be reconciled in writing.
7. **`REMAINING-DEFECTS-PRIORITIZED.md` "P0 — None"** vs this audit's P0 list (E.1/E.2 + verification) — the older document predates these findings.

---

## F. Prioritized completion plan

### P0 — Critical (blocks safe operation or makes core V1 unusable)

| ID | Deliverable | Dependencies | Acceptance criteria | Verification | Independence |
|---|---|---|---|---|---|
| **P0-1** | **Real-DB verification campaign:** provision isolated PostgreSQL, run all 105 integration suites at HEAD, produce evidence report; triage every failure as code defect | A disposable PG (never production); `DB_*` env for that instance only | `npm run test:pg` green at HEAD (or each failure root-caused and fixed); every §B BLOCKED row promoted or defect-listed; W2W / cash-in / cash-out / C2C / funding / auth covered first | Exact command output recorded per suite | **Independent** (environment-only) |
| **P0-2** | **Enforce commercial maker-checker:** route fee/commission/reward/product (and verify limit) create/modify through the existing `PrivilegedActionApprovalService` pattern (or equivalent two-actor gate honoring CAT `makerCheckerRequired`/`accessType`) | None (reuses existing approval machinery) | FINANCE_PREPARER create → PENDING approval; FINANCE_CONTROLLER approval required before effect; self-approval impossible; fingerprint binding real; 403 for FINANCE_AUDITOR; adversarial tests included | New integration tests in `test/` (run under P0-1) proving two-actor flow + denial matrices | Independent (can build before P0-1 completes; verifies under P0-1) |
| **P0-3** | **Fix ledger reversal maker path:** preparer request must use journal-reversal action/resource types and a real request-derived fingerprint (remove `4db33…` mock constant); end-to-end prepare→approve→execute | P0-2's pattern (or same machinery) | Preparer request appears in Approvals Inbox as a journal-reversal item; controller approval executes compensating reversal; fingerprint mismatch rejected | Integration test: two actors complete reversal; single actor cannot | Independent of P0-1; verifies under P0-1 |

### P1 — Essential (required for agreed V1 scope)

| ID | Deliverable | Dependencies | Acceptance criteria | Verification | Independence |
|---|---|---|---|---|---|
| **P1-4** | Commercial propose/approve UI on CommercialRulesScreen (tabs): propose (PREPARER), approve/reject (CONTROLLER), pending state | P0-2 | Governed flow completable from the portal alone; buttons gated by catalogue functions | Frontend tests + P0-1 integration | Depends on P0-2 |
| **P1-5** | Customer 360 PII tabs (addresses/contact-methods/identity-documents) in drawer, gated by `customer.view_*` (R8) | None | COMPLIANCE/SUPER_ADMIN see tabs; others 403-verified hide | Frontend tests + PII integration suite | Independent |
| **P1-6** | Deep-link Customer 360 → Compliance/Risk screens with customerId (R9) | None | No manual UUID entry for these flows | Frontend tests | Independent |
| **P1-7** | Ratify open decisions in writing: §23-9 (aggregator login), §25-1 (break resolver), §25-2 (reward accounting), V1-017 (ops reversal workflow), D-C-009/010 (aggregator/platform commission), D-C-014 (internal settle-later mechanism) | Product owner input | Each gets KEEP-IN-V1 / DEFER-V2 / build-scope decision recorded | Document review | Independent (non-engineering) |
| **P1-8** | Close the five standing wallet-route items (§E.6) — resolve or formally re-document each | P0-1 evidence | Each item resolved or ratified as-is | Integration evidence | Depends on P0-1 for evidence |

### P2 — Follow-up (does not block minimum usable V1)

| ID | Deliverable | Dependencies | Acceptance criteria | Verification | Independence |
|---|---|---|---|---|---|
| **P2-9** | Replace agent-mobile `PlaceholderScreen` routes with real destinations (or explicit "coming later" copy); enumerate affected tabs | None | No dead-end tabs in core agent flows | Mobile tests/manual | Independent |
| **P2-10** | Stale-document corrections: SCOPE-CH #59 claim; SPEC-01 "ten roles" header; IA label reconciliation (6 labels) | None | Docs match code | Review | Independent |
| **P2-11** | Support polish: ticket read status, help/FAQ surface | None | Non-blocking per A23 | Tests | Independent |
| **P2-12** | Documented FUTURE work (not V1): audit export, two-step KYC, per-agent granular permissions, push notifications, external settlement rails | V2 planning | — | — | — |

**Recommended order:** P0-1 (unblocks all evidence) in parallel with P0-2 and P0-3 (code work, independent of environment) → then P1-4 → P1-5/P1-6 → P1-7/P1-8 → P2.

---

## G. Definition of a usable V1 (objective acceptance checklist)

V1 can reasonably be declared usable when **all** of the following are demonstrated (each with recorded command output at the release commit, real PostgreSQL, isolated data):

1. **Evidence base:** `npm run test:pg` passes at the release commit (all 105 integration suites; no skips/mocks), plus `npm run test` (unit) and both builds green. *(P0-1)*
2. **Authentication:** workforce, customer, and agent login → session → authorized action → logout demonstrated for at least one role per principal type.
3. **Money movement, end to end, on real DB:** W2W (with PIN + idempotency + double-entry proof), agent cash-in, agent cash-out, cash-to-cash (incl. claim/expiry), customer funding (maker/checker), agent funding — each producing the documented DB state changes and audit rows.
4. **Commercial controls:** fee/commission/reward/product rule change requires two distinct actors (preparer + controller) with audit; single-actor change impossible (P0-2 acceptance test green). Limit assignment governed.
5. **Reconciliation & ledger:** 9-check report + trial balance run green on seeded data; journal reversal possible only through the two-actor privileged flow (P0-3); FINANCE_AUDITOR demonstrably cannot write.
6. **Servicing:** customer lifecycle + KYC decision + support ticket lifecycle completed from the portal; PII visible only to entitled roles (backend-enforced).
7. **Workforce governance:** role assign/revoke via maker-checker with self-approval impossible; SUPER_ADMIN cannot post/approve financial actions (per SPEC-01 §2).
8. **Compliance/risk:** compliance case (non-FRAUD) handled by COMPLIANCE; fraud case visible/actionable only by RISK_FRAUD — proven adversarially in backend.
9. **Notifications:** transactional SMS + inbox delivered for transfer/funding/ticket events (push not required).
10. **Scope hygiene:** every row in §B.7 confirmed excluded in writing (P1-7 decisions recorded), and every §B BLOCKED row is either promoted to WORKING or carries an accepted, dated exception signed by the product owner.

Until item 1 and item 4 are satisfied in particular, the product must not be described as a usable V1.

---

*End of audit. No code, schema, permission, navigation, or environment changes were made. This file is untracked/uncommitted in the working tree per instructions. Prior untracked files were preserved.*
