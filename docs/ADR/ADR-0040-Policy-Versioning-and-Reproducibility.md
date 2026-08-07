# ADR-0040: Policy Versioning and Reproducibility

- **Status:** Proposed A4 decision input; no runtime implementation
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Product, Risk, Compliance, Security, Finance, Operations, Customer Engineering, Wallet, Ledger, Reconciliation, and Data/Privacy owners
- **Scope:** Immutable A4 policy-profile versions, policy decisions, snapshot linkage, history, replay, retention, and audit
- **Task:** A4T06 — Policy Versioning, Decision Persistence, and Reproducibility
- **Implementation status:** Documentation-only persistence contract; no entity, migration, repository, service, controller, API, evaluator, or runtime behavior is introduced

## Context

A4T02 defines `A4-CAPABILITY-POLICY.v1`, the A4 authority, the capability/action namespace, the bounded decision vocabulary, and the distinction between policy, A2 authorization, A3 binding, and financial execution.

A4T03 defines an immutable normalized evidence snapshot with source references, source versions, neutral freshness states, privacy classification, and `normalizedInputHash`.

A4T04 defines deterministic precedence and conflict outcomes. A4T05 defines capability profiles, enrollment/permission requirements, exact limit inputs, obligations, and the boundary between configured limits and downstream usage.

A4 needs durable history so that a later support, risk, compliance, finance, or reconciliation investigation can answer:

```text
Which policy profile/version was used?
Which normalized evidence snapshot was observed?
Which source versions and freshness states were included?
Which request and authorization context asked for the decision?
What immutable result was returned at that time?
Can the result be replayed and independently verified?
```

A policy decision must not change merely because a source record, profile, or current policy later changes. Conversely, a current consumer must not reuse an expired or superseded decision as if it were current.

## Decision

### 1. A4 persistence authority

The A4 Capability & Policy Engine owns two logical immutable record classes:

1. **Policy profile version** — the immutable definition of a capability/action policy profile.
2. **Policy decision record** — the immutable result produced for one canonical customer/capability/action request and one policy profile version/evidence snapshot.

A4 also owns the linkage metadata needed to identify an immutable A4T03 evidence snapshot. This may be stored as an immutable content-addressed attachment or through an equivalent approved immutable snapshot store; the physical choice is an implementation detail subject to the contract in [`A4-POLICY-PERSISTENCE-CONTRACT.md`](../A4-POLICY-PERSISTENCE-CONTRACT.md).

A4 persistence is a decision/evidence authority only. It does not own:

- Customer, onboarding, eligibility, restriction, limit, enrollment, permission, risk, or compliance source records;
- A2 principals, sessions, authorization, MFA, or privileged approvals;
- A3 bindings, WalletAccounts, LedgerAccounts, journals, lines, balances, or reconciliation results; or
- financial command execution or external-provider state.

### 2. Policy profile version identity

A policy profile version is identified by the tuple:

```text
profileKey
+ profileVersion
+ capability
+ actions[]
+ definitionHash
```

The result additionally exposes the A4T02 `policyVersion` reference. `policyVersion` is an immutable A4-owned reference and is not derived from a migration timestamp, source row version, request ID, or idempotency key.

`definitionHash` is:

```text
lowercase SHA-256(canonical JSON(immutable policy-profile definition))
```

The canonical definition includes the profile key/version, capability/actions, evidence requirements, enrollment/permission requirements, risk/compliance modes, account-binding requirement, limit requirement, obligations, allowed decisions, and contract versions. It excludes transport IDs, actor presentation fields, request IDs, correlation IDs, and idempotency keys.

### 3. Policy profile lifecycle

The logical profile-version lifecycle is:

```text
DRAFT -> ACTIVE -> RETIRED
   \-> REJECTED / ABANDONED
```

Rules:

- A `DRAFT` definition is not eligible for a policy decision.
- The content of a profile version becomes immutable before it can become `ACTIVE` or be referenced by a decision.
- A changed profile creates a new `profileVersion` and new `definitionHash`; it never edits a version already used by a decision.
- Only one effective active profile version may apply to a capability/action at a given evaluation time.
- Activation and retirement metadata are audited lifecycle facts; they do not change the immutable definition content.
- `RETIRED` prevents new evaluations after its effective interval but remains readable for historical replay and support reconstruction.
- A retired profile version is never deleted merely because a newer version exists.
- A profile version is never silently reused for a different capability/action or product key.

### 4. Policy decision identity and immutability

A policy decision record is identified by a non-reusable opaque `decisionReference` and contains:

```text
customerId
capability
action
profileKey
profileVersion
policyVersion
decision
requestHash
snapshotReference
normalizedInputHash
resultHash
requestedAt
evaluatedAt
expiresAt?
reviewAt?
reasonCodes
explanationReference
obligations/limitOutput
sourceReferences
authorizationContextReference
request/correlation/causation context
```

Rules:

- A decision record is append-only and immutable after creation.
- A source update never edits an old decision; a new evaluation creates a new decision record.
- A policy-version change never rewrites historical decisions.
- Expiry is represented by the immutable `expiresAt`/`reviewAt` values or derived currentness; it is not a destructive mutation.
- Supersession is represented by a new decision's `supersedesDecisionReference` or an equivalent immutable lineage fact. The old record remains unchanged.
- `decisionReference` is never recycled, even after retention cleanup or source deletion.
- The decision record stores references, versions, hashes, safe reasons, obligations, and limit outputs—not raw source entities, credentials, unrestricted case evidence, journal lines, or mutable balance truth.

### 5. Snapshot linkage

Every durable policy decision must link to the exact immutable evidence used:

```text
snapshotReference
normalizedInputHash
snapshotContractVersion
snapshotCollectedAt
sourceReferences[]
sourceVersions/freshness states
```

The linkage must satisfy:

1. `normalizedInputHash` equals the A4T03 canonical hash of the normalized request scope and source items used for the decision.
2. `snapshotReference` resolves to an immutable snapshot attachment or equivalent content-addressed evidence artifact retained under the decision's history policy.
3. The decision stores source IDs/versions/freshness references even when the full minimized snapshot is stored separately.
4. A snapshot attachment is not a source authority and cannot be updated to make a later decision reproducible.
5. If an attachment cannot be retained because of a classified/held-data rule, the decision must record a controlled reconstruction limitation; it must not claim exact replay from a hash alone.
6. A later evaluator may create a new snapshot for current policy evaluation, but it must not overwrite the old linked snapshot.

### 6. Decision and result hashes

A durable decision uses three distinct hashes:

| Hash                  | Canonical input                                            | Purpose                                               |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| `requestHash`         | A4T02 normalized business request                          | Operations idempotency and changed-payload detection. |
| `normalizedInputHash` | A4T03 normalized request scope plus source items/freshness | Snapshot identity and evidence integrity.             |
| `resultHash`          | Canonical policy result excluding transport-only metadata  | Detects result drift during replay/reconstruction.    |

A `resultHash` must include the policy version, capability/action, decision, reason codes, explanation/obligation references, limits, source-reference set, freshness summary, and expiry/review values. It must exclude request/trace/correlation presentation fields that do not change the policy result.

A hash is integrity evidence, not customer identity, financial identity, authorization, or a replacement for source IDs and versions.

### 7. Replay and historical reconstruction

#### 7.1 Exact idempotent replay

For the same Operations scope/key and the same `requestHash` while the idempotency record is retained:

- return the original durable decision result and `decisionReference`;
- do not evaluate a new policy version;
- do not collect a different snapshot;
- do not create a second decision effect; and
- record a replay/audit fact through Operations according to the later runtime contract.

A different `requestHash` under the same scope/key is a conflict and performs no policy decision mutation.

#### 7.2 Historical reconstruction

A historical decision is exactly reconstructable only when all of the following remain available:

- the immutable profile version and `definitionHash`;
- the immutable snapshot attachment/reference and `normalizedInputHash`;
- the decision record and `resultHash`;
- the source-reference/version/freshness set needed to inspect the provenance; and
- the policy contract/canonicalization versions used at the time.

Reconstruction procedure:

1. Load the immutable decision record by `decisionReference`.
2. Resolve the immutable profile version by `policyVersion`/`profileVersion` and verify `definitionHash`.
3. Resolve the immutable snapshot by `snapshotReference` and verify `normalizedInputHash`.
4. Reconstruct the logical policy input without reading current source rows as substitutes for historical values.
5. Re-run the later deterministic evaluator against the historical profile/snapshot.
6. Canonicalize the result and compare `resultHash`.
7. Report exact match, integrity mismatch, or unavailable evidence without overwriting the historical record.

Current source rows may be inspected as additional context, but they cannot replace the historical snapshot for an exact replay.

#### 7.3 Replay outcomes

A later implementation must distinguish:

```text
REPLAY_EXACT
REPLAY_REFERENCE_ONLY
REPLAY_UNAVAILABLE
REPLAY_CONFLICT
REPLAY_INTEGRITY_MISMATCH
```

- `REPLAY_EXACT`: stored result and reconstructed result match.
- `REPLAY_REFERENCE_ONLY`: stored immutable result is available but full snapshot reconstruction is not requested or not available.
- `REPLAY_UNAVAILABLE`: required profile/snapshot/evidence attachment cannot be resolved.
- `REPLAY_CONFLICT`: request key/hash or supplied replay assertion conflicts.
- `REPLAY_INTEGRITY_MISMATCH`: reconstructed canonical result does not match the stored `resultHash`; preserve evidence and escalate.

No replay outcome may fabricate a current decision or silently rewrite history.

### 8. Current decision versus historical decision

A historical decision is not automatically a current decision:

- `expiresAt`/`reviewAt` determine time validity where the profile requires it;
- a source change does not edit history but may require a new evaluation;
- a profile retirement prevents new use after its effective interval but does not invalidate past results;
- a superseding decision is a new immutable record; and
- a current consumer must evaluate the current A2 authorization, A3 binding, source freshness, and capability profile as required by its contract.

A4 must never use a historical `ALLOW` to bypass current A2, A3, source, limit, or financial checks.

### 9. Storage ownership and logical lifecycle

| Logical record                    | Owner                                                                                      | Mutable content                                                                | Immutable content                                                                                                             | Lifecycle/retention rule                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Policy profile definition version | A4 policy authority                                                                        | Draft/activation metadata only before publication; lifecycle facts are audited | Profile key/version, capability/actions, requirements, obligations, definition hash, contract versions                        | Active versions can be retired but not rewritten/deleted while referenced.               |
| Policy decision record            | A4 policy authority                                                                        | None after creation                                                            | Subject, request scope, policy version, decision, reasons, limits/obligations, source references, hashes, timestamps, lineage | Append-only; expiry/supersession do not rewrite the original.                            |
| Evidence snapshot attachment      | A4 policy authority as minimized evidence custodian; source owners retain source authority | None after capture                                                             | Snapshot contract, normalized items, freshness, source references, hash                                                       | Retain with linked decision/profile obligations and legal holds; never update in place.  |
| Audit event                       | Operations                                                                                 | Operational query/retention handling under Operations                          | Action, actor, safe before/after/context values, timestamps                                                                   | Use `AuditService`; retention/holds follow Operations and dataset-owner rules.           |
| Idempotency record                | Operations with A4 command scope                                                           | Status, hit count, response, expiry under Operations contract                  | Scope/key/hash and original outcome linkage                                                                                   | Retention may expire the deduplication record but cannot delete policy decision history. |
| Outbox fact, if later approved    | Operations stores; A4 owns policy fact meaning                                             | Publisher lifecycle only                                                       | Minimal event identity/payload at commit                                                                                      | No external publication in A4T06; pending facts are never ordinary-cleaned.              |

### 9.1 No shared financial ownership

Policy-profile, decision, and snapshot storage must not contain:

- LedgerAccount, journal-line, or balance authority columns;
- mutable customer balance fields;
- fields that permit account reassignment;
- a replacement `CustomerWallet`/`WalletAccount` relationship; or
- financial command state that belongs to A5/financial domains.

A4 may store an explicit A3 binding/reference and source snapshot link as evidence. The linked account remains owned by A3/Wallet/Ledger.

### 10. Audit and idempotency requirements

All later profile/decision lifecycle mutations must use shared Operations controls:

- `AuditService` records profile publication, activation, retirement, decision creation, replay, conflict, reconstruction failure, integrity mismatch, and administrative recovery actions.
- Audit facts include actor/principal reference, action, profile/decision/snapshot references, policy version, hashes, prior/current lifecycle facts where applicable, request ID, correlation ID, and causation ID.
- Audit payloads are redacted and must not contain raw credentials, tokens, compliance comments, risk notes, full snapshots, or unnecessary customer/KYC data.
- Durable/retryable decisions use the A4 scope `policy.capability-decision.v1` and A4T02 canonical `requestHash` through `IdempotencyService`.
- An idempotency replay returns the original decision; changed payloads conflict; an in-progress duplicate does not create a second decision.
- Idempotency expiration does not make the old decision reference, profile version, snapshot, or source identifiers reusable.
- A transactional outbox fact is optional and requires a later approved consumer/event contract; A4T06 does not publish externally.

### 11. Retention, privacy, and legal holds

Policy history is not governed by the one-day idempotency default. The later retention design must distinguish:

| Dataset                                | Required baseline                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active/retired policy profile versions | Retain while referenced by any decision, audit, incident, dispute, compliance, finance, or legal hold. Never delete a referenced profile.                                             |
| Policy decision records                | Retain under an approved policy/financial/compliance schedule; no ordinary cleanup may remove a decision needed for historical explanation.                                           |
| Snapshot attachments                   | Retain at least with linked decision history or until an approved minimized-reference policy permits disposal; preserve exact replay requirements.                                    |
| Policy audit events                    | Use Operations audit retention only after checking profile/decision/snapshot holds and domain schedules; the current Operations default is not a complete A4 policy-history schedule. |
| Idempotency records                    | Existing Operations default is one day/configurable; expiry removes deduplication evidence only, not the decision record.                                                             |
| Draft/unreferenced profile material    | Controlled cleanup may be considered only after no decision/reference/hold dependency remains.                                                                                        |

Privacy rules:

- Store source references, versions, hashes, classifications, and minimum normalized values rather than raw source payloads.
- Highly Restricted risk, compliance, security, and financial-control evidence requires purpose-bound access through A2.
- A snapshot attachment is not a general support export or diagnostic payload.
- Legal, regulatory, security, financial, compliance, dispute, or investigation holds override ordinary cleanup.
- Hold scope may expand through customer UUID, profile/decision/snapshot reference, case, payment reference, A3 binding, correlation ID, or incident ID; expansion is recorded by the responsible owner.
- Releasing a hold does not immediately delete a record without re-evaluating the ordinary schedule.

### 12. Alternatives considered

#### Store only the latest policy decision

Rejected. It would erase the policy version, evidence, reason, and source history needed to explain prior decisions and investigate disputes.

#### Store only the normalized input hash

Rejected. A hash detects identity/integrity but cannot reconstruct the evidence or explain the historical outcome. A decision must retain or link to a minimized immutable snapshot attachment and source references.

#### Recompute historical decisions from current source rows

Rejected. Current source state can differ from the state observed at the original evaluation. Exact replay requires the historical profile and snapshot, not a fresh read.

#### Mutate an old decision to mark it superseded or expired

Rejected. Historical identity and result must remain immutable. Currentness is derived from time/lineage or represented by a new append-only fact.

#### Use idempotency retention as policy-decision retention

Rejected. Idempotency is short-lived command deduplication; policy decisions and evidence may require longer historical retention and legal holds.

#### Put policy decisions in Customer or CustomerEligibility tables

Rejected. A4 owns a derived decision boundary with different versioning, source references, retention, and replay requirements. Source records remain source owners.

## Consequences

### Positive

- Every decision is linked to an immutable profile, snapshot, source versions, request hash, and result hash.
- Historical decisions remain explainable after source and policy changes.
- Replay cannot silently produce a new outcome or mutate an old record.
- Short-lived idempotency cleanup cannot erase durable policy history.
- Policy storage remains separate from Customer, A2, A3, Wallet, Ledger, Operations, and Reconciliation source authorities.

### Trade-offs

- A4 must retain or securely link minimized snapshot attachments, not only hashes.
- Profile publication and decision history require explicit retention and hold handling.
- Reproducibility depends on stable canonicalization and contract-version rules.
- Storage grows with immutable decision history and evidence references; cleanup must be controlled rather than opportunistic.

## Dependencies and references

- [`A4-IMPLEMENTATION-PLAN.md`](../A4-IMPLEMENTATION-PLAN.md)
- [`A4-POLICY-BASELINE.md`](../A4-POLICY-BASELINE.md)
- [`A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md`](../A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md)
- [`A4-NORMALIZED-EVIDENCE-SNAPSHOT.md`](../A4-NORMALIZED-EVIDENCE-SNAPSHOT.md)
- [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](../A4-POLICY-REQUEST-RESULT-CONTRACT.md)
- [`A4-CAPABILITY-PROFILE-CONTRACT.md`](../A4-CAPABILITY-PROFILE-CONTRACT.md)
- [`A4-POLICY-PRECEDENCE-MATRIX.md`](../A4-POLICY-PRECEDENCE-MATRIX.md)
- [`ADR-0036-Customer-Capability-Policy-Authority.md`](ADR-0036-Customer-Capability-Policy-Authority.md)
- [`ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md`](ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md)
- [`CROSS-CUTTING-CONTRACTS.md`](../CROSS-CUTTING-CONTRACTS.md)
- [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](../IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md)
- [`RETENTION-POLICY.md`](../RETENTION-POLICY.md)
- [`A2-SECURITY-DATA-PROTECTION-CHECKLIST.md`](../A2-SECURITY-DATA-PROTECTION-CHECKLIST.md)
- [`ADR-0008-Operational-Resilience.md`](ADR-0008-Operational-Resilience.md)

## A4T06 verification record

- [x] Immutable policy-profile version identity, definition hash, capability/action mapping, and lifecycle are defined.
- [x] Immutable policy-decision identity, result fields, request hash, snapshot linkage, source references, and result hash are defined.
- [x] Historical decision lineage, expiry, supersession, and current-versus-historical behavior are defined without mutating old records.
- [x] Exact replay, reference-only replay, unavailable replay, conflict, and integrity-mismatch outcomes are defined.
- [x] Storage ownership is assigned to A4 for policy artifacts and to Operations for audit/idempotency/outbox primitives.
- [x] Snapshot retention, policy history retention, idempotency separation, privacy minimization, and legal-hold behavior are defined.
- [x] A4 storage cannot become Customer, A2, A3, Wallet, Ledger, or Reconciliation source authority.
- [x] No entity, migration, repository, service, controller, API, evaluator, persistence, or runtime behavior is implemented.
- [ ] A4T07 runtime policy evaluation and decision execution.
