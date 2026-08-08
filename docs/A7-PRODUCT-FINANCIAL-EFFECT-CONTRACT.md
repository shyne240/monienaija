# A7T08 — A7 Product Financial Effect, Settlement, and Ledger Contract

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T08 — A7 product financial effect, settlement, and Ledger integration
- **Status:** A7 product financial effect envelope, A6T08 settlement / suspense / compensating-entry integration, A5 Ledger journal / reversal integration, A1 / A2 / A3 / A4 / A6 / A7 upstream authority correlation, fail-closed pilot-disable boundary, audit / idempotency / outbox / metrics integration, and contract document are defined; the existing A5 `LedgerService` and the existing A6T08 `ExternalSettlementService` are the only financial value and settlement / suspense / compensating authorities; no new Ledger chart, no new settlement, no new suspense, no new compensating-entry, no new customer-binding, no new customer-preference, no new product-policy, no new A6T05 lifecycle authority is introduced; A7T08 reuses the A5 Ledger service, the A6T08 settlement / suspense / compensating-entry service, the A7T04 product customer-binding map, the A7T05 product command/operation identity, the A7T07 product lifecycle handoff, the A3 internal account binding, the A2 protected-route authorization, the A4 product-policy profile, the A6T05 external-operation identity (including the A6T05 provider idempotency scope/key per ADR-0049), the A6T07 status verification, the A6 partner circuit-breaker, and the shared Operations `IdempotencyService` / `AuditService` / `OutboxService` / `MetricsService` (the only audit / idempotency / outbox / metrics authorities); no FX, no fees, no commissions, no savings interest, no lending, no customer credit beyond approved product limits, no automatic suspense clearing, no external financial correction outside Ledger/Finance ownership is introduced
- **Contract:** `A7ProductFinancialEffectContractV1` / `A7ProductFinancialEffectV1` / `A7ProductFinancialEffectRecordV1` / `A7ProductFinancialEffectHandoffV1` / `A7ProductFinancialEffectFailureV1` / `A7ProductFinancialEffectResultV1`
- **Identity namespaces:** `A7-PRODUCT-FINANCIAL-EFFECT` v1 (durable product financial effect identity), `a7.product-financial-effect.idempotency.v1` (A7 internal idempotency scope — separate from the A6T05 provider idempotency scope, the A7T05 internal idempotency scope, the A7T06 internal idempotency scope, the A7T07 internal idempotency scope, and the A6T08 settlement / suspense / compensating-entry idempotency scopes), `a7-product-financial-effect-handoff.v1` (A7 product financial effect handoff scope, 15-minute validity, correlation only — never raw credentials, signatures, private keys, or unrestricted customer data)
- **Upstream authorities consumed (not replaced):** A1 canonical ownership and identifier contracts, A2 protected-route and audience authorization, A3 internal account binding and customer-binding identity, A4 product-policy profile (A7T03), A5 `LedgerService` (the only financial value authority), A6 partner-adapter boundary, A6T05 `ExternalOperationService` (the A6T05 provider idempotency scope/key per ADR-0049), A6T05 `ExternalOperationLifecycleService` (the only A6 lifecycle authority), A6T07 `ExternalOperationStatusVerifier` (the only A6 status-verification authority), A6 `PartnerCircuitBreakerService` (the only A6 circuit-breaker authority), A6T08 `ExternalSettlementService` (the only settlement / suspense / compensating-entry authority — the A6T08 service posts the A5 Ledger journal on the A7 product financial effect service's behalf for verified outcomes and records a new A6T08 suspense entry for non-verified / unmatched / delayed / disputed / ambiguous outcomes, and the A6T08 service records the A6T08 compensating-entry suspense and the A5 `LedgerService` records the A5 reversal journal for the A7 product financial effect reversal), A7 product catalog (A7T02), A7 product-policy profile (A7T03), A7T04 `A7ProductCustomerBindingService` (the only A7T04 product customer-binding authority), A7T05 `A7ProductCommandService` (the only A7T05 product command/operation authority), A7T07 `A7ProductLifecycleService` (the only A7T07 product lifecycle authority), `ConfigService` (read-only; the A5 pilot emergency stop flag is the only pilot-disable boundary), Operations `IdempotencyService` / `AuditService` / `OutboxService` / `MetricsService` (shared primitives)

This document defines the A7 product financial effect envelope, the A6T08 settlement / suspense / compensating-entry dispatch contract, the A5 Ledger journal / reversal contract, the fail-closed A5 pilot-disable boundary, the audit / idempotency / outbox / metrics integration, the deterministic replay contract, and the handoff contract for the A7 first product (`VIRTUAL_ACCOUNT` v1). The A7 product financial effect contract is the runtime financial integration and control boundary for the A7 first product; the A7 product financial effect contract posts only verified product financial outcomes through the existing A5 Ledger boundary (the only financial value authority) and represents unmatched, delayed, disputed, or ambiguous product value through the existing A6T08 suspense / compensating-entry boundary (the only settlement / suspense / compensating-entry authority). The A7 product financial effect contract does not introduce a new Ledger chart, a new settlement authority, a new suspense authority, a new compensating-entry authority, a new financial-invariants engine, a new reconciliation engine, a new audit authority, a new idempotency authority, a new outbox authority, a new metrics authority, a new A6 lifecycle authority, a new A6 status-verification authority, a new A6 circuit-breaker authority, a new A6T05 external-operation authority, a new A6T08 settlement authority, a new A5 Ledger authority, a new customer-binding authority, a new customer-preference authority, a new product-policy authority, a new product command/operation authority, a new product lifecycle authority, a new product catalog authority, a new notification authority, a new diagnostics authority, or a new pilot authority. The A2 / A3 / A4 / A5 / A6 / A6T05 / A6T07 / A6T08 / A7T02 / A7T03 / A7T04 / A7T05 / A7T07 / Operations / `ConfigService` authorities are the only authorities.

## 1. Contract boundary

### 1.1 Purpose

The A7 product financial effect contract is the runtime financial integration and control boundary for the A7 first product. The A7 product financial effect service consumes the A2 authorization context (read-only), the A3 internal account binding (read-only recheck), the A4 product-policy decision (read-only), the A6T05 external-operation record and the A6T05 provider idempotency scope/key (read-only correlation per ADR-0049), the A6T05 lifecycle state (read-only), the A6T07 status verification (read-only), the A6 partner circuit-breaker (read-only), the A7T04 product customer-binding map (read-only), the A7T05 product command/operation identity (read-only), the A7T07 product lifecycle handoff (read-only), the A5 pilot emergency stop (read-only), and the A5 Ledger invariant (read-only). The A7 product financial effect service writes through the A6T08 settlement / suspense / compensating-entry boundary (the only settlement / suspense / compensating-entry authority) and the A5 Ledger service (the only financial value authority) and the shared Operations `IdempotencyService` / `AuditService` / `OutboxService` / `MetricsService` (the only audit / idempotency / outbox / metrics authorities). The A7 product financial effect service does not mutate any A2 / A3 / A4 / A5 / A6 / A7T02 / A7T03 / A7T04 / A7T05 / A7T07 / `CustomerPreference` / A6T10 source record and does not write any new customer intent, consent, preference, or product command/operation record.

```text
A2 authorization context (A2 principal, audience, scopes, customer access)
  + A3 internal account binding (A3 binding record id + version; A7T04 map)
  + A4 product-policy decision (A7T03; ALLOW / ALLOW_WITH_LIMITS)
  + A6T05 external-operation record (A6T05 externalOperationReference; partnerKey, capabilityKey, customerId, currency, accountingUnit, amount, provider idempotency scope/key per ADR-0049)
  + A6T05 lifecycle state (PENDING_VERIFICATION is the only A6T05 lifecycle state accepted for verified posting)
  + A6T07 status verification (VERIFIED_PENDING is the only verification state accepted for posting)
  + A6 partner circuit-breaker (CLOSED is the only state accepted for posting)
  + A7T04 product customer-binding map reference (A7T04 map reference; productKey, capabilityKey, action, productState match)
  + A7T05 product command/operation reference (A7T05 productCommandReference; productKey, capabilityKey, action, productState, customerId, customerWalletId, bindingId, bindingVersion, amount, currency, accountingUnit match)
  + A7T07 product lifecycle handoff (A7T07 productLifecycleReference; currentLifecycleState=PENDING_VERIFICATION, outcome=OUTCOME_VERIFIED)
  + A5 pilot emergency stop (A5_PILOT_EMERGENCY_STOP; read-only; fail-closed)
  + A5 Ledger invariant (A5 ledger invariant check; read-only)
  + A6T08 existing-settlement duplicate detection (read-only; only on the post path)
  -> A7ProductFinancialEffectService
       -> A6T08 settlement service (settleVerifiedOutcome for SETTLE)
            -> A5 Ledger service (postJournal; the A5 Ledger service is the only financial value authority; the A6T08 service posts the A5 Ledger journal on the A7 product financial effect service's behalf)
       -> A6T08 settlement service (recordSuspense for SUSPENSE)
            -> A5 Ledger (no journal posted for SUSPENSE; the A5 Ledger service is the only financial value authority and the A7 product financial effect service does not post a journal for SUSPENSE; the A7 product financial effect service records the A6T08 suspense entry on the A6T08 service)
       -> A5 Ledger service (reverseJournal for REVERSAL)
            -> A5 reversal journal (the A5 Ledger service creates a new compensating Ledger journal that reverses the original settlement journal)
       -> A6T08 settlement service (recordCompensatingEntry for REVERSAL)
            -> A6T08 compensating-entry suspense record (the A6T08 service creates a new A6T08 suspense entry for the compensating effect)
       -> A7ProductFinancialEffectRecordV1
            a7AuditContractName / a7AuditContractVersion
            a2 / a3 / a4 / a5 / a6 / a6T05 / a6T07 / a6T08 / a7T02 / a7T03 / a7T04 / a7T05 / a7T07 contract names + versions
            a7 product financial effect id
            a7 product financial effect reference
            a7 product key / version / capability / action / productState
            customerId / customerWalletId / bindingId / bindingVersion / walletAccountId / ledgerAccountId
            amountMinor / currency / accountingUnit
            a7 outcome (VERIFIED, REJECTED, SUSPENSE, UNKNOWN, MANUAL_REVIEW, FAILED)
            a7 category (SETTLEMENT, SUSPENSE, COMPENSATING, REVERSAL)
            a7 current state (PENDING, ADMITTED, SETTLEMENT_POSTED, SUSPENSE_RECORDED, COMPENSATING_POSTED, REVERSAL_POSTED, FAILED, CANCELLED)
            a6T08 decision (SETTLE, REVERSE, SUSPENSE)
            a6T08 settlement view / suspense view / compensating view
            a5 Ledger journal view (or null)
            a7 product lifecycle / command / customer-binding map references
            a6 external-operation reference / lifecycle state / provider idempotency scope + key
            a2 authorization context reference
            a4 product-policy decision reference
            a6T08 settlement / suspense / compensating reference
            a5 Ledger journal id (or null)
            recoveryReference / reversalReason / failureCode / failureMessage / providerStatus
            a7 internal idempotency scope + key
            a7 request hash
            request/correlation/causation
            replayed / conflict / conflictReason
            createdAt / updatedAt / version
       -> A7ProductFinancialEffectHandoffV1
            a7 product financial effect id
            a7 product financial effect reference
            a7 product key / capability / action / productState / currentState
            a7 outcome / category
            a7 product lifecycle / command / customer-binding map references
            a6 external-operation reference / lifecycle state / provider idempotency scope + key
            a2 authorization context reference
            a4 product-policy decision reference
            a6T08 settlement / suspense / compensating ids
            a5 Ledger journal id (or null)
            recoveryReference
            handoffScope / issuedAt / expiresAt (15 minutes)
            request/correlation/trace/causation
       -> Operations AuditService.record (audit fact: RESERVED, ADMITTED, SETTLEMENT_POSTED, SUSPENSE_RECORDED, COMPENSATING_POSTED, REVERSAL_POSTED, FAILED, CANCELLED, REPLAYED, DISABLED)
       -> Operations OutboxService.enqueue (outbox event: A7ProductFinancialEffectPosted; classification INTERNAL_OPERATIONS; retention OPERATIONS_DEFAULT; A7 product financial effect event key)
       -> Operations MetricsService.increment (a7.product-financial-effect.admitted / settlement-posted / suspense-recorded / compensating-posted / reversal-posted / failed / cancelled / replayed / disabled)
```

### 1.2 Authority and identity boundary

The A7 product financial effect contract is the runtime financial integration and control boundary for the A7 first product. The A7 product financial effect contract is a read-write consumer of the existing A2 / A3 / A4 / A5 / A6 / A6T05 / A6T07 / A6T08 / A7T04 / A7T05 / A7T07 / Operations / `ConfigService` authorities and a read-only consumer of the A7 product catalog (A7T02), the A7 product-policy profile (A7T03), the A6 partner circuit-breaker, the A6T05 lifecycle, and the A6T10 data-classification matrix. The A7 product financial effect contract is a read-write consumer of the A5 Ledger service (the only financial value authority) and the A6T08 settlement / suspense / compensating-entry service (the only settlement / suspense / compensating-entry authority). The A7 product financial effect contract does not introduce a new Ledger chart, a new settlement authority, a new suspense authority, a new compensating-entry authority, a new financial-invariants engine, a new reconciliation engine, a new audit authority, a new idempotency authority, a new outbox authority, a new metrics authority, a new diagnostics authority, a new A6 lifecycle authority, a new A6 status-verification authority, a new A6 circuit-breaker authority, a new A6T05 external-operation authority, a new A6T08 settlement authority, a new A5 Ledger authority, a new customer-binding authority, a new customer-preference authority, a new product-policy authority, a new product command/operation authority, a new product lifecycle authority, a new product catalog authority, a new notification authority, a new diagnostics authority, or a new pilot authority. The A2 / A3 / A4 / A5 / A6 / A6T05 / A6T07 / A6T08 / A7T02 / A7T03 / A7T04 / A7T05 / A7T07 / Operations / `ConfigService` authorities are the only authorities.

### 1.3 Envelope discipline

The A7 product financial effect envelope is the durable A7 product financial effect input. The envelope is versioned (`contractName: 'A7-PRODUCT-FINANCIAL-EFFECT'`, `contractVersion: 1`), schema-validated (UUIDs, SHA-256 references, ISO date strings, minor-units integers), and idempotency-keyed (the A7 internal idempotency scope `a7.product-financial-effect.v1` is separate from the A6T05 provider idempotency scope, the A7T05 internal idempotency scope, the A7T06 internal idempotency scope, the A7T07 internal idempotency scope, and the A6T08 settlement / suspense / compensating-entry idempotency scopes). The A7 product financial effect service does not trust a caller-supplied request hash; the A7 product financial effect service derives the canonical A7 product financial effect request hash from the envelope semantic material using a deterministic canonical-JSON encoding and SHA-256.

## 2. Identity and references

### 2.1 Identity namespaces

The A7 product financial effect contract uses the following identity namespaces:

- `A7-PRODUCT-FINANCIAL-EFFECT` v1 — durable A7 product financial effect identity (`productFinancialEffectId`, `productFinancialEffectReference`)
- `a7.product-financial-effect.idempotency.v1` — A7 internal idempotency scope (separate from the A6T05 provider idempotency scope, the A7T05 / A7T06 / A7T07 internal idempotency scopes, and the A6T08 settlement / suspense / compensating-entry idempotency scopes)
- `a7-product-financial-effect-handoff.v1` — A7 product financial effect handoff scope (15-minute validity, correlation only — never raw credentials, signatures, private keys, or unrestricted customer data)

### 2.2 Reference prefixes

The A7 product financial effect contract uses the following reference prefixes:

- `a7-product-financial-effect` — A7 product financial effect reference prefix
- `a7-product-financial-effect-settlement` — A7 product financial effect settlement reference prefix
- `a7-product-financial-effect-suspense` — A7 product financial effect suspense reference prefix
- `a7-product-financial-effect-compensating` — A7 product financial effect compensating reference prefix
- `a7-product-financial-effect-reversal` — A7 product financial effect reversal reference prefix
- `a7-product-financial-effect-recovery` — A7 product financial effect recovery reference prefix

### 2.3 Identity and reference computation

The A7 product financial effect identity is a UUIDv4 generated at posting time. The A7 product financial effect reference is a SHA-256 of the A7 product financial effect identity (with the contract prefix and contract version), allowing idempotent re-resolution. The A7 product financial effect settlement / suspense / compensating / reversal / recovery references are SHA-256s of the A7 product financial effect identity and a random UUID (for collision avoidance), formatted as `<prefix>:<hash>`.

## 3. Envelope

### 3.1 Envelope (A7ProductFinancialEffectV1)

```typescript
interface A7ProductFinancialEffectV1 {
  contractName: 'A7-PRODUCT-FINANCIAL-EFFECT';
  contractVersion: 1;

  productKey: 'VIRTUAL_ACCOUNT';
  productVersion: 1;
  capabilityKey: 'virtual-account.assign' | 'virtual-account.inbound-funding';
  action: 'assign' | 'lifecycle';
  productState:
    | 'ASSIGN_REQUESTED' | 'ASSIGN_PENDING' | 'ASSIGN_ACTIVE' | 'ASSIGN_SUSPENDED' | 'ASSIGN_FAILED' | 'ASSIGN_CLOSED'
    | 'FUNDING_REQUESTED' | 'FUNDING_PENDING_VERIFICATION' | 'FUNDING_SETTLED' | 'FUNDING_UNKNOWN' | 'FUNDING_SUSPENDED' | 'FUNDING_FAILED' | 'FUNDING_CLOSED';

  customerId: string; // UUID
  customerWalletId: string; // UUID
  bindingId: string; // UUID
  bindingVersion: number; // positive integer

  amountMinor: string | number | bigint; // positive minor-units integer
  currency: 'NGN';
  accountingUnit: 'CUSTOMER_FUNDS';

  outcome: 'OUTCOME_VERIFIED' | 'OUTCOME_REJECTED' | 'OUTCOME_SUSPENSE' | 'OUTCOME_UNKNOWN' | 'OUTCOME_MANUAL_REVIEW' | 'OUTCOME_FAILED';

  a7ProductLifecycleReference: string; // SHA-256
  a7ProductCommandReference: string; // safe text
  a7T04ProductCustomerBindingMapReference: string; // SHA-256
  a6ExternalOperationReference: string; // safe text
  a6LifecycleState: string; // CREATED | SUBMITTING | PENDING_PROVIDER | PENDING_VERIFICATION | UNKNOWN | MANUAL_REVIEW | FAILED | CANCELLED
  a6ProviderIdempotencyScope: string;
  a6ProviderIdempotencyKey: string;

  a2AuthorizationContextReference: string;
  a4ProductPolicyDecisionReference: string;

  a6T08SettlementReference: string | null;
  a6T08SuspenseReference: string | null;
  a6T08CompensatingReference: string | null;

  recoveryReference: string | null;
  reversalReason: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  providerStatus: string | null;

  idempotencyKey: string; // safe text
  requestHash: string; // SHA-256

  requestContext: RequestContext; // requestId, correlationId, traceId
  causationId: string | null;
}
```

### 3.2 Shape validation

The A7 product financial effect service validates the envelope shape before any authority correlation:

- `contractName === 'A7-PRODUCT-FINANCIAL-EFFECT'` (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED)
- `contractVersion === 1` (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED)
- `productKey === 'VIRTUAL_ACCOUNT'`, `productVersion === 1` (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED)
- `capabilityKey ∈ { 'virtual-account.assign', 'virtual-account.inbound-funding' }` (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED)
- `action ∈ { 'assign', 'lifecycle' }` (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED)
- `productState` is a valid A7T02 product state (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_STATE_INVALID)
- `customerId`, `customerWalletId`, `bindingId` are UUIDs (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_BINDING_MISSING)
- `bindingVersion` is a positive integer (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_STALE_BINDING)
- `currency === 'NGN'` (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_CURRENCY_MISMATCH)
- `accountingUnit === 'CUSTOMER_FUNDS'` (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_ACCOUNTING_UNIT_MISMATCH)
- `outcome` is a valid A7 product financial effect outcome (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_NOT_VERIFIED)
- `a6LifecycleState` is a valid A6T05 lifecycle state (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_MISSING)
- All references match their reference patterns (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_*)
- `amountMinor` parses as a positive minor-units integer (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_AMOUNT_MISMATCH)
- `idempotencyKey` matches the safe-text pattern
- `requestHash` is a SHA-256

The A7 product financial effect service normalizes the envelope by lowercasing UUIDs, parsing `amountMinor` to a canonical string, and lowercasing `requestHash` before computing the canonical request hash.

## 4. State and outcome vocabulary

### 4.1 A7 product financial effect state vocabulary

The A7 product financial effect state vocabulary is a product-financial-effect vocabulary that extends, but does NOT replace, the A6T05 external-operation lifecycle vocabulary, the A6T08 settlement / suspense / compensating vocabulary, or the A5 Ledger journal / line vocabulary. The A7 product financial effect states are a product-side correlation vocabulary that the A7 product financial effect service records alongside the A6T05 lifecycle states, the A6T08 settlement states, and the A5 Ledger journal states inside the A7 product financial effect audit and outbox payloads.

- `FINANCIAL_EFFECT_PENDING`
- `FINANCIAL_EFFECT_ADMITTED`
- `FINANCIAL_EFFECT_SETTLEMENT_POSTED`
- `FINANCIAL_EFFECT_SUSPENSE_RECORDED`
- `FINANCIAL_EFFECT_COMPENSATING_POSTED`
- `FINANCIAL_EFFECT_REVERSAL_POSTED`
- `FINANCIAL_EFFECT_FAILED` (terminal)
- `FINANCIAL_EFFECT_CANCELLED` (terminal)

### 4.2 A7 product financial effect outcome vocabulary

- `OUTCOME_VERIFIED`
- `OUTCOME_REJECTED`
- `OUTCOME_SUSPENSE`
- `OUTCOME_UNKNOWN`
- `OUTCOME_MANUAL_REVIEW`
- `OUTCOME_FAILED`

### 4.3 A7 product financial effect category vocabulary

- `CATEGORY_SETTLEMENT`
- `CATEGORY_SUSPENSE`
- `CATEGORY_COMPENSATING`
- `CATEGORY_REVERSAL`

### 4.4 A6T08 decision mapping

- `OUTCOME_VERIFIED` → `SETTLE`
- `OUTCOME_REJECTED` → `REVERSE`
- `OUTCOME_SUSPENSE`, `OUTCOME_UNKNOWN`, `OUTCOME_MANUAL_REVIEW`, `OUTCOME_FAILED` → `SUSPENSE`

### 4.5 A6T08 suspense reason mapping

- `OUTCOME_REJECTED` → `PROVIDER_REJECTION`
- `OUTCOME_SUSPENSE` → `PROVIDER_SUSPENSE`
- `OUTCOME_UNKNOWN` → `PROVIDER_UNKNOWN`
- `OUTCOME_MANUAL_REVIEW` → `MANUAL_REVIEW`
- `OUTCOME_FAILED` → `PROVIDER_FAILURE`

### 4.6 Journal balance invariant

The A7 product financial effect journal is a double-entry journal: the sum of debits must equal the sum of credits in minor units for every A7 product financial effect journal. The invariant name is `A7_PRODUCT_FINANCIAL_EFFECT_BALANCED`. The A7 product financial effect service consumes the A5 Ledger invariant check through the A5 `LedgerService` consumer boundary; the A7 product financial effect service does NOT introduce a parallel financial-invariants engine.

## 5. Ledger journal contract

### 5.1 Posting

The A7 product financial effect service does NOT post A5 Ledger journals directly. The A7 product financial effect service submits the verified product financial outcome to the A6T08 settlement service, and the A6T08 settlement service posts the A5 Ledger journal on the A7 product financial effect service's behalf (for the SETTLE decision). The A5 Ledger service is the only financial value authority. The A7 product financial effect journal is a double-entry journal: the sum of debits must equal the sum of credits in minor units. The A7 product financial effect service asserts the balance invariant before dispatching to the A6T08 settlement service. The A7 product financial effect service does not introduce a parallel Ledger chart, a parallel financial-invariants engine, or a parallel financial value authority.

### 5.2 Reversal

The A7 product financial effect reversal creates a new compensating Ledger journal (via the A5 `LedgerService.reverseJournal()` consumer boundary) and a new A6T08 compensating-entry suspense record (via the A6T08 `ExternalSettlementService.recordCompensatingEntry()` consumer boundary). The A5 Ledger service creates the new compensating Ledger journal; the A6T08 settlement service creates the new compensating-entry suspense record. The A7 product financial effect service does NOT mutate the original A5 Ledger settlement journal; the A5 Ledger service creates a new compensating Ledger journal that reverses the original settlement journal. The A7 product financial effect service does NOT mutate the original A6T08 settlement record; the A6T08 settlement service creates a new compensating-entry suspense record for the compensating effect.

## 6. Idempotency

### 6.1 Internal idempotency

The A7 product financial effect service uses the A7 internal idempotency scope `a7.product-financial-effect.idempotency.v1` (separate from the A6T05 provider idempotency scope, the A7T05 / A7T06 / A7T07 internal idempotency scopes, and the A6T08 settlement / suspense / compensating-entry idempotency scopes). The A7 product financial effect service reserves the A7 internal idempotency scope/key via the shared Operations `IdempotencyService.reserve()` consumer boundary (reused as-is, without modification). The A7 product financial effect service fails closed on `IN_PROGRESS` reservation (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_IDEMPOTENCY_IN_PROGRESS) and on hash conflict (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_REQUEST_HASH_CONFLICT). The A7 product financial effect service retains the A7 internal idempotency record for 24 hours (`A7_PRODUCT_FINANCIAL_EFFECT_IDEMPOTENCY_RETENTION_SECONDS`).

### 6.2 Provider idempotency

The A7 product financial effect contract does NOT generate or maintain a separate A7 provider idempotency scope. The A7 product financial effect service reads the A6T05 provider idempotency scope/key from the A6T05 `ExternalOperation` record and references it inside the A7 product financial effect outbox payload as correlation metadata per ADR-0049. The A6T05 `ExternalOperationService` is the only A6T05 external-operation authority.

### 6.3 Replay

The A7 product financial effect service supports deterministic replay via the A7 internal idempotency scope/key. The A7 product financial effect service returns the durable original A7 product financial effect record (with `replayed: true`) when the same A7 internal idempotency scope/key is reserved with the same canonical request hash. The A7 product financial effect service records the A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REPLAYED audit fact and increments the A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REPLAYED metric on every replay. The A7 product financial effect service fails closed on `IN_PROGRESS` reservation and on hash conflict.

## 7. Authority correlation

### 7.1 Authority correlation order

The A7 product financial effect service correlates the upstream authorities in the following order:

1. **A5 pilot emergency stop** (A5_PILOT_EMERGENCY_STOP) — read-only; fail-closed
2. **A2 authorization context** (read-only correlation)
3. **A3 internal account binding** (read-only recheck via `CustomerFinancialAccountBindingService.validateActiveBinding()`)
4. **A4 product-policy decision** (read-only correlation via the A7T03 A4 product-policy service)
5. **A6T05 external-operation record** (read-only correlation via the A6T05 `ExternalOperationService`; partnerKey, capabilityKey, customerId, currency, accountingUnit, amount match; A6T05 provider idempotency scope/key match per ADR-0049)
6. **A6T05 lifecycle state** (read-only correlation; `PENDING_VERIFICATION` is the only accepted state for verified posting)
7. **A6T07 status verification** (read-only correlation via the A6T07 `ExternalOperationStatusVerifier`; `VERIFIED_PENDING` is the only accepted verification state)
8. **A6 partner circuit-breaker** (read-only correlation via the A6 `PartnerCircuitBreakerService`; `CLOSED` is the only accepted state)
9. **A7T04 product customer-binding map** (read-only correlation via the A7T04 `A7ProductCustomerBindingService`)
10. **A7T05 product command/operation identity** (read-only correlation via the A7T05 `A7ProductCommandService`)
11. **A7T07 product lifecycle handoff** (read-only correlation via the A7T07 `A7ProductLifecycleService`; `currentLifecycleState=PENDING_VERIFICATION`, `outcome=OUTCOME_VERIFIED`)
12. **A5 Ledger invariant** (read-only correlation via the A5 `LedgerService`; the A5 Ledger service is the only financial value authority)
13. **A6T08 settlement duplicate detection** (read-only; only on the post path; the reversal path expects an existing settlement)
14. **Outcome → A6T08 decision mapping** (deterministic; `OUTCOME_VERIFIED` → `SETTLE`, `OUTCOME_REJECTED` → `REVERSE`, all others → `SUSPENSE`)
15. **Verified outcome required for SETTLE** (`OUTCOME_VERIFIED` is the only outcome that maps to `SETTLE`)

### 7.2 Authority correlation contract

The A7 product financial effect service does NOT mutate any upstream authority. The A7 product financial effect service records the A7 product financial effect audit fact (A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_RESERVED on admission, A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SETTLEMENT_POSTED / A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SUSPENSE_RECORDED / A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REVERSAL_POSTED / A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_COMPENSATING_POSTED / A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_FAILED / A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_CANCELLED / A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REPLAYED / A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_DISABLED on the corresponding transitions) for every authority correlation outcome.

## 8. Settlement, suspense, compensating-entry, and reversal dispatch

### 8.1 SETTLE decision (OUTCOME_VERIFIED)

The A7 product financial effect service submits the verified product financial outcome to the A6T08 settlement service via the A6T08 `ExternalSettlementService.settleVerifiedOutcome()` consumer boundary (reused as-is, without modification). The A6T08 settlement service is the only settlement authority; the A6T08 settlement service posts the A5 Ledger journal on the A7 product financial effect service's behalf for verified outcomes. The A5 Ledger service is the only financial value authority. The A7 product financial effect service records the A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SETTLEMENT_POSTED audit fact, publishes the A7 product financial effect outbox fact, and increments the A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SETTLEMENT_POSTED metric on success.

### 8.2 SUSPENSE decision (OUTCOME_SUSPENSE / OUTCOME_UNKNOWN / OUTCOME_MANUAL_REVIEW / OUTCOME_FAILED)

The A7 product financial effect service records a new A6T08 suspense entry via the A6T08 `ExternalSettlementService.recordSuspense()` consumer boundary (reused as-is, without modification). The A6T08 settlement service is the only suspense authority. The A7 product financial effect service does NOT post an A5 Ledger journal for SUSPENSE (the A5 Ledger service is the only financial value authority and the A7 product financial effect service does not post a journal for SUSPENSE; the A7 product financial effect service records the A6T08 suspense entry on the A6T08 service). The A7 product financial effect service records the A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SUSPENSE_RECORDED audit fact, publishes the A7 product financial effect outbox fact, and increments the A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SUSPENSE_RECORDED metric on success.

### 8.3 REVERSAL (OUTCOME_REJECTED) — via postProductFinancialEffectReversal

The A7 product financial effect reversal creates a new compensating Ledger journal (via the A5 `LedgerService.reverseJournal()` consumer boundary) and a new A6T08 compensating-entry suspense record (via the A6T08 `ExternalSettlementService.recordCompensatingEntry()` consumer boundary). The A5 Ledger service creates the new compensating Ledger journal; the A6T08 settlement service creates the new compensating-entry suspense record. The A7 product financial effect service does NOT mutate the original A5 Ledger settlement journal; the A5 Ledger service creates a new compensating Ledger journal that reverses the original settlement journal. The A7 product financial effect service does NOT mutate the original A6T08 settlement record; the A6T08 settlement service creates a new compensating-entry suspense record for the compensating effect. The A7 product financial effect service records the A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REVERSAL_POSTED and A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_COMPENSATING_POSTED audit facts, publishes the A7 product financial effect outbox fact, and increments the A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REVERSAL_POSTED and A7_PRODUCT_FINANCIAL_EFFECT_METRIC_COMPENSATING_POSTED metrics on success. The A7 product financial effect reversal requires an `reversalReason` (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_RECOVERY_REFERENCE_MISSING) and rejects the reversal when the existing A6T08 settlement is missing, the existing A6T08 suspense is missing, or the existing A6T08 settlement has already been reversed (A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DUPLICATE_SETTLEMENT).

### 8.4 Settle / suspense / compensating rejection detection

The A7 product financial effect service detects A6T08 settlement / suspense / compensating rejection via the `code` field of the A6T08 `ConflictException`. The A7 product financial effect service classifies the rejection based on the code prefix:

- `A6T08_SETTLEMENT_REJECTED` or any code containing `SETTLEMENT`, `CURRENCY_MISMATCH`, `AMOUNT_MISMATCH`, `LOCK`, or `INVARIANT` (excluding `SUSPENSE` and `COMPENSATING`) → A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SETTLEMENT_REJECTED
- `A6T08_SUSPENSE_REJECTED` or any code containing `SUSPENSE` → A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SUSPENSE_REJECTED
- `A6T08_COMPENSATING_REJECTED` or any code containing `COMPENSATING` → A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_COMPENSATING_REJECTED

## 9. Audit, idempotency, outbox, and metrics

### 9.1 Audit

The A7 product financial effect service records the A7 product financial effect audit fact through the shared Operations `AuditService.record()` consumer boundary (reused as-is, without modification). The A7 product financial effect audit entity type is `A7_PRODUCT_FINANCIAL_EFFECT`. The A7 product financial effect audit actor is `a7-product-financial-effect`. The A7 product financial effect audit action codes are `A7_PRODUCT_FINANCIAL_EFFECT_RESERVED`, `A7_PRODUCT_FINANCIAL_EFFECT_ADMITTED`, `A7_PRODUCT_FINANCIAL_EFFECT_SETTLEMENT_POSTED`, `A7_PRODUCT_FINANCIAL_EFFECT_SUSPENSE_RECORDED`, `A7_PRODUCT_FINANCIAL_EFFECT_COMPENSATING_POSTED`, `A7_PRODUCT_FINANCIAL_EFFECT_REVERSAL_POSTED`, `A7_PRODUCT_FINANCIAL_EFFECT_FAILED`, `A7_PRODUCT_FINANCIAL_EFFECT_CANCELLED`, `A7_PRODUCT_FINANCIAL_EFFECT_REPLAYED`, and `A7_PRODUCT_FINANCIAL_EFFECT_DISABLED`. The A7 product financial effect service is the only A7 product financial effect audit authority.

### 9.2 Idempotency

The A7 product financial effect service uses the shared Operations `IdempotencyService.reserve()` / `complete()` / `fail()` consumer boundaries (reused as-is, without modification). The A7 product financial effect service uses the A7 internal idempotency scope `a7.product-financial-effect.idempotency.v1` (separate from the A6T05 provider idempotency scope, the A7T05 / A7T06 / A7T07 internal idempotency scopes, and the A6T08 settlement / suspense / compensating-entry idempotency scopes). The A7 product financial effect service retains the A7 internal idempotency record for 24 hours.

### 9.3 Outbox

The A7 product financial effect service publishes the A7 product financial effect outbox fact through the shared Operations `OutboxService.enqueue()` consumer boundary (reused as-is, without modification). The A7 product financial effect outbox event type is `A7ProductFinancialEffectPosted`. The A7 product financial effect outbox event classification is `INTERNAL_OPERATIONS`. The A7 product financial effect outbox event retention class is `OPERATIONS_DEFAULT`. The A7 product financial effect service is the only A7 product financial effect outbox authority.

### 9.4 Metrics

The A7 product financial effect service increments the A7 product financial effect metric observations through the shared Operations `MetricsService.increment()` consumer boundary (reused as-is, without modification). The A7 product financial effect metric names are `a7.product-financial-effect.admitted`, `a7.product-financial-effect.settlement-posted`, `a7.product-financial-effect.suspense-recorded`, `a7.product-financial-effect.compensating-posted`, `a7.product-financial-effect.reversal-posted`, `a7.product-financial-effect.failed`, `a7.product-financial-effect.cancelled`, `a7.product-financial-effect.replayed`, and `a7.product-financial-effect.disabled`. The A7 product financial effect service is the only A7 product financial effect metrics authority.

## 10. Handoff

The A7 product financial effect handoff is a single-use, support-traceable, A2-protected internal control surface. The A7 product financial effect handoff scope is `a7-product-financial-effect-handoff.v1` with 15-minute validity. The A7 product financial effect handoff carries only the safe cross-domain references (`a6T08SettlementId`, `a6T08SuspenseId`, `a6T08CompensatingId`, `a5LedgerJournalId`) and never raw credentials, signatures, private keys, or unrestricted customer data. The A7 product financial effect handoff is not a Ledger record, not an A2 authorization, not an A3 binding repair, not an A4 product-policy decision, not a settlement record, and not a duplicate A6T05 lifecycle record. The A7 product financial effect handoff is for correlation only; the A7 product financial effect service does not perform any financial action on the basis of the handoff alone. The A7 product financial effect handoff is consumed by A7T09 (independent product reconciliation) and A7T11 (release gate) for cross-product reconciliation and release-gate correlation. The A7T09 and A7T11 services are out of scope for A7T08 and will be implemented in their respective tasks.

## 11. Fail-closed pilot-disable boundary

The A7 product financial effect service reads the A5 pilot emergency stop flag from the `ConfigService` (read-only; the A5 pilot emergency stop is the only pilot-disable boundary; the A7 product financial effect service does NOT introduce a parallel pilot authority). When the A5 pilot emergency stop is active, the A7 product financial effect service fails closed with `A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DISABLED` and the A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_DISABLED audit action. The A5 pilot emergency stop is the single pilot-disable boundary for the entire A5 Ledger service; no parallel pilot authority is introduced by the A7 product financial effect contract.

## 12. Failure codes

The A7 product financial effect contract defines the following failure codes:

- `A7_PRODUCT_FINANCIAL_EFFECT_A2_AUTHORIZATION_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_A2_AUTHORIZATION_STALE`
- `A7_PRODUCT_FINANCIAL_EFFECT_A2_AUTHORIZATION_DENIED`
- `A7_PRODUCT_FINANCIAL_EFFECT_A3_BINDING_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_A3_BINDING_NOT_ACTIVE`
- `A7_PRODUCT_FINANCIAL_EFFECT_A3_STALE_BINDING`
- `A7_PRODUCT_FINANCIAL_EFFECT_A4_POLICY_DECISION_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_A4_POLICY_DECISION_EXPIRED`
- `A7_PRODUCT_FINANCIAL_EFFECT_A4_POLICY_DECISION_NOT_EXECUTABLE`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_EXTERNAL_OPERATION_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_EXTERNAL_OPERATION_NOT_FOUND`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_LIFECYCLE_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_LIFECYCLE_TERMINAL`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_LIFECYCLE_STALE`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_LIFECYCLE_NOT_VERIFIED`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_STATUS_VERIFICATION_UNAVAILABLE`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_CIRCUIT_OPEN`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6_RETRY_EXHAUSTED`
- `A7_PRODUCT_FINANCIAL_EFFECT_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED`
- `A7_PRODUCT_FINANCIAL_EFFECT_A7T05_PRODUCT_COMMAND_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_A7T05_PRODUCT_COMMAND_NOT_FOUND`
- `A7_PRODUCT_FINANCIAL_EFFECT_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH`
- `A7_PRODUCT_FINANCIAL_EFFECT_A7T07_PRODUCT_LIFECYCLE_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_A7T07_PRODUCT_LIFECYCLE_NOT_VERIFIED`
- `A7_PRODUCT_FINANCIAL_EFFECT_A7T07_PRODUCT_LIFECYCLE_MISMATCH`
- `A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_INVARIANT_VIOLATION`
- `A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_DISABLED`
- `A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_AMOUNT_MISMATCH`
- `A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_CURRENCY_MISMATCH`
- `A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_ACCOUNTING_UNIT_MISMATCH`
- `A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_DUPLICATE_SETTLEMENT`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6T08_SETTLEMENT_REJECTED`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6T08_SUSPENSE_REJECTED`
- `A7_PRODUCT_FINANCIAL_EFFECT_A6T08_COMPENSATING_REJECTED`
- `A7_PRODUCT_FINANCIAL_EFFECT_RECOVERY_REFERENCE_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_RECOVERY_REFERENCE_MISMATCH`
- `A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_MAPPING_MISSING`
- `A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_NOT_VERIFIED`
- `A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_FAILED`
- `A7_PRODUCT_FINANCIAL_EFFECT_PRODUCT_CATALOG_REJECTED`
- `A7_PRODUCT_FINANCIAL_EFFECT_PRODUCT_STATE_INVALID`
- `A7_PRODUCT_FINANCIAL_EFFECT_REQUEST_HASH_CONFLICT`
- `A7_PRODUCT_FINANCIAL_EFFECT_IDEMPOTENCY_IN_PROGRESS`
- `A7_PRODUCT_FINANCIAL_EFFECT_OPERATIONS_EVIDENCE_UNAVAILABLE`
- `A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_PUBLICATION_FAILED`

## 13. Out of scope

The A7 product financial effect contract is intentionally narrow and does not introduce:

- A new Ledger chart
- A new settlement authority
- A new suspense authority
- A new compensating-entry authority
- A new financial-invariants engine
- A new reconciliation engine
- A new audit authority
- A new idempotency authority
- A new outbox authority
- A new metrics authority
- A new diagnostics authority
- A new A6 lifecycle authority
- A new A6 status-verification authority
- A new A6 circuit-breaker authority
- A new A6T05 external-operation authority
- A new A6T05 provider idempotency scope (the A7 product financial effect service reuses the A6T05 provider idempotency scope/key per ADR-0049)
- A new A6T08 settlement authority
- A new A5 Ledger authority
- A new customer-binding authority
- A new customer-preference authority
- A new product-policy authority
- A new product command/operation authority
- A new product lifecycle authority
- A new product catalog authority
- A new notification authority
- A new diagnostics authority
- A new pilot authority
- Automatic suspense clearing
- External financial correction outside Ledger/Finance ownership
- FX, fees, commissions, savings interest, lending, or customer credit beyond approved product limits
- A7T09 (independent product reconciliation) — out of scope; will be implemented in its own task
- A7T11 (release gate) — out of scope; will be implemented in its own task

## 14. ADR alignment

The A7 product financial effect contract aligns with:

- **ADR-0002** (Ledger as the only financial value authority) — the A7 product financial effect contract posts only through the existing A5 Ledger boundary.
- **ADR-0004** (deterministic replay) — the A7 product financial effect contract supports deterministic replay via the A7 internal idempotency scope/key.
- **ADR-0005** (audit, idempotency, outbox, metrics primitives) — the A7 product financial effect contract reuses the existing Operations primitives.
- **ADR-0008** (no parallel customer-binding) — the A7 product financial effect contract reuses the A3 internal account binding and the A7T04 product customer-binding map.
- **ADR-0043** (A6T08 settlement / suspense / compensating-entry) — the A7 product financial effect contract dispatches to the existing A6T08 settlement / suspense / compensating-entry boundary.
- **ADR-0044** (no parallel financial-invariants engine) — the A7 product financial effect contract consumes the A5 Ledger invariant check through the A5 Ledger service consumer boundary.
- **ADR-0050** (provider idempotency scope/key sourcing) — the A7 product financial effect contract sources the A6T05 provider idempotency scope/key from the A6T05 `ExternalOperation` record per ADR-0049.
