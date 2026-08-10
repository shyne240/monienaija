# B1T12 Architecture Decision Package

- **Task:** B1T12 — B1 Commercial Payment-Term and Invoice Due-Date Extension
- **Owner:** B1 Commercial Platform
- **ADR:** ADR-0091 — finalized architecture decision; runtime not implemented
- **Package status:** FINALIZED — AUTHORITATIVE FOR SUBSEQUENT B1T12 IMPLEMENTATION
- **Runtime status:** BLOCKED — no B1T12 runtime is authorized by this package
- **B2F07 status:** BLOCKED
- **Scope:** Architecture decision package only

The architecture decisions in this document are finalized by ADR-0091 for a subsequent, separately authorized B1T12 runtime task. This package defines architecture only: it does not activate a production payment term, implement runtime behavior, create a migration, or modify any historical contract.

## 1. Current repository facts

### 1.1 Roadmap and authority facts

The permanent platform order remains unchanged:

```text
A1 Identity
A2 Authorization
A3 Customer Binding
A4 Policy
A5 Ledger & Internal Financial Core
A6 External Partners & Settlement
A7 Product Layer

B1 Commercial Platform
B2 Finance Platform
B3 Treasury Platform
B4 Fraud & AML
B5 Merchant Platform
B6 Reporting Platform
B7 Statement Platform
B8 Configuration Platform
B9 Identity & Access Administration
B10 Developer & Integration Platform

C1 Infrastructure & Provider Integrations
C2 Observability Platform
C3 Data Platform
C4 Document Platform
C5 Secrets & Key Management
C6 Background Processing
C7 Search Platform

Frontend

D1 Scale & Selective Extraction

E1 Foreign Exchange
E2 Card
E3 Lending
E4 Savings & Investment
E5 Insurance
E6 International Remittance
```

B1 is the authority for commercial payment terms, invoice-term selection, due-date calculation, due-date evidence, and commercial provenance. A5 remains the sole authority for ledger-account identity, posting, value, balances, invariants, and reversals. B2F03 owns Finance-to-A5 mapping metadata only. B2F04 owns Finance accounting-period admission. B2F05 owns Finance journal governance and controlled A5 posting. B2F06 owns Finance control policy. B2F07 must consume B1 evidence read-only and must not calculate a commercial due date.

B1T03 and B1T05 are completed historical tasks. B1T12 is a new extension and must not rewrite or reopen either task. A5T11 and ADR-0090 are outside B1T12. The historical B2T01–B2T10 artifacts and B2F09-PRE remain unchanged. B2T11 and B2T12 must not be revived.

### 1.2 Existing B1 invoice contract

`B1InvoiceV1` in `src/policy/b1-billing-engine.types.ts` is explicitly documented as frozen by historical B1T05. It contains, among other fields:

- canonical invoice identity and version;
- invoice state, hash, and replay hash;
- customer, merchant, partner, product, capability, plan, subscription, package, bundle, entitlement, and tier provenance;
- amount, currency (`NGN`), and accounting unit (`CUSTOMER_FUNDS`);
- `issuedAt`;
- idempotency, audit, correlation, causation, and trace evidence.

It contains no payment-term reference/version/hash, due date, or due-date-calculation hash. Its version vocabulary is currently fixed to version `1`.

`B1BillingEngineRepository.generateInvoice()` currently:

1. validates the request;
2. calculates a semantic invoice request hash;
3. creates random execution identifiers and trace identifiers;
4. calculates `invoiceHash` from commercial and amount fields;
5. calculates `invoiceReplayHash` from the invoice hash, request hash, idempotency key, and correlation ID;
6. assigns `issuedAt` using `new Date().toISOString()` only when constructing the returned invoice.

`issuedAt` does **not** participate in the current `invoiceHash`. The generated invoice uses an ISO-8601 UTC instant representation, but that representation alone does not establish payment-term arithmetic or a commercial calendar.

### 1.3 Existing replay behavior

The B1 invoice idempotency scope is `b1.billing-engine.invoice.idempotency.v1`. The shared Operations `IdempotencyService` is the only idempotency authority.

On an idempotency replay, the current B1T05 path calls `generateInvoice()` again. Therefore it recalculates execution-generated values, including `issuedAt`, instead of loading original durable invoice evidence. The deterministic invoice number and invoice hash can remain stable because their current hash inputs exclude `issuedAt`, but the returned invoice object is not a byte-for-byte historical replay.

This package does not characterize that historical behavior as a B1T05 defect to be repaired in place. It records the behavior because B1T12 cannot derive historically reproducible due-date evidence from a newly generated replay timestamp.

### 1.4 Existing persistence and read behavior

Historical B1T05 created the `b1_billing_documents` table, `B1BillingDocument` entity, and these canonical reads:

```text
B1BillingEngineService.getPersistenceRecordByReference()
B1BillingEngineService.getPersistenceRecordByIdempotencyKey()
B1BillingEngineService.listPersistenceRecords()
```

The table has JSONB document storage and relational reference/hash/idempotency/provenance fields. Its database constraints and TypeScript contracts currently admit document version `1` and the historical B1T05 document kinds.

The inspected B1 billing repository exposes reads from `b1_billing_documents`, but its invoice generation/replay path does not call `save`, `insert`, or `upsert` on that repository. Consequently:

- a normally generated invoice is not durably inserted by that path;
- `getPersistenceRecordByReference()` can return an original invoice only if a record was written by some separate mechanism;
- the current generation/replay path does not itself guarantee that the original `issuedAt` is available from the canonical read.

No second B1 invoice table or Finance invoice authority exists.

### 1.5 Existing time evidence

B1 contracts use ISO-8601 timestamps. Existing commercial replay rules explicitly describe an `issuedAt + 86400s` replay window. That is evidence that B1 can represent instants and deterministic elapsed-second windows. It is **not** evidence that a commercial payment obligation should use elapsed 24-hour days, UTC calendar days, Africa/Lagos civil days, business days, or month-end adjustment.

No authoritative B1 holiday calendar, business-day calendar, payment-term calendar, or payment-term timezone was found. The B2 Finance fiscal calendar is not a B1 commercial calendar and must not be imported implicitly.

### 1.6 Existing B1T12 allocation facts

The B2F07 prerequisite package predates this finalization and records the original entry blockers. It states that:

- no term basis or term value is approved;
- the future task must define a closed reviewed term-basis vocabulary;
- UTC versus applicable commercial civil time requires explicit approval;
- exact B1T12 idempotency scopes require review;
- correction/supersession mechanism requires review;
- one bounded payment-term definition is currently listed as a B1T12 exit criterion;
- no fallback/default term is allowed.

ADR-0091 is allocated to B1T12 and is authored with this finalization package. It accepts these architecture decisions while explicitly recording that B1T12 runtime is not implemented by this documentation task.

## 2. Finalized B1T12 blocker decisions

| #   | Finalized decision                           | Authoritative disposition                                                                                                    |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Closed payment-term-basis vocabulary         | `ELAPSED_DAYS` only.                                                                                                         |
| 2   | Due-date arithmetic and timezone/calendar    | `UTC_INSTANT_ELAPSED`; exactly 86,400 seconds per unit.                                                                      |
| 3   | Stable canonical invoice issuance evidence   | Prospective additive orchestration persists unchanged `B1InvoiceV1` plus stable binding evidence; historical methods remain. |
| 4   | Payment-term and invoice-binding persistence | `b1_billing_documents` remains invoice authority; additive B1 term/binding/amendment aggregates are permitted.               |
| 5   | Correction/supersession                      | Append-only due-date amendment evidence; no overwrite or void/reissue in v1.                                                 |
| 6   | Dedicated idempotency scopes                 | Exactly the three scopes in §8; lifecycle operations share the definition scope with an operation discriminator.             |
| 7   | Bounded term value                           | Integer `0..3660`; test fixtures only absent separate production approval.                                                   |

## 2A. Five final architecture decisions

### 2A.1 Decision A — term-value bounds

**FINALIZED — AUTHORITATIVE FOR B1T12:** `termValue` is a JSON/TypeScript integer from `0` through `3660` inclusive. Zero is permitted and means the authoritative `dueAt` equals the authoritative `issuedAt`. Negative, fractional, non-numeric, unsafe, and greater-than-3660 values fail closed. Arithmetic must detect an invalid instant, overflow, or loss of integer precision and reject rather than wrap or clamp. This is an implementation bound, not approval for any production commercial term. No default or seed is authorized.

### 2A.2 Decision B — canonical hash contract

**FINALIZED — AUTHORITATIVE FOR B1T12:** All B1T12 semantic hashes use SHA-256 over UTF-8 deterministic JSON and are encoded as lowercase hexadecimal. Canonical JSON recursively sorts object keys lexicographically, preserves arrays in declared semantic order, emits no insignificant whitespace, represents schema-defined absent optional values explicitly as `null`, and uses canonical JSON numeric representation. Timestamps are normalized to ISO-8601 UTC with millisecond precision (`YYYY-MM-DDTHH:mm:ss.SSSZ`). Equivalent numeric values must have one canonical textual form.

The separate frozen field sets are:

1. **Payment-term definition hash:** `paymentTermReference`, `paymentTermVersion`, `termBasis`, `termValue`, `effectiveFrom`, `effectiveTo` (explicit null when open-ended), `currency`, `accountingUnit`, and the complete defined commercial scope/provenance object. It excludes generated UUIDs, creation/update timestamps, audit timestamps, correlation IDs, and random values.
2. **Invoice-binding decision/hash:** `invoiceReference`, `invoiceVersion`, `invoiceHash`, stable `issuedAt`, `paymentTermReference`, `paymentTermVersion`, `paymentTermDefinitionHash`, `termBasis`, `termValue`, calculated `dueAt`, `currency`, and `accountingUnit`.
3. **Due-date calculation hash:** stable `issuedAt`, `termBasis`, `termValue`, `arithmeticRule` equal to `UTC_INSTANT_ELAPSED`, `secondsPerDay` equal to `86400`, and calculated `dueAt`.
4. **Amendment hash:** `originalBindingReference`, `originalBindingHash`, `originalDueAt`, `replacementDueAt`, normalized amendment `reason`, amendment `effectiveAt`, and `supersedesEvidenceReference`. The supersession reference identifies the prior binding or amendment being superseded; it is not a generated reference to the new record.

Generated IDs, persistence/audit timestamps, correlation IDs, and random values are excluded unless a future version explicitly makes one semantic. Hash schemas are versioned; field-set changes require a new hash/contract version and cannot reinterpret stored v1 hashes.

### 2A.3 Decision C — payment-term lifecycle

**FINALIZED — AUTHORITATIVE FOR B1T12:** The lifecycle is `DRAFT -> PENDING_APPROVAL -> ACTIVE`, with explicit terminal `REVOKED` and time-derived `EXPIRED`. Creation always creates `DRAFT`; creation never activates. `DRAFT` and `PENDING_APPROVAL` cannot bind an invoice. Activation is a separate A2-approved operation. `ACTIVE` is eligible only inside its effective window. `EXPIRED` is derived when the effective window has ended and does not require a time-triggered mutation. `REVOKED` is an explicit A2-approved retirement. Historical versions remain queryable. A used term cannot be semantically mutated; semantic change requires a new version.

Creation, activation, and revocation use only `b1.payment-term.definition.idempotency.v1`, differentiated by a required semantic operation discriminator. No lifecycle idempotency scope may be added. An activation/revocation approval binds term reference/version/hash, requested lifecycle action, effective dates, actor/resource context, semantic request hash, and expected version.

### 2A.4 Decision D — A2 authorization contract

**FINALIZED — AUTHORITATIVE FOR B1T12:** A2 `PrivilegedActionApprovalService` remains the only privileged approval authority. Payment-term creation as `DRAFT` and prospective invoice binding do not require privileged approval. Activation, revocation, and due-date amendment do require request/approve/consume semantics with exact resource and fingerprint matching. No B1 approval vault, IAM role, user, credential, session, or B9 behavior is authorized.

Repository convention uses uppercase domain/action verbs such as `FINANCE_ACCOUNT_MAPPING_ACTIVATE` and binds an exact resource/fingerprint. The following B1T12 action names are documented for allocation in the subsequent runtime task and must not be replaced with Finance actions:

```text
B1_PAYMENT_TERM_ACTIVATE
B1_PAYMENT_TERM_REVOKE
B1_PAYMENT_TERM_DUE_DATE_AMEND
```

Resource contracts are:

```text
activation/revocation resource type: B1_PAYMENT_TERM
activation/revocation resource id:   <paymentTermReference>/v<paymentTermVersion>
amendment resource type:             B1_PAYMENT_TERM_DUE_DATE_AMENDMENT
amendment resource id:               <canonicalAmendmentReference>
```

The approval fingerprint canonical payload includes operation/action, resource type, resource ID, semantic request hash, relevant definition/binding/amendment hash, actor principal ID, effective date, and expected version where applicable. The runtime must use existing A2 request/consume behavior and must fail closed on action, resource, actor/context, fingerprint, status, expiry, assurance, or scope mismatch. The three action names are the only remaining implementation-task vocabulary allocations; this documentation task does not add them to runtime types.

### 2A.5 Decision E — stable invoice-persistence orchestration

**FINALIZED — AUTHORITATIVE FOR B1T12:** A prospective internal B1T12 orchestration may invoke unchanged canonical B1T05 generation, obtain `B1InvoiceV1`, freeze its generated `issuedAt` as stable issuance evidence, persist that exact unchanged invoice through canonical `b1_billing_documents`, and persist the immutable term binding/due evidence. Where existing persistence permits, invoice and binding writes occur in one transaction using established serializable/locking and shared-idempotency patterns.

The operation must first recover by canonical invoice/binding lookup on replay or uncertain outcome. It must never call the clock-dependent generator again and treat a new timestamp as truth for an already persisted semantic invoice. Existing `generateInvoice()` and historical replay behavior remain unchanged and available; the new operation is prospective and additive. It accepts neither a caller-supplied invoice snapshot nor caller-supplied `issuedAt`/`dueAt` as authority. It performs no historical backfill, invoice JSON mutation, invoice hash change, or second invoice-table creation.

## 3. Decision 1 — term basis

### 3.1 Candidate: `ELAPSED_DAYS`

**Arithmetic semantics:** Add `termValue × 86,400` SI seconds to the canonical invoice issuance instant. The result remains an instant. An integer from `0` through `3660` inclusive is required, and arithmetic overflow or invalid results fail closed. This option must not be described as a civil-calendar or business-day promise.

**Weekends/holidays:** Irrelevant. Every elapsed 24-hour interval counts.

**Timezone dependence:** None for arithmetic. Inputs and output can be normalized to UTC ISO-8601 instants. Display timezone is not part of calculation.

**Reproducibility:** High when the original issuance instant, exact term version/hash, arithmetic version, and result are immutable.

**Effect on issued invoices:** Existing invoices cannot acquire a term retrospectively by inference. Only a prospective B1T12 binding may establish the issuance instant and selected term used for calculation.

**Effect on future AR aging:** B2F07 can compare its authoritative evaluation instant with the immutable B1 `dueAt`, but must not recalculate the due date. Aging cutoff policy remains a B2 Finance concern and must not redefine the commercial obligation.

**Compatibility:** Technically compatible with B1 instant representation and existing evidence that elapsed-second windows can be represented. Existing replay-window semantics support technical feasibility only; they do not approve this commercial meaning.

### 3.2 Candidate: `CALENDAR_DAYS`

**Arithmetic semantics:** Advance a local calendar date by `termValue` dates while preserving or separately defining a civil time-of-day and handling nonexistent/duplicated local times.

**Weekends/holidays:** Weekends and holidays count, but date boundaries matter.

**Timezone dependence:** Required. `UTC_CALENDAR_DAYS` and `AFRICA_LAGOS_CALENDAR_DAYS` are different contracts even when many results coincide.

**Reproducibility:** High only if the calendar system, IANA timezone identifier, time-of-day rule, timezone database/version strategy, and ambiguity rules are frozen in calculation evidence.

**Effect on issued invoices:** Cannot be retrofitted safely without original selected-term evidence and a frozen civil-time rule.

**Effect on future AR aging:** Gives a civil-date obligation useful for customer communication, but B2F07 still needs an unambiguous instant or an approved cutoff rule for aging.

**Compatibility:** B1 stores ISO instants but has no approved commercial civil calendar. Additional authority and semantics are required.

### 3.3 Candidate: `BUSINESS_DAYS`

**Arithmetic semantics:** Advance across dates classified as open business days by a versioned calendar, with an explicit inclusion/exclusion rule for issuance day and an explicit due-time rule.

**Weekends/holidays:** Material. Weekends, public holidays, exceptional closures, and calendar corrections must be authoritative and versioned.

**Timezone dependence:** Required because business dates require a jurisdictional/civil timezone.

**Reproducibility:** Possible only with an immutable business-calendar reference/version/hash and historical calendar retention. Recalculating from a current holiday list is prohibited.

**Effect on issued invoices:** Calendar corrections cannot silently rewrite due dates already issued. Original calendar evidence must remain available.

**Effect on future AR aging:** B2F07 consumes the resulting due evidence only. It must not maintain a duplicate commercial holiday calendar.

**Compatibility:** No B1 business-calendar authority exists. Introducing one would materially expand B1T12 and its dependencies.

### 3.4 Candidate: `END_OF_MONTH`

**Arithmetic semantics:** Move to a defined month boundary, potentially after adding a month offset. The contract must define same-month versus following-month behavior, due time, short-month handling, and timezone.

**Weekends/holidays:** Irrelevant unless combined with a following/preceding-business-day adjustment, which would add a business-calendar dependency.

**Timezone dependence:** Required because month end is a civil-calendar concept.

**Reproducibility:** High only after freezing timezone, offset, boundary, due-time, and adjustment semantics.

**Effect on issued invoices:** Existing invoices cannot infer an end-of-month obligation. Any correction must preserve original evidence.

**Effect on future AR aging:** B2F07 consumes the resulting due evidence. It cannot infer month-end behavior itself.

**Compatibility:** B1 has no approved payment month-end rule. This is more semantically complex than required for the first bounded authority.

### 3.5 Finalized decision

**FINALIZED — AUTHORITATIVE FOR B1T12:** Freeze the B1T12 v1 closed vocabulary to `ELAPSED_DAYS` only. Define it explicitly as exact elapsed 24-hour intervals, not civil dates and not business days. Permit integer values from `0` through `3660` inclusive; reject negative, fractional, non-numeric, unsafe, or greater values. Zero means `dueAt` equals the authoritative issuance instant. A later semantic basis requires a new contract/calculation version and, where applicable, an authoritative calendar dependency.

This is the least invasive technical option because it needs no new calendar authority and can produce one unambiguous instant. The bounded technical range does not authorize any production `termValue`, default, seed, or production activation.

## 4. Decision 2 — due-date/time semantics

### 4.1 UTC instant arithmetic

Normalize the canonical `issuedAt` to an unambiguous instant and add an exact duration. For finalized `ELAPSED_DAYS`, the formula would be:

```text
dueAt = issuedAtInstant + (termValue × 86,400 seconds)
```

This is deterministic across machines and does not depend on timezone database rules. The authoritative output should be named `dueAt`, represented as canonical ISO-8601 UTC with millisecond precision. A date-only field may be derived for display but must not replace the instant.

### 4.2 UTC calendar-day arithmetic

Convert `issuedAt` to a UTC calendar date, advance calendar dates, then apply a specified UTC due time. This differs from elapsed arithmetic whenever the due-time rule does not preserve the issuance time. It requires explicit rules for due time and date inclusion.

### 4.3 Africa/Lagos civil-calendar arithmetic

Convert `issuedAt` into Africa/Lagos civil time, advance local dates, apply a defined local due time, and convert back to an instant. This may be commercially appropriate, but no B1 contract currently establishes it. Business location and B2 fiscal behavior are not sufficient approval.

### 4.4 Business-day arithmetic

Resolve dates through an authoritative versioned business calendar and timezone. This is the most dependency-heavy option and cannot be approximated by skipping Saturday/Sunday because holidays and exceptional closures remain unresolved.

### 4.5 Calculation evidence required by any option

The deterministic calculation hash must cover a canonical serialization of at least:

```text
calculationContractName
calculationContractVersion
termBasis
termValue
paymentTermReference
paymentTermVersion
paymentTermDefinitionHash
invoiceReference
invoiceVersion
invoiceHash
issuedAt
timezoneRule
calendarReference/version/hash (or explicit null)
dueAt
```

It excludes random IDs, execution-generated persistence timestamps, audit record IDs, and replay flags. ADR-0091 freezes SHA-256, UTF-8 deterministic JSON, UTC millisecond timestamp normalization, and the exact field sets in §2A.2.

### 4.6 Finalized decision

**FINALIZED — AUTHORITATIVE FOR B1T12:** For v1 `ELAPSED_DAYS`, adopt UTC instant representation and elapsed-second arithmetic. Canonicalize both `issuedAt` and `dueAt` as UTC ISO-8601 instants with millisecond precision; set the calculation timezone rule to an explicit `UTC_INSTANT_ELAPSED` contract value; set calendar reference/version/hash to null; and never call this result calendar-day or business-day arithmetic.

Repository evidence supports feasibility and determinism, not automatic approval. Architecture must explicitly approve the commercial meaning.

## 5. Decision 3 — stable invoice issuance evidence

### 5.1 Verified current behavior

- `issuedAt` is generated during `generateInvoice()` using the execution clock.
- `issuedAt` is not an input to the historical B1T05 `invoiceHash`.
- the inspected generation/replay path does not durably save its generated invoice;
- replay calls `generateInvoice()` again and can return a new `issuedAt` and random execution identifiers;
- `getPersistenceRecordByReference()` returns stored JSON when a row exists, but the generation path does not guarantee such a row;
- therefore the existing path does not guarantee retrieval of the original `issuedAt`;
- directly changing `B1InvoiceV1`, its hash, or its replay semantics would change historical B1T05 behavior.

### 5.2 Option A — new invoice contract version

Create `B1InvoiceV2` with term and due-date fields inside the invoice and include `issuedAt` in a revised invoice hash.

**Benefits:** Strong single-document semantics; term evidence can be intrinsic to the invoice.

**Consequences:** Requires version-vocabulary, persistence-constraint, consumer, migration, and compatibility changes. It introduces the largest compatibility surface and risks reopening historical B1T05 rather than adding a bounded extension.

**Authority boundary:** Remains B1-owned but changes the canonical invoice contract.

### 5.3 Option B — additive immutable invoice issuance/binding evidence

Keep `B1InvoiceV1` and its historical hash unchanged. B1T12 creates a distinct immutable extension record that references the exact canonical invoice reference/version/hash and freezes:

- the original `issuedAt` selected during the prospective B1T12 issuance operation;
- selected payment-term reference/version/hash;
- deterministic `dueAt` and calculation hash;
- commercial provenance and audit/idempotency evidence.

The B1T12 orchestration must obtain the invoice from the canonical B1 invoice service internally. It must not accept a caller-supplied invoice snapshot, invoice hash, `issuedAt`, or due date as authority. The operation must durably preserve the exact generated canonical invoice through the existing B1 billing persistence authority and atomically preserve or recover the binding evidence before reporting success.

**Benefits:** Preserves the frozen invoice shape/hash; confines new semantics to B1T12; enables immutable historical evidence.

**Consequences:** Consumers need a composed read. The extension record must not masquerade as another invoice or permit a different invoice amount/state. Atomicity and unknown-outcome recovery must be designed carefully.

**Authority boundary:** Extends B1 commercial evidence without creating a Finance invoice or second calculation authority.

### 5.4 Option C — in-place augmentation of historical JSON

Update existing stored `B1InvoiceV1` JSON after generation to add term fields without changing the declared contract/version.

**Benefits:** Superficially simple read shape.

**Consequences:** Mutates a frozen historical contract, breaks type/hash correspondence, and risks silently rewriting issued evidence.

**Authority boundary:** B1-owned but violates historical preservation.

### 5.5 Finalized decision

**FINALIZED — AUTHORITATIVE FOR B1T12:** Select Option B. Preserve `B1InvoiceV1` and its historical hash unchanged. Add B1T12-owned immutable issuance/binding evidence, and expose a composed B1 read. The prospective B1T12 issuance operation must freeze one canonical `issuedAt`, durably store the unchanged canonical invoice in the existing B1 billing persistence authority, and bind the payment term to that exact invoice reference/version/hash/issuedAt. Replay must read original durable evidence rather than call the clock-dependent generation path to manufacture new issuance evidence.

This decision does not authorize a repair or rewrite of historical B1T05 records. Existing invoices without B1T12 evidence remain unbound and cannot be assigned a term by inference.

## 6. Decision 4 — payment-term and invoice-binding persistence

### 6.1 Option A — extend canonical B1 billing persistence only

Store payment-term definitions and bindings as additional document kinds in `b1_billing_documents`, requiring changes to historical kind constraints and unions.

**Benefits:** One physical table and existing by-reference access patterns.

**Consequences:** Conflates invoice documents with commercial configuration; expands a frozen B1T05 schema; makes independent term version/effective-date queries awkward; increases migration and compatibility risk.

### 6.2 Option B — additive immutable B1-owned payment-term and binding records

Create, during later authorized runtime work:

- one B1-owned versioned payment-term-definition persistence surface; and
- one B1-owned immutable invoice-payment-term-binding persistence surface, with an additive amendment chain if approved under Decision 5.

The binding references the canonical invoice; it does not reproduce or control invoice amount/state and is not a second invoice. Canonical B1 invoice storage remains `b1_billing_documents`. The payment-term service is the single term-definition authority, and the binding service is the single invoice-term/due-evidence authority.

**Benefits:** Clear aggregate boundaries; independent effective dating/version lookup; immutable evidence; no B1T05 schema mutation; bounded B1T12 migration.

**Consequences:** Adds B1-owned tables and a composed read transaction/query. Referential and atomic issuance rules require care.

### 6.3 Option C — place binding fields only in payment-term definitions

Record which invoice selected a term inside the term aggregate.

**Benefits:** Fewer aggregate types.

**Consequences:** Creates unbounded mutable collections, couples definition lifecycle to invoices, undermines immutable term definitions, and makes invoice-by-reference lookup inefficient.

### 6.4 Option D — Finance-owned copy as authority

Have B2F07 persist the first authoritative binding/due date.

**Consequences:** Violates the authority boundary, duplicates commercial calculation, and allows Finance to define the customer obligation.

### 6.5 Finalized decision

**FINALIZED — AUTHORITATIVE FOR B1T12:** Select Option B. Use bounded, additive, B1-owned persistence for versioned term definitions and immutable invoice bindings. Continue using `b1_billing_documents` as the canonical invoice persistence authority; do not create a second invoice table. The B1T12 binding must contain references and evidence, not a caller-supplied invoice snapshot.

Expose an internal read-only B1T12 consumer port with a method equivalent to:

```text
getInvoicePaymentTermEvidence(invoiceReference, invoiceVersion)
```

It returns canonical invoice identity/version/hash/state, amount/currency/unit, stable `issuedAt`, exact term reference/version/hash/status/effective window, `dueAt`, calculation hash, commercial provenance, and immutable audit/idempotency/correlation/causation references. Internally it composes the canonical B1 invoice persistence read and B1T12 binding read and fails closed on missing, duplicate, mismatched, superseded-without-resolution, or drifted evidence. It exposes no mutation method to B2 Finance.

## 7. Decision 5 — correction and supersession

### 7.1 Option A — new invoice version

**Historical reproducibility:** Strong if every version remains immutable.

**Accounting consequences:** B2F07 must correlate receivable consequences across invoice versions and distinguish replacement from amendment.

**Commercial authority:** B1 owns the new version, but the current invoice version vocabulary and database constraint are fixed to `1`.

**Audit trail:** Strong with explicit supersedes/superseded-by links.

**Effect on B2F07:** Requires version transition semantics before AR can safely react.

**Effect on issued invoices:** Replaces the broader invoice contract, potentially affecting amounts/content beyond due date.

### 7.2 Option B — void and reissue

**Historical reproducibility:** Strong when original and replacement remain immutable.

**Accounting consequences:** Can require reversal/cancellation and new AR treatment; B1 must not post or reverse A5 value.

**Commercial authority:** Consistent with B1 owning invoice state, but current runtime semantics for authoritative void/reissue are not established by B1T12.

**Audit trail:** Clear when void reason and replacement reference are explicit.

**Effect on B2F07:** B2F07 must close/cancel old receivable treatment and create or correlate replacement treatment under approved Finance controls.

**Effect on issued invoices:** Destructive from the customer's operational perspective and excessive for a due-date-only correction.

### 7.3 Option C — additive due-date amendment evidence

Preserve original invoice and original binding. Add an immutable B1 commercial amendment linked to the prior binding/amendment, with reason, approval, new term reference/version/hash where applicable, new due date, calculation hash, effective timestamp, and audit/correlation evidence.

**Historical reproducibility:** Strong because original and every amendment remain queryable.

**Accounting consequences:** Does not itself post, reverse, or adjust value. B2F07 consumes the effective amendment and records its own controlled AR status/aging consequences.

**Commercial authority:** Correctly remains in B1 because it changes the commercial payment obligation.

**Audit trail:** Explicit append-only chain; no silent rewrite.

**Effect on B2F07:** Read port must expose original evidence, ordered amendment chain, and one unambiguous currently effective result. B2F07 must not author amendments.

**Effect on issued invoices:** Preserves original invoice content and records a distinct commercial due-date correction.

### 7.4 Option D — mutable overwrite

Update the original binding in place.

**Consequences:** Destroys historical reproducibility, weakens audit, and can desynchronize B2F07. It is incompatible with the stated requirements.

### 7.5 Finalized decision

**FINALIZED — AUTHORITATIVE FOR B1T12:** Select Option C for due-date-only corrections: an additive immutable amendment chain under B1 authority. Require explicit reason, authorization/approval reference, expected prior evidence hash, and idempotency. Never overwrite the original binding. The consumer read must resolve exactly one effective result and expose the full chain for verification.

B1T12 v1 does not implement void-and-reissue. Any future canonical invoice cancellation/replacement requires a separately approved B1 invoice-state workflow outside this task. A due-date amendment cannot change invoice amount, currency, accounting unit, customer, or other invoice content.

## 8. Decision 6 — idempotency scopes

The shared Operations `IdempotencyService` remains the only idempotency authority. B1T12 needs separate scopes only where operations have distinct semantic payloads and durable outcomes.

### 8.1 Payment-term definition creation/versioning

**FINALIZED — AUTHORITATIVE FOR B1T12:**

```text
b1.payment-term.definition.idempotency.v1
```

Semantic boundary: create a specific immutable payment-term reference/version definition. Its request hash covers semantic definition, applicability, effective window, currency/unit, provenance references, and expected predecessor for new versions. It excludes generated IDs, execution timestamps, audit IDs, and persistence timestamps. The same semantic request replays; the same key with changed semantics conflicts.

Creation produces `DRAFT`. Activation is a separate A2-approved operation represented in this same definition scope with an explicit lifecycle-operation discriminator in the semantic request payload. No additional lifecycle idempotency scope is authorized.

### 8.2 Invoice payment-term binding and due-date generation

**FINALIZED — AUTHORITATIVE FOR B1T12:**

```text
b1.payment-term.invoice-binding.idempotency.v1
```

Semantic boundary: bind exactly one selected term version to one canonical invoice issuance and generate immutable due evidence. Its request hash covers caller intent and stable references, but not a caller-supplied due date, invoice snapshot, execution-generated `issuedAt`, random IDs, or persistence timestamps. The durable result stores the B1-selected term and calculated evidence. Replay returns that original durable result; changed term/applicability intent under the same key conflicts.

### 8.3 Due-date amendment

**FINALIZED — AUTHORITATIVE FOR B1T12:**

```text
b1.payment-term.due-date-amendment.idempotency.v1
```

Semantic boundary: append one approved correction to one expected prior binding/amendment hash. Its request hash covers invoice identity, prior evidence hash, replacement term evidence or approved correction inputs, reason, approval reference, and commercial provenance. It excludes the calculated due date as caller authority; B1 recalculates it. Replay returns the original amendment; changed semantics conflict.

Additive amendment persistence is finalized, so this third scope is required when amendment runtime is implemented.

### 8.4 Exact scope conclusion

Exactly these three scopes are authorized. No fourth scope, including a lifecycle-only scope, may be introduced in B1T12 v1.

## 9. Decision 7 — bounded term value

### 9.1 Authority implementation

A generic payment-term authority can be implemented without authorizing a production term value. Validation, hashing, versioning, effective dating, overlap detection, immutable-use rules, and deterministic calculation can operate against explicit commands and test fixtures. No default or seed is technically required.

### 9.2 Focused runtime testing

Deterministic due-date tests necessarily need at least one concrete numeric input. Such values can remain source-controlled test fixtures with no migration, bootstrap, seed, configuration registration, activation, or production identifier.

**FINALIZED — AUTHORITATIVE FOR B1T12:** Permit concrete integer term values in the inclusive range `0..3660` in tests only, labelled `TEST/IMPLEMENTATION FIXTURE ONLY`. The implementation task may choose fixture values needed for boundary tests, but those values carry no commercial meaning and must never be exported as defaults or production configuration.

### 9.3 Production activation and task exit

No Net 7, Net 15, Net 30, or other production value is proposed or authorized. A production term requires a separate explicit commercial/architecture approval covering exact basis, value, applicability, effective window, lifecycle status, and activation controls.

The current prerequisite package lists one approved bounded payment-term definition as a B1T12 exit criterion. Therefore Architecture must explicitly choose one of these governance positions:

1. runtime implementation may complete using test-only fixtures, while B1T12 remains not production-activated and does not satisfy its production exit criterion; or
2. a separately approved bounded production definition is supplied before B1T12 is declared complete.

**FINALIZED — AUTHORITATIVE FOR B1T12:** Adopt position 1 for runtime implementation and testing. Keep production activation and final production-exit evidence blocked until a real term is separately approved. Do not weaken or silently rewrite the existing exit criterion.

## 10. Finalized architecture

The following is the coherent finalized architecture. Every item is **FINALIZED — AUTHORITATIVE FOR B1T12**:

1. Freeze B1T12 v1 `termBasis` to `ELAPSED_DAYS` only.
2. Define one day as exactly 86,400 elapsed seconds.
3. Use canonical UTC instants and the explicit rule `UTC_INSTANT_ELAPSED`; output authoritative `dueAt`, not a date-only authority.
4. Preserve frozen `B1InvoiceV1` and its historical hash unchanged.
5. Introduce additive immutable B1T12 issuance/binding evidence referencing exact canonical invoice reference/version/hash and freezing stable `issuedAt`.
6. During a prospective B1T12 issuance operation, obtain the invoice internally from canonical B1 logic, durably preserve the unchanged invoice in existing canonical B1 billing persistence, and atomically preserve/recover binding evidence.
7. Add B1-owned, versioned payment-term-definition persistence and B1-owned immutable invoice-binding persistence; neither is another invoice authority.
8. Expose one composed internal read-only B1 consumer port for B2F07; expose no B2 mutation path.
9. Use additive immutable due-date amendments for due-date-only corrections; preserve original evidence and complete chain.
10. Use exactly the three finalized idempotency scopes documented in §8.
11. Permit concrete test values only as `TEST/IMPLEMENTATION FIXTURE ONLY`; authorize no production value, default, or seed.
12. Keep existing invoices without B1T12 evidence unbound; never infer or backfill a term or due date.

## 11. Alternatives rejected and why

These alternatives are rejected by **FINALIZED — AUTHORITATIVE FOR B1T12** decisions in ADR-0091.

| Alternative                                               | Final disposition                   | Reason                                                                            |
| --------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| `CALENDAR_DAYS` in v1                                     | Reject for first bounded vocabulary | Requires unapproved timezone, date-inclusion, and due-time semantics.             |
| `BUSINESS_DAYS` in v1                                     | Reject                              | No authoritative B1 holiday/business calendar exists.                             |
| `END_OF_MONTH` in v1                                      | Reject                              | Requires unapproved civil-time, month-offset, due-time, and adjustment semantics. |
| Infer Africa/Lagos from business location                 | Reject                              | Location does not establish a commercial calendar contract.                       |
| Infer UTC commercial semantics from timestamp storage     | Reject                              | Representation does not establish obligation semantics.                           |
| Infer payment terms from the 86,400-second replay window  | Reject                              | Replay retention is not a customer payment obligation.                            |
| New `B1InvoiceV2` as first extension strategy             | Defer/reject for v1                 | Larger compatibility and migration surface; risks reopening B1T05.                |
| In-place augmentation/mutation of `B1InvoiceV1`           | Reject                              | Breaks frozen contract/hash correspondence and historical preservation.           |
| Caller-supplied invoice snapshot, `issuedAt`, or due date | Reject                              | Creates competing authority and permits override of B1 calculation.               |
| Finance-owned term/binding/due date                       | Reject                              | Violates B1/B2 authority boundary.                                                |
| Mutable correction overwrite                              | Reject                              | Destroys original evidence and reproducibility.                                   |
| Void/reissue for every due-date correction                | Reject as default                   | Excessively destructive and introduces broader invoice/accounting consequences.   |
| Production default/seed                                   | Reject                              | No commercial term value is authorized.                                           |
| Retrospective inference for existing invoices             | Reject                              | No authoritative historical selection or stable issuance binding exists.          |

## 12. Authority-boundary analysis

| Concern                                                        | Authority after finalized design        | Boundary rule                                                   |
| -------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| Payment-term definition/version/lifecycle                      | B1                                      | B1 is the only commercial-term authority.                       |
| Term applicability and invoice selection                       | B1                                      | Exactly one effective compatible term; ambiguity fails closed.  |
| Invoice identity/content/amount/state                          | Existing canonical B1 invoice authority | B1T12 references it and does not create a second invoice.       |
| Stable issuance and term-binding evidence                      | B1T12 extension within B1               | Immutable, hash-addressed, and read-only to Finance.            |
| Due-date calculation and amendment                             | B1                                      | Caller and B2 cannot override or recalculate authority.         |
| Ledger account/AR control account/posting/balance/reversal     | A5                                      | B1T12 has no A5 write or provisioning authority.                |
| Finance-to-A5 classification mapping                           | B2F03                                   | B1T12 creates no mapping.                                       |
| Accounting-period admission                                    | B2F04                                   | B1T12 does not admit accounting dates.                          |
| Journal governance/A5 posting request                          | B2F05                                   | B1T12 does not create or post journals.                         |
| Finance controls                                               | B2F06                                   | B1T12 does not create Finance policy.                           |
| AR record/status/outstanding amount/aging/accounting treatment | B2F07 after GO                          | B2F07 consumes due evidence but does not define the obligation. |
| Shared idempotency/audit/outbox/metrics primitives             | Operations                              | B1T12 reuses services; it creates no duplicate authority.       |
| Public API                                                     | None in B1T12                           | Internal consumer only.                                         |

The finalized architecture creates no authority for A5 mutation, B2F03 mapping, B2F04 period change, B2F05 posting, B2F06 policy mutation, B2F07 AR implementation, B2F08 AP, B2F09, Treasury, Reporting, Statements, IAM, Developer/API, C1–C7, Frontend, D1, or E1–E6.

## 13. B1T12 implementation prerequisites

The five architecture blockers are finalized by this package and ADR-0091. A later runtime task may begin only under a separate execution instruction and must:

1. implement exactly the finalized basis, bounds, arithmetic, canonical hash contracts, lifecycle, A2 resources/fingerprints, orchestration, amendment model, and three idempotency scopes;
2. allocate the three documented B1T12 A2 action names in runtime without reusing a Finance action;
3. create no production/default/seed term and perform no automatic activation;
4. treat concrete values `0`, `7`, and `30` only as test/implementation fixtures unless separately approved for production;
5. preserve frozen `B1InvoiceV1`, its hash semantics, historical B1T05 methods, existing invoice records, and `b1_billing_documents` authority;
6. use additive B1-owned term, binding, and amendment aggregates with no historical backfill;
7. reuse A2 and shared Operations idempotency, audit, outbox, and metrics infrastructure;
8. expose only an internal read-only composed consumer to future B2F07;
9. preserve B1T03/B1T05, A5T11, B2F03–B2F06, B2F09-PRE, historical B2T01–B2T10, and the permanent roadmap; and
10. complete focused and full-repository validation before B1T12 runtime can be declared technically complete.

Production activation remains separately blocked until an exact real term basis/value/applicability/effective window is commercially approved and passes the finalized A2 lifecycle.

## 14. B2F07 convergence requirements

B2F07 remains blocked after this documentation package. Entry review may converge only when all of the following are true:

1. A5T11 runtime capability remains complete.
2. The canonical A5 AR control account is actually provisioned and independently verified under valid controls.
3. Its canonical A5 UUID is known and verified.
4. A B2F03 `finance.asset.receivable` mapping to that UUID is approved, `ACTIVE`, effective, and verified.
5. ADR-0091 and all B1T12 architecture decisions are approved.
6. B1T12 runtime is implemented and validated without production defaults.
7. At least one canonical prospective B1 invoice has durable stable issuance evidence, exact payment-term binding, and deterministic due-date evidence under an authorized term definition appropriate to the required activation/evidence level.
8. Canonical B1 read-only evidence exposes and verifies invoice reference/version/hash/state, amount/currency/unit, stable `issuedAt`, term reference/version/hash/effective status, `dueAt`, calculation hash, and provenance.
9. Replay returns original durable evidence; semantic conflicts fail closed.
10. Corrections preserve original evidence and expose an unambiguous effective chain.
11. B2 Finance has no B1 mutation or due-date calculation path.
12. Architecture records an explicit `B2F07 = GO` after a fresh entry review.

Only then may B2F07 implementation begin. This package is not a B2F07 GO decision.

## 15. Remaining review and activation decisions

The five implementation architecture blockers are resolved. The following are intentionally **not** authorized by this package and remain future review/activation matters rather than B1T12 v1 design ambiguity:

1. the first real production payment-term value, applicability, effective window, and commercial approval;
2. any term basis other than `ELAPSED_DAYS`;
3. any calendar, business-day, month-end, local-time, or Africa/Lagos civil-time semantics;
4. any public API, administrative UI, B9 IAM administration, B8 configuration distribution, or production rollout;
5. any retrospective term assignment or backfill for historical invoices;
6. any new invoice version, void-and-reissue workflow, or amendment that changes invoice content/value rather than due-date evidence; and
7. B2F07 entry approval, which still requires the A5/B2F03 convergence track and an explicit `B2F07 = GO`.

The exact retention duration for the new commercial evidence remains **NOT VERIFIED / REQUIRES REVIEW** by Commercial, Finance, Tax, Legal, Privacy, Compliance, and Audit. Runtime design must preserve evidence and legal-hold capability and must not invent disposal behavior while that duration is unresolved. This does not reopen the finalized term, hash, lifecycle, authorization, or orchestration decisions.

The action names in §2A.4 are documented for exact runtime vocabulary allocation in the subsequent implementation task; no runtime vocabulary is modified here.

## 16. Historical-preservation and no-runtime declaration

This package changes documentation only. It does not:

- modify B1T03 or B1T05;
- modify A5T01–A5T11 or ADR-0090;
- modify B2F03, B2F04, B2F05, B2F06, or B2F09-PRE;
- modify historical B2T01–B2T10 or revive B2T11/B2T12;
- create source files, migrations, entities, services, controllers, APIs, routes, tests, idempotency records, payment terms, invoice records, invoice modifications, mappings, AR records, journals, balances, or production activation;
- authorize B2F07, B2F08, or B2F09 implementation;
- alter the permanent platform order.

## 17. References

- [`ADR-0091 — B1 Commercial Payment-Term and Invoice Due-Date Extension`](ADR/ADR-0091-B1-Commercial-Payment-Term-and-Invoice-Due-Date-Extension.md)
- [`B1-IMPLEMENTATION-PLAN.md`](B1-IMPLEMENTATION-PLAN.md)
- [`B1-BILLING-ENGINE-CONTRACT.md`](B1-BILLING-ENGINE-CONTRACT.md)
- [`B1-COMMERCIAL-CATALOG-CONTRACT.md`](B1-COMMERCIAL-CATALOG-CONTRACT.md)
- [`B2F07-PREREQUISITE-WORK-PACKAGES.md`](B2F07-PREREQUISITE-WORK-PACKAGES.md)
- [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md)
- [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md)
- [`ADR/ADR-0090-A5-AR-Control-Account-Provisioning.md`](ADR/ADR-0090-A5-AR-Control-Account-Provisioning.md)
