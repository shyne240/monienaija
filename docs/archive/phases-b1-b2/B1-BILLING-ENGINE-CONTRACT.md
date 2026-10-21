# B1T05 — B1 Billing Engine, Invoice Engine, and Statement-Generation Engine Contract

- **Phase:** B1 — Commercial Platform
- **Task:** B1T05 — B1 Billing Engine, Invoice Engine, and Statement-Generation Engine
- **Contract:** `B1BillingEngineContractV1` / `B1BillingRecordV1` / `B1BillingRecordReplaySafeResultV1` / `B1InvoiceV1` / `B1InvoiceReplaySafeResultV1` / `B1StatementV1` / `B1StatementReplaySafeResultV1` / `B1BillingDocumentCompatibilityResultV1` / `B1BillingDocumentVersioningContractV1` / `B1BillingEngineConsumerPortsV1` / `B1BillingDocumentPersistenceRecordV1`
- **ADR:** `ADR-0064 — B1 Billing Engine, Invoice Engine, and Statement-Generation Engine`
- **Status:** Accepted (B1T05 implementation)
- **Review snapshot:** `b1t05` (B1T05 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Purpose and boundary

B1T05 implements the B1 billing engine, invoice engine, and statement-generation engine for the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) established in [`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`](B1-COMMERCIAL-CATALOG-CONTRACT.md) (B1T02) and [`docs/B1-COMMERCIAL-PLATFORM-BASELINE.md`](B1-COMMERCIAL-PLATFORM-BASELINE.md) (B1T01). The B1 billing engine, invoice engine, and statement-generation engine is the only B1 billing document engine for billing records, invoices, and statements. The B1 billing engine, invoice engine, and statement-generation engine is a deterministic document generator that produces a durable B1 billing document (billing record, invoice, or statement) for a single commercial flow. The B1 billing engine, invoice engine, and statement-generation engine is a read-only document generator; the B1 billing engine, invoice engine, and statement-generation engine never posts a journal, mutates a balance, executes a settlement, executes a payout, creates a financial effect, repairs a binding, changes A4 policy / source records, modifies pricing catalogs, modifies commercial decisions, modifies product state, or dispatches a notification.

The B1 billing engine, invoice engine, and statement-generation engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 billing engine, invoice engine, and statement-generation engine never overrides A4. The B1 billing engine, invoice engine, and statement-generation engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 billing engine, invoice engine, and statement-generation engine never posts to Ledger. The B1 billing engine, invoice engine, and statement-generation engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 billing engine, invoice engine, and statement-generation engine never substitutes the A6 partner boundary. The B1 billing engine, invoice engine, and statement-generation engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 billing engine, invoice engine, and statement-generation engine never substitutes the A7 product boundary. The B1 billing engine, invoice engine, and statement-generation engine is bounded by the B1T04 commercial decision; the B1 billing engine, invoice engine, and statement-generation engine consumes the B1T04 commercial decision read-only and never recalculates fee, commission, or revenue sharing.

The B1 billing engine, invoice engine, and statement-generation engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 billing engine, invoice engine, and statement-generation engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

## 2. B1 billing engine, invoice engine, and statement-generation engine contract

### 2.1 Contract identity

The B1 billing engine, invoice engine, and statement-generation engine contract is `B1BillingEngineContractV1` (frozen by [`docs/B1-IMPLEMENTATION-PLAN.md`](B1-IMPLEMENTATION-PLAN.md) §8 B1T05). The B1 billing engine, invoice engine, and statement-generation engine contract name is `B1-BILLING-ENGINE`. The B1 billing engine, invoice engine, and statement-generation engine contract version is `1`. The B1 billing engine, invoice engine, and statement-generation engine contract document is `docs/B1-BILLING-ENGINE-CONTRACT.md`.

### 2.2 B1 billing document scope

The B1 billing engine, invoice engine, and statement-generation engine is bounded to the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`. The B1 billing engine, invoice engine, and statement-generation engine is the only B1 billing document engine for the B1 first commercial scope.

### 2.3 B1 billing document kind vocabulary

The B1 billing document kind vocabulary is the canonical B1 billing document kind vocabulary. The B1 billing document kind vocabulary is:

- `BILLING_RECORD` — the B1 billing document is a billing record.
- `INVOICE` — the B1 billing document is an invoice.
- `STATEMENT` — the B1 billing document is a statement.

The B1 billing document kind vocabulary is the only B1 billing document kind vocabulary; the B1 billing document kind vocabulary does NOT introduce a second B1 billing document kind vocabulary.

### 2.4 B1 billing record state vocabulary

The B1 billing record state vocabulary is the canonical B1 billing record state vocabulary. The B1 billing record state vocabulary is:

- `CREATED` — the B1 billing record has been created but is not yet ready for issuance.
- `READY` — the B1 billing record is ready for downstream document generation.
- `ISSUED` — the B1 billing record has been issued to the customer and downstream surfaces.
- `CANCELLED` — the B1 billing record has been cancelled (in place, before issuance).
- `REPLAYED` — the B1 billing record has been replayed from a duplicate request.

The B1 billing record state vocabulary is the only B1 billing record state vocabulary; the B1 billing record state vocabulary does NOT introduce a second B1 billing record state vocabulary.

### 2.5 B1 invoice state vocabulary

The B1 invoice state vocabulary is the canonical B1 invoice state vocabulary. The B1 invoice state vocabulary is:

- `DRAFT` — the B1 invoice is in draft state.
- `GENERATED` — the B1 invoice has been generated.
- `ISSUED` — the B1 invoice has been issued to the customer and downstream surfaces.
- `CANCELLED` — the B1 invoice has been cancelled (in place, before issuance).
- `VOIDED` — the B1 invoice has been voided (after issuance; the B1 invoice is preserved with `VOIDED` state for audit, reconciliation, and reference).

The B1 invoice state vocabulary is the only B1 invoice state vocabulary; the B1 invoice state vocabulary does NOT introduce a second B1 invoice state vocabulary.

### 2.6 B1 statement state vocabulary

The B1 statement state vocabulary is the canonical B1 statement state vocabulary. The B1 statement state vocabulary is:

- `OPEN` — the B1 statement is open and may receive additional documents.
- `GENERATED` — the B1 statement has been generated.
- `CLOSED` — the B1 statement is closed; no additional documents will be added.
- `REGENERATED` — the B1 statement has been regenerated from a later request.

The B1 statement state vocabulary is the only B1 statement state vocabulary; the B1 statement state vocabulary does NOT introduce a second B1 statement state vocabulary.

### 2.7 B1 billing document line kind vocabulary

The B1 billing document line kind vocabulary is the canonical B1 billing document line kind vocabulary. The B1 billing document line kind vocabulary is:

- `FEE` — the B1 billing document line is a fee line.
- `COMMISSION` — the B1 billing document line is a commission line.
- `REVENUE_SHARING` — the B1 billing document line is a revenue sharing line.

The B1 billing document line kind vocabulary is the only B1 billing document line kind vocabulary; the B1 billing document line kind vocabulary does NOT introduce a second B1 billing document line kind vocabulary.

### 2.8 B1 billing document rule outcome vocabulary

The B1 billing document rule outcome vocabulary is the canonical B1 billing document rule outcome vocabulary. The B1 billing document rule outcome vocabulary is:

- `PASS` — the B1 billing document rule passed.
- `FAIL` — the B1 billing document rule failed.
- `SKIP` — the B1 billing document rule was skipped.
- `NOT_APPLICABLE` — the B1 billing document rule was not applicable.

The B1 billing document rule outcome vocabulary is the only B1 billing document rule outcome vocabulary; the B1 billing document rule outcome vocabulary does NOT introduce a second B1 billing document rule outcome vocabulary.

### 2.9 B1 billing document rule kind vocabulary

The B1 billing document rule kind vocabulary is the canonical B1 billing document rule kind vocabulary. The B1 billing document rule kind vocabulary is:

- `A4_POLICY_LIMIT`, `A4_POLICY_OBLIGATION`, `A4_POLICY_CURRENTNESS`, `A4_POLICY_REEVALUATION`
- `A3_BINDING_RECHECK`
- `A5_LEDGER_ACCOUNT_STATE`, `A5_LEDGER_POSTING_BOUNDARY`, `A5_FINANCIAL_INVARIANTS`
- `A6_PARTNER_STATE`, `A6_PARTNER_CAPABILITY_VERSION`, `A6T08_SETTLEMENT_SUSPENSE_COMPENSATING`, `A6T09_EXTERNAL_RECONCILIATION`
- `A7_PRODUCT_CATALOG`, `A7_PRODUCT_BOUNDARY`, `A7T04_PRODUCT_CUSTOMER_BINDING`, `A7T05_PRODUCT_COMMAND_OPERATION`, `A7T06_PRODUCT_NOTIFICATION`, `A7T07_PRODUCT_LIFECYCLE`, `A7T08_PRODUCT_FINANCIAL_EFFECT`, `A7T09_PRODUCT_RECONCILIATION`, `A7T10_PRODUCT_DATA_MINIMIZATION`
- `B1_COMMERCIAL_CATALOG_LOOKUP`, `B1_COMMERCIAL_CATALOG_PLAN`, `B1_COMMERCIAL_CATALOG_TIER`, `B1_COMMERCIAL_CATALOG_ENTITLEMENT`, `B1_COMMERCIAL_CATALOG_PACKAGE`, `B1_COMMERCIAL_CATALOG_BUNDLE`, `B1_COMMERCIAL_CATALOG_SUBSCRIPTION`, `B1_COMMERCIAL_CATALOG_FEATURE_FLAG`, `B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT`, `B1_COMMERCIAL_CATALOG_PRICING`
- `B1_COMMERCIAL_DECISION_LOOKUP`, `B1_COMMERCIAL_DECISION_REPLAY`
- `B1_BILLING_ENGINE_DOCUMENT_VERSION`, `B1_BILLING_ENGINE_NUMBER_DETERMINISTIC`

### 2.10 B1 billing document failure code vocabulary

The B1 billing document failure code vocabulary is the canonical B1 billing document failure code vocabulary. The B1 billing document failure code vocabulary is:

- `B1_BILLING_ENGINE_INVALID_COMMAND`
- `B1_BILLING_ENGINE_INCOMPATIBLE`
- `B1_BILLING_ENGINE_QUERY_UNAVAILABLE`
- `B1_BILLING_ENGINE_PROHIBITED`
- `B1_BILLING_ENGINE_IN_PROGRESS`
- `B1_BILLING_ENGINE_REPLAY_CONFLICT`
- `B1_BILLING_ENGINE_REPLAY_EXPIRED`
- `B1_BILLING_ENGINE_REPLAYED`
- `B1_BILLING_ENGINE_A4_POLICY_DENIED`
- `B1_BILLING_ENGINE_A3_BINDING_INVALID`
- `B1_BILLING_ENGINE_A5_LEDGER_INVARIANT_BROKEN`
- `B1_BILLING_ENGINE_A6_PARTNER_INCOMPATIBLE`
- `B1_BILLING_ENGINE_A7_PRODUCT_INCOMPATIBLE`
- `B1_BILLING_ENGINE_B1_CATALOG_INCOMPATIBLE`
- `B1_BILLING_ENGINE_B1_DECISION_INCOMPATIBLE`
- `B1_BILLING_ENGINE_NUMBER_DETERMINISTIC_MISMATCH`
- `B1_BILLING_ENGINE_VERSION_MISMATCH`
- `B1_BILLING_ENGINE_SCOPE_MISMATCH`

The B1 billing document failure code vocabulary is the only B1 billing document failure code vocabulary; the B1 billing document failure code vocabulary does NOT introduce a second B1 billing document failure code vocabulary.

## 3. B1 billing document request, result, and replay

### 3.1 B1 billing record request

The B1 billing record request is the canonical B1 billing record request; the B1 billing record request is the only B1 billing record request. The B1 billing record request is a read-only request; the B1 billing record request does NOT mutate any A1-A7 source record.

The B1 billing record request carries the B1 billing record contract identity, the B1 billing record billing request identity, the B1 billing record billing request version, the B1 billing record scope identity, the B1 billing record period identity, the B1 billing record period window, the B1 billing record base currency, the B1 billing record base accounting unit, the B1 billing record customer identity, the B1 billing record customer tier, the B1 billing record merchant identity, the B1 billing record merchant tier, the B1 billing record partner identity, the B1 billing record partner tier, the B1 billing record product identity, the B1 billing record capability identity, the B1 billing record plan identity, the B1 billing record subscription identity, the B1 billing record package identity, the B1 billing record bundle identity, the B1 billing record product entitlement identity, the B1 billing record commercial decision references, the B1 billing record commercial decision idempotency keys, the B1 billing record idempotency key, the B1 billing record request context, and the B1 billing record causation id.

The B1 billing record request hash is the SHA-256 hash of the canonical B1 billing record request payload (excluding the B1 billing record request context, the B1 billing record request id, the B1 billing record request version, and the B1 billing record causation id). The B1 billing record request hash is the only B1 billing record request hash; the B1 billing record request hash is the canonical B1 billing record request hash.

### 3.2 B1 billing record document

The B1 billing record document is the canonical B1 billing record document; the B1 billing record document is the only B1 billing record document. The B1 billing record document is a read-only document; the B1 billing record document does NOT mutate any A1-A7 source record.

The B1 billing record document carries the B1 billing record contract identity, the B1 billing record document identity, the B1 billing record document reference, the B1 billing record document version, the B1 billing record document state, the B1 billing record document hash, the B1 billing record document replay hash, the B1 billing record request hash, the B1 billing record scope identity, the B1 billing record scope version, the B1 billing record period identity, the B1 billing record period window, the B1 billing record customer identity, the B1 billing record merchant identity, the B1 billing record partner identity, the B1 billing record product identity, the B1 billing record capability identity, the B1 billing record plan identity, the B1 billing record subscription identity, the B1 billing record package identity, the B1 billing record bundle identity, the B1 billing record product entitlement identity, the B1 billing record customer tier, the B1 billing record merchant tier, the B1 billing record partner tier, the B1 billing record base amount, the B1 billing record base currency, the B1 billing record currency, the B1 billing record accounting unit, the B1 billing record fee, the B1 billing record commission, the B1 billing record revenue sharing, the B1 billing record total, the B1 billing record commercial decision reference, the B1 billing record commercial decision idempotency key, the B1 billing record explanation trace, the B1 billing record rule trace, the B1 billing record audit evidence, the B1 billing record idempotency scope, the B1 billing record idempotency key, the B1 billing record replayed flag, the B1 billing record conflict flag, the B1 billing record conflict reason, the B1 billing record failure, the B1 billing record generated timestamp, the B1 billing record correlation id, the B1 billing record request context, and the B1 billing record causation id.

The B1 billing record document hash is the SHA-256 hash of the canonical B1 billing record document payload (excluding the B1 billing record random `documentId` and the B1 billing record `generatedAt` timestamp). The B1 billing record document hash is the only B1 billing record document hash; the B1 billing record document hash is the canonical B1 billing record document hash.

The B1 billing record replay hash is the SHA-256 hash of the B1 billing record document hash, the B1 billing record request hash, the B1 billing record idempotency key, and the B1 billing record correlation id. The B1 billing record replay hash is the only B1 billing record replay hash; the B1 billing record replay hash is the canonical B1 billing record replay hash.

### 3.3 B1 invoice request

The B1 invoice request is the canonical B1 invoice request; the B1 invoice request is the only B1 invoice request. The B1 invoice request is a read-only request; the B1 invoice request does NOT mutate any A1-A7 source record.

The B1 invoice request carries the B1 invoice contract identity, the B1 invoice request identity, the B1 invoice request version, the B1 invoice scope identity, the B1 invoice base currency, the B1 invoice base accounting unit, the B1 invoice customer identity, the B1 invoice customer tier, the B1 invoice merchant identity, the B1 invoice merchant tier, the B1 invoice partner identity, the B1 invoice partner tier, the B1 invoice product identity, the B1 invoice capability identity, the B1 invoice plan identity, the B1 invoice subscription identity, the B1 invoice package identity, the B1 invoice bundle identity, the B1 invoice product entitlement identity, the B1 invoice billing record references, the B1 invoice commercial decision references, the B1 invoice commercial decision idempotency keys, the B1 invoice idempotency key, the B1 invoice request context, and the B1 invoice causation id.

The B1 invoice request hash is the SHA-256 hash of the canonical B1 invoice request payload (excluding the B1 invoice request context, the B1 invoice request id, the B1 invoice request version, and the B1 invoice causation id). The B1 invoice request hash is the only B1 invoice request hash; the B1 invoice request hash is the canonical B1 invoice request hash.

### 3.4 B1 invoice document

The B1 invoice document is the canonical B1 invoice document; the B1 invoice document is the only B1 invoice document. The B1 invoice document is a read-only document; the B1 invoice document does NOT mutate any A1-A7 source record.

The B1 invoice document carries the B1 invoice contract identity, the B1 invoice document identity, the B1 invoice number, the B1 invoice document version, the B1 invoice document state, the B1 invoice document hash, the B1 invoice document replay hash, the B1 invoice request hash, the B1 invoice scope identity, the B1 invoice scope version, the B1 invoice customer identity, the B1 invoice merchant identity, the B1 invoice partner identity, the B1 invoice product identity, the B1 invoice capability identity, the B1 invoice plan identity, the B1 invoice subscription identity, the B1 invoice package identity, the B1 invoice bundle identity, the B1 invoice product entitlement identity, the B1 invoice customer tier, the B1 invoice merchant tier, the B1 invoice partner tier, the B1 invoice base amount, the B1 invoice base currency, the B1 invoice currency, the B1 invoice accounting unit, the B1 invoice fee, the B1 invoice commission, the B1 invoice revenue sharing, the B1 invoice total, the B1 invoice period identity, the B1 invoice issued timestamp, the B1 invoice commercial decision references, the B1 invoice commercial decision idempotency keys, the B1 invoice explanation trace, the B1 invoice rule trace, the B1 invoice audit evidence, the B1 invoice idempotency scope, the B1 invoice idempotency key, the B1 invoice replayed flag, the B1 invoice conflict flag, the B1 invoice conflict reason, the B1 invoice failure, the B1 invoice generated timestamp, the B1 invoice correlation id, the B1 invoice request context, the B1 invoice causation id, and the B1 invoice lines.

The B1 invoice number is the canonical B1 invoice number; the B1 invoice number is a SHA-256-based deterministic reference that includes the B1 invoice scope identity, the B1 invoice scope version, and the B1 invoice request hash. The B1 invoice number is the only B1 invoice number; the B1 invoice number is the canonical B1 invoice number; a duplicate B1 invoice request returns the same B1 invoice number (replay-safe).

The B1 invoice document hash is the SHA-256 hash of the canonical B1 invoice document payload (excluding the B1 invoice random `documentId` and the B1 invoice `generatedAt` timestamp). The B1 invoice document hash is the only B1 invoice document hash; the B1 invoice document hash is the canonical B1 invoice document hash.

The B1 invoice replay hash is the SHA-256 hash of the B1 invoice document hash, the B1 invoice request hash, the B1 invoice idempotency key, and the B1 invoice correlation id. The B1 invoice replay hash is the only B1 invoice replay hash; the B1 invoice replay hash is the canonical B1 invoice replay hash.

### 3.5 B1 statement request

The B1 statement request is the canonical B1 statement request; the B1 statement request is the only B1 statement request. The B1 statement request is a read-only request; the B1 statement request does NOT mutate any A1-A7 source record.

The B1 statement request carries the B1 statement contract identity, the B1 statement request identity, the B1 statement request version, the B1 statement scope identity, the B1 statement period identity, the B1 statement period window, the B1 statement base currency, the B1 statement base accounting unit, the B1 statement customer identity, the B1 statement customer tier, the B1 statement merchant identity, the B1 statement merchant tier, the B1 statement partner identity, the B1 statement partner tier, the B1 statement product identity, the B1 statement billing record references, the B1 statement invoice references, the B1 statement commercial decision references, the B1 statement commercial decision idempotency keys, the B1 statement idempotency key, the B1 statement request context, and the B1 statement causation id.

The B1 statement request hash is the SHA-256 hash of the canonical B1 statement request payload (excluding the B1 statement request context, the B1 statement request id, the B1 statement request version, and the B1 statement causation id). The B1 statement request hash is the only B1 statement request hash; the B1 statement request hash is the canonical B1 statement request hash.

### 3.6 B1 statement document

The B1 statement document is the canonical B1 statement document; the B1 statement document is the only B1 statement document. The B1 statement document is a read-only document; the B1 statement document does NOT mutate any A1-A7 source record.

The B1 statement document carries the B1 statement contract identity, the B1 statement document identity, the B1 statement number, the B1 statement document version, the B1 statement document state, the B1 statement document hash, the B1 statement document replay hash, the B1 statement request hash, the B1 statement scope identity, the B1 statement scope version, the B1 statement customer identity, the B1 statement merchant identity, the B1 statement partner identity, the B1 statement product identity, the B1 statement period identity, the B1 statement period window, the B1 statement base amount, the B1 statement base currency, the B1 statement currency, the B1 statement accounting unit, the B1 statement opening balance, the B1 statement closing balance, the B1 statement fee, the B1 statement commission, the B1 statement revenue sharing, the B1 statement total debit, the B1 statement total credit, the B1 statement total, the B1 statement issued timestamp, the B1 statement invoice references, the B1 statement commercial decision references, the B1 statement commercial decision idempotency keys, the B1 statement explanation trace, the B1 statement rule trace, the B1 statement audit evidence, the B1 statement idempotency scope, the B1 statement idempotency key, the B1 statement replayed flag, the B1 statement conflict flag, the B1 statement conflict reason, the B1 statement failure, the B1 statement generated timestamp, the B1 statement correlation id, the B1 statement request context, the B1 statement causation id, and the B1 statement lines.

The B1 statement number is the canonical B1 statement number; the B1 statement number is a SHA-256-based deterministic reference that includes the B1 statement scope identity, the B1 statement scope version, and the B1 statement request hash. The B1 statement number is the only B1 statement number; the B1 statement number is the canonical B1 statement number; a duplicate B1 statement request returns the same B1 statement number (replay-safe).

The B1 statement document hash is the SHA-256 hash of the canonical B1 statement document payload (excluding the B1 statement random `documentId` and the B1 statement `generatedAt` timestamp). The B1 statement document hash is the only B1 statement document hash; the B1 statement document hash is the canonical B1 statement document hash.

The B1 statement replay hash is the SHA-256 hash of the B1 statement document hash, the B1 statement request hash, the B1 statement idempotency key, and the B1 statement correlation id. The B1 statement replay hash is the only B1 statement replay hash; the B1 statement replay hash is the canonical B1 statement replay hash.

### 3.7 B1 billing document replay-safe document generation engine

The B1 billing document replay-safe document generation engine is the canonical B1 billing document replay-safe document generation engine. The B1 billing document replay-safe document generation engine uses the B1 billing document internal idempotency scope (`b1.billing-engine.idempotency.v1`), the B1 billing document invoice idempotency scope (`b1.billing-engine.invoice.idempotency.v1`), the B1 billing document statement idempotency scope (`b1.billing-engine.statement.idempotency.v1`), the B1 billing document idempotency retention (86_400 seconds = 24 hours), the B1 billing document idempotency key, and the B1 billing document request hash.

The B1 billing document replay rules are:

1. The B1 billing document replay window is 86_400 seconds (24 hours).
2. The B1 billing document replay rule is exact-match required (the request hash MUST match).
3. The B1 billing document replay rule is idempotent (a duplicate generate returns the durable original document).
4. The B1 billing document replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 billing document replay rule expires after the replay window (an expired generate MUST NOT be replayed).
6. The B1 billing document replay rule inherits the A1-A7 replay rules.
7. The B1 billing document replay rule inherits the B1T03 catalog replay rule.
8. The B1 billing document replay rule inherits the B1T04 commercial decision replay rule.

### 3.8 B1 billing document explanation trace and rule trace

The B1 billing document explanation trace is the canonical B1 billing document explanation trace; the B1 billing document explanation trace is the only B1 billing document explanation trace. The B1 billing document explanation trace carries the B1 billing document trace id, the B1 billing document trace kind, the B1 billing document trace summary, the B1 billing document trace steps, the B1 billing document generated timestamp, and the B1 billing document correlation id.

The B1 billing document rule trace is the canonical B1 billing document rule trace; the B1 billing document rule trace is the only B1 billing document rule trace. The B1 billing document rule trace carries the B1 billing document rule trace id, the B1 billing document rule trace steps, the B1 billing document generated timestamp, and the B1 billing document correlation id.

The B1 billing document explanation trace and rule trace are consumed by the B1T10 commercial data classification / commercial disclosure / commercial support-trace contract (re-asserted from the B1T10 plan). The B1 billing document explanation trace and rule trace do NOT introduce a second B1 billing document explanation trace or rule trace.

## 4. B1 billing document compatibility validation

The B1 billing document compatibility validation is the canonical B1 billing document compatibility validation; the B1 billing document compatibility validation is the only B1 billing document compatibility validation. The B1 billing document compatibility validation verifies that the B1 billing document version is supported, that the B1 billing document scope key is supported, that the B1 billing document scope version is supported, that the B1 billing document kind is supported, that the B1 billing document currency is supported, that the B1 billing document accounting unit is supported, and that the B1 billing document plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

The B1 billing document compatibility rules are:

1. The B1 billing document compatibility check rejects a request with an invalid contract name (`B1_BILLING_ENGINE_INVALID_COMMAND`).
2. The B1 billing document compatibility check rejects a request with an invalid contract version (`B1_BILLING_ENGINE_INVALID_COMMAND`).
3. The B1 billing document compatibility check rejects a request with an invalid scope key (`B1_BILLING_ENGINE_SCOPE_MISMATCH`).
4. The B1 billing document compatibility check rejects a request with an invalid scope version (`B1_BILLING_ENGINE_INCOMPATIBLE`).
5. The B1 billing document compatibility check rejects a request with an invalid document kind (`B1_BILLING_ENGINE_INCOMPATIBLE`).
6. The B1 billing document compatibility check rejects a request with an invalid currency (`B1_BILLING_ENGINE_INCOMPATIBLE`).
7. The B1 billing document compatibility check rejects a request with an invalid accounting unit (`B1_BILLING_ENGINE_INCOMPATIBLE`).
8. The B1 billing document compatibility check rejects a request with a prohibited adjacent scope (`B1_BILLING_ENGINE_INCOMPATIBLE`).

## 5. B1 billing document consumer ports

The B1 billing document consumer ports are the canonical B1 billing document read-only consumer boundary surface for later B1 tasks (B1T08, B1T09, B1T10, B1T11).

The B1 billing document consumer ports expose seven functions:

1. `generateBillingRecord(request)` — Returns the canonical B1 billing record document for the supplied B1 billing record request. The generate billing record is read-only; the B1 billing record generate does NOT mutate any A1-A7 source record.
2. `replaySafeGenerateBillingRecord(request)` — Returns the canonical B1 billing record replay-safe result for the supplied B1 billing record request. The replay-safe generate billing record is read-only; the B1 billing record replay-safe generate does NOT mutate any A1-A7 source record.
3. `generateInvoice(request)` — Returns the canonical B1 invoice document for the supplied B1 invoice request. The generate invoice is read-only; the B1 invoice generate does NOT mutate any A1-A7 source record.
4. `replaySafeGenerateInvoice(request)` — Returns the canonical B1 invoice replay-safe result for the supplied B1 invoice request. The replay-safe generate invoice is read-only; the B1 invoice replay-safe generate does NOT mutate any A1-A7 source record.
5. `generateStatement(request)` — Returns the canonical B1 statement document for the supplied B1 statement request. The generate statement is read-only; the B1 statement generate does NOT mutate any A1-A7 source record.
6. `replaySafeGenerateStatement(request)` — Returns the canonical B1 statement replay-safe result for the supplied B1 statement request. The replay-safe generate statement is read-only; the B1 statement replay-safe generate does NOT mutate any A1-A7 source record.
7. `compatibilityCheck(request)` — Returns the canonical B1 billing document compatibility result for the supplied B1 billing document request. The compatibility check is read-only; the B1 billing document compatibility check does NOT mutate any A1-A7 source record.

## 6. Acceptance criteria

- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are the only B1 billing document engines for billing, invoicing, and statement generation.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine never post a journal, mutate a balance, execute a settlement, execute a payout, create a financial effect, repair a binding, change A4 policy / source records, modify pricing catalogs, modify commercial decisions, modify product state, or dispatch a notification.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine emit commercial-financial-effect events through the shared Operations `OutboxService` and record commercial-financial-effect facts through the shared Operations `AuditService`.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are bounded by the B1T04 commercial decision; the B1 engines consume the B1T04 commercial decision read-only and never recalculate fee, commission, or revenue sharing.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

## 7. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05 — B1 Billing Engine, Invoice Engine, and Statement-Generation Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `docs/ADR/ADR-0064-B1-Billing-Invoice-Statement-Engine.md` — B1 billing engine, invoice engine, and statement-generation engine ADR.
- `src/policy/b1-billing-engine.types.ts` — B1 billing engine types.
- `src/policy/b1-billing-engine.constants.ts` — B1 billing engine constants.
- `src/policy/b1-billing-engine.entity.ts` — B1 billing document persistence entity.
- `src/policy/b1-billing-engine.repository.ts` — B1 billing engine repository.
- `src/policy/b1-billing-engine.service.ts` — B1 billing engine service.
- `src/policy/b1-billing-engine.module.ts` — B1 billing engine NestJS module.
- `src/migrations/1785753600033-CreateB1BillingDocumentTables.ts` — B1 billing document persistence migration.
- `test/b1-billing-engine.types.spec.ts` — B1 billing engine types tests.
- `test/b1-billing-engine.repository.spec.ts` — B1 billing engine repository tests.
- `test/b1-billing-engine.service.spec.ts` — B1 billing engine service tests.
- `test/b1-billing-engine.module.spec.ts` — B1 billing engine module tests.
