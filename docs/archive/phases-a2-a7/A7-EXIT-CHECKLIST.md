# A7 Exit Checklist

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T11 — A7 Integration, Product Certification, Release Gate, and A8 Handoff
- **Status:** Prepared for accountable-owner review; not approved
- **Integration matrix:** [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md)
- **Route/rollback evidence:** [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md)
- **ADR review:** [`A7-ADR-REVIEW-STATUS.md`](A7-ADR-REVIEW-STATUS.md)
- **Recovery runbook:** [`A7-OPERATIONAL-RECOVERY-RUNBOOK.md`](A7-OPERATIONAL-RECOVERY-RUNBOOK.md)
- **Approval package:** [`A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md)
- **A8 handoff:** [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md)

## 1. Task evidence

| Task | Required evidence | Repository evidence | Status |
| --- | --- | --- | --- |
| A7T01 | Product expansion baseline, first-product selection, prohibited edges, gap register, certification inputs | [`A7-PRODUCT-EXPANSION-BASELINE.md`](A7-PRODUCT-EXPANSION-BASELINE.md), [`A7-IMPLEMENTATION-PLAN.md`](A7-IMPLEMENTATION-PLAN.md) §3.1, §3.2 | Implemented/documented |
| A7T02 | Product catalog and product-boundary contract | [ADR-0054](ADR/ADR-0054-Virtual-Account-Product-Boundary.md), [`A7-PRODUCT-CATALOG-CONTRACT.md`](A7-PRODUCT-CATALOG-CONTRACT.md) | Implemented/documented |
| A7T03 | Product-specific A4 policy profile and limit extension | [`A7-PRODUCT-POLICY-PROFILE-CONTRACT.md`](A7-PRODUCT-POLICY-PROFILE-CONTRACT.md), `src/policy/a7-product-policy.service.ts`, `src/policy/a7-product-policy.persistence.repository.ts`, `src/policy/a7-product-policy.replay.service.ts`, `src/policy/a7-product-policy.audit.adapter.ts` | Implemented/tested |
| A7T04 | Product customer-binding, ownership, and internal account mapping | [`A7-PRODUCT-CUSTOMER-BINDING-CONTRACT.md`](A7-PRODUCT-CUSTOMER-BINDING-CONTRACT.md), `src/policy/a7-product-customer-binding.service.ts`, `src/policy/a7-product-customer-binding.repository.ts` | Implemented/tested |
| A7T05 | Product command identity, lifecycle, and idempotency | [`A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md`](A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md), `src/policy/a7-product-command.service.ts`, `src/policy/a7-product-command.repository.ts` | Implemented/tested |
| A7T06 | Notification delivery infrastructure and preferences enforcement | [`A7-NOTIFICATION-DELIVERY-CONTRACT.md`](A7-NOTIFICATION-DELIVERY-CONTRACT.md), `src/policy/a7-product-notification-delivery.service.ts`, `src/policy/a7-product-notification-delivery.repository.ts` | Implemented/tested |
| A7T07 | Product lifecycle, retry, manual review, and unknown outcomes | `src/policy/a7-product-lifecycle.service.ts`, `src/policy/a7-product-lifecycle.repository.ts` | Implemented/tested |
| A7T08 | Product financial effect, settlement, and Ledger integration | [`A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md`](A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md), `src/policy/a7-product-financial-effect.service.ts`, `src/policy/a7-product-financial-effect.repository.ts` | Implemented/tested |
| A7T09 | Independent product reconciliation and support trace | [`A7-PRODUCT-RECONCILIATION-CONTRACT.md`](A7-PRODUCT-RECONCILIATION-CONTRACT.md), `src/policy/a7-product-reconciliation.service.ts`, `src/policy/a7-product-reconciliation.repository.ts` | Implemented/tested |
| A7T10 | Product data minimization, consent, classification, retention, secret, and disclosure controls | [`A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md`](A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md), `src/policy/a7-product-data-minimization.service.ts`, `src/policy/a7-product-data-minimization.repository.ts` | Implemented/tested |
| A7T11 | Complete evidence, release/rollback, approvals, exit, and A8 handoff | This documentation package | Prepared; approval pending |

## 2. A7 acceptance checklist

The A7 acceptance checklist maps the A7 plan §12 phase exit criteria to the A7T11 evidence package.

| A7 plan §12 phase exit criterion | A7T11 evidence | Status |
| --- | --- | --- |
| The first selected product has an explicit product key, capability, currency, data, consent, internal command, partner dependency, prohibited-edge, and notification/support/reporting contract | [`A7-PRODUCT-EXPANSION-BASELINE.md`](A7-PRODUCT-EXPANSION-BASELINE.md), [`A7-PRODUCT-CATALOG-CONTRACT.md`](A7-PRODUCT-CATALOG-CONTRACT.md) | Implemented |
| The A7 product catalog and product-boundary contract are stable and prevent product-specific behavior from becoming a source authority in canonical modules | [`A7-PRODUCT-CATALOG-CONTRACT.md`](A7-PRODUCT-CATALOG-CONTRACT.md) | Implemented |
| Product-specific A4 policy profiles are versioned, replayable, and governed by A4 precedence | [`A7-PRODUCT-POLICY-PROFILE-CONTRACT.md`](A7-PRODUCT-POLICY-PROFILE-CONTRACT.md), `a7-product-policy.persistence.repository.ts`, `a7-product-policy.replay.service.ts`, `a7-product-policy.audit.adapter.ts` | Implemented/tested |
| Product customer-binding and internal account mapping never infer or repair A3 bindings from product data, virtual-account identifiers, or partner references | [`A7-PRODUCT-CUSTOMER-BINDING-CONTRACT.md`](A7-PRODUCT-CUSTOMER-BINDING-CONTRACT.md) | Implemented |
| Product command, product operation, partner reference, callback event, internal command, idempotency, journal, settlement, suspense, audit, outbox, notification, and reconciliation identifiers remain distinct and queryable | [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md) §4 | Implemented |
| Notification delivery honors `CustomerPreference.notifications` and the A6T10 / A7T10 data controls; the dispatcher cannot become an A2, A3, A4, or Ledger authority | [`A7-NOTIFICATION-DELIVERY-CONTRACT.md`](A7-NOTIFICATION-DELIVERY-CONTRACT.md), [`A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md`](A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md) | Implemented |
| Product retries, manual review, status verification, outages, and unknown outcomes are bounded, support-traceable, and reuse A6 lifecycle vocabulary where applicable | `a7-product-lifecycle.service.ts`, `a7-product-lifecycle.repository.ts` | Implemented/tested |
| Verified product outcomes create at most one balanced Ledger-owned financial effect, or enter explicit pending/suspense/manual-review/reconciliation state | [`A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md`](A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md) | Implemented/tested |
| Suspense, exception, reversal, and correction behavior preserves immutable Ledger history and assigns ownership without automatic source repair | [`A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md`](A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md), [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md) §5 | Implemented |
| Independent product reconciliation detects missing, duplicate, orphan, delayed, mismatched, stale, and unresolved product/partner/settlement evidence without writing source records | [`A7-PRODUCT-RECONCILIATION-CONTRACT.md`](A7-PRODUCT-RECONCILIATION-CONTRACT.md) | Implemented/tested |
| Product certification fixtures and tests cover product command, callback, replay, duplicate, outage, timeout, status query, settlement, suspense, reconciliation, data minimization, notification delivery (fixture-based only), and rollback behavior | [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md) §5, A7T01-A7T10 unit, contract, type, service, repository, and module tests | Implemented/tested |
| Data sharing, consent, retention, legal-hold, secret, support, and customer/internal disclosure controls are explicit and tested at the selected boundary | [`A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md`](A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md), A7T10 tests | Implemented/tested |
| Disable and rollback controls stop new product and notification activity without rewriting A5, A6, or Ledger financial history | [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md) §3-§5 | Implemented |
| A1, A2, A3, A4, A5, A6, A7, Wallet, Ledger, Operations, Outbox, Reconciliation, and `CustomerPreference` authorities remain separate | A7T01-A7T10 contracts and services | Implemented |
| No A8 scale / extraction, public API, notification channel implementation, mobile / web channel, marketing consent, unapproved second product, unapproved second partner, or broad customer activation is included | [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md) §2, [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md) | Implemented |
| A7-to-A8 handoff is documented without claiming that A7 proves all future scale, regional, capacity, or extraction behavior or broad production activation | [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md) | Implemented |

## 3. Unresolved blockers

The A7T11 evidence package records the following unresolved blockers as release-gate review items:

1. **ADR-0048 (A6T03 decision record) is not yet authored.** Per the A7 plan §13 handoff, ADR-0048 is an A6T03 decision record and must be authored/approved before any partner-specific transport / credential / signing / key-rotation evidence is claimed, irrespective of A7 progress. ADR-0048 authoring is **not** an A7 dependency; it is an A6T03 / A7T11 cross-reference. Until ADR-0048 is authored, no live partner transport call is claimed by the A7T11 evidence package.
2. **Finance / Ledger approval of the A7T08 product financial effect, settlement, and Ledger integration is pending.** A7T08 is implementation-aligned; the Finance / Ledger approval is the release-gate gating review. The A7T11 evidence package does **not** claim Finance / Ledger approval.
3. **Privacy / Security approval of the A7T10 product data minimization, consent, classification, retention, legal-hold, secret, and disclosure controls is pending.** A7T10 is implementation-aligned; the Privacy / Security approval is the release-gate gating review. The A7T11 evidence package does **not** claim Privacy / Security approval.
4. **A2 audience / authorization approval of the A7 internal product command surface, the A6 partner callback surface, and the A7 product data-minimization control surface is pending.** The A7T11 evidence package does **not** claim A2 audience / authorization approval.
5. **`CustomerPreference` intent approval of the A7T06 notification delivery dispatcher is pending.** The A7T11 evidence package does **not** claim `CustomerPreference` intent approval.
6. **Support ownership of the A7T09 product reconciliation support trace and the A7T10 product data-minimization support trace is pending.** The A7T11 evidence package does **not** claim Support ownership.
7. **Live reconciliation drill is pending.** The A7T11 evidence package does **not** claim a live reconciliation drill.
8. **Live partner certification is pending.** The A7T11 evidence package does **not** claim live partner certification.
9. **Live customer activation is pending.** The A7T11 evidence package does **not** claim live customer activation.
10. **Mobile / web channel implementation is out of scope of A7.** The A7T11 evidence package does **not** claim a mobile / web channel.
11. **Public API implementation is out of scope of A7.** The A7T11 evidence package does **not** claim a public API.
12. **A8 scale / extraction is out of scope of A7.** The A7T11 evidence package does **not** begin A8.
13. **Product expansion beyond the first selected product is out of scope of A7.** The A7T11 evidence package does **not** claim a second product.

## 4. A7 phase result

The A7 phase result, as of the A7T10 commit (`2746521`) and the A7T11 evidence package, is:

- **A7 implementation:** Complete (A7T01 through A7T10 implementation and tests are committed).
- **A7 documentation:** Complete (A7T01 through A7T10 contract documents are committed).
- **A7 integration evidence:** Prepared (this A7T11 evidence package).
- **A7 release-gate review:** Pending (the A7T11 evidence package records the release-gate review actions; the A7T11 evidence package does **not** claim the release-gate review approval).
- **A7 owner approval:** Pending (the A7T11 evidence package records the owner approval register; the A7T11 evidence package does **not** claim the owner approval).
- **A7 partner certification:** Pending (the A7T11 evidence package records the partner certification cross-reference; the A7T11 evidence package does **not** claim partner certification).
- **A7 product activation:** Not started (the A7T11 evidence package does **not** claim product activation).
- **A8 handoff:** Blocked (the A7T11 evidence package records the A8 entry conditions and the blocked handoff status).

The A7 phase result, as recorded in the A7T11 evidence package, is **Prepared, not approved, not certified, not activated, not handed off to A8**.

## 5. Cross-reference

- [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md) — A7 task-to-evidence matrix and end-to-end product authority trace.
- [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md) — A7 route exposure review and rollback procedures.
- [`A7-ADR-REVIEW-STATUS.md`](A7-ADR-REVIEW-STATUS.md) — A7 ADR review status against committed implementation evidence.
- [`A7-OPERATIONAL-RECOVERY-RUNBOOK.md`](A7-OPERATIONAL-RECOVERY-RUNBOOK.md) — A7 operational recovery runbook, incident classification, and decision matrix.
- [`A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md) — A7 owner approval register and no-go recommendation.
- [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md) — A7 to A8 bounded handoff, prohibited edges, A8 entry conditions, and blocked handoff status.
