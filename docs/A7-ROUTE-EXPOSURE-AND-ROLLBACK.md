# A7 Route Exposure and Rollback

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T11 — A7 Integration, Product Certification, Release Gate, and A8 Handoff
- **Status:** Prepared for accountable-owner review; not approved
- **Classification:** Documentation-only route exposure review and rollback evidence
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Purpose and evidence boundary

This document records the A7 product-expansion surface's route exposure review and rollback procedures. It distinguishes:

- internal A2-protected surface (e.g., partner callback controller) that is **not** a public route and is **not** opened beyond A2 protection;
- A7 internal product command and lifecycle surface that is **not** exposed as a public API;
- A7 product reconciliation and A7 product data-minimization control surface that is A2-protected internal;
- A7 product notification dispatcher that is internal-only and dispatches only to the shared Operations `OutboxService`, never to a live email, SMS, push, or web channel;
- A7 product financial-effect / Ledger / settlement / suspense boundary that is internal-only and never exposed as a public API.

The A7 plan §5 non-goals and §6 governing architectural boundaries explicitly exclude public APIs, mobile / web channels, marketing consent, broad customer activation, public partner APIs, and production rollout. This document records the current route / surface state and the rollback / disable procedures that keep A7 inside those boundaries.

## 2. A7 surface inventory (read-only review)

The A7 surface inventory is the A7 product-expansion surface as it exists at the A7T10 commit (`2746521`). The A7T11 task is documentation-only and adds no new surface.

### 2.1 Internal A2-protected surfaces (existing, not opened by A7)

| Surface | Module | A2 protection | New route opened by A7? | Public exposure? |
| --- | --- | --- | --- | --- |
| `partner-callback.controller` | `src/partner/partner-callback.controller.ts` | Yes (A2 protected-internal callback ingress) | No | No |
| A7 internal product command context | `src/policy/a7-product-command.*` | Yes (A2 protected-internal; A4 policy / A3 binding recheck) | No | No |
| A7 internal product lifecycle context | `src/policy/a7-product-lifecycle.*` | Yes (A2 protected-internal) | No | No |
| A7 internal product customer-binding context | `src/policy/a7-product-customer-binding.*` | Yes (A2 protected-internal) | No | No |
| A7 internal product financial-effect context | `src/policy/a7-product-financial-effect.*` | Yes (A2 protected-internal) | No | No |
| A7 internal product notification dispatcher | `src/policy/a7-product-notification-delivery.*` | Yes (A2 protected-internal) | No | No (no live channel) |
| A7 internal product reconciliation context | `src/policy/a7-product-reconciliation.*` | Yes (A2 protected-internal) | No | No |
| A7 internal product data-minimization control surface | `src/policy/a7-product-data-minimization.*` | Yes (A2 protected-internal) | No | No |

The A7 plan §5 non-goals and §6 governing architectural boundaries require the A2 protected-internal surface to remain A2 protected. A7T11 does not open any of these surfaces to a new public route or a new mobile / web channel.

### 2.2 New public API surfaces opened by A7 (None claimed)

A7T11 does **not** open, and does **not** claim to open, any of the following:

- public customer-facing API;
- public partner-facing API;
- public mobile / web channel;
- public email, SMS, or push channel;
- public status API;
- public reconciliation / disclosure API;
- public product activation API;
- public customer cohort API;
- public marketing consent API;
- public A8 scale / extraction API.

The A7 plan §5 non-goals and §6 governing architectural boundaries explicitly forbid the above. The A7T11 evidence package records the absence of these surfaces as a release-gate precondition, not as a delivery claim.

### 2.3 Notification channel inventory (A7T06)

The A7T06 notification dispatcher writes a delivery intent to the shared Operations `OutboxService`, records a delivery fact through the shared `AuditService`, and deduplicates through the shared `IdempotencyService`. The A7T06 dispatcher does **not** wire a live email, SMS, push, or web channel. The A7 plan §8 A7T06 acceptance criteria explicitly state "A7T06 introduces no public, mobile, web, or partner channel implementation; only the dispatcher boundary, the outbox contract, and the audit/idempotency integration are committed."

No new notification channel is approved by A7. The A7T06 channel suppression override remains A2-protected and is exercised only by an authorized privileged-action approval.

## 3. A7 product disable procedure

The A7 product disable procedure is the A7-side equivalent of the A6 disable procedure and reuses the A6 circuit-breaker where applicable.

### 3.1 A7 product disable (per product key)

A7 product disable per product key (`VIRTUAL_ACCOUNT` v1) is performed by:

1. setting the A7 product catalog product registration to `disabled` (the A7 product catalog is the only product registration authority; A7T02);
2. suppressing new A7 product commands at the A7 product command service (the A7 product command service is the only product command authority; A7T05);
3. suppressing new A7 product lifecycle transitions at the A7 product lifecycle service (the A7 product lifecycle service is the only product lifecycle authority; A7T07);
4. suppressing new A7 product financial-effect admissions at the A7 product financial-effect service (the A7 product financial-effect service is the only product financial-effect authority; A7T08);
5. suppressing new A7 notification dispatches at the A7 product notification-delivery dispatcher (the A7 product notification-delivery service is the only product notification-delivery authority; A7T06);
6. suppressing new A7 product data-minimization disclosures to non-`SECURITY` audiences at the A7 product data-minimization service (the A7 product data-minimization service is the only product data-minimization authority; A7T10).

Disable preserves all completed A7 product operations, A7 product commands, A7 product lifecycle references, A7 product financial-effect references, A7 notification delivery facts, A7 product reconciliation reports, and A7 product data-minimization reports. Disable does **not** mutate any source record.

### 3.2 A7 notification disable (per channel)

A7 notification disable per channel (`inApp` / `email` / `sms` / `push`) is performed by:

1. suppressing channel dispatch in the A7 product notification-delivery service (the A7 product notification-delivery service is the only product notification-delivery authority; A7T06);
2. recording the suppression as an audit fact through the shared Operations `AuditService` (the shared `AuditService` is the only audit authority; A1);
3. honoring the `CustomerPreference` revocation (the `CustomerPreference` is the only customer intent authority; A1).

Channel disable preserves all completed A7 notification delivery facts. Channel disable does **not** mutate any source record.

### 3.3 A6 circuit-breaker disable (per partner / capability)

A6 circuit-breaker disable per partner / capability (e.g., `NIBSS_NIP` / `external.wallet.withdrawal.settlement`) is performed by:

1. opening the A6 `PartnerCircuitBreakerService` circuit for the affected partner / capability (the A6 `PartnerCircuitBreakerService` is the only A6 circuit-breaker authority; A6T07);
2. recording the circuit-open state as an audit fact through the shared Operations `AuditService` (the shared `AuditService` is the only audit authority; A1);
3. suppressing new A6 partner operations at the A6T05 `ExternalOperationService` (the A6T05 `ExternalOperationService` is the only A6T05 external-operation authority; A6T05).

Circuit-breaker disable preserves all completed A6 partner operations, A6 callbacks, A6 settlements, A6 suspense entries, and A6 reconciliation reports. Circuit-breaker disable does **not** mutate any source record.

### 3.4 Environment emergency-stop (per environment)

Environment emergency-stop is performed by:

1. setting the partner disabled-by-default environment variable (`A6_DATA_MINIMIZATION_ENABLED=false`, `PARTNER_CONNECTION_ENABLED=false`);
2. rotating the partner credentials and signing keys (per ADR-0048 when authored; today, per the existing partner-connection configuration boundary);
3. rotating the partner callback secret (per the existing partner-callback-authentication boundary);
4. closing all open A6 circuit-breaker circuits (A6T07);
5. suppressing all A7 product commands and A7 product lifecycle transitions (A7T05 / A7T07);
6. suppressing all A7 product financial-effect admissions (A7T08);
7. suppressing all A7 notification dispatches (A7T06);
8. preserving all completed A5 transfer / deposit / withdrawal, A6 partner operations, A6 callbacks, A6 settlements, A6 suspense entries, A6 reconciliation reports, A7 product operations, A7 product commands, A7 product lifecycle references, A7 product financial-effect references, A7 notification delivery facts, A7 product reconciliation reports, and A7 product data-minimization reports.

Environment emergency-stop does **not** mutate any source record. The internal financial history and the A7 product history are preserved.

## 4. A7 product rollback procedure

The A7 product rollback procedure restores the A7 product-expansion surface to a pre-activation state without rewriting completed A5, A6, A7, or Ledger history.

### 4.1 Pre-activation rollback

If A7 product activation is in progress and a pre-activation rollback is required:

1. close all open A7 product commands at the A7 product command service (A7T05) by issuing a manual review state;
2. close all open A7 product lifecycle transitions at the A7 product lifecycle service (A7T07) by issuing a manual review state;
3. close all open A7 product financial-effect admissions at the A7 product financial-effect service (A7T08) by issuing a manual review state;
4. close all open A7 notification dispatches at the A7 product notification-delivery dispatcher (A7T06) by issuing a suppression state;
5. close all open A7 product reconciliation reports at the A7 product reconciliation service (A7T09) by issuing a no-discrepancy final state (A7T09 is read-only and never mutates source records);
6. close all open A7 product data-minimization reports at the A7 product data-minimization service (A7T10) by issuing a no-disclosure final state (A7T10 is read-only and never mutates source records);
7. perform environment emergency-stop (§3.4).

Pre-activation rollback does **not** mutate any source record. The internal financial history and the A7 product history are preserved.

### 4.2 Post-activation rollback

If A7 product activation has occurred and a post-activation rollback is required:

1. perform environment emergency-stop (§3.4);
2. perform A7 product disable (§3.1);
3. perform A6 circuit-breaker disable for the affected partner / capability (§3.3);
4. record the rollback as an audit fact through the shared Operations `AuditService` (the shared `AuditService` is the only audit authority; A1);
5. honor the `CustomerPreference` revocation (the `CustomerPreference` is the only customer intent authority; A1);
6. do **not** post any new Ledger journal;
7. do **not** issue any new A6 settlement, suspense, or compensating entry;
8. do **not** dispatch any new A7 notification;
9. do **not** mutate any A5 transfer / deposit / withdrawal, A6 partner operation, A6 callback, A6 settlement, A6 suspense entry, A6 reconciliation report, A7 product operation, A7 product command, A7 product lifecycle reference, A7 product financial-effect reference, A7 notification delivery fact, A7 product reconciliation report, or A7 product data-minimization report.

Post-activation rollback does **not** mutate any source record. The internal financial history and the A7 product history are preserved.

## 5. A7 internal financial history preservation

A7 internal financial history preservation is governed by the A5 Ledger authority, the A6T08 settlement / suspense / compensating authority, the A6T09 external reconciliation authority, the A6T10 data-classification / retention / legal-hold authority, the A7T08 product financial-effect authority, the A7T09 product reconciliation authority, the A7T10 product data-minimization authority, and the shared Operations `AuditService` / `IdempotencyService` / `OutboxService` / `MetricsService` / `DiagnosticsService`. The A7 plan §6 governing architectural boundaries require that the internal financial history is preserved through disable, rollback, and emergency-stop. The A7T11 evidence package does **not** claim any deviation from the A7 plan §6 governing architectural boundaries.

The A7 internal financial history preservation properties (per the A7 plan §6 governing architectural boundaries) are:

- Customer identity, A3 binding, Wallet, Ledger, A5 transfer / deposit / withdrawal history, A6 partner operation history, A6 callback history, A6 settlement / suspense / compensating history, A6 reconciliation report history, A7 product operation history, A7 product command history, A7 product lifecycle reference history, A7 product financial-effect reference history, A7 notification delivery fact history, A7 product reconciliation report history, A7 product data-minimization report history, and Operations audit / idempotency / outbox / metrics / diagnostics history are preserved through disable, rollback, and emergency-stop.
- A7 does not post a journal, mutate a balance, clear suspense, or edit a posted journal / line outside Ledger and Finance-approved correction boundaries (the A5 Ledger is the only financial value authority).
- A7 does not mutate a Ledger-owned A5, A6, or A7 record to reconcile a product, partner, or notification discrepancy.
- A7 does not convert a notification delivery into a financial command, an A2 authorization, an A3 binding repair, an A4 policy decision, or a Ledger record.

## 6. A7 disable / rollback evidence

The A7 disable / rollback evidence is the A7 plan §8 A7T11 deliverables: "Disable/circuit-breaker/product-rollback controls stop new product activity without rewriting completed A5, A6, or Ledger history."

The A7T11 evidence package records the A7 disable / rollback procedure (§3, §4) and the A7 internal financial history preservation properties (§5) as the design-aligned evidence. The A7T11 evidence package does **not** claim any live exercise of the A7 disable / rollback procedure. The A7T11 evidence package does **not** claim any live circuit-breaker open event. The A7T11 evidence package does **not** claim any live partner-outage scenario.

## 7. Cross-reference

- [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md) — A7 task-to-evidence matrix and end-to-end product authority trace.
- [`A7-OPERATIONAL-RECOVERY-RUNBOOK.md`](A7-OPERATIONAL-RECOVERY-RUNBOOK.md) — A7 operational recovery runbook, incident classification, and decision matrix.
- [`A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md) — A7 owner approval register and no-go recommendation.
- [`A7-EXIT-CHECKLIST.md`](A7-EXIT-CHECKLIST.md) — A7 exit checklist and A7 phase result.
