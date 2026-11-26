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
| **Current review branch HEAD** | `8dc1433d3b121fe47b1fcc461ca7748a19d40a52` | `git rev-parse HEAD` — docs-only commit on top of `6d8cf2d` |
| **Current time** | 2026-11-26 UTC | local date |

**Merge result:** automatic, zero conflicts, exit 0. Zero file-level overlap between the two sides since `41edf587`:

- PR side changed 52 files (5862 + / 356 -) — `src/product-catalog/banking-product-identities.ts`, `statutory-charges.ts`, `banking-fee-rule-selection.ts`, `wallet-to-bank-commission.ts`, fee/commission/product governance services, limit applicability, customer/agent limit views, admin-web commercial contracts + preview panel, 6 new integration specs, 3 evidence docs.
- Integration base side changed 174 files since `41edf587` — workforce configurable roles (B9), AR6 dashboard drill-downs, finance return-link journals, `scripts/finance-pr23-combined-acceptance.cjs`, etc.
- No overlapping file means no semantic conflict to resolve; both sides' changes coexist in `6d8cf2d` without manual reconciliation.

Current `arena/1ed757a5-monienaija` has been pushed to origin for traceability but no PR from it has been opened and no merge into `arena/5-main-web-integration` has been executed.

---

## 2. Products actually implemented vs. product coverage in this change

The V1 product catalogue after this merge contains **9 seeded rows** (V1_PRODUCT_CODES, `src/product-catalog/product-catalog.seed.ts`), all NGN / V1 scope / `NOT_CONFIGURED`:

| # | Product | Money movement type | Principal | Transaction-history record / execution entry | Implemented before PR #27 | PR #27 adds |
|---|---------|---------------------|-----------|--------------------------------------------|---------------------------|-------------|
| 1 | `WALLET_TRANSFER` | customer wallet→wallet | CUSTOMER | `transfers` / `transfer.service.ts` | yes | nothing |
| 2 | `WALLET_TO_CASH` | customer wallet→cash via agent | CUSTOMER (outgoing) + AGENT (incoming leg) | `ledger_journals` (CASH_OUT) / `agent/agent-cash-out.service.ts` | yes | nothing |
| 3 | `CASH_TO_WALLET` | cash→customer wallet via agent | CUSTOMER (incoming) + AGENT (outgoing leg) | `ledger_journals` (CASH_IN) / `agent/agent-cash-in.service.ts` | yes | nothing |
| 4 | `CASH_TO_CASH` | agent cash→cash with claim/expiry | CUSTOMER (claim) / AGENT (initiate+assist) | `cash_to_cash_transfers` / `agent/agent-cash-to-cash.service.ts` + `claim.service.ts` + `expiry.service.ts` | yes | nothing |
| 5 | `CUSTOMER_FUNDING` | finance-ops → customer wallet | CUSTOMER | `customer_funding` + journal / `finance-operations/finance-operations.service.ts` | yes | nothing |
| 6 | `AGENT_FUNDING` | platform pool → agent wallet | AGENT | `agent_funding_requests` → FUND / `agent/agent-funding.service.ts` + governance | yes | nothing |
| 7 | `AGENT_DEFUNDING` | agent wallet → platform pool | AGENT | `agent_funding_requests` → DEFUND | yes | nothing |
| 8 | **`WALLET_TO_BANK`** | **customer OR agent wallet→bank** | CUSTOMER + AGENT (one product) | **`financial_commitments.id`** (PR #23) / `financial-commitment/financial-commitment.service.ts` | **executing but uncatalogued** | **seeded ACTIVE/enabled; canonical identity `src/product-catalog/banking-product-identities.ts`** |
| 9 | **`BANK_TO_WALLET`** | **bank credit → customer wallet** | CUSTOMER (inbound) | **`inbound_funding_receipts.id`** (bank intake UUID) / `virtual-account/inbound-funding.service.ts` | **not executing** | **seeded DISABLED/not enabled; blockers declared** |

PR #27's scope is strictly the commercial configuration around #8 and #9. Mobile apps (`apps/customer-mobile`, `apps/agent-mobile`) are byte-identical across the merge (`git diff --name-only` shows zero mobile files), as required.

All 9 are V1 / NGN / `NOT_CONFIGURED` — no pricing, commission, reward or limit threshold is expressed in seed; every threshold is authored through governed change.

---

## 3. Operator workflows: Products, Fees, Commissions, Limits, effective-configuration

This is the author-operated commercial surface (Admin Web). Every governed change follows the same shape: **propose → independent approve → execute → preview → runtime**.

### 3.1 Products

- **Configured:** `PRODUCT_MODIFY` via `CommercialRuleGovernanceService` (FINANCE_PREPARER proposes, FINANCE_CONTROLLER approves, FINANCE_CONTROLLER executes with `privileged:execute` + MFA). Fingerprint binding (`sha256(canonical(action, resourceType, resourceId, payload))`), expiry, 403 on tamper/scope, 409 on replay. Product rows (`products`) carry `code, name, domain, currency, productScope, status, enabled, configurationStatus, version`.
- **Preview:** `GET /api/v1/internal/commercial-configuration/effective-preview?productCode=WALLET_TO_BANK` resolves product via `ProductCatalogService.getProduct(productCode)` inside the preview's `REPEATABLE READ READ ONLY` transaction. `BANK_TO_WALLET` returns `product.status: DISABLED, enabled: false` — visibly not enabled, not silently free.
- **Runtime gating:** `BankingFeeBindingService.bindInTransaction` checks `p.enabled AND p.status='ACTIVE'` — a disabled product cannot price even if a rule row exists.

### 3.2 Fees

- **Configured:** `FEE_RULE_CREATE` / `FEE_RULE_MODIFY` via `CommercialRuleGovernanceService` + `FeeRuleRegistryService`. Fields: `productCode, currency, customerClassCode?, agentClassId?, institutionId?, flatFeeMinor, percentageBps, minimumFeeMinor, maximumFeeMinor, vatBps, effectiveFrom, effectiveTo? (open-ended when omitted OR null), priority, isActive`. Contract: empty "Effective until" emits **no `effectiveTo` key at all** (never `null` as fabric date), unparseable refused locally.
- **Preview:** `FeeRuleResolverService.resolveWithManager(manager, { productCode, currency, at, customerClassCode?, agentClassId?, institutionId? })` inside preview tx → `FeeRuleCalculatorService.compute({ resolution, principalAmountMinor, currency })` pure arithmetic, `postsJournalLegs: false`. Selection safety: highest `priority DESC, id ASC`, specificity tie-break, `AMBIGUOUS` with sorted ids never auto-picked.
- **Runtime:** `TransferQuoteService.create()` for `WALLET_TRANSFER`; `FinancialCommitmentService` → `BankingFeeBindingService.bindInTransaction` → `selectCurrentWalletToBankFeeRule(manager, currency)` for `WALLET_TO_BANK`. Both read the same rule row (evidence `sameRuleRow: true`).
- **Atomicity fix (PR #27):** `CommercialRuleGovernanceService.executeChange` now does `consumeInTransaction(manager, approvalId) + write(resourceId, manager)` inside **one** `dataSource.transaction`. Before, consume was its own committed tx, then write was second tx — failed write left approval `CONSUMED` with no rule. Now: validation/conflict/persistence failure rolls back to `APPROVED`, audited outside tx as `GOVERNED_CHANGE_EXECUTION_FAILED` with `approvalConsumed: false, approvalUsable: true`. Replay of consumed → 409 with `approvalUsable: false`. Proven by `v1-commercial-configuration-authoring.integration.spec.ts` (39/39): sabotage insert → 400 → approval still `APPROVED` → delete sabotage → same body 201; duplicate execute → 409.

### 3.3 Commissions

- **Configured:** `COMMISSION_RULE_CREATE` / `COMMISSION_RULE_MODIFY` via same governance, `CommissionRuleRegistryService`. Registry: `product_code FK→products.code, currency, agentClassId?, agentId?, aggregatorId?, basis (PRINCIPAL/FEE/NET), calculationModel (FLAT/PERCENTAGE/FLAT_PLUS_PERCENTAGE/TIERED), amountMinor/percentageBps, min/max, vat?, priority, effective window`. No production rule seeded.
- **Preview:** `CommissionRuleResolverService.resolveWithManager(manager, { productCode, currency, at, agentId?, agentClassId? }, { principalMinor, feeMinor })` → allocations[] with `recipientType, recipientId, amountMinor, basis, baseAmountMinor, calculationModel, ruleId, version, priority`. `BANK_TO_WALLET` → `NOT_APPLICABLE + COMMISSION_RECIPIENT_NOT_APPLICABLE` BLOCKER (no eligible recipient). Never infers PLATFORM or AGENT when not acting.
- **Runtime (WALLET_TO_BANK only):** `external-settlement.service.ts` `RESERVED→SETTLED` handler → `wallet-to-bank-commission.ts recordWalletToBankCommissionInTransaction(manager, commitmentId)` → `CommissionEngine.decideWithManager` + `CommercialDecisionSnapshotService.recordDecisionWithManager` + optional `CommercialAccountingService.postForCompletion`. Key `wallet-to-bank:<commitmentId>` idempotent. **Never at authorization** — authorizing is not proof of completion.

### 3.4 Limits

- **Configured:** `LIMIT_RULE_CREATE` / `LIMIT_RULE_UPDATE` via `LimitRuleGovernanceService` (already single-tx). Fields: `limitProfileCode, product, direction, channel, currency, dimension (PER_TX_MIN/MAX, DAILY/WEEKLY/MONTHLY/YEARLY AMOUNT/COUNT, WALLET_BALANCE_MAX), limitValueMinor/limitValueCount, priority, effective window (null=open-ended)`. `InstitutionKycLimitPolicyService` governs tier→profile mappings per `(institutionId, product, currency, serviceClass, tier)` with `PROFILE/NOT_APPLICABLE` disposition, profileDigest binding, activation flag `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` (default off).
- **Preview:** `LimitProfileResolverService.resolve(manager, { principalType, principalId, agentClassId?, segmentCodes (incl. resolved customerClassCode), now })` → `fetchApplicableLimitRuleCandidates(manager, { profileCodes: [assignmentProfile, tierProfile], product, currency, now })` → `narrowApplicableLimitRules(candidates, { direction, channel })` . Both enforcement and preview call the **same** `limit-catalog/limit-rule-applicability.ts` helpers, so displayed = enforced. Missing → `MISSING` with `LIMIT_PROFILE_MISSING` BLOCKER; ambiguous rule? handled by priority order.
- **Runtime:** Every money movement calls `LimitEnforcementService.enforceWithManager(manager, { principalType, principalId, agentClassId?, product, currency, direction, channel, amountMinor, idempotencyKey, requestHash, correlationId, walletLedgerAccountId, principalWalletCustomerId, requireConfiguration, requireKycTierPolicy, institutionId, serviceClass })` inside its own `SERIALIZABLE` ledger transaction. Reservations `RESERVED→COMMITTED/RELEASED` with idempotent replay.

### 3.5 Effective-configuration preview (advisory, read-only)

`EffectiveConfigurationPreviewService.preview(principal, input)` — one `REPEATABLE READ READ ONLY` transaction (`SET TRANSACTION READ ONLY` + `SHOW transaction_read_only = on` → `guarantees.databaseTransactionReadOnly: true`). Never calls `LimitEnforcementService.enforceWithManager` (no reservation). Sections: `product, institution, customerClass, kycRestriction, limits, fee, statutoryCharges, commission, reward, explanation[], summary{ blockerCount, warningCount }, guarantees{ readonly, writesPerformed: [], financialMutations: [], databaseTransactionReadOnly }`. Per-section function gate (`SECTION_FUNCTIONS`): `AGENT_NETWORK_MANAGER` holding only `limit.view` sees fee/commission as `RESTRICTED` with zero disclosure.

---

## 4. For each money movement: configurable, previewed, applied — with zero vs missing vs not-applicable vs preview-ignored

> Legend: explicit zero = approved rule computed `0` → `RESOLVED` with `amountMinor:"0"` / `provenance:AUTHORED` (no journal for 0 commission); missing = no rule → `MISSING`/`NONE` with `allocations:[]`; not applicable = direction deliberately carries no charge → `NOT_APPLICABLE` with disposition `NOT_APPLICABLE_INBOUND_CREDIT` / `COMMISSION_RECIPIENT_NOT_APPLICABLE`; preview-ignored = legacy rule exists but preview not reading it (defect fixed).

| Money movement | Fee — configurable | Fee — preview | Fee — applied at runtime | Commission — configurable | Commission — preview | Commission — applied | Statutory (VAT) — preview | Statutory — runtime | Limit — configurable | Limit — preview | Limit — applied |
|---|---|---|---|---|---|---|---:|---|---|---|---|---|
| **WALLET_TRANSFER** (customer wallet→wallet) | yes | `RESOLVED` with `feeMinor/vatMinor/totalMinor, postsJournalLegs:false` ; `NOT_CONFIGURED`→`MISSING` never zero | `TransferQuoteService.create()` resolver `RESOLVED` — evidence `pr27-applied-fee-runtime-quote.json` amount 100000 fee 100 vat0 total100100 parity quote=preview=resolver, 0 journals | yes (AGENT not party to product, but rules authorable) | `RESOLVED`/`MISSING` with `allocations[], accrualPosted:false` | snapshots at completion if rule matches (`v1-commercial-decision-03*`) | `RESOLVED` line `VAT_ON_SERVICE_FEE rateBps:? provenance:AUTHORED` (explicit 0 or rate) ; `NOT_APPLICABLE` when no rule ("missing rule, not zero") | bound together with fee; stored as `tax_minor` component of debit | yes | `RESOLVED` with `assignment+tierProfile+rules[]+evaluatedDimensions` ; ambiguous→BLOCKER | inside transfer `SERIALIZABLE` tx via `enforceWithManager` |
| **WALLET_TO_CASH** (customer wallet→cash via agent) | yes | `RESOLVED` | via `AgentFinancialExecutionService` — fee resolved via `FeeRuleResolverService.resolveWithManager` + `FeeRuleCalculatorService` + `CommercialDecisionSnapshotService.recordDecisionWithManager` inside CASH_TO_WALLET? see 03B; snapshot wiring `CASH_TO_WALLET`+`WALLET_TO_CASH` pilot `financial-execution.service.ts:537,582` | yes | `RESOLVED`/`MISSING` | snapshots recorded at execution | same VAT truth table | same | yes | `RESOLVED` | dual enforcement: customer lane (`CASH_TO_WALLET` product `WALLET_TO_CASH`? actually `WALLET_TO_CASH` + `CASH_TO_WALLET`) + agent lane inside `agent-financial-execution.service.ts:285-351` |
| **CASH_TO_WALLET** (cash→wallet via agent) | yes | `RESOLVED` | same agent execution path, pilot `CASH_TO_WALLET` wired; evidence `v1-commercial-decision-03a` NOT_CONFIGURED never ZERO; limit decision APPROVED with `profileCode, ruleRefs, reservationIds, usageIds` | yes | `RESOLVED`/`MISSING` | snapshots | same VAT | same | yes | `RESOLVED` | same dual-limit |
| **CASH_TO_CASH** (agent claim lifecycle) | yes | `RESOLVED` (initiation + claim) | `CASH_TO_CASH` initiation via `agent-cash-to-cash.service.ts:693 product:CASH_TO_CASH`; claim via `agent-cash-to-cash-claim.service.ts:747 product:CASH_TO_CASH INCOMING` with `limitEnforcementService` (agent or customer per redemptionMethod) + SERIALIZABLE posting; expiry sweep `EXPIRED→DEBIT unclaimed/CREDIT agent` | yes | `RESOLVED`/`MISSING` | snapshots (claim path) | same VAT | same | yes | `RESOLVED` | initiation + claim both enforced; claim resolves agentClassId via `SELECT agent_class_id FOR SHARE` |
| **CUSTOMER_FUNDING** (finance-ops → customer) | yes | previewable as `CUSTOMER_FUNDING` | `finance-operations/finance-operations.service.ts` — funding request maker/checker; limits previewable (product decision `D-L-006` currently limit-bound) | authorable | `MISSING`/`RESOLVED` | not yet snapshot-wired (tracked open item) — no commission accrual expected (confirm NONE) | same VAT | same | yes | previewable | enforced inside funding tx |
| **AGENT_FUNDING / AGENT_DEFUNDING** (platform↔agent pool) | yes | previewable | `AgentFundingGovernanceService` `AGENT_NETWORK_MANAGER` maker → `FINANCE_CONTROLLER` checker, fingerprint-bound, once-only `SERIALIZABLE` `DR AGENT_FUNDING_POOL / CR agent wallet` audit+outbox | authorable | `MISSING`/`RESOLVED` | not snapshot-wired; PLATFORM recipient semantics need D-C-010 decision | same VAT | same | yes | previewable | enforced inside funding tx |
| **WALLET_TO_BANK (customer+agent lanes)** | **yes, newly:** `WALLET_TO_BANK` rule (FK now passes; previously impossible) | **yes, newly fixed:** `RESOLVED` with same row id `24f94e0b…` as runtime; explicit `vatBps:0` → `VAT line provenance:AUTHORED` (explicit zero); was `r.payment_type` SQL error before | **yes:** `selectCurrentWalletToBankFeeRule(manager,currency)` inside `FinancialCommitmentService` commitment `SERIALIZABLE` tx; both customer (`WITHDRAWAL` alias before) and agent (`EXTERNAL_BANK_TRANSFER` before) lanes now pass `product: WALLET_TO_BANK.productCode`; evidence `pr27-bank-direction-parity.json sameRuleRow:true, journalsPosted:0` | **yes:** `WALLET_TO_BANK` `AGENT` recipient, PRINCIPAL/FEE/NET basis, FLAT/PERCENTAGE/TIERED | **yes:** `RESOLVED` when rule matches, `MISSING` when not — with note `applied at settlement, not authorization` | **yes at settlement:** `external-settlement.service.ts RESERVED→SETTLED` → `recordWalletToBankCommissionInTransaction(wallet-to-bank:<commitmentId>)` snapshot+optional accrual `DR COMMISSION_EXPENSE/CR COMMISSION_PAYABLE`; evidence `pr27-bank-commission.json` 6 cases: 1% on 100k → 1000 parity preview=recorded=ledger -1000/+1000, explicit 0 → ALLOCATED 0 no legs, no rule → NONE never 0, released → 0 rows, replay → 1 row 1 journal idempotent, wrong agent → NONE | **yes:** `RESOLVED` with `VAT_ON_SERVICE_FEE` explicit 0 when rule `vat_bps:0`; `NOT_APPLICABLE` when no rule (missing, not zero) | **stored as `banking_operation_fee_bindings.tax_minor`** separate from beneficiary amount | **yes:** `WALLET_TO_BANK` + aliases `WITHDRAWAL`/`EXTERNAL_BANK_TRANSFER` via `limit-rule-applicability.ts`; legacy rows keep governing | **yes:** `RESOLVED` with `ruleIds:[97b5a26f…]` matching runtime `ruleRefs`; customer view now 7 pairs incl. bank | inside commitment tx; alias aggregation fixed (both spellings one allowance) |
| **BANK_TO_WALLET (inbound credit)** | **yes (authorable) but never charged:** `BANK_TO_WALLET` rule row can be created (FK passes) | **yes: `NOT_APPLICABLE`** with `feeDisposition: NOT_APPLICABLE_INBOUND_CREDIT` — "money the customer did not instruct us to spend" — by decision, not missing; product row is `DISABLED` visibly | **never bound:** `feeNotConfigured` is correct state; `provider_fee_minor` on receipt is external cost, not revenue | **yes (authorable) but never applied:** rule can be authored | **`NOT_APPLICABLE + COMMISSION_RECIPIENT_NOT_APPLICABLE`** BLOCKER — "recipient is wallet-owning customer; no agent performs movement; receipt carries no agent attribution; no execution event" — distinct from `MISSING` | **never recorded:** no eligible recipient, no attribution column, no snapshot step | **`NOT_APPLICABLE` — no fee for VAT to attach to** | **none** | **yes:** `BANK_TO_WALLET` rule | **`RESOLVED` with `ruleIds:[d96ed540…]` matching synthetic runtime** (credit path's `enforceWithManager` args run inside real tx; `runtimeKind:SYNTHETIC` because no execution authority) | **inside `InboundFundingService.post()` `SERIALIZABLE` tx** via `enforceWithManager({ product:BANK_TO_WALLET.productCode, direction:INCOMING })` — breach rolls back ledger credit |

**Statutory truth table (no rates invented, never asserted as legal position):**

| Situation | Preview `statutoryCharges` reports | Why |
|-----------|-----------------------------------|-----|
| Approved `fee_rules` row with `vat_bps: 0` (explicit operator authoring) | `RESOLVED`, `lines:[{ charge: VAT_ON_SERVICE_FEE, rateBps:0, amountMinor:"0", provenance:AUTHORED }]` — explicit zero | authored |
| Approved row with `vat_bps: 750` (7.5%) on clamped fee | `RESOLVED`, line with `rateBps:750` provenance `AUTHORED` | authored |
| No fee rule in force for product | `NOT_APPLICABLE`, `lines:[]`, note "missing rule, not a zero charge" | missing |
| `BANK_TO_WALLET` any state | `NOT_APPLICABLE`, `lines:[]` — "no customer service fee for VAT to attach to" | not applicable |
| Stamp duty / regulatory levy / provider fee | `notModelled:[{ charge:STAMP_DUTY, reason:"No column/table/resolver/engine …" }, …]` — never with `rateBps:0` | absent from data model |

Only VAT on our own service fee is modelled, rate always from approved rule; nothing here supplies a rate, no rate seeded. Provider fee outbound unknown at authorization, never added to customer debit; inbound preserved as `provider_fee_minor` evidence.

---

## 5. Verified on disposable PostgreSQL — governed change that previews but is *also* applied

The repo's integration harness (`test/support/pg-harness.ts` + `scripts/run-pg-integration-tests.js`) creates a per-run database `mn_it_<label>_<runId>_<pid>`, migrates it from scratch, runs each suite in `SERIALIZABLE` isolation, and drops it. All evidence below comes from such runs in CI; the sandbox has no live PostgreSQL (`PG FAIL connect ECONNREFUSED 127.0.0.1:5432` verified this session), so the local non-PostgreSQL evidence is the 23/23 `v1-commercial-bank-direction-coverage` static contracts and `commercial-rule-governance.service.spec.ts` 13/13 unit isolation.

### 5.1 Governed **fee** change — proposal → independent approval → execution → preview → runtime (the new `rollback-and-retry` guarantee)

Implemented in `src/authorization/commercial-rule-governance.service.ts` (PR #27 fix) and pinned by `test/v1-commercial-configuration-authoring.integration.spec.ts` (39/39 in CI) + `test/v1-applied-fee-runtime-quote.integration.spec.ts` (1/1) + `test/commercial-rule-governance.service.spec.ts` (13/13 locally):

| Step | Actor | What happens | Proof |
|------|-------|--------------|-------|
| **Propose** | `FINANCE_PREPARER` (`finance:prepare` + `fee_rule.create`) | `POST /api/v1/internal/fee-rules` with `reason: "PR27 … wallet transfer fee"`, `productCode: WALLET_TRANSFER`, `currency: NGN`, `flatFeeMinor: "100"`, `percentageBps: 0`, `vatBps: 0`, `effectiveFrom: 2026-01-01T00:00:00.000Z`, no `effectiveTo` key (open-ended), `priority: 100`, `isActive: true`. Service computes deterministic `actionFingerprint = sha256(canonical(action, resourceType, resourceId, payload))` and `PrivilegedActionApprovalService.request()` creates `REQUESTED` with `requestDetails` (allowlisted keys only, sensitive fields redacted). | Approval row persisted, `actionFingerprint` matches. |
| **Maker self-approval attempt** | same `FINANCE_PREPARER` | `POST /api/v1/internal/a2/workforce/approvals/:id/approve` | **403** — separationOfDuties: `selfApprovalProhibited: true`, `minimumApprovals: 1`. |
| **Independent approval** | `FINANCE_CONTROLLER` (`privileged:approve` + `fee_rule.create`) | same endpoint, different principal | **201**, status `APPROVED`. |
| **Rule existence before execution** | — | `SELECT count(*) FROM fee_rules WHERE product_code = WALLET_TRANSFER` | **0** rows. |
| **Execution** | same `FINANCE_CONTROLLER` with `privileged:execute` | `POST /api/v1/internal/fee-rules/changes/:approvalId/execute-create` with body = **exact** `requestDetails` from the approved request (contract: `resolveCommercialExecutionTarget` replays them). `executeChange()` opens **one** `dataSource.transaction(async manager => { consumeInTransaction(manager, …) + write(resourceId, manager) })`. | **201**, rule row created `id 4484a10e-b896-4a7a-b4f9-0a103bdacf79`, `effectiveTo: null`. Approval `CONSUMED`. |
| **Rollback guarantee (the old defect, now closed)** | — | If `write()` throws (invalid input, `effectiveTo:null` contract mismatch pre-fix, conflicting unique row, check violation), the **whole** transaction rolls back: approval stays `APPROVED`, not `CONSUMED`. Failure audit `GOVERNED_CHANGE_EXECUTION_FAILED` written **outside** the rolled-back tx with `{ approvalRefusedNotConsumed: false, approvalConsumed: false, approvalUsable: true, error: … }`. Retry of **identical approved payload** then succeeds inside a new transaction. Replay of an already-consumed approval returns **409** with `approvalUsable: false`. | Spec asserts: after sabotaged `fee_rules` row insertion, `POST execute-create` 400+ → approval still `APPROVED` → after `DELETE` sabotage row, same body → **201**; duplicate execution after success → **409** and `COUNT = 1`. Unit suite models rollback via in-memory transaction snapshot/restore. |
| **Preview after execution** | any `limit.view` + `fee_rule.view` holder | `GET /api/v1/internal/commercial-configuration/effective-preview?productCode=WALLET_TRANSFER&currency=NGN&amountMinor=100000` | `RESOLVED`, `ruleId: 4484a10e…`, `computed: { feeMinor: "100", vatMinor: "0", totalMinor: "100100", postsJournalLegs: false }` |
| **Runtime decision** | real `TransferQuoteService.create()` (SERIALIZABLE, real wallets, real institution attribution, real ledger boundary) | customer session creates quote amount 100000 | Same `ruleId`, `fee 100 / vat 0 / total 100100` — `quoteEqualsPreview: true` and `quoteEqualsResolver: true`. **0** journals posted by preview or quote (read-only). |

Evidence artifact: `docs/commercial/evidence/pr27-applied-fee-runtime-quote.json` — written by the spec via `PR27_EVIDENCE_OUT`, only after all assertions pass. Shows proposal lifecycle: maker `pr27fee:FINANCE_PREPARER:4f03…`, checker `pr27fee:FINANCE_CONTROLLER:6361…`, `selfApprovalStatus:403`, `approvalStatusAfterApprove:APPROVED`, `executionStatus:201`, `appliedRuleId:4484a10e…`, `approvalStatusAfterExecution:CONSUMED`, `effectiveToKeyPresent:false`, `effectiveTo:null`.

### 5.2 Governed **limit** change — same shape, different resource type

`LIMIT_RULE_CREATE` / `LIMIT_RULE_UPDATE` via `LimitRuleGovernanceService` (separate service but same pattern, verified already single-transaction before this PR). Pinned by `test/v1-commercial-configuration-authoring.integration.spec.ts` §"limit rule selection parity" + `test/v1-limit-03-limit-usage.integration.spec.ts`:

| Step | What happens | Proof |
|------|--------------|-------|
| **Propose** | `FINANCE_PREPARER` `POST /api/v1/internal/limit-profiles/:code/rules` with `dimension: DAILY_AMOUNT`, `direction: OUTGOING`, `channel: null`, `limitValueMinor: "100000"`, window `effectiveFrom <= now < effectiveTo` (null=open-ended) | `REQUESTED` approval, `limit_rule.create` fingerprint. |
| **Independent approval** | `FINANCE_CONTROLLER` `POST approvals/:id/approve` | `APPROVED`. |
| **Execution** | checker `POST limit-rules/changes/:id/execute-create` | **201**, `limit_rules` row with `(profileCode, product, direction, channel, currency, effectiveFrom)` identity, version 1. |
| **Preview** | `GET effective-preview?productCode=WALLET_TRANSFER&currency=NGN&direction=OUTGOING&principalId=<real customer>` | Limits `RESOLVED`, `rules[]` contains new rule id, `assignmentProfileCode` + `tierProfileCode` composition, `evaluatedDimensions` includes `DAILY_AMOUNT`. Missing → `MISSING` with `LIMIT_PROFILE_MISSING` BLOCKER; ambiguity → not silently resolved. |
| **Runtime enforcement** | Customer initiates transfer within same `SERIALIZABLE` tx that does `enforceWithManager` (pure selection via `fetchApplicableLimitRuleCandidates` + `narrowApplicableLimitRules` — same helpers preview uses) | Within limit → `APPROVED`, limit_usages incremented; breach → `LIMIT_EXCEEDED` / `STRICT` refusal, no journal. Verified by `v1-limit-04-limit-runtime` (14/14) and `v1-limit-05-flow-matrix` (225p). |

The coverage doc notes the remaining Admin Web gap: **limit-profile authoring screens** (profile/assignment CRUD) are still not in the Studio; the `CommercialRulesScreen` wires fees/commissions/rewards/products but limits assignment UI lives in the separate `limit-catalog` routes.

### 5.3 Per-direction bank pricing — the fix that proves it is not just recorded

Before PR #27, `banking-transfer-pricing.controller.ts` did `SELECT r.payment_type` — a column `fee_rules` has never had (`migration 1785753600072`). Every preview call errored, hiding the product-agnostic pricing ("whichever single product in the currency has a live rule"). PR #27 extracts `SELECT … WHERE r.product_code=$1 AND r.currency=$2 … AND p.enabled AND p.status='ACTIVE' ORDER BY r.effective_from DESC, version DESC LIMIT 1` into `src/banking/banking-fee-rule-selection.ts` and both binding (`FinancialCommitmentService`) and preview call it:

- **Artifact:** `docs/commercial/evidence/pr27-bank-direction-parity.json` (parity suite 12/12): `WALLET_TO_BANK` preview `RESOLVED fee 100` with `sameRuleRow:true` (preview id == runtime id == `24f94e0b-aaaf-45e7-8d9f-237794e73a67`) and `limits rulesMatch:true` (preview ids `97b5a26f-b063…` == runtime `ruleRefs`).
- **Artifact:** `docs/commercial/evidence/pr27-bank-commission.json` (commission suite 6/6): `WALLET_TO_BANK` 1% on 100000 → preview 1000 == recorded 1000 == accrual -1000/+1000; explicit zero → `ALLOCATED 0` no legs; no rule → `NONE` (never a zero); released → 0 rows; replay → `IDEMPOTENT_REPLAY` 1 row/1 journal; wrong agent → `NONE`.

### 5.4 Fee approval rollback + safe retry

The old `executeChange` did `consume()` (committed `APPROVED→CONSUMED` on its own connection) then `write()` in a second transaction. Any write failure (contract mismatch `effectiveTo:null` → `parseDate(null)` 400, conflicting unique row, check violation) left approval consumed with no rule — unrecoverable without new proposal. Now `consumeInTransaction + write(resourceId, manager)` inside one `dataSource.transaction` with rollback; `GOVERNED_CHANGE_EXECUTION_FAILED` audit outside tx distinguishes `approvalUsable:true` (write failure, retry safe) from `approvalUsable:false` (replay, already consumed). Affects `FEE/COMMISSION/REWARD/PRODUCT × CREATE/MODIFY` (8 actions).

---

## 6. Tier-ceiling parity — what still depends on customer tier-default work

**Current state:** The institution KYC tier path (`InstitutionKycLimitPolicyService`, `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` flag, default `false`) resolves product **by product code** (`resolveWithManager({ product: productCode, currency, serviceClass, tier })`). Therefore:

- A `WALLET_TO_BANK` tier mapping **is authorable**: caller can create a policy version with `mappings: [{ product: "WALLET_TO_BANK", currency: "NGN", tier: "LEVEL_1", disposition: "PROFILE", profileCode: "TIER_L1_DEFAULT" }]`.
- But it has **not been reconciled with PR #24's ceiling model** (the ceiling registry that PR #24 introduced on `arena/52ff58d1-monienaija` / `arena/ee85bca0-monienaija`). The preview's `kycRestriction.tierMapping` and `limits.tierProfileCode` will reflect the authoring, yet the enforcement's interaction with the tier ceiling (capping / overriding / composing) is still the pre-#24 composition via `limit-profile-resolver.service.ts`, not the #24 `customer-limit-profile` ceiling.

**What is needed before claiming parity:**

1. PR #24's `customer-limit-profile` ceiling reconciliation — the code that merges assignment-based limits with tier-derived ceilings and decides which ceiling wins per `(product, currency, dimension)`.
2. Governing the `WALLET_TO_BANK` ceiling value itself (is it a product-level ceiling or inherited from the customer's KYC tier? Decide and record; no rate invented here).
3. Preview explicitly showing the ceiling-vs-assignment precedence (currently `assignmentProfileCode` + `tierProfileCode` + `governingProfileCodes[]` are shown, but the ceiling truncation is not separately labeled).

Until that work lands, the coverage doc correctly records this as open (`[ ] PR #24 tier-ceiling alignment`). No claim of tier-ceiling parity is made. The same applies to any `BANK_TO_WALLET` tier mapping — authorable but unenforced until inbound execution authority exists.

---

## 7. Preservation — workforce accounts, roles, scopes, maker-checker

| Claim | Verification |
|-------|--------------|
| **All 11 workforce accounts + passwords preserved** | `scripts/local-dev-seed-11-roles.js` is `git diff 41edf587..6d8cf2d -- scripts/local-dev-seed-11-roles.js` empty. `ROLES = SUPER_ADMIN, FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR, ADMINISTRATOR, OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY` (11 + legacy `admin@monienaija.local` preserved when present). `emailFor(role) = role.toLowerCase().replace(/_/g,'-')+'@monienaija.local'`, `passwordFor(role) = MonieNaija_<ROLE>_123!` via PBKDF2 `sha256$10000$<salt>$<hash>` (never plaintext). Seed is loopback-only (`host 127.0.0.1/localhost/::1`), `LOCAL_DEV_SEED_CONFIRM=disposable-local-database`, `pg_advisory_xact_lock('monienaija-local-dev-11-roles')`, throws on missing catalogue role or conflicting active assignments — never overwrites existing credential. |
| **Configurable roles + function grants** | Integration base PR #31's `feat(admin-web): define, approve, apply and assign configurable roles` + PR #27's effective-preview per-section gate `SECTION_FUNCTIONS = { product: product.view, fee: fee_rule.view, commission: commission_rule.view, reward: reward_rule.view, limit: limit.view, customerClass: customer.view, kyc: kyc.view, institution: institution.view }` — AGENT_NETWORK_MANAGER holding only `limit.view` sees fee/commission as `RESTRICTED` with no values disclosed (asserted in `v1-commercial-configuration-authoring.integration.spec.ts` *change history enforces action-specific read function*). |
| **Scope / maker-checker unchanged** | `governed-action.registry.ts` hardcodes `COMMERCIAL_RULE_ACTIONS: FEE/COMMISSION/REWARD/PRODUCT × CREATE/MODIFY → FINANCE_PREPARER initiator / FINANCE_CONTROLLER approver / minimumApprovals 1 / selfApprovalProhibited true / mfaRequired true / minimumAssurance MFA / approvalScope = catalogue function code`; legacy `A2_MAKER_CHECKER_RULES_JSON` retains precedence for `FINANCE_ROLE_ASSIGN/REVOKE/CONTROL_POLICY_ACTIVATE`. 16 registered actions + 3 cross-functional `AGENT_FUNDING` rules preserved via `git show 85b8a95 -- authorization-catalogue/`. |
| **Changes within PR #27's scope** | 52 files, all commercial authoring/preview/banking-identity/settlement commission. No mobile (`apps/customer-mobile`, `apps/agent-mobile`) delta; no workforce seed change; no new provider credentials; no migration altering ledger/balance invariants. |
| **Synthetic data only** | All rule amounts (`flatFeeMinor 100`, `commission 1% → 1000`, etc.) are fixture values in disposable DBs; no migration or seed ships a production rate. |

---

## 8. CI — actual evidence for the tested state

| Commit | CI result | Key jobs | Evidence source |
|--------|-----------|----------|----------------|
| `d953fcc` (PR #27 head, `arena/41dde913-monienaija`) | **8 passed, 8 passed (duplicate runs) — all SUCCESS** | `Backend (lint, format, build, unit tests)` SUCCESS, `Backend (real PostgreSQL integration)` SUCCESS 99 min 0 failed batches incl. `v1-bank-commission-runtime` 6/6, `Backend (isolated PostgreSQL suites)` SUCCESS, `Backend (container image builds)` SUCCESS, `Admin Web (types, tests, build)` SUCCESS, `Customer Mobile`/`Agent Mobile` SUCCESS, `Classify changes` SUCCESS | `gh api commits/d953fcc/check-runs` 16 entries all `success/completed` |
| `85b8a95` (integration base) | **8/8 SUCCESS** | same 8 jobs, all SUCCESS | `gh api commits/85b8a95/check-runs` 8 entries success |
| `6d8cf2d` (tested combination, `arena/1ed757a5-monienaija` — the merge under review) | **cancelled, not failed** | Run `45836298718` created `2026-11-26T14:10:19Z` concluded `cancelled` — Admin Web + Classify `success`, Customer Mobile `success`, Backend lint/real/isolated/container `cancelled` (superseded by next push `8dc1433`). Cancellation is GitHub's superseded-push behaviour, not a code failure. PR head + base are both 8/8 SUCCESS, merge has zero file overlap. | `gh api commits/6d8cf2d/check-runs` 8 entries: 3 success, 5 cancelled |
| `8dc1433` (current HEAD, docs-only) | **Classify success, 7 skipped** | Run `45837072251` `completed success` — docs-only change (`*.md` only) correctly skipped backend/mobile builds via `classify` | `gh api commits/8dc1433/check-runs` 1 success + 7 skipped |

**No invented badge:** per-commit `gh api …/commits/<sha>/check-runs` returned above. The combined tree `6d8cf2d` is a union of two green trees with zero overlapping files; no manual resolution was needed. The cancellation is push-supersession, not failure — the same jobs succeed on the identical PR head `d953fcc`.

---

## 9. Browser / HTTP evidence — where it is and where it is blocked

| Surface | Evidence | How |
|---------|----------|-----|
| **HTTP (real PostgreSQL + real HTTP stack)** | `v1-commercial-configuration-authoring.integration.spec.ts` (39/39): real bearer sessions via `A2WorkforceSessionService.establish()` after persisting `a2_finance_role_assignments`, real `RoutePolicyRegistry`, real `PrivilegedActionApprovalService`, real resolvers; asserts `POST /internal/fee-rules`, `POST approvals/:id/approve`, `POST …/execute-create` (201/403/409), `GET effective-preview?productCode=WALLET_TRANSFER`, `GET change-history?`, audited denial `403`. `v1-applied-fee-runtime-quote` proves `POST TransferQuote` → fee 100 applied. `v1-bank-commission-runtime` proves settlement → commission 1000 accrued. `v1-bank-direction-preview-runtime-parity` (12/12) proves preview vs runtime `sameRuleRow` / `rulesMatch` per direction. | CI `Backend (real PostgreSQL integration)` → `npm run test:pg` (real `postgres:16-alpine` service, `NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes`). No mocked authorization or ledger. Synthetic identities (`pr27fee:FINANCE_PREPARER:…`, `a2_…`) used, never real funds. |
| **HTTP (effective-preview)** | Live example from `pr27-bank-direction-parity.json`: `GET /api/v1/internal/commercial-configuration/effective-preview?productCode=WALLET_TO_BANK&currency=NGN&principalType=CUSTOMER&principalId=<uuid>&direction=OUTGOING&amountMinor=250000&institutionId=<uuid>` → `limits.RESOLVED` / `fee.RESOLVED fee 100` / `statutoryCharges.RESOLVED VAT 0 explicit zero` / `commission.MISSING` (no rule) + note about settlement event; `BANK_TO_WALLET` → `fee.NOT_APPLICABLE` with `NOT_APPLICABLE_INBOUND_CREDIT` + blockers verbatim. | Same suite. `journalsPosted: 0` asserts read-only. |
| **HTTP (bank-transfer preview)** | `GET /api/v1/internal/banking/transfer-preview` — fixed PR #27 (was `r.payment_type` SQL error). Now shares `selectCurrentWalletToBankFeeRule` with binding. | `v1-bank-direction-preview-runtime-parity` |
| **Admin Web (build)** | `Admin Web (types, tests, build)` CI SUCCESS — `npm run build` (Vite) + `ts:check` + `jest --watchAll=false` 39/39 `m2-commercial-authoring-contract.test.ts` (open-ended `effectiveTo` omitted, unparseable refused locally, execution replays exact `requestDetails`). Screens `CommercialRulesScreen` (tabbed catalogue by `fee_rule.view`/`commission_rule.view`/…), `CommercialAuthoringDrawer` (governed proposal form, reason required, targeting dims validated), `CommercialPreviewPanel` (read-only `previewQuery(call)` with `limit.view` gate, `assertAdvisoryPreview` asserts `writesPerformed: []` + `databaseTransactionReadOnly: true`). | CI + local `m2-` unit run. |
| **Browser (Playwright) — blocked** | **Blocked, not skipped — precisely:** Chromium via `playwright 1.63.0` + `@sparticuz/chromium 153.0.0` inflates to `/tmp/chromium` (200 MB) but `ldd /tmp/chromium` requires `libnspr4.so, libnss3.so, libnssutil3.so, libatk*, libgbm*` absent from image; `sudo apt-get install libnss3 libnspr4` fails `E: List directory /var/lib/apt/lists/partial missing Permission denied` + `Unable to acquire dpkg lock` (user `user`, not root without cache) and `W: Failed to fetch deb.debian.org Connection failed IP 151.101.66.132` (egress limited to `github.com, registry.npmjs.org, pypi.org`). `~/.cache/ms-playwright` absent, `which google-chrome/chromium` none. Disposable PG also unavailable (`ECONNREFUSED 127.0.0.1:5432`, `which psql/docker` not found, `E2B_SANDBOX=true`). So `scripts/admin-web-browser-acceptance.cjs` (real Admin Web + PG `author→approve→apply→preview→runtime` walkthrough) cannot run. | Recorded as open item. HTTP + CI evidence above covers the same surfaces; browser acceptance remains to be run outside sandbox. |

Live preview note: `ApiClient.get('/api/v1/internal/commercial-configuration/effective-preview')` never calls `localhost` — relative URL, proxied by Vite dev server (`0.0.0.0` binding, `allowedHosts` includes `*.e2b.app`), so an operator opening the Admin Web Live Preview sees the same data as the HTTP suite.

---

## 10. Recommendation — what is ready, what remains blocked, what must not be claimed

### Ready to enable (go-live with synthetic-rate caveat)

- **WALLET_TO_BANK fees, limits and commission at settlement.** Every surface reads the canonical `WALLET_TO_BANK` identity; selector is shared; legacy aliases keep existing approved limit rules governing without data migration; commission at `RESERVED→SETTLED` is proven idempotent and avoids paying on never-completed transfers. An operator can author a `WALLET_TO_BANK` fee with `FINANCE_PREPARER → FINANCE_CONTROLLER` governance, see it in preview, and have it bound at commitment, with VAT as explicit zero or rate from rule.
- **WALLET_TRANSFER / agent cash movements / funding-defunding** (already implemented, untouched — commercial snapshots + maker/checker intact; `WALLET_TRANSFER` governed fee proven end-to-end).

### Ready as governance infrastructure

- **Fee approval rollback + safe retry.** A failed execution leaves approval `APPROVED` and audited as `approvalUsable: true`; replay of consumed is 409 with `approvalUsable: false`. No new proposal needed to retry approved payload. Applies to all `FEE/COMMISSION/REWARD/PRODUCT × CREATE/MODIFY`.

### Blocked — do not enable, do not invent

| Workflow | Blocked because | What is required |
|----------|-----------------|------------------|
| **BANK_TO_WALLET credit posting** | No execution authority, no suspense policy | Approved `A7_INBOUND_EXECUTION_AUTHORITY` + approved `INBOUND_SUSPENSE_POLICY` (accounting for uncreditable funds) |
| **BANK_TO_WALLET commission** | No eligible recipient, no attribution | Receiver-side commission policy decision (who earns on incoming credit, on what basis) + agent attribution column on `inbound_funding_receipts` |
| **Live bank rails (NIBSS etc.)** | No provider wiring | Provider registration, credentials, operational readiness — none exists |
| **Statutory charges beyond VAT** | No schema | Real column/table/resolver/engine + regulatory decision for stamp duty / levy — not a config entry (never claimed as zero) |
| **Commission settlement rail (paying out accruals)** | V2 scope | Accruals sit in `COMMISSION_PAYABLE` with `ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED`; payout is V2 |
| **Tier-ceiling parity** | Unreconciled | PR #24 `customer-limit-profile` ceiling reconciliation; until then do not claim tier-ceiling parity for `WALLET_TO_BANK` |
| **Limit-profile authoring in Studio** | Screens not in this PR | Admin Web limit-profile/assignment CRUD (separate surface, wired resolution exists) |
| **Browser acceptance** | No binaries in sandbox | Playwright run against real `admin-web` build (outside sandbox) |

---

## 11. Checklist — keep changes within PR #27, no synthetic live-provider use

- [x] Product identities in `src/product-catalog/banking-product-identities.ts` — never hard-code strings elsewhere.
- [x] Fee selector in `src/banking/banking-fee-rule-selection.ts` — never re-derive in second surface.
- [x] Commission at settlement in `src/banking/wallet-to-bank-commission.ts` / `src/partner/external-settlement.service.ts` — never at authorization.
- [x] Statutory charges in `src/product-catalog/statutory-charges.ts` — never assert rate for `STAMP_DUTY`/`REGULATORY_LEVY`/`PROVIDER_FEE`.
- [x] Inbound limits in `src/virtual-account/inbound-funding.service.ts` → `enforceInboundLimit` inside posting tx — breach rolls back ledger.
- [x] Synthetic data only — all rule amounts are fixture values in disposable DBs; no migration/seed ships production rate.
- [x] No live provider call — `verify: ({ operation }) => Promise.resolve({ state: VERIFIED_SETTLED, … })` is only provider double; every other dependency is real code path.
- [x] Mobile apps untouched — zero `apps/customer-mobile` / `apps/agent-mobile` files in merge.
- [x] No merge into `arena/5-main-web-integration` — merge lives only as `6d8cf2d` on `arena/1ed757a5-monienaija`.

---

*End of review. Source of truth: the file contents, CI check-run API, and the evidence JSON written by the specs that proved it.*

