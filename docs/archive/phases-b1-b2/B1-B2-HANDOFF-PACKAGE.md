# B1 → B2 Handoff Package

- **Phase:** B1 — Commercial Platform → Phase B2 — Customer-Activation Rollout
- **Task:** B1T11 — B1 Commercial Integration, Commercial Plan Certification, Commercial Release Gate, and B2 Handoff
- **Status:** Handoff package prepared; handoff is **BLOCKED** — B1 is **Prepared — not approved, not live-certified, not activated, not handed off to B2**
- **Classification:** Documentation-only bounded handoff definition
- **Application, database, API, migration, controller, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, and financial-runtime changes in this task:** None
- **Review snapshot:** `d6e4d7c` (post-B1T10)
- **B1 first commercial scope (frozen):** `commercial.virtual-account.inbound-funding` v1 / `NGN` / `CUSTOMER_FUNDS` / under `VIRTUAL_ACCOUNT` v1 / partner `NIBSS_NIP` planning rail

## 1. Purpose and evidence boundary

This document defines the bounded handoff from the completed B1 Commercial Platform to the upcoming B2 Customer-Activation Rollout without beginning B2. It specifies:

- the B1 handoff is **blocked** until the B1 release-gate review and the accountable-owner approvals recorded in [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) §4 are independently granted;
- the bounded set of B1 contracts, decisions, and procedures that B1 **may** provide to B2 (handover) when the gate is passed;
- the set of B1 items that B1 **must not** provide to B2 (prohibited edges, §6);
- the B2 entry conditions that B2 must satisfy before implementing any B2 customer-activation rollout, public channels, marketing-consent onboarding, cross-region/cross-currency work, partner onboarding beyond the already-approved A6 partner, or broad customer activation (§7);
- the delegated work register for B2+ (§8).

No section in this document begins B2, approves a public commercial API, claims live commercial dispatch, or approves commercial activation. The handoff is documentation-only and is currently **BLOCKED** (§9).

## 2. Handoff status

| Item | Value |
| --- | --- |
| **Handoff status** | **BLOCKED** |
| **Reason** | B1 phase result is **Prepared — not approved, not live-certified, not activated, not handed off to B2** per [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md) §9; no owner approval is claimed by B1T11 per [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) §2,§4; live Finance/Ledger/Tax, Privacy/Security, Legal/Risk/Compliance, Operations/Reconciliation/Support, Product, Architecture, and Partner approvals and live reconciliation/rollback drills are pending |
| **Unblocked by** | Independent review and `Granted` for all owners in [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) §4 plus `PASS` for all [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md) §2, §5 production readiness items plus ADR-0061..ADR-0069 approval per [`B1-ADR-REVIEW-STATUS.md`](B1-ADR-REVIEW-STATUS.md) §5 plus live reconciliation and live rollback drills |
| **Effective date** | No unblock date is claimed by B1T11; date is set only when the release-gate record is signed by Architecture on behalf of all owners |
| **Scope** | Bounded to `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT` v1 under `NIBSS_NIP` — any scope beyond that requires a separate B1 cycle before it may enter any B2 cycle |

## 3. What B1 provides to B2 when the gate is passed (bounded handover)

When the release gate is passed, B1 provides B2 with **the following bounded items only** (all scoped to `commercial.virtual-account.inbound-funding` v1; no B2 implementation permission is implied):

- the B1 commercial catalog `CommercialCatalogContractV1` and the plan-boundary contract `CommercialBoundaryContractV1` (ADR-0061/ADR-0062) — [`B1-COMMERCIAL-CATALOG-CONTRACT.md`](B1-COMMERCIAL-CATALOG-CONTRACT.md);
- the B1 commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, commercial-analytics, and commercial-reconciliation data and contracts (ADR-0063..ADR-0068) — [`B1-FEE-ENGINE-CONTRACT.md`], [`B1-BILLING-ENGINE-CONTRACT.md`], [`B1-CAMPAIGN-ENGINE-CONTRACT.md`], [`B1-REFERRAL-ENGINE-CONTRACT.md`], [`B1-REVENUE-RECOGNITION-CONTRACT.md`], [`B1-COMMERCIAL-ANALYTICS-CONTRACT.md`];
- the B1 commercial-decision identity (`b1-commercial-governance-decision` prefix), commercial-decision idempotency (`86_400s` TTL `IdempotencyService` reuse), commercial-decision request-hash (payload excludes `decisionId`/`generatedAt`), and commercial-decision correlation patterns (`commercialDecisionReference` → `billingDocumentReference` → `recognitionEventReference` → `analyticsReportReference`);
- the B1 fee engine `B1FeeEngineContractV1`, the B1 commission engine (revenue sharing), the B1 billing engine `B1BillingEngineContractV1`, the B1 invoice document model, the B1 statement-generation engine, the B1 campaign engine `B1CampaignEngineContractV1`, the B1 promotion decision model, the B1 coupon decision model, the B1 referral engine `B1ReferralEngineContractV1`, the B1 cashback model, the B1 loyalty model, the B1 revenue-recognition engine `B1RevenueRecognitionEngineContractV1`, the B1 tax/VAT model, the B1 cost-accounting model, the B1 analytics engine, the B1 profitability classifier, the B1 commercial-reconciliation engine (read-only), the B1 data-classification surface, the B1 idempotency surface, the B1 audit surface, the B1 approvals surface, the B1 feature-flag surface, and the B1 commercial release gate (this B1T11 gate);
- the B1 commercial-decision retry, manual-review, status-verification, and unknown-outcome recovery patterns (reusing A6/A7 lifecycle vocabularies — `PENDING`/`PENDING_RETRY`/`MANUAL_REVIEW`/`DISABLED`/`SETTLED`/`FAILED`);
- the B1 commercial disable, A6 circuit-breaker disable, environment emergency-stop, and internal-history-preservation evidence plus the commercial-rollback procedures — [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md);
- and the B1 support-trace classification for the A1 data-classification/retention/legal-hold and support-access controls (`PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED`/`HIGHLY_RESTRICTED`)
  — [`B1-COMMERCIAL-GOVERNANCE-CONTRACT.md`], [`B1-OPERATIONAL-RECOVERY-RUNBOOK.md`](B1-OPERATIONAL-RECOVERY-RUNBOOK.md) §7.

Each above item is scoped to the `B1-COMMERCIAL-PLATFORM-BASELINE.md` authority and ownership matrix. B2 consumes them as read-only consumers where applicable; none becomes a B2 source authority without the owning boundary's verification.

## 4. What B1 provides is design/fixture-governance — not live operational permission

B1 provides B2 with **design/fixture/governance evidence**, not live operational permission. The B1 evidence is:

- deterministic and sandbox/fixture-testable (no live partner or live product call required);
- bounded to the `NGN`/`CUSTOMER_FUNDS` accounting unit and the `NIBSS_NIP` planning rail;
- classified/minimized/payload-validated through the A6T10 `ExternalDataClassificationRegistry` read-only consumer boundary;
- idempotent/audited/approval-gated through the shared `IdempotencyService`/`AuditService`/A2 privileged-action surfaces;
- read-only reconciled via B1T09 (which reads A6T09 and A7T09 and never mutates source records).

B2 must not treat fixture-based commercial certification as live A6 partner, live A7 product, or live commercial dispatch.

## 5. What B2 may not assume this proves (explicit non-claim)

See also [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) §6. The B1T11 documentation package does **not** prove:

- that the first selected commercial scope `commercial.virtual-account.inbound-funding` v1 proves any second commercial scope, any second A7 product, any second commercial partner, any second currency, any second accounting unit, any second customer tier/merchant tier/partner tier, any second product entitlement, any second feature-flag, any second dynamic limit, any second subscription plan, any second package/bundle, any public commercial API/surface, any mobile/web/partner commercial API, any marketing-consent surface, any customer/merchant/partner cohort expansion, any capacity/fan-out behavior, any cross-region/cross-currency rollout, or any broad production activation;
- any commercial-decision, commercial-financial-effect, billing, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition, tax/VAT, cost-accounting, profitability, or analytics **reliability** beyond the fixture/contract/service boundaries of the first scope;
- any live Finance/Ledger/Tax approval, Privacy/Security approval, Legal/Risk/Compliance approval, Operations/Reconciliation/Support approval, Architecture review, Commercial review, Product approval, or Partner certification.

## 6. Prohibited edges (B1 must not provide to B2; B2 must not request)

B1 **must not** provide B2 with, and B2 **must not** request or use:

1. bank, NIBSS, partner, SMS, email, push, or other external credentials, tokens, certificates, signing keys, callback secrets, partner confidential material, or unrestricted risk/compliance evidence;
2. raw KYC, risk, compliance, investigative, security, device, support-restricted, or customer PIN/OTP payloads;
3. mutable balances, posted journal/line data as a new source of truth, or financial correction authority;
4. permission to treat an outbox event, payment reference, command ID, provider reference, callback ID, external reference, product reference, notification delivery record, suspense row, commercial-decision reference, commercial-financial-effect reference, commercial-billing reference, commercial-invoice reference, commercial-statement reference, commercial-campaign reference, commercial-promotion reference, commercial-coupon reference, commercial-referral reference, commercial-cashback reference, commercial-loyalty reference, commercial-revenue-recognition reference, commercial-tax reference, commercial-cost-accounting reference, commercial-profitability reference, commercial-analytics reference, or commercial-reconciliation reference as Ledger truth;
5. permission to bypass A1 identity, A2 authorization, A3 binding, A4 policy, A5 internal lifecycle, A6 partner, A7 product, B1 commercial-platform, Ledger, Operations, or Reconciliation controls;
6. permission to infer an internal account, commercial customer-binding, commercial-plan eligibility, commercial-tier eligibility, commercial-entitlement, commercial-feature-flag, or `CustomerPreference` from external data, partner response, commercial data, or product data;
7. a claim that the first selected commercial scope proves all future commercial rollout/regional/capacity/cohort/partner-onboarding reliability;
8. a second commercial scope, second commercial partner, public commercial route, mobile/web/partner commercial API, marketing consent, or commercial catalogue;
9. permission to mutate completed A5 transfer, A6 settlement/suspense/journal, A7 product operation, B1 commercial-decision, B1 commercial-financial-effect, B1 billing, B1 invoice, B1 statement, B1 campaign, B1 promotion, B1 coupon, B1 referral, B1 cashback, B1 loyalty, B1 revenue-recognition, B1 tax, B1 cost-accounting, B1 profitability, B1 analytics, or Ledger history for commercial/partner/notification correction;
10. permission to skip B2 customer-activation rollout, B2 public-channel implementation, B2 cross-region/cross-currency rollout, B2 partner onboarding beyond `NIBSS_NIP`, B2 broad customer activation, or B2 production rollout review;
11. permission to treat fixture-based commercial certification as live partner/live product/live commercial dispatch; and
12. ADR-0048 transport/credential/signing/key-rotation evidence (ADR-0048 is the A6T03 decision record and must be authored/approved before any partner-specific transport/credential/signing/key-rotation evidence is claimed, irrespective of B1/B2 progress).

Violation of any prohibited edge is a handoff-stop and a B1 release-gate stop (see [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md) §5, [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) §3, and [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md) §8).

## 7. B2 entry conditions (requirements B2 must satisfy before any implementation)

B2 may not begin implementation until **all** of the following entry conditions are satisfied and are independently approved:

1. **B1 release gate is Approved**: all owners in [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) §4 are `Granted`; [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md) §2 acceptance is 17/17 `Pass`; [`B1-ADR-REVIEW-STATUS.md`](B1-ADR-REVIEW-STATUS.md) §4 blocker verdict is `NONE`; this handoff's status (§2, §9) is `UNBLOCKED` by Architecture.
2. **Finance/Ledger/Tax live approval**: B1T05 at-most-one Ledger effect pattern and B1T08 revenue/tax/cost patterns are live-certified by Finance/Ledger/Tax.
3. **Privacy/Security live approval**: B1T10 data-classification/minimization/consent/retention/legal-hold/secret/disclosure/support-trace patterns are live-certified by Privacy/Security.
4. **Legal/Risk/Compliance live approval**: B1 retention/legal-hold/disclosure patterns are live-certified by Legal/Risk/Compliance.
5. **Operations/Reconciliation/Support live approval + drills**: `MetricsService`/`DiagnosticsService` wiring, read-only reconciliation certification, and live disable/rollback drills (including circuit-breaker open and emergency-stop) are exercised in a staging environment that mirrors idempotency store/audit/circuit-breaker state and are approved by Operations/Reconciliation/Support.
6. **A2 audience/authorization + CustomerPreference intent**: all B1-adjacent internal surfaces and the A7T06 notification dispatcher handling B1 commercial payloads are reviewed for A2 audience/authorization and `CustomerPreference.notifications` intent; no public surface is wired without A2 approval.
7. **Partner certification**: `NIBSS_NIP` planning rail sandbox/certification is live-certified by Partner + Engineering for the B1 first commercial scope; no second partner may begin implementation without a separate A6 cycle.
8. **B2 scope definition**: B2 defines the bounded customer-activation cohort (size, residency, eligibility, region `NG`, currency `NGN`), the public-channel surface that will carry commercial activation (mobile/web/partner — if any), the marketing-consent onboarding that will carry commercial notifications (if any), the cross-region/cross-currency plan (if any — otherwise "not applicable" and explicitly "not planned in B2 kickoff"), and the `B2-IMPLEMENTATION-PLAN.md` that reserves its B2 ADR range contiguous after ADR-0071.
9. **B2 ADR readiness**: B2 commits to not renumbering ADR-0047..ADR-0071 and reserves its own B2 ADR range; B2 commits to not superseding ADR-0061..ADR-0069 without an explicit superseding decision.

Entry conditions are independently reviewed; a single unsatisfied condition blocks B2 implementation and sustains this handoff's `BLOCKED` status.

## 8. Deferred work register (B2+ only)

| ID | Item | Deferred from B1 because | Owning phase | Entry condition |
| --- | --- | --- | --- | --- |
| DW-B1-001 | Customer-activation rollout (cohort expansion beyond first commercial scope fixtures) | B1 explicitly does not begin B2; no broad activation permission granted | B2 | B2 entry condition §7.08 cohort definition + product notification channel approval |
| DW-B1-002 | Public-channel implementation (public customer/mobile/web/partner commercial APIs) | B1 is internal commercial platform only; route exposure is explicitly non-public | B2 (requires A2 audience/route review per channel) | A2 route/audience approval per channel + §7.06 |
| DW-B1-003 | Marketing-consent onboarding and marketing-notification consent screens | B1 does not invent consent; `CustomerPreference.notifications` is only intent authority | B2 | Marketing consent plan + `CustomerPreference` approval + Privacy/Security |
| DW-B1-004 | Cross-region / cross-currency rollout (any currency ≠ `NGN`, accounting unit ≠ `CUSTOMER_FUNDS`, region ≠ `NG`) | B1 is `NGN`/`NG`/`CUSTOMER_FUNDS` only | B2 (may also need A1/A5 cycles) | Regional/currency plan + A1/A5 policy/correctness review |
| DW-B1-005 | Partner onboarding beyond already-approved `NIBSS_NIP` planning rail (second partner, second capability version) | B1T01 prohibited adjacent partners; A6T03 not complete without ADR-0048 for new partner | B2 (requires A6 cycle per new partner) | A6 partner ADR/contract/certification per new partner + §7.07 |
| DW-B1-006 | Broad customer activation (marketing-driven cohort scale-up) | B1 is fixture/contract/service only; no live customer activation | B2 | Cohort readiness + reconciliation/monitoring/support readiness + §7.05 drills |
| DW-B1-007 | Commercial catalogue broad use (second scope/package/bundle beyond `commercial.virtual-account.inbound-funding` v1) | B1 catalog has one ACTIVE scope; catalog broad use requires separate B1 cycle per new scope | B1 extension before B2 expansion | New B1T01–T03 scope cycle + ADR in ADR-0070/0071 or B2 range + release gate |
| DW-B1-008 | Capacity, fan-out, bulk/throughput commercial dispatch at scale | B1 is deterministic fixture test; no throughput proof | B2 (production maturity) | Load/perf evidence + Operations/Maturity review |
| DW-B1-009 | Live Finance/Ledger/Tax certifications for commercial-financial-effects/recognition at volume | B1T11 explicitly does not claim live certification | B2 pre-activation | Finance/Ledger/Tax live certification drills |
| DW-B1-010 | Live reconciliation drill at volume and live rollback drill in staging | B1T11 fixture-only; live drill pending | B2 pre-activation | Operations/Reconciliation/Support drill approval + §7.05 |
| DW-B1-011 | Mobile app / web portal commercial UX that surfaces pricing/fees/billing/campaign/referral/loyalty/revenue/statement | B1 is contract/engine only; no customer UI authority | B2 | Product/UX/Privacy/Security review of each B1-decision's minimized disclosure projection |
| DW-B1-012 | Analytics dashboard/product-governance report that publishes commercial profitability/analytics outside internal audit/support audiences | B1T09 report is internal analytics; publication requires governance review | B2 | Governance review + `Data-classification` + disclosure level approval |

The deferred register is closed for B1: no deferred item is introduced as B1 implementation work by B1T11, and no deferred item is claimed done by the B1T11 handoff package.

## 9. Handoff status declaration (frozen)

> **Handoff status: BLOCKED.**

- The B1 implementation evidence is **Prepared** (B1T01–T10 fixtures/contracts/services at `d6e4d7c` plus B1T11's 7-doc package) and is not approved beyond documentation review.
- The B1 commercial release gate is **not approved** — all owners in [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) §4 are `Pending`, and [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md) §8 live validations that require production environment/partner execution are explicitly not claimed.
- The commercial disable/rollback/emergency-stop history preservation is **design-aligned and fixture-validated only** — live drill is explicitly not exercised (see [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md) §6.3).
- The B1-to-B2 handover items (§3) are bounded and cannot be consumed beyond the first selected commercial scope unless a separate B1 cycle re-freezes the catalog and re-gates the release.

Unblock requires: §7 entry conditions satisfied + Architecture signs the release-gate record on behalf of all owners + this document is amended to `UNBLOCKED` in a commit after B1 approval.

## 10. Cross-reference

- [`B1-INTEGRATION-MATRIX.md`](B1-INTEGRATION-MATRIX.md) — task-to-evidence matrix and end-to-end commercial authority trace
- [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md) — route exposure review and rollback procedures (including feature-flag readiness)
- [`B1-ADR-REVIEW-STATUS.md`](B1-ADR-REVIEW-STATUS.md) — ADR range review (ADR-0061..ADR-0071)
- [`B1-OPERATIONAL-RECOVERY-RUNBOOK.md`](B1-OPERATIONAL-RECOVERY-RUNBOOK.md) — operational recovery runbook, incident classification, decision matrix, support-trace, ownership/stop conditions, monitoring/disaster-recovery/support references
- [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md) — exit checklist, unresolved blockers, B1 phase result, risk register, known limitations, production readiness checklist
- [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) — owner approval register, no-go recommendation, go conditions, explicit non-claims, audit/compliance readiness
- [`B1-COMMERCIAL-PLATFORM-BASELINE.md`](B1-COMMERCIAL-PLATFORM-BASELINE.md) — B1 first commercial scope selection and prohibited adjacent scopes
- [`B1-COMMERCIAL-CATALOG-CONTRACT.md`](B1-COMMERCIAL-CATALOG-CONTRACT.md) — B1 catalog/plan-boundary contract
- [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md) — required sequencing (A1→A2→A4→A3→A6→A7T05→A7T07→A7T08→A7T09→B1T04→B1T05→B1T08→B1T09 confirms B1 ordering is satisfied)
- [`PHASES.md`](PHASES.md) — phase sequencing (B1 after A7, before B2)
