# B1T06 — B1 Campaign Engine, Promotion Engine, and Coupon Engine Contract

- **Phase:** B1 — Commercial Platform
- **Task:** B1T06 — B1 Campaign Engine, Promotion Engine, and Coupon Engine
- **Contract:** `B1CampaignEngineContractV1` / `B1CampaignDecisionV1` / `B1CampaignDecisionReplaySafeResultV1` / `B1PromotionDecisionV1` / `B1PromotionDecisionReplaySafeResultV1` / `B1CouponDecisionV1` / `B1CouponDecisionReplaySafeResultV1` / `B1CampaignEngineCompatibilityResultV1` / `B1CampaignDocumentVersioningContractV1` / `B1CampaignDocumentPersistenceRecordV1` / `B1CampaignEngineConsumerPortsV1`
- **ADR:** `ADR-0065 — B1 Campaign Engine, Promotion Engine, and Coupon Engine`
- **Status:** Accepted (B1T06 implementation)
- **Review snapshot:** `b1t06` (B1T06 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Purpose and boundary

B1T06 implements the B1 campaign engine, promotion engine, and coupon engine for the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) established in [`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`](B1-COMMERCIAL-CATALOG-CONTRACT.md) (B1T02) and [`docs/B1-COMMERCIAL-PLATFORM-BASELINE.md`](B1-COMMERCIAL-PLATFORM-BASELINE.md) (B1T01). The B1 campaign engine, promotion engine, and coupon engine is the only B1 commercial-incentive engine for campaigns, promotions, and coupons. The B1 campaign engine, promotion engine, and coupon engine is a deterministic incentive-decision engine that produces a durable B1 commercial-incentive decision (campaign decision, promotion decision, or coupon decision) for a single commercial flow. The B1 campaign engine, promotion engine, and coupon engine is a read-only decision engine; the B1 campaign engine, promotion engine, and coupon engine never posts a journal, mutates a balance, executes a settlement, executes a payout, executes cashback, executes rewards, creates a financial effect, repairs a binding, changes A4 policy / source records, modifies invoices, modifies statements, modifies commercial decisions, modifies pricing catalogs, modifies product state, or dispatches a notification.

The B1 campaign engine, promotion engine, and coupon engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 campaign engine, promotion engine, and coupon engine never overrides A4. The B1 campaign engine, promotion engine, and coupon engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 campaign engine, promotion engine, and coupon engine never posts to Ledger. The B1 campaign engine, promotion engine, and coupon engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 campaign engine, promotion engine, and coupon engine never substitutes the A6 partner boundary. The B1 campaign engine, promotion engine, and coupon engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 campaign engine, promotion engine, and coupon engine never substitutes the A7 product boundary. The B1 campaign engine, promotion engine, and coupon engine is bounded by the B1T04 commercial decision; the B1 campaign engine, promotion engine, and coupon engine consumes the B1T04 commercial decision read-only and never recalculates fee, commission, or revenue sharing. The B1 campaign engine, promotion engine, and coupon engine is bounded by the B1T05 billing document; the B1 campaign engine, promotion engine, and coupon engine consumes the B1T05 billing document read-only and never modifies invoices, statements, or other billing documents.

The B1 campaign engine, promotion engine, and coupon engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 campaign engine, promotion engine, and coupon engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

## 2. B1 campaign engine, promotion engine, and coupon engine contract

### 2.1 Contract identity

The B1 campaign engine, promotion engine, and coupon engine contract is `B1CampaignEngineContractV1` (frozen by [`docs/B1-IMPLEMENTATION-PLAN.md`](B1-IMPLEMENTATION-PLAN.md) §8 B1T06). The B1 campaign engine, promotion engine, and coupon engine contract name is `B1-CAMPAIGN-ENGINE`. The B1 campaign engine, promotion engine, and coupon engine contract version is `1`. The B1 campaign engine, promotion engine, and coupon engine contract document is `docs/B1-CAMPAIGN-ENGINE-CONTRACT.md`.

### 2.2 B1 commercial-incentive scope

The B1 campaign engine, promotion engine, and coupon engine is bounded to the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`. The B1 campaign engine, promotion engine, and coupon engine is the only B1 commercial-incentive engine for the B1 first commercial scope.

### 2.3 B1 commercial-incentive decision kind vocabulary

The B1 commercial-incentive decision kind vocabulary is the canonical B1 commercial-incentive decision kind vocabulary. The B1 commercial-incentive decision kind vocabulary is:

- `CAMPAIGN` — the B1 commercial-incentive decision is a campaign decision.
- `PROMOTION` — the B1 commercial-incentive decision is a promotion decision.
- `COUPON` — the B1 commercial-incentive decision is a coupon decision.

The B1 commercial-incentive decision kind vocabulary is the only B1 commercial-incentive decision kind vocabulary; the B1 commercial-incentive decision kind vocabulary does NOT introduce a second B1 commercial-incentive decision kind vocabulary.

### 2.4 B1 commercial-incentive decision outcome vocabulary

The B1 commercial-incentive decision outcome vocabulary is the canonical B1 commercial-incentive decision outcome vocabulary. The B1 commercial-incentive decision outcome vocabulary is:

- `ELIGIBLE` — the B1 commercial-incentive decision is eligible.
- `APPLIED` — the B1 commercial-incentive decision is applied.
- `REJECTED` — the B1 commercial-incentive decision is rejected.
- `REPLAYED` — the B1 commercial-incentive decision is replayed from a duplicate request.

The B1 commercial-incentive decision outcome vocabulary is the only B1 commercial-incentive decision outcome vocabulary; the B1 commercial-incentive decision outcome vocabulary does NOT introduce a second B1 commercial-incentive decision outcome vocabulary.

### 2.5 B1 commercial-incentive campaign state vocabulary

The B1 commercial-incentive campaign state vocabulary is the canonical B1 commercial-incentive campaign state vocabulary. The B1 commercial-incentive campaign state vocabulary is:

- `DRAFT` — the B1 commercial-incentive campaign is in draft state.
- `ACTIVE` — the B1 commercial-incentive campaign is active.
- `PAUSED` — the B1 commercial-incentive campaign is paused.
- `EXPIRED` — the B1 commercial-incentive campaign is expired.
- `RETIRED` — the B1 commercial-incentive campaign is retired.

The B1 commercial-incentive campaign state vocabulary is the only B1 commercial-incentive campaign state vocabulary; the B1 commercial-incentive campaign state vocabulary does NOT introduce a second B1 commercial-incentive campaign state vocabulary.

### 2.6 B1 commercial-incentive promotion state vocabulary

The B1 commercial-incentive promotion state vocabulary is the canonical B1 commercial-incentive promotion state vocabulary. The B1 commercial-incentive promotion state vocabulary is:

- `CREATED` — the B1 commercial-incentive promotion is created.
- `ACTIVE` — the B1 commercial-incentive promotion is active.
- `EXPIRED` — the B1 commercial-incentive promotion is expired.
- `CANCELLED` — the B1 commercial-incentive promotion is cancelled.

The B1 commercial-incentive promotion state vocabulary is the only B1 commercial-incentive promotion state vocabulary; the B1 commercial-incentive promotion state vocabulary does NOT introduce a second B1 commercial-incentive promotion state vocabulary.

### 2.7 B1 commercial-incentive coupon state vocabulary

The B1 commercial-incentive coupon state vocabulary is the canonical B1 commercial-incentive coupon state vocabulary. The B1 commercial-incentive coupon state vocabulary is:

- `CREATED` — the B1 commercial-incentive coupon is created.
- `ACTIVE` — the B1 commercial-incentive coupon is active.
- `REDEEMED` — the B1 commercial-incentive coupon is redeemed.
- `EXPIRED` — the B1 commercial-incentive coupon is expired.
- `CANCELLED` — the B1 commercial-incentive coupon is cancelled.

The B1 commercial-incentive coupon state vocabulary is the only B1 commercial-incentive coupon state vocabulary; the B1 commercial-incentive coupon state vocabulary does NOT introduce a second B1 commercial-incentive coupon state vocabulary.

### 2.8 B1 commercial-incentive priority and stacking rule vocabularies

The B1 commercial-incentive priority vocabulary is: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. The B1 commercial-incentive stacking rule vocabulary is: `STACKABLE`, `EXCLUSIVE`, `OVERRIDABLE`. The B1 commercial-incentive eligibility vocabulary is: `CUSTOMER_ELIGIBLE`, `MERCHANT_ELIGIBLE`, `PARTNER_ELIGIBLE`, `PRODUCT_ELIGIBLE`, `TIER_ELIGIBLE`, `PERIOD_ELIGIBLE`, `USAGE_LIMIT_ELIGIBLE`.

### 2.9 B1 commercial-incentive rule outcome vocabulary

The B1 commercial-incentive rule outcome vocabulary is the canonical B1 commercial-incentive rule outcome vocabulary. The B1 commercial-incentive rule outcome vocabulary is:

- `PASS` — the B1 commercial-incentive rule passed.
- `FAIL` — the B1 commercial-incentive rule failed.
- `SKIP` — the B1 commercial-incentive rule was skipped.
- `NOT_APPLICABLE` — the B1 commercial-incentive rule was not applicable.

The B1 commercial-incentive rule outcome vocabulary is the only B1 commercial-incentive rule outcome vocabulary; the B1 commercial-incentive rule outcome vocabulary does NOT introduce a second B1 commercial-incentive rule outcome vocabulary.

### 2.10 B1 commercial-incentive rule kind vocabulary

The B1 commercial-incentive rule kind vocabulary is the canonical B1 commercial-incentive rule kind vocabulary. The B1 commercial-incentive rule kind vocabulary is:

- `A4_POLICY_LIMIT`, `A4_POLICY_OBLIGATION`, `A4_POLICY_CURRENTNESS`, `A4_POLICY_REEVALUATION`
- `A3_BINDING_RECHECK`
- `A5_LEDGER_ACCOUNT_STATE`, `A5_LEDGER_POSTING_BOUNDARY`, `A5_FINANCIAL_INVARIANTS`
- `A6_PARTNER_STATE`, `A6_PARTNER_CAPABILITY_VERSION`, `A6T08_SETTLEMENT_SUSPENSE_COMPENSATING`, `A6T09_EXTERNAL_RECONCILIATION`
- `A7_PRODUCT_CATALOG`, `A7_PRODUCT_BOUNDARY`, `A7T04_PRODUCT_CUSTOMER_BINDING`, `A7T05_PRODUCT_COMMAND_OPERATION`, `A7T06_PRODUCT_NOTIFICATION`, `A7T07_PRODUCT_LIFECYCLE`, `A7T08_PRODUCT_FINANCIAL_EFFECT`, `A7T09_PRODUCT_RECONCILIATION`, `A7T10_PRODUCT_DATA_MINIMIZATION`
- `B1_COMMERCIAL_CATALOG_LOOKUP`, `B1_COMMERCIAL_CATALOG_COMPATIBILITY`, `B1_COMMERCIAL_CATALOG_PLAN`, `B1_COMMERCIAL_CATALOG_TIER`, `B1_COMMERCIAL_CATALOG_ENTITLEMENT`, `B1_COMMERCIAL_CATALOG_PACKAGE`, `B1_COMMERCIAL_CATALOG_BUNDLE`, `B1_COMMERCIAL_CATALOG_SUBSCRIPTION`, `B1_COMMERCIAL_CATALOG_FEATURE_FLAG`, `B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT`, `B1_COMMERCIAL_CATALOG_PRICING`
- `B1_COMMERCIAL_DECISION_LOOKUP`, `B1_COMMERCIAL_DECISION_COMPATIBILITY`, `B1_COMMERCIAL_DECISION_REPLAY`
- `B1_BILLING_ENGINE_DOCUMENT_LOOKUP`, `B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY`, `B1_BILLING_ENGINE_DOCUMENT_REPLAY`
- `B1_CAMPAIGN_ENGINE_CUSTOMER_ELIGIBILITY`, `B1_CAMPAIGN_ENGINE_MERCHANT_ELIGIBILITY`, `B1_CAMPAIGN_ENGINE_PARTNER_ELIGIBILITY`, `B1_CAMPAIGN_ENGINE_PRODUCT_ELIGIBILITY`, `B1_CAMPAIGN_ENGINE_ACTIVATION_RULES`, `B1_CAMPAIGN_ENGINE_PRIORITY`, `B1_CAMPAIGN_ENGINE_STACKING_RULES`, `B1_CAMPAIGN_ENGINE_EXCLUSIVITY_RULES`, `B1_CAMPAIGN_ENGINE_EXPIRATION`, `B1_CAMPAIGN_ENGINE_USAGE_LIMITS`, `B1_CAMPAIGN_ENGINE_REPLAY_ELIGIBILITY`, `B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC`, `B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION`

### 2.11 B1 commercial-incentive failure code vocabulary

The B1 commercial-incentive failure code vocabulary is the canonical B1 commercial-incentive failure code vocabulary. The B1 commercial-incentive failure code vocabulary is:

- `B1_CAMPAIGN_ENGINE_INVALID_COMMAND`
- `B1_CAMPAIGN_ENGINE_INCOMPATIBLE`
- `B1_CAMPAIGN_ENGINE_QUERY_UNAVAILABLE`
- `B1_CAMPAIGN_ENGINE_PROHIBITED`
- `B1_CAMPAIGN_ENGINE_DECISION_NOT_FOUND`
- `B1_CAMPAIGN_ENGINE_DECISION_INCOMPATIBLE`
- `B1_CAMPAIGN_ENGINE_CATALOG_INCOMPATIBLE`
- `B1_CAMPAIGN_ENGINE_CATALOG_MISSING`
- `B1_CAMPAIGN_ENGINE_BILLING_DOCUMENT_NOT_FOUND`
- `B1_CAMPAIGN_ENGINE_BILLING_DOCUMENT_INCOMPATIBLE`
- `B1_CAMPAIGN_ENGINE_A4_POLICY_DENIED`
- `B1_CAMPAIGN_ENGINE_A3_BINDING_INVALID`
- `B1_CAMPAIGN_ENGINE_A5_LEDGER_INVARIANT_BROKEN`
- `B1_CAMPAIGN_ENGINE_A6_PARTNER_INCOMPATIBLE`
- `B1_CAMPAIGN_ENGINE_A7_PRODUCT_INCOMPATIBLE`
- `B1_CAMPAIGN_ENGINE_REPLAY_CONFLICT`
- `B1_CAMPAIGN_ENGINE_REPLAY_EXPIRED`
- `B1_CAMPAIGN_ENGINE_IN_PROGRESS`
- `B1_CAMPAIGN_ENGINE_NUMBER_CONFLICT`
- `B1_CAMPAIGN_ENGINE_EXPIRED`
- `B1_CAMPAIGN_ENGINE_USAGE_LIMIT_EXCEEDED`
- `B1_CAMPAIGN_ENGINE_NOT_APPLICABLE`

The B1 commercial-incentive failure code vocabulary is the only B1 commercial-incentive failure code vocabulary; the B1 commercial-incentive failure code vocabulary does NOT introduce a second B1 commercial-incentive failure code vocabulary.

## 3. B1 commercial-incentive request, result, and replay

### 3.1 B1 campaign request

The B1 campaign request is the canonical B1 commercial-incentive campaign request; the B1 campaign request is the only B1 campaign request. The B1 campaign request is a read-only request; the B1 campaign request does NOT mutate any A1-A7 source record.

The B1 campaign request carries the B1 commercial-incentive contract identity, the B1 commercial-incentive campaign request identity, the B1 commercial-incentive campaign request version, the B1 commercial-incentive scope identity, the B1 commercial-incentive period identity, the B1 commercial-incentive period window, the B1 commercial-incentive base currency, the B1 commercial-incentive base accounting unit, the B1 commercial-incentive customer identity, the B1 commercial-incentive customer tier, the B1 commercial-incentive merchant identity, the B1 commercial-incentive merchant tier, the B1 commercial-incentive partner identity, the B1 commercial-incentive partner tier, the B1 commercial-incentive product identity, the B1 commercial-incentive capability identity, the B1 commercial-incentive plan identity, the B1 commercial-incentive subscription identity, the B1 commercial-incentive product entitlement identity, the B1 commercial-incentive campaign key, the B1 commercial-incentive campaign window, the B1 commercial-incentive usage limits, the B1 commercial-incentive stackable flag, the B1 commercial-incentive commercial decision reference, the B1 commercial-incentive commercial decision idempotency key, the B1 commercial-incentive billing document reference, the B1 commercial-incentive idempotency key, the B1 commercial-incentive request context, and the B1 commercial-incentive causation id.

The B1 commercial-incentive campaign request hash is the SHA-256 hash of the canonical B1 commercial-incentive campaign request payload (excluding the B1 commercial-incentive request context, the B1 commercial-incentive request id, the B1 commercial-incentive request version, and the B1 commercial-incentive causation id). The B1 commercial-incentive campaign request hash is the only B1 commercial-incentive campaign request hash; the B1 commercial-incentive campaign request hash is the canonical B1 commercial-incentive campaign request hash.

### 3.2 B1 campaign decision document

The B1 campaign decision document is the canonical B1 commercial-incentive campaign decision document; the B1 campaign decision document is the only B1 commercial-incentive campaign decision document. The B1 campaign decision document is a read-only document; the B1 campaign decision document does NOT mutate any A1-A7 source record.

The B1 campaign decision document carries the B1 commercial-incentive contract identity, the B1 commercial-incentive campaign decision identity, the B1 commercial-incentive campaign decision reference, the B1 commercial-incentive campaign decision version, the B1 commercial-incentive campaign decision state, the B1 commercial-incentive campaign decision outcome, the B1 commercial-incentive campaign decision hash, the B1 commercial-incentive campaign decision replay hash, the B1 commercial-incentive campaign request hash, the B1 commercial-incentive scope identity, the B1 commercial-incentive scope version, the B1 commercial-incentive period identity, the B1 commercial-incentive period window, the B1 commercial-incentive campaign key, the B1 commercial-incentive campaign window, the B1 commercial-incentive customer identity, the B1 commercial-incentive merchant identity, the B1 commercial-incentive partner identity, the B1 commercial-incentive product identity, the B1 commercial-incentive capability identity, the B1 commercial-incentive plan identity, the B1 commercial-incentive subscription identity, the B1 commercial-incentive product entitlement identity, the B1 commercial-incentive customer tier, the B1 commercial-incentive merchant tier, the B1 commercial-incentive partner tier, the B1 commercial-incentive usage limits, the B1 commercial-incentive eligibility summary, the B1 commercial-incentive eligible flag, the B1 commercial-incentive applicable flag, the B1 commercial-incentive exclusivity conflicts, the B1 commercial-incentive stacking conflicts, the B1 commercial-incentive commercial decision reference, the B1 commercial-incentive commercial decision idempotency key, the B1 commercial-incentive billing document reference, the B1 commercial-incentive explanation trace, the B1 commercial-incentive rule trace, the B1 commercial-incentive audit evidence, the B1 commercial-incentive idempotency scope, the B1 commercial-incentive idempotency key, the B1 commercial-incentive replayed flag, the B1 commercial-incentive conflict flag, the B1 commercial-incentive conflict reason, the B1 commercial-incentive failure, the B1 commercial-incentive generated timestamp, the B1 commercial-incentive correlation id, the B1 commercial-incentive request context, and the B1 commercial-incentive causation id.

The B1 commercial-incentive campaign decision hash is the SHA-256 hash of the canonical B1 commercial-incentive campaign decision payload (excluding the B1 commercial-incentive random `decisionId` and the B1 commercial-incentive `generatedAt` timestamp). The B1 commercial-incentive campaign decision hash is the only B1 commercial-incentive campaign decision hash; the B1 commercial-incentive campaign decision hash is the canonical B1 commercial-incentive campaign decision hash.

The B1 commercial-incentive campaign replay hash is the SHA-256 hash of the B1 commercial-incentive campaign decision hash, the B1 commercial-incentive campaign request hash, the B1 commercial-incentive idempotency key, and the B1 commercial-incentive correlation id. The B1 commercial-incentive campaign replay hash is the only B1 commercial-incentive campaign replay hash; the B1 commercial-incentive campaign replay hash is the canonical B1 commercial-incentive campaign replay hash.

### 3.3 B1 promotion request and decision

The B1 promotion request and decision are analogous to the B1 campaign request and decision, with the B1 promotion key, the B1 promotion window, and the B1 promotion-specific metadata substituted for the B1 campaign equivalents. The B1 promotion decision is the canonical B1 commercial-incentive promotion decision; the B1 promotion decision is the only B1 commercial-incentive promotion decision. The B1 promotion decision hash and replay hash are computed identically to the B1 campaign decision hash and replay hash.

### 3.4 B1 coupon request and decision

The B1 coupon request and decision are analogous to the B1 campaign request and decision, with the B1 coupon code, the B1 coupon key, the B1 coupon window, and the B1 coupon-specific metadata substituted for the B1 campaign equivalents. The B1 coupon decision is the canonical B1 commercial-incentive coupon decision; the B1 coupon decision is the only B1 commercial-incentive coupon decision. The B1 coupon decision hash and replay hash are computed identically to the B1 campaign decision hash and replay hash.

### 3.5 B1 commercial-incentive replay-safe decision engine

The B1 commercial-incentive replay-safe decision engine is the canonical B1 commercial-incentive replay-safe decision engine. The B1 commercial-incentive replay-safe decision engine uses the B1 commercial-incentive campaign internal idempotency scope (`b1.campaign-engine.campaign.idempotency.v1`), the B1 commercial-incentive promotion internal idempotency scope (`b1.campaign-engine.promotion.idempotency.v1`), the B1 commercial-incentive coupon internal idempotency scope (`b1.campaign-engine.coupon.idempotency.v1`), the B1 commercial-incentive internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial-incentive idempotency key, and the B1 commercial-incentive request hash.

The B1 commercial-incentive replay rules are:

1. The B1 commercial-incentive replay window is 86_400 seconds (24 hours).
2. The B1 commercial-incentive replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial-incentive replay rule is idempotent (a duplicate lookup returns the durable original decision outcome).
4. The B1 commercial-incentive replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial-incentive replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial-incentive replay rule inherits the A1-A7 replay rules.
7. The B1 commercial-incentive replay rule inherits the B1T03 catalog replay rule.
8. The B1 commercial-incentive replay rule inherits the B1T04 commercial decision replay rule.
9. The B1 commercial-incentive replay rule inherits the B1T05 billing document replay rule.

### 3.6 B1 commercial-incentive explanation trace and rule trace

The B1 commercial-incentive explanation trace is the canonical B1 commercial-incentive explanation trace; the B1 commercial-incentive explanation trace is the only B1 commercial-incentive explanation trace. The B1 commercial-incentive explanation trace carries the B1 commercial-incentive trace id, the B1 commercial-incentive trace kind, the B1 commercial-incentive trace summary, the B1 commercial-incentive trace steps, the B1 commercial-incentive generated timestamp, and the B1 commercial-incentive correlation id.

The B1 commercial-incentive rule trace is the canonical B1 commercial-incentive rule trace; the B1 commercial-incentive rule trace is the only B1 commercial-incentive rule trace. The B1 commercial-incentive rule trace carries the B1 commercial-incentive rule trace id, the B1 commercial-incentive rule trace steps, the B1 commercial-incentive generated timestamp, and the B1 commercial-incentive correlation id.

The B1 commercial-incentive explanation trace and rule trace are consumed by the B1T10 commercial data classification / commercial disclosure / commercial support-trace contract (re-asserted from the B1T10 plan). The B1 commercial-incentive explanation trace and rule trace do NOT introduce a second B1 commercial-incentive explanation trace or rule trace.

## 4. B1 commercial-incentive compatibility validation

The B1 commercial-incentive compatibility validation is the canonical B1 commercial-incentive compatibility validation; the B1 commercial-incentive compatibility validation is the only B1 commercial-incentive compatibility validation. The B1 commercial-incentive compatibility validation verifies that the B1 commercial-incentive decision version is supported, that the B1 commercial-incentive scope key is supported, that the B1 commercial-incentive scope version is supported, that the B1 commercial-incentive decision kind is supported, that the B1 commercial-incentive currency is supported, that the B1 commercial-incentive accounting unit is supported, that the B1 commercial-incentive product dependency is supported, that the B1 commercial-incentive partner dependency is supported, that the B1 commercial-incentive stacking rules are valid, that the B1 commercial-incentive exclusivity rules are valid, that the B1 commercial-incentive usage limits are valid, and that the B1 commercial-incentive plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

The B1 commercial-incentive compatibility rules are:

1. The B1 commercial-incentive compatibility check rejects a request with an invalid contract name (`B1_CAMPAIGN_ENGINE_INVALID_COMMAND`).
2. The B1 commercial-incentive compatibility check rejects a request with an invalid contract version (`B1_CAMPAIGN_ENGINE_INVALID_COMMAND`).
3. The B1 commercial-incentive compatibility check rejects a request with an invalid scope key (`B1_CAMPAIGN_ENGINE_INCOMPATIBLE`).
4. The B1 commercial-incentive compatibility check rejects a request with an invalid scope version (`B1_CAMPAIGN_ENGINE_INCOMPATIBLE`).
5. The B1 commercial-incentive compatibility check rejects a request with an invalid decision kind (`B1_CAMPAIGN_ENGINE_INCOMPATIBLE`).
6. The B1 commercial-incentive compatibility check rejects a request with an invalid currency (`B1_CAMPAIGN_ENGINE_INCOMPATIBLE`).
7. The B1 commercial-incentive compatibility check rejects a request with an invalid accounting unit (`B1_CAMPAIGN_ENGINE_INCOMPATIBLE`).
8. The B1 commercial-incentive compatibility check rejects a request with a prohibited adjacent scope (`B1_CAMPAIGN_ENGINE_INCOMPATIBLE`).

## 5. B1 commercial-incentive consumer ports

The B1 commercial-incentive consumer ports are the canonical B1 commercial-incentive read-only consumer boundary surface for later B1 tasks (B1T07, B1T08, B1T09, B1T10, B1T11).

The B1 commercial-incentive consumer ports expose seven functions:

1. `generateCampaignDecision(request)` — Returns the canonical B1 campaign decision for the supplied B1 campaign request. The generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
2. `replaySafeGenerateCampaignDecision(request)` — Returns the canonical B1 campaign decision replay-safe result for the supplied B1 campaign request. The replay-safe generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
3. `generatePromotionDecision(request)` — Returns the canonical B1 promotion decision for the supplied B1 promotion request. The generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
4. `replaySafeGeneratePromotionDecision(request)` — Returns the canonical B1 promotion decision replay-safe result for the supplied B1 promotion request. The replay-safe generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
5. `generateCouponDecision(request)` — Returns the canonical B1 coupon decision for the supplied B1 coupon request. The generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
6. `replaySafeGenerateCouponDecision(request)` — Returns the canonical B1 coupon decision replay-safe result for the supplied B1 coupon request. The replay-safe generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
7. `compatibilityCheck(request)` — Returns the canonical B1 commercial-incentive compatibility result for the supplied B1 campaign / promotion / coupon request. The compatibility check is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.

## 6. Acceptance criteria

- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are the only B1 commercial-incentive engines for campaigns, promotions, and coupons.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine never post a journal, mutate a balance, execute a settlement, execute a payout, execute cashback, execute rewards, create a financial effect, repair a binding, change A4 policy / source records, modify invoices, modify statements, modify commercial decisions, modify pricing catalogs, modify product state, or dispatch a notification.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine emit commercial-incentive events through the shared Operations `OutboxService` and record commercial-incentive facts through the shared Operations `AuditService`.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the B1T04 commercial decision; the B1 engines consume the B1T04 commercial decision read-only and never recalculate fee, commission, or revenue sharing.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the B1T05 billing document; the B1 engines consume the B1T05 billing document read-only and never modify invoices, statements, or other billing documents.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are designed to be capable of supporting future marketing campaigns, onboarding promotions, referral campaigns, merchant promotions, seasonal campaigns, coupon codes, promotional pricing, product bundles, and loyalty prerequisites without changing existing A1-A7 authorities.

## 7. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06 — B1 Campaign, Promotion, and Coupon Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/B1-BILLING-ENGINE-CONTRACT.md` — B1 billing engine, invoice engine, and statement-generation engine contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `docs/ADR/ADR-0064-B1-Billing-Invoice-Statement-Engine.md` — B1 billing engine, invoice engine, and statement-generation engine ADR.
- `docs/ADR/ADR-0065-B1-Campaign-Promotion-Coupon-Engine.md` — B1 campaign engine, promotion engine, and coupon engine ADR.
- `src/policy/b1-campaign-engine.types.ts` — B1 campaign engine types.
- `src/policy/b1-campaign-engine.constants.ts` — B1 campaign engine constants.
- `src/policy/b1-campaign-engine.entity.ts` — B1 campaign decision persistence entity.
- `src/policy/b1-campaign-engine.repository.ts` — B1 campaign engine repository.
- `src/policy/b1-campaign-engine.service.ts` — B1 campaign engine service.
- `src/policy/b1-campaign-engine.module.ts` — B1 campaign engine NestJS module.
- `src/migrations/1785753600034-CreateB1CampaignDecisionTables.ts` — B1 campaign decision persistence migration.
- `test/b1-campaign-engine.types.spec.ts` — B1 campaign engine types tests.
- `test/b1-campaign-engine.repository.spec.ts` — B1 campaign engine repository tests.
- `test/b1-campaign-engine.service.spec.ts` — B1 campaign engine service tests.
- `test/b1-campaign-engine.module.spec.ts` — B1 campaign engine module tests.
