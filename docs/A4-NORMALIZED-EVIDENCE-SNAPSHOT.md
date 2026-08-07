# A4T03 — Immutable Normalized Evidence Snapshot Contract

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T03 — Normalized Source-Evidence Adapter and Snapshot Contract
- **Contract:** `A4-EVIDENCE-SNAPSHOT.v1`
- **Status:** Documentation-only immutable snapshot contract; no snapshot persistence or evaluator
- **Consumer:** Later A4 policy evaluation after A4T04/A4T05 contracts
- **Application, database, API, migration, and runtime changes in this task:** None

## 1. Purpose and boundary

This document defines the immutable logical snapshot that a later A4 evaluator will consume. It composes normalized source-evidence items collected through the adapter contract without copying source entities or becoming a new source of truth.

A snapshot is a point-in-time evidence value for one policy request scope:

```text
canonical customer
+ capability/action
+ requested/as-of time
+ collected source items
+ freshness/availability observations
+ source references and versions
+ normalized evidence hash
```

It is not:

- a policy decision;
- a policy-version definition;
- an authorization decision;
- an A3 binding or account record;
- a balance or journal snapshot;
- a customer status projection; or
- a repair command.

A4T03 defines the contract only. Physical persistence, retention, policy-version lookup, and evaluator behavior are later tasks.

## 2. Snapshot immutability rules

Once composed, `PolicyEvidenceSnapshotV1` is immutable:

1. A source update creates a new collection and a new snapshot; it never edits an existing snapshot.
2. A retry after timeout or unknown collection outcome creates a new attempt and verifies durable evidence before any later consumer treats it as current.
3. A source record is never changed to make a snapshot complete or policy-friendly.
4. A snapshot retains missing, stale, deleted, conflicting, unavailable, and restricted observations instead of omitting them.
5. A snapshot does not contain a policy decision. The evaluator later interprets evidence through a registered policy version.
6. A snapshot hash changes if any decision-relevant normalized subject, capability, action, source value, source reference/version, freshness state, or declared context changes.
7. Transport-only values do not become evidence identity or change the normalized hash unless an approved capability profile explicitly declares them decision-relevant.

## 3. Logical snapshot contract

The following is a logical contract, not a TypeScript type, entity, migration, or serialized public API.

```text
PolicyEvidenceSnapshotV1
  contractName: "A4-EVIDENCE-SNAPSHOT"
  contractVersion: 1
  snapshotReference
  subject
    type: "CUSTOMER"
    customerId
  policyRequestScope
    capability
    action
    requestedAt
    asOf
    evidenceProfile
    policyVersionHint?
    evaluationContext?
    targetBindingId?
  collection
    status: COMPLETE | INCOMPLETE | UNAVAILABLE
    startedAt
    collectedAt
    requiredSourceClasses[]
    collectedSourceClasses[]
    missingSourceClasses[]
    unavailableSourceClasses[]
    restrictedSourceClasses[]
    conflictSourceClasses[]
  sourceItems[]
    sourceClass
    sourceType
    sourceId
    customerId
    sourceVersion?
    sourceUpdatedAt?
    observedAt
    deleted
    freshnessState
    freshnessReasonCode?
    classification
    normalizedValue
    sourceReference
  evidenceSummary
    freshnessStates[]
    sourceCount
    normalizedInputHash
  integrity
    canonicalizationVersion
    arrayOrderingRule
    hashAlgorithm
```

### 3.1 Collection status

| Status        | Meaning                                                                                                                                                             | Later evaluator treatment                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `COMPLETE`    | All source classes required by the request/profile were collected or explicitly represented, and no collection-level failure prevents interpretation.               | Evaluator may inspect source items and apply later policy rules.                                |
| `INCOMPLETE`  | One or more required sources are missing, stale, conflicting, deleted, or otherwise not current, but the collection itself completed with explicit evidence states. | Evaluator receives the full evidence condition; it must not infer a missing source as positive. |
| `UNAVAILABLE` | One or more required source reads failed or the collection could not establish a reliable source boundary.                                                          | Evaluator receives controlled unavailability; no fabricated allow or empty source.              |

`collection.status` is evidence metadata, not an A4 decision. A4T04 defines the policy result for each capability/profile.

## 4. Snapshot scope

### 4.1 Subject and request scope

The snapshot must echo the normalized A4T02 request scope:

- `subject.type = CUSTOMER`;
- canonical `subject.customerId = Customer.id`;
- canonical capability and action keys;
- `requestedAt` and `asOf` timestamps;
- `evidenceProfile` selected by the A4 policy authority;
- optional `policyVersionHint`; and
- only declared, capability-owned evaluation context.

The snapshot must not include a customer reference, wallet alias, payment reference, provider ID, case number, route path, or idempotency key as a subject or financial identity.

### 4.2 Source item identity

Each `sourceItems[]` entry is identified for deterministic composition by:

```text
sourceClass
+ sourceType
+ sourceId
+ customerId
+ sourceVersion when present
```

If two items claim the same source identity with incompatible values or versions, both references remain visible and the relevant freshness state is `CONFLICTING`. The snapshot composer must not choose one arbitrarily.

## 5. Normalized source groups

The following groups define the minimum shape observed in A4T01. Capability profiles may request fewer fields, but may not broaden a snapshot to an unrestricted source copy.

| Source group      | Normalized fields permitted by default                                                                                                                                     | Explicitly excluded by default                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `CUSTOMER`        | Customer UUID, lifecycle status, source version, deletion state, source timestamps                                                                                         | Customer reference as subject, full profile/KYC/contact/address/document payloads                              |
| `ONBOARDING`      | Workflow status, version, readiness status/check references, approval/completion timestamps                                                                                | Agreements, task notes, identity documents, raw approval rationale unless a later profile approves a reference |
| `ELIGIBILITY`     | Eligibility status, onboarding relationship reference, version, status-change time, safe reason code/reference                                                             | Unbounded free-text rationale or unrelated customer records                                                    |
| `RESTRICTIONS`    | Restriction type, active flag, source version, status/update time, safe reason code/reference                                                                              | Raw investigative reason, comments, or unrestricted case content                                               |
| `LIMITS`          | Profile version, explicit currency, configured integer minor-unit limits, configured count limits, source timestamps                                                       | Transaction usage history, mutable balances, caller-supplied limits as source truth                            |
| `ENROLLMENT`      | Normalized product key, lifecycle status, source version, status-change time                                                                                               | Product catalogue data or enrollment mutation command                                                          |
| `PERMISSIONS`     | Permission type, enabled flag, source version, safe reason code/reference                                                                                                  | A2 role/scope claims or authorization secrets                                                                  |
| `RISK`            | Source kind (`ONBOARDING_LEGACY` or `P1_10_MANUAL`), profile status, risk level, assessment/review dates, profile/factor references, versions                              | Raw notes, factor remarks, assessor details, automated scoring output, silent vocabulary conversion            |
| `COMPLIANCE`      | Case UUID/reference as classified, category, severity, status, resolution/assignment reference, version, opened/updated/closed timestamps                                  | Raw comments, document/evidence content, chain-of-custody payload, automatic screening conclusion              |
| `ACCOUNT_BINDING` | Binding ID, CustomerWallet ID, WalletAccount ID, LedgerAccount ID, state, currency, accounting unit, source versions, binding version, A3 control/reconciliation reference | Inferred account identity, opaque `WalletAccount.customerId`, journal lines, mutable balance snapshot          |
| `AUTHORIZATION`   | A2 principal type/ID, customer scope, assurance, authorization decision reference, evaluated time                                                                          | Passwords, tokens, MFA proofs, device fingerprints, privileged action fingerprints                             |

### 5.1 Risk source distinction

The snapshot must retain the source kind for risk evidence:

```text
ONBOARDING_LEGACY -> LOW | MEDIUM | HIGH | PROHIBITED
P1_10_MANUAL     -> LOW | MEDIUM | HIGH | CRITICAL
```

A4T03 preserves the source vocabulary and references. It does not map `PROHIBITED` to `CRITICAL`, rank risk values, or decide a policy outcome. Those are A4T04 responsibilities.

### 5.2 Account and balance boundary

A capability may require account state or a current Ledger-derived value, but the snapshot rules remain:

- A3 binding/account identity must be explicit and read through A3/Wallet/Ledger contracts.
- An active A3 read can supply a point-in-time Ledger-derived value only when a later capability profile explicitly requires it.
- `LEDGER_UNAVAILABLE` remains a source/control state; it is not normalized to zero.
- A mutable balance is never persisted as a policy/source authority.
- Journal headers, lines, account activity, and posted value are not copied into the snapshot.

## 6. Normalization rules

Normalization produces a canonical value without changing source meaning.

### 6.1 Identifiers

- UUIDs are validated case-insensitively and serialized as lowercase hyphenated UUIDs.
- `Customer.id` is retained as the canonical subject.
- Source IDs remain paired with `sourceType` and `sourceClass`; an ID without its owner namespace is not sufficient.
- Customer references, aliases, case numbers, payment references, provider IDs, request IDs, trace IDs, correlation IDs, and idempotency keys remain typed references and are not substituted for UUID identity.
- Provider values are not normalized with MonieNaija identifier rules.

### 6.2 Enumerations and keys

- A4 capability/action keys are normalized under the A4T02 lowercase dot-separated grammar.
- Source-owned enums retain their source vocabulary and are not silently mapped in A4T03.
- Product enrollment keys use the source-owner normalization already defined by `customer-eligibility`; A4 does not create a second product namespace in the snapshot.
- Unknown source enum values are represented as an explicit unsupported/unknown source condition, not discarded.

### 6.3 Currency and monetary values

- Currency is trimmed and uppercase three-letter code where present.
- Monetary configuration values are non-negative integer minor-unit strings.
- Currency is required whenever a monetary value is present.
- No conversion, rounding, floating-point arithmetic, rate lookup, or balance calculation occurs during snapshot composition.

### 6.4 Time and optional values

- Timestamps are serialized as ISO-8601 UTC values with timezone.
- `sourceUpdatedAt`, `observedAt`, `collectedAt`, and `requestedAt` remain distinct fields.
- Absent source values are represented as `null` or an explicit evidence-state/reference according to the logical field contract; they are not replaced with empty strings, zero, or false.
- Raw free-text fields are omitted by default. An approved safe reason/reference is a distinct normalized field, not a truncated copy of sensitive text.

### 6.5 Collection ordering

For deterministic serialization:

1. Source items are grouped by `sourceClass` using a fixed lexical order.
2. Within a source class, items are ordered by `sourceType`, `sourceId`, and `sourceVersion` when present.
3. Arrays of enum-like values are sorted by their normalized key.
4. Object keys are serialized in lexicographic order.
5. Whitespace and transport metadata are excluded from canonical evidence values.

The ordering rule is recorded in `integrity.arrayOrderingRule` and cannot change without a snapshot contract version change.

## 7. Freshness and source-state representation

Every source item carries a neutral freshness state from the adapter contract:

```text
CURRENT
STALE
MISSING
DELETED
CONFLICTING
UNAVAILABLE
RESTRICTED
```

A snapshot must preserve the reason and source reference for a non-current item where safe to do so:

```text
freshnessReasonCode
sourceReference
sourceVersion?
sourceUpdatedAt?
observedAt
```

Freshness observations include:

- source version mismatch or failed expected-version assertion;
- risk review due date passed;
- A3 customer/CustomerWallet source version no longer matching the binding;
- source status/deletion outside the active read contract;
- conflicting customer/account/dimension relationships;
- unavailable or timed-out source reads; and
- inaccessible classified fields.

A4T03 does not decide whether a stale or conflicting item means `DENY`, `PENDING_REVIEW`, or `SUSPEND`. It only ensures the evaluator receives the condition instead of an optimistic default.

## 8. Snapshot hashing and integrity

### 8.1 Normalized input hash

The `evidenceSummary.normalizedInputHash` is:

```text
lowercase SHA-256(canonical JSON(normalized request scope + normalized source items))
```

The canonical hash input includes:

- contract and snapshot versions;
- canonical customer UUID;
- capability/action;
- requested/as-of time;
- declared evaluation context;
- policy-version hint when supplied;
- source class/type/IDs;
- source versions and source timestamps;
- normalized values required by the evidence profile;
- freshness/deletion/conflict/unavailable states; and
- collection status.

The hash excludes:

- HTTP headers and transport framing;
- request ID, correlation ID, trace ID, and causation ID;
- idempotency key;
- actor presentation labels; and
- raw secrets or fields not declared decision-relevant by the capability profile.

If an A2 access field is explicitly declared policy-relevant by a later profile, its normalized safe value is included; the raw credential/security material is never included.

### 8.2 Hash purpose

The hash:

- makes the later policy result reproducible against the same normalized evidence;
- detects changed source/request inputs during replay;
- does not identify a customer, account, provider, or policy version by itself; and
- does not replace source IDs, versions, retention, access control, or audit evidence.

A hash mismatch is evidence of changed inputs, not a reason to mutate the old snapshot or source record.

## 9. Privacy, retention, and access boundary

The snapshot inherits the strictest relevant source classification:

- identity, eligibility, enrollment, permission, and account references remain at least Restricted;
- risk, compliance, credentials, device data, and financial-control references remain Highly Restricted where applicable;
- a less-sensitive consumer cannot receive a snapshot merely because it exists;
- source references are minimized and access to a snapshot is separately authorized by A2; and
- retention/hold treatment follows source owner, policy-decision, audit, and legal-hold contracts.

A snapshot is not a convenient export. It must not be logged, placed in a general diagnostic payload, returned through a broad customer endpoint, or copied into an outbox event without a later approved field-level contract.

## 10. Snapshot handoff to later A4 evaluation

A later evaluator receives:

- one immutable snapshot;
- the selected/required policy profile reference from the A4 request;
- the later selected immutable policy version;
- the normalized input hash and source references; and
- the neutral freshness/collection status.

The evaluator is responsible for applying A4T04 precedence and producing the A4T02 result. It must not re-read arbitrary source tables or mutate the snapshot to reach a preferred result.

The snapshot does not contain:

- a decision;
- reason-code outcome;
- customer operating-status mutation;
- A2 authorization grant;
- A3 account activation;
- financial amount approval;
- journal or balance value; or
- repair action.

## 11. Explicit A4T03 out of scope

This contract does not:

- implement source adapters, coordinators, repositories, entities, migrations, services, controllers, APIs, or tests;
- define policy precedence, risk mapping, compliance outcome, product eligibility, or limit enforcement;
- persist snapshots or policy decisions;
- select or activate a policy version at runtime;
- evaluate `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, or `SUSPEND`;
- expose evidence to customers, operators, support, or external partners;
- repair or mutate Customer Foundation, A2, A3, Wallet, Ledger, Compliance, Risk, or Reconciliation records; or
- begin A4T04, A4T05, A4T06, A4T07, A4T08, A4T09, A4T10, or A5.

## 12. A4T03 verification record

- [x] The snapshot is defined as an immutable logical value consumed by later policy evaluation.
- [x] Snapshot scope contains canonical customer, capability/action, requested/as-of time, evidence profile, and collection metadata.
- [x] Source items retain source class/type/ID, customer ID, versions/timestamps, observed time, deletion, freshness state, classification, and normalized minimum values.
- [x] Source groups cover Customer, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A2 authorization, A3 binding/account state, and control evidence.
- [x] Normalization rules cover identifiers, source vocabularies, capability keys, currency, minor units, timestamps, optional fields, and deterministic ordering.
- [x] Missing, stale, deleted, conflicting, unavailable, and restricted evidence remains explicit.
- [x] The normalized input hash is deterministic and excludes transport/idempotency/presentation-only values.
- [x] Privacy minimization prevents credentials, raw compliance/risk evidence, broad KYC/profile data, journal lines, and mutable balances from entering the snapshot by default.
- [x] Snapshot collection cannot mutate source records, policy decisions, A3 binding state, or financial truth.
- [x] No runtime adapter, evaluator, entity, migration, service, controller, API, test, or persistence is implemented.
- [ ] A4T04 normative precedence and conflict matrix.
- [ ] A4T05 capability profiles and limit enforcement contract.
- [ ] A4T06 physical policy/snapshot persistence and policy-version storage.
