# A6 Route Exposure, Disable, and Rollback Evidence

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T11 — A6 Integration, Partner Certification, Release Gate, and A7 Handoff
- **Status:** Exposure and rollback package prepared; no A6 route approved, partner certified, or capability activated
- **Classification:** Documentation-only route, deployment, disable, and rollback evidence
- **Application, database, API, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Exposure decision

A6T11 introduces no controller, public API, route, scheduler, broker, provider, settlement rail, notification path, or external event publisher. The A6T01-A6T10 implementation artifacts include a callback ingress controller (`partner-callback.controller.ts`) registered under an A2-protected internal route surface, but the controller is **not** exposed as a public customer or partner endpoint and is governed by the A2 route/data-exposure policy.

Route existence is not evidence of A6 exposure. Each surface must be evaluated against A2 audience authorization, partner credential isolation, and the selected capability contract.

| Surface                                          | Repository status                            | A6 interpretation                                                                                                              | Required exposure decision                          |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `partner-callback.controller.ts` (callback HTTP) | Registered but A2-protected internal route   | Not a public customer/partner route; protected by `RuntimeAccessGuard` and adapter authentication; not the selected rail's contract endpoint | A2 protected-internal route + partner auth decision  |
| `partner-connection.service.ts` (outbound)       | Internal service                             | No route; outbound only through the disabled-by-default `NIBSS_NIP` connection profile; not a public surface                     | Partner owner + Security + Operations approval        |
| `partner-capability.registry.ts`                 | In-process registry                           | No route; capability/version matrix used by the adapter; not a public surface                                                    | Architecture + partner owner approval                |
| `external-operation.service.ts`                  | Internal service                             | No route; durable identity/correlation, no provider call, no settlement                                                          | Approved internal execution caller only              |
| `external-settlement.service.ts`                 | Internal service                             | No route; verified-outcome settlement; Ledger-owned journal/line posting                                                        | Finance/Ledger approval                              |
| `external-reconciliation.service.ts`             | Internal read-only service                   | No route; support/control access remains A2-governed; produces classified support trace                                          | Approved Operations/Reconciliation read path          |
| `external-data-minimization.service.ts`          | Internal service                             | No route; partner payload validation; consent, retention, legal hold, secret handling, audit `A6_EXTERNAL_DATA_CONTROL` evidence | Privacy/Security/Legal/Compliance approval           |
| Outbox persistence                                | Operations table/service                     | No publisher or consumer route                                                                                                  | Operations-owned persistence only                    |
| Audit / idempotency / metrics / diagnostics      | Operations services                          | No route; no A6 surface                                                                                                          | Operations-owned evidence only                       |

No existing route is allowed to bypass A2 authorization, A4 policy, A3 binding, Ledger invariants, Operations idempotency, or A6T09 reconciliation controls.

## 2. Partner enablement prerequisites

Before any approved internal caller can execute the selected external capability, accountable owners must record:

1. A2 protected-internal route/data policy for the exact source customer, callback audience, and external command scope.
2. A3 binding/read/reconciliation approval for the explicit internal source/target account chain.
3. A4 policy/profile/version and current-evidence approval for `external.wallet.withdrawal.settlement` on `NIBSS_NIP` with explicit limits, obligations, and expiry.
4. A6 partner capability configuration with explicit `NIBSS_NIP` partner key, capability key `external.wallet.withdrawal.settlement`, capability version, and `enabled = true` under partner owner authority.
5. `A6_PARTNER_CONNECTION_DISABLED = true` (default) under Operations/Release ownership; the connection is disabled-by-default and the partner capability is unreachable until a recorded release decision flips both.
6. A2 protected-internal `partner-callback.controller` route policy (audience, scope, signature/MAC, freshness) approved by Security and Architecture.
7. A2 audience/scope policy for A6T10 partner payload validation and A6T09 reconciliation read paths under approved principals.
8. Provider credentials, signing key, mTLS material, and callback secret referenced through approved secret/configuration controls (no secret material in the repository, logs, traces, audit `newValues`, or support output).
9. Ledger/Finance chart/account and posting approval for the settlement and suspense dimensions used by A6T08.
10. Operations audit, idempotency, outbox, metrics, diagnostics, readiness, retention, and request-context ownership for A6-specific evidence.
11. Live migration up/rollback evidence for migrations `1785753600026` through `1785753600030`.
12. Independent A6T09 reconciliation verification and a support trace test.
13. A recorded A6 approval decision; implementation artifacts alone do not activate the partner or the capability.

Until all conditions are recorded, the partner connection remains disabled, the callback route is not exposed, and the selected capability is unreachable.

## 3. Disable controls

A6 has three independent disable controls that are safe to combine and that preserve completed internal financial history.

### 3.1 Durable partner capability disable

```text
PartnerCapabilityRegistry.setEnabled(partnerKey: NIBSS_NIP, capabilityKey: external.wallet.withdrawal.settlement, enabled: false)
```

This requires an A2-authorized privileged mutation, uses Operations idempotency, and records an audit fact. It stops new external-operation admission for the selected partner/capability. It does not change external-operation, reference, callback, settlement, suspense, journal, audit, or reconciliation records.

### 3.2 Environment emergency stop (partner connection)

```text
A6_PARTNER_CONNECTION_DISABLED=true
```

This process-wide kill switch disables the partner connection (default state) and denies new external admission before provider request submission, lifecycle advance, or financial execution. It is validated by the environment schema and is owned by Operations/Release. It is not a customer-facing setting.

### 3.3 Circuit-breaker (partner isolation)

The `partner-circuit-breaker.service.ts` opens on partner transport failure, rate-limit, timeout, or repeated ambiguous outcomes. Once open, the circuit rejects new provider requests with a deterministic `PARTNER_CIRCUIT_OPEN` outcome and routes the operation to the A6T07 recovery path. The breaker transitions to `HALF_OPEN` only after an owner-controlled reset window. It is owned by Operations and never deletes financial history.

If any of the three controls denies admission, the safe result is a deterministic denial. It is not a failed financial transaction, a cancellation of a completed settlement, or an instruction to rewrite history.

## 4. Immediate stop conditions

Stop new external admission and escalate when any condition occurs:

- environment emergency stop is active or partner capability configuration cannot be established;
- durable partner capability is missing, disabled, invalid, or has an empty/unapproved partner/capability/version;
- the customer is not within an approved A2/A3/A4 boundary or the funding-instrument is not verified, current, purpose-compatible, or consented;
- A2 authorization failure, A4 non-current/non-allow result, or A3 binding/account discrepancy;
- ledger journal imbalance, account/currency/accounting-unit mismatch, or negative-balance protection failure;
- repeated `UNKNOWN`, `MANUAL_REVIEW`, or reconciliation-driven `PENDING` outcomes;
- external-operation / callback / provider reference / settlement / journal / outbox correlation is missing or inconsistent;
- outbox event missing, duplicated, payload-mismatched, or corrupted;
- audit/idempotency evidence cannot be persisted through the shared Operations services;
- A6T09 reconciliation reports an `ERROR` discrepancy;
- callback authenticity, replay protection, freshness, partner scope, or reference validation fails;
- partner payload contains raw secret, customer/wallet/ledger/journal identity, raw risk/compliance note, or raw device fingerprint;
- consent/mandate is missing, expired, revoked, or jurisdiction/purpose-mismatched;
- any change would require editing completed journals, lines, balances, transfers, operations, or outbox facts; or
- any proposal introduces public exposure, external providers, settlement, notifications, or A7 work.

The safe action is to deny/hold new external operations, preserve evidence, and escalate to the owning boundary. The safe action is never to weaken a gate, infer an identity, retry an ambiguous outcome with a new key, or edit source history.

## 5. Deployment and activation sequence

If an approved later release activates the selected external capability, the release owner must:

1. Confirm the A6 approval package and all upstream A1/A2/A3/A4/A5 approvals, including Finance/Ledger posting and Privacy/Security sharing decisions.
2. Confirm migration backup, apply, rollback, and readiness evidence for migrations `1785753600026` through `1785753600030`.
3. Deploy code with the partner connection disabled (`A6_PARTNER_CONNECTION_DISABLED=true`) and the partner capability disabled (`enabled = false`).
4. Verify application startup, migrations, Operations audit/idempotency/outbox, diagnostics, and read-only A6T09 reconciliation.
5. Configure the selected `NIBSS_NIP` / `external.wallet.withdrawal.settlement` capability with the exact version, limits, obligations, and audience required by A4.
6. Run synthetic/internal validation through the complete A2 → A4 → A3 → A6T05 → A6T07 → A6T08 → A6T09 trace.
7. Verify duplicate/replay, changed payload, retry exhaustion, timeout/unknown, callback replay, circuit-breaker, reconciliation discrepancy, data-minimization rejection, and disable behavior.
8. Obtain the recorded go/no-go decision from Architecture, Security, Privacy, Legal, Finance, Ledger, Operations, Reconciliation, Support, and the partner owner.
9. Keep the environment emergency stop and durable partner capability disable available; record release version, control version, partner, capability, incident channel, and rollback owner.
10. Enable only the approved internal caller path; do not make the existing `partner-callback.controller` route public by default.
11. Maintain a fixture-based partner certification record (`PartnerCertificationEvidence`) before live activation.

No step silently broadens the cohort, the partner, or the capability, or converts an A4 allow into a public product capability.

## 6. Rollback-safe disable procedure

1. Set `A6_PARTNER_CONNECTION_DISABLED=true` and durably disable the partner capability (`enabled = false`).
2. Confirm new external operations receive the expected deterministic denial code and do not reach the partner adapter, callback, or Ledger.
3. Preserve current external-operation IDs, version, partner/capability/version, customer/account/resource IDs, request/correlation/trace/causation, callback receipts, provider references, settlement, suspense, journal, outbox, audit, idempotency, and reconciliation records.
4. Do not cancel, delete, reverse, edit, or backfill completed external operations, settlements, journals, lines, balances, or outbox facts as part of disable.
5. Verify A6T09 independent reconciliation and outbox/audit diagnostics for in-flight and completed operations.
6. Place any `PENDING_VERIFICATION`, `SUBMITTING`, `MANUAL_REVIEW`, or `UNKNOWN` operations into the approved A6T07 recovery path; do not retry blindly.
7. If code rollback is required, verify compatibility with the A6 migration set (`1785753600026`–`1785753600030`) before deployment.
8. Keep new admission disabled until the root cause, mitigation, owner, and re-enable approval are recorded.
9. Re-enable only through a new authorized control mutation and explicit release decision.
10. Treat any approved financial correction as a Ledger/Finance compensating-entry decision outside A6T11.

A rollback changes admission and the partner connection state, not financial history.

## 7. Callback ingress exposure rules

- The `partner-callback.controller` route is an A2-protected internal surface, not a public endpoint.
- A2 must record a specific audience/scope for partner callbacks before the route is enabled.
- The controller must validate signature/MAC, freshness, partner scope, and schema before any A6T06 callback ingestion runs.
- The controller must not accept unauthenticated, stale, replayed, malformed, wrong-partner, or wrong-environment callbacks.
- The controller must not write financial state directly; all settlement/suspense/recovery writes go through the Ledger/Finance boundary.
- A callback handler that fails authenticity or replay protection must not advance lifecycle, settlement, journal, outbox, or customer-visible state.

## 8. Prohibited production edges

A6T11 does not authorize or implement:

- public customer activation or broad rollout;
- mobile/web/API exposure;
- external banks, NIBSS, payment providers, settlement, suspense, callbacks, or partner reconciliation (live);
- deposits, withdrawals, bill payments, fees, FX, cards, QR, payroll, credit, savings, or product expansion;
- notifications or customer messaging;
- background schedulers, brokers, queues, or external event publishers;
- automatic reconciliation repair, automatic suspense clearing, or financial correction outside Ledger/Finance; or
- A7, A8, or product roadmap expansion.

## 9. Evidence status

- [x] A6 surfaces are explicitly classified as not public exposure; callback controller is A2-protected internal.
- [x] A6 durable partner capability disable, environment emergency stop, and circuit-breaker behavior are implemented.
- [x] Disable behavior preserves completed financial history.
- [x] Stop conditions and rollback-safe procedure are documented.
- [x] No public route/controller/API/scheduler/external integration was added by A6T11.
- [ ] A2 route/data-exposure approval for the `partner-callback.controller` route and any A6 internal caller is recorded.
- [ ] ADR-0048 (NIBSS and Bank Integration Isolation) is authored and approved.
- [ ] Live migration/deployment/rollback drill is recorded.
- [ ] Partner certification and go/no-go approval are recorded.

This document is a release/rollback decision input, not route exposure, partner certification, or production approval.
