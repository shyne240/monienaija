# A6 External Partners & Settlement — Implementation Plan

- **Phase:** A6 — External Partners & Settlement
- **Status:** Planned
- **Scope:** One isolated, partner-facing external funding or settlement capability using approved bank/NIBSS/provider adapters, authenticated callbacks, external references, provider idempotency, Ledger settlement, suspense handling, independent reconciliation, and external-rail data controls
- **Implementation order:** Architecture phase after the completed A1 Foundation Consolidation, A2 Runtime Identity & Access, A3 Customer-to-Financial Account Binding, A4 Capability & Policy Engine, and A5 Internal Financial Pilot
- **Number of implementation tasks:** 11
- **Source planning documents:** [`ROADMAP.md`](ROADMAP.md), [`PHASES.md`](PHASES.md), [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md), [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md), [`A5-IMPLEMENTATION-PLAN.md`](A5-IMPLEMENTATION-PLAN.md), [`A5-A6-HANDOFF-PACKAGE.md`](A5-A6-HANDOFF-PACKAGE.md), [`A5-COMMAND-CORRELATION-INPUTS.md`](A5-COMMAND-CORRELATION-INPUTS.md), [`A5-INTEGRATION-MATRIX.md`](A5-INTEGRATION-MATRIX.md)
- **Proposed A6 ADR range:** ADR-0047 through ADR-0052

This document is a planning artifact only. It creates no application source, entity, migration, service, controller, API, route, scheduler, provider integration, credential, financial behavior, settlement behavior, or runtime activation.

## 1. Official phase title

**A6 — External Partners & Settlement**

A6 is an Architecture phase and is not a Product Roadmap milestone. It introduces one controlled external-rail boundary after A5 has established the internal customer-aware command, Ledger, idempotency, outbox, recovery, reconciliation, and pilot-control patterns. It does not begin A7 product expansion, public API delivery, customer-channel work, notification delivery, or A8 service extraction.

A6 must not be treated as permission to activate a partner merely because an adapter or callback implementation exists. Partner selection, certification, security, privacy, regulatory, Finance/Ledger, reconciliation, support, and release gates remain explicit phase inputs and exit conditions.

## 2. Phase objective

Introduce one narrowly bounded external partner capability—selected and constrained by A6T01—that is:

- initiated for a canonical `Customer.id` subject or an explicitly authorized internal financial command;
- authorized by A2 and gated by the current A4 capability/action policy;
- bound to explicit A3 customer-to-financial-account relationships and approved funding-instrument or external-target metadata;
- isolated behind an A6-owned partner adapter rather than embedding provider behavior in Customer, Wallet, Ledger, or A5 modules;
- represented by distinct internal command, external-operation, provider-reference, callback, settlement, journal, suspense, audit, outbox, and reconciliation identities;
- safe under duplicate submissions, changed payloads, provider retries, callbacks, replay, outage, rate limiting, timeouts, circuit breaking, and ambiguous external outcomes;
- financially recognized only through approved Ledger posting and settlement boundaries, with suspense and manual exception ownership where finality is not established;
- independently reconcilable against provider responses, callbacks, statements, settlement reports, internal lifecycle records, journals, and suspense records; and
- minimized, consent-aware, access-controlled, retention-safe, and rollback-safe for customer, funding-instrument, provider, credential, risk, compliance, and financial data.

A6 must prove a complete internal-command-to-adapter-to-provider-to-callback-or-report-to-settlement-to-Ledger-to-reconciliation trace without allowing a provider response, callback, external reference, funding-instrument identifier, or A6 operation record to replace A2, A3, A4, A5, Wallet, Ledger, Operations, or Reconciliation authority.

## 3. A6 boundary and task summaries

### 3.1 Selected external capability boundary

A6 does not preselect a bank, NIBSS service, provider, product, or transaction direction in this planning document. A6T01 must select one bounded external flow from the approved candidate set and record the partner, rail, direction, currency, funding/settlement purpose, internal command owner, external data fields, and prohibited adjacent capabilities before implementation proceeds.

The selected flow must be one of the following bounded shapes, subject to A6T01 evidence and review:

```text
external funding into an existing internal customer financial account
or
external settlement from an existing internal customer financial account
```

A6 must not implement both broad inbound funding and broad outbound settlement as an implicit expansion. A second direction or partner requires a separate capability decision and must not be smuggled into the first adapter contract.

### 3.2 One-line summary of every task

| Task | One-line summary |
| --- | --- |
| **A6T01** | Establish the external-rail baseline, select one bounded partner capability, and record prohibited edges, risks, certification inputs, and rollback assumptions. |
| **A6T02** | Define the isolated A6 partner-adapter boundary and normalized provider request/result contract. |
| **A6T03** | Implement the bank/NIBSS connection-isolation, credential, signing, environment, and partner-capability boundary. |
| **A6T04** | Define safe use of verified customer funding instruments and explicit internal/external account mapping. |
| **A6T05** | Define external operation identity, provider references, request hashing, correlation, and provider-idempotency behavior. |
| **A6T06** | Implement authenticated callback ingestion, replay protection, callback reference validation, and idempotent callback handling. |
| **A6T07** | Implement the external operation lifecycle, bounded retry, timeout, circuit-breaker, status-verification, and unknown-outcome recovery boundary. |
| **A6T08** | Integrate verified external outcomes with Ledger settlement, suspense, exception ownership, and compensating-entry boundaries. |
| **A6T09** | Implement independent provider-to-internal reconciliation, discrepancy classification, certification evidence, and support recovery trace. |
| **A6T10** | Define external-rail data minimization, consent, classification, retention, secret, and customer/partner disclosure controls. |
| **A6T11** | Validate the complete A6 external flow and prepare the release gate, rollback package, and A7 handoff without starting A7. |

### 3.3 External financial-effect boundary

A provider request, provider acknowledgement, callback, statement, external reference, or outbox fact is not financial truth by itself.

A successful A6 flow must establish, through the approved contracts:

- one canonical internal customer and account identity chain;
- one distinct external-operation identity;
- one validated partner and provider capability context;
- one provider request/reference and callback/report correlation where applicable;
- one truthful lifecycle state for submitted, pending, failed, settled, suspended, or unknown outcomes;
- one Ledger-owned financial effect only after the approved settlement evidence and financial invariants are satisfied; and
- one independent reconciliation trace covering internal and external evidence.

An external side effect cannot be made atomic with a PostgreSQL transaction by assertion alone. If the provider may have accepted a request while the local transaction or response is ambiguous, A6 must persist a pending/recovery state and verify through the approved provider status, callback, statement, or reconciliation path. It must never retry blindly or report optimistic financial success.

### 3.4 Existing implementation inputs

A6 consumes and must preserve:

- A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts;
- A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, and repair/reconciliation contracts;
- A4 capability/action policy, limits, obligations, evidence snapshot, expiry, re-evaluation, and currentness contracts;
- A5 customer-aware command/correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, and independent-reconciliation patterns;
- `CustomerFundingInstrument` registration, ownership, verification, history, and status metadata as a source input, not a provider credential authority;
- customer beneficiary and bank-directory metadata only through an explicit A6 mapping decision, without treating legacy or display references as canonical identity;
- existing `deposit`, `withdrawal`, `transfer`, `payment`, `virtual-account`, `wallet`, and `ledger` behavior as compatibility inputs rather than evidence of an A6 external boundary;
- Operations AuditService, IdempotencyService, OutboxService, MetricsService, DiagnosticsService, request context, readiness, retention, and shutdown primitives; and
- independent Reconciliation and Finance verification patterns.

Existing bank, funding-instrument, beneficiary, virtual-account, deposit, withdrawal, payment, transfer, ledger, and internal routes must not be treated as partner-approved exposure merely because they exist in the repository.

## 4. A6 scope

A6 includes:

- One approved external partner/rail capability selected through A6T01.
- A generic adapter boundary that prevents provider-specific behavior from becoming a source authority in domain modules.
- Bank/NIBSS/provider connection isolation, environment separation, provider capability configuration, secret/signing boundaries, and safe error normalization.
- External funding-instrument or external-target use only through verified, owned, consented, and explicitly mapped metadata.
- Distinct internal command, external-operation, partner, provider-reference, callback, settlement, suspense, journal, audit, outbox, and reconciliation identifiers.
- Provider-facing request idempotency and internal Operations-backed idempotency with deterministic normalized request hashes.
- Callback authenticity, replay protection, timestamp/nonce or equivalent freshness controls, event deduplication, and callback processing state.
- Bounded transport retry, provider-status verification, timeout/unknown handling, circuit-breaker or equivalent partner isolation, and manual-review escalation.
- Settlement and suspense contracts that preserve Ledger authority and use compensating entries for financial corrections.
- Independent provider-to-internal reconciliation, statement/report ingestion where required by the selected rail, discrepancy ownership, and support trace.
- Data minimization, consent/mandate evidence, credential/secret protection, provider payload classification, retention, legal-hold, and access controls.
- Partner sandbox/certification fixtures, contract tests, outage/replay/timeout/settlement/reconciliation tests, release evidence, rollback/disable behavior, and A7 handoff boundaries.

## 5. A6 non-goals

A6 does not implement:

- Authentication, sessions, MFA, authorization, route protection, privileged-action issuance, or customer identity; those remain A2 responsibilities.
- Customer-to-financial-account binding, binding repair, account reassignment, account provisioning, or account ownership inference; those remain A3 responsibilities.
- Capability/risk/eligibility/restriction/compliance/limit precedence or a second policy evaluator; those remain A4 responsibilities.
- Mutation of Customer, CustomerWallet, customer eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A3 binding, WalletAccount, or source funding-instrument ownership records to make an external operation pass.
- Replacement of the A5 internal transfer lifecycle, Ledger authority, Operations authority, outbox authority, pilot-control boundary, or independent reconciliation authority.
- A broad multi-provider gateway, provider marketplace, generic payment platform, or automatic onboarding of unapproved partners.
- A second customer wallet balance, settlement ledger, journal authority, suspense truth source, provider-reference identity authority, callback truth authority, or reconciliation writer.
- AML, sanctions, fraud, PEP, transaction-monitoring, automated screening, risk scoring, or external compliance decision engines. A6 consumes approved A4/security/compliance contracts and does not invent their precedence.
- FX, cross-currency conversion, fees, commissions, taxes, pricing, chargebacks, disputes, cards, QR payments, virtual-account product activation, payroll, savings, credit, or other product expansion unless a separate approved capability plan explicitly adds one of them.
- Public APIs, mobile/web channels, customer portal changes, notification delivery, customer messaging, or general customer activation; those remain later product/channel work.
- Unbounded background workers, an unowned broker, a new service-extraction topology, or a provider-specific scheduler without an approved Operations/runtime boundary.
- Automatic reconciliation repair, automatic suspense clearing, in-place journal/line/balance mutation, or silent financial correction.
- Production partner activation, live credential use, live settlement, regulatory launch, or broad rollout merely because A6 implementation artifacts exist.
- A7 Product Expansion Infrastructure or A8 Scale & Selective Extraction.

## 6. Governing architectural boundaries

A6 must preserve the following rules from A1-A5 and the financial core:

1. `Customer.id` is the only canonical internal customer identity. Customer references, aliases, case numbers, beneficiary references, funding-instrument IDs, payment references, command IDs, correlation IDs, provider IDs, and partner references remain distinct values.
2. A2 authenticates and authorizes the initiating principal and protects internal callback/support/control surfaces. A provider response or callback cannot grant A2 authorization.
3. A4 owns action-specific capability, risk, restriction, eligibility, compliance, limit, and obligation policy. A6 consumes the current result and must not duplicate or override its precedence.
4. A3 owns the explicit Customer-to-Financial-Account binding. A6 must use verified internal account assertions and must never choose an account from a customer reference, funding-instrument display value, bank account string, provider response, currency, or callback payload.
5. `CustomerFundingInstrument` and beneficiary/bank metadata are source metadata only. A6 may use approved tokenized or reference values, but it must not turn metadata into credentials or financial truth.
6. `WalletAccount` remains the financial wallet facade, and `Ledger` remains the sole authority for financial accounts, journals, lines, balances, posted value, settlement entries, suspense entries, and compensating entries.
7. External side effects and internal database transactions have different commit boundaries. A6 must represent the gap with durable lifecycle, idempotency, callback, status-verification, suspense, reconciliation, or manual-review states.
8. Operations owns audit, idempotency, outbox, metrics, diagnostics, request context, readiness, retention, and operational lifecycle. A6 must reuse those primitives rather than create local substitutes.
9. Reconciliation remains independent and read-only. Provider reports, callback evidence, diagnostics, readiness, and support views cannot repair source records or authorize settlement.
10. Provider credentials, signing keys, callback secrets, customer funding data, risk/compliance evidence, and financial-control data are minimized, classified, access-controlled, redacted, and retained only under approved controls.
11. A6 is a bounded external-integration boundary inside the existing modular monolith. It does not create a microservice or topology change based only on partner scope.
12. Every external request and callback must be scoped to an approved partner/capability and must carry an internal correlation chain without treating the external identifier as canonical internal identity.
13. A6 may use the A5 transactional outbox as a durable internal intent/fact boundary, but no publisher, callback, provider, or settlement process may treat an outbox row as a Ledger record.
14. Disabling an external capability stops new external admission and/or outbound submission without deleting, rewriting, or masking completed internal financial history.

## 7. Dependencies and required inputs

### A1 inputs

- Canonical ownership matrix and prohibited shared-writer decisions.
- Customer, funding-instrument, beneficiary, bank, payment, financial, and provider-reference identifier conventions.
- Data classification, retention, legal-hold, minimization, external-sharing, and privacy controls.
- Risk/compliance authority boundaries and source-evidence ownership.
- Architecture, dependency, route, and migration inventories.

### A2 inputs

- Authenticated principal, customer scope, audience, assurance, roles/scopes, authorization decision, and request/correlation/trace/causation context.
- Protected route/service action policy for the selected external command and internal callback/control paths.
- Privileged approval and step-up requirements for partner configuration, emergency access, settlement exceptions, suspense actions, and recovery where required.
- Session/revocation, security-event, secret-handling, callback-ingress, and incident-access behavior.

### A3 inputs

- Canonical Customer UUID and explicit internal source/destination account binding references.
- CustomerWallet, WalletAccount, and LedgerAccount IDs and ownership relationships.
- Currency, accounting unit, account type, normal balance, active state, source versions, control state, and reconciliation state.
- Read-only missing, stale, pending, suspended, repair-required, closed, and Ledger-unavailable states.
- No permission for A6 to repair or reassign an internal binding as part of an external command.

### A4 inputs

- Selected external capability/action policy decision.
- Policy/profile/version, decision reference, evidence snapshot, normalized input hash, expiry/review, reason codes, obligations, exact limits, and currentness/recovery result.
- A2 authorization-context reference and downstream recheck obligation.
- Explicit policy treatment for external counterparties, funding instruments, provider risk, geography, currency, and transaction direction where applicable.

### A5 inputs

- Customer-aware command and correlation contract.
- Transfer/deposit/withdrawal lifecycle and pending/unknown outcome patterns.
- Ledger posting, account locking, journal correlation, settlement-account support, and compensating-entry boundaries.
- Operations idempotency, audit, outbox, metrics, diagnostics, readiness, retention, and request-context primitives.
- Pilot disable/stop-condition/rollback patterns, adapted so a provider boundary cannot rewrite A5 history.
- Independent internal transfer and financial reconciliation evidence.

### External and governance inputs

- Selected partner/rail capability, interface/version, sandbox or certification contract, operational status, availability, rate limits, idempotency, callback, status-query, and reporting capabilities.
- Approved credential/signing/key-management and secret-rotation boundary; no secrets are stored in this planning document or source control.
- Finance/Ledger chart and posting contract for settlement, suspense, reversals, and correction ownership.
- Security, privacy, data-protection, legal, regulatory, risk, compliance, Operations, Reconciliation, Support, and partner review inputs.
- Existing `bank`, `customer-funding-instrument`, `customer-beneficiary`, `payment`, `deposit`, `withdrawal`, `virtual-account`, `wallet`, `ledger`, `operations`, and `reconciliation` inventories.

## 8. Sequential task breakdown

### A6T01 — External Partner and Settlement Baseline and Capability Selection

- **Type:** Documentation and architecture baseline
- **ADR input:** ADR-0047 — External Partner Adapter Boundary

#### Objective

Inventory current bank, NIBSS, provider, funding-instrument, beneficiary, payment, deposit, withdrawal, virtual-account, settlement-account, callback, route, secret/configuration, reconciliation, and support surfaces; then select one bounded external capability without treating existing metadata or routes as partner-approved behavior.

#### Deliverables

- `docs/A6-EXTERNAL-PARTNER-BASELINE.md`.
- Existing bank/NIBSS/provider/funding/beneficiary/deposit/withdrawal/virtual-account/payment/ledger/operations/reconciliation behavior and schema inventory.
- Partner and rail candidate matrix covering direction, capability, currency, provider references, request/response, callback, status query, report, settlement, suspense, and outage behavior.
- One selected A6 capability/partner/rail decision input with explicit internal command owner and prohibited adjacent capabilities.
- Existing provider-like, funding-instrument, bank-directory, beneficiary, virtual-account, deposit, withdrawal, and route gap register.
- External identifier, credential, secret, data-sharing, consent, retention, and legal-hold inventory.
- A6 dependency, risk, certification, stop-condition, partner-rollback, and internal-history-preservation register.
- Compatibility classification for existing metadata and financial services.

#### Acceptance criteria

- Exactly one bounded external capability is selected for the implementation critical path, or implementation is blocked pending that selection.
- The selected partner/rail, direction, currency, internal command owner, external operation scope, and prohibited expansion edges are explicit.
- Provider responses, callbacks, external references, and funding-instrument metadata are classified as non-canonical until validated by the A6 contract.
- A2, A3, A4, A5, Ledger, Operations, Reconciliation, Finance, Security, Privacy, Support, and partner dependencies are mapped.
- No bank, NIBSS, provider, callback, settlement, credential, schema, API, route, or runtime behavior is changed by this task.

#### Dependencies

- A2, A3, A4, and A5 completed implementation artifacts.
- `docs/A5-A6-HANDOFF-PACKAGE.md`.
- `docs/A5-IMPLEMENTATION-PLAN.md` and `docs/A5-COMMAND-CORRELATION-INPUTS.md`.
- Existing bank, funding-instrument, beneficiary, payment, financial lifecycle, Ledger, Operations, and Reconciliation inventories.
- A1 identifier, privacy, retention, and external-sharing inputs.

#### Explicitly out of scope

- Selecting live credentials, activating a provider, calling a partner, creating settlement value, creating suspense value, or exposing a callback route.

### A6T02 — External Partner Adapter Boundary and Provider Contract

- **Type:** Documentation and runtime contract design
- **ADR:** ADR-0047 — External Partner Adapter Boundary

#### Objective

Define the isolated adapter boundary and normalized provider contract that keeps partner-specific transport, schema, error, capability, and reference behavior outside Customer, A2, A3, A4, A5, Wallet, Ledger, and Operations authorities.

#### Deliverables

- `docs/ADR/ADR-0047-External-Partner-Adapter-Boundary.md`.
- `docs/A6-PARTNER-ADAPTER-CONTRACT.md`.
- Partner adapter interface and normalized request/result/error types.
- Partner capability/version and endpoint-selection contract.
- Internal command-to-adapter correlation map.
- Provider response trust, validation, timeout, rate-limit, and error-normalization contract.
- Adapter sandbox/fixture contract and provider-independent contract tests.
- Explicit boundary for outbound request, provider acknowledgement, provider status query, callback, statement/report, and settlement evidence.

#### Acceptance criteria

- Domain modules call an explicit adapter contract rather than a bank/NIBSS/provider SDK or HTTP client directly.
- Adapter requests carry an internal correlation chain and a distinct partner/provider operation identity.
- Provider fields are schema-validated, bounded, classified, and mapped without using provider IDs as Customer, Wallet, Ledger, command, or journal identity.
- Unsupported partner capabilities, malformed responses, wrong versions, provider errors, rate limits, and unavailable transport fail closed or enter a declared recovery state.
- Adapter tests use deterministic fixtures and do not require live partner calls to prove the contract.
- The contract does not post a journal, mutate a balance, repair a binding, or change A4 policy/source records.

#### Dependencies

- A6T01.
- A2 protected service and secret boundary.
- A3 account-binding and ownership contract.
- A4 capability/action and currentness contract.
- A5 command/correlation, Operations, outbox, recovery, and reconciliation contracts.
- ADR-0003, ADR-0005, ADR-0008, ADR-0023, ADR-0024.

#### Explicitly out of scope

- A specific production partner implementation, live credentials, settlement posting, callback route exposure, product activation, and A7 work.

### A6T03 — Bank/NIBSS Integration Isolation and Credential Boundary

- **Type:** Runtime external-integration boundary implementation
- **ADR:** ADR-0048 — NIBSS and Bank Integration Isolation

#### Objective

Implement the selected bank/NIBSS/provider connection boundary with environment isolation, approved capability configuration, credential/signing protection, safe transport behavior, and no provider logic in financial source modules.

#### Deliverables

- `docs/ADR/ADR-0048-NIBSS-and-Bank-Integration-Isolation.md`.
- Selected adapter transport and capability configuration in the approved infrastructure/partner owner.
- Provider endpoint, timeout, rate-limit, connection, and version configuration validation.
- Secret, certificate, signing-key, mTLS, or equivalent credential reference boundary using approved secret configuration; no secret material in source or logs.
- Environment and partner separation for local, test, sandbox, and later controlled release contexts.
- Provider request signing/authentication and response authenticity boundary where the selected rail requires it.
- Transport failure, provider outage, version mismatch, and credential-configuration error mapping.
- Adapter isolation, configuration, redaction, and deterministic failure tests.

#### Acceptance criteria

- External calls are possible only through the selected A6 adapter and approved capability configuration.
- Credentials and signing material are referenced through approved configuration/secret controls and are never persisted in domain records, logs, traces, outbox payloads, or support output.
- A wrong partner, wrong environment, missing credential, invalid signature, incompatible version, or unavailable endpoint fails closed.
- Provider-specific transport behavior cannot directly mutate Customer, funding-instrument, Wallet, Ledger, A5, or Reconciliation source records.
- Test/sandbox and later controlled release configurations cannot silently share production credentials or endpoints.
- No partner call is made from A5 internal transfer execution or from a reconciliation/diagnostic/readiness writer.

#### Dependencies

- A6T01 and A6T02.
- A2 secret, route, service-audience, privileged-access, and security-event contracts.
- A1 data classification, retention, legal-hold, and external-sharing controls.
- Selected partner sandbox/certification contract.
- Operations configuration, diagnostics, readiness, request-context, and audit primitives.

#### Explicitly out of scope

- Broad provider onboarding, credential issuance, production partner activation, public partner APIs, notification delivery, and settlement accounting.

### A6T04 — External Funding-Instrument Use and Internal Account Mapping

- **Type:** Runtime consumer-boundary implementation
- **ADR:** ADR-0051 — External Funding-Instrument Use

#### Objective

Consume verified customer funding-instrument and approved external-target metadata without making metadata, raw credentials, beneficiary references, or provider responses into financial identity or authority.

#### Deliverables

- `docs/ADR/ADR-0051-External-Funding-Instrument-Use.md`.
- Funding-instrument/beneficiary/bank-target consumer contract for the selected A6 capability.
- Verification, ownership, status, expiry, consent/mandate, currency, limit, and purpose checks.
- Tokenized or provider-reference-only handoff to the A6 adapter.
- Explicit mapping between canonical Customer UUID, A3 internal account binding, selected funding instrument/target, partner identity, and provider-side reference.
- Missing, stale, revoked, blocked, expired, mismatched, or unavailable funding-instrument behavior.
- Funding-instrument use, ownership, stale-version, privacy, and no-source-mutation tests.

#### Acceptance criteria

- A2 authorization and A4 policy are checked before a funding-instrument or external-target operation is admitted.
- A3 supplies the internal WalletAccount/LedgerAccount identity; A6 never chooses an internal account from a funding-instrument, beneficiary, bank, currency, or provider value.
- Only approved, owned, verified, current, purpose-compatible, and consented metadata can be passed to the adapter.
- Raw PAN, account passwords, CVV, PIN, OTP, token secret, signing key, or equivalent credential material is never stored or copied into a general A6 command/event payload.
- A funding-instrument or beneficiary status change causes a controlled denial, pending, or re-evaluation; it does not silently rewrite an external operation or internal financial history.
- Funding-instrument metadata remains owned by its source module and is not changed to make an external operation pass.

#### Dependencies

- A6T01-A6T03.
- A2 authorization and privileged-action contracts.
- A3 binding/read/reconciliation contracts.
- A4 external capability policy, obligations, limits, and currentness result.
- Existing `customer-funding-instrument`, `customer-beneficiary`, `bank`, `payment`, and A5 command-correlation contracts.
- ADR-0016, ADR-0017, ADR-0023, ADR-0024.

#### Explicitly out of scope

- Funding-instrument registration/verification redesign, bank-account ownership creation, beneficiary-model consolidation, raw credential storage, card product implementation, and external settlement posting.

### A6T05 — External Operation Identity, References, and Provider Idempotency

- **Type:** Runtime command and persistence contract implementation
- **ADR:** ADR-0049 — External Callback and Reference Idempotency

#### Objective

Define the durable external-operation identity and idempotency boundary so internal commands, provider requests, provider references, callbacks, settlement records, and reconciliation evidence remain distinct and replay-safe.

#### Deliverables

- `docs/ADR/ADR-0049-External-Callback-and-Reference-Idempotency.md`.
- Versioned external-operation request/result contract.
- Internal command-to-external-operation-to-provider-reference correlation map.
- Partner/provider idempotency-key and request-hash contract distinct from A5/internal Operations scopes.
- Same-key/same-payload replay and same-key/changed-payload conflict behavior.
- Provider-reference uniqueness, partner-scoped reference mapping, reference normalization, and reference-conflict behavior.
- External-operation persistence/migration package where a durable record is required.
- Operations audit, idempotency, outbox, metrics, diagnostics, and support-trace integration.
- Identity, replay, conflict, uniqueness, migration, and no-financial-side-effect tests.

#### Acceptance criteria

- `Customer.id`, internal command ID, A5 transfer/deposit/withdrawal ID, external-operation ID, provider idempotency key, provider transaction/reference ID, callback event ID, journal ID, and outbox ID remain distinct.
- The normalized request hash includes every field that changes the external effect and excludes transport-only values and secrets.
- An identical retry returns the durable original external-operation outcome or controlled pending state without a second uncontrolled provider effect.
- A changed payload under the same internal or partner idempotency scope is rejected without financial mutation.
- A provider reference is accepted only with the expected partner, operation, capability, customer/account mapping, currency, amount, and state context.
- A provider response or reference cannot by itself complete a Transfer, Deposit, Withdrawal, Ledger journal, or settlement record.
- Expired idempotency retention never reuses an old operation, provider reference, journal, or financial identity.

#### Dependencies

- A6T01-A6T04.
- A5 command/correlation, lifecycle, idempotency, outbox, recovery, and journal-correlation contracts.
- Operations `IdempotencyService`, `AuditService`, `OutboxService`, and request-context primitives.
- Partner idempotency and reference capabilities from the selected rail.
- ADR-0003, ADR-0008, ADR-0023, ADR-0044.

#### Explicitly out of scope

- Callback ingestion, settlement posting, suspense accounting, broad provider onboarding, and public API exposure.

### A6T06 — Callback Authenticity, Replay Protection, and Inbound Boundary

- **Type:** Runtime inbound integration implementation
- **ADR:** ADR-0049 — External Callback and Reference Idempotency

#### Objective

Receive and process selected partner callbacks or status notifications only after authenticity, freshness, partner scope, schema, reference, and replay checks pass.

#### Deliverables

- Provider callback ingress/adapter contract under the approved A2 route and service-audience boundary.
- Signature, MAC, mTLS, certificate, nonce, timestamp, sequence, or equivalent authenticity and freshness validation for the selected rail.
- Callback schema/version validation and sensitive-payload redaction.
- Callback event identity, deduplication key, receipt state, and processing idempotency contract.
- Provider-reference-to-external-operation correlation and mismatch handling.
- Safe acknowledgement, retry, duplicate, delayed, out-of-order, and unsupported-event behavior.
- Callback authenticity, replay, forged-payload, duplicate, out-of-order, reference-mismatch, and no-direct-Ledger-write tests.

#### Acceptance criteria

- Unauthenticated, unverifiable, stale, replayed, malformed, wrong-partner, wrong-environment, and unsupported callbacks do not change financial state.
- Callback processing is idempotent and uses Operations-owned durable evidence; a duplicate callback cannot create a second external operation, settlement, journal, outbox fact, or customer-visible outcome.
- A callback may advance an external-operation lifecycle only after the provider reference and internal mapping are validated.
- Callback payloads are minimized and do not expose or persist credentials, signatures, raw funding secrets, full risk/compliance data, or unnecessary customer data.
- Callback handlers do not select accounts, repair bindings, recalculate policy, post journals directly, or clear reconciliation discrepancies.
- Callback route exposure remains A2-controlled and is not a public customer API.

#### Dependencies

- A6T02, A6T03, and A6T05.
- A2 protected ingress, authorization/audience, secret, security-event, and route/data-exposure contracts.
- Selected partner callback/authentication specification.
- Operations idempotency, audit, outbox, request context, and diagnostics primitives.

#### Explicitly out of scope

- Unauthenticated webhook processing, public callback exposure, notifications, customer messaging, provider-independent dispute workflows, and direct financial posting.

### A6T07 — External Operation Lifecycle, Retry, Circuit Breaker, and Unknown Outcomes

- **Type:** Runtime resilience and lifecycle implementation
- **ADR inputs:** ADR-0047 and ADR-0049

#### Objective

Represent and recover external operations across submission, provider acknowledgement, callback/report waiting, timeout, retry, outage, rate limit, rejection, settlement-pending, manual-review, and unknown outcomes without creating duplicate external or financial effects.

#### Deliverables

- External-operation lifecycle state vocabulary and transition guards.
- Durable lifecycle fields for internal command, customer/account, capability/policy, funding/target, adapter, partner, provider reference, callback, settlement, journal, failure, recovery, and reconciliation references.
- Migration and rollback package where lifecycle persistence requires schema changes.
- Bounded retry policy distinguishing safe transport retry, provider rejection, rate limit, timeout, status-query, and ambiguous commit outcomes.
- Circuit-breaker or equivalent partner-isolation contract with open, half-open, closed, and unavailable behavior where applicable.
- Provider status-verification and recovery path for accepted-but-unresolved operations.
- Manual-review and hold states for unresolved provider, callback, statement, or settlement evidence.
- Lifecycle, concurrency, retry, timeout, outage, circuit-breaker, replay, unknown, and no-duplicate-effect tests.

#### Acceptance criteria

- Every external operation has a durable state and canonical internal correlation before or atomically with the outbound intent.
- A provider timeout or connection failure is not interpreted as provider rejection or success without approved evidence.
- Retries preserve the same logical operation, provider idempotency identity, account pair, amount, currency, and capability context.
- A provider-accepted or potentially committed operation is verified through a supported status/callback/report/reconciliation path before a new submission decision.
- Circuit-breaking stops new partner attempts without deleting or rewriting completed internal financial history.
- Unknown, pending, manual-review, and failed outcomes are truthful, support-traceable, and cannot trigger blind financial retry.
- Lifecycle transitions cannot clear a provider reference, journal reference, settlement reference, or recovery reference without an approved correction/recovery boundary.
- No unbounded retry loop, unowned scheduler, or local idempotency/audit store is introduced.

#### Dependencies

- A6T02-A6T06.
- A5 lifecycle, unknown-outcome, retry, outbox, Ledger, reconciliation, and pilot-disable patterns.
- Operations metrics, diagnostics, readiness, idempotency, audit, and request-context contracts.
- Selected partner timeout, status-query, rate-limit, and outage behavior.

#### Explicitly out of scope

- Settlement accounting, automatic suspense resolution, provider dispute/chargeback products, public status APIs, and A7 product/channel work.

### A6T08 — Settlement, Suspense, and Financial Exception Ownership

- **Type:** Runtime financial integration and control implementation
- **ADR:** ADR-0050 — Settlement, Suspense, and Exception Ownership

#### Objective

Post only verified external financial outcomes through the existing Ledger boundary and represent unmatched, delayed, disputed, or ambiguous value through approved suspense and exception controls.

#### Deliverables

- `docs/ADR/ADR-0050-Settlement-Suspense-and-Exception-Ownership.md`.
- Settlement event-to-Ledger journal/line mapping for the selected capability.
- Approved settlement, clearing, suspense, and customer-funds account dimensions where required by Finance/Ledger.
- Double-entry, currency, accounting-unit, account-state, balance, lock, and journal-correlation contract.
- External-operation-to-settlement-to-journal correlation and idempotency mapping.
- Suspense entry, aging, hold, release, manual-review, exception-owner, and compensating-entry contract.
- Provider rejection, duplicate settlement, unmatched report, partial settlement, currency mismatch, amount mismatch, and ambiguous-finality behavior.
- Financial invariant, settlement idempotency, suspense, rollback/disable, and no-direct-write tests.

#### Acceptance criteria

- Ledger remains the only authority for posted financial value, settlement accounts, suspense balances, journals, lines, and compensating entries.
- A provider request, acknowledgement, callback, or external reference cannot create settled financial value without the approved evidence and execution boundary.
- One verified external outcome produces at most one correlated Ledger effect for the logical operation.
- Settlement and suspense entries are balanced, currency-labelled, accounting-unit-compatible, and subject to Ledger account and lock invariants.
- Unmatched, delayed, disputed, partially verified, or ambiguous value enters an explicit suspense or manual-review state rather than being silently credited, debited, or cleared.
- Corrections and reversals use new approved compensating Ledger entries and never mutate posted journals, lines, balances, or completed A5 records.
- Disabling the external capability stops new admission/submission without rewriting completed settlement or financial history.

#### Dependencies

- A6T04-A6T07.
- A3 internal account binding and A5 Ledger/journal/correction contracts.
- Existing `LedgerService`, `SettlementAccountService`, payment references, financial invariant tests, and Operations primitives.
- Finance/Ledger-approved chart and settlement/suspense dimensions.
- ADR-0002, ADR-0004, ADR-0005, ADR-0008, ADR-0043, ADR-0044.

#### Explicitly out of scope

- Ledger redesign, unauthorized chart expansion, FX, fees/commissions, customer credit, automatic suspense clearing, and external financial correction outside Ledger/Finance ownership.

### A6T09 — Independent External Reconciliation, Certification, and Support Trace

- **Type:** Runtime control, reconciliation, and support implementation
- **ADR inputs:** ADR-0005, ADR-0008, and ADR-0050

#### Objective

Independently compare provider requests, responses, callbacks, statements/reports, external operations, settlement/suspense, Ledger journals, audit, outbox, and internal lifecycle evidence without repairing source records.

#### Deliverables

- `docs/A6-EXTERNAL-RECONCILIATION-CONTRACT.md`.
- Provider-to-internal-operation-to-settlement-to-journal reconciliation query/report.
- Independent checks for partner/capability, provider reference, callback authenticity/receipt, operation state, internal customer/account mapping, amount, currency, accounting unit, journal correlation, settlement/suspense, idempotency, audit, outbox, and statement/report completeness.
- Discrepancy vocabulary for missing/duplicate/mismatched provider references, callback replay, orphan operations, missing/duplicate settlement, amount/currency mismatch, stale reports, suspense aging, provider outage, and unresolved unknown outcomes.
- External report/statement ingestion or read boundary for the selected partner where required, with source ownership and retention rules.
- Classified support trace containing canonical internal IDs, partner/provider references, operation, callback, settlement, journal, suspense, audit, outbox, and reconciliation references.
- Partner certification fixtures and evidence for happy path, rejection, duplicate, callback replay, delayed report, outage, timeout, settlement mismatch, suspense, and rollback cases.
- Read-only, drift, failure, unknown-outcome, report-unavailable, and no-repair tests.

#### Acceptance criteria

- Reconciliation queries source tables and approved provider/report evidence independently of partner adapter write methods and settlement write methods.
- A provider report or callback without a valid internal operation, or an internal settlement without valid provider evidence, is reported as a controlled discrepancy.
- Customer/account ownership, provider/capability mapping, amount, currency, accounting-unit, status, reference, and journal mismatches are explicit.
- Duplicate, delayed, out-of-order, missing, or replayed external facts cannot create a second financial effect or be silently discarded.
- Reconciliation never updates Customer, funding instruments, A3 bindings, Wallet, Ledger, external-operation, audit, outbox, policy, or source provider records to make a report pass.
- Support can trace the operation without exposing secrets, raw callback signatures, full funding credentials, unrestricted risk/compliance data, or unnecessary customer data.
- Partner certification evidence identifies the exact adapter/contract/version and is separate from production activation evidence.

#### Dependencies

- A6T05-A6T08.
- Existing A3/A5 reconciliation, Operations audit/idempotency/outbox/diagnostics, Ledger, payment-reference, and support-trace contracts.
- Selected provider statement/report and reconciliation capabilities.
- A1 data classification, retention, legal-hold, and support-access controls.

#### Explicitly out of scope

- Automatic source repair, automatic suspense clearing, provider-side correction, external dispute resolution, production certification sign-off, and customer-facing reporting channels.

### A6T10 — External-Rail Data Minimization, Consent, and Disclosure Controls

- **Type:** Documentation, privacy, security, and runtime data-boundary implementation
- **ADR:** ADR-0052 — External-Rail Data Minimization and Consent

#### Objective

Ensure that A6 shares, stores, logs, traces, retains, and exposes only the minimum approved customer, funding, financial, provider, credential, risk, compliance, and consent evidence required by the selected external capability.

#### Deliverables

- `docs/ADR/ADR-0052-External-Rail-Data-Minimization-and-Consent.md`.
- External data-field inventory and partner-sharing matrix.
- Consent/mandate/terms evidence contract for the selected funding or settlement purpose.
- Field-level classification, redaction, encryption/tokenization, access, retention, deletion, and legal-hold rules.
- Provider request/response/callback/outbox/audit/diagnostic/support payload minimization contract.
- Credential, certificate, signature, token, and secret handling/rotation boundary.
- Customer/internal disclosure, correction, support, and incident-preservation contract without implementing notification delivery.
- Sensitive-data, redaction, consent, access-scope, retention, and no-secret-leakage tests.

#### Acceptance criteria

- The selected partner receives only approved fields for the selected capability, purpose, jurisdiction, and lifecycle state.
- Consent or mandate evidence is explicit, current, purpose-bound, revocable where applicable, and distinct from A2 authorization and A4 policy eligibility.
- Raw credentials, PAN/account secrets, PINs, OTPs, callback signatures, private keys, raw risk/compliance notes, and unnecessary identity documents are excluded from general records and observability.
- Provider payloads and external references are classified and retained according to the approved policy; ordinary cleanup cannot delete held evidence.
- Support, Operations, Reconciliation, and partner-facing views use minimum necessary fields and approved audience controls.
- A data-sharing or consent failure fails closed or enters a declared manual-review state; it never defaults to external transmission.
- A6 does not create a new customer identity, consent, funding-instrument, compliance, risk, authorization, or notification authority.

#### Dependencies

- A6T01-A6T09.
- A1 ADR-0023/ADR-0024 identifier, privacy, retention, legal-hold, and external-sharing inputs.
- A2 secret, route, audience, privileged-access, and security-event contracts.
- A3 account ownership and A4 policy/obligation contracts.
- Selected partner data-processing, consent, and security specifications.

#### Explicitly out of scope

- Legal approval itself, customer portal/mobile disclosure screens, notification delivery, marketing consent, general data-platform redesign, and A7 preference/notification infrastructure.

### A6T11 — A6 Integration, Partner Certification, Release Gate, and A7 Handoff

- **Type:** Integration and phase-exit evidence
- **ADR review:** ADR-0047 through ADR-0052

#### Objective

Validate the complete selected external partner capability and prepare the A6 release gate and A7 handoff without beginning A7 product-expansion implementation or broad partner activation.

#### Deliverables

- `docs/A6-INTEGRATION-MATRIX.md`.
- `docs/A6-ROUTE-EXPOSURE-AND-ROLLBACK.md`.
- `docs/A6-ADR-REVIEW-STATUS.md`.
- `docs/A6-OPERATIONAL-RECOVERY-RUNBOOK.md`.
- `docs/A6-EXIT-CHECKLIST.md`.
- `docs/A6-APPROVAL-PACKAGE.md`.
- `docs/A6-A7-HANDOFF-PACKAGE.md`.
- End-to-end identity-to-command-to-adapter-to-provider-to-callback/report-to-settlement/suspense-to-Ledger-to-reconciliation trace.
- Partner sandbox/certification evidence for request signing, response validation, idempotency, callback authenticity, replay, duplicate, outage, timeout, circuit breaking, status verification, settlement, suspense, reconciliation, data minimization, and rollback.
- External-operation, provider-reference, callback, settlement, suspense, journal, audit, outbox, and reconciliation correlation evidence.
- Route/data-exposure, credential, disable, partner rollback, internal financial-history preservation, and support recovery evidence.
- A7 entry conditions and prohibited-edge register.

#### Acceptance criteria

- The selected external capability maps to A2 authorization, A3 binding, A4 policy, A5 command/ledger/Operations patterns, the partner adapter, callback boundary, settlement, suspense, and independent Reconciliation.
- One verified external operation produces at most one traceable internal financial effect and one approved internal operational fact where the selected flow requires it.
- Duplicate, changed-payload, provider-rejected, callback-replayed, delayed, out-of-order, timed-out, circuit-open, unavailable, and unknown operations have deterministic safe outcomes.
- Settlement and suspense evidence reconciles to the provider/statement evidence and Ledger without direct source mutation.
- Support can trace an operation while provider credentials, callback secrets, raw funding data, and unrestricted risk/compliance data remain protected.
- Disable/circuit-breaker/rollback controls stop new external activity without rewriting completed A5 or Ledger history.
- Partner-specific logic is isolated from canonical Customer, A2, A3, A4, A5, Wallet, Ledger, Operations, and Reconciliation authorities.
- No unapproved second partner, external product, public API, notification, A7, A8, or broad customer activation is included.
- All unresolved implementation risks have an owner, severity, mitigation, stop condition, certification requirement, and rollback/disable behavior.
- A7 handoff conditions are explicit and do not claim that A6 proves all future product, channel, notification, or public-API behavior.

#### Dependencies

- A6T01-A6T10.
- A1-A5 phase artifacts and handoff packages.
- Existing bank, funding-instrument, beneficiary, payment, virtual-account, deposit, withdrawal, Wallet, Ledger, Operations, and Reconciliation modules.
- Selected partner sandbox/certification evidence.
- Finance/Ledger, Security, Privacy, Risk, Compliance, Operations, Reconciliation, Support, Product, and partner review inputs.

#### Explicitly out of scope

- A7 product expansion infrastructure, public APIs, mobile/web channels, notifications, general customer activation, additional partner onboarding, A8 extraction, and production rollout beyond the separately approved release boundary.

## 9. A6 critical path

```text
A6T01 External partner baseline and capability selection
  -> A6T02 Partner adapter boundary and provider contract
  -> A6T03 Bank/NIBSS isolation and credential boundary
  -> A6T04 Funding-instrument use and internal account mapping
  -> A6T05 External operation identity and provider idempotency
  -> A6T06 Callback authenticity and replay protection
  -> A6T07 External lifecycle, retry, circuit breaker, and unknown outcomes
  -> A6T08 Settlement, suspense, and financial exception ownership
  -> A6T09 Independent external reconciliation and certification
  -> A6T10 External-rail data minimization, consent, and disclosure controls
  -> A6T11 A6 integration, certification, release gate, and A7 handoff
```

A6T01 must select the single external capability before provider-specific implementation. A6T02 and A6T03 may be designed in parallel after A6T01, but no external call may be introduced before the adapter, credential, environment, and security boundaries are defined. A6T04 and A6T05 may be designed together because internal funding/account identity, external operation identity, provider references, and idempotency must remain one correlation contract. A6T06 depends on the provider callback specification and A6T05 reference identity. A6T07 must be designed before any retry or callback can advance a financial lifecycle. A6T08 cannot post settlement or suspense value until A6T05-A6T07 establish verified external outcomes. A6T09 may prepare independent report queries alongside A6T05-A6T08 but cannot pass until external lifecycle and settlement records exist. A6T10 may review data fields alongside A6T02-A6T09 but must pass before partner payloads or callback evidence are accepted. A6T11 is blocked until all selected-flow evidence is complete. A7 remains outside A6.

## 10. A6 integration trace

```text
A2 authenticated principal / protected internal command context
                         |
                         v
A4 current external capability decision
  capability/action + policy version + limits + obligations + expiry
                         |
                         v
A3 internal account/funding ownership recheck
  Customer.id -> CustomerWallet -> A3 binding -> WalletAccount -> LedgerAccount
                         |
                         v
A6 external operation command
  internal command/operation ID
  funding-instrument or approved external-target reference
  amountMinor + currency + accountingUnit
  internal idempotency + provider idempotency + correlation/causation
                         |
                         v
A6 partner adapter and isolated transport
  approved partner/capability/version
  authenticated request + provider reference/acknowledgement
                         |
                         v
External evidence boundary
  verified callback or status query or statement/report
  callback event identity + provider reference + replay state
                         |
                         v
External operation lifecycle
  submitted / pending / retry / unknown / manual review / settled / failed
                         |
                         v
Settlement and exception boundary
  verified settlement decision
  Ledger-owned journal/lines
  suspense or controlled exception where finality/matching is unresolved
                         |
                         v
Operations and independent control evidence
  audit + idempotency + transactional outbox
  provider/internal references + support trace
  external reconciliation + discrepancy owner
                         |
                         v
A6 release control
  circuit breaker + disable/rollback
  internal financial history preserved
```

A6 is an external-integration and settlement boundary, not a replacement for A2 authentication/authorization, A3 binding, A4 policy, A5 internal lifecycle, Wallet, Ledger, Operations, or Reconciliation. A provider response, callback, statement, external reference, or suspense row cannot become financial truth without the owning boundary's verification.

## 11. A6 prohibited edges

- A6 treats a provider response, callback, statement, external reference, funding-instrument ID, beneficiary reference, or outbox fact as canonical Customer identity, A2 authorization, A3 binding, A4 policy, or Ledger truth.
- A6 selects a WalletAccount/LedgerAccount from a customer reference, bank-account string, funding-instrument value, beneficiary alias, currency, provider response, or callback payload.
- A6 writes Customer, CustomerWallet, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, funding-instrument ownership, beneficiary ownership, or A3 binding records to make an external command pass.
- A6 embeds a second risk, compliance, sanctions, fraud, eligibility, restriction, or limit precedence engine.
- A6 calls a bank/NIBSS/provider directly from Customer, Wallet, Ledger, A5, Reconciliation, diagnostics, readiness, support, or an unapproved controller instead of the isolated adapter boundary.
- A6 accepts an unauthenticated, stale, replayed, malformed, wrong-partner, or wrong-environment callback.
- A6 retries an ambiguous provider outcome with a new external or financial identity without verified status/reconciliation evidence.
- A6 posts a journal, mutates a balance, clears suspense, or edits a posted journal/line outside Ledger and Finance-approved correction boundaries.
- A6 treats a provider acknowledgement as settled value or credits/debits a customer before the approved settlement evidence exists.
- A6 creates an independent provider-reference, settlement, suspense, audit, idempotency, outbox, metrics, diagnostics, or reconciliation authority.
- A6 stores raw credentials, PAN/account secrets, PINs, OTPs, callback signatures, private keys, unrestricted risk/compliance content, or unnecessary customer data in broad records, logs, traces, events, or support views.
- A6 exposes a public customer, mobile, web, or partner API merely because an adapter or callback exists; A2 route/data controls remain required.
- A6 adds notifications, customer messaging, general background jobs, product pricing, FX, fees, cards, QR, virtual accounts, payroll, savings, credit, or other A7/product behavior.
- A6 broadens the selected partner/rail or customer cohort without a separate capability decision and release boundary.
- A6 mutates completed A5 transfer/deposit/withdrawal history to reconcile an external provider or settlement discrepancy.
- A6 begins A7, A8, public APIs, product expansion, or service extraction.

## 12. A6 phase exit criteria

A6 implementation is complete only when:

- One selected external capability has an explicit partner, rail, direction, currency, data, consent, internal command, and prohibited-edge contract.
- Partner-specific transport is isolated behind the A6 adapter boundary and uses approved credential/signing/environment controls.
- External operation, provider reference, callback event, internal command, idempotency, journal, settlement, suspense, audit, outbox, and reconciliation identifiers remain distinct and queryable.
- Funding-instrument or external-target use is verified, owned, current, purpose-bound, consented, privacy-safe, and mapped to explicit A3 internal accounts.
- Callback authenticity, replay protection, freshness, schema, partner scope, reference validation, and idempotent processing pass.
- Provider retries, rate limits, circuit breaking, timeouts, status verification, outages, and unknown outcomes are bounded and support-traceable.
- Verified external outcomes create at most one balanced Ledger-owned settlement effect, or enter explicit pending/suspense/manual-review/reconciliation state.
- Suspense, exception, reversal, and correction behavior preserves immutable Ledger history and assigns ownership without automatic source repair.
- Independent external reconciliation detects missing, duplicate, orphan, delayed, mismatched, stale, and unresolved provider/settlement evidence without writing source records.
- Partner certification fixtures and tests cover request/response, callback, replay, duplicate, outage, timeout, status query, settlement, suspense, reconciliation, data minimization, and rollback behavior.
- Data sharing, consent, retention, legal-hold, secret, support, and customer/internal disclosure controls are explicit and tested at the selected boundary.
- Disable and rollback controls stop new external activity without rewriting A5 or Ledger financial history.
- A2, A3, A4, A5, Wallet, Ledger, Operations, Outbox, and Reconciliation authorities remain separate.
- No A7 product expansion, public API, notification, mobile/web channel, A8 extraction, or unapproved second partner is included.
- A6-to-A7 handoff is documented without claiming that A6 proves future product/channel/notification behavior or broad production activation.

## 13. A6 handoff to A7

A6 may provide later phases with:

- an approved partner-adapter boundary and normalized external operation contract;
- partner/capability/version, provider-reference, callback, status-query, and provider-idempotency patterns;
- funding-instrument and external-target use constraints with internal A3 account mapping;
- external lifecycle, retry, circuit-breaker, timeout, unknown-outcome, and manual-review patterns;
- Ledger settlement, suspense, exception, compensating-entry, and internal correlation patterns;
- independent external reconciliation, statement/report, discrepancy, and support-trace patterns;
- external-rail data minimization, consent, classification, retention, secret, and access controls; and
- partner certification, disable, rollback, and internal-history-preservation evidence.

A6 must not provide later phases with:

- bank/NIBSS/provider credentials, tokens, certificates, signing keys, callback secrets, raw funding data, partner confidential data, or unrestricted risk/compliance evidence;
- a claim that one selected partner proves all external provider reliability or settlement finality;
- permission to treat provider responses, callbacks, statements, external references, outbox facts, payment references, or suspense rows as Ledger truth;
- a replacement A2 authorization, A3 account-binding, A4 policy, A5 lifecycle, Ledger, Operations, or Reconciliation authority;
- permission to mutate completed A5 financial history for product or provider correction;
- permission to broaden the selected partner or external capability into a product catalogue;
- public/mobile/web routes, notification delivery, customer activation, or product-specific API contracts; or
- permission to skip A7 product, channel, disclosure, notification, governance, support, and reconciliation review.

A7 remains responsible for product-expansion contracts, product-specific policy and limits, customer channels, notifications/background jobs, public APIs, support/reporting infrastructure, and product-specific governance. A8 remains responsible for scale, regional resilience, capacity, and selective extraction.

## 14. A6 plan verification record

- [x] Official phase title is A6 — External Partners & Settlement.
- [x] A6 is positioned after A5 and before A7/A8.
- [x] The plan requires one bounded external capability instead of an implicit multi-provider platform.
- [x] A2, A3, A4, A5, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Security, Privacy, Support, and partner dependencies are explicit.
- [x] Partner adapter isolation, bank/NIBSS boundary, credential protection, callback authenticity, external references, and provider idempotency are explicit.
- [x] Funding-instrument use is separated from customer identity, A2 authorization, A4 policy, A3 binding, and Ledger truth.
- [x] Provider timeout, retry, outage, circuit-breaker, callback replay, status verification, and unknown outcomes are explicit.
- [x] Settlement, suspense, exception ownership, compensating entries, and immutable Ledger history are explicit.
- [x] Independent external reconciliation and support trace remain read-only and source-authority preserving.
- [x] Data minimization, consent, classification, retention, legal-hold, secret, and disclosure controls are explicit.
- [x] A6 prohibited edges, rollback/disable boundaries, A7 handoff, and A8 exclusion are explicit.
- [x] No application source, entity, migration, service, controller, API, route, scheduler, provider integration, credential, financial behavior, settlement behavior, or runtime activation is created by this planning task.
