# ADR-0051: External Funding-Instrument Use

- **Status:** Proposed A6 implementation decision; verified target boundary implemented, provider use and settlement not implemented
- **Date:** 2026-08-08
- **Scope:** Customer-owned funding-instrument and bank-beneficiary verification, consent assertion, internal A3 account mapping, supported currency/type checks, deterministic target mapping, and Operations audit
- **Task:** A6T04 — External Funding-Instrument Use and Internal Account Mapping
- **Selected capability:** NGN `external.wallet.withdrawal.settlement` through the A6 `NIBSS_NIP` planning boundary
- **Implementation status:** A6T04 consumer boundary, source-owner reads, fail-closed checks, deterministic mapping handle, and audit integration added; no provider communication, callback, settlement, financial execution, persistence, or route added

## Context

A6T01 selected one bounded external flow:

```text
internal customer-funds wallet -> verified customer-owned Nigerian bank target
NGN outbound settlement through the selected NIBSS/NIP adapter boundary
```

A6T02 defined the provider-neutral adapter request/result contract and A6T03 established the disabled-by-default, environment-aware partner connection boundary. The repository already contains customer-owned funding-instrument and beneficiary metadata, A3 customer-to-financial-account binding, A2 authorization, A4 policy decisions, bank-directory metadata, and Operations audit. None of those existing records alone is sufficient to authorize or execute an external operation.

The A6 boundary must answer, before a later adapter call:

- Is the initiating principal authorized by A2 for this customer and target-use action?
- Is the A4 external capability decision current, same-subject, same-action, currency-compatible, and within any declared amount limit?
- Is the internal source account explicitly bound and active under A3?
- Is exactly one approved external target source selected?
- Does the authoritative source record belong to the canonical customer, use a permitted account type, remain current, and have the required verification/status state?
- Is an explicit, purpose-bound consent assertion present and current?
- Is the bank active and marked as supporting the selected NIP planning capability?
- Can the mapping be represented by a deterministic, non-secret handle without treating the provider or target reference as financial truth?

## Decision

### 1. A6-owned read/validation boundary

`ExternalFundingTargetMappingService` is the A6 consumer boundary for verified external-target use. It coordinates read-only source-owner contracts and returns a provider-neutral mapping result:

```text
A2 authorization
  -> A4 policy assertion validation
  -> A3 internal account-binding validation
  -> authoritative funding-instrument or beneficiary read
  -> authoritative active/NIP-supported bank-directory read
  -> consent assertion validation
  -> deterministic external-target mapping result
  -> optional Operations audit through the caller's transaction manager
```

The service does not create a new funding-instrument, beneficiary, bank, account, consent, operation, settlement, or balance authority. It does not persist a mapping row. It produces a deterministic mapping reference and a safe adapter target reference for a later A6 operation boundary.

### 2. Source authority and read ownership

A6 reads through existing owner services:

- `AuthorizationService` owns the A2 access decision and records its authorization audit evidence.
- `CustomerFinancialAccountBindingService.validateActiveBinding()` owns the A3 read-only internal customer/account validation.
- `CustomerBeneficiaryService.getBeneficiary(customerId, beneficiaryId)` owns customer-beneficiary identity, ownership, status, verification, and version read behavior.
- `CustomerFundingInstrumentService.getInstrument(customerId, instrumentId)` owns funding-instrument identity, ownership, status, verification state, and version read behavior.
- `BankService.list(undefined, BankStatus.ACTIVE)` owns active bank-directory metadata; A6 filters the authoritative result for the requested bank code and `nipSupported` flag.
- `PartnerConnectionService.getProfile()` owns the selected A6 partner/capability/environment configuration.
- `AuditService` remains the Operations audit authority for the safe mapping decision/rejection fact.

A6 does not query or write these tables directly, does not repair source records, and does not infer ownership from a display name, alias, payment reference, bank account string, provider reference, or policy result.

### 3. Permitted target sources and account types

The selected A6 boundary accepts exactly one target source per mapping request:

```text
CUSTOMER_BENEFICIARY
  source record type: BANK_ACCOUNT
  source status: ACTIVE
  source verified: true

FUNDING_INSTRUMENT
  source record type: BANK_ACCOUNT
  source status: VERIFIED
  source verificationState: VERIFIED
```

The following are rejected by the A6T04 boundary:

- both a beneficiary and funding-instrument source in one command;
- neither source;
- mobile-money, cash-agent, internal-settlement, internal-customer, or any unregistered target type;
- deleted, suspended, pending, inactive, rejected, unverified, or stale source records;
- a target source belonging to another customer; and
- an unsupported, inactive, or non-NIP-supported bank directory record.

A second target source representing the same external destination is not merged implicitly. The caller must supply one authoritative source and its expected version. Cross-source consolidation, if required, needs a separate reviewed mapping decision.

### 4. Internal account mapping

The mapping requires the complete A3 internal source tuple:

```text
Customer.id
  -> CustomerWallet.id
  -> CustomerFinancialAccountBinding.id + expected version
  -> WalletAccount.id
  -> LedgerAccount.id
```

A3 validates customer status, CustomerWallet ownership/status/currency/version, wallet ownership, WalletAccount status/currency/Ledger relationship, LedgerAccount status/type/normal balance/currency/accounting unit, and the explicit binding version. A6 accepts only an active `CUSTOMER_FUNDS` binding for the selected `NGN` operation.

A6 does not select an internal account. It carries the explicit tuple returned/asserted by the command and A3. A bank account, beneficiary, funding-instrument reference, bank code, or provider value cannot replace any internal ID.

### 5. Consent assertion

Because the current repository has no A6 consent/mandate entity or provider consent store, A6T04 accepts a versioned consent assertion at the boundary and validates it without persisting it:

```text
ExternalFundingTargetConsentAssertion {
  reference
  customerId
  targetSource
  targetId
  purpose: OUTBOUND_BANK_SETTLEMENT
  grantedBy
  grantedAt
  expiresAt
  version
}
```

The assertion is valid only when:

- its customer and target source/id equal the canonical mapping request;
- its purpose is exactly `OUTBOUND_BANK_SETTLEMENT`;
- its reference is bounded and safe;
- its version is positive;
- `grantedAt` is not in the future;
- `expiresAt` is after `grantedAt` and later than the current time; and
- A2 authorization independently permits the principal to use the target for the requested customer operation.

The assertion is not A2 authorization, A4 policy, source ownership, provider authentication, or financial execution approval. A6T10 remains responsible for the final data-sharing, consent/mandate, retention, legal-hold, and disclosure contract.

### 6. A4 policy handoff

A6T04 consumes, but does not evaluate or persist, an A4 policy assertion:

```text
capability: external.wallet.withdrawal.settlement
action: create
subject: canonical Customer.id
decision: ALLOW | ALLOW_WITH_LIMITS
policyVersion + decisionReference
currency: NGN
expiresAt
reviewAt?
maxAmountMinor? when ALLOW_WITH_LIMITS
```

The boundary rejects a missing, mismatched, expired, review-due, non-allow, currency-incompatible, or insufficient-limit assertion. It does not create an external A4 profile, duplicate policy precedence, or mutate A4/source records.

### 7. Deterministic mapping result

The result contains:

- mapping version and deterministic mapping reference;
- selected partner/capability/operation keys;
- canonical customer ID;
- complete explicit internal A3 account tuple;
- target source type, source ID, source version, bank code, target type, consent reference/version;
- SHA-256 target-reference hash and an opaque `a6-target:<mappingReference>` handoff reference;
- normalized amount/currency/accounting unit;
- policy decision/version/expiry;
- A2 principal type/ID/evaluation time; and
- request/correlation/trace context.

The result does not contain raw target identifiers, raw funding credentials, provider transaction IDs, provider idempotency keys, bank account passwords, signatures, balances, journals, settlement outcomes, or callback data.

The mapping reference is derived from the normalized customer, target source/type/version, bank code, source-reference hash, currency, accounting unit, policy identity, and consent identity. It is a correlation handle, not a financial identity or provider reference.

### 8. Operations audit

A6T04 provides `resolveAndAudit(manager, command)`. On a successful mapping it records an `A6_EXTERNAL_TARGET_MAPPING/MAPPED` event through the shared `AuditService`. On a rejection it records a safe `REJECTED` event when the customer UUID is valid and preserves the original failure; if audit cannot be recorded, it fails closed with `OPERATIONS_EVIDENCE_UNAVAILABLE`.

Audit values are limited to safe IDs, hashes, versions, partner/capability keys, currency/accounting unit, policy references, consent reference/version, status, and deterministic failure codes. Raw funding-instrument references, destination identifiers, credentials, provider payloads, and secrets are excluded.

The mapping service does not create a local audit or mapping store. It uses the Operations authority and the caller-provided transaction manager.

## Alternatives considered

### Let the adapter choose a bank account from a customer or currency

Rejected. A3 owns internal account identity, while the target source owner and bank directory own external-target metadata. A6 must receive explicit assertions and validate them.

### Accept a funding instrument or beneficiary by ID without ownership/read validation

Rejected. A caller-supplied ID does not prove canonical customer ownership, current status, verification, or version. A6 reads through the source owner with the customer ID scope.

### Accept all funding-instrument and beneficiary types

Rejected. The selected A6 capability is an NGN bank-account settlement flow. Mobile-money, cash-agent, internal-settlement, internal-customer, and other types require separate capabilities.

### Treat `CustomerFundingInstrument.reference` or beneficiary destination as a provider credential

Rejected. Existing references are metadata values. A6 returns a deterministic opaque mapping handle and leaves provider-safe target translation to the later approved adapter/data boundary.

### Create an A6 mapping table in this task

Rejected. A6T04 defines a read/validation boundary and deterministic mapping handle. Durable external-operation identity, provider references, idempotency, and mapping persistence belong to A6T05 and later approved schema work.

### Treat consent as authorization or policy

Rejected. Consent/mandate, A2 authorization, and A4 policy answer different questions and retain separate owners and identifiers.

### Automatically merge beneficiary and funding-instrument records

Rejected. The repository has separate source owners and overlapping target concepts. A6 requires exactly one source per command and defers cross-source consolidation to a separate decision.

## Consequences

### Positive

- External-target use is fail-closed and tied to canonical customer ownership.
- Internal account identity remains A3/Ledger-owned and explicit.
- Only verified, active, current, supported bank-account targets can produce a mapping result.
- Consent, policy, authorization, target ownership, and account binding remain separate evidence types.
- The adapter receives a deterministic opaque target handle rather than an unclassified source value.
- Operations audit can trace mapping decisions without storing raw financial or credential data.
- No provider communication or financial effect is possible from this boundary alone.

### Future review items

- A6T05 must decide the durable external-operation/mapping identity, provider reference uniqueness, and provider idempotency scope.
- A6T10 must establish the authoritative consent/mandate, data-sharing, retention, legal-hold, and disclosure boundary.
- A6T03 must decide how the opaque target handle is resolved to provider-safe transport data without exposing raw credentials.
- Finance/Ledger and A6T08 must define how a verified external result maps to settlement/suspense entries.
- A6T09 must reconcile target, provider, operation, settlement, and Ledger evidence independently.

## Explicitly out of scope

This ADR and A6T04 do not:

- call NIBSS, banks, or any provider;
- create provider adapters, HTTP clients, SDK integrations, callbacks, status queries, statements, schedulers, or routes;
- create entities, migrations, external-operation records, consent records, mapping tables, settlement records, or suspense records;
- post a journal, mutate a balance, create financial value, settle funds, clear suspense, or reverse history;
- modify Customer, CustomerWallet, funding-instrument, beneficiary, bank, A3 binding, A4 policy/source, Wallet, Ledger, Transfer, Withdrawal, Deposit, Operations, Outbox, or Reconciliation source records;
- implement provider idempotency, callback replay, settlement, external reconciliation, notifications, or customer-facing exposure; or
- implement A6T05 or any later A6/A7/A8 task.

## Implementation evidence

- `src/partner/external-funding-target.types.ts`
- `src/partner/external-funding-target.service.ts`
- `src/partner/partner.module.ts`
- `src/customer-funding-instrument/customer-funding-instrument.service.ts`
- `src/customer-beneficiary/customer-beneficiary.service.ts`
- `src/wallet/customer-financial-account-binding.service.ts`
- `src/bank/bank.service.ts`
- `src/authorization/authorization.service.ts`
- `src/operations/audit.service.ts`
- `test/external-funding-target.service.spec.ts`
- `docs/A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md`
- `docs/A6-EXTERNAL-PARTNER-BASELINE.md`
- `docs/A6-PARTNER-ADAPTER-CONTRACT.md`

## A6T04 verification record

- [x] Exactly one external target source is required per mapping command.
- [x] Customer beneficiary and funding-instrument reads are scoped through their authoritative services.
- [x] Customer ownership, target status, verification, and source version are checked.
- [x] Only `BANK_ACCOUNT` targets are accepted for the selected capability.
- [x] Active NIP-supported bank-directory metadata is required.
- [x] NGN and `CUSTOMER_FUNDS` dimensions are explicit and fail closed when incompatible.
- [x] A2 authorization is checked for the exact customer/target use action.
- [x] A4 policy decision, expiry, review, currency, and amount-limit assertions are checked without duplicating A4 evaluation.
- [x] Consent/mandate assertions are purpose-bound, customer-bound, target-bound, versioned, and expiry-checked.
- [x] A3 validates the explicit internal CustomerWallet/binding/WalletAccount/LedgerAccount tuple read-only.
- [x] Mapping output is deterministic, opaque, auditable, and provider-neutral.
- [x] No provider communication, callback, settlement, financial execution, entity, migration, controller, route, or scheduler is introduced.
- [ ] A6T05 external-operation persistence and provider idempotency remain intentionally incomplete.
