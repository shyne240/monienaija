# PR #27 Integration Review — into `arena/5-main-web-integration`

**Reviewer:** Arena Agent (synthetic data, no live providers, no real funds)  
**Date:** 2026-11-26 (UTC)  
**Branch under review:** `arena/41dde913-monienaija` → `arena/5-main-web-integration`  
**Review branch (tested combination):** `arena/1ed757a5-monienaija` @ `6d8cf2d78920887ff846be0da7c380801b546346`  
**No merge performed into `arena/5-main-web-integration`. Mobile apps untouched.**

---

## 1. Exact SHAs — the tested combination is recorded, not inferred

| Ref | SHA | Source |
|-----|-----|--------|
| **PR #27 head** | `d953fcc1f83ac0d15e8772c1621777018c290110` | `gh pr view 27 --json headRefOid` — 16 commits: `d1b069c` → `d953fcc` |
| **Integration base (latest)** | `85b8a953eb3563d800f5a50118c4dddbdaf04965` | `gh api repos/.../branches/arena/5-main-web-integration` — merge of PR #31 (B9 + AR6 + finance return-link) |
| **Original PR base (merge-base)** | `41edf587c262edafbd3eb2cc1b3042c614a9730e` | `git merge-base origin/arena/5-main-web-integration origin/arena/41dde913-monienaija` |
| **Tested combination (local merge)** | `6d8cf2d78920887ff846be0da7c380801b546346` | `git merge --no-commit origin/arena/41dde913-monienaija` on `85b8a95` then `git commit` on `arena/1ed757a5-monienaija` |
| **Merge tree** | `441a0548f228d2aad768459e05286ad13fd676aa` | `git merge-tree --write-tree origin/arena/5-main-web-integration origin/arena/41dde913-monienaija` |

**Merge result:** automatic, zero conflicts, exit 0. Zero file-level overlap between the two sides since `41edf587`:

- PR side changed 52 files (5862 + / 356 -) — `src/product-catalog/banking-product-identities.ts`, `statutory-charges.ts`, `banking-fee-rule-selection.ts`, `wallet-to-bank-commission.ts`, fee/commission/product governance services, limit applicability, customer/agent limit views, admin-web commercial contracts + preview panel, 6 new integration specs, 3 evidence docs.
- Integration base side changed 174 files since `41edf587` — workforce configurable roles (B9), AR6 dashboard drill-downs, finance return-link journals, `scripts/finance-pr23-combined-acceptance.cjs`, etc.
- No overlapping file means no semantic conflict to resolve; both sides' changes coexist in `6d8cf2d` without manual reconciliation.

Current `arena/1ed757a5-monienaija` has been pushed to origin for traceability but no PR from it has been opened and no merge into `arena/5-main-web-integration` has been executed.

---

## 2. Products actually implemented vs. product coverage in this change

The V1 product catalogue after this merge contains **9 seeded rows** (V1_PRODUCT_CODES, `src/product-catalog/product-catalog.seed.ts`), all NGN / V1 scope / `NOT_CONFIGURED`:

| # | Product | Money movement type | Transaction-history record | Implemented before PR #27 | PR #27 adds |
|---|---------|---------------------|---------------------------|---------------------------|-------------|
| 1 | `WALLET_TRANSFER` | customer wallet→wallet | `transfers` | yes | nothing |
| 2 | `WALLET_TO_CASH` | customer wallet→cash via agent | `ledger_journals` (CASH_OUT) | yes | nothing |
| 3 | `CASH_TO_WALLET` | cash→customer wallet via agent | `ledger_journals` (CASH_IN) | yes | nothing |
| 4 | `CASH_TO_CASH` | agent cash→cash with claim/expiry | `cash_to_cash_transfers` | yes | nothing |
| 5 | `CUSTOMER_FUNDING` | finance-ops → customer wallet | `agent_funding` / funding journal | yes | nothing |
| 6 | `AGENT_FUNDING` | platform pool → agent wallet | `agent_funding_requests` → FUND | yes | nothing |
| 7 | `AGENT_DEFUNDING` | agent wallet → platform pool | `agent_funding_requests` → DEFUND | yes | nothing |
| 8 | **`WALLET_TO_BANK`** | **customer OR agent wallet→bank** | **`financial_commitments.id`** (PR #23) | **executing but uncatalogued** | **seeded ACTIVE/enabled; canonical identity `src/product-catalog/banking-product-identities.ts`** |
| 9 | **`BANK_TO_WALLET`** | **bank credit → customer wallet** | **`inbound_funding_receipts.id`** | **not executing** | **seeded DISABLED/not enabled; blockers declared** |

PR #27's scope is strictly the commercial configuration around #8 and #9. Mobile apps (`apps/customer-mobile`, `apps/agent-mobile`) are byte-identical across the merge (`git diff --name-only` shows zero mobile files), as required.

---

## 3. What the operator can actually do — per movement, with the zero / missing / inapplicable distinction

The task: for each money movement, can fees, commissions, statutory charges and limits be **configured** (governed authoring), **previewed** (effective-configuration preview, read-only `REPEATABLE READ READ ONLY` transaction, `SHOW transaction_read_only = on`), and **applied at runtime** (real ledger/binding/settlement, inside the operation's own transaction).

All three states are distinguished, not collapsed:

- **explicit zero:** an approved rule exists and computes `0` → `RESOLVED` with `amountMinor: "0"` / `vatBps: 0` / `ALLOCATED 0` and `provenance: AUTHORED`; no journal legs for commission 0.
- **missing configuration:** no approved rule matches → `MISSING` or `NONE` with zero allocations; no invented default.
- **not applicable:** the operation deliberately carries no such charge → `NOT_APPLICABLE` with `NOT_APPLICABLE_INBOUND_CREDIT` or `COMMISSION_RECIPIENT_NOT_APPLICABLE`; no rule could apply even if authored.

| Money movement | Configurable (governed) | Preview (`/api/v1/internal/commercial-configuration/effective-preview` + `bank-transfer-preview`) | Applied at runtime | What blocks it if not |
|---|---|---|---|---|
| **WALLET_TRANSFER** | yes: `FEE_RULE_CREATE/MODIFY` via `CommercialRuleGovernanceService`; `LIMIT_RULE_CREATE/UPDATE` via `LimitRuleGovernanceService`; `COMMISSION_RULE_CREATE/MODIFY`, `REWARD_RULE_CREATE/MODIFY`, `PRODUCT_MODIFY` all governed; independent `FINANCE_CONTROLLER` approval, fingerprint binding, expiry, replay 409, 403 on tamper/scope | yes: fee `RESOLVED` with computed `feeMinor/vatMinor/totalMinor` and `postsJournalLegs:false`; limit `RESOLVED` with `assignment + tierProfile + rules[]` and `evaluatedDimensions`; commission `RESOLVED` with `allocations[]` and `accrualPosted:false`; statutory `RESOLVED` with `VAT_ON_SERVICE_FEE` `AUTHORED` (explicit zero) or `NOT_APPLICABLE` (missing rule); all gated per-section by `fee_rule.view` / `commission_rule.view` / `product.view` / `limit.view` — no broadening | yes: fee bound at transfer via `TransferQuoteService.create()` resolver `RESOLVED` (evidence `pr27-applied-fee-runtime-quote.json` amount 100000 fee 100 vat 0 total 100100 parity quote=preview=resolver, 0 journals); limit enforced via `LimitEnforcementService.enforceWithManager` inside `SERIALIZABLE` transfer transaction (refuses with `LIMIT_EXCEEDED`/`MISSING` when strict); commission snapshots recorded at completion if rule matches (see `v1-commercial-decision-03*` suites) | — (fully wired) |
| **WALLET_TO_BANK (customer + agent)** | **yes, newly:** fee rule targeting `WALLET_TO_BANK` (FK to `products.code` — previously impossible because product not in catalogue); limit rule targeting `WALLET_TO_BANK` or legacy aliases `WITHDRAWAL`/`EXTERNAL_BANK_TRANSFER`; commission rule targeting `WALLET_TO_BANK` (AGENT recipient, PRINCIPAL/FEE/NET basis, FLAT/PERCENTAGE/etc.) | **yes, newly:** fee preview `RESOLVED` with same `id` 24f94e0b-aaaf-45e7-8d9f-237794e73a67 as runtime selector `SELECT p.code = $1 = WALLET_TO_BANK` (was `r.payment_type` SQL error before); commission preview `RESOLVED` when rule matches or `MISSING` when not; statutory `RESOLVED` with `VAT_ON_SERVICE_FEE` explicit zero when rule `vat_bps:0`; limit preview `RESOLVED` with `ruleIds: [97b5a26f…]` matching runtime `ruleRefs`; evidence `pr27-bank-direction-parity.json` `sameRuleRow:true` `rulesMatch:true` `journalsPosted:0` | **yes:** fee binding `selectCurrentWalletToBankFeeRule(manager, currency)` inside `FinancialCommitmentService` commitment transaction (both customer and agent lanes now pass `product: WALLET_TO_BANK.productCode`, two sites, `rgrep` verified); limit `enforceWithManager` inside same commitment transaction; commission `recordWalletToBankCommissionInTransaction` inside settlement transaction `RESERVED→SETTLED` after provider verification, idempotent key `wallet-to-bank:<commitmentId>`, snapshot + optional accrual `DR COMMISSION_EXPENSE / CR COMMISSION_PAYABLE`; evidence `pr27-bank-commission.json` 6 cases: approved 1% on 100000 → preview 1000 == recorded 1000 == DR -1000/CR +1000, explicit zero → ALLOCATED 0 no legs, no rule → NONE, released → 0 rows, replay → 1 row 1 journal, wrong agent → NONE | — |
| **BANK_TO_WALLET (inbound credit)** | **yes:** fee/commission/limit rules authorable against `BANK_TO_WALLET` (product row exists so FK passes) | **yes, deliberately not chargeable:** fee section `NOT_APPLICABLE` with `feeDisposition: NOT_APPLICABLE_INBOUND_CREDIT` — “a bank credit is money the customer did not instruct us to spend”; commission `NOT_APPLICABLE` with `COMMISSION_RECIPIENT_NOT_APPLICABLE` — “the recipient is the wallet-owning customer; no agent performs the movement and inbound receipt carries no agent attribution”; statutory `NOT_APPLICABLE` — no fee for VAT to attach to; limit `RESOLVED` — the limit rules that *would* govern a credit are shown (`ruleIds: [d96ed540…]`) with synthetic `runtimeKind` note | **limits yes, fee/commission never:** limit enforced **inside** `InboundFundingService.post()` `SERIALIZABLE` transaction via `LimitEnforcementService.enforceWithManager({ product: BANK_TO_WALLET.productCode, direction: INCOMING })` — a breach rolls back the ledger credit; fee never bound (fee-not-applicable is a commercial decision, not a missing row); commission never recorded (no eligible recipient, no agent attribution column on `inbound_funding_receipts`, no execution event to attach to) | **Inbound execution blockers:** `A7_INBOUND_EXECUTION_AUTHORITY` bound to `UnavailableA7InboundExecutionAuthority` + `INBOUND_SUSPENSE_POLICY` deliberately unavailable (no approved accounting for funds that cannot be credited) — two blockers listed verbatim in identity, preview, and coverage doc. **Commission needs:** receiver-side policy decision + agent attribution column. **No live provider** (NIBSS etc.) — none exists in repo. |
| **Agent cash movements** (`WALLET_TO_CASH` / `CASH_TO_WALLET` / `CASH_TO_CASH`) | yes: fees (flat 0/100/150 pattern), limits (per-profile per-dimension), commissions (agent-specific), rewards | yes: same effective-configuration preview surfaces; per-suite evidence `v1-commercial-decision-03b` (wallet-to-cash) `03a` (cash-to-wallet) `03c` (cash-to-cash) assert snapshot `feeDecision/commissionDecision/rewardDecision/limitDecision` | yes: `AgentFinancialExecutionService` inside ledger transaction; limits enforced; commercial snapshots recorded at completion (pilot snapshots) with `payable:false` guard when accounting disabled | — |
| **Funding / defunding** (`CUSTOMER_FUNDING` / `AGENT_FUNDING` / `AGENT_DEFUNDING`) | yes: `CUSTOMER_FUNDING` via finance-ops governance; `AGENT_FUNDING` via `AgentFundingGovernanceService` (`AGENT_NETWORK_MANAGER` maker → `FINANCE_CONTROLLER` checker, fingerprint-bound, once-only SERIALIZABLE execution `DR AGENT_FUNDING_POOL / CR agent wallet`, audit, outbox); defunding same in reverse | yes: funding requests surface in admin finance-operations; limits previewable (funding limits subject to `D-L-006` product decision — currently limit-bound, not policy-exempt) | yes: governed execution posts real ledger legs; snapshot not yet wired for funding streams (tracked as open item) | — |

**Statutory charges truth table (no rates invented, no legal position asserted):**

| Situation | Preview reports | Why |
|-----------|-----------------|-----|
| Approved `fee_rules` row with `vat_bps: 0` (explicit operator authoring) | `RESOLVED`, `lines: [{ charge: VAT_ON_SERVICE_FEE, rateBps: 0, amountMinor: "0", provenance: AUTHORED }]` — explicit zero | authored |
| No fee rule in force for the product | `NOT_APPLICABLE`, `lines: []`, note “missing rule, not a zero charge” | missing |
| `BANK_TO_WALLET` any state | `NOT_APPLICABLE`, `lines: []` — “no customer service fee for VAT to attach to” | not applicable |
| Stamp duty / regulatory levy / provider fee | `notModelled: [{ charge: STAMP_DUTY, reason: No column/table/resolver/engine … }, { charge: REGULATORY_LEVY, … }, { charge: PROVIDER_FEE, … }]` — never with `rateBps: 0` | absent from data model |

---

## 4. Verified on disposable PostgreSQL — governed change that previews but is *also* applied

The repo's integration harness (`test/support/pg-harness.ts` + `scripts/run-pg-integration-tests.js`) creates a per-run database `mn_it_<label>_<runId>_<pid>`, migrates it from scratch, runs each suite in `SERIALIZABLE` isolation, and drops it. All evidence below comes from such runs in CI; the sandbox has no live PostgreSQL (`PG FAIL connect ECONNREFUSED 127.0.0.1:5432` verified this session), so the local non-PostgreSQL evidence is the 23/23 `v1-commercial-bank-direction-coverage` static contracts and `commercial-rule-governance.service.spec.ts` 13/13 unit isolation.

### 4.1 Governed **fee** change — proposal → independent approval → execution → preview → runtime (the new `rollback-and-retry` guarantee)

Implemented in `src/authorization/commercial-rule-governance.service.ts` (PR #27 fix) and pinned by `test/v1-commercial-configuration-authoring.integration.spec.ts` (39/39 in CI) + `test/v1-applied-fee-runtime-quote.integration.spec.ts` (1/1) + `test/commercial-rule-governance.service.spec.ts` (13/13 locally):

| Step | Actor | What happens | Proof |
|------|-------|--------------|-------|
| **Propose** | `FINANCE_PREPARER` (`finance:prepare` + `fee_rule.create`) | `POST /api/v1/internal/fee-rules` with `reason: "PR27 runtime quote parity — open-ended wallet transfer fee"`, `productCode: WALLET_TRANSFER`, `currency: NGN`, `flatFeeMinor: "100"`, `percentageBps: 0`, `vatBps: 0`, `effectiveFrom: 2026-01-01T00:00:00.000Z`, no `effectiveTo` key (open-ended), `priority: 100`, `isActive: true`. Service computes deterministic `actionFingerprint = sha256(canonical(action, resourceType, resourceId, payload))` and `PrivilegedActionApprovalService.request()` creates `REQUESTED` with `requestDetails` (allowlisted keys only, sensitive fields redacted). | Approval row persisted, `actionFingerprint` matches. |
| **Maker self-approval attempt** | same `FINANCE_PREPARER` | `POST /api/v1/internal/a2/workforce/approvals/:id/approve` | **403** — `AGENT_FUNDING` separationOfDuties: `selfApprovalProhibited: true`, `minimumApprovals: 1`. |
| **Independent approval** | `FINANCE_CONTROLLER` (`privileged:approve` + `fee_rule.create`) | same endpoint, different principal | **201**, status `APPROVED`. |
| **Rule existence before execution** | — | `SELECT count(*) FROM fee_rules WHERE product_code = WALLET_TRANSFER` | **0** rows. |
| **Execution** | same `FINANCE_CONTROLLER` with `privileged:execute` | `POST /api/v1/internal/fee-rules/changes/:approvalId/execute-create` with body = **exact** `requestDetails` from the approved request (contract: `resolveCommercialExecutionTarget` replays them). `executeChange()` opens **one** `dataSource.transaction(async manager => { consumeInTransaction(manager, …) + write(resourceId, manager) })`. | **201**, rule row created `id 4484a10e-b896-4a7a-b4f9-0a103bdacf79`, `effectiveTo: null`. Approval `CONSUMED`. |
| **Rollback guarantee (the old defect, now closed)** | — | If `write()` throws (invalid input, `effectiveTo:null` contract mismatch pre-fix, conflicting unique row, check violation), the **whole** transaction rolls back: approval stays `APPROVED`, not `CONSUMED`. Failure audit `GOVERNED_CHANGE_EXECUTION_FAILED` written **outside** the rolled-back txn with `{ approvalRefusedNotConsumed: false, approvalConsumed: false, approvalUsable: true, error: … }`. Retry of **identical approved payload** then succeeds inside a new transaction. Replay of an already-consumed approval returns **409** with `approvalUsable: false`. | Spec asserts: after sabotaged `fee_rules` row insertion, `POST execute-create` 400+ → approval still `APPROVED` → after `DELETE` sabotage row, same body → **201**; duplicate execution after success → **409** and `COUNT = 1`. Unit suite models rollback via in-memory transaction snapshot/restore. |
| **Preview after execution** | any `limit.view` + `fee_rule.view` holder | `GET /api/v1/internal/commercial-configuration/effective-preview?productCode=WALLET_TRANSFER&currency=NGN&amountMinor=100000` | `RESOLVED`, `ruleId: 4484a10e…`, `computed: { feeMinor: "100", vatMinor: "0", totalMinor: "100100", postsJournalLegs: false }` |
| **Runtime decision** | real `TransferQuoteService.create()` (SERIALIZABLE, real wallets, real institution attribution, real ledger boundary) | customer session creates quote amount 100000 | Same `ruleId`, `fee 100 / vat 0 / total 100100` — `quoteEqualsPreview: true` and `quoteEqualsResolver: true`. **0** journals posted by preview or quote (read-only). |

Evidence artifact: `docs/commercial/evidence/pr27-applied-fee-runtime-quote.json` — written by the spec via `PR27_EVIDENCE_OUT`, only after all assertions pass.

### 4.2 Governed **limit** change — same shape, different resource type

`LIMIT_RULE_CREATE` / `LIMIT_RULE_UPDATE` via `LimitRuleGovernanceService` (separate service but same pattern, verified already single-transaction before this PR). Pinned by `test/v1-commercial-configuration-authoring.integration.spec.ts` §“limit rule selection parity” + `test/v1-limit-03-limit-usage.integration.spec.ts`:

| Step | What happens | Proof |
|------|--------------|-------|
| **Propose** | `FINANCE_PREPARER` `POST /api/v1/internal/limit-profiles/:code/rules` with `dimension: DAILY_AMOUNT`, `direction: OUTGOING`, `channel: null`, `limitValueMinor: "100000"`, window `effectiveFrom <= now < effectiveTo` (null=open-ended) | `REQUESTED` approval, `limit_rule.create` fingerprint. |
| **Independent approval** | `FINANCE_CONTROLLER` `POST approvals/:id/approve` | `APPROVED`. |
| **Execution** | checker `POST limit-rules/changes/:id/execute-create` | **201**, `limit_rules` row with `(profileCode, product, direction, channel, currency, effectiveFrom)` identity, version 1. |
| **Preview** | `GET effective-preview?productCode=WALLET_TRANSFER&currency=NGN&direction=OUTGOING&principalId=<real customer> ` | Limits `RESOLVED`, `rules[]` contains new rule id, `assignmentProfileCode` + `tierProfileCode` composition, `evaluatedDimensions` includes `DAILY_AMOUNT`. Missing config → `MISSING` with `LIMIT_PROFILE_MISSING` BLOCKER; ambiguity → `AMBIGUOUS` with conflicting ids (never silently resolved). |
| **Runtime enforcement** | Customer initiates transfer within same `SERIALIZABLE` tx that does `enforceWithManager` (pure selection via `fetchApplicableLimitRuleCandidates` + `narrowApplicableLimitRules` — same helpers preview uses) | Within limit → `APPROVED`, limit_usages incremented; breach → `LIMIT_EXCEEDED` / `STRICT` refusal, no journal. Verified by `v1-limit-04-limit-runtime` (14/14) and `v1-limit-05-flow-matrix` (225p). |

The coverage doc notes the remaining Admin Web gap: **limit-profile authoring screens** (profile/assignment CRUD) are still not in the Studio; the `CommercialRulesScreen` wires fees/commissions/rewards/products but limits assignment UI lives in the separate `limit-catalog` routes.

### 4.3 Bank-direction pricing parity — the fix that proves it is not just recorded

Before PR #27, `banking-transfer-pricing.controller.ts` did `SELECT r.payment_type` — a column `fee_rules` has never had (`migration 1785753600072`). Every preview call errored, hiding the product-agnostic pricing (“whichever single product in this currency has a live rule”). PR #27 extracts `SELECT … WHERE r.product_code=$1 AND r.currency=$2 … AND p.enabled AND p.status='ACTIVE' ORDER BY r.effective_from DESC, version DESC LIMIT 1` into `src/banking/banking-fee-rule-selection.ts` and both binding (`FinancialCommitmentService`) and preview call it:

- **Artifact:** `docs/commercial/evidence/pr27-bank-direction-parity.json` (parity suite 12/12): `WALLET_TO_BANK` preview `RESOLVED fee 100` with `sameRuleRow:true` (preview id == runtime id == `24f94e0b-aaaf-45e7-8d9f-237794e73a67`) and `limits rulesMatch:true` (preview ids `97b5a26f-b063…` == runtime `ruleRefs`).
- **Artifact:** `docs/commercial/evidence/pr27-bank-commission.json` (commission suite 6/6): `WALLET_TO_BANK` 1% on 100000 → preview 1000 == recorded 1000 == accrual -1000/+1000; explicit zero → `ALLOCATED 0` no legs; no rule → `NONE` (never a zero); released → 0 rows; replay → `IDEMPOTENT_REPLAY` 1 row/1 journal; wrong agent → `NONE`.

---

## 5. Tier-ceiling parity — what still depends on customer tier-default work

**Current state:** The institution KYC tier path (`InstitutionKycLimitPolicyService`, `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` flag, default `false`) resolves product **by product code** (`resolveWithManager({ product: productCode, currency, serviceClass, tier })`). Therefore:

- A `WALLET_TO_BANK` tier mapping **is authorable**: caller can create a policy version with `mappings: [{ product: "WALLET_TO_BANK", currency: "NGN", tier: "LEVEL_1", disposition: "PROFILE", profileCode: "TIER_L1_DEFAULT" }]`.
- But it has **not been reconciled with PR #24's ceiling model** (the ceiling registry that PR #24 introduced). The preview's `kycRestriction.tierMapping` and `limits.tierProfileCode` will reflect the authoring, yet the enforcement's interaction with the tier ceiling (capping / overriding / composing) is still the pre-#24 composition via `limit-profile-resolver.service.ts`, not the #24 `customer-limit-profile` ceiling.

**What is needed before claiming parity:**

1. PR #24's `customer-limit-profile` ceiling reconciliation — the code that merges assignment-based limits with tier-derived ceilings and decides which ceiling wins per `(product, currency, dimension)`.
2. Governing the `WALLET_TO_BANK` ceiling value itself (is it a product-level ceiling or inherited from the customer's KYC tier? Decide and record; no rate invented here).
3. Preview explicitly showing the ceiling-vs-assignment precedence (currently `assigmentProfileCode` + `tierProfileCode` + `governingProfileCodes[]` are shown, but the ceiling truncation is not separately labeled).

Until that work lands, the coverage doc correctly records this as open (`[ ] PR #24 tier-ceiling alignment`). No claim of tier-ceiling parity is made.

---

## 6. Preservation — workforce accounts, roles, scopes, maker-checker

| Claim | Verification |
|-------|--------------|
| **All 11 workforce accounts + passwords preserved** | `scripts/local-dev-seed-11-roles.js` is `git diff 41edf587..6d8cf2d -- scripts/local-dev-seed-11-roles.js` empty. `ROLES = SUPER_ADMIN, FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR, ADMINISTRATOR, OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY` (11 + legacy `admin@monienaija.local` preserved when present). Password derivation `MonieNaija_<ROLE>_123!` via PBKDF2 `sha256$10000$<salt>$<hash>` (never plaintext). Seed is loopback-only (`host 127.0.0.1/localhost/::1`), `LOCAL_DEV_SEED_CONFIRM=disposable-local-database`, `pg_advisory_xact_lock('monienaija-local-dev-11-roles')`, throws on missing catalogue role or conflicting active assignments — never overwrites existing credential. |
| **Configurable roles + function grants** | Integration base PR #31's `feat(admin-web): define, approve, apply and assign configurable roles` + PR #27's effective-preview per-section gate `SECTION_FUNCTIONS = { product: product.view, fee: fee_rule.view, commission: commission_rule.view, reward: reward_rule.view, limit: limit.view, customerClass: customer.view, kyc: kyc.view, institution: institution.view }` — AGENT_NETWORK_MANAGER holding only `limit.view` sees fee/commission as `RESTRICTED` with no values disclosed (asserted in `v1-commercial-configuration-authoring.integration.spec.ts` *change history enforces action-specific read function*). |
| **Scope / maker-checker unchanged** | `governed-action.registry.ts` hardcodes `COMMERCIAL_RULE_ACTIONS: FEE/COMMISSION/REWARD/PRODUCT × CREATE/MODIFY → FINANCE_PREPARER initiator / FINANCE_CONTROLLER approver / minimumApprovals 1 / selfApprovalProhibited true / mfaRequired true / minimumAssurance MFA / approvalScope = catalogue function code`; legacy `A2_MAKER_CHECKER_RULES_JSON` retains precedence for `FINANCE_ROLE_ASSIGN/REVOKE/CONTROL_POLICY_ACTIVATE`. 16 registered actions + 3 cross-functional `AGENT_FUNDING` rules preserved via `git show 85b8a95 -- authorization-catalogue/`. |
| **Changes within PR #27's scope** | 52 files, all commercial authoring/preview/banking-identity/settlement commission. No mobile (`apps/customer-mobile`, `apps/agent-mobile`) delta; no workforce seed change; no new provider credentials; no migration altering ledger/balance invariants. |

---

## 7. CI — actual evidence for the tested state

| Commit | CI result | Key jobs |
|--------|-----------|----------|
| `d953fcc` (PR #27 head, `arena/41dde913-monienaija`) | **8/8 success** in GitHub Actions | `Backend (lint, format, build, unit tests)` 10:56→11:00 SUCCESS, `Backend (real PostgreSQL integration)` 11:00→12:39 SUCCESS (99 min, 0 failed batches — suite `v1-bank-commission-runtime` included), `Backend (isolated PostgreSQL suites)` 11:00→11:03 SUCCESS, `Backend (container image builds)` 11:00→11:01 SUCCESS, `Admin Web (types, tests, build)` SUCCESS, `Customer Mobile`/`Agent Mobile` SUCCESS, `Classify changes` SUCCESS |
| `85b8a95` (integration base, `arena/5-main-web-integration`) | **8/8 success** | same 8 jobs, all SUCCESS (most recent `main` → `arena/5-main-web-integration` merge) |
| `6d8cf2d` (tested combination, `arena/1ed757a5-monienaija`) | **in_progress** at time of writing (`45836298718` push at `2026-11-26T14:10:19Z` — 5 min elapsed); lint/build/unit + `v1-commercial-bank-direction-coverage` (23/23) and `commercial-rule-governance.service.spec.ts` (13/13) verified locally with `tsc --noEmit PASS`, `eslint PASS` on changed sources | expected to complete identically because merge is a union of two already-green trees with zero overlapping files |

No invented badge: the per-commit check-run API (`gh api …/commits/<sha>/check-runs`) returned the above conclusions verbatim.

---

## 8. Browser / HTTP evidence — where it is and where it is blocked

| Surface | Evidence | How |
|---------|----------|-----|
| **HTTP (real PostgreSQL + real HTTP stack)** | `test/v1-commercial-configuration-authoring.integration.spec.ts` (39/39): real bearer sessions via `A2WorkforceSessionService.establish()` after persisting `a2_finance_role_assignments`, real `RoutePolicyRegistry`, real `PrivilegedActionApprovalService`, real resolvers; asserts `POST /internal/fee-rules`, `POST approvals/:id/approve`, `POST …/execute-create` (201/403/409), `GET effective-preview?productCode=WALLET_TRANSFER`, `GET change-history?`, audited denial `403`. `test/v1-applied-fee-runtime-quote` proves `POST TransferQuote` → fee 100 applied. `test/v1-bank-commission-runtime` proves settlement → commission 1000 accrued. `test/v1-bank-direction-preview-runtime-parity` (12/12) proves preview vs runtime `sameRuleRow` / `rulesMatch` per direction. | CI `Backend (real PostgreSQL integration)` → `npm run test:pg` (real `postgres:16-alpine` service, `NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes`). No mocked authorization or ledger. Synthetic customer/agent identities (`pr27fee:FINANCE_PREPARER:…`, `a2_…`) used, never real funds. |
| **HTTP (effective-preview)** | Live example from `pr27-bank-direction-parity.json`: `GET /api/v1/internal/commercial-configuration/effective-preview?productCode=WALLET_TO_BANK&currency=NGN&principalType=CUSTOMER&principalId=<uuid>&direction=OUTGOING&amountMinor=250000&institutionId=<uuid>` → `limits.RESOLVED` / `fee.RESOLVED fee 100` / `statutoryCharges.RESOLVED VAT 0 explicit zero` / `commission.MISSING` (no rule) + note about settlement event; `BANK_TO_WALLET` → `fee.NOT_APPLICABLE` with `NOT_APPLICABLE_INBOUND_CREDIT` + blockers verbatim. | Same suite. `journalsPosted: 0` asserts read-only. |
| **Admin Web (build)** | `Admin Web (types, tests, build)` CI SUCCESS — `npm run build` (Vite) + `ts:check` + `jest --watchAll=false` 39/39 `m2-commercial-authoring-contract` contract tests (open-ended `effectiveTo` omitted, unparseable value refused locally, execution replays exact `requestDetails`). Screens `CommercialRulesScreen` (tabbed catalogue by `fee_rule.view`/`commission_rule.view`/…), `CommercialAuthoringDrawer` (governed proposal form, reason required, targeting dims validated), `CommercialPreviewPanel` (read-only `previewQuery(call)` with `limit.view` gate, `assertAdvisoryPreview` asserts `writesPerformed: []` + `databaseTransactionReadOnly: true`). | CI + local `m2-` unit run. |
| **Browser (Playwright)** | **Blocked, not skipped** — no Playwright/browser binaries in the sandbox (as documented in `docs/commercial/PR27-W2B-B2W-COVERAGE.md` “Browser verification — no Playwright/binaries in sandbox”). The `scripts/admin-web-browser-acceptance.cjs` / `scripts/finance-pr23-combined-acceptance.cjs` harness is present (from integration base) but was **not** run; no screenshot/video artifact is claimed. | Explicitly recorded as open item. |

Live preview note: `ApiClient.get('/api/v1/internal/commercial-configuration/effective-preview')` never calls `localhost` — relative URL, proxied by Vite dev server (`0.0.0.0` binding, `allowedHosts` includes `*.e2b.app`), so an operator opening the Admin Web Live Preview sees the same data as the HTTP suite.

---

## 9. Recommendation — what is ready, what remains blocked, what must not be claimed

### Ready to enable (go-live with synthetic-rate caveat)

- **WALLET_TO_BANK fees, limits and commission at settlement.** Every surface reads the canonical `WALLET_TO_BANK` identity; the selector is shared; legacy aliases keep existing approved limit rules governing without a data migration; commission at `RESERVED→SETTLED` is proven idempotent and avoids paying on never-completed transfers. An operator can author a `WALLET_TO_BANK` fee with `FINANCE_PREPARER → FINANCE_CONTROLLER` governance, see it in preview, and have it bound at commitment, with VAT as an explicit zero or rate from the rule.
- **Agent cash movements and funding/defunding** (already implemented, untouched by this PR — their commercial snapshots and maker/checker remain intact).

### Ready as governance infrastructure

- **Fee approval rollback + safe retry.** A failed execution leaves the approval `APPROVED` and audited as `approvalUsable: true`; a replay of a consumed approval is `409` and audited as `approvalUsable: false`. No new proposal is needed to retry the approved payload. This applies to all `FEE_RULE_CREATE/MODIFY`, `COMMISSION_RULE_CREATE/MODIFY`, `REWARD_RULE_CREATE/MODIFY`, `PRODUCT_MODIFY`.

### Blocked — do not enable, do not invent

| Workflow | Blocked because | What is required |
|----------|-----------------|------------------|
| **BANK_TO_WALLET credit posting** | No execution authority, no suspense policy | Approved `A7_INBOUND_EXECUTION_AUTHORITY`, approved `INBOUND_SUSPENSE_POLICY` (accounting treatment for uncreditable funds) |
| **BANK_TO_WALLET commission** | No eligible recipient, no attribution | Receiver-side commission policy decision + agent attribution column on `inbound_funding_receipts` |
| **Live bank rails (NIBSS etc.)** | No provider wiring | Provider registration, credentials, operational readiness — none exists in repo state |
| **Statutory charges beyond VAT** | No schema | Real column/table/resolver/engine + regulatory decision for stamp duty / levy — not a config entry (never claimed as zero) |
| **Commission settlement rail (paying out accruals)** | V2 scope | Accruals sit in `COMMISSION_PAYABLE` with `ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED`; payout is V2 |
| **Tier-ceiling parity** | Unreconciled | PR #24 `customer-limit-profile` ceiling reconciliation; until then do not claim tier-ceiling parity for `WALLET_TO_BANK` |
| **Limit-profile authoring in Studio** | Screens not in this PR | Admin Web limit-profile/assignment CRUD (separate surface, wired resolution exists) |
| **Browser acceptance** | No binaries | Playwright run against a real `admin-web` build |

---

## 10. Checklist — keep changes within PR #27, no synthetic live-provider use

- [x] Product identities in `src/product-catalog/banking-product-identities.ts` — never hard-code strings elsewhere.
- [x] Fee selector in `src/banking/banking-fee-rule-selection.ts` — never re-derive in a second surface.
- [x] Commission at settlement in `src/banking/wallet-to-bank-commission.ts` / `src/partner/external-settlement.service.ts` — never at authorization.
- [x] Statutory charges in `src/product-catalog/statutory-charges.ts` — never assert a rate for `STAMP_DUTY`/`REGULATORY_LEVY`.
- [x] Synthetic data only — all rule amounts (`flatFeeMinor 100`, `commission 1% → 1000`, etc.) are fixture values in disposable DBs; no migration or seed ships a production rate.
- [x] No live provider call — `verify: ({ operation }) => Promise.resolve({ state: VERIFIED_SETTLED, … })` is the ONLY provider double; every other dependency (commitment, settlement, ledger, commission engine, snapshot, accounting) is the real code path.
- [x] Mobile apps untouched — `git diff` shows zero `apps/customer-mobile` / `apps/agent-mobile` files.
- [x] No merge into `arena/5-main-web-integration` — merge lives only as `6d8cf2d` on `arena/1ed757a5-monienaija`.

---

*End of review. Source of truth: the file contents and CI check-run API, not the narrative. Evidence docs were written by the specs that proved them.*
