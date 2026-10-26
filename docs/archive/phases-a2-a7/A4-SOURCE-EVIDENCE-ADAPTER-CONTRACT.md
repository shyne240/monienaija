# A4T03 — Normalized Source-Evidence Adapter Contract

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T03 — Normalized Source-Evidence Adapter and Snapshot Contract
- **Contract:** `A4-SOURCE-EVIDENCE.v1`
- **Status:** Documentation-only read-boundary contract; no adapter implementation
- **Owner:** A4 Capability & Policy Engine boundary, consuming source-owner contracts
- **Application, database, API, migration, and runtime changes in this task:** None

## 1. Purpose and boundary

This document defines how a later A4 implementation will collect the minimum source evidence required by a registered capability/action profile and turn it into normalized, immutable evidence items. It defines ownership, collection, freshness observation, privacy minimization, missing/unavailable behavior, and the handoff to the immutable snapshot contract.

A4T03 does **not**:

- evaluate policy precedence;
- select `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, or `SUSPEND`;
- create policy versions or persist decisions;
- mutate any source record;
- repair A3 binding/account drift;
- authenticate or authorize a caller; or
- create an entity, migration, service, controller, API, test, or runtime behavior.

The source adapter is a read boundary. The later evaluator consumes its snapshot but must not query arbitrary tables or reinterpret source ownership.

## 2. Collection topology

The logical A4 collection path is:

```text
A2 authenticated/authorized request context
        |
        v
A4 PolicyDecisionRequestV1
  customerId + capability + action + requestedAt
  evidenceProfile + required source classes
        |
        v
A4 SourceEvidenceCoordinator
        |
        +--> Customer adapter
        +--> Onboarding/readiness adapter
        +--> Eligibility/restriction/limit/enrollment/permission adapters
        +--> Risk-evidence adapter
        +--> Compliance-evidence adapter
        +--> A3 binding/account/control adapter
        +--> A2 authorization-context adapter
        |
        v
Normalized SourceEvidenceItem[]
        |
        v
Immutable PolicyEvidenceSnapshotV1
        |
        v
Later A4 policy evaluator
```

The coordinator owns collection order, required source-class coverage, deterministic composition, and snapshot integrity. Each source adapter remains responsible for reading its own source contract and reporting source identity/version/freshness facts. No adapter receives write access to another source domain.

## 3. Source adapter contract

The following is a logical contract, not executable code.

```text
SourceEvidenceAdapterV1
  sourceClass
  collect(context: SourceEvidenceCollectionContext): SourceEvidenceCollection

SourceEvidenceCollectionContext
  customerId
  capability
  action
  requestedAt
  asOf
  evidenceProfile
  requiredSourceClasses[]
  targetBindingId?
  a2AccessContextReference
  correlationContext

SourceEvidenceCollection
  sourceClass
  collectionStatus
  items[]
  observedAt
  adapterContractVersion
  failureReference?
```

### 3.1 Normalized evidence item

```text
SourceEvidenceItemV1
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
```

Required rules:

- `sourceClass` is an A4 logical class such as `CUSTOMER`, `ONBOARDING`, `ELIGIBILITY`, `RESTRICTIONS`, `LIMITS`, `ENROLLMENT`, `PERMISSIONS`, `RISK`, `COMPLIANCE`, `ACCOUNT_BINDING`, or `AUTHORIZATION`.
- `sourceType` identifies the owning source record type; it is not a policy capability or a financial identity.
- `sourceId` is the source record identifier where the source has one. It must not be replaced by a customer reference, alias, case number, or display value.
- `customerId` is the canonical `Customer.id` subject for customer-scoped evidence. A source relationship that reports a different customer is `CONFLICTING` evidence.
- `sourceVersion` is included where the source exposes an optimistic/history version. Absence is recorded rather than invented.
- `sourceUpdatedAt` is the source-owned timestamp where available. `observedAt` is the adapter read time and is not a source update.
- `deleted` is explicit. A deleted source is not silently omitted from the snapshot.
- `freshnessState` uses the neutral A4T01 vocabulary and does not select a policy decision.
- `classification` follows A1 privacy/handling controls and limits later consumer access.
- `normalizedValue` contains only approved, minimum necessary fields. It is not a copy of the source entity.
- `sourceReference` identifies how the source can be re-read by an authorized owner without returning raw sensitive payloads.

## 4. Collection rules by source authority

| Source class      | Source owner / read boundary                                               | Minimum collection responsibility                                                                                    | Prohibited collection behavior                                                                            |
| ----------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `CUSTOMER`        | `customer` / Customer source contract                                      | Canonical UUID, lifecycle, deletion, version, and required customer-state evidence                                   | Use `Customer.reference` as identity; copy profile/KYC/document payloads without a capability need        |
| `ONBOARDING`      | `customer-onboarding` / onboarding/readiness contract                      | Workflow state, version, readiness result/check references, approval/completion timestamps                           | Complete or mutate onboarding; treat readiness as authorization                                           |
| `ELIGIBILITY`     | `customer-eligibility` / eligibility source contract                       | Current eligibility state, version, status-change evidence                                                           | Write eligibility or infer a policy result from the source row alone                                      |
| `RESTRICTIONS`    | `customer-eligibility` / restriction source contract                       | Active restriction type, active flag, source version, safe reason reference                                          | Omit active restrictions because a view did not return them; copy sensitive raw reasons by default        |
| `LIMITS`          | `customer-eligibility` / limit-profile contract                            | Configured limits, currency, version, deletion/freshness evidence                                                    | Treat caller-supplied `LimitEngine` inputs as authoritative configuration; mutate usage or balances       |
| `ENROLLMENT`      | `customer-eligibility` / enrollment contract                               | Product key, status, version, status-change evidence                                                                 | Activate/close enrollment; create a product registry                                                      |
| `PERMISSIONS`     | `customer-eligibility` / permission contract                               | Permission type, enabled state, version, safe reason reference                                                       | Treat an enabled permission as A2 authorization or create a second permission writer                      |
| `RISK`            | `customer-risk-profile` and historical onboarding risk contracts           | Minimized risk source kind, profile status, risk level, assessment/review dates, factor references, versions         | Run automated scoring/screening; silently map `PROHIBITED` to `CRITICAL`; copy raw notes/factor reasoning |
| `COMPLIANCE`      | `customer-compliance` / case-state contract                                | Minimized case category, severity, status, assignment/resolution reference, version, timestamps                      | Treat case existence as an automated finding; copy unrestricted comments/evidence                         |
| `ACCOUNT_BINDING` | A3 binding/read/reconciliation contracts plus Wallet/Ledger read contracts | Explicit binding IDs/state, source versions, currency/accounting unit, Wallet/Ledger compatibility, A3 control state | Infer a binding from opaque customer values, repair/reassign accounts, or copy balances                   |
| `AUTHORIZATION`   | A2 principal/authorization contract                                        | Principal/access context, authorization decision reference, assurance, evaluated time                                | Validate credentials/tokens or replace A2 authorization with A4 logic                                     |

The source inventory and current repository evidence are maintained in [`A4-SOURCE-EVIDENCE-MATRIX.md`](A4-SOURCE-EVIDENCE-MATRIX.md) and [`A4-POLICY-BASELINE.md`](A4-POLICY-BASELINE.md).

## 5. Source read and ownership rules

### 5.1 Approved collection boundary

A later adapter may read through:

- a source-owner service/read contract;
- an explicitly approved repository read that preserves the source owner and minimum-field boundary; or
- an A3/Wallet/Ledger read contract for account and financial dimensions.

A later adapter must not:

- issue arbitrary cross-domain `SELECT *` reads;
- add shared-table write authority;
- call a source mutation method as part of evidence collection;
- use a dashboard, readiness view, reconciliation report, or metric as a source writer; or
- select a financial account from a reference, alias, account code, opaque compatibility value, or currency.

### 5.2 Source owner remains authoritative

An adapter may normalize source evidence, but it does not correct source data. If a source row is inconsistent, the adapter reports the inconsistency in the item/snapshot. Reconciliation and later recovery remain independent boundaries.

### 5.3 Customer subject consistency

Every customer-scoped source item must be attributable to the request's canonical `Customer.id`. The following are evidence conditions, not repair instructions:

- source row missing the customer relationship: `MISSING` or `CONFLICTING`;
- source row points to another customer UUID: `CONFLICTING`;
- source is soft-deleted: `DELETED`;
- source cannot be read: `UNAVAILABLE`; and
- source version no longer satisfies the requested assertion: `STALE`.

The coordinator must not replace one customer with another to complete a snapshot.

## 6. Freshness observation contract

A4T03 records freshness facts; it does not choose final policy precedence or time windows.

### 6.1 Neutral freshness evaluation

The collection boundary observes states in this order:

1. `UNAVAILABLE` when the approved source read fails or cannot establish a reliable result.
2. `MISSING` when a required source row/relationship is absent.
3. `DELETED` when a source row is outside the active source set due to soft deletion or equivalent lifecycle.
4. `CONFLICTING` when source identity, dimensions, ownership, or required relationships disagree.
5. `STALE` when a required version/assertion fails, a source is past its source-owned review date, or a binding source version no longer matches.
6. `CURRENT` when the source exists, is readable, attributable to the requested customer, and has no observed freshness failure.
7. `RESTRICTED` when the evidence exists but the current collection context cannot read the required classified field.

The ordering is an evidence classification rule. A4T04 decides how each capability maps these states to a policy result.

### 6.2 Freshness signals

Adapters preserve the signals available from the source rather than inventing a universal timestamp:

| Signal                         | Example source                                                                                  | Adapter treatment                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Optimistic/history version     | Customer Foundation, risk, compliance, eligibility, limits, enrollment, permissions, A3 binding | Copy the numeric/string version as source evidence and compare only to an explicit request/profile assertion. |
| `updatedAt` / `createdAt`      | Most TypeORM entities                                                                           | Preserve as source time; do not use a transport read time as a source update.                                 |
| Status-change time             | Eligibility, onboarding, enrollment, compliance, restrictions                                   | Preserve when a later profile needs recency of a state change.                                                |
| Risk `reviewDueDate`           | P1.10 manual risk profile                                                                       | Mark the evidence review-due/stale when the source-owned date has passed; do not choose the final decision.   |
| A3 source versions             | Customer and CustomerWallet versions in the binding                                             | Preserve A3 stale-binding evidence and do not mark the account current locally.                               |
| A2 authorization `evaluatedAt` | A2 authorization decision                                                                       | Preserve separately from source-evidence freshness; authorization remains an A2 gate.                         |
| Reconciliation `generatedAt`   | A3/reconciliation report                                                                        | Preserve the control timestamp and status; it cannot repair source rows.                                      |
| Ledger observed-at             | Ledger-derived read                                                                             | Preserve read time, currency, and accounting unit; never represent an unavailable read as zero.               |

## 7. Privacy minimization and classification

The adapter must apply minimization before composition:

- Store source references, IDs, versions, safe state, and bounded reason references rather than full source records.
- Do not include passwords, password hashes, access/session tokens, reset/recovery values, MFA proofs, device fingerprints, or privileged-action fingerprints.
- Do not include raw KYC documents, unrestricted customer profile fields, compliance comments/evidence, raw risk notes, or factor narratives unless a later capability profile explicitly approves a minimum field.
- Do not include full ledger history, journal lines, account activity, or mutable balances by default.
- Monetary values that are required as configured policy inputs use integer minor-unit strings and explicit currency.
- Provider IDs, payment references, case numbers, aliases, request IDs, correlation IDs, and idempotency keys remain separately classified references; they are never canonical customer or financial identity.
- Classification is attached to each evidence item so later read/decision consumers can apply the least-privilege boundary.

The adapter does not downgrade a source classification because a policy consumer requested the field.

## 8. Collection failure and partial snapshot behavior

A later coordinator must distinguish these cases:

| Collection condition                         | Evidence representation                                          | Snapshot implication                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Required source returned a valid current row | `CURRENT` item with source reference/version                     | Snapshot may be complete for that source class.                                            |
| Optional source has no row                   | Explicit `MISSING` item with source class and scope              | Later capability profile decides whether absence is acceptable; omission is not permitted. |
| Required source has no row                   | Explicit `MISSING` item and incomplete coverage                  | Later evaluator must not receive an apparently complete snapshot.                          |
| Source read failed/timeout                   | `UNAVAILABLE` item with safe failure reference and observed time | No fabricated empty source; caller/retry path receives controlled collection state.        |
| Source is soft-deleted                       | `DELETED` item with source ID/version                            | Historical reference is retained without active evidence.                                  |
| Source IDs/dimensions disagree               | `CONFLICTING` item(s) preserving relevant references             | No adapter-side repair or source selection.                                                |
| Source version/review assertion fails        | `STALE` item with freshness reason                               | Later policy profile decides non-allow/review behavior.                                    |
| Restricted field cannot be read              | `RESTRICTED` item with classification/read-scope reference       | No fallback to a less restricted copy or optimistic default.                               |

A partial collection must not be presented as a complete current snapshot. If a later implementation retries, it creates a new collection attempt and a new snapshot; it does not mutate an already-created snapshot.

## 9. Adapter-to-snapshot handoff

The coordinator passes only normalized source items and collection metadata to [`A4-NORMALIZED-EVIDENCE-SNAPSHOT.md`](A4-NORMALIZED-EVIDENCE-SNAPSHOT.md).

The handoff must include:

- the original A4 request scope (`customerId`, capability, action, requested/as-of time);
- required and collected source classes;
- one or more normalized items for every returned source/relation, including explicit missing/unavailable/restricted states;
- source versions/timestamps and observed-at times;
- classifications and safe source references;
- deterministic ordering metadata; and
- collection status and failure references where relevant.

It must not include an A4 decision, reason-code outcome, policy precedence result, or source mutation command.

## 10. Explicit A4T03 out of scope

This contract does not:

- implement adapters, repositories, services, entities, migrations, controllers, APIs, or runtime behavior;
- define the final A4 precedence matrix or risk/restriction/compliance mapping;
- define capability-specific limit enforcement or product profiles;
- persist policy snapshots or decisions;
- evaluate policy or generate `ALLOW`/`DENY` results;
- repair Customer Foundation, A3 binding, Wallet, Ledger, Compliance, Risk, or Reconciliation data; or
- begin A4T04, A4T05, A4T06, A4T07, A4T08, A4T09, A4T10, or A5.

## 11. A4T03 verification record

- [x] Source collection is assigned to read-only adapters that preserve each authoritative source owner.
- [x] Customer, onboarding, eligibility, restriction, limit, enrollment, permission, risk, compliance, A2, A3, Wallet, Ledger, and control-source responsibilities are documented.
- [x] Normalized source-item fields include source identity, customer identity, source version/timestamps, observed time, deletion, freshness state, classification, and minimum value.
- [x] `CURRENT`, `STALE`, `MISSING`, `DELETED`, `CONFLICTING`, `UNAVAILABLE`, and `RESTRICTED` states are represented without selecting final policy outcomes.
- [x] Privacy minimization excludes credentials, tokens, device proofs, unrestricted investigative evidence, unnecessary KYC/profile data, and mutable financial history.
- [x] A2 authorization and A3 binding/account evidence remain separate from policy evaluation and source ownership.
- [x] Partial collection and retry behavior do not fabricate complete evidence or mutate immutable snapshots.
- [x] The adapter handoff to the immutable snapshot contract is defined.
- [x] No runtime adapter, evaluator, entity, migration, service, controller, API, test, or source mutation is implemented.
- [ ] A4T04 normative precedence and conflict matrix.
- [ ] A4T05 capability-specific profiles and limit contract.
- [ ] A4T06 physical persistence and policy-version storage.
