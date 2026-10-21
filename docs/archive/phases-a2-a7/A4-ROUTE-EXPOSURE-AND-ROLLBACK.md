# A4 Route Exposure, Deployment, and Rollback Evidence

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T10 — A4 Integration, Reconciliation, and Release Gate
- **Status:** Exposure and rollback evidence prepared; no A4 route approved or exposed
- **Classification:** Internal route, deployment, disable, and rollback evidence
- **Application, API, route, migration, scheduler, and financial-runtime changes in this task:** None

## 1. Exposure decision

A4T10 introduces no HTTP controller, route, API version, public endpoint, partner callback, scheduler, or external integration.

The A4 policy, explanation, and recovery services are service-level artifacts. They are not imported into [`AppModule`](../src/app.module.ts), are not registered as controllers, and do not create public exposure merely because the files exist.

| A4 capability                     | Current exposure                                        | Required future gate                                                                                                          | Current status |
| --------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Policy evaluation                 | No A4 controller or route                               | A2 principal/authorization policy, internal service contract, Operations persistence wiring, and approved data classification | Not exposed    |
| Current-effective decision lookup | No route; service-only contract                         | A2 access policy, classified decision lookup, currentness/replay controls                                                     | Not exposed    |
| Audience-specific explanation     | No route; read-only service contract                    | A2 audience/data-exposure policy for Customer, Support, Operations, or Internal Services                                      | Not exposed    |
| Re-evaluation/recovery            | No route or scheduler; service-level lifecycle contract | A2 privileged/operational caller, Operations idempotency/audit, runbook, and support ownership                                | Not exposed    |
| Policy source snapshot            | No direct source adapter route or export                | Source-owner read contracts, A2 classification, retention/hold policy                                                         | Not exposed    |

The A2 runtime route boundary remains authoritative. Existing route registration is not permission to expose A4 data. See [`A2-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A2-ROUTE-EXPOSURE-AND-ROLLBACK.md), [`A2-TRUST-BOUNDARY-THREAT-MODEL.md`](A2-TRUST-BOUNDARY-THREAT-MODEL.md), and [`A2-SECURITY-DATA-PROTECTION-CHECKLIST.md`](A2-SECURITY-DATA-PROTECTION-CHECKLIST.md).

## 2. Existing route controls retained

A4 does not alter:

- [`src/authorization/route-policy-registry.ts`](../src/authorization/route-policy-registry.ts);
- [`src/authorization/runtime-access.guard.ts`](../src/authorization/runtime-access.guard.ts);
- [`src/authorization/authorization.service.ts`](../src/authorization/authorization.service.ts);
- the explicit public health/version allowlist; or
- existing Customer, Operations, Wallet, Ledger, Reconciliation, and internal route ownership.

A future A4 route must be added only through a separately reviewed A2 route/data-exposure change. It must not return raw risk/compliance evidence, credentials, tokens, MFA proofs, device data, journal lines, balances, or unrestricted snapshots.

## 3. Deployment evidence and current deployment state

### 3.1 Current repository evidence

- The A4T03-A4T09 source compiles and the full test/lint/build/format validation passes.
- A4T06 physical policy-profile, decision, and snapshot entities, repositories, retention metadata, and migration artifacts are present.
- No A4 migration has been applied to a live database in this environment, and no live schema head is claimed.
- `CapabilityPolicyModule` wires the A4 persistence, source-evidence, Operations, profile-selection, evaluator, recovery, and replay artifacts without exposing a controller or route.
- No scheduler, notification, provider, outbox consumer, or financial command was introduced.

Because A4T10 is documentation-only, there is no A4 deployment, migration application, route canary, traffic release, or production activation to report from this repository.

### 3.2 Future controlled deployment sequence

If an approved later change wires A4 into runtime, the release owner must execute and record the following sequence:

1. Confirm A2 and A3 approval, A4 ADR review, security/privacy review, Operations ownership, and the A4 exit checklist.
2. Confirm that the proposed change has an explicit rollback/disable control and does not expose a route by default.
3. Run the lockfile-consistent build, full tests, lint, formatting, security/privacy checks, and documentation/link validation.
4. Before applying the A4T06 migration, take the database backup and execute the separately reviewed migration up/down evidence before traffic release. The current branch contains the migration artifact but does not claim live application evidence.
5. Deploy inert/service-internal A4 code with the expected application version and configuration; verify startup, readiness, audit, idempotency, diagnostics, and reconciliation signals.
6. Verify A2 authorization separation, source-owner read boundaries, immutable snapshot/hash checks, explanation redaction, and fail-closed behavior using synthetic or approved test data.
7. Enable only an approved internal consumer/route under a controlled rollout. Do not enable a financial command merely because A4 returns `ALLOW`.
8. Confirm A3 binding/account checks and any downstream limit/financial invariants remain independently enforced.
9. Record release version, migration state, feature/route control, owner, correlation/incident references, verification output, and approval before any broader exposure.

No step may create a wallet, bind an account, post a journal, change a balance, repair reconciliation, call an external provider, or activate A5.

## 4. Immediate stop conditions

Stop promotion and keep A4 unavailable to consumers when any of the following occurs:

- A2 authorization or route/data-exposure context is missing, denied, stale, or mis-scoped.
- The policy profile/version or immutable snapshot/hash cannot be verified.
- A4 returns an unexplained `ALLOW` for missing, stale, conflicting, restricted, or unavailable required evidence.
- A current-effective lookup can return an expired, review-due, retired, superseded, or integrity-mismatched allow as current.
- A changed idempotency payload does not conflict or an in-progress duplicate creates a second decision effect.
- Recovery cannot verify durable evidence after an unknown outcome.
- Operations audit/idempotency/diagnostic evidence is unavailable or unredacted.
- Customer/support explanation output exposes raw risk/compliance/security evidence.
- A3 binding, Wallet/Ledger dimensions, Ledger availability, or independent reconciliation state is unresolved for a required capability.
- Any A4 path attempts to write a source record, repair a binding, post a journal, mutate a balance, or call a financial/provider command.
- A proposed consumer treats `ALLOW` as A2 authorization, account ownership, or financial execution approval.

The safe fallback is no A4 exposure or a controlled non-allow/review state. It is never an unauthenticated or optimistic route fallback.

## 5. Rollback and disable procedure

### 5.1 Service/consumer disable

1. Stop the affected rollout and record application version, policy/profile version, feature/route control, request/correlation/trace IDs, and incident ID.
2. Disable the affected A4 consumer or internal route using the approved deployment control. Do not disable A2 session revocation, redaction, audit, or security monitoring.
3. Keep policy evaluation/recovery unavailable to the affected consumer rather than returning a fabricated allow.
4. Preserve immutable decision, snapshot, profile, idempotency, audit, explanation, diagnostic, A2, A3, and reconciliation references under the applicable incident/legal hold.
5. Stop any consumer that could execute a financial command from an unknown or non-current policy result. Do not retry financial execution blindly.
6. Check Operations audit/idempotency, diagnostics, readiness, outbox, A3 control, Ledger, and independent Reconciliation signals.
7. Restore only the last known-good service/consumer configuration after Security, Operations, Architecture, and the relevant product/financial owners approve.
8. Re-run A4 policy, explanation, recovery, A2 separation, A3 binding, no-source-mutation, and financial-invariant tests before re-enabling.
9. Record root cause, affected capability/action, policy/snapshot references, data exposure assessment, remediation owner, and release approval.

### 5.2 Application rollback

A code rollback must not silently reinterpret a durable decision under a different policy version or canonicalization rule. Before approving a rollback:

- identify whether any durable A4 decisions/profile/snapshot records were created by the newer build;
- preserve those records and their policy/snapshot/result hashes;
- confirm the older build can safely read or ignore them without treating them as current authorization;
- keep A4 consumers disabled if the older build cannot verify the newer contract/version;
- do not delete, rewrite, or downgrade historical decisions to make the older build pass; and
- record the rollback decision, compatibility assessment, owner, and incident/correlation reference.

The current branch has no physical A4 schema, so no A4 migration rollback is claimed or required by this documentation-only task.

### 5.3 Schema rollback if the A4T06 persistence migration is applied

A future A4 migration rollback is a controlled destructive decision, not an ordinary retry:

1. Disable A4 policy consumers and any approved A4 route.
2. Confirm no policy decision/profile/snapshot lifecycle command is in progress.
3. Preserve required A4, Operations audit/idempotency, legal-hold, A2, A3, and reconciliation evidence.
4. Obtain Architecture, Operations, Database, Security/Privacy, Finance, and release-owner approval.
5. Verify that the rollback preserves all A1/A2/A3 source tables and all Wallet/Ledger journals, lines, balances, and financial invariants.
6. Execute only the separately approved migration down procedure.
7. Verify readiness, migration head, audit, idempotency, reconciliation, and source-table integrity.
8. Keep A4 disabled until a schema-compatible build and replacement persistence path are approved.

A4 migration rollback must never repair source evidence, change account bindings, post compensating journals, or mutate balances.

## 6. Rollback evidence status

- [x] No A4 route/controller/API is introduced by A4T10.
- [x] A2 route/authorization ownership and future A4 exposure gates are explicit.
- [x] Current A4 source has no A4 migration/schema rollback to claim.
- [x] Service/consumer disable, historical decision preservation, fail-closed, and unknown-outcome controls are defined.
- [x] Application rollback cannot reinterpret historical policy decisions silently.
- [x] Future A4T06 schema rollback requirements preserve A1/A2/A3 and financial invariants.
- [ ] A4 route/data-exposure approval is recorded.
- [ ] Physical A4 persistence migration apply/revert evidence is recorded, if/when A4T06 introduces schema state.
- [ ] Production deployment/canary/rollback drill evidence is recorded.
- [ ] Accountable release, Security/Privacy, Operations, Risk/Compliance, Wallet/Ledger, and Reconciliation approvals are recorded.

This document is a rollback and exposure decision input. It does not authorize deployment, route exposure, migration revert, financial execution, or A4 phase approval.
