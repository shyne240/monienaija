# B1T04 — B1 Fee Engine, Commission Engine, and Revenue Sharing Decision Engine Contract

- **Phase:** B1 — Commercial Platform
- **Task:** B1T04 — B1 Fee Engine, Commission Engine, and Revenue Sharing Decision Engine
- **Contract:** `B1FeeEngineContractV1` / `B1CommercialDecisionRequestV1` / `B1CommercialDecisionRecordV1` / `B1CommercialDecisionReplaySafeResultV1` / `B1CommercialDecisionCompatibilityResultV1` / `B1CommercialDecisionVersioningContractV1` / `B1CommercialDecisionConsumerPortsV1` / `B1CommercialDecisionPersistenceRecordV1`
- **ADR:** `ADR-0063 — B1 Fee Engine, Commission Engine, and Revenue Sharing Decision Engine`
- **Status:** Accepted (B1T04 implementation)
- **Review snapshot:** `b1t04` (B1T04 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Purpose and boundary

B1T04 implements the B1 fee engine, commission engine, and revenue sharing decision engine for the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) established in [`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`](B1-COMMERCIAL-CATALOG-CONTRACT.md) (B1T02) and [`docs/B1-COMMERCIAL-PLATFORM-BASELINE.md`](B1-COMMERCIAL-PLATFORM-BASELINE.md) (B1T01). The B1 fee engine, commission engine, and revenue sharing decision engine is the only B1 commercial decision engine for fee, commission, and revenue sharing. The B1 fee engine, commission engine, and revenue sharing decision engine is a deterministic calculator that computes the B1 commercial decision for a single commercial flow. The B1 fee engine, commission engine, and revenue sharing decision engine is a read-only service; the B1 fee engine, commission engine, and revenue sharing decision engine never posts a journal, mutates a balance, repairs a binding, changes A4 policy / source records, or dispatches a notification.

The B1 fee engine, commission engine, and revenue sharing decision engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 fee engine, commission engine, and revenue sharing decision engine never overrides A4. The B1 fee engine, commission engine, and revenue sharing decision engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 fee engine, commission engine, and revenue sharing decision engine never posts to Ledger. The B1 fee engine, commission engine, and revenue sharing decision engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 fee engine, commission engine, and revenue sharing decision engine never substitutes the A6 partner boundary. The B1 fee engine, commission engine, and revenue sharing decision engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 fee engine, commission engine, and revenue sharing decision engine never substitutes the A7 product boundary.

The B1 fee engine, commission engine, and revenue sharing decision engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 fee engine, commission engine, and revenue sharing decision engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

## 2. B1 fee engine, commission engine, and revenue sharing decision engine contract

### 2.1 Contract identity

The B1 fee engine, commission engine, and revenue sharing decision engine contract is `B1FeeEngineContractV1` (frozen by [`docs/B1-IMPLEMENTATION-PLAN.md`](B1-IMPLEMENTATION-PLAN.md) §8 B1T04). The B1 fee engine, commission engine, and revenue sharing decision engine contract name is `B1-FEE-ENGINE`. The B1 fee engine, commission engine, and revenue sharing decision engine contract version is `1`. The B1 fee engine, commission engine, and revenue sharing decision engine contract document is `docs/B1-FEE-ENGINE-CONTRACT.md`.

### 2.2 B1 commercial decision scope

The B1 fee engine, commission engine, and revenue sharing decision engine is bounded to the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`. The B1 fee engine, commission engine, and revenue sharing decision engine is the only B1 commercial decision engine for the B1 first commercial scope.

### 2.3 B1 commercial decision kind vocabulary

The B1 commercial decision kind vocabulary is the canonical B1 commercial decision kind vocabulary. The B1 commercial decision kind vocabulary is:

- `FEE` — the B1 commercial decision is a fee decision.
- `COMMISSION` — the B1 commercial decision is a commission decision.
- `REVENUE_SHARING` — the B1 commercial decision is a revenue sharing decision.

The B1 commercial decision kind vocabulary is the only B1 commercial decision kind vocabulary; the B1 commercial decision kind vocabulary does NOT introduce a second B1 commercial decision kind vocabulary.

### 2.4 B1 commercial decision outcome vocabulary

The B1 commercial decision outcome vocabulary is the canonical B1 commercial decision outcome vocabulary. The B1 commercial decision outcome vocabulary is:

- `COMMERCIAL_DECISION_ADMITTED` — the B1 commercial decision is admitted.
- `COMMERCIAL_DECISION_SUPPRESSED` — the B1 commercial decision is suppressed.
- `COMMERCIAL_DECISION_DISABLED` — the B1 commercial decision is disabled.
- `COMMERCIAL_DECISION_FAILED` — the B1 commercial decision is failed.

The B1 commercial decision outcome vocabulary is the only B1 commercial decision outcome vocabulary; the B1 commercial decision outcome vocabulary does NOT introduce a second B1 commercial decision outcome vocabulary.

### 2.5 B1 commercial decision rule outcome vocabulary

The B1 commercial decision rule outcome vocabulary is the canonical B1 commercial decision rule outcome vocabulary. The B1 commercial decision rule outcome vocabulary is:

- `PASS` — the B1 commercial decision rule passed.
- `FAIL` — the B1 commercial decision rule failed.
- `SKIP` — the B1 commercial decision rule was skipped.
- `NOT_APPLICABLE` — the B1 commercial decision rule was not applicable.

The B1 commercial decision rule outcome vocabulary is the only B1 commercial decision rule outcome vocabulary; the B1 commercial decision rule outcome vocabulary does NOT introduce a second B1 commercial decision rule outcome vocabulary.

### 2.6 B1 commercial decision rule kind vocabulary

The B1 commercial decision rule kind vocabulary is the canonical B1 commercial decision rule kind vocabulary. The B1 commercial decision rule kind vocabulary is:

- `A4_POLICY_LIMIT`, `A4_POLICY_OBLIGATION`, `A4_POLICY_CURRENTNESS`, `A4_POLICY_REEVALUATION`
- `A3_BINDING_RECHECK`
- `A5_LEDGER_ACCOUNT_STATE`, `A5_LEDGER_POSTING_BOUNDARY`, `A5_FINANCIAL_INVARIANTS`
- `A6_PARTNER_STATE`, `A6_PARTNER_CAPABILITY_VERSION`, `A6T08_SETTLEMENT_SUSPENSE_COMPENSATING`, `A6T09_EXTERNAL_RECONCILIATION`
- `A7_PRODUCT_CATALOG`, `A7_PRODUCT_BOUNDARY`, `A7T04_PRODUCT_CUSTOMER_BINDING`, `A7T05_PRODUCT_COMMAND_OPERATION`, `A7T06_PRODUCT_NOTIFICATION`, `A7T07_PRODUCT_LIFECYCLE`, `A7T08_PRODUCT_FINANCIAL_EFFECT`, `A7T09_PRODUCT_RECONCILIATION`, `A7T10_PRODUCT_DATA_MINIMIZATION`
- `B1_COMMERCIAL_CATALOG_LOOKUP`, `B1_COMMERCIAL_CATALOG_COMPATIBILITY`, `B1_COMMERCIAL_CATALOG_PLAN`, `B1_COMMERCIAL_CATALOG_TIER`, `B1_COMMERCIAL_CATALOG_ENTITLEMENT`, `B1_COMMERCIAL_CATALOG_PACKAGE`, `B1_COMMERCIAL_CATALOG_BUNDLE`, `B1_COMMERCIAL_CATALOG_SUBSCRIPTION`, `B1_COMMERCIAL_CATALOG_FEATURE_FLAG`, `B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT`, `B1_COMMERCIAL_CATALOG_PRICING`

### 2.7 B1 commercial decision failure code vocabulary

The B1 commercial decision failure code vocabulary is the canonical B1 commercial decision failure code vocabulary. The B1 commercial decision failure code vocabulary is:

- `B1_FEE_ENGINE_INVALID_COMMAND`
- `B1_FEE_ENGINE_INCOMPATIBLE`
- `B1_FEE_ENGINE_QUERY_UNAVAILABLE`
- `B1_FEE_ENGINE_PROHIBITED`
- `B1_FEE_ENGINE_A4_POLICY_DENIED`
- `B1_FEE_ENGINE_A3_BINDING_INVALID`
- `B1_FEE_ENGINE_A5_LEDGER_INVARIANT_BROKEN`
- `B1_FEE_ENGINE_A6_PARTNER_INCOMPATIBLE`
- `B1_FEE_ENGINE_A7_PRODUCT_INCOMPATIBLE`
- `B1_FEE_ENGINE_B1_CATALOG_INCOMPATIBLE`
- `B1_FEE_ENGINE_B1_CATALOG_MISSING`
- `B1_FEE_ENGINE_FEATURE_FLAG_DISABLED`
- `B1_FEE_ENGINE_DYNAMIC_LIMIT_EXCEEDED`
- `B1_FEE_ENGINE_REPLAY_CONFLICT`
- `B1_FEE_ENGINE_REPLAY_EXPIRED`
- `B1_FEE_ENGINE_IN_PROGRESS`
- `B1_FEE_ENGINE_BREAK_GLASS_DENIED`

The B1 commercial decision failure code vocabulary is the only B1 commercial decision failure code vocabulary; the B1 commercial decision failure code vocabulary does NOT introduce a second B1 commercial decision failure code vocabulary.

## 3. B1 commercial decision request, result, and replay

### 3.1 B1 commercial decision request

The B1 commercial decision request is the canonical B1 commercial decision request; the B1 commercial decision request is the only B1 commercial decision request. The B1 commercial decision request is a read-only request; the B1 commercial decision request does NOT mutate any A1-A7 source record.

The B1 commercial decision request is the canonical B1 commercial decision request shape. The B1 commercial decision request carries the B1 commercial decision contract identity, the B1 commercial decision kind, the B1 commercial decision scope identity, the B1 commercial decision base amount, the B1 commercial decision base currency, the B1 commercial decision customer identity, the B1 commercial decision customer tier, the B1 commercial decision merchant identity, the B1 commercial decision merchant tier, the B1 commercial decision partner identity, the B1 commercial decision partner tier, the B1 commercial decision product identity, the B1 commercial decision capability identity, the B1 commercial decision plan identity, the B1 commercial decision subscription identity, the B1 commercial decision package identity, the B1 commercial decision bundle identity, the B1 commercial decision product entitlement identity, the B1 commercial decision idempotency key, the B1 commercial decision request context, and the B1 commercial decision causation id.

The B1 commercial decision request hash is the SHA-256 hash of the canonical B1 commercial decision request payload (excluding the B1 commercial decision request context, the B1 commercial decision request id, the B1 commercial decision request version, and the B1 commercial decision causation id). The B1 commercial decision request hash is the only B1 commercial decision request hash; the B1 commercial decision request hash is the canonical B1 commercial decision request hash.

### 3.2 B1 commercial decision record

The B1 commercial decision record is the canonical B1 commercial decision record; the B1 commercial decision record is the only B1 commercial decision record. The B1 commercial decision record is a read-only record; the B1 commercial decision record does NOT mutate any A1-A7 source record.

The B1 commercial decision record carries the B1 commercial decision contract identity, the B1 commercial decision identity, the B1 commercial decision reference, the B1 commercial decision version, the B1 commercial decision kind, the B1 commercial decision outcome, the B1 commercial decision decision hash, the B1 commercial decision decision replay hash, the B1 commercial decision request hash, the B1 commercial decision base amount, the B1 commercial decision base currency, the B1 commercial decision currency, the B1 commercial decision accounting unit, the B1 commercial decision applied plan, the B1 commercial decision applied pricing entry, the B1 commercial decision applied tiers, the B1 commercial decision applied subscription, the B1 commercial decision applied product entitlement, the B1 commercial decision applied package, the B1 commercial decision applied bundle, the B1 commercial decision applied feature flags, the B1 commercial decision applied dynamic limits, the B1 commercial decision fee breakdown, the B1 commercial decision commission breakdown, the B1 commercial decision revenue sharing breakdown, the B1 commercial decision explanation trace, the B1 commercial decision rule trace, the B1 commercial decision audit evidence, the B1 commercial decision idempotency scope, the B1 commercial decision idempotency key, the B1 commercial decision replayed flag, the B1 commercial decision conflict flag, the B1 commercial decision conflict reason, the B1 commercial decision failure, the B1 commercial decision generated timestamp, the B1 commercial decision correlation id, the B1 commercial decision request context, and the B1 commercial decision causation id.

The B1 commercial decision hash is the SHA-256 hash of the canonical B1 commercial decision payload (excluding the B1 commercial decision random `decisionId` and the B1 commercial decision `generatedAt` timestamp). The B1 commercial decision hash is the only B1 commercial decision hash; the B1 commercial decision hash is the canonical B1 commercial decision hash.

The B1 commercial decision replay hash is the SHA-256 hash of the B1 commercial decision hash, the B1 commercial decision request hash, the B1 commercial decision idempotency key, and the B1 commercial decision correlation id. The B1 commercial decision replay hash is the only B1 commercial decision replay hash; the B1 commercial decision replay hash is the canonical B1 commercial decision replay hash.

### 3.3 B1 commercial decision replay-safe decision engine

The B1 commercial decision replay-safe decision engine is the canonical B1 commercial decision replay-safe decision engine. The B1 commercial decision replay-safe decision engine uses the B1 commercial decision internal idempotency scope (`b1.commercial-decision.idempotency.v1`), the B1 commercial decision internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial decision idempotency key, and the B1 commercial decision request hash.

The B1 commercial decision replay rules are:

1. The B1 commercial decision replay window is 86_400 seconds (24 hours).
2. The B1 commercial decision replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial decision replay rule is idempotent (a duplicate lookup returns the durable original decision outcome).
4. The B1 commercial decision replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial decision replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial decision replay rule inherits the A1-A7 replay rules.
7. The B1 commercial decision replay rule inherits the B1T03 catalog replay rule.

### 3.4 B1 commercial decision explanation trace and rule trace

The B1 commercial decision explanation trace is the canonical B1 commercial decision explanation trace; the B1 commercial decision explanation trace is the only B1 commercial decision explanation trace. The B1 commercial decision explanation trace carries the B1 commercial decision trace id, the B1 commercial decision trace kind, the B1 commercial decision trace summary, the B1 commercial decision trace steps, the B1 commercial decision generated timestamp, and the B1 commercial decision correlation id.

The B1 commercial decision rule trace is the canonical B1 commercial decision rule trace; the B1 commercial decision rule trace is the only B1 commercial decision rule trace. The B1 commercial decision rule trace carries the B1 commercial decision rule trace id, the B1 commercial decision rule trace steps, the B1 commercial decision generated timestamp, and the B1 commercial decision correlation id.

The B1 commercial decision explanation trace and rule trace are consumed by the B1T10 commercial data classification / commercial disclosure / commercial support-trace contract (re-asserted from the B1T10 plan). The B1 commercial decision explanation trace and rule trace do NOT introduce a second B1 commercial decision explanation trace or rule trace.

## 4. B1 commercial decision compatibility validation

The B1 commercial decision compatibility validation is the canonical B1 commercial decision compatibility validation; the B1 commercial decision compatibility validation is the only B1 commercial decision compatibility validation. The B1 commercial decision compatibility validation verifies that the B1 commercial decision version is supported, that the B1 commercial decision scope key is supported, that the B1 commercial decision scope version is supported, that the B1 commercial decision decision kind is supported, that the B1 commercial decision currency is supported, that the B1 commercial decision accounting unit is supported, and that the B1 commercial decision plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

The B1 commercial decision compatibility rules are:

1. The B1 commercial decision compatibility check rejects a request with an invalid contract name (`B1_FEE_ENGINE_INVALID_COMMAND`).
2. The B1 commercial decision compatibility check rejects a request with an invalid contract version (`B1_FEE_ENGINE_INVALID_COMMAND`).
3. The B1 commercial decision compatibility check rejects a request with an invalid scope key (`B1_FEE_ENGINE_INCOMPATIBLE`).
4. The B1 commercial decision compatibility check rejects a request with an invalid scope version (`B1_FEE_ENGINE_INCOMPATIBLE`).
5. The B1 commercial decision compatibility check rejects a request with an invalid decision kind (`B1_FEE_ENGINE_INCOMPATIBLE`).
6. The B1 commercial decision compatibility check rejects a request with an invalid currency (`B1_FEE_ENGINE_INCOMPATIBLE`).
7. The B1 commercial decision compatibility check rejects a request with an invalid accounting unit (`B1_FEE_ENGINE_INCOMPATIBLE`).
8. The B1 commercial decision compatibility check rejects a request with a prohibited adjacent scope (`B1_FEE_ENGINE_INCOMPATIBLE`).

## 5. B1 commercial decision consumer ports

The B1 commercial decision consumer ports are the canonical B1 commercial decision read-only consumer boundary surface for later B1 tasks (B1T05, B1T06, B1T07, B1T08, B1T09, B1T10, B1T11).

The B1 commercial decision consumer ports expose three functions:

1. `evaluate(request)` — Returns the canonical B1 commercial decision record for the supplied B1 commercial decision request. The evaluate is read-only; the B1 commercial decision evaluate does NOT mutate any A1-A7 source record.
2. `replaySafeEvaluate(request)` — Returns the canonical B1 commercial decision replay-safe result for the supplied B1 commercial decision request. The replay-safe evaluate is read-only; the B1 commercial decision replay-safe evaluate does NOT mutate any A1-A7 source record.
3. `compatibilityCheck(request)` — Returns the canonical B1 commercial decision compatibility result for the supplied B1 commercial decision request. The compatibility check is read-only; the B1 commercial decision compatibility check does NOT mutate any A1-A7 source record.

## 6. Acceptance criteria

- The B1 fee engine, commission engine, and revenue sharing decision engine are the only B1 commercial decision engines for fee, commission, and revenue sharing.
- The B1 fee engine, commission engine, and revenue sharing decision engine consume the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 fee engine, commission engine, and revenue sharing decision engine never post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.
- The B1 fee engine, commission engine, and revenue sharing decision engine emit commercial-decision events through the shared Operations `OutboxService` and record commercial-decision facts through the shared Operations `AuditService`.
- The B1 fee engine, commission engine, and revenue sharing decision engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 fee engine, commission engine, and revenue sharing decision engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger.
- The B1 fee engine, commission engine, and revenue sharing decision engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 fee engine, commission engine, and revenue sharing decision engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 fee engine, commission engine, and revenue sharing decision engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 fee engine, commission engine, and revenue sharing decision engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

## 7. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04 — B1 Fee Engine and Commission Engine (Revenue Sharing).
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `src/policy/b1-fee-engine.types.ts` — B1 fee engine types.
- `src/policy/b1-fee-engine.constants.ts` — B1 fee engine constants.
- `src/policy/b1-fee-engine.entity.ts` — B1 commercial decision persistence entity.
- `src/policy/b1-fee-engine.repository.ts` — B1 fee engine repository.
- `src/policy/b1-fee-engine.service.ts` — B1 fee engine service.
- `src/policy/b1-fee-engine.module.ts` — B1 fee engine NestJS module.
- `src/migrations/1785753600032-CreateB1CommercialDecisionTables.ts` — B1 commercial decision persistence migration.
- `test/b1-fee-engine.types.spec.ts` — B1 fee engine types tests.
- `test/b1-fee-engine.constants.spec.ts` — B1 fee engine constants tests.
- `test/b1-fee-engine.repository.spec.ts` — B1 fee engine repository tests.
- `test/b1-fee-engine.service.spec.ts` — B1 fee engine service tests.
- `test/b1-fee-engine.module.spec.ts` — B1 fee engine module tests.
