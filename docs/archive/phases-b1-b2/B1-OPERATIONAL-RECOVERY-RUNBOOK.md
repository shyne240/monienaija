# B1 Operational Recovery Runbook

- **Phase:** B1 — Commercial Platform
- **Task:** B1T11 — B1 Commercial Integration, Commercial Plan Certification, Commercial Release Gate, and B2 Handoff
- **Status:** Prepared for accountable-owner review; not approved
- **Classification:** Documentation-only operational recovery runbook for the first selected commercial scope and the shared B1 commercial-platform infrastructure
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None
- **Review snapshot:** `d6e4d7c` (post-B1T10)
- **B1 first commercial scope:** `commercial.virtual-account.inbound-funding` v1 / `NGN` / `CUSTOMER_FUNDS` / under `VIRTUAL_ACCOUNT` v1 / partner `NIBSS_NIP` planning rail

## 1. Operating principles

1. **Ledger is the only financial value authority.** B1 never posts a journal, mutates a balance, clears suspense, or edits a posted journal/line outside Ledger and Finance-approved correction boundaries.
2. **Read-only reconciliation.** B1T09 `b1-commercial-analytics-engine` runs in a REPEATABLE READ read-only TypeORM transaction; it never auto-repairs, never overwrites source records, and assigns discrepancy ownership without mutation.
3. **Data minimization reuse.** B1T10 `b1-commercial-governance-engine` reuses the A6T10 `ExternalDataClassificationRegistry` (the only data-classification authority), the A6T10 `ExternalDataMinimizationService` (the only data-minimization authority), and the A1 identifier/privacy/retention/legal-hold controls; B1 does not invent a parallel commercial privacy authority.
4. **Idempotency reuse.** B1T10 reuses the shared Operations `IdempotencyService` (the only idempotency authority); same-key/same-payload → replay (`AVAILABLE`/`REPLAYED`/`CLASSIFIED`/`AUDITED`/`ROLLED_OUT`); same-key/changed-payload → conflict (`CONFLICTED`/`REJECTED`/`FAIL`).
5. **Audit reuse.** B1T10 reuses the shared Operations `AuditService` (the only audit authority); every B1 decision is recorded as an audit fact with correlated `commercialDecisionReference` + `billingDocumentReference` + `campaignDecisionReference` + `recognitionEventReference`.
6. **Approval reuse.** B1T10 reuses the A2 privileged-action approval surface (the only approval authority); no second commercial approval engine exists.
7. **Feature-flag single surface.** B1T10 `COMMERCIAL_FEATURE_FLAG` (`DRAFT`→`REGISTERED`→`ROLLED_OUT`→`ENABLED`/`DISABLED`→`RETIRED`) is the only B1 flag surface; A4 remains the only policy authority.
8. **Notification respect.** B1 honors `CustomerPreference.notifications` (the only customer intent authority) via A7T06 `NotificationDeliveryService`; no B1 engine dispatches a notification directly.
9. **Fail closed.** Any prohibited edge, second scope, second partner, second authority, or incompatible version fails closed to `REJECTED`/`FAIL` without partial financial effect.
10. **History preservation.** Disable/rollback/emergency-stop preserve all completed A5/A6/A7/B1 histories (see [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md) §5).

## 2. Evidence sources

| Evidence source | Authority | Evidence type | Retention hint |
| --- | --- | --- | --- |
| `b1-commercial-catalog` (B1T02/T03) | B1T02/T03 | Catalog registration, plan, tier, entitlement, package, bundle; compatibility assertions | 365d per `B1-COMMERCIAL-GOVERNANCE-CONTRACT.md` |
| `b1-fee-engine` (B1T04) | B1T04 | `B1CommercialDecisionV1` fee/commission/revenue-sharing decisions; request hash; idempotency key | 365d |
| `b1-billing-engine` (B1T05) | B1T05 | `B1BillingDocumentV1` billing/invoice/statement documents; financial-effect reference; `B1_BILLING_ENGINE_NUMBER_CONFLICT` | 365d + regulatory per retention class |
| `b1-campaign-engine` (B1T06) | B1T06 | `B1CampaignDecisionV1` campaign/promotion/coupon decisions; eligibility references | 365d |
| `b1-referral-engine` (B1T07) | B1T07 | `B1ReferralDecisionV1` referral/cashback/loyalty decisions; tier/loyalty references | 365d |
| `b1-revenue-recognition-engine` (B1T08) | B1T08 | Revenue/tax/cost decisions; deferred vs realized; jurisdiction; allocation method | Tax-retention per jurisdiction (see `B1-REVENUE-RECOGNITION-CONTRACT.md` cost/tax class) |
| `b1-commercial-analytics-engine` (B1T09) | B1T09 | Read-only analytics/profitability/reconciliation reports; discrepancy classification; support trace envelope | 365d |
| `b1-commercial-governance-engine` (B1T10) | B1T10 | Classification, idempotency reservation, audit fact, approval trace, flag rollout state | Classification-dependent (see §7) |
| A4 policy version/currentness/re-evaluation | A4 | Policy version + expiry + limit + obligation + currentness decision | Per `A4-POLICY-PERSISTENCE-CONTRACT.md` |
| A3 binding recheck | A3 | `CustomerWalletBinding` ownership/current/verified state | Per `A3-BINDING-BASELINE.md` |
| Ledger journal/lines | A5 Ledger | Journal posting via Ledger-owned path only | Immutable; legal-hold governed |
| A6 external operation/callback/settlement/suspense | A6 | External operation lifecycle; callback replay/freshness; settlement/suspense entries | Per `A6-EXTERNAL-OPERATION-CONTRACT.md`, `A6-SETTLEMENT-SUSPENSE-AND-EXCEPTION-CONTRACT.md` |
| A7 product command/lifecycle/financial-effect/notification/reconciliation | A7 | Product command, lifecycle, financial effect, delivery intent/fact, reconciliation report | Per `A7-PRODUCT-*-CONTRACT.md` |
| Operations Audit/Idempotency/Outbox/Metrics/Diagnostics | Operations | Audit facts, idempotency reservations (`86_400s` TTL), outbox events, metrics counters, diagnostic traces | Per `OPERATIONS-GUIDE.md` |

## 3. Operational readiness evidence (summary)

Operational readiness for B1 is evidenced by:

- **Monitoring readiness (§2.5):** Operations `MetricsService` + `DiagnosticsService` reuse; B1T09 emits discrepancy-owner metrics; B1T10 emits classification/audit/approval/flag counters; no second metrics authority.
- **Audit readiness (§7 main contract):** Every B1 decision emits an immutable audit fact via `AuditService`; correlation chain `commercialDecisionReference → billingDocumentReference → recognitionEventReference → analyticsReportReference` is queryable.
- **Support readiness (§7.2):** `B1-COMMERCIAL-GOVERNANCE-CONTRACT.md` classifies support-trace fields `PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED`/`HIGHLY_RESTRICTED`; raw PAN/PIN/OTP/signatures/keys never appear in support trace.
- **Disaster recovery (§8):** Design-aligned reuse of existing `DISASTER-RECOVERY.md`; B1 adds no new backup/restore mechanism; history preserved through disable/rollback.
- **Compliance readiness:** B1 honor A6T10 commercial consent/retention/legal-hold + A7T10 product data-minimization + `CustomerPreference.notifications`; no B1 engine infers `CustomerPreference` or bypasses A4/A3.

## 4. Incident classification

| ID | Category | Severity | Example | Detectable via |
| --- | --- | --- | --- | --- |
| INC-B1-001 | Catalog/plan-boundary | High | Unknown `scopeKey` or incompatible `planVersion` | `B1CommercialCatalog.assertCompatible` → `INCOMPATIBLE` audit |
| INC-B1-002 | Fee/commission calculation | Medium | Deterministic fee mismatch or `B1_FEE_ENGINE_INCOMPATIBLE` | `b1-fee-engine` replay hash comparison |
| INC-B1-003 | Billing/invoice/statement | High | `NUMBER_CONFLICT` or duplicate billing document | `B1BillingEngine` `NUMBER_CONFLICT` failure code |
| INC-B1-004 | Campaign/promotion/coupon incentive | Low | `NOT_APPLICABLE` promotion evaluated as reward | `B1CampaignEngine` eligibility `FAIL`/`NOT_APPLICABLE` |
| INC-B1-005 | Referral/cashback/loyalty incentive | Low | Tier-entitlement mismatch | `B1ReferralEngine` `TIER_INELIGIBLE` |
| INC-B1-006 | Revenue recognition/tax/cost-accounting | High | `TAX_JURISDICTION_INVALID` or `COST_ALLOCATION_INVALID` | `B1RevenueRecognitionEngine` failure vocab |
| INC-B1-007 | Analytics/profitability/reconciliation | Medium | Missing/duplicate/orphan/delayed financial effect | `B1CommercialAnalyticsEngine` discrepancy `MISSING`/`DUPLICATE`/`ORPHAN`/`STALE` |
| INC-B1-008 | Data classification/minimization/consent | High | `COMMERCIAL_RETENTION_CLASS` missing or consent assertion `DENIED` | `B1CommercialGovernanceEngine` classification `DISCREPANCY` |
| INC-B1-009 | Idempotency / replay | Medium | Same-key/changed-payload `CONFLICTED` storm | `IdempotencyService` `CONFLICTED` metric spike |
| INC-B1-010 | Governance / audit / approval | High | Unapproved commercial decision emitted | `AuditService` actor mismatch; approval `REQUIRED` vs `GRANTED` |
| INC-B1-011 | Feature flag | Medium | Flag `DISABLED` overridden | `COMMERCIAL_FEATURE_FLAG` audit `DENIED` |
| INC-B1-012 | Policy/currentness | High | A4 policy `EXPIRED` consumed | `A4-POLICY-PERSISTENCE-CONTRACT.md` currentness check |
| INC-B1-013 | Binding recheck | High | A3 binding `INVALID` consumed | `A3-BINDING-BASELINE.md` recheck |
| INC-B1-014 | Ledger posting | Critical | At-most-one Ledger effect violated | Ledger `AVAILABLE` vs `FAIL` + A5 invariant breaker |
| INC-B1-015 | Partner transport / callback replay | Critical | Stale/replayed/malformed callback | `PartnerCallbackAuthService` `REPLAYED`/`EXPIRED`/`WRONG_PARTNER` |
| INC-B1-016 | Notification channel | Low | Channel dispatch bypassing `CustomerPreference` | `NotificationDeliveryService` suppression `SKIP` vs expected |

Each category maps to a severity (Critical > High > Medium > Low), an owner (§8), and a recovery procedure (§5). The `B1CommercialAnalyticsEngine` discrepancy classification vocabulary extends (does **not** replace) the `A6T09`/`A7T09` vocabularies.

## 5. Recovery procedure (B1-specific)

The B1 recovery procedure is: **detect → triage → contain → eradicate → recover → document**.

### 5.1 Detect

Monitor via §2 evidence sources + `MetricsService` counters + `DiagnosticsService` traces. No new monitoring primitive is introduced by B1.

### 5.2 Triage

Classify per §4; assign severity + owner + recovery state (`ADMITTED`→`PENDING`→`PENDING_RETRY`→`MANUAL_REVIEW`→`DISABLED`→`SETTLED`/`FAILED`). B1 reuses the A6 lifecycle vocabulary and the A7 lifecycle reuse.

### 5.3 Contain

Contain is B1 commercial-scope disable (single scope `commercial.virtual-account.inbound-funding` v1) per [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md) §3.1, A6 circuit-breaker disable for partner/capability `NIBSS_NIP`/`external.wallet.withdrawal.settlement` per same doc §3.3, A7 notification suppression per same doc §3.4, and B1 feature-flag `DISABLED` per same doc §3.2. Containment does **not** mutate any source record.

### 5.4 Eradicate

Eradicate is B1 pre- or post-activation rollback per [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md) §4. Eradication does **not** mutate any source record and never posts a new ledger journal.

### 5.5 Recover

Recover is re-enable for the affected scope/flag/partner/capability/notification channel after the B1 release-gate review + B1 owner approvals + Finance/Ledger/Tax approval + Privacy/Security approval + Legal/Risk/Compliance approval + Operations/Reconciliation/Support approval + partner certification. Recovery is **blocked** until all approvals in [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) §4 are `GRANTED`. No recovery proceeds without audit fact.

### 5.6 Document

Document is the audit fact via `AuditService` (only audit authority; A1) plus the §4 incident classification + §3 evidence snapshots + §6 decision matrix trace + §7 support-trace envelope + §8 ownership/stop-condition log. Document is the design-aligned evidence base for the B1 release-gate review.

## 6. Decision matrix

| B1 incident classification | B1 recovery procedure | B1 ownership | B1 stop condition |
| --- | --- | --- | --- |
| INC-B1-001 catalog/plan-boundary | B1 catalog review; `B1-COMMERCIAL-CATALOG` is the only catalog authority (B1T02) | Commercial / Architecture / B1T02 | `B1-COMMERCIAL-CATALOG-CONTRACT.md` review approves catalog/boundary/compatibility rules |
| INC-B1-002 fee/commission | B1T04 deterministic review; B1 fee engine is the only fee authority | B1T04 / Commercial / Finance | Fee engine review approves `B1-FEE-ENGINE-CONTRACT.md` + replay hash |
| INC-B1-003 billing/invoice/statement | B1T05 billing review; B1 billing engine is the only billing authority | B1T05 / Commercial / Finance / Ledger | Ledger + Finance review approves at-most-one effect + number-conflict handling |
| INC-B1-004 campaign/promotion/coupon | B1T06 campaign review; B1 campaign engine is the only campaign authority | B1T06 / Commercial | Campaign review approves eligibility + `CustomerPreference` respect |
| INC-B1-005 referral/cashback/loyalty | B1T07 referral review | B1T07 / Commercial | Referral review approves tier/entitlement/loyalty mapping |
| INC-B1-006 revenue/tax/cost | B1T08 revenue/tax/cost review | B1T08 / Finance / Ledger / Tax | Finance/Ledger/Tax review approves jurisdiction + allocation + deferred/realized |
| INC-B1-007 analytics/profitability/reconciliation | B1T09 reconciliation review (REPEATABLE READ read-only) | B1T09 / Reconciliation / Commercial | Reconciliation review approves discrepancy classification + handoff envelope |
| INC-B1-008 classification/consent/retention | B1T10 governance review; A6T10 is the only classification authority | B1T10 / Privacy / Security / Legal | Privacy/Security review approves classification/consent/retention/legal-hold/secret/disclosure |
| INC-B1-009 idempotency/replay | Operations idempotency review; `IdempotencyService` is the only idempotency authority | Operations / B1T10 | Conflict window / hash correctness proven |
| INC-B1-010 audit/approval | Operations audit review; `AuditService` is the only audit authority | Operations / A2 privileged-action / Legal | Actor + correlation + approval `GRANTED` proven |
| INC-B1-011 feature flag | B1T10 flag review | B1T10 / Commercial / A4 policy | Flag state `ENABLED`/`DISABLED` proven; A4 remains policy authority |
| INC-B1-012 policy currentness | A4 currentness review | A4 / Product | Policy `CURRENT` proven via `A4-POLICY-PERSISTENCE-CONTRACT.md` |
| INC-B1-013 binding recheck | A3 binding review | A3 / Product | Binding `VERIFIED` proven |
| INC-B1-014 ledger posting | Ledger review; Ledger is the only posting authority | Ledger / Finance / A5 | No second posting path detected; build graph shows no B1→ledger write import |
| INC-B1-015 partner/callback | A6 callback review; `PartnerCallbackAuthService` is the only callback authority | A6 / Security | Callback authenticity/replay/freshness proven |
| INC-B1-016 notification channel | A7T06 dispatch review | A7T06 / Privacy | `CustomerPreference.notifications` `GRANTED` proven |

The decision matrix is a read-only review surface. It does **not** introduce a new B1 incident authority or a new B1 recovery authority.

## 7. Support-trace contract

The B1 support-trace contract is the `B1CommercialGovernanceEngine` support-trace projection together with the `B1CommercialAnalyticsEngine` support-trace envelope acting as the only B1 support-trace authority. The contract is a read-only consumer of A1 identity, A2 authorization, A3 binding, A4 policy, A5 Ledger, A6 external operation/settlement/suspense/callback, A6T09 external reconciliation, A6T10 data-classification/disclosure/support-trace/partner-payload validation, A7 product catalog/policy/customer-binding/command/notification/lifecycle/financial-effect/reconciliation, B1T02 catalog, B1T04 commercial decision, B1T05 billing doc, B1T06 incentive, B1T07 rewards, B1T08 recognition, and Operations audit/idempotency/outbox/metrics/diagnostics.

### 7.1 Classification vocabulary

- **Data classification:** `PUBLIC` / `INTERNAL` / `CONFIDENTIAL` / `RESTRICTED` / `HIGHLY_RESTRICTED` (A1 vocabulary; B1T10 reuses via A6T10)
- **Retention classes:** `COMMERCIAL_RETENTION_OPERATIONS_DEFAULT` / `COMMERCIAL_RETENTION_AUDIT` / `COMMERCIAL_RETENTION_REGULATORY` / `COMMERCIAL_RETENTION_TAX` / `COMMERCIAL_RETENTION_SUPPORT` / `COMMERCIAL_RETENTION_LEGAL_HOLD` (per `B1-COMMERCIAL-GOVERNANCE-CONTRACT.md`)
- **Disclosure levels:** `COMMERCIAL_DISCLOSURE_NONE` / `COMMERCIAL_DISCLOSURE_INTERNAL` / `COMMERCIAL_DISCLOSURE_RESTRICTED` / `COMMERCIAL_DISCLOSURE_AUDIT` / `COMMERCIAL_DISCLOSURE_SUPPORT`
- **Sensitivity:** `COMMERCIAL_PII` / `COMMERCIAL_BILLING` / `COMMERCIAL_FINANCIAL` / `COMMERCIAL_TAX` / `COMMERCIAL_COST` / `COMMERCIAL_PARTNER` / `COMMERCIAL_INTERNAL` / `COMMERCIAL_PUBLIC`

### 7.2 Minimization rules

- Raw credentials, PAN/account secrets, PINs, OTPs, callback signatures, private keys, raw risk/compliance notes, unnecessary customer data never appear in support trace, logs, events, or commercial-decision payloads.
- Partner-payload validation reuses A6T10 `PartnerPayloadValidationService` (only payload validation authority).
- Disclosure projection reuses A6T10 disclosure projection (only disclosure authority).
- Legal-hold reuses A6T10 legal-hold (only legal-hold authority).

The support trace is consumed by the analytics report envelope, the reconciliation handoff, and the approval package.

## 8. Ownership and stop conditions

### 8.1 Ownership

- B1 catalog (B1T02/T03): **Commercial / Architecture** (authored by B1T02/T03)
- B1 fee/commission (B1T04): **B1T04 / Commercial / Finance**
- B1 billing/invoice/statement (B1T05): **B1T05 / Commercial / Finance / Ledger**
- B1 campaign/promotion/coupon (B1T06): **B1T06 / Commercial**
- B1 referral/cashback/loyalty (B1T07): **B1T07 / Commercial**
- B1 revenue/tax/cost (B1T08): **B1T08 / Finance / Ledger / Tax**
- B1 analytics/profitability/reconciliation (B1T09): **B1T09 / Reconciliation / Commercial**
- B1 governance/classification/idempotency/audit/approvals/flag (B1T10): **B1T10 / Privacy / Security / Legal / Operations / A2**
- B1 release-gate review: **Architecture** (B1T11)
- B1 owner approval: **Commercial, Architecture, Engineering, Finance, Ledger, Tax, Privacy, Security, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Partner**
- Partner certification: **Partner + Engineering** (inherits A6 certification)
- Environment emergency-stop: **Engineering / Operations**

### 8.2 Stop conditions

Release-gate review stops if:

- any B1 catalog/fee/billing/campaign/referral/revenue/analytics/governance acceptance criterion is unverified;
- integration matrix evidence incomplete;
- route exposure review identifies a new public commercial API / mobile/web channel / marketing consent / production rollout;
- ADR review identifies an un-authored ADR required for the first commercial scope;
- operational recovery runbook (this document) is incomplete;
- owner approval (any owner `Pending` or `Denied`);
- partner certification incomplete;
- Finance/Ledger/Tax approval incomplete;
- Privacy/Security approval incomplete;
- Legal/Risk/Compliance approval incomplete;
- Operations/Reconciliation/Support approval incomplete;
- commercial activation approval incomplete;
- any unresolved B1 implementation risk unowned;
- any prohibited edge detected (§9 of [`B1-COMMERCIAL-PLATFORM-BASELINE.md`](B1-COMMERCIAL-PLATFORM-BASELINE.md) or §8 of [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md));
- B2 is begun before B1 approval.

## 9. Disaster recovery references

B1 adds no new disaster-recovery primitive beyond the existing `DISASTER-RECOVERY.md` and the A1–A7 operational evidence:

- Primary DR reference: [`DISASTER-RECOVERY.md`](DISASTER-RECOVERY.md)
- Supporting references: [`RUNBOOK.md`](RUNBOOK.md), [`OPERATIONS-GUIDE.md`](OPERATIONS-GUIDE.md), [`DEPLOYMENT.md`](DEPLOYMENT.md), [`PRODUCTION-CHECKLIST.md`](PRODUCTION-CHECKLIST.md)
- B1-specific addition: Commercial disable/rollback/emergency-stop preserve history (see [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md) §5); no B1-specific backup, restore, failover, or multi-region drill is introduced at B1T11 and claiming one would be a live-operations non-claim.

## 10. Monitoring readiness

- **Metrics:** Operations `MetricsService` is the only metrics authority; B1T09 increments `b1_commercial_reconciliation_discrepancy_total{kind,owner}`, B1T10 increments `b1_commercial_governance_{classification,audit,approval,flag}_total`.
- **Diagnostics:** Operations `DiagnosticsService` is the only diagnostics authority; B1 emits correlated `commercialDecisionReference` + `billingDocumentReference` traces without secrets.
- **Health:** `health.controller` plus B1 readiness via catalog `assertCompatible` / flag `COMMERCIAL_ACTIVATION_READINESS`.
- No live dashboard is claimed by B1T11; dashboards are owned by Operations and are a post-approval wiring task.

## 11. Cross-reference

- [`B1-INTEGRATION-MATRIX.md`](B1-INTEGRATION-MATRIX.md) — task-to-evidence matrix and end-to-end commercial authority trace
- [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md) — route exposure review and rollback procedures (contain/eradicate source)
- [`B1-ADR-REVIEW-STATUS.md`](B1-ADR-REVIEW-STATUS.md) — ADR range review
- [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md) — exit checklist and B1 phase result
- [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md) — owner approval register and no-go recommendation
- [`B1-B2-HANDOFF-PACKAGE.md`](B1-B2-HANDOFF-PACKAGE.md) — bounded handoff to B2
- [`B1-COMMERCIAL-GOVERNANCE-CONTRACT.md`](B1-COMMERCIAL-GOVERNANCE-CONTRACT.md) — B1 governance, classification, idempotency, audit, approval, feature-flag vocabularies
- [`DISASTER-RECOVERY.md`](DISASTER-RECOVERY.md) — disaster-recovery references (read-only)
