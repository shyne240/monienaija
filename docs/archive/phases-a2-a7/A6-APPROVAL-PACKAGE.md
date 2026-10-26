# A6 External Partners & Settlement Approval Package

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T11 — A6 Integration, Partner Certification, Release Gate, and A7 Handoff
- **Status:** Prepared for accountable-owner review; **not approved**
- **Classification:** Documentation-only approval and release evidence
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Executive summary

A6 implements one bounded external-rail capability inside the existing modular monolith. The selected capability is `external.wallet.withdrawal.settlement` for `NIBSS_NIP` (planning rail) with `NGN` currency and `CUSTOMER_FUNDS` accounting unit, taking explicit internal customer/account binding through A3 and approved target mapping from a verified, customer-owned, consented funding-instrument/beneficiary.

The committed artifacts establish:

- A2 authorization separation and protected-internal callback ingress;
- A6 partner capability, version, circuit-breaker, and disabled-by-default partner connection boundary;
- A4 policy / evidence / currentness / obligations / limits consumption;
- A3 source/target binding and ownership recheck;
- verified customer funding-instrument / beneficiary consumption without raw credential or metadata mutation;
- durable A6T05 external-operation identity, provider reference, and internal/provider idempotency separation;
- A6T06 callback authenticity, replay protection, freshness, partner scope, and idempotent processing;
- A6T07 external lifecycle, bounded retry, circuit-breaker, status verification, and unknown / manual-review / reconciliation states;
- A6T08 Ledger-owned settlement, suspense, exception ownership, compensating entries, and immutable Ledger history;
- A6T09 independent read-only reconciliation with classified support trace and partner certification fingerprint;
- A6T10 field-level data minimization, consent, retention, legal hold, secret handling, disclosure audience maximums, and partner payload rejection; and
- A6 disable / circuit-breaker / environment emergency-stop behavior that preserves completed internal financial history.

The package does not claim production deployment, live migration execution, partner certification, owner approval, customer activation, public exposure, external settlement, or A7 readiness.

## 2. Evidence index

| Evidence                                                                                                                                       | Purpose                                                                 | Status                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| [`A6-INTEGRATION-MATRIX.md`](A6-INTEGRATION-MATRIX.md)                                                                                         | Task-to-evidence and end-to-end trace                                   | Prepared                                              |
| [`A6-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A6-ROUTE-EXPOSURE-AND-ROLLBACK.md)                                                                       | Exposure, disable, emergency stop, rollback, prohibited edges           | Prepared; no A6 surface approved                      |
| [`A6-ADR-REVIEW-STATUS.md`](A6-ADR-REVIEW-STATUS.md)                                                                                           | ADR-0047 through ADR-0052 review register                               | Prepared; approval pending; ADR-0048 not authored     |
| [`A6-OPERATIONAL-RECOVERY-RUNBOOK.md`](A6-OPERATIONAL-RECOVERY-RUNBOOK.md)                                                                     | Recovery, support trace, ownership, stop conditions                     | Prepared; owner review pending                        |
| [`A6-EXIT-CHECKLIST.md`](A6-EXIT-CHECKLIST.md)                                                                                                 | Acceptance, validation, and exit blockers                               | Prepared; not approved                                |
| [`A6-A7-HANDOFF-PACKAGE.md`](A6-A7-HANDOFF-PACKAGE.md)                                                                                         | Permitted A7 handoff and prohibited edges                                | Prepared; handoff blocked until A6 exit               |
| [`A6-EXTERNAL-PARTNER-BASELINE.md`](A6-EXTERNAL-PARTNER-BASELINE.md)                                                                           | A6T01 baseline, capability selection, gap register                      | Committed                                             |
| [`A6-PARTNER-ADAPTER-CONTRACT.md`](A6-PARTNER-ADAPTER-CONTRACT.md)                                                                             | A6T02 adapter boundary and contract                                     | Committed                                             |
| [`A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md`](A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md)                                                     | A6T04 funding-instrument consumer contract                              | Committed                                             |
| [`A6-EXTERNAL-OPERATION-CONTRACT.md`](A6-EXTERNAL-OPERATION-CONTRACT.md)                                                                       | A6T05 identity/idempotency/reference contract                            | Committed                                             |
| [`A6-CALLBACK-INGRESS-CONTRACT.md`](A6-CALLBACK-INGRESS-CONTRACT.md)                                                                           | A6T06 callback authenticity/replay contract                             | Committed                                             |
| [`A6-EXTERNAL-OPERATION-LIFECYCLE-CONTRACT.md`](A6-EXTERNAL-OPERATION-LIFECYCLE-CONTRACT.md)                                                     | A6T07 lifecycle, retry, circuit-breaker, unknown outcomes                | Committed                                             |
| [`A6-SETTLEMENT-SUSPENSE-AND-EXCEPTION-CONTRACT.md`](A6-SETTLEMENT-SUSPENSE-AND-EXCEPTION-CONTRACT.md)                                         | A6T08 settlement/suspense/compensating-entry contract                    | Committed                                             |
| [`A6-EXTERNAL-RECONCILIATION-CONTRACT.md`](A6-EXTERNAL-RECONCILIATION-CONTRACT.md)                                                             | A6T09 reconciliation/support-trace contract                              | Committed                                             |
| [`A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md`](A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md)                             | A6T10 minimization, consent, disclosure contract                        | Committed                                             |
| [`A6-EXTERNAL-DATA-CLASSIFICATION-MATRIX.md`](A6-EXTERNAL-DATA-CLASSIFICATION-MATRIX.md)                                                       | A6T10 field classification matrix                                        | Committed                                             |
| [ADR-0047 — External Partner Adapter Boundary](ADR/ADR-0047-External-Partner-Adapter-Boundary.md)                                             | Adapter isolation and provider-neutral contract                         | Proposed; implementation-aligned                     |
| ADR-0048 — NIBSS and Bank Integration Isolation                                                                                              | Bank/NIBSS transport, credential, signing, environment                  | **Not authored** — A6T03 follow-on required          |
| [ADR-0049 — External Operation Identity, Reference, and Idempotency](ADR/ADR-0049-External-Callback-and-Reference-Idempotency.md)               | Identity/idempotency/reference boundary                                  | Proposed; implementation-aligned                     |
| [ADR-0050 — Settlement, Suspense, and Exception Ownership](ADR/ADR-0050-Settlement-Suspense-and-Exception-Ownership.md)                       | Settlement, suspense, compensating-entry boundary                        | Proposed; implementation-aligned                     |
| [ADR-0051 — External Funding-Instrument Use](ADR/ADR-0051-External-Funding-Instrument-Use.md)                                                | Funding-instrument consumer boundary                                    | Proposed; implementation-aligned                     |
| [ADR-0052 — External-Rail Data Minimization and Consent](ADR/ADR-0052-External-Rail-Data-Minimization-and-Consent.md)                           | Data minimization, consent, disclosure boundary                         | Proposed; implementation-aligned                     |
| [ADR-0053 — Independent External Reconciliation](ADR/ADR-0053-Independent-External-Reconciliation.md)                                         | Read-only reconciliation, certification fingerprint, support trace      | Proposed; implementation-aligned (outside A6 ADR range) |

## 3. Decisions requested

Accountable owners are asked to approve, approve with conditions, return, or reject the following decisions:

1. A6 remains limited to the selected NGN `external.wallet.withdrawal.settlement` capability on `NIBSS_NIP`.
2. `Customer.id`, explicit A3 binding IDs, `WalletAccount.id`, and `LedgerAccount.id` remain distinct canonical references.
3. A2 authorization remains separate from A4 policy, A6 partner capability, A3 binding, and Ledger execution.
4. The A6 internal gate sequence and fail-closed behavior (A2 → A4 → A3 → A6T05 → A6T07 → A6T08 → A6T09) are acceptable.
5. External lifecycle, immutable operation identity, callback authenticity, retry/circuit-breaker, unknown recovery, and reconciliation reference rules are acceptable.
6. Settlement posting uses one balanced customer-funds journal and remains Ledger-owned; compensating entries remain the only approved correction path.
7. Operations audit / idempotency / outbox / metrics / diagnostics / retention / request context primitives are reused for A6; no A6-local store is introduced.
8. A6T10 partner payload validation, consent assertion, retention / legal hold, secret handling, and audience-maximum evidence are sufficient.
9. Independent A6T09 reconciliation is read-only and discrepancy classifications require owner investigation, not automatic repair.
10. Partner capability is disabled by default; the actual partner, capability, version, environment, limits, and emergency-stop ownership are approved before activation.
11. The `partner-callback.controller` route is an A2-protected internal surface; it is not approved as a public customer or partner endpoint.
12. Existing routes (transfer / withdrawal / deposit / payment / bank / customer-beneficiary / customer-funding-instrument / internal / reconciliation) remain non-approved until a separate A2 route/data-exposure decision is recorded.
13. ADR-0048 (NIBSS and Bank Integration Isolation) must be authored and approved by A6T03 follow-on before any partner-specific transport / credential / signing / key-rotation evidence is claimed.
14. A6 may hand off bounded external-rail contracts to A7 only after all A6 exit conditions are approved; no A7 implementation begins from this package.

## 4. Owner approval register

No signatures, approvals, dates, or risk acceptances are fabricated.

| Owner / review                                | Required decision                                                                                                                       | Approver | Decision/date | Conditions / comments                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- | ---------------------------------------------- |
| Architecture                                  | A6 boundary, ADR-0047/0049/0050/0051/0052 modular-monolith placement, A6 prohibited edges; ADR-0048 authoring blocker                     | Pending  | Pending       | Review integration matrix and ADR register; require ADR-0048 before any partner-specific evidence |
| Security / A2                                 | Exact authorization, partner capability mutation, route/data exposure, callback authentication, secret rotation, support access        | Pending  | Pending       | Keep `partner-callback.controller` non-public   |
| Privacy / Legal / Compliance                  | Data sharing, consent/mandate, retention, legal hold, partner payload rejection, restricted evidence access                           | Pending  | Pending       | Confirm A6T10 partner payload rejection policy |
| Customer Engineering                          | Customer identity, command/correlation, support trace, audience controls                                                               | Pending  | Pending       | Confirm canonical `Customer.id` use              |
| Wallet / A3                                   | Binding, ownership, account dimensions, lifecycle, repair/read boundaries                                                              | Pending  | Pending       | Confirm no command-side repair/reassignment     |
| A4 / Product / Risk                           | Policy profile, currentness, limits/obligations, expiry, risk/compliance boundaries                                                     | Pending  | Pending       | Confirm A4 remains policy authority             |
| Ledger / Finance                             | Account chart, double-entry, posting, balance, journal immutability, settlement/suspense, compensating entries                          | Pending  | Pending       | Confirm no external financial authority         |
| Partner owner (NIBSS_NIP)                    | Capability/version enablement, signing envelope, sandbox/certification                                                                  | Pending  | Pending       | Confirm disabled-by-default; require certification |
| Operations                                    | Audit / idempotency / outbox / metrics / diagnostics, recovery, on-call, retention, control mutation history                            | Pending  | Pending       | Approve outbox / circuit-breaker / disable signals |
| Reconciliation                                | Read-only report, discrepancy ownership, stop thresholds, support-trace classification                                                  | Pending  | Pending       | Confirm no report-driven repair                 |
| Support                                       | Support trace, incident workflow, customer/internal communication                                                                       | Pending  | Pending       | Approve runbook and escalation                  |
| Database / Release                            | Migration apply/rollback (`1785753600026`–`1785753600030`), deployment, readiness, disable drill                                       | Pending  | Pending       | No live execution evidence in repository        |
| Product / A6 owner                            | Partner, capability, version, limits, thresholds, go/no-go, rollback ownership                                                          | Pending  | Pending       | Capability remains disabled by default          |

## 5. Go/no-go recommendation

### Current recommendation

```text
NO-GO — IMPLEMENTATION EVIDENCE COMPLETE, APPROVAL / PARTNER CERTIFICATION / ACTIVATION CONDITIONS OPEN
```

### Go conditions

All of the following must be recorded before any partner activation:

- A2 / A3 / A4 phase approvals, including route/data exposure for the A2-protected `partner-callback.controller` and any A6 internal caller.
- A6 ADR-0047 / ADR-0049 / ADR-0050 / ADR-0051 / ADR-0052 review and accountable owner decisions.
- **ADR-0048 (NIBSS and Bank Integration Isolation) authored and approved.**
- Finance / Ledger settlement / suspense / compensating-entry approval.
- Privacy / Security / Legal approval for partner sharing, consent, retention, legal hold, and disclosure.
- Partner owner approval for `NIBSS_NIP` capability/version, signing envelope, callback authentication, and environment.
- Partner certification (NIBSS or approved sandbox) with expected/observed checks and evidence.
- Live migration up/down and deployment/rollback evidence for `1785753600026`–`1785753600030`.
- Environment emergency-stop, durable partner capability disable, and circuit-breaker ownership/test evidence.
- Operations / Reconciliation / Support on-call and recovery approval.
- Successful and failure-path evidence using approved test/synthetic data, including duplicate / replay / changed-payload / timeout / unknown / callback replay / circuit-open / reconciliation `ERROR` / A6T10 partner payload rejection / disable behavior.

### No-go conditions

A6 remains disabled if any required identity, gate, control, account, policy, callback, idempotency, audit, outbox, reconciliation, partner, deployment, sharing, consent, retention, or approval evidence is missing, stale, conflicting, unavailable, or unexplained.

## 6. Explicit non-claims

This approval package does not claim:

- a production or staging partner is active;
- a live database migration has been applied or rolled back;
- money has moved through a partner;
- NIBSS or any other partner has been certified;
- customer-facing route / API / mobile / web exposure;
- security / privacy / legal / Finance / Risk / Compliance / Operations approval;
- ADR-0048 authorship or approval (it is not authored);
- public exposure of the `partner-callback.controller` route; or
- A6 entry approval for A7.

## 7. Approval outcome rules

- **Approve:** Record owner, date, conditions, evidence references, and follow-up owner.
- **Approve with conditions:** Record every condition, owner, severity, mitigation, stop condition, and rollback behavior. Conditions cannot weaken A2 / A3 / A4 / A6 / Ledger / Operations / Reconciliation / Privacy / Security / Legal boundaries. **Conditions must include a recorded decision to author and approve ADR-0048 before any partner-specific evidence is claimed.**
- **Return with comments:** Keep status conditional and identify required evidence before re-review.
- **Reject:** Require a revised / superseding boundary decision before affected implementation or activation.
- **No response:** Remains pending; no activation is authorized.
