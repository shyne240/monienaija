# B1 Commercial Route Exposure and Rollback

- **Phase:** B1 — Commercial Platform
- **Task:** B1T11 — B1 Commercial Integration, Commercial Plan Certification, Commercial Release Gate, and B2 Handoff
- **Status:** Prepared for accountable-owner review; not approved
- **Classification:** Documentation-only route exposure review and rollback evidence
- **Application, database, API, migration, controller, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, and financial-runtime changes in this task:** None

## 1. Purpose and evidence boundary

This document records the B1 commercial-platform surface's route exposure review and rollback procedures for the first selected commercial scope `commercial.virtual-account.inbound-funding` v1 (`NGN`, `CUSTOMER_FUNDS`, under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP` planning rail). It distinguishes:

- the existing A2-protected internal surface (`partner-callback.controller` and the existing internal product/command surfaces) that remains internal;
- the non-existent B1 public commercial surface that is **not** introduced by B1;
- the B1 commercial disable / circuit-breaker / feature-flag disable / environment emergency-stop / commercial-rollback procedures that stop new commercial activity without rewriting completed A5, A6, A7, or Ledger history;
- the internal financial history preservation properties that govern all disable/rollback/emergency-stop flows.

No section in this document claims live execution, production deployment, partner certification, owner approval, or commercial activation unless explicitly identified as such. No section in this document introduces a new public commercial route, a new commercial notification channel, a new partner rail, or a new commercial scope.

## 2. Route exposure review

### 2.1 Existing internal surface (inherited)

| Surface | Controller / router | Audience | Authentication / authorization | Exposure status |
| --- | --- | --- | --- | --- |
| Health / readiness | `health.controller.ts` | Internal / platform | Unauthenticated health; no customer data | No change — remains internal platform health |
| Partner callback ingress | `partner/partner-callback.controller.ts` (A6T06) | Internal partner rail | A2-protected; `PartnerCallbackAuthService` validates authenticity/replay/freshness; idempotency via `A6T05` | **No new exposure** — remains A2-protected internal surface; B1 does not widen callback audience |
| A6 external-operation / payment / transfer internal surfaces | `transfer`, `payment`, `partner`, `operations`, `ledger`, `wallet` modules | Internal operations | A2 audience / privileged-action where applicable; A6T02 adapter isolation | No change |
| A7 internal product command / product data-minimization control surfaces | `product-governance`, `policy/a7-*` modules | Internal product layer | A2 audience / authorization; A7T05 product command idempotency | No change — B1 supplies commercial data into A7 product command; does not expose new product API |

### 2.2 B1 commercial surface exposure (explicit non-exposure)

| B1 commercial surface | Introduced by B1? | Public API? | Mobile / web channel? | Marketing consent channel? | Exposure status |
| --- | --- | --- | --- | --- | --- |
| B1 commercial catalog (`b1-commercial-catalog.service`) | B1T02 — read-only consumer contract | No | No | No | **Not exposed** — no public commercial catalog API |
| B1 fee / commission / revenue-sharing decision API | B1T04 — deterministic calculator | No | No | No | **Not exposed** — internal calculator consumed via `ConsumerPortsV1` |
| B1 billing / invoice / statement generation API | B1T05 — decision + ledger-bound effect | No | No | No | **Not exposed** — internal billing service; at most one Ledger effect |
| B1 campaign / promotion / coupon engine API | B1T06 — incentive events | No | No | No | **Not exposed** — internal incentive engine |
| B1 referral / cashback / loyalty engine API | B1T07 — incentive events | No | No | No | **Not exposed** — internal incentive engine |
| B1 revenue recognition / tax / cost-accounting engine API | B1T08 — recognition events | No | No | No | **Not exposed** — internal recognition engine |
| B1 analytics / profitability / reconciliation API | B1T09 — read-only reports | No | No | No | **Not exposed** — internal read-only analytics |
| B1 governance / classification / idempotency / audit / approvals / feature-flag surface | B1T10 — read-only governance surface | No | No | No | **Not exposed** — reuses A6T10 `ExternalDataClassificationRegistry` + Operations `AuditService`/`IdempotencyService` + A2 privileged-action; single feature-flag surface |
| B1 commercial disable / rollback / emergency-stop | B1T11 — this document | No | No | No | **Not exposed** — design-aligned procedures; no runtime switch wired to public surface |

**Overall exposure verdict: NO new public commercial route approved. No new commercial notification channel approved.** The `partner-callback.controller` remains an **A2-protected internal surface**. Any future public customer/mobile/web/partner commercial API, any marketing-consent onboarding, any cross-region/cross-currency rollout, and any partner onboarding beyond the already-approved A6 partner `NIBSS_NIP` planning rail requires a separate reviewed capability decision and release boundary under B2 and is explicitly blocked by this release gate (see §8 prohibited edges and [`B1-B2-HANDOFF-PACKAGE.md`](B1-B2-HANDOFF-PACKAGE.md)).

### 2.3 CustomerPreference and notification channel review

- `CustomerPreference.notifications` remains the only customer intent authority for notification dispatch (A1 / A7 / B1).
- B1T05–B1T08 events honor `CustomerPreference.notifications` and the A6T10 / A7T10 / B1T10 data-minimization, consent, retention, legal-hold, secret, and disclosure controls.
- B1 never dispatches a notification directly; notification dispatch remains exclusively the A7T06 `NotificationDeliveryService` under `CustomerPreference` intent.
- **No new commercial notification channel (SMS/email/push) is wired by B1.** No live email, SMS, push, or web channel is required for B1 fixture-based certification.

## 3. B1 commercial disable procedure

B1 commercial disable stops new commercial activity for the first selected commercial scope without mutating any source record. Disable is idempotent and preserves internal financial history.

### 3.1 B1 commercial-scope disable (per commercial scope key)

For `commercial.virtual-account.inbound-funding` v1, B1 commercial-scope disable is performed by:

1. suppressing new B1 commercial-decision generation at the B1 catalog/fee/billing/campaign/referral/revenue-recognition/analytics engines (`b1-commercial-catalog`, `b1-fee-engine`, `b1-billing-engine`, `b1-campaign-engine`, `b1-referral-engine`, `b1-revenue-recognition-engine`, `b1-commercial-analytics-engine`; each is the only authority for its decision kind — B1T02–T09);
2. suppressing new B1 commercial-financial-effect admissions at the B1 billing and revenue-recognition engines (B1T05 / B1T08 — at most one Ledger effect per scope; suppression prevents new effects without clearing settled ones);
3. suppressing new B1 commercial-incentive events at the campaign/referral engines (B1T06 / B1T07);
4. suppressing new B1 commercial-analytics/profitability/reconciliation evaluations at the analytics engine (B1T09 — read-only; suppression sets `DISABLED` rollout state);
5. suppressing new B1 feature-flag evaluations at the governance engine (B1T10 — `COMMERCIAL_FEATURE_FLAG` `DISABLED` state; A4 remains policy authority);
6. recording the suppression as an audit fact through the shared Operations `AuditService` (the only audit authority; A1);
7. emitting a no-new-event operational metric via Operations `MetricsService`.

Disable preserves all completed B1 commercial decisions, commercial-financial-effect references, commercial-financial-recognition references, incentive events, analytics reports, governance classifications, and product/partner/Ledger histories. Disable does **not** mutate any source record.

### 3.2 B1 feature-flag disable (per flag key)

B1 feature-flag disable per flag key (e.g., `commercial.virtual-account.inbound-funding.fee.enabled`, `commercial.virtual-account.inbound-funding.billing.enabled`) is performed by:

1. setting the flag rollout state to `DISABLED` at the `B1CommercialGovernanceEngineService` (the only B1 feature-flag authority; B1T10);
2. recording the flag disable as an audit fact via `AuditService`;
3. asserting `CustomerPreference` and A4 policy currentness remains satisfied (flag disable never bypasses A4 or A3 checks).

Feature-flag disable preserves all completed flag evaluations. Feature-flag disable does **not** mutate any source record.

### 3.3 A6 circuit-breaker disable (per partner / capability)

Delegated to A6T07 `PartnerCircuitBreakerService` (the only circuit-breaker authority):

1. open the circuit for partner `NIBSS_NIP` / capability `external.wallet.withdrawal.settlement` (or the commercial-scope-mapped capability);
2. record circuit-open as audit fact;
3. suppress new A6 partner operations at `ExternalOperationService` (A6T05).

Circuit-breaker disable preserves all completed A6 operations / callbacks / settlements / suspense / reconciliation reports. Circuit-breaker disable does **not** mutate any source record.

### 3.4 B1 commercial notification suppression

- suppress channel dispatch in A7T06 notification-delivery (only dispatcher; honors `CustomerPreference` revocation);
- record suppression as audit fact;
- B1 never re-enables a channel that `CustomerPreference` has revoked.

### 3.5 Environment emergency-stop (per environment)

Environment emergency-stop is performed by:

1. setting disabled-by-default environment flags (`B1_COMMERCIAL_DECISION_ENABLED=false`, `B1_BILLING_ENGINE_ENABLED=false`, `B1_REVENUE_RECOGNITION_ENABLED=false`, `PARTNER_CONNECTION_ENABLED=false` — design-aligned; no new secret introduced);
2. closing all open A6 circuit-breaker circuits (A6T07);
3. suppressing all B1 commercial decisions / financial effects / recognition events (B1T04–T09);
4. suppressing all feature-flag evaluations (B1T10 → `DISABLED`);
5. suppressing all A7 product commands / lifecycle transitions / financial-effect admissions that carry B1 commercial references (A7T05/T07/T08);
6. suppressing all A7 notification dispatches that carry B1 commercial payloads (A7T06);
7. preserving all completed A5 transfer/deposit/withdrawal, A6 partner operations/callbacks/settlements/suspense, A6 reconciliation reports, A7 product operations/commands/lifecycle/financial-effect/notification facts/reconciliation/data-minimization reports, B1 commercial decisions/financial-effects/recognition events/incentive events/analytics reports, and Operations audit/idempotency/outbox/metrics/diagnostics histories.

Environment emergency-stop does **not** mutate any source record. Internal financial history and commercial history are preserved.

## 4. B1 commercial rollback procedure

The B1 commercial rollback procedure restores the commercial-platform surface to a pre-activation state without rewriting completed A5, A6, A7, or Ledger history.

### 4.1 Pre-activation rollback

If B1 commercial activation is in progress and pre-activation rollback is required:

1. close all open B1 commercial decisions at `b1-fee-engine` (B1T04) by issuing a manual-review state (no journal);
2. close all open billing documents at `b1-billing-engine` (B1T05) by issuing a manual-review state (no new ledger effect);
3. close all open incentive decisions at `b1-campaign-engine` / `b1-referral-engine` (B1T06/T07) by issuing manual-review;
4. close all open recognition decisions at `b1-revenue-recognition-engine` (B1T08) by issuing pending/suspense manual-review;
5. close all open analytics/reconciliation evaluations at `b1-commercial-analytics-engine` (B1T09) by issuing no-discrepancy final state (read-only);
6. close all open governance classifications at `b1-commercial-governance-engine` (B1T10) by issuing no-disclosure final state (read-only);
7. perform environment emergency-stop (§3.5).

Pre-activation rollback does **not** mutate any source record. Internal financial history and commercial history are preserved.

### 4.2 Post-activation rollback

If B1 commercial activation has occurred and post-activation rollback is required:

1. perform environment emergency-stop (§3.5);
2. perform B1 commercial-scope disable for `commercial.virtual-account.inbound-funding` v1 (§3.1);
3. perform feature-flag disable for affected flags (§3.2);
4. perform A6 circuit-breaker disable for affected partner/capability (§3.3);
5. record rollback as audit fact via `AuditService`;
6. honor `CustomerPreference` revocation (only customer intent authority);
7. do **not** post any new Ledger journal;
8. do **not** issue any new A6 settlement/suspense/compensating entry;
9. do **not** dispatch any new A7 notification carrying commercial payload;
10. do **not** mutate any A5 transfer/deposit/withdrawal, A6 partner operation/callback/settlement/suspense report, A6 reconciliation report, A7 product operation/command/lifecycle/financial-effect/notification/reconciliation/data-minimization report, or B1 commercial-decision/financial-effect/recognition/incentive/analytics report.

Post-activation rollback does **not** mutate any source record. Internal financial history and commercial history are preserved.

## 5. B1 internal financial and commercial history preservation

Preservation is governed by A5 Ledger authority, A6T08 settlement/suspense/compensating authority, A6T09 external reconciliation, A6T10 data-classification/retention/legal-hold, A7T08 product financial-effect, A7T09 product reconciliation, A7T10 product data-minimization, B1T05/B1T08 commercial-financial-effect/recognition, B1T09 commercial reconciliation, B1T10 governance, and shared `AuditService`/`IdempotencyService`/`OutboxService`/`MetricsService`/`DiagnosticsService`. The B1 plan §12 exit criteria require that disable, rollback, and emergency-stop preserve history. This section records design alignment.

Properties:

- Customer identity, A3 binding, Wallet, Ledger, A5 transfer/deposit/withdrawal histories, A6 partner-operation/callback/settlement/suspense/compensating histories, A6 reconciliation report histories, A7 product operation/command/lifecycle/financial-effect/notification/reconciliation/data-minimization histories, B1 commercial-decision/financial-effect/recognition/incentive/analytics/governance histories, and Operations audit/idempotency/outbox/metrics/diagnostics histories are preserved through disable/rollback/emergency-stop.
- B1 does not post a journal, mutate a balance, clear suspense, or edit a posted journal/line outside Ledger and Finance-approved correction boundaries (A5 Ledger is the only financial value authority).
- B1 does not mutate a Ledger-owned A5, A6, A7, or B1 record to reconcile a commercial, partner, or notification discrepancy (B1T09 is read-only).
- B1 does not convert a commercial-decision/financial-effect/billing/invoice/statement/campaign/promotion/coupon/referral/cashback/loyalty/revenue-recognition/tax/cost-accounting/analytics report into a financial command, A2 authorization, A3 binding repair, A4 policy decision, or Ledger record.

## 6. Rollback validation

### 6.1 Validation method

Rollback validation for the B1 first commercial scope is **design validation + fixture validation** (not live partner execution):

- Fixture-based tests assert that `B1BillingEngineService` and `B1RevenueRecognitionEngineService` create at most one balanced Ledger effect or enter pending/suspense/manual-review, never auto-repairing source records.
- Fixture-based tests assert that `B1CommercialAnalyticsEngineService` produces discrepancy classifications without source mutation.
- Fixture-based tests assert that `B1CommercialGovernanceEngineService` produces `DISABLED` flag states and that `IdempotencyService` conflicts on same-key/changed-payload replay.
- Design inspection asserts that all B1 services are either stateless calculators or REPEATABLE READ read-only transactions; no service holds write locks on source tables.

### 6.2 Validation evidence in this release

- [x] `B1BillingEngineService` replay-safe/number-conflict/expiry tests pass (`npm test`)
- [x] `B1RevenueRecognitionEngineService` replay-safe/jurisdiction/allocation tests pass (`npm test`)
- [x] `B1CommercialAnalyticsEngineService` read-only/discrepancy-classification tests pass (`npm test`)
- [x] `B1CommercialGovernanceEngineService` classification/idempotency/audit/approval/flag tests pass (`npm test`)
- [x] Migrations ordered without interleave (verified `ls src/migrations` + `npm run build`)
- [x] `npm run lint` passes (no new route/controller introduced)
- [x] `npm run build` passes (no new module import graph violation)
- [x] `npm run format:check` passes (cross-reference docs formatted)
- Live partner call **not** exercised — blocked as non-claim (see §7).

### 6.3 Rollback drill requirement for production activation

A live rollback drill (closing an open commercial-scope in a staging environment that mirrors `operations` audit + `idempotency` store + A6 circuit-breaker state) is required before any B2 production activation. The drill must be authored, approved, and recorded by Operations, Finance/Ledger, and Commercial after B1 approval; B1T11 does **not** claim the drill is completed.

## 7. Feature flag readiness

- **Flag surface:** `B1CommercialGovernanceEngineService` (`COMMERCIAL_FEATURE_FLAG` decision kind, vocabularies `DRAFT`/`REGISTERED`/`ROLLED_OUT`/`ENABLED`/`DISABLED`/`RETIRED`, outcome `ROLLED_OUT`/`AVAILABLE`/`APPROVED`/`REJECTED`) is the only B1 flag surface. A4 remains the only policy authority; B1 supplies the flag data A4 and every product consume via approved read-only consumer boundaries.
- **Rollout mechanism:** `COMMERCIAL_ROLLOUT_STATE` + `COMMERCIAL_ENABLEMENT_RULES` + `COMMERCIAL_DEPENDENCY_RULES` + `COMMERCIAL_ACTIVATION_READINESS` documents; `B1-COMMERCIAL-GOVERNANCE-CONTRACT.md` §4 registers them as the only flag documents.
- **Readiness check before any commercial dispatch:** `COMMERCIAL_ACTIVATION_READINESS` = `READY` iff scope `ACTIVE`, policy `CURRENT`, binding `VERIFIED`, Ledger account `OPEN`, partner capability `ENABLED`, feature flag `ENABLED`, and `CustomerPreference.notifications` `GRANTED`. Fixtures validate fail-closed to `REJECTED` if any condition is false.
- **Rollback via flag:** Set flag to `DISABLED`; see §3.2. No new flag type, flag mutation channel, or flag-specific public route is introduced.
- **Evidence:** Fixture tests `replaySafeGenerateCommercialFeatureFlagDecision` validate `ROLLED_OUT`→`ENABLED`→`DISABLED` transitions and conflict on same-key/changed-payload.

## 8. Prohibited edges (route and rollback)

- B1 does not expose a public customer/mobile/web/partner commercial API merely because a commercial-decision contract or engine exists; A2 route/data controls remain required.
- B1 does not broaden the first commercial scope, the A6 partner dependency, or the customer cohort without a separate reviewed capability decision and release boundary.
- B1 does not mutate completed A5 transfer, A6 settlement/suspense/journal, A7 product operation, or Ledger history for commercial/partner/notification correction.
- B1 does not begin B2 customer-activation rollout, B2 public commercial APIs, B2 mobile/web commercial channels, B2 marketing consent, B2 cross-region/cross-currency rollout, B2 partner onboarding beyond `NIBSS_NIP`, or B2 production rollout.
- Violation is a release-gate stop condition (see [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md) §5 and [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) §2).

## 9. Cross-reference

- [`B1-INTEGRATION-MATRIX.md`](B1-INTEGRATION-MATRIX.md) — task-to-evidence matrix and end-to-end commercial authority trace
- [`B1-ADR-REVIEW-STATUS.md`](B1-ADR-REVIEW-STATUS.md) — ADR range review against committed evidence
- [`B1-OPERATIONAL-RECOVERY-RUNBOOK.md`](B1-OPERATIONAL-RECOVERY-RUNBOOK.md) — incident classification, recovery procedure, decision matrix, support trace, ownership/stop conditions
- [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md) — acceptance checklist, unresolved blockers, explicit B1 phase result
- [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) — owner approval register, no-go recommendation, go conditions, explicit non-claims
- [`B1-B2-HANDOFF-PACKAGE.md`](B1-B2-HANDOFF-PACKAGE.md) — bounded handoff to B2, prohibited edges, B2 entry conditions, blocked handoff status
- [`DISASTER-RECOVERY.md`](DISASTER-RECOVERY.md) — disaster-recovery references (B1 adds no new DR mechanism)
- [`RUNBOOK.md`](RUNBOOK.md) — existing operational runbook (B1 runbook is scoped to first commercial scope)
