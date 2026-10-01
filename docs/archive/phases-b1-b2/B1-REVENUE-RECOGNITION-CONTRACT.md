# B1T08 — B1 Revenue-Recognition Engine, Tax / VAT Engine, and Cost-Accounting Engine Contract

- **Phase:** B1 — Commercial Platform
- **Task:** B1T08 — B1 Revenue-Recognition Engine, Tax / VAT Engine, and Cost-Accounting Engine
- **Contract:** `B1RevenueRecognitionEngineContractV1` / `B1RevenueRecognitionDecisionV1` / `B1RevenueRecognitionDecisionReplaySafeResultV1` / `B1TaxVatDecisionV1` / `B1TaxVatDecisionReplaySafeResultV1` / `B1CostAccountingDecisionV1` / `B1CostAccountingDecisionReplaySafeResultV1` / `B1RevenueRecognitionEngineCompatibilityResultV1` / `B1RevenueRecognitionDocumentVersioningContractV1` / `B1RevenueRecognitionDocumentPersistenceRecordV1` / `B1RevenueRecognitionEngineConsumerPortsV1`
- **ADR:** `ADR-0067 — B1 Revenue-Recognition Engine, Tax / VAT Engine, and Cost-Accounting Engine`
- **Status:** Accepted (B1T08 implementation)
- **Review snapshot:** `b1t08` (B1T08 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Purpose and boundary

B1T08 implements the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine for the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) established in [`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`](B1-COMMERCIAL-CATALOG-CONTRACT.md) (B1T02) and [`docs/B1-COMMERCIAL-PLATFORM-BASELINE.md`](B1-COMMERCIAL-PLATFORM-BASELINE.md) (B1T01). The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is the only B1 commercial-financial-recognition engine for revenue recognition, tax / VAT, and cost accounting. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is a deterministic commercial-financial-recognition engine that produces a durable B1 commercial-financial-recognition decision (revenue-recognition decision, tax / VAT decision, or cost-accounting decision) for a single commercial flow. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is a read-only recognition engine; the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine never posts a journal, mutates a balance, executes a settlement, executes a payout, redeems cashback, awards loyalty balances, redeems loyalty balances, executes referral rewards, creates a financial effect, repairs a binding, changes A4 policy / source records, modifies invoices, modifies statements, modifies commercial decisions, modifies pricing catalogs, modifies product state, or dispatches a notification.

The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine never overrides A4. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine never posts to Ledger and never bypasses A5 financial-invariants. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine never substitutes the A6 partner boundary. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine never substitutes the A7 product boundary. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is bounded by the B1T04 commercial decision; the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine consumes the B1T04 commercial decision read-only and never recalculates fee, commission, or revenue sharing. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is bounded by the B1T05 billing document; the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine consumes the B1T05 billing document read-only and never modifies invoices, statements, or other billing documents. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is bounded by the B1T06 commercial-incentive decision; the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine consumes the B1T06 commercial-incentive decision read-only and never substitutes or overrides the B1T06 commercial-incentive decision. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is bounded by the B1T07 commercial-rewards decision; the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine consumes the B1T07 commercial-rewards decision read-only and never redeems cashback, awards loyalty balances, redeems loyalty balances, or executes referral rewards.

The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

## 2. B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine contract

### 2.1 Contract identity

The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine contract is `B1RevenueRecognitionEngineContractV1` (frozen by [`docs/B1-IMPLEMENTATION-PLAN.md`](B1-IMPLEMENTATION-PLAN.md) §8 B1T08). The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine contract name is `B1-REVENUE-RECOGNITION-ENGINE`. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine contract version is `1`. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine contract document is `docs/B1-REVENUE-RECOGNITION-CONTRACT.md`.

### 2.2 B1 commercial-financial-recognition scope

The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is bounded to the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is the only B1 commercial-financial-recognition engine for the B1 first commercial scope.

### 2.3 B1 commercial-financial-recognition decision kind vocabulary

The B1 commercial-financial-recognition decision kind vocabulary is the canonical B1 commercial-financial-recognition decision kind vocabulary. The B1 commercial-financial-recognition decision kind vocabulary is:

- `REVENUE_RECOGNITION` — the B1 commercial-financial-recognition decision is a revenue-recognition decision.
- `TAX_VAT` — the B1 commercial-financial-recognition decision is a tax / VAT decision.
- `COST_ACCOUNTING` — the B1 commercial-financial-recognition decision is a cost-accounting decision.

The B1 commercial-financial-recognition decision kind vocabulary is the only B1 commercial-financial-recognition decision kind vocabulary; the B1 commercial-financial-recognition decision kind vocabulary does NOT introduce a second B1 commercial-financial-recognition decision kind vocabulary.

### 2.4 B1 commercial-financial-recognition decision outcome vocabulary

The B1 commercial-financial-recognition decision outcome vocabulary is the canonical B1 commercial-financial-recognition decision outcome vocabulary. The B1 commercial-financial-recognition decision outcome vocabulary is:

- `ELIGIBLE` — the B1 commercial-financial-recognition decision is eligible.
- `APPLIED` — the B1 commercial-financial-recognition decision is applied.
- `REJECTED` — the B1 commercial-financial-recognition decision is rejected.
- `REPLAYED` — the B1 commercial-financial-recognition decision is replayed from a duplicate request.

The B1 commercial-financial-recognition decision outcome vocabulary is the only B1 commercial-financial-recognition decision outcome vocabulary; the B1 commercial-financial-recognition decision outcome vocabulary does NOT introduce a second B1 commercial-financial-recognition decision outcome vocabulary.

### 2.5 B1 commercial-financial-recognition revenue-recognition state vocabulary

The B1 commercial-financial-recognition revenue-recognition state vocabulary is the canonical B1 commercial-financial-recognition revenue-recognition state vocabulary. The B1 commercial-financial-recognition revenue-recognition state vocabulary is:

- `DRAFT` — the B1 commercial-financial-recognition revenue recognition is in draft state.
- `PENDING` — the B1 commercial-financial-recognition revenue recognition is pending.
- `RECOGNIZED` — the B1 commercial-financial-recognition revenue recognition is recognized.
- `DEFERRED` — the B1 commercial-financial-recognition revenue recognition is deferred.
- `CANCELLED` — the B1 commercial-financial-recognition revenue recognition is cancelled.
- `RETIRED` — the B1 commercial-financial-recognition revenue recognition is retired.

The B1 commercial-financial-recognition revenue-recognition state vocabulary is the only B1 commercial-financial-recognition revenue-recognition state vocabulary; the B1 commercial-financial-recognition revenue-recognition state vocabulary does NOT introduce a second B1 commercial-financial-recognition revenue-recognition state vocabulary.

### 2.6 B1 commercial-financial-recognition tax / VAT state vocabulary

The B1 commercial-financial-recognition tax / VAT state vocabulary is the canonical B1 commercial-financial-recognition tax / VAT state vocabulary. The B1 commercial-financial-recognition tax / VAT state vocabulary is:

- `DRAFT` — the B1 commercial-financial-recognition tax / VAT is in draft state.
- `PENDING` — the B1 commercial-financial-recognition tax / VAT is pending.
- `ASSESSED` — the B1 commercial-financial-recognition tax / VAT is assessed.
- `EXEMPTED` — the B1 commercial-financial-recognition tax / VAT is exempted.
- `DECLARED` — the B1 commercial-financial-recognition tax / VAT is declared.
- `CANCELLED` — the B1 commercial-financial-recognition tax / VAT is cancelled.
- `RETIRED` — the B1 commercial-financial-recognition tax / VAT is retired.

The B1 commercial-financial-recognition tax / VAT state vocabulary is the only B1 commercial-financial-recognition tax / VAT state vocabulary; the B1 commercial-financial-recognition tax / VAT state vocabulary does NOT introduce a second B1 commercial-financial-recognition tax / VAT state vocabulary.

### 2.7 B1 commercial-financial-recognition cost-accounting state vocabulary

The B1 commercial-financial-recognition cost-accounting state vocabulary is the canonical B1 commercial-financial-recognition cost-accounting state vocabulary. The B1 commercial-financial-recognition cost-accounting state vocabulary is:

- `DRAFT` — the B1 commercial-financial-recognition cost-accounting is in draft state.
- `PENDING` — the B1 commercial-financial-recognition cost-accounting is pending.
- `ALLOCATED` — the B1 commercial-financial-recognition cost-accounting is allocated.
- `RECOGNIZED` — the B1 commercial-financial-recognition cost-accounting is recognized.
- `AMORTIZED` — the B1 commercial-financial-recognition cost-accounting is amortized.
- `CANCELLED` — the B1 commercial-financial-recognition cost-accounting is cancelled.
- `RETIRED` — the B1 commercial-financial-recognition cost-accounting is retired.

The B1 commercial-financial-recognition cost-accounting state vocabulary is the only B1 commercial-financial-recognition cost-accounting state vocabulary; the B1 commercial-financial-recognition cost-accounting state vocabulary does NOT introduce a second B1 commercial-financial-recognition cost-accounting state vocabulary.

### 2.8 B1 commercial-financial-recognition auxiliary vocabularies

The B1 commercial-financial-recognition accounting basis vocabulary is: `CASH_BASIS`, `ACCRUAL_BASIS`, `MODIFIED_ACCRUAL_BASIS`, `REVENUE_RECOGNITION_BASIS`. The B1 commercial-financial-recognition recognition method vocabulary is: `POINT_IN_TIME`, `OVER_TIME`, `MILESTONE_BASED`, `PERCENTAGE_OF_COMPLETION`, `INSTALLMENT`, `DEFERRED`. The B1 commercial-financial-recognition tax category vocabulary is: `VAT`, `SALES_TAX`, `WITHHOLDING_TAX`, `SERVICE_TAX`, `EXCISE_TAX`, `EXEMPT`, `ZERO_RATED`, `OUT_OF_SCOPE`. The B1 commercial-financial-recognition tax jurisdiction vocabulary is: `NIGERIA_FEDERAL`, `NIGERIA_STATE`, `NIGERIA_LGA`, `WEST_AFRICA_REGION`, `AFRICA_REGION`, `GLOBAL`. The B1 commercial-financial-recognition cost category vocabulary is: `DIRECT_COST`, `INDIRECT_COST`, `ACQUISITION_COST`, `OPERATIONAL_COST`, `ALLOCATED_COST`, `OVERHEAD_COST`, `SUPPORT_COST`, `CAPITALIZED_COST`. The B1 commercial-financial-recognition cost allocation method vocabulary is: `DIRECT_ALLOCATION`, `STEP_ALLOCATION`, `RECIPROCAL_ALLOCATION`, `PROPORTIONAL_ALLOCATION`, `ACTIVITY_BASED_COSTING`, `STANDARD_COSTING`. The B1 commercial-financial-recognition eligibility vocabulary is: `CUSTOMER_ELIGIBLE`, `MERCHANT_ELIGIBLE`, `PARTNER_ELIGIBLE`, `PRODUCT_ELIGIBLE`, `TIER_ELIGIBLE`, `PERIOD_ELIGIBLE`, `RECOGNITION_BASIS_ELIGIBLE`, `TAX_POLICY_ELIGIBLE`, `COST_ALLOCATION_ELIGIBLE`.

### 2.9 B1 commercial-financial-recognition rule outcome vocabulary

The B1 commercial-financial-recognition rule outcome vocabulary is the canonical B1 commercial-financial-recognition rule outcome vocabulary. The B1 commercial-financial-recognition rule outcome vocabulary is:

- `PASS` — the B1 commercial-financial-recognition rule passed.
- `FAIL` — the B1 commercial-financial-recognition rule failed.
- `SKIP` — the B1 commercial-financial-recognition rule was skipped.
- `NOT_APPLICABLE` — the B1 commercial-financial-recognition rule was not applicable.

The B1 commercial-financial-recognition rule outcome vocabulary is the only B1 commercial-financial-recognition rule outcome vocabulary; the B1 commercial-financial-recognition rule outcome vocabulary does NOT introduce a second B1 commercial-financial-recognition rule outcome vocabulary.

### 2.10 B1 commercial-financial-recognition failure code vocabulary

The B1 commercial-financial-recognition failure code vocabulary is the canonical B1 commercial-financial-recognition failure code vocabulary. The B1 commercial-financial-recognition failure code vocabulary is:

- `B1_REVENUE_RECOGNITION_ENGINE_INVALID_COMMAND`
- `B1_REVENUE_RECOGNITION_ENGINE_INCOMPATIBLE`
- `B1_REVENUE_RECOGNITION_ENGINE_QUERY_UNAVAILABLE`
- `B1_REVENUE_RECOGNITION_ENGINE_PROHIBITED`
- `B1_REVENUE_RECOGNITION_ENGINE_DECISION_NOT_FOUND`
- `B1_REVENUE_RECOGNITION_ENGINE_DECISION_INCOMPATIBLE`
- `B1_REVENUE_RECOGNITION_ENGINE_CATALOG_INCOMPATIBLE`
- `B1_REVENUE_RECOGNITION_ENGINE_CATALOG_MISSING`
- `B1_REVENUE_RECOGNITION_ENGINE_BILLING_DOCUMENT_NOT_FOUND`
- `B1_REVENUE_RECOGNITION_ENGINE_BILLING_DOCUMENT_INCOMPATIBLE`
- `B1_REVENUE_RECOGNITION_ENGINE_A4_POLICY_DENIED`
- `B1_REVENUE_RECOGNITION_ENGINE_A3_BINDING_INVALID`
- `B1_REVENUE_RECOGNITION_ENGINE_A5_LEDGER_INVARIANT_BROKEN`
- `B1_REVENUE_RECOGNITION_ENGINE_A6_PARTNER_INCOMPATIBLE`
- `B1_REVENUE_RECOGNITION_ENGINE_A7_PRODUCT_INCOMPATIBLE`
- `B1_REVENUE_RECOGNITION_ENGINE_REPLAY_CONFLICT`
- `B1_REVENUE_RECOGNITION_ENGINE_REPLAY_EXPIRED`
- `B1_REVENUE_RECOGNITION_ENGINE_IN_PROGRESS`
- `B1_REVENUE_RECOGNITION_ENGINE_NUMBER_CONFLICT`
- `B1_REVENUE_RECOGNITION_ENGINE_EXPIRED`
- `B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_BASIS_INVALID`
- `B1_REVENUE_RECOGNITION_ENGINE_NOT_APPLICABLE`
- `B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_POLICY_MISSING`
- `B1_REVENUE_RECOGNITION_ENGINE_TAX_JURISDICTION_INVALID`
- `B1_REVENUE_RECOGNITION_ENGINE_COST_ALLOCATION_INVALID`
- `B1_REVENUE_RECOGNITION_ENGINE_DEFERRED_REVENUE_INVALID`

The B1 commercial-financial-recognition failure code vocabulary is the only B1 commercial-financial-recognition failure code vocabulary; the B1 commercial-financial-recognition failure code vocabulary does NOT introduce a second B1 commercial-financial-recognition failure code vocabulary.

## 3. B1 commercial-financial-recognition request, result, and replay

### 3.1 B1 revenue-recognition request and decision

The B1 revenue-recognition request and decision are analogous to the B1T05 billing engine billing request and decision. The B1 revenue-recognition request carries the B1 commercial-financial-recognition contract identity, the B1 commercial-financial-recognition revenue-recognition request identity, the B1 commercial-financial-recognition revenue-recognition request version, the B1 commercial-financial-recognition scope identity, the B1 commercial-financial-recognition period identity, the B1 commercial-financial-recognition period window, the B1 commercial-financial-recognition accounting basis, the B1 commercial-financial-recognition accounting unit, the B1 commercial-financial-recognition customer identity, the B1 commercial-financial-recognition customer tier, the B1 commercial-financial-recognition merchant identity, the B1 commercial-financial-recognition merchant tier, the B1 commercial-financial-recognition partner identity, the B1 commercial-financial-recognition partner tier, the B1 commercial-financial-recognition product identity, the B1 commercial-financial-recognition capability identity, the B1 commercial-financial-recognition plan identity, the B1 commercial-financial-recognition subscription identity, the B1 commercial-financial-recognition product entitlement identity, the B1 commercial-financial-recognition recognition policy reference, the B1 commercial-financial-recognition recognition schedule reference, the B1 commercial-financial-recognition recognition event reference, the B1 commercial-financial-recognition recognition method, the B1 commercial-financial-recognition deferred revenue amount, the B1 commercial-financial-recognition recognized revenue amount, the B1 commercial-financial-recognition revenue-recognition window, the B1 commercial-financial-recognition commercial decision reference, the B1 commercial-financial-recognition commercial decision idempotency key, the B1 commercial-financial-recognition billing document reference, the B1 commercial-financial-recognition campaign decision reference, the B1 commercial-financial-recognition promotion decision reference, the B1 commercial-financial-recognition coupon decision reference, the B1 commercial-financial-recognition referral decision reference, the B1 commercial-financial-recognition cashback decision reference, the B1 commercial-financial-recognition loyalty decision reference, the B1 commercial-financial-recognition idempotency key, the B1 commercial-financial-recognition request context, and the B1 commercial-financial-recognition causation id. The B1 commercial-financial-recognition revenue-recognition decision is the canonical B1 commercial-financial-recognition revenue-recognition decision; the B1 commercial-financial-recognition revenue-recognition decision is the only B1 commercial-financial-recognition revenue-recognition decision. The B1 commercial-financial-recognition revenue-recognition decision hash and replay hash are computed identically to the B1T05 billing document hash and replay hash pattern (hash payload excludes the random `decisionId` and the `generatedAt` timestamp).

### 3.2 B1 tax / VAT request and decision

The B1 tax / VAT request and decision are analogous to the B1 revenue-recognition request and decision, with the B1 tax / VAT policy reference, the B1 tax / VAT jurisdiction, the B1 tax / VAT category, the B1 tax / VAT exemption status, the B1 tax / VAT exemption reference, the B1 tax / VAT base amount, the B1 tax / VAT rate, the B1 tax / VAT evidence reference, and the B1 tax / VAT-specific metadata substituted for the B1 revenue-recognition equivalents. The B1 tax / VAT decision is the canonical B1 commercial-financial-recognition tax / VAT decision; the B1 tax / VAT decision is the only B1 commercial-financial-recognition tax / VAT decision. The B1 tax / VAT decision hash and replay hash are computed identically to the B1 revenue-recognition decision hash and replay hash.

### 3.3 B1 cost-accounting request and decision

The B1 cost-accounting request and decision are analogous to the B1 revenue-recognition request and decision, with the B1 cost-accounting policy reference, the B1 cost-accounting category, the B1 cost-allocation method, the B1 direct cost amount, the B1 indirect cost amount, the B1 acquisition cost amount, the B1 operational cost amount, the B1 allocated cost amount, and the B1 cost-accounting-specific metadata substituted for the B1 revenue-recognition equivalents. The B1 cost-accounting decision is the canonical B1 commercial-financial-recognition cost-accounting decision; the B1 cost-accounting decision is the only B1 commercial-financial-recognition cost-accounting decision. The B1 cost-accounting decision hash and replay hash are computed identically to the B1 revenue-recognition decision hash and replay hash.

### 3.4 B1 commercial-financial-recognition replay-safe decision engine

The B1 commercial-financial-recognition replay-safe decision engine is the canonical B1 commercial-financial-recognition replay-safe decision engine. The B1 commercial-financial-recognition replay-safe decision engine uses the B1 commercial-financial-recognition revenue-recognition internal idempotency scope (`b1.revenue-recognition-engine.revenue-recognition.idempotency.v1`), the B1 commercial-financial-recognition tax / VAT internal idempotency scope (`b1.revenue-recognition-engine.tax-vat.idempotency.v1`), the B1 commercial-financial-recognition cost-accounting internal idempotency scope (`b1.revenue-recognition-engine.cost-accounting.idempotency.v1`), the B1 commercial-financial-recognition internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial-financial-recognition idempotency key, and the B1 commercial-financial-recognition request hash (SHA-256 over the canonical request payload).

The B1 commercial-financial-recognition replay rules are:

1. The B1 commercial-financial-recognition replay window is 86_400 seconds (24 hours).
2. The B1 commercial-financial-recognition replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial-financial-recognition replay rule is idempotent (a duplicate lookup returns the durable original decision outcome).
4. The B1 commercial-financial-recognition replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial-financial-recognition replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial-financial-recognition replay rule inherits the A1-A7 replay rules.
7. The B1 commercial-financial-recognition replay rule inherits the B1T03 catalog replay rule.
8. The B1 commercial-financial-recognition replay rule inherits the B1T04 commercial decision replay rule.
9. The B1 commercial-financial-recognition replay rule inherits the B1T05 billing document replay rule.
10. The B1 commercial-financial-recognition replay rule inherits the B1T06 commercial-incentive decision replay rule.
11. The B1 commercial-financial-recognition replay rule inherits the B1T07 commercial-rewards decision replay rule.
12. The B1 commercial-financial-recognition replay rule is number-deterministic.

### 3.5 B1 commercial-financial-recognition explanation trace, rule trace, and recognition trace

The B1 commercial-financial-recognition explanation trace is the canonical B1 commercial-financial-recognition explanation trace; the B1 commercial-financial-recognition explanation trace is the only B1 commercial-financial-recognition explanation trace. The B1 commercial-financial-recognition rule trace is the canonical B1 commercial-financial-recognition rule trace; the B1 commercial-financial-recognition rule trace is the only B1 commercial-financial-recognition rule trace. The B1 commercial-financial-recognition recognition trace is the canonical B1 commercial-financial-recognition recognition trace; the B1 commercial-financial-recognition recognition trace is the only B1 commercial-financial-recognition recognition trace. The B1 commercial-financial-recognition explanation trace, rule trace, and recognition trace are consumed by the B1T10 commercial data classification / commercial disclosure / commercial support-trace contract (re-asserted from the B1T10 plan).

## 4. B1 commercial-financial-recognition compatibility validation

The B1 commercial-financial-recognition compatibility validation is the canonical B1 commercial-financial-recognition compatibility validation; the B1 commercial-financial-recognition compatibility validation is the only B1 commercial-financial-recognition compatibility validation. The B1 commercial-financial-recognition compatibility validation verifies that the B1 commercial-financial-recognition decision version is supported, that the B1 commercial-financial-recognition scope key is supported, that the B1 commercial-financial-recognition scope version is supported, that the B1 commercial-financial-recognition decision kind is supported, that the B1 commercial-financial-recognition currency is supported, that the B1 commercial-financial-recognition accounting unit is supported, that the B1 commercial-financial-recognition product dependency is supported, that the B1 commercial-financial-recognition partner dependency is supported, that the B1 commercial-financial-recognition accounting basis is valid, that the B1 commercial-financial-recognition tax jurisdiction is valid, that the B1 commercial-financial-recognition cost-allocation method is valid, that the B1 commercial-financial-recognition recognition policy is valid, and that the B1 commercial-financial-recognition plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

## 5. B1 commercial-financial-recognition consumer ports

The B1 commercial-financial-recognition consumer ports are the canonical B1 commercial-financial-recognition read-only consumer boundary surface for later B1 tasks (B1T09 commercial analytics / profitability / commercial reconciliation engine, B1T10 commercial data classification / commercial disclosure / commercial support-trace surface, B1T11 commercial release gate).

The B1 commercial-financial-recognition consumer ports expose seven functions:

1. `generateRevenueRecognitionDecision(request)` — Returns the canonical B1 revenue-recognition decision for the supplied B1 revenue-recognition request. The generate is read-only; the B1 revenue-recognition engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
2. `replaySafeGenerateRevenueRecognitionDecision(request)` — Returns the canonical B1 revenue-recognition decision replay-safe result for the supplied B1 revenue-recognition request. The replay-safe generate is read-only; the B1 revenue-recognition engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
3. `generateTaxVatDecision(request)` — Returns the canonical B1 tax / VAT decision for the supplied B1 tax / VAT request. The generate is read-only; the B1 tax / VAT engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
4. `replaySafeGenerateTaxVatDecision(request)` — Returns the canonical B1 tax / VAT decision replay-safe result for the supplied B1 tax / VAT request. The replay-safe generate is read-only; the B1 tax / VAT engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
5. `generateCostAccountingDecision(request)` — Returns the canonical B1 cost-accounting decision for the supplied B1 cost-accounting request. The generate is read-only; the B1 cost-accounting engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
6. `replaySafeGenerateCostAccountingDecision(request)` — Returns the canonical B1 cost-accounting decision replay-safe result for the supplied B1 cost-accounting request. The replay-safe generate is read-only; the B1 cost-accounting engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
7. `compatibilityCheck(request)` — Returns the canonical B1 commercial-financial-recognition compatibility result for the supplied B1 revenue-recognition / tax / VAT / cost-accounting request. The compatibility check is read-only; the B1 commercial-financial-recognition engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.

## 6. Acceptance criteria

- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are the only B1 commercial-financial-recognition engines for revenue recognition, tax / VAT, and cost accounting.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the B1 campaign / promotion / coupon decisions (B1T06), the B1 referral / cashback / loyalty decisions (B1T07), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine never post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine emit commercial-financial-recognition events through the shared Operations `OutboxService` and record commercial-financial-recognition facts through the shared Operations `AuditService`.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger and never bypass A5 financial-invariants.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the B1T04 commercial decision; the B1 engines consume the B1T04 commercial decision read-only and never recalculate fee, commission, or revenue sharing.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the B1T05 billing document; the B1 engines consume the B1T05 billing document read-only and never modify invoices, statements, or other billing documents.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the B1T06 commercial-incentive decision; the B1 engines consume the B1T06 commercial-incentive decision read-only and never substitute or override the B1T06 commercial-incentive decision.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the B1T07 commercial-rewards decision; the B1 engines consume the B1T07 commercial-rewards decision read-only and never redeem cashback, award loyalty balances, redeem loyalty balances, or execute referral rewards.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are designed to be capable of supporting future revenue-recognition schedules, deferred-revenue schedules, tax / VAT categories, tax / VAT jurisdictions, cost-allocation methods, cost categories, revenue recognition policies, and tax / VAT policies without changing existing A1-A7 authorities.

## 7. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08 — B1 Revenue-Recognition, Tax / VAT, and Cost-Accounting Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/B1-BILLING-ENGINE-CONTRACT.md` — B1 billing engine, invoice engine, and statement-generation engine contract.
- `docs/B1-CAMPAIGN-ENGINE-CONTRACT.md` — B1 campaign engine, promotion engine, and coupon engine contract.
- `docs/B1-REFERRAL-ENGINE-CONTRACT.md` — B1 referral engine, cashback engine, and loyalty engine contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `docs/ADR/ADR-0064-B1-Billing-Invoice-Statement-Engine.md` — B1 billing engine, invoice engine, and statement-generation engine ADR.
- `docs/ADR/ADR-0065-B1-Campaign-Promotion-Coupon-Engine.md` — B1 campaign engine, promotion engine, and coupon engine ADR.
- `docs/ADR/ADR-0066-B1-Referral-Cashback-Loyalty-Engine.md` — B1 referral engine, cashback engine, and loyalty engine ADR.
- `docs/ADR/ADR-0067-B1-Revenue-Recognition-Tax-VAT-Cost-Accounting-Engine.md` — B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine ADR.
- `src/policy/b1-revenue-recognition-engine.types.ts` — B1 revenue-recognition engine types.
- `src/policy/b1-revenue-recognition-engine.constants.ts` — B1 revenue-recognition engine constants.
- `src/policy/b1-revenue-recognition-engine.entity.ts` — B1 revenue-recognition decision persistence entity.
- `src/policy/b1-revenue-recognition-engine.repository.ts` — B1 revenue-recognition engine repository.
- `src/policy/b1-revenue-recognition-engine.service.ts` — B1 revenue-recognition engine service.
- `src/policy/b1-revenue-recognition-engine.module.ts` — B1 revenue-recognition engine NestJS module.
- `src/migrations/1785753600036-CreateB1RevenueRecognitionDecisionTables.ts` — B1 revenue-recognition decision persistence migration.
- `test/b1-revenue-recognition-engine.types.spec.ts` — B1 revenue-recognition engine types tests.
- `test/b1-revenue-recognition-engine.repository.spec.ts` — B1 revenue-recognition engine repository tests.
- `test/b1-revenue-recognition-engine.service.spec.ts` — B1 revenue-recognition engine service tests.
- `test/b1-revenue-recognition-engine.module.spec.ts` — B1 revenue-recognition engine module tests.
