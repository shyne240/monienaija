# A6 Integration and Evidence Matrix

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T11 — A6 Integration, Partner Certification, Release Gate, and A7 Handoff
- **Status:** Evidence package prepared; approval, partner certification, and activation pending
- **Classification:** Documentation-only integration and phase-exit evidence
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None
- **Review snapshot:** `b793d6c` (post-A6T10 committed implementation evidence)

## 1. Purpose and evidence boundary

This matrix integrates the committed A6T01-A6T10 implementation artifacts for the bounded external-rail capability selected by A6T01:

```text
capability: external.wallet.withdrawal.settlement
direction: internal customer-funds wallet -> external Nigerian bank account
rail:      NIBSS_NIP (selected planning rail)
currency:  NGN
accounting unit: CUSTOMER_FUNDS
internal lifecycle input: existing Withdrawal/payment/Ledger boundaries
external target input:    verified customer-owned bank-account beneficiary or approved equivalent
```

It distinguishes:

- committed source, runtime, migration, test, and documentation evidence;
- design alignment and local automated validation;
- live database migration, deployment, route exposure, partner certification, and operational evidence; and
- governance, accountable-owner approval, Finance/Ledger approval, partner certification, and capability activation.

No checkbox in this document claims live execution, production deployment, partner certification, owner approval, or financial activation unless explicitly identified as such.

## 2. Task-to-evidence matrix

| Task                                              | Committed implementation/documentation evidence                                                                                                                                                                                                                                                                                                                                                                                                            | Boundary integrated                                                                                                                                                                                              | Automated evidence                                                                                            | Current status                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **A6T01 — External partner baseline**             | [`A6-EXTERNAL-PARTNER-BASELINE.md`](A6-EXTERNAL-PARTNER-BASELINE.md), bank/NIBSS/funding/beneficiary/withdrawal/ledger/operations/reconciliation inventories, gap register, prohibited edges, certification assumptions, stop/rollback assumptions                                                                                                                                                                                                  | One bounded NGN NIBSS_NIP external settlement capability selected; existing surfaces classified as compatibility input                                                                                          | Document review                                                                                                | Baseline committed; activation not claimed               |
| **A6T02 — Partner adapter boundary**              | [ADR-0047](ADR/ADR-0047-External-Partner-Adapter-Boundary.md), [`A6-PARTNER-ADAPTER-CONTRACT.md`](A6-PARTNER-ADAPTER-CONTRACT.md), `partner-adapter.types.ts`, `partner-capability.registry.ts`, fixture-based testing boundary                                                                                                                                                                                                                  | Provider-neutral adapter; no provider SDK in domain modules; normalized request/result/error types; partner capability/version contract                                                                       | Adapter contract test surface                                                                                  | Contract aligned; no live provider call                  |
| **A6T03 — Bank/NIBSS isolation and credential boundary** (documentation) | ADR-0048 is **not yet authored**; transport/credential/signing/mTLS/key-rotation evidence currently lives in `partner-connection.service.ts` and `partner-credentials.service.ts`                                                                                                                                                                                                                                                                  | Disabled-by-default, environment-aware partner connection, credential reference (no secret material in repo), signature envelope where applicable                                                                 | Connection service tests; **no live partner transport**                                                       | Contract-aligned; ADR-0048 authoring pending             |
| **A6T04 — Funding-instrument use and internal account mapping** | [ADR-0051](ADR/ADR-0051-External-Funding-Instrument-Use.md), [`A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md`](A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md), `external-funding-target.service.ts`, `external-funding-target.types.ts`, `test/external-funding-target.service.spec.ts`                                                                                                                                                                                                                                  | Verified, owned, current, purpose-compatible, consented customer funding-instrument; explicit A3 internal account chain; no A6 repair/reassignment                                                                     | Funding-target tests                                                                                           | Implementation-aligned; approval pending                |
| **A6T05 — External operation identity and provider idempotency** | [ADR-0049](ADR/ADR-0049-External-Callback-and-Reference-Idempotency.md), [`A6-EXTERNAL-OPERATION-CONTRACT.md`](A6-EXTERNAL-OPERATION-CONTRACT.md), [`A6-CALLBACK-INGRESS-CONTRACT.md`](A6-CALLBACK-INGRESS-CONTRACT.md), `external-operation.entity.ts`, `external-operation-reference.entity.ts`, `external-operation.service.ts`, `external-operation.types.ts`, `external-callback-receipt.entity.ts`, `external-callback.enums.ts`, migration `1785753600026` and `1785753600027` | Distinct `Customer.id` / internal command / external-operation / provider idempotency / provider reference / callback event / journal / outbox / audit identities; normalized request hash; replay vs changed-payload         | Operation/reference/callback tests                                                                             | Implementation-aligned; approval pending                |
| **A6T06 — Callback authenticity and replay protection** | [ADR-0049](ADR/ADR-0049-External-Callback-and-Reference-Idempotency.md), [`A6-CALLBACK-INGRESS-CONTRACT.md`](A6-CALLBACK-INGRESS-CONTRACT.md), `partner-callback-authentication.service.ts`, `partner-callback-ingestion.service.ts`, `partner-callback.controller.ts`, A2-protected ingress                                                                                                                                                                                                                       | Authenticity, replay protection, freshness, schema, partner scope, reference validation, idempotent processing; A2-protected callback route                                                                       | Callback auth/ingestion tests                                                                                  | Implementation-aligned; no live callback exposure        |
| **A6T07 — External lifecycle, retry, circuit-breaker, unknown outcomes** | [ADR-0047](ADR/ADR-0047-External-Partner-Adapter-Boundary.md) and [ADR-0049](ADR/ADR-0049-External-Callback-and-Reference-Idempotency.md) inputs, `external-operation-lifecycle.service.ts`, `external-operation-lifecycle.enums.ts`, migration `1785753600028-AddExternalOperationLifecycle`                                                                                                                                                                                                                | Lifecycle state vocabulary and transition guards; bounded retry policy; circuit-breaker; provider status-verification; manual-review and hold states                                                              | Lifecycle tests                                                                                                 | Implementation-aligned; approval pending                |
| **A6T08 — Settlement, suspense, and exception ownership** | [ADR-0050](ADR/ADR-0050-Settlement-Suspense-and-Exception-Ownership.md), [`A6-SETTLEMENT-SUSPENSE-AND-EXCEPTION-CONTRACT.md`](A6-SETTLEMENT-SUSPENSE-AND-EXCEPTION-CONTRACT.md), `external-settlement.entity.ts`, `external-settlement.service.ts`, `external-settlement.types.ts`, `external-settlement.enums.ts`, `external-suspense-entry.entity.ts`, migration `1785753600029-CreateExternalSettlementTables`, `test/external-settlement.service.spec.ts`                                                                              | Single Ledger-owned settlement per verified outcome; suspense/manual-review for unmatched value; compensating entries for correction; immutable Ledger history; provider acknowledgement ≠ settlement             | Settlement/suspense tests                                                                                      | Implementation-aligned; Finance/Ledger approval pending |
| **A6T09 — Independent external reconciliation**  | [ADR-0053](ADR/ADR-0053-Independent-External-Reconciliation.md), [`A6-EXTERNAL-RECONCILIATION-CONTRACT.md`](A6-EXTERNAL-RECONCILIATION-CONTRACT.md), `external-reconciliation.service.ts`, `external-reconciliation.evaluator.ts`, `external-reconciliation.enums.ts`, `external-reconciliation.types.ts`, `test/external-reconciliation.service.spec.ts`, `reconciliation/reconciliation.module.ts` integration                                                                                          | Read-only reconciliation engine; discrepancy vocabulary; classified support trace; partner certification fingerprint; no source mutation                                                                          | Reconciliation tests                                                                                           | Implementation-aligned; approval pending                |
| **A6T10 — External-rail data minimization, consent, and disclosure** | [ADR-0052](ADR/ADR-0052-External-Rail-Data-Minimization-and-Consent.md), [`A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md`](A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md), [`A6-EXTERNAL-DATA-CLASSIFICATION-MATRIX.md`](A6-EXTERNAL-DATA-CLASSIFICATION-MATRIX.md), `external-data-minimization.{enums,types,service}.ts`, `external-data-classification.{entity,registry}.ts`, `external-consent-assertion.entity.ts`, `external-retention-classification.entity.ts`, `external-legal-hold.entity.ts`, `external-secret-classification.entity.ts`, migration `1785753600030-CreateExternalDataMinimizationTables`, `test/external-data-minimization.service.spec.ts` | Field-level classification; consent/mandate evidence; retention/legal-hold; secret handling; disclosure audience maximums; partner payload rejection; read-only contract evidence                                        | Data-minimization tests                                                                                         | Implementation-aligned; Privacy/Security approval pending |
| **A6T11 — Integration, partner certification, release gate, A7 handoff** | This documentation package: integration matrix, route/rollback, ADR review, recovery runbook, exit checklist, approval package, A7 handoff                                                                                                                                                                                                                                                                                                                | End-to-end evidence, unresolved approvals, prohibited edges, release/disable/rollback boundaries                                                                                                                  | Full repository validation recorded below                                                                     | Prepared; not approved                                  |

## 3. End-to-end implementation trace

```text
A2 authenticated principal / protected internal command context
                         |
                         v
A4 current external capability decision (capability/action, policy version, limits, obligations, expiry, evidence)
                         |
                         v
A3 internal account / funding ownership recheck
  Customer.id -> CustomerWallet -> A3 binding -> WalletAccount -> LedgerAccount
  (A3T04 verified target mapping result for the selected external target)
                         |
                         v
A6T05 external operation command
  internal command ID + externalOperationId + externalOperationReference
  + Operations idempotency scope/key/provider idempotency scope/key
  + request/correlation/trace/causation
  + normalized semantic request hash (target mapping, amount, currency, accounting unit, customer/account)
                         |
                         v
A6T02/A6T03 partner adapter and isolated transport
  approved partner/capability/version (NIBSS_NIP / external.wallet.withdrawal.settlement)
  partner-disabled-by-default connection; A2-protected secret reference; signed request envelope
  (no live partner call in the A6 implementation snapshot)
                         |
                         v
A6T07 external operation lifecycle
  CREATED -> SUBMITTING -> PENDING_VERIFICATION -> SETTLED | REJECTED | UNKNOWN | MANUAL_REVIEW
  bounded retry; circuit-breaker; provider status-verification path
                         |
                         v
A6T06 callback authenticity and replay protection
  signature/MAC + freshness; A2-protected ingress; idempotent callback processing
  callback event identity; provider reference mapping; replay/dedupe state
                         |
                         v
A6T08 settlement and exception boundary
  verified provider outcome -> exactly one balanced customer-debit / settlement-asset-credit Ledger journal
  unmatched/delayed/disputed/ambiguous value -> explicit suspense entry with named exception owner
  corrections -> new compensating Ledger journals only
                         |
                         v
A6T10 data minimization, consent, and disclosure
  A6_EXTERNAL_DATA_CONTROL audit evidence for every data-control action
  partner payload validation; secret/credential protection; retention/legal-hold
                         |
                         v
A6T09 independent read-only reconciliation
  operation / reference / callback / settlement / suspense / journal / audit / outbox / idempotency comparison
  discrepancy classification; classified support trace; partner certification fingerprint
                         |
                         v
A6 release control
  circuit-breaker + durable disable/rollback
  internal financial history preserved
```

A6 is an external-integration and settlement boundary. It does not replace A2 authentication/authorization, A3 binding, A4 policy, A5 internal lifecycle, Wallet, Ledger, Operations, or Reconciliation. A provider response, callback, statement, external reference, or suspense row cannot become financial truth without the owning boundary's verification.

## 4. Authority and ownership matrix

| Concept                          | Authoritative owner                                   | A6 integration behavior                                                                                                | Prohibited A6 behavior                                                                                                                |
| -------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical customer identity      | `customer` / `Customer.id`                            | Carry and reconcile source customer UUID                                                                                | Use reference, alias, beneficiary, funding-instrument, payment reference, provider ID, or command ID as identity                  |
| Customer wallet metadata         | `customer-wallet`                                      | Read through A3-approved binding/ownership evidence                                                                      | CustomerWallet stores external balance or provider identity                                                                            |
| A2 access                        | A2                                                    | Recheck exact principal/customer/action scope                                                                          | Provider signature, A4 allow, or beneficiary verification substitutes for A2                                                            |
| A4 policy                        | A4                                                    | Consume current decision, limits, obligations, expiry, evidence references                                            | Recompute policy precedence or mutate policy/source evidence                                                                            |
| Customer-to-account binding      | A3 `wallet` binding capability                         | Validate explicit source/target tuples read-only                                                                         | Infer, repair, reassign, or activate a binding                                                                                        |
| Funding-instrument/beneficiary   | `customer-funding-instrument` / `customer-beneficiary` | Validate ownership, verification, status, purpose, consent, expiry, currency, limit                                     | Store raw credential; mutate ownership/status to make a flow pass                                                                       |
| Wallet facade                    | Wallet                                                | Carry `WalletAccount.id` and relationship evidence                                                                       | Maintain a second balance or select an account implicitly                                                                              |
| Financial accounts and value    | Ledger                                                | Lock/post/reconcile through Ledger contracts                                                                            | Write balances, journals, or lines directly                                                                                            |
| External partner connectivity    | A6 adapter boundary                                   | Use `NIBSS_NIP` disabled-by-default partner connection; sign envelopes; no domain module calls a partner directly         | Call banks, NIBSS, providers, settlement, callbacks, or partners from Customer, Wallet, Ledger, A5, Reconciliation, or support      |
| External operation identity      | A6 external-operation boundary                         | Distinct from internal command/provider reference/journal/outbox; A6T05 contract; replay-safe                              | Provider reference, payment reference, or journal ID becomes a substitute                                                              |
| Callback authenticity/receipt    | A6 callback boundary under A2                         | A2-protected ingress; signature/MAC + freshness; idempotent processing                                                   | Accept unauthenticated callback; write financial state directly                                                                        |
| Settlement and suspense          | Ledger/Finance via A6T08                              | At most one balanced Ledger-owned settlement per verified outcome; suspense for unmatched value; compensating entries      | Provider acknowledgement is settled value; credit/debit customer before approved evidence                                            |
| Reconciliation                   | Reconciliation/Finance                                 | Independently compare provider/callback/operation/settlement/journal/audit/outbox/idempotency; classify discrepancies    | Repair source rows or authorize settlement from a report                                                                               |
| Audit/idempotency/outbox         | Operations                                            | Use shared durable services and scopes                                                                                  | Create local stores or treat outbox facts as financial truth                                                                            |
| Data minimization/consent/secret | A6T10                                                 | Field-level classification, consent, retention, legal hold, secret handling, partner payload rejection                | Persist raw credentials, signatures, customer risk notes, or unrestricted evidence into general records or observability        |
| Recovery and support             | Operations, A2, Ledger/Finance, Reconciliation by boundary | Route unknown, timeout, outage, callback, settlement, suspense, support evidence to owners                              | Clear ambiguity through dashboards, readiness, or support views; no source mutation                                                    |

## 5. Integration scenarios and evidence

| Scenario                                                                                                        | Expected result                                                                                                          | Evidence                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Current A2 authorization, A4 allow, A3 bindings, A6T05 identity, A6T07 lifecycle, A6T08 settlement, A6T09 reconciliation | One verified external operation, one balanced Ledger-owned settlement, one read-only certification report              | A2/A3/A4/A5/A6 gate, lifecycle, settlement, reconciliation tests; existing financial invariant tests |
| Adapter disabled / emergency stop / circuit-breaker open                                                       | New external admission denied; no provider request, settlement, journal, or outbox effect                                | Connection-service tests; partner capability registry tests                                          |
| Funding-instrument not verified, expired, revoked, or purpose-incompatible                                      | `FUNDING_TARGET_DENIED`; no provider request or settlement; completed history unchanged                                    | A6T04 funding-target tests                                                                          |
| Customer / wallet / ledger / currency / accounting-unit mismatch                                                | Deterministic failure with no Ledger effect or reconciliation discrepancy                                                  | Lifecycle, settlement, and reconciliation tests                                                     |
| Duplicate or replayed external command under same internal/provider idempotency scope/key                      | Original operation result with `replayed = true`; no second provider effect                                                | A6T05 reference tests                                                                                |
| Changed payload under retained internal idempotency key                                                          | Deterministic idempotency conflict; no provider call; no Ledger effect                                                      | A6T05 reference tests                                                                                |
| Unauthenticated / stale / replayed / wrong-partner callback                                                      | Callback rejected; no operation/settlement/financial state change                                                          | A6T06 callback auth/ingestion tests                                                                  |
| Provider timeout / connection failure                                                                            | Lifecycle state `PENDING_VERIFICATION` or `UNKNOWN`; no optimistic success; no blind retry                                  | A6T07 lifecycle tests                                                                                |
| Provider-accepted but unresolved outcome                                                                         | Status-verification or reconciliation path used; explicit `PENDING`/`MANUAL_REVIEW`/`RECONCILIATION_HOLD` state             | A6T07 lifecycle tests; A6T09 reconciliation tests                                                    |
| Verified external outcome missing journal / journal imbalance / currency / accounting-unit mismatch             | Deterministic failure; no settlement, suspense entry with named owner                                                     | A6T08 settlement tests                                                                                |
| Unmatched, delayed, or partially verified provider value                                                         | Suspense entry with named exception owner; no auto-clear; compensating-entry only via approved Ledger/Finance            | A6T08 settlement + suspense tests                                                                    |
| Provider reference duplicated across operations                                                                  | Deterministic provider-reference conflict; no remapping; no second settlement                                               | A6T05 reference tests; A6T09 reconciliation tests                                                    |
| Missing / duplicate / mismatched outbox / audit / idempotency evidence                                            | Read-only deterministic reconciliation discrepancy with named owner                                                        | A6T09 reconciliation tests                                                                            |
| Partner payload containing raw secret / customer identity / wallet / ledger / journal / risk / compliance / device | Deterministic partner-payload rejection with typed rejection code; audit evidence; no provider transmission                | A6T10 data-minimization tests                                                                         |
| Consent missing / expired / revoked / purpose-mismatched / jurisdiction-mismatched                                | A6T10 consent validation rejects the partner payload; no provider transmission                                            | A6T10 data-minimization tests                                                                         |
| Secret / legal hold / retention override applied                                                                 | A6T10 retention/legal-hold controls; no premature deletion; classified access                                              | A6T10 data-minimization tests                                                                         |
| Support trace request from a non-Operations / non-Reconciliation / non-Finance principal                          | A2 audience denial; no classified fields exposed; no source mutation                                                       | A6T09 reconciliation tests; A2 audience/guard tests                                                  |
| A6T10 disable / circuit-breaker / rollback control activated                                                      | New external admission denied; completed A5/Ledger/Operations/Reconciliation history preserved                              | A6 route exposure + rollback evidence ([`A6-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A6-ROUTE-EXPOSURE-AND-ROLLBACK.md)) |
| A6T11 partner certification fixture invoked                                                                       | Read-only certification fingerprint; deterministic expected vs observed checks; no live partner call                      | A6T09 reconciliation tests; certification fingerprint spec                                           |

## 6. Readiness and no-mutation evidence

- A2 authorization remains the access authority; A6 adapter admission is an additional release control.
- A4 remains the policy authority; A6 does not duplicate risk/restriction/eligibility/compliance precedence.
- A3 binding validation and A6T09 reconciliation are read-only with respect to source records.
- Ledger remains the only authority for financial accounts, journals, lines, balances, and posted value.
- External-operation rows persist identity/correlation/recovery metadata and a settlement reference; they do not calculate financial value.
- Operations owns audit, idempotency, outbox, metrics, and diagnostics; A6T10 records `A6_EXTERNAL_DATA_CONTROL` audit facts through the same shared service.
- A6T09 reconciliation never mutates any source record and never authorizes settlement.
- A6T10 partner payload validation fails closed; raw credentials, customer/wallet/ledger/journal identities, risk/compliance notes, device fingerprints, and signature-bearing values are rejected with typed rejection codes.
- A6 disable / circuit-breaker / rollback stops new external admission; it does not cancel, reverse, delete, or edit completed transactions or financial history.
- No public API, route, scheduler, broker, external event publisher, external provider, settlement, callback, notification, A7, A8, or Product Roadmap expansion is included.

## 7. Outstanding evidence and approvals

The repository contains implementation artifacts and local automated evidence, but the following are not claimed as complete:

| Evidence/decision                                                          | Current state                                              | Required owner/action                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A2 phase/route/data-exposure approval                                      | Pending                                                    | Security/Architecture/Operations review                                                |
| A3 phase/binding/read/reconciliation approval                              | Pending                                                    | Wallet/Ledger/Finance/Reconciliation review                                            |
| A4 ADR-0036 through ADR-0040 + A6T02–T04 policy profile approval              | Pending                                                    | Architecture/Product/Risk/Compliance/Security/Finance review                           |
| A6 ADR-0047, ADR-0049, ADR-0050, ADR-0051, ADR-0052 (and A6T11 register)     | Proposed / implementation-aligned                          | Architecture and accountable owners                                                    |
| **ADR-0048 — NIBSS and Bank Integration Isolation**                          | **Not authored**                                           | A6T03 follow-on must author before partner-specific transport/credential evidence      |
| Live migrations through `1785753600030-CreateExternalDataMinimizationTables` | Not claimed                                                | Database/Operations controlled apply and rollback evidence                             |
| Partner certification (NIBSS_NIP)                                          | Not claimed; only fixture-based evidence                   | Partner + Security + Architecture + Operations + Legal/Privacy review                  |
| Production deployment / emergency-stop ownership / route/data exposure      | Not claimed                                                | Operations/Release ownership                                                           |
| Finance/Ledger settlement/suspense approval                                | Pending                                                    | Finance/Ledger owners                                                                  |
| Reconciliation/support on-call ownership                                   | Pending                                                    | Operations/Reconciliation/Support                                                     |
| A7 entry approval                                                          | Out of scope                                               | A7 owners (not started by A6T11)                                                       |

## 8. Implementation-evidence vs. production-activation distinction

The A6T11 deliverables explicitly separate implementation evidence from production activation evidence:

| Evidence class                     | What it proves                                                                                                       | What it does **not** prove                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Implementation evidence**       | Source/tests/migration/contract preserve the documented ADR boundary; local automated validation passes               | Owner approval, live migration execution, partner certification, route/data exposure, production     |
| **Production activation evidence** | Operational decisions (deployment drill, controlled apply, owner sign-off, partner certification)                  | Itself — these are not source artifacts; A6T11 records the requirements but does not claim any are met |

A6T11 deliberately does not collapse the two. Every claim in this matrix and the related release documents is tagged to one of these classes, and the local validation record in [§9](#9-validation-record) is the only "PASS" claim this package makes.

## 9. Validation record

The A6 implementation snapshot was validated locally with:

```text
npm test                54 test suites passed, 414 tests passed
npm run lint            PASS
npm run build           PASS
npm run format:check    PASS
```

The validation is repository implementation evidence. It does not claim live PostgreSQL migration execution, production deployment, route exposure, partner certification, pilot activation, financial owner approval, or A6 approval.
