# ADR-0091 — B1 Commercial Payment-Term and Invoice Due-Date Extension

- **ADR ID:** ADR-0091
- **Task:** B1T12 — B1 Commercial Payment-Term and Invoice Due-Date Extension
- **Owner:** B1 Commercial Platform
- **Status:** Accepted; bounded B1T12 runtime implemented
- **Decision package:** [`docs/B1T12-ARCHITECTURE-DECISION-PACKAGE.md`](../B1T12-ARCHITECTURE-DECISION-PACKAGE.md)
- **Migration:** `1785753600051-CreateB1PaymentTermTables.ts`
- **Production payment term:** None authorized

## Context

B2F07 will require authoritative commercial payment-term and invoice due-date evidence but cannot own or calculate the customer's commercial obligation. B1 owns payment terms, canonical invoices, invoice-term selection, due-date calculation, and commercial correction evidence. A5 remains ledger/value authority, and B2 Finance remains a future read-only consumer of B1 commercial evidence.

Historical B1T05 freezes `B1InvoiceV1` and its invoice-hash semantics. The current generator assigns `issuedAt` from the execution clock after calculating the invoice hash. Its inspected replay path calls the generator again, and its generation path does not itself persist the invoice through `b1_billing_documents`. B1T12 therefore requires prospective additive issuance/binding evidence rather than mutation of the frozen invoice contract or historical records.

The architecture package evaluated elapsed, calendar, business-day, and month-end term bases; UTC instant, UTC calendar, Africa/Lagos civil, and business-calendar arithmetic; new invoice versions versus additive evidence; persistence alternatives; correction alternatives; and idempotency boundaries. This ADR finalizes the bounded v1 decisions. It does not implement runtime.

## Decision

### 1. Authority and v1 term semantics

1. B1 is the only payment-term, invoice-binding, due-date, and due-date-amendment authority.
2. B1T12 v1 supports only `ELAPSED_DAYS`.
3. Each unit is exactly 86,400 seconds under `UTC_INSTANT_ELAPSED`.
4. `termValue` is an integer from `0` through `3660` inclusive. Zero means `dueAt` equals authoritative `issuedAt`. Negative, fractional, non-numeric, unsafe, and greater values fail closed. Arithmetic overflow, invalid instants, and precision loss fail rather than wrap or clamp.
5. No production/default term, seed, bootstrap value, or automatic activation is authorized. Values such as `0`, `7`, and `30` may appear only as test/implementation fixtures absent separate production approval.

### 2. Canonical hashes

All B1T12 semantic hashes use lowercase hexadecimal SHA-256 over UTF-8 deterministic JSON. Canonical JSON recursively sorts object keys lexicographically, preserves arrays in declared semantic order, emits no insignificant whitespace, represents schema-defined absent optional fields explicitly as `null`, and uses canonical JSON numeric representation. Timestamps normalize to ISO-8601 UTC with millisecond precision (`YYYY-MM-DDTHH:mm:ss.SSSZ`).

The v1 field sets are:

- **Definition hash:** term reference/version, basis/value, effective-from/effective-to, currency, accounting unit, and complete defined commercial scope/provenance.
- **Binding decision/hash:** invoice reference/version/hash, stable issuance instant, term reference/version/hash, basis/value, calculated due instant, currency, and accounting unit.
- **Calculation hash:** issuance instant, basis, value, `UTC_INSTANT_ELAPSED`, `86400`, and resulting due instant.
- **Amendment hash:** original binding reference/hash/due instant, replacement due instant, normalized reason, effective instant, and prior evidence supersession reference.

Generated IDs, persistence/audit timestamps, correlation IDs, and random values are excluded unless a future contract version explicitly makes one semantic. Hash-schema changes require a new version and cannot reinterpret stored v1 evidence.

### 3. Payment-term lifecycle

The lifecycle is:

```text
DRAFT -> PENDING_APPROVAL -> ACTIVE
                         -> REVOKED
ACTIVE + elapsed effective window -> EXPIRED (derived)
```

Creation always produces `DRAFT` and never activates a term. `DRAFT` and `PENDING_APPROVAL` cannot bind invoices. Activation is separate and requires A2 privileged approval. `ACTIVE` is usable only inside the effective window. `EXPIRED` is time-derived and does not require a mutation solely because time passed. `REVOKED` is an explicit A2-approved retirement. Historical versions remain queryable. A used term cannot be semantically mutated; semantic changes require a new version.

Creation, activation, and revocation share `b1.payment-term.definition.idempotency.v1` with an explicit operation discriminator in each semantic request. No lifecycle-only scope is authorized.

### 4. A2 authorization

A2 `PrivilegedActionApprovalService` remains the sole privileged approval authority. Creating a `DRAFT` and prospectively binding an invoice do not require privileged approval. Activation, revocation, and due-date amendment require existing A2 request/approve/consume semantics with exact action, resource, fingerprint, status, expiry, assurance, and scope matching.

The B1T12 actions documented for exact vocabulary allocation during the subsequent runtime task are:

```text
B1_PAYMENT_TERM_ACTIVATE
B1_PAYMENT_TERM_REVOKE
B1_PAYMENT_TERM_DUE_DATE_AMEND
```

They must not reuse Finance action names. The resources are:

```text
B1_PAYMENT_TERM
  id = <paymentTermReference>/v<paymentTermVersion>

B1_PAYMENT_TERM_DUE_DATE_AMENDMENT
  id = <canonicalAmendmentReference>
```

The approval fingerprint binds operation/action, resource type/ID, semantic request hash, relevant term/binding/amendment hash, actor principal ID, effective date, and expected version where applicable. B1T12 creates no approval vault, user, role, credential, session, or B9 IAM authority.

### 5. Stable issuance and persistence orchestration

B1T12 may later add one prospective internal B1 orchestration that:

1. invokes unchanged canonical B1T05 invoice generation;
2. obtains the authoritative `B1InvoiceV1`;
3. freezes that result's `issuedAt` as stable issuance evidence;
4. persists that exact unchanged invoice through canonical `b1_billing_documents`;
5. persists immutable B1T12 term-binding and due evidence;
6. uses one transaction where existing persistence permits;
7. recovers replay/unknown outcomes through canonical invoice and binding lookup before retry; and
8. leaves existing B1T05 `generateInvoice()` and historical behavior unchanged.

A replay must return original durable issuance/binding evidence and must not call the clock-dependent generator to manufacture a replacement historical timestamp. The orchestration accepts no caller-supplied invoice snapshot, `issuedAt`, or `dueAt` as authority. It creates no second invoice table, performs no historical backfill, mutates no historical invoice JSON, and changes no `B1InvoiceV1` hash semantics.

Canonical invoice persistence remains `b1_billing_documents`. Separate additive B1-owned aggregates may persist versioned term definitions, immutable invoice bindings/due evidence, and immutable amendments. They are commercial evidence, not Finance invoices or AR records.

### 6. Commercial applicability

The v1 applicability tuple contains exactly, in semantic order: `capability`, `plan`, `subscription`, `product`, `customer`, `merchant`, and `partner`. The first four dimensions are canonical B1 key/version pairs; the last three are canonical B1 identifiers. Every dimension is nullable and null is represented explicitly in canonical JSON.

A non-null term dimension must exactly equal the corresponding canonical `B1InvoiceV1` dimension. Null means the term intentionally does not constrain that dimension; it does not establish inheritance, fallback, fuzzy or partial substitution, a specificity hierarchy, or a “most specific wins” rule. Package, bundle, entitlement, and tier fields are excluded from v1 applicability.

The complete tuple participates in the definition hash under commercial scope/provenance. ACTIVE effective ranges cannot overlap for an identical tuple. If distinct tuples nevertheless cause more than one ACTIVE/effective term to match one invoice, binding fails closed without using creation order, version, specificity, or term value.

### 7. Correction and supersession

Due-date-only correction uses append-only immutable amendment evidence. Its only replacement authority is `replacementElapsedDays`, bounded to integer `0..3660`. B1 calculates `replacementDueAt = originalIssuedAt + replacementElapsedDays × 86400 seconds` under `UTC_INSTANT_ELAPSED`. Caller-supplied replacement timestamps and new replacement term definitions are prohibited.

The amendment persists the original binding reference/hash/due date/issuedAt, replacement value, derived replacement due date, reason, effective time, A2 provenance, hash, and supersession relationship. The frozen result-oriented amendment hash continues to include `replacementDueAt` rather than `replacementElapsedDays`: for one original authoritative issuance instant, bounded integer elapsed-second addition is injective, so the result uniquely commits to the input. The input remains explicit amendment provenance.

Due-date-only correction uses append-only immutable amendment evidence. The original binding and due instant remain immutable and queryable. Each amendment records the prior binding/evidence reference and hash, original and replacement due instants, reason, effective instant, actor/control evidence, deterministic hashes, and an explicit supersession relationship.

B1T12 v1 prohibits mutable overwrite and does not use void-and-reissue. An amendment cannot change invoice amount, currency, accounting unit, customer, or other frozen invoice content.

### 8. Exact idempotency scopes

B1T12 uses only:

```text
b1.payment-term.definition.idempotency.v1
b1.payment-term.invoice-binding.idempotency.v1
b1.payment-term.due-date-amendment.idempotency.v1
```

The shared Operations `IdempotencyService` remains the only idempotency authority. Generated UUIDs and execution timestamps do not contaminate semantic request hashes. Identical semantic requests replay original durable results; same-key semantic changes conflict; unknown outcomes recover through canonical lookup. No fourth B1T12 scope is authorized.

### 9. Read-only B2F07 consumer

A later B1T12 runtime task will expose an internal composed read-only lookup by canonical invoice reference/version. It must provide canonical invoice identity/version/hash/state, stable issuance evidence, term identity/version/hash/basis/value/effective status, authoritative due evidence and calculation hash, currency/unit, supersession status/history, and commercial/audit/idempotency/correlation/causation provenance.

The port exposes no Finance mutation. B2F07 must consume the result and must not calculate or redefine the due date.

## Repository convention differences recorded

1. Historical ADR-0064 describes B1T05 documents as durable and replay returning the durable original. The inspected current repository generation/replay path does not save generated invoices and regenerates execution-derived fields on replay. B1T12 does not rewrite B1T05; the prospective orchestration supplies additive stable evidence for B1T12-issued invoices only.
2. Existing repository hashes commonly use SHA-256 and JSON payloads, but canonical key sorting is not universal. B1T12 must use the stricter deterministic JSON contract above without changing historical hash implementations.
3. Existing controlled Finance/A5 operations use uppercase domain/action names, exact A2 resources/fingerprints, serializable transactions, and pessimistic locks where required. B1T12 follows those conventions but allocates B1 action names and must not reuse Finance actions.
4. Existing shared idempotency records use a unique `(scope, key)` boundary and pessimistic locking. B1T12 reuses this authority and does not create a parallel store.

## Consequences

- Commercial due-date evidence is deterministic and historically reproducible without changing frozen `B1InvoiceV1`.
- Zero-day terms are representable but are not production-authorized merely by being valid in the technical range.
- No business-calendar, holiday, local-midnight, month-end, or Africa/Lagos civil-time dependency is introduced.
- Payment terms cannot be used before separate A2-approved activation and effective-date admission.
- Due-date corrections preserve original evidence through an append-only chain.
- B2F07 receives a future read-only evidence boundary but remains unimplemented and blocked.
- A later B1T12 runtime will require a migration for additive aggregates if implementation confirms the documented persistence design; this architecture task creates none.

## Alternatives rejected

- `CALENDAR_DAYS`, `BUSINESS_DAYS`, `END_OF_MONTH`, local-time, or civil-calendar arithmetic in v1.
- Production term defaults, seeds, inferred Net terms, or automatic activation.
- Mutation or renumbering of `B1InvoiceV1` or its historical hash semantics.
- In-place historical invoice augmentation or retrospective backfill.
- A second invoice table, Finance-owned invoice, Finance-owned term, or caller-supplied canonical snapshot.
- Mutable due-date overwrite or void-and-reissue in B1T12 v1.
- A new approval system, idempotency system, public API, B9 IAM surface, or additional idempotency scope.
- B2F07, B2F08, B2F09, Treasury, reporting, statements, C-platform, Frontend, D1, or E1–E6 implementation.

## Remaining review and activation gates

The five B1T12 architecture blockers are resolved. The following remain outside this decision:

- the first real production term value/applicability/effective window and commercial approval;
- exact retention duration, pending Commercial/Finance/Tax/Legal/Privacy/Compliance/Audit review; legal hold must remain preservable;
- any future term basis or calendar semantics;
- any historical backfill, public/admin surface, or production rollout;
- production activation and operational validation under an explicitly approved real term; and
- B2F07 entry approval after both B1T12 and the A5/B2F03 track converge, followed by explicit `B2F07 = GO`.

## Implemented runtime artifacts

- `src/policy/b1-payment-term.types.ts`
- `src/policy/b1-payment-term.entity.ts`
- `src/policy/b1-payment-term.service.ts`
- `src/policy/b1-payment-term.module.ts`
- `src/migrations/1785753600051-CreateB1PaymentTermTables.ts`
- `test/b1-payment-term.contract.spec.ts`
- `test/b1-payment-term.service.spec.ts`

The migration creates only `b1_payment_terms`, `b1_invoice_payment_term_bindings`, and `b1_due_date_amendments`. Canonical invoices continue in `b1_billing_documents`. No production term or historical backfill is included.

## Verification

- [x] Five remaining architecture decisions finalized.
- [x] Previously approved `ELAPSED_DAYS`/86,400-second/UTC-instant/additive-evidence decisions preserved.
- [x] Exactly three B1T12 idempotency scopes frozen.
- [x] No production term authorized.
- [x] `B1InvoiceV1`, B1T03, B1T05, A5T11, B2F03–B2F06, B2F09-PRE, and historical B2 tasks unchanged.
- [x] Bounded internal runtime, migration, and focused tests implemented without any production term, historical backfill, AR, public API, or later-platform behavior.
- [x] B2F07 remains blocked.
