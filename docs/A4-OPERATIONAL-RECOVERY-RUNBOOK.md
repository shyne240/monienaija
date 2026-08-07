# A4 Operational Recovery and Support Runbook Evidence

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T10 — A4 Integration, Reconciliation, and Release Gate
- **Status:** Runbook prepared for Operations/Security/Support review; not a production authorization
- **Classification:** Documentation-only operational recovery evidence
- **Application, database, API, migration, scheduler, notification, and financial-runtime changes in this task:** None

## 1. Operating principles

A4 recovery is policy-decision lifecycle recovery only:

- Preserve immutable profile, snapshot, decision, result-hash, source-reference, audit, idempotency, explanation, and diagnostic evidence.
- Never edit an old decision to extend expiry, remove a reason, change a policy version, replace a snapshot hash, or erase lineage.
- Never repair Customer, onboarding, eligibility, restriction, limit, enrollment, permission, risk, compliance, CustomerWallet, A3 binding, WalletAccount, Ledger, or Reconciliation source records from A4.
- Never use an A4 `ALLOW` as A2 authentication/authorization, A3 binding, account ownership, or financial execution approval.
- Never retry a financial command from an unknown policy outcome without the downstream command’s own durable verification and idempotency contract.
- Never treat a readiness report, metric, dashboard, diagnostic, or reconciliation result as a policy writer.
- Keep A4 unavailable or return a controlled non-allow/review state when required evidence, authorization, integrity, or operational evidence cannot be established.
- Preserve legal, regulatory, security, compliance, financial, dispute, and incident holds before any retention action.

The A4T09-specific lifecycle behavior is defined in [`A4-POLICY-RECOVERY-RUNBOOK.md`](A4-POLICY-RECOVERY-RUNBOOK.md). This document integrates that behavior with Operations, A2, A3, Wallet, Ledger, Reconciliation, Security/Privacy, Support, and release ownership.

## 2. Evidence sources and access

Use only purpose-bound, A2-authorized read paths and approved Operations evidence:

1. Immutable A4 policy profile/version, decision, snapshot, lineage, and hash references when physical persistence is available.
2. A4 current-effective lookup and re-evaluation result contracts.
3. A4 explanation output for the caller’s approved audience.
4. Operations audit/idempotency/diagnostic records through their owner-controlled services.
5. A2 principal, authorization, session, privileged approval, route, and security-event evidence.
6. A3 binding/read/reconciliation/control evidence through A3-owned read contracts.
7. Wallet/Ledger account dimensions and Ledger-derived read state through approved financial read paths.
8. Independent Reconciliation and Production readiness reports.
9. Application version, configuration, migration-head, deployment, request, correlation, trace, and incident records.

Do not copy raw passwords, tokens, recovery values, MFA proofs, device fingerprints, privileged fingerprints, raw risk notes, compliance comments, KYC documents, full ledger history, journal lines, mutable balances, or unrestricted snapshots into general support records.

## 3. Incident classification and immediate action

| Incident                                  | Immediate safe state                                                     | First owner                               | Evidence to preserve                                                                         | Prohibited response                                        |
| ----------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Expired or review-due decision            | Mark non-current; require new snapshot/evaluation                        | A4 / Risk / Compliance                    | Decision reference, policy version, expiry/review, snapshot hash, request/correlation IDs    | Editing the old validity time or treating it as current    |
| Stale source evidence                     | `PENDING_REVIEW`/non-current unless a stronger block applies             | Source owner / A4                         | Source class/version/freshness reason, snapshot reference, recovery result                   | Marking stale data current or changing the source from A4  |
| Conflicting source/evidence versions      | Manual review/non-allow                                                  | Source owner / Risk / A3 / Reconciliation | All relevant source references/versions, conflict reason, decision lineage                   | Selecting a convenient source or deleting the conflict     |
| Source unavailable/read timeout           | Bounded retry or controlled unavailable/retry state                      | Operations / source owner                 | Failure code, attempt count, request/correlation/trace, durable-result lookup                | Treating failure as empty/current evidence                 |
| Retired/superseded policy profile         | Historical decision remains readable; new evaluation uses active profile | A4 / Architecture                         | Old/new policy version, definition hashes, lineage, effective interval                       | Reinterpreting history under the new profile               |
| Idempotency conflict                      | Reject changed payload; preserve original outcome                        | Operations / A4                           | Scope, key, original/request hashes, request/correlation IDs                                 | Reusing the key with a changed request                     |
| Unknown evaluator outcome                 | Verify durable A4 result before retry; otherwise remain unknown          | Operations / A4                           | Decision lookup, snapshot/policy hashes, idempotency state, audit result                     | Blindly retrying or executing a financial command          |
| Explanation/redaction incident            | Disable affected read/audience/route                                     | Security / Privacy / Support              | Audience, output contract, safe samples, access/audit trail, incident hold                   | Broadening access or returning raw source evidence         |
| A2 authorization/route failure            | Keep protected path unavailable                                          | A2 / Security                             | Principal, authorization decision, route/resource scope, safe denial, session/security event | Converting A2 denial into customer policy denial or bypass |
| A3 binding/account/control failure        | Keep account-dependent capability non-active                             | A3 / Wallet / Ledger / Reconciliation     | Binding state, source versions, control report, Ledger read status                           | Inferring/reassigning account or fabricating balance       |
| Audit/idempotency/diagnostics unavailable | Fail closed or return controlled unknown/retry state                     | Operations                                | Safe transport error, request/correlation, attempted lifecycle action                        | Reporting a successful durable result without evidence     |

## 4. Standard recovery procedure

1. **Open the incident.** Record application version, branch/release, policy/profile version if known, capability/action, request/correlation/trace IDs, customer UUID only in the approved restricted incident scope, and incident owner.
2. **Classify access.** Verify the operator/support/service principal and A2 authorization. Apply need-to-know and least-privilege controls before reading classified A4/A2/A3 evidence.
3. **Freeze risky consumption.** Disable the affected internal consumer or route if a decision can be misinterpreted, expose sensitive data, or bypass A2/A3. Do not weaken route protection.
4. **Check currentness.** Use current-effective lookup. Distinguish `CURRENT`, `EXPIRED`, `REVIEW_DUE`, source-degraded, policy-retired/superseded, integrity-mismatch, and unknown states.
5. **Verify immutable linkage.** Confirm decision reference, policy/profile version and definition hash, snapshot reference and normalized input hash, result hash, source versions/freshness, and supersession lineage where available.
6. **Verify durable outcome.** For any evaluator/idempotency exception, query the durable decision and Operations idempotency record before retrying. A result found with matching scope/hash is recovered; a mismatch is a conflict/integrity incident.
7. **Collect a new snapshot when required.** Source owners or approved adapters provide a new immutable snapshot. Do not edit the old snapshot and do not mutate source rows to make the new snapshot pass.
8. **Run bounded re-evaluation.** Use the A4T09 re-evaluation contract and existing Operations idempotency scope. Allow only bounded transient retries. Stop on known contract/A2/policy conflicts.
9. **Inspect the result.** Confirm decision, recovery state, reason codes, obligations, limits, expiry/review, policy version, evidence hash, and lineage. A pending/retry/unknown/blocked result is not an allow.
10. **Apply audience filtering.** Use the A4T08 explanation service only after A2 audience authorization. Never return raw normalized evidence or restricted reason/source data.
11. **Recheck adjacent boundaries.** For account-dependent capabilities, re-read A3 binding/account/control state. For future financial consumers, recheck A2, A3, limits, ledger locks, financial invariants, command idempotency, and reconciliation independently.
12. **Close or escalate.** Record recovery audit/diagnostic evidence, source-owner action, next review time, retention/hold scope, owner, and approval. Close only when the resulting state is truthful and independently verifiable.

## 5. Recovery decision matrix

| Condition after recovery attempt                                          | A4 result/state                                      | Support interpretation                                                                     | Next action                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| New current snapshot, active profile, all gates pass                      | `COMPLETED` with `ALLOW`/`ALLOW_WITH_LIMITS`         | Policy result is current only for its declared scope and time; it is not A2/A3/A5 approval | Consumer performs independent downstream gates        |
| New snapshot has stale/conflicting/restricted required evidence           | `COMPLETED` with `PENDING_REVIEW` or stronger result | Do not execute; explain only through approved audience mapping                             | Source-owner review/new snapshot                      |
| Explicit terminal customer/eligibility/restriction/enrollment/limit block | `DENY`                                               | Truthful policy block; no source mutation                                                  | Source owner or approved review process               |
| Explicit suspension                                                       | `SUSPEND`                                            | Capability remains unavailable; no reactivation implied                                    | Source-owner resolution and new evaluation            |
| Expired/review-due predecessor, no replacement yet                        | Currentness non-current; re-evaluation required      | Historical result remains evidence only                                                    | New policy evaluation                                 |
| Transient failure, no durable result, attempts remain                     | `RETRY_SCHEDULED`/retry path                         | No decision is available for execution                                                     | Bounded retry through approved caller                 |
| Unknown failure, durable result verified                                  | `COMPLETED`/recovered                                | Use the verified immutable result; do not create a duplicate                               | Audit recovery and continue downstream checks         |
| Unknown failure, durable result absent after bound                        | `UNKNOWN_OUTCOME`                                    | Do not infer allow or retry financial execution                                            | Escalate to Operations/A4; retain incident evidence   |
| A2 denial or policy/snapshot contract conflict                            | `BLOCKED`/access denial                              | A4 cannot bypass the access/contract boundary                                              | Correct context or contract; no source mutation       |
| Explanation classification/redaction failure                              | Exposure disabled                                    | Do not return affected audience output                                                     | Security/Privacy review and redaction regression test |

## 6. Operations audit and diagnostic evidence

Recovery lifecycle actions must use shared Operations-compatible controls. Safe audit actions include:

```text
DECISION_CREATED
DECISION_REPLAYED
REEVALUATION_REQUESTED
REEVALUATION_RETRY
REEVALUATION_RECOVERED
REEVALUATION_REPLAYED
REEVALUATION_CONFLICT
REEVALUATION_BLOCKED
REEVALUATION_RETRY_SCHEDULED
REEVALUATION_UNKNOWN_OUTCOME
DECISION_REEVALUATED
```

Safe metadata may include:

- canonical customer UUID in the approved restricted scope;
- capability/action and policy version;
- decision/reevaluation/profile/snapshot references;
- request/snapshot/result hashes;
- trigger, currentness, recovery state, attempt bound, and safe failure code; and
- request/correlation/trace/causation context.

Do not include raw error payloads, credentials, tokens, MFA/device data, unrestricted snapshots, raw risk/compliance content, journal lines, or balances.

Diagnostics are observational. They cannot authorize, repair, reassign, post, or change source/financial state.

## 7. A2, A3, Ledger, and Reconciliation escalation boundaries

### A2/Security

Escalate authentication, session, MFA, principal, audience, route, privileged approval, or redaction incidents to A2/Security. Follow [`A2-OPERATIONAL-RECOVERY-RUNBOOK.md`](A2-OPERATIONAL-RECOVERY-RUNBOOK.md). A4 must not create an alternative access decision.

### A3/Wallet/Ledger

Escalate missing/stale/repair-required/suspended/closed binding, ownership/dimension mismatch, Wallet/Ledger incompatibility, or Ledger-unavailable evidence to A3/Wallet/Ledger. Follow [`A3-OPERATIONAL-RECOVERY-RUNBOOK.md`](A3-OPERATIONAL-RECOVERY-RUNBOOK.md). A4 must not repair or infer account identity.

### Reconciliation/Finance

Escalate independent reconciliation errors, unresolved binding drift, ledger discrepancies, or financial-control holds to Reconciliation/Finance. A4 may consume control evidence but cannot clear or repair it.

### Operations/Production

Escalate idempotency, audit, diagnostics, readiness, migration, deployment, request-drain, or rollback incidents to Operations/Production. The current A4 branch has physical persistence and adapter artifacts, but no live A4 migration application or production recovery drill is claimed.

## 8. Privacy, retention, and incident preservation

- Apply [ADR-0024](ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md), [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md), and [`RETENTION-POLICY.md`](RETENTION-POLICY.md).
- A4 policy history, profile versions, and snapshot attachments require a separate approved retention schedule from the one-day Operations idempotency retention.
- Legal/security/regulatory/financial/compliance/dispute holds override ordinary cleanup.
- Hold expansion may use a customer UUID, decision/profile/snapshot reference, case/payment/binding reference, correlation ID, incident ID, or security/audit reference only under the responsible owner’s access controls.
- Release of a hold triggers a new retention review; it does not authorize immediate deletion.
- Access to incident evidence is authenticated, authorized, minimized, and audited.

## 9. Runbook readiness evidence

- [x] A4T09 expiry, currentness, stale/conflicting/unavailable evidence, retry, idempotency, recovery, and unknown-outcome procedures are linked.
- [x] A2, A3, Wallet, Ledger, Reconciliation, Operations, Security/Privacy, Support, and release ownership is assigned.
- [x] Fail-closed and no-source-mutation behavior is explicit.
- [x] Explanation redaction and audience access are separate from policy evaluation.
- [x] Incident preservation and retention/legal-hold controls are recorded.
- [x] No scheduler, notification, provider, financial command, route, entity, migration, or runtime behavior is introduced by this runbook.
- [ ] Operations/Security/Privacy/Support owners approve the runbook.
- [ ] On-call/recovery drill and production adapter evidence are recorded.
- [ ] A4 phase approval is recorded.

This runbook is operational evidence for A4T10. It does not authorize production recovery, source repair, financial execution, route exposure, or A5 implementation.
