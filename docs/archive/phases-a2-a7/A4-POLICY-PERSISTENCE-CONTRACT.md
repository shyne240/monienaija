# A4T06 — Policy Persistence and Reproducibility Contract

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T06 — Policy Versioning, Decision Persistence, and Reproducibility
- **Contract:** `A4-POLICY-PERSISTENCE.v1`
- **Status:** Documentation-only logical storage contract; no persistence implementation
- **Owner:** A4 Capability & Policy Engine boundary
- **Application, database, API, migration, repository, service, and runtime changes in this task:** None

## 1. Purpose

This contract translates ADR-0040 into logical storage requirements for later A4 implementation. It defines the immutable policy profile/version record, immutable policy decision record, evidence snapshot attachment/linkage, hashes, lifecycle, audit/idempotency, retention, and replay guarantees.

It deliberately does not prescribe TypeORM entity classes, table names, column decorators, migration timestamps, repository code, or evaluator behavior. Those are future implementation work after this documentation gate.

## 2. Logical record model

A4T06 has three linked logical artifacts:

```text
PolicyProfileVersion
        |
        +--> PolicyDecisionRecord
                       |
                       +--> ImmutableEvidenceSnapshotAttachment
```

- `PolicyProfileVersion` is the immutable policy definition used by a capability/action.
- `PolicyDecisionRecord` is the immutable result for one request/evidence snapshot.
- `ImmutableEvidenceSnapshotAttachment` retains or references the minimized A4T03 snapshot required for exact reconstruction.

The attachment is not a new source authority. Customer, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A2, A3, Wallet, Ledger, Operations, and Reconciliation remain owners of their original records.

## 3. Policy profile version record

### 3.1 Logical fields

```text
PolicyProfileVersion
  profileReference
  profileKey
  profileVersion
  capability
  actions[]
  subjectType: CUSTOMER
  contractName
  contractVersion
  profileContractVersion
  definitionHash
  definitionPayloadReference
  evidenceRequirementReference
  enrollmentRequirementReference
  permissionRequirementReference
  productEligibilityReference
  riskRequirementReference
  complianceRequirementReference
  accountBindingRequirementReference
  limitRequirementReference
  allowedDecisions[]
  obligationCatalogueReference
  effectiveFrom
  effectiveTo?
  lifecycleState
  createdAt
  createdBy
  publishedAt?
  publishedBy?
  retiredAt?
  retiredBy?
  lastCorrelationId?
  lastRequestId?
```

The persisted definition payload must be the minimum approved profile content from [`A4-CAPABILITY-PROFILE-CONTRACT.md`](A4-CAPABILITY-PROFILE-CONTRACT.md). It must not contain customer-specific source evidence, credentials, raw compliance comments, balances, journals, or account ownership data.

### 3.2 Profile identity and constraints

- `profileReference` is an immutable opaque A4 identity and is never reused.
- `(profileKey, profileVersion)` is unique within the A4 profile namespace.
- `capability` and `actions[]` use the A4T02 canonical namespace.
- `definitionHash` is a lowercase SHA-256 hash of canonical profile content.
- A profile version cannot be active unless its required profile contract/version references resolve.
- At most one active effective profile version may apply to a capability/action and evaluation time.
- Effective intervals must not overlap for the same capability/action unless the selection rule is explicitly versioned and deterministic.
- `DRAFT` content may be withdrawn before publication; content referenced by a decision cannot be edited or deleted.
- `ACTIVE` content is immutable. `RETIRED` content remains queryable for historical replay and cannot be selected for new evaluation outside its effective interval.
- Lifecycle fields are operational metadata and must be audited; they do not change the immutable definition hash.

### 3.3 Profile lifecycle

```text
DRAFT -> ACTIVE -> RETIRED
   \-> REJECTED / ABANDONED
```

A transition does not rewrite a historical decision. A new profile version is required for any changed requirement, action mapping, precedence/profile setting, obligation, or limit boundary.

## 4. Policy decision record

### 4.1 Logical fields

```text
PolicyDecisionRecord
  decisionReference
  customerId
  capability
  action
  profileReference
  profileKey
  profileVersion
  policyVersion
  policyContractVersion
  requestHash
  snapshotReference
  snapshotContractVersion
  normalizedInputHash
  resultHash
  decision
  reasonCodes[]
  explanationReference
  obligations[]
  limitOutput?
  sourceReferences[]
  freshnessSummary
  authorizationContextReference
  targetBindingReference?
  requestedAt
  evaluatedAt
  expiresAt?
  reviewAt?
  supersedesDecisionReference?
  correlationId
  requestId?
  causationId?
  createdAt
  createdBy
```

### 4.2 Decision constraints

- `decisionReference` is a non-reusable opaque A4 identity.
- `customerId` is the canonical `Customer.id`; it is not replaced by a customer reference.
- `profileReference`, `profileVersion`, `policyVersion`, and `definitionHash` identify the exact policy definition.
- `requestHash` identifies the normalized A4T02 business request and is used with Operations idempotency.
- `snapshotReference`, `snapshotContractVersion`, and `normalizedInputHash` identify the exact A4T03 evidence snapshot.
- `resultHash` identifies the canonical stored result excluding transport-only metadata.
- `decision`, reason codes, explanation/obligation references, limit output, source references, freshness summary, and expiry/review values are immutable after creation.
- `supersedesDecisionReference` creates append-only lineage; it does not update the superseded record.
- No decision record contains mutable balance authority, journal lines, credentials, raw risk/compliance content, or source lifecycle fields as writable authority.
- A decision may contain explicit A3 binding references when the profile requires an account, but it cannot become an A3 binding or account owner.

### 4.3 Derived currentness

A decision record must not be mutated merely to mark it current, expired, or superseded. Currentness is derived from:

- `evaluatedAt`, `expiresAt`, and `reviewAt`;
- profile effective interval and lifecycle state;
- immutable lineage references; and
- the later consumer's current A2/A3/source checks.

If a physical implementation needs a current-effective index or projection, it must be derived/rebuildable and must not replace immutable decision history.

## 5. Immutable evidence snapshot attachment

### 5.1 Logical fields

```text
ImmutableEvidenceSnapshotAttachment
  snapshotReference
  snapshotContractName
  snapshotContractVersion
  customerId
  capability
  action
  requestedAt
  asOf
  evidenceProfile
  policyVersionHint?
  collectedAt
  collectionStatus
  sourceItems[]
  requiredSourceClasses[]
  freshnessSummary
  normalizedInputHash
  canonicalizationVersion
  hashAlgorithm
  retentionClass
  createdAt
```

The attachment contains the minimized normalized evidence shape defined by [`A4-NORMALIZED-EVIDENCE-SNAPSHOT.md`](A4-NORMALIZED-EVIDENCE-SNAPSHOT.md), not full source entities.

### 5.2 Attachment rules

- `snapshotReference` and `normalizedInputHash` are immutable and content-addressed for integrity purposes.
- One hash cannot resolve to different snapshot content under the same snapshot contract version.
- A snapshot is linked to decisions by reference; it is not copied into every audit/event response.
- A snapshot is not a policy decision and cannot contain a selected A4 result.
- A snapshot is not a balance, journal, account, or customer metadata source.
- If physical storage embeds the snapshot in a decision record, it must preserve the same immutability, hash, classification, and retention guarantees as a separate attachment.
- If an attachment is unavailable, the stored decision remains available as a historical result but exact reconstruction is reported as unavailable; the system must not fabricate a reconstructed result.

## 6. Hash and identity linkage

### 6.1 Linkage tuple

The durable linkage for a decision is:

```text
policyVersion
+ profileReference/profileVersion
+ definitionHash
+ requestHash
+ snapshotReference
+ normalizedInputHash
+ resultHash
```

The tuple must be sufficient to detect a changed policy definition, request, evidence snapshot, or result.

### 6.2 Canonical hashing rules

- Use lowercase SHA-256 hexadecimal for all A4 hashes.
- Canonical JSON uses deterministic lexicographic object-key ordering and the A4T03 array ordering rule.
- `requestHash` follows A4T02 and excludes transport/idempotency/presentation-only fields.
- `normalizedInputHash` follows A4T03 and includes decision-relevant normalized source values/freshness states.
- `definitionHash` includes immutable profile content and policy contract references.
- `resultHash` includes decision, policy version, reasons, obligations/limits, source references, freshness summary, and validity times.
- Correlation, request, trace, causation, and idempotency identifiers are retained for evidence but do not change hashes unless an approved profile explicitly declares a safe field decision-relevant.

## 7. Repository and lookup contract

The later A4 persistence implementation must provide logical read operations for:

```text
getActiveProfile(capability, action, evaluationTime)
getProfileVersion(profileReference | profileKey + profileVersion)
getDecision(decisionReference)
getCurrentEffectiveDecision(customerId, capability, action, context)
getDecisionByRequest(scope, idempotencyKey, requestHash)
getSnapshot(snapshotReference | normalizedInputHash)
reconstructDecision(decisionReference)
listDecisionLineage(decisionReference)
```

Rules:

- `getActiveProfile` must not return a draft/retired-inapplicable profile.
- `getCurrentEffectiveDecision` must not return an expired/superseded decision as current without currentness checks.
- `getDecisionByRequest` must distinguish exact replay from changed-hash conflict.
- `getSnapshot` must verify `normalizedInputHash` against the retrieved immutable content.
- `reconstructDecision` must use the historical profile and snapshot, not current source rows as a substitute.
- `listDecisionLineage` must preserve original decision identity and supersession chain.
- These are logical repository requirements only; no repository is created by A4T06.

## 8. Replay guarantees

### 8.1 Exact idempotent replay

For scope `policy.capability-decision.v1`:

- same key + same request hash returns the original `decisionReference` and result;
- same key + different request hash returns conflict with no decision mutation;
- an in-progress duplicate does not create another record;
- an expired idempotency record may permit a new command reservation, but it never permits reuse of a decision/profile/snapshot identity; and
- the replay path does not select the current policy version merely because it is newer.

### 8.2 Historical reconstruction

The later implementation reports one of:

```text
REPLAY_EXACT
REPLAY_REFERENCE_ONLY
REPLAY_UNAVAILABLE
REPLAY_CONFLICT
REPLAY_INTEGRITY_MISMATCH
```

Exact reconstruction requires:

1. profile version and `definitionHash`;
2. snapshot reference and `normalizedInputHash`;
3. decision record and `resultHash`;
4. contract/canonicalization versions; and
5. source references/versions needed to inspect provenance.

A result hash mismatch is an integrity failure. The old decision is preserved, the mismatch is audited, and no replacement is silently written.

## 9. Audit, idempotency, and outbox contract

### 9.1 Audit

Later A4 persistence/lifecycle commands must use `AuditService` transactionally for:

- profile draft/publish/activate/retire/reject events;
- decision creation and durable result;
- exact replay;
- changed-payload conflict;
- snapshot attach/resolve failure;
- profile/decision reconstruction and integrity mismatch; and
- controlled administrative lifecycle actions.

Audit payloads include safe profile/decision/snapshot references, hashes, capability/action, policy version, outcome, actor/principal reference, request/correlation/causation context, and timestamps. They exclude raw credentials, tokens, unrestricted snapshots, compliance comments, risk notes, and unnecessary customer data.

### 9.2 Idempotency

A4 uses the A4T02/Operations scope:

```text
policy.capability-decision.v1
```

The later implementation uses `IdempotencyService`, its request-hash conflict behavior, and redacted response storage. The idempotency record is operational evidence; the policy decision record remains the durable domain result.

### 9.3 Outbox

A4T06 does not introduce external event publication. If a later approved internal consumer needs a policy decision fact:

- the event must be a minimal versioned fact;
- source decision/profile/snapshot identities remain A4-owned;
- the outbox fact commits atomically with the relevant later source mutation where applicable; and
- pending outbox records remain protected from ordinary retention cleanup.

## 10. Retention and legal-hold contract

### 10.1 Retention separation

The existing Operations defaults do not define A4 policy-history retention:

- audit events default to 365 days;
- idempotency records default to 1 day; and
- published/failed outbox records default to 30 days.

A4 policy profile versions, decision records, and snapshot attachments require separate retention classification and schedule ownership. Idempotency expiry must never delete or make the linked decision history unrecoverable by itself.

### 10.2 Required retention controls

The later implementation must:

- retain any profile version referenced by a retained decision;
- retain or securely link the evidence snapshot required for the promised replay level;
- retain decision lineage and hash/reference metadata;
- prevent ordinary cleanup of held profile, decision, snapshot, or linked audit evidence;
- record owner, purpose, start event, cutoff, deletion method, access reviewer, and hold exceptions; and
- treat source retention and A4 decision retention as related but separately owned schedules.

### 10.3 Hold expansion

A hold may begin from:

```text
customerId
profileReference
decisionReference
snapshotReference
caseReference
paymentReference
A3 binding reference
correlationId
incident/dispute reference
```

The responsible owner must record linked datasets and release authority. A hold overrides ordinary cleanup; release triggers a new retention review rather than immediate deletion.

## 11. Privacy and data minimization

- Persist source references, versions, freshness, and hashes rather than full source entities.
- Keep risk/compliance/security/financial-control content Highly Restricted where applicable.
- Do not persist passwords, tokens, MFA proofs, device fingerprints, privileged action fingerprints, raw KYC documents, raw compliance comments, or unrestricted risk narratives.
- Policy limits are exact policy output values/obligations, not balances or usage ledgers.
- A snapshot attachment is not a support export, dashboard payload, or general diagnostic record.
- A2 authorization is required for policy record access according to its classified fields and audience.

## 12. Physical implementation invariants for a later task

When A4T06 is later implemented, the physical design must enforce or test:

- immutable profile/decision/snapshot content after publication/capture;
- unique non-reusable profile and decision identities;
- unique `(profileKey, profileVersion)`;
- deterministic active-profile selection with no overlapping effective intervals;
- immutable source/profile/snapshot hash linkage;
- append-only decision lineage;
- indexes for customer/capability/action/evaluated time, profile/version, request hash, and snapshot hash without exposing sensitive fields broadly;
- no balance, journal-line, or posted-value columns;
- Operations audit/idempotency integration; and
- migration up/down behavior that preserves all earlier A1/A2/A3 source tables and financial invariants.

This is a future implementation acceptance contract, not a migration or entity definition in A4T06 documentation.

## 13. Explicit A4T06 out of scope

This contract does not:

- create entities, migrations, repositories, services, controllers, APIs, or persistence;
- implement policy evaluation, profile selection, enrollment, permission, limit, or decision execution;
- implement source adapters or create snapshots at runtime;
- publish events or invoke outbox consumers;
- modify source records, A2, A3, Wallet, Ledger, Operations, or Reconciliation code; or
- begin A4T07, A4T08, A4T09, A4T10, or A5.

## 14. A4T06 verification record

- [x] Logical immutable policy-profile version record is defined.
- [x] Logical immutable policy-decision record is defined.
- [x] Profile/version identity, definition hash, effective intervals, and lifecycle are defined.
- [x] Decision history, supersession, expiry, and currentness are append-only/derived rather than destructive updates.
- [x] A4T03 snapshot reference, normalized input hash, source versions, and result hash are linked to each durable decision.
- [x] Replay, reconstruction, conflict, unavailable, and integrity-mismatch guarantees are defined.
- [x] A4/Operations storage ownership and audit/idempotency/outbox boundaries are defined.
- [x] Retention separation, privacy minimization, and legal-hold expansion are defined.
- [x] Physical implementation invariants are documented without creating entities or migrations.
- [x] No runtime policy evaluation, decision execution, entity, migration, repository, service, controller, API, or persistence is implemented.
- [ ] A4T07 deterministic policy evaluation implementation.
