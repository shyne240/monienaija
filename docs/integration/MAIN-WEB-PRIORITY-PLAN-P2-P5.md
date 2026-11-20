# Main-Web Priority Plan P2–P5 — Commercial, Claiming, POS & Acceptance
**Branch** `arena/1f37a4f3-monienaija @ 1fb320c9` → `arena/5-main-web-audit` + `arena/5-main-web-integration @ 1fb320c9` · **App candidate** `e9e5651d` · 166 migrations
**Predecessor:** Reconciled inventory 8 sections / 33 routable (32+1) / 21-8-4-0 — accepted, not reorganized.
**Financial engine:** frozen — no `src/ledger|reconciliation|commercial-accounting|banking|transfer` change without demonstrated defect.

This document applies your P1–P5 to the reconciled inventory. Where it adds detail, the **master matrix remains source of truth for routable views**; this document is source of truth for **commercial priority, POS ownership and acceptance gates**.

---

## 1. Priority & dependency matrix (updated)

| Priority | Scope | Arena lead | Depends on | Parallel rule |
|---|---|---|---|---|
| **P1 — Customer & agent management** | Registration, onboarding, KYC (Tiers 1-3), customer management, agent applications, agent lifecycle, agent classes | **Arena 1** (customers 8 views) + **Arena 2** (agents 2 views) — continue existing work | None — start immediately | Do not rebuild completed features; preserve `customers`, `support`, `kycQueue/providers/tierPolicies`, `complianceCases`, `fraudCases`, `agents`, `agentClasses` at their current COMPLETE/PARTIAL status |
| **P2 — Class of service, fees, commissions, limits** | Auto-assigned KYC tier + class-of-service on onboarding; per-tx / daily / weekly / monthly amount+count limits; fees+VAT; commissions; pricing rules; approval/override — with KYC≠CoS and CoS never overrides KYC | **Arena 3** primary (commercial configuration) + **Arena 1/2** integrators (auto-assign on onboarding) | P1 for customer/agent IDs to test against; institution tier-limit policy from Arena 5 | Arena 3 may start now on catalogue/rules; integration slice (auto-assign) starts once Arena 1/2 have a test onboarding flow |
| **P3 — Account claiming & registration** | Flow A: web-registered → mobile OTP → BVN/NIN secure match → passcode/PIN → KYC completion → tier+CoS. Flow B: mobile-only registration → phone verify → identity → tier+CoS | **Arena 1** verifier (with Arena 5 auth/institution) | P2 for correct tier/CoS to assign | Both flows share `MobileAccountClaimService` — verify, do not rebuild; prevent duplicates/unauthorized claiming |
| **P4 — Automatic POS** | Supported agent/POS admin (outlets+terminalsCRUD via existing contracts); automatic provisioning deferred as blocked | **Arena 2** owner for supported scope; Arena 5 owns blocker escalation | P1 agent must exist | No new provider/hardware integration without product approval |
| **P5 — End-to-end acceptance** | 10 checklist items (§6) | **Arena 5** defines; each Arena proves its items; integration branch proves cross-arena | P2+P3+P4 | No declaration of P1 "complete" until P2 acceptance passes |

**Rule:** Do not declare P1 end-to-end complete before P2 acceptance proves automatic tier/CoS + limits + fees/commissions are live. P1 UI may be "visually complete" while P2 wiring is still open.

---

## 2. Verified current implementation status — classes, fees, commissions, limits

Audited `src/` contracts and `apps/admin-web/src/services/*` against P2's nine requirements. "Implemented" means backend + frontend contract + at least one exercised flow exist; "partial" means definition exists but wiring/assignment/enforcement is incomplete.

### 2.1 KYC tier vs class-of-service — distinctness verified

| Concern | Current | Status |
|---|---|---|
| **KYC tier** | `customers.kyc_level ∈ {LEVEL_1,LEVEL_2,LEVEL_3}` + `kyc_status ∈ {APPROVED,…}`; decided by `KycTierPolicyService` (regulatory + operator requirements per tier) and evaluated by `CustomerFinancialEligibilityService.require()` via `KycTierEvidenceReader` + `CustomerFinancialEligibilityService`. Tiers are institution-scoped via `InstitutionKycLimitPolicyService` mappings `product|currency|serviceClass|tier → profileCode`. | **Implemented** |
| **Agent class-of-service** | `AgentClass` entity (`code`, `applicable_services`, `deleted_at`) + `agents.agent_class_id`; managed via `internal/agents/classes` (Arena 2 — `AgentClassesScreen` + `AgentClassAssignmentPanel`). | **Implemented** |
| **Customer class-of-service** | No separate customer CoS entity — customer "service entitlement" is the combination of KYC tier + `LimitProfile.kind=CUSTOMER` + `CustomerProductEnrollment` + `CustomerOperatingPermission`. | **By design (distinct)** — customer CoS is not a copy of agent class; this is intentional. Documented: KYC tier and class-of-service must remain distinct; commercial class never overrides KYC. |
| **Invariant: CoS never overrides KYC** | Enforced by `CustomerFinancialEligibilityService` + `LimitEnforcementService.requireKycTierPolicy=true` path: `require()` rejects if `kyc_status≠APPROVED` or tier insufficient; tier-bound limit enforcement throws `ServiceUnavailable` if policy missing and `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=true` (production fails closed). | **Implemented** — caveat: tier-bound enforcement is flag-gated (see §7 decision 1). |

### 2.2 Limits — all window dimensions implemented; auto-assignment partial

| Requirement | Backend | Frontend | Status |
|---|---|---|---|
| **Per-transaction limits** | `LimitRule.dimension ∈ {MIN_AMOUNT_PER_TX, MAX_AMOUNT_PER_TX}` — `LimitEngine` + `LimitEnforcementService` enforce inside SERIALIZABLE transaction with `LimitUsage` reservations. | `limitAssignments` (Arena 1) + `limitCatalogue` (Arena 3) manage profiles/rules/assignments; `LimitDiagnosticsService` exposes explainability. | **Implemented** |
| **Daily cumulative (amount & count)** | Dimensions `DAILY_AMOUNT`, `DAILY_COUNT` + `limit-usage` window util with per-dimension windows. | Same catalogue. | **Implemented** |
| **Weekly cumulative** | Dimensions `WEEKLY_AMOUNT`, `WEEKLY_COUNT` | Same catalogue. | **Implemented** |
| **Monthly cumulative** | Dimensions `MONTHLY_AMOUNT`, `MONTHLY_COUNT` | Same catalogue. | **Implemented** |
| **Yearly + wallet balance** | `YEARLY_*`, `WALLET_BALANCE_MAX` also present. | Same catalogue. | **Implemented (extra)** |
| **Automatic assignment on onboarding** | `LimitProfileResolverService.resolve()` supports `GLOBAL | SEGMENT | AGENT_CLASS | CUSTOMER | AGENT` with precedence; `LimitAssignment` has `subjectType/subjectId`. **No automatic row created on customer/agent creation** — assignments are manual via `POST /internal/.../limit-assignments`. | **Partial — assignment wiring** |
| **Tier→profile binding** | `InstitutionKycLimitPolicyService` → `institution_kyc_limit_policy_versions` maps `product|currency|serviceClass|tier → profileCode` with `profileDigest` binding. Approved via `limit.modify` + `FINANCE_PREPARER/CONTROLLER` maker/checker. | Institution workspace (Arena 5) views versions/proposals; not a limit catalogue editor. | **Implemented** (policy); **Partial** (no auto-apply to new customer — needs integration). |
| **Concurrent enforcement** | `LimitEnforcementService.enforceWithManager()` runs inside the financial SERIALIZABLE txn; `LimitUsageService` reserves with idempotency + recovery (`LimitReservationRecoveryService`). | N/A — backend guarantee. | **Implemented** |

### 2.3 Fees, taxes, commissions, pricing rules

| Requirement | Backend | Frontend | Status |
|---|---|---|---|
| **Fee definition** | `fee_rules` table (`product_code+currency+effective_from` unique, `flat_fee_minor`, `percentage_bps`, `minimum/maximum_fee_minor`, `vat_bps`) via `FeeRuleRegistryService` + `POST/GET/PATCH /internal/fee-rules`. | `CommercialRulesScreen` fees tab (Arena 3) + `BankingTransferPricingController` preview. | **Implemented (definition)** |
| **Fee calculation** | `FeeEngine.calculate()` → `flat + amount*bps/BPS` clamped to min/max + VAT; consumed by `FeeRuleResolverService → FeeRuleCalculatorService` inside the 7 wired financial flows (transfer, funding, etc.) via `CommercialDecision` snapshot. | Preview calculates; journals remain principal-only until `FEE-REVENUE` account family provisioned — "calculated-but-not-collected". | **Partial — calculation wired, collection deferred** (see capability registry 1762). No production fee charged yet — zero rules or unprovisioned accounts; this is expected, not a bug. |
| **Taxes (VAT)** | `vat_bps` on `FeeRuleDefinition`; `FeeEngine` adds `vatMinor = feeMinor * vatBps / BPS`. | Same as fees. | **Implemented** definition-wise; same collection caveat. |
| **Commissions** | `commission_rules` via `CommissionRuleRegistryService` + `CommissionRuleResolverService`; dimensions `calculationModel/basis`, `recipientType`, `tiers`, `agentClassId/agentId/aggregatorId` scoped. | `CommercialRulesScreen` commissions tab (Arena 3). | **Partial — same pattern as fees**: machinery wired into 6 snapshot sites (not C2C claim initiation) with `payable=false`, `FEE base calculated-but-not-collected`, no `COMMISSION-EXPENSE/PAYABLE` journals until policy + account family approved (capability registry 2223). |
| **Pricing rules** | `product-governance` + `CommercialRuleGovernanceService` (maker/checker `FINANCE_PREPARER→CONTROLLER`, self-approval blocked) governs fee/commission/commercial changes; `product-catalog` + `limit-catalog` provide catalogue. | `CommercialRulesScreen` all tabs (Arena 3). | **Implemented (governance)**; rewards/products tabs PLACEHOLDER (P3 deferred) intentionally. |
| **Approval & override** | `CommercialRuleGovernanceService` + `PrivilegedActionApprovalService` + `GovernedActionRegistry` enforce maker≠checker, MFA, role gates; `limit-operations` + `assignment` updates are version-checked. | `approvalsInbox` (Arena 4) is sink for all arenas. | **Implemented** |

### 2.4 Summary verdict for §2

**Implemented:** KYC tiers, agent classes, all limit window dimensions, fee/commission/VAT definitions, governance/maker-checker, concurrent enforcement.
**Partial:** automatic tier/CoS assignment on onboarding, fee/commission *collection* (calculation wired, journals still principal-only — blocked on production rule approval + account family provisioning, not code).
**Distinctness:** KYC tier ≠ class-of-service holds; CoS never overrides KYC by construction.
**No rebuild needed** — preserve existing `fee_rules`, `commission_rules`, `limit_profiles/rules/assignments`, `InstitutionKycLimitPolicy` contracts.

---

## 3. Arena 3 scope — commercial configuration (primary)

Arena 3 owns commercial configuration end-to-end, but does **not** own onboarding flows.

**Primary views (12, see master matrix):** `transfers`, `cashIn`/`cashOut` (aliases), `cashToCashOps`, `ledgerExplorer`, `reconciliation`, `bankingOperations`, `feeRules`, `commissionRules`, `rewardRules` (placeholder P3), `productCatalogue` (placeholder P3), `limitCatalogue`.

**Primary files:** `TransactionObservabilityScreen`, `CashToCashOperationsScreen`, `LedgerOperationsScreen`, `ReconciliationObservabilityScreen`, `BankingOperationsScreen`, `CommercialRulesScreen` (6 tabs) + `banking-admin-api.ts`.

**Backend modules owned (frontend-first; backend only on demonstrated defect):**
`limit-catalog` (profiles/rules/catalogue), `limit` (engine), `fee`/`fee-rules` (rules + calculator), `commission` (rules + resolver), `reward`/`product-catalog` (deferred), `product-governance` + `CommercialRuleGovernanceService`, `institutionKycLimitPolicyService` (read; Arena 5 approves), `reconciliation` (runs/exceptions), `ledger` (explorer; reversal draft+proposal only).

**Must deliver:**
1. `limitCatalogue` is not just browsable — each `limitProfileCode` has a usable rule set covering the 9 required dimensions (per-tx / daily/weekly/monthly amount+count) for at least one NGN product, or a governed-notice explaining which institution/product is not yet configured.
2. `feeRules` and `commissionRules` have at least one **approved** example rule (or a clearly labeled "zero production rules" notice with the exact provisioning blocker — fee-revenue / commission-payable account families + policy approval — so reviewers are not misled into thinking fees are silently charged).
3. Institution KYC-tier→profile bindings are viewable (Arena 5 workspace) and their `profileDigest` is respected — a legacy generic limit edit invalidates the binding until re-approved.
4. No new limit assignment UI — assignments are Arena 1/2's job; Arena 3 proves the catalogue they assign from.

**Must not:** create customer or agent, assign limits to a specific customer/agent, rebuild KYC tier logic, move money, or invent a global reports hub.

---

## 4. Integration responsibilities — Arenas 1 & 2 (exact)

Arena 3 configures the catalogue; Arenas 1 & 2 ensure **every new account automatically receives valid assignments**.

### Arena 1 — customer onboarding integration

**Views:** `customers` (directory + registration wizard), `kycQueue`, `kycProviders`, `kycTierPolicies`, `complianceCases`, `fraudCases`, `limitAssignments`.
**Integration tasks (not a rebuild):**
1. After `completeRegistration` succeeds (when unblocked — currently `ServiceUnavailable` stub — see §7 decision 2), ensure the new `customerId` is immediately resolvable via `LimitProfileResolverService.resolve(CUSTOMER, customerId)` — i.e. a `GLOBAL` or `CUSTOMER` `LimitAssignment` exists and points to an `ACTIVE` profile. Until auto-creation is approved, this is achieved by verifying a pre-existing `GLOBAL` NGN profile covers new customers; if none exists, surface a diagnostics warning via `LimitDiagnosticsService` rather than silently leaving the account unlimited.
2. On KYC tier upgrade (`LEVEL_1→2→3` via `KycTierTransitionService` + `CustomerFinancialEligibilityService`), confirm `InstitutionKycLimitPolicy` mappings for that tier are present; if missing, the account keeps its existing tier's limits and the upgrade is flagged for ops — never auto-escalate limits without an approved policy.
3. Keep `fraudCases`/`complianceCases` read-only for this slice — no new financial logic.

**Files that may be touched:** `CustomerRegistrationWizard`, `Customer360Workspace`, `CustomerTier3ReadinessPanel`, `LimitAssignmentScreen` (assignment creation only), `kyc-governance-api.ts`. **Never:** `CommercialRulesScreen`, `LimitCatalog` rule editor, `AgentNetworkScreen`.

### Arena 2 — agent onboarding integration

**Views:** `agents`, `agentClasses`.
**Integration tasks:**
1. After `AgentApplicationService` approves an application and `AgentLifecycle` activates the agent with an `agentClassId`, ensure `LimitProfileResolverService.resolve(AGENT, agentId, agentClassId)` returns a profile — via a pre-existing `AGENT_CLASS` or `GLOBAL` assignment. Same diagnostics fallback as Arena 1 if missing.
2. Agent class capability changes (`applicable_services`) must not widen transaction permissions beyond the agent's KYC/regulatory tier — class is service scope, not a KYC override.
3. Supported POS admin (outlets+terminals) continues under this Arena — see §5.

**Files that may be touched:** `AgentNetworkScreen`, `AgentClassesScreen`, `AgentClassAssignmentPanel`, `AgentFundingPanel`, `ordinary-agent-admin-api.ts`. **Never:** `CommercialRulesScreen`, `LimitAssignmentScreen` beyond read.

**Shared rule:** Neither Arena creates a new `LimitProfile` or `FeeRule` — they assign from the catalogue Arena 3 governs. All assignments go through `PrivilegedActionApprovalService` if the backend marks them as protected (maker≠checker).

---

## 5. Automatic POS — ownership clarification

Reconciliation previously listed automatic POS/terminal provisioning as "8th uncovered capability — not assigned." That was underspecified. Resolved:

### What Arena 2 can implement without conflict (use existing contracts)

| Capability | Backend contract (exists, used) | Admin implementation |
|---|---|---|
| **Agent outlets CRUD** | `POST /internal/agents/:id/outlets`, `POST /internal/aggregators/:agg/agents/:id/outlets`, `GET /internal/agents/:id/outlets`, lifecycle `suspend/reactivate/terminate` via `OutletService` | `AgentNetworkScreen` outlet section — already partially present; harden to full CRUD with approval |
| **Terminals CRUD** | `POST /internal/outlets/:id/terminals`, `POST /internal/agents/:id/terminals`, `GET .../terminals`, lifecycle via `TerminalService` | Same screen — terminal section |
| **Public agent locator** | `GET /public/agents` via `PublicAgentLocatorController` | Read-only ops view (optional) |
| **Permissions** | `agent.manage_outlets_terminals` (workforce function) via `OutletController.requireManage` | Respect guard — same as existing agent network |

All of the above are **within Arena 2's existing file ownership** — no new shared file, no conflict with Arenas 1/3/4.

### What is missing (exact blockers — approval required before new integration)

| Blocker | Why blocked | Approval needed |
|---|---|---|
| **Provider auto-provisioning** (hardware serial → automatic terminal record creation, e.g. POS vendor API callback) | No provider adapter exists in `src/` — only manual `reference/code/label/serialNumber` creation via internal workforce routes. Would require a new `partner` adapter or vendor webhook authenticated via `partner-callback-authentication.service`. | **Product + security** — new external integration, credential storage (`PartnerCredentialsService`), data-minimization (`external-data-minimization`) |
| **Hardware telemetry / health** | No telemetry ingestion; `AgentTerminal.status` is only `ACTIVE|SUSPENDED|TERMINATED` — no heartbeat, no firmware version. | Product — scope expansion |
| **Terminal ↔ wallet funding linkage** | Terminal does not auto-fund; funding is via `AgentFundingService` + `BankingProvider` — correct separation, not a blocker. | None — out of scope |
| **Outlet geofencing / proof-of-presence** | No geofence service — `proof-of-address` exists for customers only. | Product — if required |

**Decision:** Arena 2's supported agent/POS administration is **outlets + terminals CRUD via existing internal contracts** (above). Do not silently defer automatic POS as unrelated future product — instead:
- Arena 2 implements the supported scope.
- Automatic provisioning remains explicitly blocked above; Arena 5 will request product approval before introducing any vendor callback, credential, or telemetry integration.

**File ownership:** `apps/admin-web/src/screens/authenticated/AgentNetworkScreen.tsx` and its outlet/terminal subcomponents stay **Arena 2 only**. No other Arena edits them.

---

## 6. End-to-end acceptance checklist — P5 (10 items)

Proof is recorded against the **integration branch** `arena/5-main-web-integration`. Each item requires a backend log or API transcript + an admin-web screenshot or test — not just a unit test.

| # | Requirement | Provenance (how to prove) | Arena to prove |
|---|---|---|---|
| 1 | **Customer registration assigns correct tier + class** | Fresh `completeRegistration` (once unblocked) → `customers.kyc_level` + `LimitProfileResolver.resolve(CUSTOMER)` + `InstitutionKycLimitPolicy` mapping present for that tier/product; no manual step after registration. | 1 (with 3 catalogue + 5 policy) |
| 2 | **Agent onboarding assigns correct class + capabilities** | Approved `agentApplications → agent` with `agentClassId` → `resolve(AGENT, agentId, classId)` + `AgentClass.applicable_services` contains expected services; funding/defunding capability follows class. | 2 (with 3) |
| 3 | **Account claiming works securely** | Flow A: web-registered `PHONE` `normalized_value` → mobile `MobileAccountClaimService.match` (BVN/NIN HMAC with `KYC_OWNERSHIP_KEY`, consent provenance, `FOR UPDATE` lock) → `setup` (passcode+PIN, `hashMobileSecret`, `consumed_at`) → login via `MobileOnboardingAuthService`. Duplicate/unauthorized attempts return `CONFLICT`/`PENDING`/`LOCKED`, never reveal existence. Flow B: new phone → `requestOtp` → `verifyRegistrationOtp` → `completeRegistration` → same tier/CoS. | 1 (with 5 auth) |
| 4 | **Tier upgrades update eligibility + limits** | `KycTierTransitionService` → `customers.kyc_level` bump → `CustomerFinancialEligibilityService.require()` re-evaluated → `InstitutionKycLimitPolicy` new `profileDigest` bound; `LimitEnforcementService` uses new profile within same SERIALIZABLE boundary. | 1 + 3 |
| 5 | **Fees/commissions from active approved rules** | Create `fee_rules` + `commission_rules` via `CommercialRuleGovernanceService` (FINANCE_PREPARER→CONTROLLER, version-checked) → execute a financial flow → `CommercialDecision` snapshot records `ruleId+ruleVersion` + `FeeRuleResolverService` evidence; journal still principal-only until fee/commission account families provisioned (documented). | 3 |
| 6 | **Per-tx / daily / weekly / monthly limits enforced** | One limit profile with all required dimensions → execute transactions crossing each threshold → `LimitEnforcementService.enforceWithManager` rejects with correct `LimitFailureCode` (`SINGLE_TRANSACTION_LIMIT_EXCEEDED`, `DAILY_LIMIT_EXCEEDED`, `MONTHLY_LIMIT_EXCEEDED`, etc.). | 3 (config) + 1/2 (subjects) |
| 7 | **Concurrent transactions cannot bypass limits** | N concurrent `enforceWithManager` calls inside SERIALIZABLE txns against the same daily/weekly/monthly window → only up to limit succeeds, rest fail deterministically; `LimitUsage` reservations + `LimitReservationRecoveryService` demonstrated. | 3 (with banking/transfer) |
| 8 | **Unauthorized overrides & maker self-approval rejected** | Maker (= `FINANCE_PREPARER`) creates fee/commission/limit/tier-policy proposal → self-approval returns 403 `FUNCTION_MISSING` or `Blocked: maker and checker must be different`; role without `limit.modify`/`fee_rule.modify` cannot propose; revoked MFA cannot approve. | 4 (approvalsInbox) + 3 |
| 9 | **Failed/reversed/retried handled per financial rules** | Failed txn → no wallet mutation; reversed → `A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT` suspense assignment (no automatic source repair), immutable ledger history preserved; retried → `idempotencyKey` + `requestHash` → replay returns same journal, no double debit. | 3 + 5 (operations) |
| 10 | **Existing accounts with missing assignments identified + safely handled** | Query: customers/agents with no matching `LimitAssignment` or disabled profile → `LimitDiagnosticsService` reports; `LimitEnforcementService.resolveTierEnforcement` behaviour documented: `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=false` in non-prod → `LEGACY_UNENFORCED` (permissive but reported), in prod → throw (fail closed); no silent unlimited. | 3 (diagnostics) + 5 |

Each item maps to an existing or planned `__tests__/*.test.ts` — new `p2-commercial-*` and `p5-e2e-*` suites must cover §6.

---

## 7. Product decisions requiring approval (before major architectural changes)

Arena 5 will not make these changes without your explicit approval. Requested decisions:

| # | Decision | Options | Arena 5 recommendation |
|---|---|---|---|
| 1 | **Flag `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED`** | A: Enable in production now (fail closed on missing tier policy — safest but may block existing flows until policies backfilled). B: Enable in non-prod only for acceptance, keep prod permissive until backfill complete. C: Keep disabled everywhere (legacy permissive). | **B** — prove enforcement in integration branch with flag ON; keep prod permissive until backfill + P5.10 run shows zero unassigned critical products. |
| 2 | **Unblock `completeRegistration`** | Currently `ServiceUnavailable` stub. Options: A: Restore workforce-completed path (operator creates via admin). B: Unblock self-service OTP→customer path (requires full registration + wallet provisioning audit). | **A for now** — self-service path needs product+security review of `CustomerRegistrationService` OTP + wallet creation; keep workforce path for P2 acceptance. |
| 3 | **Auto-create default assignments on onboarding** | Currently manual `LimitAssignment`. Options: A: Auto-create `GLOBAL` NGN profile assignment on first customer/agent if none exists. B: Require manual assignment (current) and treat missing as diagnostic. | **B for now** — auto-creation risks `GLOBAL` silently overriding intended segment/class policies; add diagnostics first, auto-create only if P5.10 shows chronic missing. |
| 4 | **Automatic POS provider integration** | Blockers in §5: vendor callback, credentials, telemetry. | **Defer with explicit backlog** — Arena 2 implements supported outlets/terminals CRUD; provider auto-provisioning goes to product backlog with estimated scope (new `partner` adapter + `PartnerCredentialsService` + audit). Do not silently drop. |
| 5 | **Fee/commission collection** | `FeeRuleResolver` evidence-only today; collection blocked on fee-revenue / commission-payable account families. | **Keep evidence-only** until finance ops approves chart-of-accounts + provisioning; acceptance item 5 proves calculation, not collection — document the blocker in `CommercialRulesScreen` notice. |
| 6 | **Reward/product catalogue timing** | Currently PLACEHOLDER P3. | **Keep deferred** — no work in this phase; keep governed-notice; do not invent pricing. |

No navigation reorganization, no financial-engine change, no merge to `main` or deploy is proposed in this document.

---

## 8. What changes now

- **Master matrix** stays source of truth for 33 views — priority P1–P3 is an overlay, not a reroute. Add a priority tag per view (P1=onboarding, P2=commercial) in next matrix revision — not now, to avoid interrupting Arena 1/2 PRs.
- **Arena 3** starts commercial catalogue/rules (§3) immediately; its integration slice (auto-assign) waits only for an Arenas 1/2 test onboarding to verify against.
- **Arenas 1 & 2** continue uninterrupted; their only added obligation is the integration verification in §4 (diagnostics check, not a rebuild).
- **Arena 4** is unaffected except its `approvalsInbox` must handle tier-limit policy + fee/commission proposals from Arena 3 (already in scope).

Awaiting your approval on §7 before any architectural change.
