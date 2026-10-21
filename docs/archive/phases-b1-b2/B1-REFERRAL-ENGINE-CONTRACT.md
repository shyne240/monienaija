# B1T07 — B1 Referral Engine, Cashback Engine, and Loyalty Engine Contract

- **Phase:** B1 — Commercial Platform
- **Task:** B1T07 — B1 Referral Engine, Cashback Engine, and Loyalty Engine
- **Contract:** `B1ReferralEngineContractV1` / `B1ReferralRewardDecisionV1` / `B1ReferralRewardReplaySafeResultV1` / `B1CashbackCalculationDecisionV1` / `B1CashbackCalculationReplaySafeResultV1` / `B1LoyaltyEarningDecisionV1` / `B1LoyaltyEarningReplaySafeResultV1` / `B1ReferralEngineCompatibilityResultV1` / `B1ReferralDocumentVersioningContractV1` / `B1ReferralDocumentPersistenceRecordV1` / `B1ReferralEngineConsumerPortsV1`
- **ADR:** `ADR-0066 — B1 Referral Engine, Cashback Engine, and Loyalty Engine`
- **Status:** Accepted (B1T07 implementation)
- **Review snapshot:** `b1t07` (B1T07 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Purpose and boundary

B1T07 implements the B1 referral engine, cashback engine, and loyalty engine for the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) established in [`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`](B1-COMMERCIAL-CATALOG-CONTRACT.md) (B1T02) and [`docs/B1-COMMERCIAL-PLATFORM-BASELINE.md`](B1-COMMERCIAL-PLATFORM-BASELINE.md) (B1T01). The B1 referral engine, cashback engine, and loyalty engine is the only B1 commercial-rewards engine for referrals, cashback, and loyalty. The B1 referral engine, cashback engine, and loyalty engine is a deterministic commercial-rewards decision engine that produces a durable B1 commercial-rewards decision (referral reward decision, cashback calculation decision, or loyalty earning decision) for a single commercial flow. The B1 referral engine, cashback engine, and loyalty engine is a read-only decision engine; the B1 referral engine, cashback engine, and loyalty engine never posts a journal, mutates a balance, executes a settlement, executes a payout, redeems cashback, awards loyalty balances, executes referral rewards, creates a financial effect, repairs a binding, changes A4 policy / source records, modifies invoices, modifies statements, modifies commercial decisions, modifies pricing catalogs, modifies product state, or dispatches a notification.

The B1 referral engine, cashback engine, and loyalty engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 referral engine, cashback engine, and loyalty engine never overrides A4. The B1 referral engine, cashback engine, and loyalty engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 referral engine, cashback engine, and loyalty engine never posts to Ledger. The B1 referral engine, cashback engine, and loyalty engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 referral engine, cashback engine, and loyalty engine never substitutes the A6 partner boundary. The B1 referral engine, cashback engine, and loyalty engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 referral engine, cashback engine, and loyalty engine never substitutes the A7 product boundary. The B1 referral engine, cashback engine, and loyalty engine is bounded by the B1T04 commercial decision; the B1 referral engine, cashback engine, and loyalty engine consumes the B1T04 commercial decision read-only and never recalculates fee, commission, or revenue sharing. The B1 referral engine, cashback engine, and loyalty engine is bounded by the B1T05 billing document; the B1 referral engine, cashback engine, and loyalty engine consumes the B1T05 billing document read-only and never modifies invoices, statements, or other billing documents. The B1 referral engine, cashback engine, and loyalty engine is bounded by the B1T06 commercial-incentive decision; the B1 referral engine, cashback engine, and loyalty engine consumes the B1T06 commercial-incentive decision read-only and never substitutes or overrides the B1T06 commercial-incentive decision.

The B1 referral engine, cashback engine, and loyalty engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 referral engine, cashback engine, and loyalty engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

## 2. B1 referral engine, cashback engine, and loyalty engine contract

### 2.1 Contract identity

The B1 referral engine, cashback engine, and loyalty engine contract is `B1ReferralEngineContractV1` (frozen by [`docs/B1-IMPLEMENTATION-PLAN.md`](B1-IMPLEMENTATION-PLAN.md) §8 B1T07). The B1 referral engine, cashback engine, and loyalty engine contract name is `B1-REFERRAL-ENGINE`. The B1 referral engine, cashback engine, and loyalty engine contract version is `1`. The B1 referral engine, cashback engine, and loyalty engine contract document is `docs/B1-REFERRAL-ENGINE-CONTRACT.md`.

### 2.2 B1 commercial-rewards scope

The B1 referral engine, cashback engine, and loyalty engine is bounded to the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`. The B1 referral engine, cashback engine, and loyalty engine is the only B1 commercial-rewards engine for the B1 first commercial scope.

### 2.3 B1 commercial-rewards decision kind vocabulary

The B1 commercial-rewards decision kind vocabulary is the canonical B1 commercial-rewards decision kind vocabulary. The B1 commercial-rewards decision kind vocabulary is:

- `REFERRAL` — the B1 commercial-rewards decision is a referral reward decision.
- `CASHBACK` — the B1 commercial-rewards decision is a cashback calculation decision.
- `LOYALTY` — the B1 commercial-rewards decision is a loyalty earning decision.

The B1 commercial-rewards decision kind vocabulary is the only B1 commercial-rewards decision kind vocabulary; the B1 commercial-rewards decision kind vocabulary does NOT introduce a second B1 commercial-rewards decision kind vocabulary.

### 2.4 B1 commercial-rewards decision outcome vocabulary

The B1 commercial-rewards decision outcome vocabulary is the canonical B1 commercial-rewards decision outcome vocabulary. The B1 commercial-rewards decision outcome vocabulary is:

- `ELIGIBLE` — the B1 commercial-rewards decision is eligible.
- `APPLIED` — the B1 commercial-rewards decision is applied.
- `REJECTED` — the B1 commercial-rewards decision is rejected.
- `REPLAYED` — the B1 commercial-rewards decision is replayed from a duplicate request.

The B1 commercial-rewards decision outcome vocabulary is the only B1 commercial-rewards decision outcome vocabulary; the B1 commercial-rewards decision outcome vocabulary does NOT introduce a second B1 commercial-rewards decision outcome vocabulary.

### 2.5 B1 commercial-rewards referral state vocabulary

The B1 commercial-rewards referral state vocabulary is the canonical B1 commercial-rewards referral state vocabulary. The B1 commercial-rewards referral state vocabulary is:

- `DRAFT` — the B1 commercial-rewards referral is in draft state.
- `ACTIVE` — the B1 commercial-rewards referral is active.
- `PAUSED` — the B1 commercial-rewards referral is paused.
- `EXPIRED` — the B1 commercial-rewards referral is expired.
- `RETIRED` — the B1 commercial-rewards referral is retired.

The B1 commercial-rewards referral state vocabulary is the only B1 commercial-rewards referral state vocabulary; the B1 commercial-rewards referral state vocabulary does NOT introduce a second B1 commercial-rewards referral state vocabulary.

### 2.6 B1 commercial-rewards cashback state vocabulary

The B1 commercial-rewards cashback state vocabulary is the canonical B1 commercial-rewards cashback state vocabulary. The B1 commercial-rewards cashback state vocabulary is:

- `CREATED` — the B1 commercial-rewards cashback is created.
- `ACTIVE` — the B1 commercial-rewards cashback is active.
- `PAUSED` — the B1 commercial-rewards cashback is paused.
- `EXPIRED` — the B1 commercial-rewards cashback is expired.
- `CANCELLED` — the B1 commercial-rewards cashback is cancelled.

The B1 commercial-rewards cashback state vocabulary is the only B1 commercial-rewards cashback state vocabulary; the B1 commercial-rewards cashback state vocabulary does NOT introduce a second B1 commercial-rewards cashback state vocabulary.

### 2.7 B1 commercial-rewards loyalty state vocabulary

The B1 commercial-rewards loyalty state vocabulary is the canonical B1 commercial-rewards loyalty state vocabulary. The B1 commercial-rewards loyalty state vocabulary is:

- `DRAFT` — the B1 commercial-rewards loyalty is in draft state.
- `ACTIVE` — the B1 commercial-rewards loyalty is active.
- `SUSPENDED` — the B1 commercial-rewards loyalty is suspended.
- `RETIRED` — the B1 commercial-rewards loyalty is retired.
- `ARCHIVED` — the B1 commercial-rewards loyalty is archived.

The B1 commercial-rewards loyalty state vocabulary is the only B1 commercial-rewards loyalty state vocabulary; the B1 commercial-rewards loyalty state vocabulary does NOT introduce a second B1 commercial-rewards loyalty state vocabulary.

### 2.8 B1 commercial-rewards auxiliary vocabularies

The B1 commercial-rewards relationship type vocabulary is: `PARENT`, `CHILD`, `SIBLING`, `SPONSOR`, `REFEREE`, `CIRCLE`, `NETWORK`. The B1 commercial-rewards qualification status vocabulary is: `NOT_QUALIFIED`, `PENDING_VERIFICATION`, `QUALIFIED`, `OVER_QUALIFIED`, `EXPIRED_QUALIFICATION`. The B1 commercial-rewards loyalty tier status vocabulary is: `TIER_PENDING`, `TIER_BRONZE`, `TIER_SILVER`, `TIER_GOLD`, `TIER_PLATINUM`, `TIER_DIAMOND`. The B1 commercial-rewards loyalty earning source vocabulary is: `PURCHASE`, `BILLING`, `CAMPAIGN`, `PROMOTION`, `COUPON`, `REFERRAL`, `CASHBACK`, `MANUAL_ADJUSTMENT`. The B1 commercial-rewards cashback calculation basis vocabulary is: `FIXED_AMOUNT`, `PERCENTAGE_OF_BILLING`, `PERCENTAGE_OF_FEE`, `TIER_MULTIPLIER`, `CAMPAIGN_OVERRIDE`. The B1 commercial-rewards eligibility vocabulary is: `CUSTOMER_ELIGIBLE`, `MERCHANT_ELIGIBLE`, `PARTNER_ELIGIBLE`, `PRODUCT_ELIGIBLE`, `TIER_ELIGIBLE`, `PERIOD_ELIGIBLE`, `USAGE_LIMIT_ELIGIBLE`, `HIERARCHY_ELIGIBLE`, `QUALIFICATION_ELIGIBLE`, `POINT_POLICY_ELIGIBLE`.

### 2.9 B1 commercial-rewards rule outcome vocabulary

The B1 commercial-rewards rule outcome vocabulary is the canonical B1 commercial-rewards rule outcome vocabulary. The B1 commercial-rewards rule outcome vocabulary is:

- `PASS` — the B1 commercial-rewards rule passed.
- `FAIL` — the B1 commercial-rewards rule failed.
- `SKIP` — the B1 commercial-rewards rule was skipped.
- `NOT_APPLICABLE` — the B1 commercial-rewards rule was not applicable.

The B1 commercial-rewards rule outcome vocabulary is the only B1 commercial-rewards rule outcome vocabulary; the B1 commercial-rewards rule outcome vocabulary does NOT introduce a second B1 commercial-rewards rule outcome vocabulary.

### 2.10 B1 commercial-rewards rule kind vocabulary

The B1 commercial-rewards rule kind vocabulary is the canonical B1 commercial-rewards rule kind vocabulary. The B1 commercial-rewards rule kind vocabulary is:

- `A4_POLICY_LIMIT`, `A4_POLICY_OBLIGATION`, `A4_POLICY_CURRENTNESS`, `A4_POLICY_REEVALUATION`
- `A3_BINDING_RECHECK`
- `A5_LEDGER_ACCOUNT_STATE`, `A5_LEDGER_POSTING_BOUNDARY`, `A5_FINANCIAL_INVARIANTS`
- `A6_PARTNER_STATE`, `A6_PARTNER_CAPABILITY_VERSION`, `A6T08_SETTLEMENT_SUSPENSE_COMPENSATING`, `A6T09_EXTERNAL_RECONCILIATION`
- `A7_PRODUCT_CATALOG`, `A7_PRODUCT_BOUNDARY`, `A7T04_PRODUCT_CUSTOMER_BINDING`, `A7T05_PRODUCT_COMMAND_OPERATION`, `A7T06_PRODUCT_NOTIFICATION`, `A7T07_PRODUCT_LIFECYCLE`, `A7T08_PRODUCT_FINANCIAL_EFFECT`, `A7T09_PRODUCT_RECONCILIATION`, `A7T10_PRODUCT_DATA_MINIMIZATION`
- `B1_COMMERCIAL_CATALOG_LOOKUP`, `B1_COMMERCIAL_CATALOG_COMPATIBILITY`, `B1_COMMERCIAL_CATALOG_PLAN`, `B1_COMMERCIAL_CATALOG_TIER`, `B1_COMMERCIAL_CATALOG_ENTITLEMENT`, `B1_COMMERCIAL_CATALOG_PACKAGE`, `B1_COMMERCIAL_CATALOG_BUNDLE`, `B1_COMMERCIAL_CATALOG_SUBSCRIPTION`, `B1_COMMERCIAL_CATALOG_FEATURE_FLAG`, `B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT`, `B1_COMMERCIAL_CATALOG_PRICING`
- `B1_COMMERCIAL_DECISION_LOOKUP`, `B1_COMMERCIAL_DECISION_COMPATIBILITY`, `B1_COMMERCIAL_DECISION_REPLAY`
- `B1_BILLING_ENGINE_DOCUMENT_LOOKUP`, `B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY`, `B1_BILLING_ENGINE_DOCUMENT_REPLAY`
- `B1_CAMPAIGN_DECISION_LOOKUP`, `B1_CAMPAIGN_DECISION_COMPATIBILITY`, `B1_CAMPAIGN_DECISION_REPLAY`
- `B1_PROMOTION_DECISION_LOOKUP`, `B1_PROMOTION_DECISION_COMPATIBILITY`, `B1_PROMOTION_DECISION_REPLAY`
- `B1_COUPON_DECISION_LOOKUP`, `B1_COUPON_DECISION_COMPATIBILITY`, `B1_COUPON_DECISION_REPLAY`
- `B1_REFERRAL_ENGINE_REFERRAL_CAMPAIGN`, `B1_REFERRAL_ENGINE_REFERRAL_PROGRAM`, `B1_REFERRAL_ENGINE_REFERRAL_ELIGIBILITY`, `B1_REFERRAL_ENGINE_REFERRAL_RELATIONSHIP`, `B1_REFERRAL_ENGINE_REFERRAL_HIERARCHY`, `B1_REFERRAL_ENGINE_REFERRAL_QUALIFICATION`, `B1_REFERRAL_ENGINE_REFERRAL_REWARD_DECISION`
- `B1_REFERRAL_ENGINE_CASHBACK_ELIGIBILITY`, `B1_REFERRAL_ENGINE_CASHBACK_CAMPAIGN`, `B1_REFERRAL_ENGINE_CASHBACK_CALCULATION_DECISION`, `B1_REFERRAL_ENGINE_CASHBACK_RULE_EVALUATION`
- `B1_REFERRAL_ENGINE_LOYALTY_PROGRAM`, `B1_REFERRAL_ENGINE_LOYALTY_TIER`, `B1_REFERRAL_ENGINE_LOYALTY_EARNING_DECISION`, `B1_REFERRAL_ENGINE_LOYALTY_REDEMPTION_ELIGIBILITY_DECISION`, `B1_REFERRAL_ENGINE_LOYALTY_POINT_POLICY`
- `B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC`, `B1_REFERRAL_ENGINE_DOCUMENT_VERSION`

### 2.11 B1 commercial-rewards failure code vocabulary

The B1 commercial-rewards failure code vocabulary is the canonical B1 commercial-rewards failure code vocabulary. The B1 commercial-rewards failure code vocabulary is:

- `B1_REFERRAL_ENGINE_INVALID_COMMAND`
- `B1_REFERRAL_ENGINE_INCOMPATIBLE`
- `B1_REFERRAL_ENGINE_QUERY_UNAVAILABLE`
- `B1_REFERRAL_ENGINE_PROHIBITED`
- `B1_REFERRAL_ENGINE_DECISION_NOT_FOUND`
- `B1_REFERRAL_ENGINE_DECISION_INCOMPATIBLE`
- `B1_REFERRAL_ENGINE_CATALOG_INCOMPATIBLE`
- `B1_REFERRAL_ENGINE_CATALOG_MISSING`
- `B1_REFERRAL_ENGINE_BILLING_DOCUMENT_NOT_FOUND`
- `B1_REFERRAL_ENGINE_BILLING_DOCUMENT_INCOMPATIBLE`
- `B1_REFERRAL_ENGINE_CAMPAIGN_DECISION_NOT_FOUND`
- `B1_REFERRAL_ENGINE_CAMPAIGN_DECISION_INCOMPATIBLE`
- `B1_REFERRAL_ENGINE_PROMOTION_DECISION_NOT_FOUND`
- `B1_REFERRAL_ENGINE_PROMOTION_DECISION_INCOMPATIBLE`
- `B1_REFERRAL_ENGINE_COUPON_DECISION_NOT_FOUND`
- `B1_REFERRAL_ENGINE_COUPON_DECISION_INCOMPATIBLE`
- `B1_REFERRAL_ENGINE_A4_POLICY_DENIED`
- `B1_REFERRAL_ENGINE_A3_BINDING_INVALID`
- `B1_REFERRAL_ENGINE_A5_LEDGER_INVARIANT_BROKEN`
- `B1_REFERRAL_ENGINE_A6_PARTNER_INCOMPATIBLE`
- `B1_REFERRAL_ENGINE_A7_PRODUCT_INCOMPATIBLE`
- `B1_REFERRAL_ENGINE_REPLAY_CONFLICT`
- `B1_REFERRAL_ENGINE_REPLAY_EXPIRED`
- `B1_REFERRAL_ENGINE_IN_PROGRESS`
- `B1_REFERRAL_ENGINE_NUMBER_CONFLICT`
- `B1_REFERRAL_ENGINE_EXPIRED`
- `B1_REFERRAL_ENGINE_USAGE_LIMIT_EXCEEDED`
- `B1_REFERRAL_ENGINE_NOT_APPLICABLE`
- `B1_REFERRAL_ENGINE_HIERARCHY_INVALID`
- `B1_REFERRAL_ENGINE_QUALIFICATION_INSUFFICIENT`
- `B1_REFERRAL_ENGINE_TIER_INSUFFICIENT`
- `B1_REFERRAL_ENGINE_POINT_POLICY_INCOMPATIBLE`

The B1 commercial-rewards failure code vocabulary is the only B1 commercial-rewards failure code vocabulary; the B1 commercial-rewards failure code vocabulary does NOT introduce a second B1 commercial-rewards failure code vocabulary.

## 3. B1 commercial-rewards request, result, and replay

### 3.1 B1 referral request

The B1 referral request is the canonical B1 commercial-rewards referral request; the B1 referral request is the only B1 referral request. The B1 referral request is a read-only request; the B1 referral request does NOT mutate any A1-A7 source record.

The B1 referral request carries the B1 commercial-rewards contract identity, the B1 commercial-rewards referral request identity, the B1 commercial-rewards referral request version, the B1 commercial-rewards scope identity, the B1 commercial-rewards period identity, the B1 commercial-rewards period window, the B1 commercial-rewards base currency, the B1 commercial-rewards base accounting unit, the B1 commercial-rewards customer identity, the B1 commercial-rewards customer tier, the B1 commercial-rewards merchant identity, the B1 commercial-rewards merchant tier, the B1 commercial-rewards partner identity, the B1 commercial-rewards partner tier, the B1 commercial-rewards product identity, the B1 commercial-rewards capability identity, the B1 commercial-rewards plan identity, the B1 commercial-rewards subscription identity, the B1 commercial-rewards product entitlement identity, the B1 commercial-rewards referral campaign key, the B1 commercial-rewards referral program key, the B1 commercial-rewards referral key, the B1 commercial-rewards referral window, the B1 commercial-rewards relationship type, the B1 commercial-rewards hierarchy path, the B1 commercial-rewards hierarchy depth, the B1 commercial-rewards qualification status, the B1 commercial-rewards usage limits, the B1 commercial-rewards campaign decision reference, the B1 commercial-rewards promotion decision reference, the B1 commercial-rewards coupon decision reference, the B1 commercial-rewards commercial decision reference, the B1 commercial-rewards commercial decision idempotency key, the B1 commercial-rewards billing document reference, the B1 commercial-rewards idempotency key, the B1 commercial-rewards request context, and the B1 commercial-rewards causation id.

The B1 commercial-rewards referral request hash is the SHA-256 hash of the canonical B1 commercial-rewards referral request payload (excluding the B1 commercial-rewards request context, the B1 commercial-rewards request id, the B1 commercial-rewards request version, and the B1 commercial-rewards causation id). The B1 commercial-rewards referral request hash is the only B1 commercial-rewards referral request hash; the B1 commercial-rewards referral request hash is the canonical B1 commercial-rewards referral request hash.

### 3.2 B1 referral reward decision document

The B1 referral reward decision document is the canonical B1 commercial-rewards referral decision document; the B1 referral reward decision document is the only B1 commercial-rewards referral decision document. The B1 referral reward decision document is a read-only document; the B1 referral reward decision document does NOT mutate any A1-A7 source record.

The B1 referral reward decision document carries the B1 commercial-rewards contract identity, the B1 commercial-rewards referral decision identity, the B1 commercial-rewards referral decision reference, the B1 commercial-rewards referral decision version, the B1 commercial-rewards referral decision state, the B1 commercial-rewards referral decision outcome, the B1 commercial-rewards referral decision hash, the B1 commercial-rewards referral decision replay hash, the B1 commercial-rewards referral request hash, the B1 commercial-rewards scope identity, the B1 commercial-rewards scope version, the B1 commercial-rewards period identity, the B1 commercial-rewards period window, the B1 commercial-rewards referral campaign key, the B1 commercial-rewards referral program key, the B1 commercial-rewards referral key, the B1 commercial-rewards referral window, the B1 commercial-rewards customer identity, the B1 commercial-rewards merchant identity, the B1 commercial-rewards partner identity, the B1 commercial-rewards referee customer identity, the B1 commercial-rewards sponsor customer identity, the B1 commercial-rewards product identity, the B1 commercial-rewards capability identity, the B1 commercial-rewards plan identity, the B1 commercial-rewards subscription identity, the B1 commercial-rewards product entitlement identity, the B1 commercial-rewards customer tier, the B1 commercial-rewards merchant tier, the B1 commercial-rewards partner tier, the B1 commercial-rewards relationship type, the B1 commercial-rewards hierarchy path, the B1 commercial-rewards hierarchy depth, the B1 commercial-rewards qualification status, the B1 commercial-rewards usage limits, the B1 commercial-rewards eligibility summary, the B1 commercial-rewards eligible flag, the B1 commercial-rewards applicable flag, the B1 commercial-rewards hierarchy conflicts, the B1 commercial-rewards qualification conflicts, the B1 commercial-rewards campaign decision reference, the B1 commercial-rewards promotion decision reference, the B1 commercial-rewards coupon decision reference, the B1 commercial-rewards commercial decision reference, the B1 commercial-rewards commercial decision idempotency key, the B1 commercial-rewards billing document reference, the B1 commercial-rewards explanation trace, the B1 commercial-rewards rule trace, the B1 commercial-rewards audit evidence, the B1 commercial-rewards idempotency scope, the B1 commercial-rewards idempotency key, the B1 commercial-rewards replayed flag, the B1 commercial-rewards conflict flag, the B1 commercial-rewards conflict reason, the B1 commercial-rewards failure, the B1 commercial-rewards generated timestamp, the B1 commercial-rewards correlation id, the B1 commercial-rewards request context, and the B1 commercial-rewards causation id.

The B1 commercial-rewards referral decision hash is the SHA-256 hash of the canonical B1 commercial-rewards referral decision payload (excluding the B1 commercial-rewards random `decisionId` and the B1 commercial-rewards `generatedAt` timestamp). The B1 commercial-rewards referral decision hash is the only B1 commercial-rewards referral decision hash; the B1 commercial-rewards referral decision hash is the canonical B1 commercial-rewards referral decision hash.

The B1 commercial-rewards referral replay hash is the SHA-256 hash of the B1 commercial-rewards referral decision hash, the B1 commercial-rewards referral request hash, the B1 commercial-rewards idempotency key, and the B1 commercial-rewards correlation id. The B1 commercial-rewards referral replay hash is the only B1 commercial-rewards referral replay hash; the B1 commercial-rewards referral replay hash is the canonical B1 commercial-rewards referral replay hash.

### 3.3 B1 cashback request and decision

The B1 cashback request and decision are analogous to the B1 referral request and decision, with the B1 cashback campaign key, the B1 cashback key, the B1 cashback window, the B1 cashback calculation basis, the B1 cashback calculation rate, the B1 cashback calculation base, and the B1 cashback-specific metadata substituted for the B1 referral equivalents. The B1 cashback calculation decision is the canonical B1 commercial-rewards cashback decision; the B1 cashback calculation decision is the only B1 commercial-rewards cashback decision. The B1 cashback decision hash and replay hash are computed identically to the B1 referral decision hash and replay hash. The B1 cashback decision NEVER executes a cashback redemption, dispatches a notification, credits a wallet, debits a wallet, or creates a financial effect.

### 3.4 B1 loyalty earning request and decision

The B1 loyalty earning request and decision are analogous to the B1 referral request and decision, with the B1 loyalty program key, the B1 loyalty tier key, the B1 loyalty point policy key, the B1 loyalty earning source, the B1 loyalty earning base, the B1 loyalty earning rate, the B1 loyalty tier status, and the B1 loyalty-specific metadata substituted for the B1 referral equivalents. The B1 loyalty earning decision is the canonical B1 commercial-rewards loyalty decision; the B1 loyalty earning decision is the only B1 commercial-rewards loyalty decision. The B1 loyalty decision hash and replay hash are computed identically to the B1 referral decision hash and replay hash. The B1 loyalty earning decision NEVER awards a loyalty balance, redeems a loyalty balance, dispatches a notification, credits a wallet, debits a wallet, or creates a financial effect.

### 3.5 B1 commercial-rewards replay-safe decision engine

The B1 commercial-rewards replay-safe decision engine is the canonical B1 commercial-rewards replay-safe decision engine. The B1 commercial-rewards replay-safe decision engine uses the B1 commercial-rewards referral internal idempotency scope (`b1.referral-engine.referral.idempotency.v1`), the B1 commercial-rewards cashback internal idempotency scope (`b1.referral-engine.cashback.idempotency.v1`), the B1 commercial-rewards loyalty internal idempotency scope (`b1.referral-engine.loyalty.idempotency.v1`), the B1 commercial-rewards internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial-rewards idempotency key, and the B1 commercial-rewards request hash.

The B1 commercial-rewards replay rules are:

1. The B1 commercial-rewards replay window is 86_400 seconds (24 hours).
2. The B1 commercial-rewards replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial-rewards replay rule is idempotent (a duplicate lookup returns the durable original decision outcome).
4. The B1 commercial-rewards replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial-rewards replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial-rewards replay rule inherits the A1-A7 replay rules.
7. The B1 commercial-rewards replay rule inherits the B1T03 catalog replay rule.
8. The B1 commercial-rewards replay rule inherits the B1T04 commercial decision replay rule.
9. The B1 commercial-rewards replay rule inherits the B1T05 billing document replay rule.
10. The B1 commercial-rewards replay rule inherits the B1T06 commercial-incentive decision replay rule.
11. The B1 commercial-rewards replay rule is number-deterministic (the B1 commercial-rewards decision hash is the canonical B1 commercial-rewards decision hash).

### 3.6 B1 commercial-rewards explanation trace and rule trace

The B1 commercial-rewards explanation trace is the canonical B1 commercial-rewards explanation trace; the B1 commercial-rewards explanation trace is the only B1 commercial-rewards explanation trace. The B1 commercial-rewards explanation trace carries the B1 commercial-rewards trace id, the B1 commercial-rewards trace kind, the B1 commercial-rewards trace summary, the B1 commercial-rewards trace steps, the B1 commercial-rewards generated timestamp, and the B1 commercial-rewards correlation id.

The B1 commercial-rewards rule trace is the canonical B1 commercial-rewards rule trace; the B1 commercial-rewards rule trace is the only B1 commercial-rewards rule trace. The B1 commercial-rewards rule trace carries the B1 commercial-rewards rule trace id, the B1 commercial-rewards rule trace steps, the B1 commercial-rewards generated timestamp, and the B1 commercial-rewards correlation id.

The B1 commercial-rewards explanation trace and rule trace are consumed by the B1T10 commercial data classification / commercial disclosure / commercial support-trace contract (re-asserted from the B1T10 plan). The B1 commercial-rewards explanation trace and rule trace do NOT introduce a second B1 commercial-rewards explanation trace or rule trace.

## 4. B1 commercial-rewards compatibility validation

The B1 commercial-rewards compatibility validation is the canonical B1 commercial-rewards compatibility validation; the B1 commercial-rewards compatibility validation is the only B1 commercial-rewards compatibility validation. The B1 commercial-rewards compatibility validation verifies that the B1 commercial-rewards decision version is supported, that the B1 commercial-rewards scope key is supported, that the B1 commercial-rewards scope version is supported, that the B1 commercial-rewards decision kind is supported, that the B1 commercial-rewards currency is supported, that the B1 commercial-rewards accounting unit is supported, that the B1 commercial-rewards product dependency is supported, that the B1 commercial-rewards partner dependency is supported, that the B1 commercial-rewards relationship / hierarchy / qualification / tier / point-policy are valid, that the B1 commercial-rewards usage limits are valid, and that the B1 commercial-rewards plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

The B1 commercial-rewards compatibility rules are:

1. The B1 commercial-rewards compatibility check rejects a request with an invalid contract name (`B1_REFERRAL_ENGINE_INVALID_COMMAND`).
2. The B1 commercial-rewards compatibility check rejects a request with an invalid contract version (`B1_REFERRAL_ENGINE_INVALID_COMMAND`).
3. The B1 commercial-rewards compatibility check rejects a request with an invalid scope key (`B1_REFERRAL_ENGINE_INCOMPATIBLE`).
4. The B1 commercial-rewards compatibility check rejects a request with an invalid scope version (`B1_REFERRAL_ENGINE_INCOMPATIBLE`).
5. The B1 commercial-rewards compatibility check rejects a request with an invalid decision kind (`B1_REFERRAL_ENGINE_INCOMPATIBLE`).
6. The B1 commercial-rewards compatibility check rejects a request with an invalid currency (`B1_REFERRAL_ENGINE_INCOMPATIBLE`).
7. The B1 commercial-rewards compatibility check rejects a request with an invalid accounting unit (`B1_REFERRAL_ENGINE_INCOMPATIBLE`).
8. The B1 commercial-rewards compatibility check rejects a request with a prohibited adjacent scope (`B1_REFERRAL_ENGINE_INCOMPATIBLE`).

## 5. B1 commercial-rewards consumer ports

The B1 commercial-rewards consumer ports are the canonical B1 commercial-rewards read-only consumer boundary surface for later B1 tasks (B1T08, B1T09, B1T10, B1T11).

The B1 commercial-rewards consumer ports expose seven functions:

1. `generateReferralRewardDecision(request)` — Returns the canonical B1 referral reward decision for the supplied B1 referral request. The generate is read-only; the B1 referral engine never posts a journal, mutates a balance, executes referral rewards, dispatches a notification, or executes any financial effect.
2. `replaySafeGenerateReferralRewardDecision(request)` — Returns the canonical B1 referral reward decision replay-safe result for the supplied B1 referral request. The replay-safe generate is read-only; the B1 referral engine never posts a journal, mutates a balance, executes referral rewards, dispatches a notification, or executes any financial effect.
3. `generateCashbackCalculationDecision(request)` — Returns the canonical B1 cashback calculation decision for the supplied B1 cashback request. The generate is read-only; the B1 cashback engine never posts a journal, mutates a balance, redeems cashback, dispatches a notification, or executes any financial effect.
4. `replaySafeGenerateCashbackCalculationDecision(request)` — Returns the canonical B1 cashback calculation decision replay-safe result for the supplied B1 cashback request. The replay-safe generate is read-only; the B1 cashback engine never posts a journal, mutates a balance, redeems cashback, dispatches a notification, or executes any financial effect.
5. `generateLoyaltyEarningDecision(request)` — Returns the canonical B1 loyalty earning decision for the supplied B1 loyalty earning request. The generate is read-only; the B1 loyalty engine never posts a journal, mutates a balance, awards loyalty balances, redeems loyalty balances, dispatches a notification, or executes any financial effect.
6. `replaySafeGenerateLoyaltyEarningDecision(request)` — Returns the canonical B1 loyalty earning decision replay-safe result for the supplied B1 loyalty earning request. The replay-safe generate is read-only; the B1 loyalty engine never posts a journal, mutates a balance, awards loyalty balances, redeems loyalty balances, dispatches a notification, or executes any financial effect.
7. `compatibilityCheck(request)` — Returns the canonical B1 commercial-rewards compatibility result for the supplied B1 referral / cashback / loyalty request. The compatibility check is read-only; the B1 commercial-rewards engine never posts a journal, mutates a balance, executes referral rewards, redeems cashback, awards loyalty balances, dispatches a notification, or executes any financial effect.

## 6. Acceptance criteria

- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are the only B1 commercial-rewards engines for referrals, cashback, and loyalty.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the B1 commercial-incentive decisions (B1T06), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine never post a journal, mutate a balance, execute a settlement, execute a payout, redeem cashback, award loyalty balances, redeem loyalty balances, execute referral rewards, create a financial effect, repair a binding, change A4 policy / source records, modify invoices, modify statements, modify commercial decisions, modify pricing catalogs, modify product state, or dispatch a notification.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine emit commercial-rewards events through the shared Operations `OutboxService` and record commercial-rewards facts through the shared Operations `AuditService`.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the B1T04 commercial decision; the B1 engines consume the B1T04 commercial decision read-only and never recalculate fee, commission, or revenue sharing.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the B1T05 billing document; the B1 engines consume the B1T05 billing document read-only and never modify invoices, statements, or other billing documents.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the B1T06 commercial-incentive decision; the B1 engines consume the B1T06 commercial-incentive decision read-only and never substitute or override the B1T06 commercial-incentive decision.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are designed to be capable of supporting future marketing campaigns, onboarding cashback, merchant cashback, seasonal cashback, loyalty tiers, loyalty programs, loyalty point policies, referral campaigns, referral programs, and customer loyalty prerequisites without changing existing A1-A7 authorities.

## 7. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07 — B1 Referral, Cashback, and Loyalty Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/B1-BILLING-ENGINE-CONTRACT.md` — B1 billing engine, invoice engine, and statement-generation engine contract.
- `docs/B1-CAMPAIGN-ENGINE-CONTRACT.md` — B1 campaign engine, promotion engine, and coupon engine contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `docs/ADR/ADR-0064-B1-Billing-Invoice-Statement-Engine.md` — B1 billing engine, invoice engine, and statement-generation engine ADR.
- `docs/ADR/ADR-0065-B1-Campaign-Promotion-Coupon-Engine.md` — B1 campaign engine, promotion engine, and coupon engine ADR.
- `docs/ADR/ADR-0066-B1-Referral-Cashback-Loyalty-Engine.md` — B1 referral engine, cashback engine, and loyalty engine ADR.
- `src/policy/b1-referral-engine.types.ts` — B1 referral engine types.
- `src/policy/b1-referral-engine.constants.ts` — B1 referral engine constants.
- `src/policy/b1-referral-engine.entity.ts` — B1 referral decision persistence entity.
- `src/policy/b1-referral-engine.repository.ts` — B1 referral engine repository.
- `src/policy/b1-referral-engine.service.ts` — B1 referral engine service.
- `src/policy/b1-referral-engine.module.ts` — B1 referral engine NestJS module.
- `src/migrations/1785753600035-CreateB1ReferralDecisionTables.ts` — B1 referral decision persistence migration.
- `test/b1-referral-engine.types.spec.ts` — B1 referral engine types tests.
- `test/b1-referral-engine.repository.spec.ts` — B1 referral engine repository tests.
- `test/b1-referral-engine.service.spec.ts` — B1 referral engine service tests.
- `test/b1-referral-engine.module.spec.ts` — B1 referral engine module tests.
