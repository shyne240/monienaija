# Commercial Implementation Coordination — Customer & Agent Configurable System
**Repository** `shyne240/monienaija` · **Integration branch** `arena/5-main-web-integration @ 380fbcdf` · **App candidate** `e9e5651d` · 166 migrations
**Source:** Arena 3 audit `03285516` (`arena/defdd0fd-monienaija` audited `6816a760`) — read-only, no code changed there. This document implements the product approval on top of the reconciled inventory (8 sections / 33 routable / 21-8-4-0) and the gates doc (`IMPLEMENTATION-GATES-AND-DECISION-REGISTER.md`).
**Financial engine:** frozen — no `src/ledger|reconciliation|commercial-accounting|banking|transfer` change without demonstrated defect + authorization. The §6 fix is such a defect.

---

## 1. What the audit confirms — and what it means for ownership

The stack is genuinely built bottom-up: 11 limit dimensions live-enforced in 8+ financial paths; KYC tier engine (two-layer regulatory+operator, verified-provider provenance, re-evaluation worker, `CustomerFinancialEligibilityService.require()`); institution tier→profile mapping with digest; fee registry+resolver+calculator (flat/percentage/combined + min/max clamps + vat bps, effective-dated, priority, `AMBIGUOUS` fail-closed) wired to 4 flows; commission engine (7 models, 3 recipient types, marginal tiers, agent/class/aggregator targeting) wired to 6 flows evidence-only; reward engine defined but **intentionally unwired**; decision snapshots; commercial accounting posting behind `COMMERCIAL_ACCOUNTING_ENABLED=false`; maker/checker for fee/commission/reward/product (FINANCE_PREPARER→CONTROLLER).

**Consequences in this document:**
- Nothing is rebuilt — all work is **activation, governance and wiring**.
- `products` (7 seeded V1 codes) is authoritative catalogue identity — not invented.
- Customer classes truly do not exist (no entity/table/service/route/migration) — §3 creates them.
- Limits already support yearly + wallet-balance-max — preserved per decision 5.
- Fee pricing today has **no customer/class/institution dimension** — §3 adds it as F3 (optional nullable targeting, approved only).
- Rewards stay engine-only until funded — not a launch dependency for class/limits/fees.

---

## 2. Ownership matrix — exact modules, screens, shared interfaces

Every routable view already has a single primary Arena. This table extends that ownership to **commercial backend + governance** so no Arena edits another's file without authorization.

| Area | Backend modules (exact) | Frontend screens / services (exact) | Shared interfaces (typed, Arena 5 owned) | Primary Arena | Collaborators |
|---|---|---|---|---|---|
| **Customer registration & claiming** | `customer-registration` (`CustomerRegistrationService`, `MobileAccountClaimService`, `MobileOnboardingAuthService`, `kyc-registration-session*`), `customer` (entity `kyc_level/kyc_status/is_synthetic`), `customer-contact-method` | `CustomerDirectoryScreen`, `CustomerRegistrationWizard`, `Customer360Workspace`, `CustomerPersonalInformationPanel`, `CustomerProofOfAddressPanel`, `CustomerTier3ReadinessPanel` | `POST /customers/registration-sessions/*`, `POST /customers/me/kyc/*`, `POST /mobile/onboarding/*` (claim/match/setup/login), `WalletFinancialBoundaryService.requireCustomerWallet()` | **Arena 1** | Arena 5 (auth/institution) |
| **Customer classes (new)** | `customer-class` *(new, §3.1)* — `customer_classes`, `customer_class_assignments` + audit/version — mirrors `agent_classes` | `CustomerClassesScreen` *(new, alongside `AgentClassesScreen`)* + `CustomerClassAssignmentPanel` | `internal/customer-classes` CRUD + `internal/customers/:id/class` assign (Arena 5 approved addition — see §3.2) | **Arena 1** | Arena 3 (commercial integration), Arena 5 (approval) |
| **KYC tiers & eligibility** | `kyc-verification` (`KycTierPolicyService`, `KycTierDecision`, `KycTierEvidenceReader`, `CustomerFinancialEligibilityService.require()`, `kyc-tier-worker`, `kyc-tier-transition`, `kyc_identity_claims/attempts/consents/conflicts/holds`) | `KycProviderManagementScreen`, `KycTierPolicyManagementScreen`, `ComplianceScreen(mode=kyc)`, `RiskFraudScreen` | `GET/POST /internal/kyc/tier-policies/proposals/*`, `GET /internal/kyc/tier-reviews`, `GET /customers/me/kyc` | **Arena 1** | Arena 4 (approval viewing), Arena 5 (institution mapping) |
| **Customer restrictions & permissions (security fix)** | `customer-eligibility` (`CustomerRestriction` types `FROZEN/BLACKLISTED/LIMITED/MANUAL_REVIEW`, `CustomerOperatingPermission` 11 types, `getOperatingStatus()→canOperate`, `operatingStatus()`) — **now enforced at admission per §6** | `Customer360Workspace` restrictions tab (read-only), `AuditTrailScreen` | `POST/GET /customers/:id/restriction`, `POST/GET /customers/:id/permissions`, `GET /customers/:id/operating-status` → **`canOperate`** | **Arena 1** (admin) + **Arena 5** (enforcement fix) | All financial paths |
| **Agent classes & lifecycle** | `agent` (`AgentClass`, `AgentLifecycleService.transition`, `AgentApplicationService`), `agent-authentication`, `agent-application-*`, `aggregator` | `AgentNetworkScreen`, `AgentClassesScreen`, `AgentClassAssignmentPanel`, `AgentFundingPanel`, `AgentCredentialPanel`, `AgentUnifiedHistoryPanel` | `POST /internal/agents/applications/:id/review`, `POST /internal/admin/agents/:id/*` (lifecycle+credentials), `POST /internal/agents/classes` | **Arena 2** | Arena 5 (institution affiliation read) |
| **Agent eligibility & POS** | `outlet` (`OutletService`, `TerminalService`, `AgentOutlet`, `AgentTerminal`, `PublicAgentLocatorController`), `agent-funding` | Same `AgentNetworkScreen` outlet/terminal section | `POST/GET /internal/agents/:id/outlets`, `POST /internal/outlets/:id/terminals`, lifecycle `suspend/reactivate/terminate` (workforce `agent.manage_outlets_terminals`) | **Arena 2** | — |
| **Limits catalogue + governed mutations** | `limit-catalog` (`LimitProfile`, `LimitRule(11 dims)`, `LimitAssignment` 5 scopes, `LimitUsage`/`LimitReservation`, `LimitEnforcementService`, `LimitProfileResolverService`, `LimitDiagnosticsService`, `LimitReservationRecoveryService`, `CustomerLimitViewService`), `limit` engine, `limit-catalog/institution-kyc-limit-policy.service` | `CommercialRulesScreen` limits tab (catalogue), `LimitCatalogue` view, `LimitAssignmentScreen` (Arena 1); **Arena 4** inbox for governance when F4 approved | `GET/POST/PATCH /internal/limit-profiles`, `/limit-rules`, `/limit-assignments`, `GET /internal/limit-diagnostics`, `GET /internal/institutions/:id/kyc-tier-limit-policy` | **Arena 3** (catalogue) | Arena 1 (customer assignments), Arena 2 (agent assignments), Arena 5 (institution policy) |
| **Fees & pricing (VAT)** | `fee-rules` (`FeeRuleDefinition` + `FeeRuleResolverService` + `FeeRuleCalculatorService`), `fee` legacy engine (diagnostic `POST /fees/calculate`), `commercial-accounting` (FEE_REVENUE/VAT_PAYABLE families) | `CommercialRulesScreen` fees tab + preview via `BankingTransferPricingController` + `GET /internal/fee-rules` | `GET/POST/PATCH /internal/fee-rules` (governed), `GET /internal/fee-rules/resolve?productCode=&currency=&at=` preview | **Arena 3** | Arena 5 (accounting families) |
| **Commissions** | `commission` (recipient AGENT/AGGREGATOR/PLATFORM, bases, 7 models, targeting), commission resolver+engine, `commercial-accounting` (COMMISSION_EXPENSE/PAYABLE) | `CommercialRulesScreen` commissions tab | `GET/POST/PATCH /internal/commission-rules` (governed) | **Arena 3** | — |
| **Cashback / rewards** | `reward` (`RewardRuleDefinition`, `RewardEngine`) — **unwired**, preserved per decision 8; `policy/b1-campaign-engine` does not execute cashback | `CommercialRulesScreen` rewards tab (PLACEHOLDER → governed-notice) | `GET/POST/PATCH /internal/reward-rules` (governed, rule-store only) | **Arena 3** (rules + integration contracts only; no wiring until funded — §7) | — |
| **Governance + audit** | `authorization` (`governed-action.registry`, `CommercialRuleGovernanceService`, `PrivilegedActionApprovalService` — approval list currently missing, §4.1), `operations` (audit), `institution` wallet attribution | `ApprovalsScreen` (FINANCE_PREPARER→CONTROLLER, MFA, self-approval blocked), `AuditTrailScreen`, `SystemHealthScreen` + diagnostics | `POST /internal/product-governance/proposals/:id/approve|reject`, approval discovery (new F1), audit list | **Arena 4** | All (producers) |
| **Institution policy** | `institution` (lifecycle, affiliation, enrolment, ledger accounts), `limit-catalog/institution-kyc-limit-policy.service` | `InstitutionDirectoryScreen`, `InstitutionWorkspaceScreen`, `InstitutionRelationshipTabs` | `GET/POST /internal/institutions/:id/kyc-tier-limit-policy/*` | **Arena 5** | Arenas 1-3 (read) |

**Overlap resolution (before any Arena modifies shared code):**
- `CustomerLimitType` + `customer_limit_profiles` (`customer-eligibility`) is a **legacy model** never read by enforcement — Arenas may read it but never write to it as if it were `limit_rules`.
- `institution-admin-api.ts` + `CountrySelect.tsx` + `Layout.tsx`/`navigation-access.ts`/`api-client.ts`/`auth-store.ts` stay Arena 5 — consumers read via typed `GET`.
- `CustomerClassesScreen` is a **new file** owned Arena 1; limit catalogue stays Arena 3 — no shared file.
- `FROZEN` enforcement (§6) touches frozen `CustomerFinancialEligibilityService` only via the minimal authorized defect fix — not a financial-engine change elsewhere.

---

## 3. Customer-class model — authorized with scope limits

### 3.1 Model (Arena 1 owns, Arena 5 approves, Arena 3 integrates)

Approved Standard / Premium / Business + administrator-defined classes as **first-class customer classes of service**, kept **separate from KYC tier** per decision 1.

**New entity** (proposed — one governed change, not a rebuild):

```
customer_classes                          customer_class_assignments
  id uuid PK                                id uuid PK
  code varchar(80) UNIQUE soft-delete         customer_id uuid FK customers
  name, description                           class_id uuid FK customer_classes
  kind = 'CUSTOMER' (vs AGENT kind)           effective_from timestamptz
  status ACTIVE|DISABLED|DEPRECATED             effective_to timestamptz nullable
  enabled bool, configuration_status            is_active bool, precedence int
  created_by/updated_by, version, audit         created_by, version, audit
  deleted_at                                    deleted_at
```

Conventions mirror `AgentClass`/`LimitAssignment`: `code ~ ^[A-Z0-9_]{3,80}$`, `kind IN (CUSTOMER)`, version-checked `PATCH`, maker `CUSTOMER_SERVICE|AGENT_NETWORK_MANAGER` + checker where governed. No new KYC column on `customers` — class is assigned, not a customer column.

**Authorization:** Arena 1's necessary registration backend work is explicitly authorized: un-stubbing `CustomerRegistrationService.completeRegistration()` to delegate via `KycRegistrationSessionService → CustomerService.create → WalletService provision` using existing `KYC_OWNERSHIP_KEY` HMAC identity matching, consent provenance, OTP protections, duplicate detection, `is_synthetic` guard — all preserved per P3 plan (`IMPLEMENTATION-GATES-AND-DECISION-REGISTER.md §3`). This is the only registration-backend change Arena 1 is authorized to make without further gates.

### 3.2 Routing & limits wiring

- **Route:** `POST/GET /internal/customer-classes` (list/create) + `GET/PATCH /internal/customer-classes/:id` + `POST /internal/customers/:id/class` (assign with `effective_from`, `expected_version`) — all via `CommercialRuleGovernanceService` where fee-linked, else direct `limit.modify` with `FINANCE_PREPARER→CONTROLLER` when F4 (limit maker/checker) is later approved.
- **Limit integration:** `LimitAssignment.subject_type='SEGMENT'` becomes reachable — callers pass `segmentCodes=[class.code]` (today zero callers, §5.5). `LimitProfile.kind=CUSTOMER` profiles keyed to class-specific rules via segment assignment without touching financial transactions yet.

### 3.3 Commercial integration (Arena 3, only if class pricing approved — §7 F2/F3)

`fee_rules` with optional nullable `customer_class_id` / `institution_id` targeting (at-most-one, like `commission_rules` targeting) + resolver precedence (`CUSTOMER`-specific → `AGENT_CLASS` → `SEGMENT` → `GLOBAL`) with preserved `AMBIGUOUS` fail-closed on equal top priority. This is the only fee-schema change proposed; **no fee is charged** until §8 conditions met.

---

## 4. Cross-Arena integration contracts — class, tier, limits, fees, taxes, commissions, rewards

All contracts are additive to existing resolver contracts, never a rewrite of engines. Each exposes `ruleVersion/digest` for evidence.

| Contract | Request | Response | Guarantee |
|---|---|---|---|
| **KYC tier + eligibility** | `customerId` inside SERIALIZABLE txn via `CustomerFinancialEligibilityService.require(manager, customerId)` | `LEVEL_1|LEVEL_2|LEVEL_3` or throws `409 Customer is not eligible` / `503 policy unavailable` + evidence `kyc_level, kyc_status, is_synthetic, identity_revision, kyc_tier_manual_holds, kyc_identity_conflicts, customer_contact_methods verified_at, kyc_customer_identity_revisions, kyc_identity_claims identifier_mac HMAC` | KYC ceiling always checked first; never bypassed by commercial config (§5 tier binding) |
| **Customer class** | `customerId` → `GET /internal/customers/:id/class` | `{ classCode, assignmentId, effectiveFrom, version }` or `null` (no class) | Deterministic, versioned, audited |
| **Tier→limit profile (institution)** | `institutionId, product, currency, serviceClass, tier` → `InstitutionKycLimitPolicyService.effectiveTierLimitMapping()` | `{ profileCode, profileDigest=sha256(canonical profileCode+rules at effectiveFrom), mappingVersion, effectiveFrom }` | Digest invalidates if generic limit edit changes profile — admission fails until re-approved |
| **Limit enforcement** | `principalType, principalId, agentClassId, segmentCodes=[customerClassCode], product, currency, direction, channel, amountMinor` → `LimitEnforcementService.enforceWithManager(requireConfiguration=true, requireKycTierPolicy=flag, segmentCodes)` | `{ allowed, limitProfileCode, evaluatedDimensions, reservationIds, usageIds, ruleRefs: [{ruleId, dimension, limitValueMinor}] }` or `LimitFailureCode.*` (incl. `CUSTOMER_FROZEN`, `MISSING_TIER_POLICY`, `SINGLE_TRANSACTION_LIMIT_EXCEEDED`, `DAILY/WEEKLY/MONTHLY_AMOUNT_EXCEEDED`, `WALLET_BALANCE_MAX_EXCEEDED`) | 11 dimensions preserved (decision 5); yearly + wallet-balance-max included; Lagos windows; atomic reservation/commit/release via `LimitReservationRecoveryService` |
| **Fees** | `productCode, currency, at` → `FeeRuleResolverService.resolveWithManager(productCode, currency, at)` then `FeeRuleCalculatorService.compute(resolvedRule, amountMinor)` | `RESOLVED → { feeMinor, vatMinor, totalDebitMinor, minimumApplied, maximumApplied, roundingApplied:'FLOOR', ruleId, ruleVersion, effectiveFrom, priority }` / `NOT_CONFIGURED` / `AMBIGUOUS { conflictingIds }` | Priority highest wins, tie → `AMBIGUOUS` never selected; computed even when not posted (evidence-only until §8) |
| **VAT/tax** | `feeRuleVatBPS` + `COMMERCIAL_ACCOUNTING_VAT_TREATMENT` | Part of fee decision `vatMinor`; never invented as zero — missing treatment throws `COMMERCIAL_VAT_TREATMENT_NOT_CONFIGURED` / `COMMERCIAL_VAT_RATE_NOT_CONFIGURED` (DP-03=B) | Decision 14 enforced — no tax because software can calculate |
| **Commissions** | `productCode, currency, amountMinor, recipientType, agentId/agentClassId/aggregatorId, at` → `CommissionRuleResolverService.decideWithManager()` + `CommissionEngine` | `ALLOCATED → { commissionMinor, recipientId, commissionRuleId, commissionRuleVersion, tiers, calculationModel }` / `NONE` | 3 recipient types, 7 models, marginal TIERED tiers, min/max caps; `aggregatorId: null` today (all flows pass null) → only untargeted/PLATFORM rules today |
| **Rewards/cashback** | `productCode, recipientType CUSTOMER|AGENT, kycLevel, campaignId, at` → `RewardRuleResolverService` → `RewardEngine` (when wired) | `GRANTED { grantType=CASHBACK|BONUS|PROMOTION, bonusMinor, rewardRuleId, version, expiryAt, clawbackCondition }` / `NONE` | Preserved but **unwired** — integration contract exists for later call sites (proposal F8); never auto-credit |

**Fail-closed invariants (decisions 11-13):** overlapping effective windows for identical `product×currency×class×institution` scope are rejected on write (`uq_fee_rules_identity` + governance fingerprint check); ambiguous resolution throws `AMBIGUOUS` with conflicting ids; regulatory/KYC ceilings (tier→profile digest + `CustomerFinancialEligibilityService.require()`) always override `GLOBAL` commercial limits — a `GLOBAL` with permissive `DAILY_AMOUNT` never beats a tier-bound `MAX_AMOUNT_PER_TX` for a `LEVEL_1` customer.

---

## 5. Automatic POS — exact blocked functionality, proposed approach, decisions

**Arena 2 completes supported administration now (no interruption):** all 11 documented `POST/GET /internal/agents/:id/outlets` + aggregator variants + `POST /internal/outlets/:id/terminals` + `suspend/reactivate/terminate` per `Agent outlet/terminal` verified table, via `OutletController.requireManage` (`agent.manage_outlets_terminals`) in `AgentNetworkScreen`.

**Separate identification of automatic POS as approved requirement:** the approved AGENT_NETWORK_MANAGER charter (V1-ADMIN-ROLE-AND-PERMISSION-SPEC) is **outlet/terminal management + agent-level limit assignment + funding**, not vendor auto-provisioning. Therefore automatic provisioning is **not** part of the V1 approved requirement — it is a correctly deferred capability that must not be silently marked complete because CRUD exists.

**Functionality blocked by vendor integration:**

| Blocked workflow | What does not exist | Proposed approach (no vendor added until approval) |
|---|---|---|
| `POST /internal/partner-callbacks/pos/provision { aggregatorId, agentId, serialNumber, reference }` auto-creating `AgentTerminal` + outlet bind + audit | No POS vendor adapter, no `PartnerConnection`/`PartnerCredentialsService` record for POS, no `external-data-minimization` classification for `serialNumber` | New `PosProvisionCallbackController` under `partner` (mirrors `partner-callback-ingestion`): verify `X-Partner-Signature` via `PartnerCallbackAuthenticationService`, enforce `aggregatorId→agentId` relationship (`AgentOutlet.aggregatorId`), `SERIALIZABLE` txn `pg_advisory_xact_lock(agentId)`, `audit AGENT_TERMINAL_AUTO_PROVISIONED`, credentials encrypted — **requires product approval decision 4a** |
| Telemetry `POST /internal/partner-callbacks/pos/heartbeat` → `lastSeenAt/firmwareVersion/batteryLevel` | `AgentTerminal` has no heartbeat columns | Add nullable migration + upsert — **requires decision 4b** |

**Do not introduce** either until §8 decisions approved. Until then P4 is **partially complete** (supported CRUD done, auto-provision blocked — explicit).

---

## 6. Critical security finding — FROZEN restriction not consistently enforced at transaction admission

### 6.1 Exact defect

`CustomerEligibilityService.getOperatingStatus()` + `operatingStatus()` correctly compute `FROZEN` → `canOperate=false` and `blockedReasons=['FROZEN']` from `customer_restrictions` (`type IN ('NONE','LIMITED','MANUAL_REVIEW','FROZEN','BLACKLISTED')`). **But no financial entry point calls it, and `CustomerFinancialEligibilityService.require()` never reads `customer_restrictions` at all** — it checks `customers.status`, `kyc_status`, `kyc_level`, `is_synthetic`, `kyc_tier_manual_holds`, `kyc_identity_conflicts`, phone, evidence reader, assessment — never `customer_restrictions`. So a customer administratively restricted as `FROZEN` (or `BLACKLISTED`) via `POST /customers/:id/restriction { type, isActive }` can still pass `wallet-financial-boundary` and send a `WALLET_TRANSFER` — Arena 3's finding is confirmed.

**Blast radius (reviewed entry points):** every path that ultimately calls `CustomerFinancialEligibilityService.require()` without a restriction check: `transfer.service.ts` (→ `wallet-financial-boundary.service → require()`), `transfer-quote.service.ts`, `agent-cash-out.service.ts` / `agent-cash-to-cash-claim.service.ts` / `agent-financial-execution.service.ts` (customer leg), `customer-funding.service.ts`, `customer-wallet.service.ts`, `wallet.service.ts`, `virtual-account/inbound-funding`, `partner/external-operation(-lifecycle)`, `a7-product-persistence`. None consult `CustomerEligibilityService` or `customer_restrictions`.

### 6.2 Minimal fix — authorized, preserving transactional + concurrency guarantees

**Owner:** Arena 5 (integration) — touches one frozen module (`src/kyc-verification/customer-financial-eligibility.service.ts`) with the minimal authorized defect fix below. Arenas 1-4 must not add per-controller checks.

**Exact change:** add one read-only check at the **top** of `CustomerFinancialEligibilityService.require()`, inside the existing transaction and **before** any policy/evidence I/O, using the same `manager` and lock as the following customer-row read:

```typescript
// Inside require(), after resolving rowLock, before the first customers query:
const frozen = await manager.query<Array<{ id: string }>>(
  `SELECT id FROM customer_restrictions
   WHERE customer_id=$1 AND type='FROZEN' AND is_active=true
     AND deleted_at IS NULL ${rowLock}`,   // reuse rowLock ('FOR SHARE' vs 'FOR UPDATE')
  [customerId],
);
if (frozen.length) throw new ConflictException('Customer account is frozen — financial operations are blocked');
 // BLACKLISTED added as companion guard:
const blacklisted = await manager.query<Array<{ id: string }>>(
  `SELECT id FROM customer_restrictions
   WHERE customer_id=$1 AND type='BLACKLISTED' AND is_active=true AND deleted_at IS NULL ${rowLock}`,
  [customerId],
);
if (blacklisted.length) throw new ConflictException('Customer account is restricted — financial operations are blocked');
```

**Why this placement preserves guarantees:**
- Uses same `EntityManager`/transaction `manager` and `rowLock` — no new transaction, no cross-service call, no lock escalation beyond what `require()` already holds (`FOR UPDATE` on customer row when `requireActive` default, `FOR SHARE` otherwise).
- Zero change to `WalletFinancialBoundaryService`, `TransferService`, or any flow controller — single enforcement point covers every existing and future `require()` caller (transfer, funding, cash-to-cash, withdrawal, banking, wallet).
- `LIMITED`/`MANUAL_REVIEW` deliberately **not** blocked here — those map to `RESTRICTED` operating status and are handled by `CustomerEligibilityService` tier/purpose gating in a later story, not a hard freeze.
- Idempotency unaffected: `ConflictException` at admission is recorded as `markFailed` with `failureCode=CUSTOMER_RESTRICTED` (reuse existing path) and replayed requestHash returns same failed result — no duplicate journal.

**Integration authorization required:** this document is the authorization. No other frozen-module change is authorized by this coordination plan.

**Evidence after fix:** `v1-transfer-restriction-frozen.integration.spec` — single test: set `POST /customers/:id/restriction { type:'FROZEN', isActive:true }` → `POST /customers/me/transfers` (with otherwise valid PIN/quote) → `409` `Customer account is frozen`; then `isActive=false` → transfer succeeds. Also `v1-frozen-restriction-matrix` verifies `TRANSFER`, `CASH_TO_WALLET`, `WALLET_TO_CASH`, `CUSTOMER_FUNDING`, `WITHDRAWAL` all fail-closed for a FROZEN customer.

---

## 7. Fees and commissions — preserved calculation, spec to actual collection

Calculation + governance stay as in §4 contracts; actual collection remains disabled until accounting approval — per decision 7, never invented.

**Implementation specification to actual financial collection (when approved):** reuse existing `LedgerService.postJournalInTransaction` double-entry — do not invent a new ledger engine. Inside the existing `SERIALIZABLE` financial transaction, after resolvers return `RESOLVED`/`ALLOCATED`, with `COMMERCIAL_ACCOUNTING_ENABLED=true` + mandatory `COMMERCIAL_ACCOUNTING_VAT_TREATMENT` + `COMMERCIAL_COMMISSION_*` treatments (DP-03=B fail-closed if absent):

- Fee posting: `DEBIT customer.wallet.ledger_account_id` (fee+VAT) / `CR FINANCE-FEE_REVENUE-NGN` / `CR FINANCE-VAT_PAYABLE-NGN` (exclusive-on; inclusive handled per treatment). `transfers.fee_minor/vat_minor` and `cash_to_cash_transfers.fee_minor` stop being hardcoded `0` (see §3 `Always 0`).
- Commission posting: `DEBIT COMMISSION_EXPENSE` / `CR COMMISSION_PAYABLE` per `recipientType/calculationModel/tiers` — `aggregatorId: null` today so only untargeted/PLATFORM rules fire; refuse `AGGREGATOR`-targeted allocations via existing `ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED`.

**Acceptance to move from evidence-only to posting (must pass before activation):** one governed active `fee_rules` row per covered `product×currency` resolves `RESOLVED` + clamped `FeeRuleCalculatorService.compute()` proof; journals contain principal + fee + VAT legs `DEBIT==CREDIT` with correct registry `ledger_account_id`s; reversal replays full compensation; self-approval 403; `OperationsController.integrity` green. No new audit needed to author — only to **activate**.

### VAT / tax boundary (decision 14)

Do not apply tax because the software can calculate it. VAT today is per-rule `vat_bps` computed as `fee * bps / 10000` on the clamped fee — but posting requires explicit legal approval of **applicability, rate, exemptions, jurisdiction, reporting and remittance workflow**. Until approved, VAT stays computed evidence — never posted. Any wider tax (withholding, excise) requires a new catalogue — none proposed.

---

## 8. Rewards & product catalogue — stay deferred

No dependency found on class/limits/fees: `reward_rules` store+resolver+engine have zero flow call sites by design (`reward.module.ts`); `B1CampaignEngine` does not execute cashback. Rewards become a governed rule-store integration contract only when funded (proposal F8). Product catalogue stays 7 seeded V1 codes as authoritative identity — no new catalogue item needed for onboarding/limits.

---

## 9. Acceptance — ten gates, six layers, no screen-equals-complete

Layer distinction required for every gate in `IMPLEMENTATION-GATES-AND-DECISION-REGISTER.md §6` (10 gates):

**Component tests passing** → **Backend capability implemented** → **Admin interface implemented** → **Mobile integration implemented** → **E2E workflow verified (non-prod, §6 proof on integration branch)** → **Production/provider readiness**

A gate is not complete because a screen exists or its unit tests pass. `SystemHealthScreen` or `LimitDiagnostics` proof must show the exact `ruleVersion/digest` (see §4) and tier ceilings overriding commercial config, not just a UI render.

---

## 10. Exact blockers + executable next steps

| Blocker | Where it blocks | Unblocks when | Next step (owner) |
|---|---|---|---|
| `FROZEN` not enforced at admission | Gate `Frozen/restricted customer rejection` + P5 gate 10 | §6 fix merged + `v1-transfer-restriction-frozen` spec green with flag-matched txn semantics | **Arena 5** — apply §6 two-query fix to `CustomerFinancialEligibilityService.require()` (this document is authorization) |
| `completeRegistration` `ServiceUnavailable` stub | Customer registration + both claiming flows (gate A/B) | Stub un-stubbed via §3.1 authorized `KycRegistrationSessionService→CustomerService→WalletService` path with all security guards | **Arena 1** — one PR (this document is authorization for the registration backend work + customer-class model ownership) |
| No customer class entity | Class-scoped fees/limits, class switching, automatic class resolution, class-based commercial | `customer_classes` + `customer_class_assignments` migration + controller + screen (Arena 1, mirrors agent classes) | **Arena 1** (model) + **Arena 3** (commercial targeting F3 — approval-gated) |
| Tier-limit `GLOBAL` profiles not yet seeded for NGN `TRANSFER/CASH_TO_WALLET/WALLET_TO_CASH/CASH_TO_CASH` × LEVEL_1-3 | Gate 6/10 + new-customer limit inheritance (P2 decision 3) | `GLOBAL` `limit_profiles` + `limit_rules` (all 11 dims where applicable) + `GLOBAL` assignments + institution tier mappings approved | **Arena 3** — seed catalogue (no per-customer rows needed; GLOBAL fallback proven per §4) |
| Fee/commission approval discoverability | Authoring without approval listing | `GET /internal/approvals?action=&status=&resource=` (F1, read-only, reuse `PrivilegedActionApprovalService` storage) | **Arena 4** |
| Commercial accounting families not provisioned | Any fee/VAT/commission posting | FAMILIES `FEE_REVENUE/VAT_PAYABLE/COMMISSION_EXPENSE/PAYABLE` + `COMMERCIAL_ACCOUNTING_*` treatments approved — §7 spec | **Arena 5 + finance** |
| Auto-provision POS callback | P4 automatic provisioning (not CRUD) | Vendor integration approved (decisions 4a/4b) | **Deferred** — CRUD is complete as P4 |

**Implementation sequence (A–G requested):**

| When | Who | What | Provenance |
|---|---|---|---|
| **Now — do not interrupt** | Arenas 1 & 2 | Finish current owned views (P1). No cross-Arena file edits, no shared-file edits. | `arena/5-a1-customers-kyc` / `arena/5-a2-agents-pos` → PR to `arena/5-main-web-integration` |
| **Now — in parallel** | Arena 3 | Commercial catalogue + governed mutations + diagnostics: make `limitCatalogue` cover all required dims for NGN with `GLOBAL` fallback, create approved example `fee_rules`/`commission_rules` (evidence-only), expose `InstitutionKycLimitPolicy` view + `LimitDiagnostics` data, plus `customer-class` commercial targeting F3 skeleton (optional targeting column) | `arena/5-a3-transactions-finance` |
| **Next (authorized)** | Arena 5 | **Security fix** §6 (`FROZEN`/`BLACKLISTED` at admission) preserving SERIALIZABLE/idempotency; publish §4 integration contracts + §1 D-1 diagnostics schema; enable `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=true` in non-prod acceptance envs | This branch → `arena/5-main-web-audit` |
| **Next (authorized)** | Arena 1 | **Registration backend** §3.1: `customer_classes` entity + `customer_class_assignments` + controller/screen + un-stub `completeRegistration` via existing identity-bound path + E2E harness for flows A/B (positive + duplicate/locked/enumeration/expired-session negatives) | This document is explicit authorization for Arena 1's registration backend work and customer-class model ownership |
| **Next (authorized)** | Arena 4 | Approval discovery F1 + commercial approval notifications/audit visibility for fee/commission/limit + tier-policy approvals | `arena/5-a4-notifications-admin` |
| **Later — after D-1 zero uncovered + gates 6/7 with flag ON** | Arena 5 + finance | Controlled prod flag per §1 D-4 with explicit owner authorization (decision 1) | Runbook + flag commit (not in this document) |
| **Later — after accounting families approved** | Arena 3+5 | Spec to posting per §7 (inside existing ledger txn) — evidence → posting, reversal compensation, integrity green | Separate finance PR |

---

## 11. Decisions requiring approval — short register (unresolved only)

| # | Decision | Options (no implicit action) | Recommendation | Blocks |
|---|---|---|---|---|
| 1 | Prod `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` | A now; **B after backfill + D-1 zero + gates 6/7 with flag ON in integration**; C keep permissive as final design | **B** | Gate 6/10 |
| 2 | Unblock `completeRegistration` self-service | A workforce-only; **B via existing KYC-bound path per §3.1 with all security guards**; C new registration system | **B — this document is the authorization for Arena 1 to do B** | Registration + both claiming flows |
| 3 | Customer class F2 | A no classes; **B Standard/Premium/Business + admin-defined `customer_classes` + `customer_class_assignments` per §3.1** | **B** | Class-of-service, class-scoped fees/limits, automatic class resolution |
| 3b | Class/institution pricing F3 (nullable targeting on `fee_rules`) | A keep `(product_code,currency,effective_from)` only; **B add optional `customer_class_id`/`institution_id` targeting (at-most-one, precedence + AMBIGUOUS)** | **B together with 3** | Class/institution-specific pricing |
| 4a | POS auto-provision callback | A none (supported CRUD is complete); B `POST /internal/partner-callbacks/pos/provision` | **A now, B only on new product decision** | P4 provisioning |
| 4b | Terminal telemetry columns | A none; B `last_seen_at/firmware_version/battery_level` | A unless product requires | P4 |
| 5 | Fee/commission collection families + treatments | A keep evidence-only; **B provision `FEE_REVENUE/VAT_PAYABLE/COMMISSION_*` + `COMMERCIAL_ACCOUNTING_*` per §7** | **A until finance approves (§7 acceptance before flip)** | Fee posting |
| 6 | VAT applicability (beyond calculation) | A stays unapplied; B apply at X bps with exemptions/jurisdiction | **A until legal approves rate/applicability** (decision 14 — never tax because calculable) | Tax |
| 7 | Other taxes (withholding/excise) | A none; B new catalogues | A | None |

No navigation reorganization, other financial-engine change, production activation, real postings or merge to `main` proposed in this document. Arenas 1-4 remain on `arena/5-main-web-integration` — no direct `main` PRs.

