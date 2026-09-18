# A7 to A8 Handoff Package

- **From:** A7 — Product Expansion Infrastructure
- **To:** A8 — Scale & Selective Extraction (future phase)
- **Task:** A7T11 — A7 Integration, Product Certification, Release Gate, and A8 Handoff
- **Status:** Handoff prepared; **blocked until A7, A1, A2, A3, A4, A5, Finance, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, and partner approvals**
- **Classification:** Documentation-only downstream handoff and prohibited-edge evidence
- **Application, database, API, migration, controller, route, scheduler, notification, provider, settlement, and financial-runtime changes in this task:** None

## 1. Handoff purpose

A7 proves one bounded first product (`VIRTUAL_ACCOUNT` v1, capability `product.virtual-account`, action `lifecycle`, direction `inbound funding`, partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`). It may provide A8 with implementation contracts and evidence patterns, but it does **not** prove partner reliability, settlement finality, callback authenticity at production scale, suspense behavior under load, partner reconciliation at production scale, or any scale, regional, capacity, or extraction behavior. A8 must begin from a separately reviewed scale / extraction plan. A7 does not authorize A8 scale / extraction, A8 service topology change, A8 regional expansion, A8 partner expansion, A8 product expansion, A8 capacity expansion, A8 customer cohort expansion, A8 public API, A8 mobile / web channel, A8 marketing consent, A8 broad customer activation, A8 production rollout, or A8 notification channel implementation.

## 2. Permitted A8 handoff

A7 may hand off the following bounded artifacts after accountable approval.

### 2.1 Identity, correlation, and provider boundary

- Distinct `Customer.id`, internal command, A6T05 external-operation, A6T05 provider reference, callback event, settlement, suspense, journal, audit, outbox, notification, and reconciliation identifiers.
- A6T05 normalized semantic request hash and the internal / provider idempotency separation.
- A6T05 durable external-operation identity contract; replay vs changed-payload behavior; provider-reference uniqueness.
- A7T05 product command / operation identity; product-scoped idempotency; A7T08 product financial-effect reference; A7T09 product reconciliation reference; A7T10 product data-minimization reference.
- A2 / A3 / A4 separation; A3 read-only binding recheck; A4 currentness / evidence / limits / obligations consumption.
- A6T04 verified customer funding-instrument / beneficiary consumption contract (no raw credential, no metadata mutation, explicit A3 internal account chain).

### 2.2 Product, customer-binding, and lifecycle boundary

- One frozen A7 product registration (`VIRTUAL_ACCOUNT` v1) and the shared A7 product-boundary contract (A7T02).
- A7 product customer-binding map (A7T04) reusing the A3 binding recheck, the A6 partner reference, and the A6T04 funding-target mapping.
- A7 product lifecycle (A7T07) reusing the A6 lifecycle vocabulary; bounded retry policy; safe unknown / pending / manual-review / failed outcomes.
- A7 product command (A7T05) and product operation identity; provider reference uniqueness; A7 product idempotency contract.
- A7 product financial effect (A7T08) reusing the A6T08 settlement, suspense, and exception ownership; A5 Ledger authority; immutable Ledger history; compensating-entry reuse; exception ownership without auto-clearing.

### 2.3 Notification, reconciliation, and data-minimization boundary

- A7 product notification-delivery dispatcher (A7T06) reusing `CustomerPreference.notifications` and the A6T10 / A7T10 data controls; A6T10 / A7T10 disclosure audience maximums; A6T10 / A7T10 redaction; no live email, SMS, push, or web channel wired.
- A7 product reconciliation (A7T09) reusing the A6T09 external reconciliation snapshot; REPEATABLE READ read-only TypeORM transaction; classified support trace; certification evidence; handoff envelope; no source-record mutation; no auto-repair.
- A7 product data-minimization (A7T10) reusing the A6T10 data classification registry, the A6T10 consent record, the A6T10 retention classification, the A6T10 legal-hold, the A6T10 secret classification, the A6T10 disclosure projection, the A6T10 support-trace projection, and the A6T10 partner-payload validation; A7T10 first-party product purpose `PRODUCT_VIRTUAL_ACCOUNT_INBOUND_FUNDING` registered; 35 A7 product field classifications; A7T10 read-only.

### 2.4 Operational, recovery, and approval boundary

- A7 disable / rollback procedure (A7T11) and A7 internal financial history preservation (A7T11).
- A7 operational recovery runbook (A7T11); A7 incident classification (A7T11); A7 decision matrix (A7T11); A7 support-trace contract (A7T11).
- A7 owner approval register (A7T11); A7 no-go recommendation (A7T11); A7 go conditions (A7T11); A7 implementation-vs-production distinction (A7T11).
- A7 ADR review status (A7T11); A7 exit checklist (A7T11).

## 3. Prohibited edges

A7 explicitly does **not** permit A8 to claim the following.

### 3.1 Prohibited A8 implementation edges

- A8 may not begin A8 implementation, A8 service topology change, A8 regional expansion, A8 partner expansion, A8 product expansion, A8 capacity expansion, A8 customer cohort expansion, A8 public API, A8 mobile / web channel, A8 marketing consent, A8 broad customer activation, A8 production rollout, or A8 notification channel implementation.
- A8 may not claim A7 partner reliability, A7 settlement finality, A7 callback authenticity at production scale, A7 suspense behavior under load, or A7 partner reconciliation at production scale as A8 evidence.
- A8 may not bypass the A2 authentication / authorization, the A3 binding recheck, the A4 policy / evidence / currentness / obligations / limits, the A5 Ledger authority, the A6 partner boundary, the A7 product catalog, the A7 product-policy, the A7 product customer-binding, the A7 product command / idempotency, the A7 product notification-delivery, the A7 product lifecycle, the A7 product financial-effect, the A7 product reconciliation, the A7 product data-minimization, or the shared Operations audit / idempotency / outbox / metrics / diagnostics.
- A8 may not introduce a second audit, idempotency, outbox, metrics, diagnostics, customer-binding, policy, authorization, notification, settlement, reconciliation, or `CustomerPreference` authority.

### 3.2 Prohibited A8 data-sharing and disclosure edges

- A8 may not share raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data with A8 surface.
- A8 may not bypass the A6T10 / A7T10 data classification, consent, retention, legal-hold, secret, disclosure, support-trace, or partner-payload validation.
- A8 may not extend the A7T10 disclosure audience maximums to a new audience without a separate A7T10 disclosure projection review.

### 3.3 Prohibited A8 product-expansion edges

- A8 may not extend the A7 product catalog to a second product, a second partner, a second currency, a second accounting unit, a second capability, a second action, or a second direction without a separate reviewed A7 product-expansion plan and a separate reviewed ADR in the proposed A7 ADR range.
- A8 may not extend the A7 product customer-binding map to a second virtual-account identifier, a second partner reference, a second A6T04 funding-target mapping, or a second A3 internal account chain without a separate reviewed A7 product customer-binding contract and a separate reviewed ADR.

### 3.4 Prohibited A8 financial-effect edges

- A8 may not post a journal, mutate a balance, clear suspense, or edit a posted journal / line outside Ledger and Finance-approved correction boundaries.
- A8 may not introduce a second Ledger authority, a second financial-invariants engine, a second settlement authority, a second suspense authority, a second compensating-entry authority, or a new product financial identity.
- A8 may not extend the A7T08 product financial-effect / settlement / suspense / compensating contract to a new currency, a new accounting unit, a new direction, or a new product without a separate reviewed A7 product financial-effect contract and a separate reviewed ADR.

### 3.5 Prohibited A8 notification and disclosure edges

- A8 may not bypass the A7T06 notification-delivery dispatcher's `CustomerPreference.notifications` intent authority.
- A8 may not wire a live email, SMS, push, or web channel without a separate reviewed A7T06 channel implementation and a separate reviewed ADR.
- A8 may not extend the A7T06 channel vocabulary to a new channel without a separate reviewed A7T06 channel implementation and a separate reviewed ADR.

## 4. A8 entry conditions

A8 may begin only after the following conditions are met.

### 4.1 A7 release-gate approval

- A7 release-gate review is approved by Architecture.
- A7 product activation is approved by Product.
- A7 partner certification is approved by the partner and Engineering.
- A7 Finance / Ledger approval of the A7T08 product financial effect is approved.
- A7 Privacy / Security approval of the A7T10 product data minimization is approved.
- A7 Legal / Risk / Compliance approval of the A7T10 product data minimization is approved.
- A7 Operations / Reconciliation / Support approval of the A7T09 product reconciliation and A7T10 product data-minimization support trace is approved.
- A7 A2 audience / authorization approval of the A7 internal command surface, the A6 partner callback surface, and the A7 product data-minimization control surface is approved.
- A7 `CustomerPreference` intent approval of the A7T06 notification delivery dispatcher is approved.

### 4.2 A7 evidence package completion

- A7T11 evidence package ([`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md), [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md), [`A7-ADR-REVIEW-STATUS.md`](A7-ADR-REVIEW-STATUS.md), [`A7-OPERATIONAL-RECOVERY-RUNBOOK.md`](A7-OPERATIONAL-RECOVERY-RUNBOOK.md), [`A7-EXIT-CHECKLIST.md`](A7-EXIT-CHECKLIST.md), [`A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md), [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md)) is approved.
- A7 live reconciliation drill is performed and reviewed by Reconciliation.
- A7 partner certification is performed and reviewed by Engineering and the partner.
- A7 disable / rollback procedure is reviewed by Operations.

### 4.3 A8 prerequisites

- A8 plan is authored and reviewed by Architecture.
- A8 ADR is authored and reviewed.
- A8 service topology change (if any) is reviewed and approved by Architecture and Operations.
- A8 regional expansion (if any) is reviewed and approved by Legal, Risk, Compliance, and Privacy.
- A8 partner expansion (if any) is reviewed and approved by the partner and Engineering.
- A8 product expansion (if any) is reviewed and approved by Product and Architecture.
- A8 capacity expansion (if any) is reviewed and approved by Engineering and Operations.
- A8 customer cohort expansion (if any) is reviewed and approved by Product, Privacy, Legal, Risk, and Compliance.
- A8 public API (if any) is reviewed and approved by Architecture, Security, and Privacy.
- A8 mobile / web channel (if any) is reviewed and approved by Product, Security, and Privacy.
- A8 marketing consent (if any) is reviewed and approved by Product, Privacy, Legal, Risk, and Compliance.
- A8 broad customer activation (if any) is reviewed and approved by Product, Privacy, Legal, Risk, Compliance, Operations, Support, and the partner.
- A8 production rollout (if any) is reviewed and approved by Engineering, Operations, Finance, Ledger, Privacy, Security, Legal, Risk, Compliance, Reconciliation, Support, and the partner.
- A8 notification channel implementation (if any) is reviewed and approved by Product, Privacy, and the partner.

### 4.4 A7-to-A8 handoff package approval

- A7 to A8 handoff package (this document) is reviewed and approved by Architecture, Product, Engineering, Finance, Ledger, Privacy, Security, Legal, Risk, Compliance, Operations, Reconciliation, Support, and the partner.
- A7 evidence package is bound to the A8 plan and the A8 ADR.
- A8 plan is bound to the A7 evidence package and the A7 ADR review status.

## 5. Blocked handoff status

The A7-to-A8 handoff is **blocked** until the A7 release-gate approval (§4.1), the A7 evidence package completion (§4.2), the A8 prerequisites (§4.3), and the A7-to-A8 handoff package approval (§4.4) are completed.

The A7T11 evidence package records the blocked handoff status as the release-gate review surface. The A7T11 evidence package does **not** claim the A7-to-A8 handoff approval. The A7T11 evidence package does **not** begin A8.

## 6. Non-claims

The A7T11 evidence package explicitly does **not** claim the following.

- A7 release-gate approval.
- A7 product activation.
- A7 partner certification.
- A7 Finance / Ledger approval.
- A7 Privacy / Security approval.
- A7 Legal / Risk / Compliance approval.
- A7 Operations / Reconciliation / Support approval.
- A7 A2 audience / authorization approval.
- A7 `CustomerPreference` intent approval.
- A7 live reconciliation drill.
- A7 broad customer activation.
- A7 mobile / web channel implementation.
- A7 public API implementation.
- A7 marketing consent.
- A7 A8 scale / extraction.
- A7 product expansion beyond the first selected product.
- A8 implementation, A8 service topology change, A8 regional expansion, A8 partner expansion, A8 product expansion, A8 capacity expansion, A8 customer cohort expansion, A8 public API, A8 mobile / web channel, A8 marketing consent, A8 broad customer activation, A8 production rollout, or A8 notification channel implementation.

The A7T11 evidence package records the non-claims as the release-gate review surface. The A7T11 evidence package is documentation-only and does **not** begin A8 or any product-roadmap expansion.

## 7. Cross-reference

- [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md) — A7 task-to-evidence matrix and end-to-end product authority trace.
- [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md) — A7 route exposure review and rollback procedures.
- [`A7-ADR-REVIEW-STATUS.md`](A7-ADR-REVIEW-STATUS.md) — A7 ADR review status against committed implementation evidence.
- [`A7-OPERATIONAL-RECOVERY-RUNBOOK.md`](A7-OPERATIONAL-RECOVERY-RUNBOOK.md) — A7 operational recovery runbook, incident classification, and decision matrix.
- [`A7-EXIT-CHECKLIST.md`](A7-EXIT-CHECKLIST.md) — A7 exit checklist and A7 phase result.
- [`A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md) — A7 owner approval register and no-go recommendation.
