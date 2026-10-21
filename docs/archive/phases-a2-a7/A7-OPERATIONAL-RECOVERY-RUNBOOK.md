# A7 Operational Recovery Runbook

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T11 — A7 Integration, Product Certification, Release Gate, and A8 Handoff
- **Status:** Prepared for accountable-owner review; not approved
- **Classification:** Documentation-only operational recovery evidence
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Purpose and evidence boundary

This document records the A7 product-expansion surface's operating principles, evidence sources, incident classification, recovery procedure, decision matrix, support-trace contract, and ownership / stop conditions. It is the A7 equivalent of the A6 operational recovery runbook. The A7 plan §8 A7T11 deliverables explicitly require the A7 operational recovery runbook, and the A7 plan §12 phase exit criteria require the A7 phase to pass before any product activation.

The A7T11 evidence package does **not** claim any live exercise of the A7 operational recovery procedure. The A7T11 evidence package records the design-aligned operating principles, evidence sources, and decision matrix as the release-gate review evidence.

## 2. Operating principles

The A7 operational recovery runbook follows the A7 plan §6 governing architectural boundaries and the A7 plan §11 prohibited edges:

1. Customer identity, A3 binding, Wallet, Ledger, Operations, Outbox, Idempotency, Metrics, Diagnostics, Reconciliation, and `CustomerPreference` are the only authorities in their respective domains. A7 does not introduce a second authority in any of these domains.
2. A2 authenticates and authorizes the initiating principal and protects internal product, callback, notification, support, and control surfaces. A product event, preference value, or partner callback cannot grant A2 authorization.
3. A4 owns action-specific capability, risk, restriction, eligibility, compliance, limit, and obligation policy. A7 consumes the current result and does not duplicate or override A4 precedence; product-specific A4 profiles extend, not replace, A4 authority.
4. A3 owns the explicit Customer-to-Financial-Account binding. A7 uses verified internal account assertions and never chooses an account from a customer reference, product identifier, preference value, partner reference, or virtual-account identifier.
5. `CustomerPreference` (including `NotificationPreference`) is the customer intent authority for delivery. A7 delivers according to that intent; it does not invent or replace the intent.
6. `WalletAccount` remains the financial wallet facade, and `Ledger` remains the sole authority for financial accounts, journals, lines, balances, posted value, settlement entries, suspense entries, and compensating entries.
7. External side effects and internal database transactions have different commit boundaries. A7 represents the gap with durable lifecycle, idempotency, callback, status-verification, suspense, reconciliation, or manual-review states.
8. Operations owns audit, idempotency, outbox, metrics, diagnostics, request context, readiness, retention, and operational lifecycle. A7 reuses those primitives rather than create local substitutes.
9. Reconciliation remains independent and read-only. A7 product reconciliation, A6T09 external reconciliation, and A7 product data-minimization disclosure projection do not repair source records or authorize product financial effects.
10. Notification delivery, product data, preference data, customer funding data, risk / compliance evidence, and financial-control data are minimized, classified, access-controlled, redacted, and retained only under approved controls.
11. A7 is a bounded product-expansion boundary inside the existing modular monolith. It does not create a microservice or topology change based only on product scope.
12. Every product command and notification is scoped to an approved product and carries an internal correlation chain without treating the product identifier or notification reference as canonical internal identity.
13. A7 may use the A5 transactional outbox as a durable internal intent / fact boundary, but no notification dispatcher, callback, product command, or financial-execution process may treat an outbox row as a Ledger record, a customer intent, or a delivery confirmation.
14. Disabling a product or its notification surface stops new product admission and outbound delivery without deleting, rewriting, or masking completed internal financial history.
15. A notification delivery never becomes a financial command, an A2 authorization, an A3 binding repair, an A4 policy decision, or a Ledger record.

## 3. Evidence sources

The A7 operational recovery runbook evidence sources are:

- [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md) — A7 task-to-evidence matrix and end-to-end product authority trace.
- [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md) — A7 route exposure review and rollback procedures.
- [`A7-ADR-REVIEW-STATUS.md`](A7-ADR-REVIEW-STATUS.md) — A7 ADR review status against committed implementation evidence.
- [`A7-EXIT-CHECKLIST.md`](A7-EXIT-CHECKLIST.md) — A7 exit checklist and A7 phase result.
- [`A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md) — A7 owner approval register and no-go recommendation.
- [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md) — A7 to A8 bounded handoff, prohibited edges, A8 entry conditions, and blocked handoff status.
- The shared Operations `AuditService` (read-only evidence; the only audit authority; A1).
- The shared Operations `IdempotencyService` (read-only evidence; the only internal idempotency authority; A1).
- The shared Operations `OutboxService` (read-only evidence; the only outbox authority; A1).
- The shared Operations `MetricsService` (read-only evidence; the only metrics authority; A1).
- The shared Operations `DiagnosticsService` (read-only evidence; the only diagnostics authority; A1).
- The A2 `AuthorizationService` (read-only evidence; the only A2 authorization authority; A2).
- The A3 `CustomerFinancialAccountBindingService` (read-only evidence; the only A3 binding authority; A3; consumed through the A7 product customer-binding consumer boundary; A7T04).
- The A4 product-policy service (read-only evidence; the only A4 product-policy authority; A4; consumed through the A7 product-policy consumer boundary; A7T03).
- The A5 `LedgerService` (read-only evidence; the only financial value authority; A5).
- The A6T02 partner adapter (read-only evidence; the only A6 partner adapter authority; A6T02).
- The A6T05 `ExternalOperationService` (read-only evidence; the only A6T05 external-operation authority; A6T05).
- The A6T07 `ExternalOperationStatusVerifier` (read-only evidence; the only A6 status-verification authority; A6T07).
- The A6 `PartnerCircuitBreakerService` (read-only evidence; the only A6 circuit-breaker authority; A6T07).
- The A6T08 `ExternalSettlementService` (read-only evidence; the only A6T08 settlement / suspense / compensating authority; A6T08).
- The A6T09 `ExternalReconciliationService` (read-only evidence; the only A6T09 external reconciliation authority; A6T09).
- The A6T10 `ExternalDataMinimizationService` (read-only evidence; the only A6T10 data classification / consent / retention / legal-hold / secret / disclosure / support-trace / partner-payload validation authority; A6T10).
- The A7 product catalog (A7T02; the only A7 product catalog authority).
- The A7 product-policy service (A7T03; the only A7 product-policy authority).
- The A7 product customer-binding service (A7T04; the only A7T04 product customer-binding authority).
- The A7 product command service (A7T05; the only A7T05 product command / operation authority).
- The A7 product notification-delivery service (A7T06; the only A7T06 product notification-delivery authority).
- The A7 product lifecycle service (A7T07; the only A7T07 product lifecycle authority).
- The A7 product financial-effect service (A7T08; the only A7T08 product financial-effect authority).
- The A7 product reconciliation service (A7T09; the only A7T09 product reconciliation authority).
- The A7 product data-minimization service (A7T10; the only A7T10 product data-minimization authority).
- The `CustomerPreference` (including `NotificationPreference`; the only customer intent authority; A1).

The A7 operational recovery runbook is a read-only consumer of the above evidence sources. The A7 operational recovery runbook does **not** introduce a second audit, idempotency, outbox, metrics, diagnostics, customer-binding, policy, authorization, notification, settlement, reconciliation, or `CustomerPreference` authority.

## 4. Incident classification

The A7 incident classification is the A6 incident classification extended with A7 product-side categories. The A7 incident classification categories are:

- **INC-A7-001 — Product catalog / product-boundary incident** — the A7 product catalog or the A7 product-boundary contract is inconsistent with the A7 product-catalog contract or the A7 product-boundary contract.
- **INC-A7-002 — Product policy incident** — the A7 product-policy service is inconsistent with the A4 product-policy evaluator, the A4 product-policy profile, the A4 product-policy evidence, the A4 product-policy currentness, or the A4 product-policy re-evaluation.
- **INC-A7-003 — Product customer-binding incident** — the A7 product customer-binding map is inconsistent with the A3 binding recheck, the A6 partner reference, the A6T04 funding-target mapping, or the A2 authorization context.
- **INC-A7-004 — Product command / idempotency incident** — the A7 product command is inconsistent with the A6T05 provider idempotency scope / key, the A6T05 normalized request hash, the A6T05 reference uniqueness, or the A5 command correlation.
- **INC-A7-005 — Product notification-delivery incident** — the A7 product notification-delivery is inconsistent with the `CustomerPreference.notifications`, the A6T10 / A7T10 data controls, the A7 product data-minimization disclosure audience maximums, or the shared Operations audit / idempotency / outbox integration.
- **INC-A7-006 — Product lifecycle incident** — the A7 product lifecycle transition is inconsistent with the A6 lifecycle vocabulary, the A6 retry policy, the A6 status-verification, or the A6 unknown / manual-review recovery.
- **INC-A7-007 — Product financial-effect incident** — the A7 product financial-effect admission is inconsistent with the A6T08 settlement evidence, the A6T08 suspense evidence, the A6T08 compensating-entry evidence, or the A5 Ledger journal correlation.
- **INC-A7-008 — Product reconciliation incident** — the A7 product reconciliation report, support trace, certification evidence, or handoff is inconsistent with the A6T09 external reconciliation report, the A5 Ledger journal, the A6T08 settlement / suspense / compensating, the A6 callback receipt, the A6 partner reference, or the shared Operations audit / idempotency / outbox.
- **INC-A7-009 — Product data-minimization incident** — the A7 product data-minimization classification, consent, retention, legal-hold, secret, disclosure, support-trace projection, or partner-payload validation is inconsistent with the A6T10 data classification registry, the A6T10 consent record, the A6T10 retention classification, the A6T10 legal-hold, the A6T10 secret classification, the A6T10 disclosure projection, the A6T10 support-trace projection, or the A6T10 partner-payload validation.

The A7 incident classification categories are aligned with the A7 plan §8 A7T01-A7T10 task boundaries. The A7 incident classification categories do not introduce a new A7 incident authority.

## 5. Recovery procedure

The A7 recovery procedure is the A6 recovery procedure extended with A7 product-side steps.

### 5.1 Detect

The detect step is the A7 product reconciliation service (A7T09) running a REPEATABLE READ, read-only TypeORM transaction and emitting a discrepancy report. The A7 product reconciliation service never auto-repairs; the A7 product reconciliation service only reports.

The A7 product reconciliation service uses the A6T09 external reconciliation snapshot as a read-only consumer. The A7 product reconciliation service does **not** issue, refresh, or substitute the A6T09 external reconciliation report.

### 5.2 Identify

The identify step is the A7 incident classification (§4) applied to the A7 product reconciliation discrepancy report. The discrepancy is mapped to an A7 incident classification category, a severity, an owner, a recovery state, and a message. The A7 product reconciliation discrepancy classification vocabulary extends (but does **not** replace) the A6T09 external reconciliation discrepancy classification vocabulary.

### 5.3 Contain

The contain step is the A7 product disable (§3 of [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md)) for the affected product key (`VIRTUAL_ACCOUNT` v1), the A6 circuit-breaker disable for the affected partner / capability, the A7 notification suppression for the affected channel, and the A7 product data-minimization disclosure suppression for the affected audience. Containment does **not** mutate any source record.

### 5.4 Eradicate

The eradicate step is the A7 product rollback (§4 of [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md)) for the affected product, partner, and capability. Eradication does **not** mutate any source record.

### 5.5 Recover

The recover step is the A7 product enable for the affected product key, the A6 circuit-breaker close for the affected partner / capability, the A7 notification enable for the affected channel, and the A7 product data-minimization disclosure enable for the affected audience. Recovery is gated on the A7 release-gate review, the A7 owner approval, the A7 partner certification, the A7 Finance / Ledger approval, the A7 Privacy / Security approval, the A7 Legal / Risk / Compliance approval, the A7 Operations / Reconciliation / Support approval, and the A7 product activation approval.

### 5.6 Document

The document step is the A7 audit fact recorded through the shared Operations `AuditService` (the only audit authority; A1). The document step also includes the A7 incident classification, the A7 contain / eradicate / recover evidence, the A7 ownership evidence, the A7 stop-condition evidence, and the A7 certification evidence. The document step is the design-aligned evidence base for the A7 release-gate review.

## 6. Decision matrix

The A7 decision matrix maps the A7 incident classification categories (§4) to the A7 recovery procedure (§5) and the A7 ownership / stop conditions.

| A7 incident classification | A7 recovery procedure | A7 ownership | A7 stop condition |
| --- | --- | --- | --- |
| INC-A7-001 — Product catalog / product-boundary incident | A7 product catalog review; A7 product catalog is the only A7 product catalog authority (A7T02) | Product / Architecture | A7 product catalog review approves the catalog / boundary contract |
| INC-A7-002 — Product policy incident | A4 product-policy review; A4 is the only policy authority | A4 / Product | A4 product-policy review approves the A7 product-policy profile |
| INC-A7-003 — Product customer-binding incident | A3 binding recheck; A3 is the only binding authority | A3 / Product | A3 binding review approves the A7 product customer-binding map |
| INC-A7-004 — Product command / idempotency incident | A6T05 provider idempotency review; A6T05 is the only provider-idempotency authority | A6T05 / Product | A6T05 review approves the A7 product command / idempotency contract |
| INC-A7-005 — Product notification-delivery incident | A7 product notification-delivery review; A7T06 is the only product notification-delivery authority | A7T06 / Privacy | Privacy review approves the A7 product notification-delivery contract and channel suppression |
| INC-A7-006 — Product lifecycle incident | A7 product lifecycle review; A7T07 is the only product lifecycle authority | A7T07 / Operations | Operations review approves the A7 product lifecycle retry / status-verification / unknown / manual-review contract |
| INC-A7-007 — Product financial-effect incident | A7 product financial-effect review; A7T08 is the only product financial-effect authority | A7T08 / Finance / Ledger | Finance / Ledger review approves the A7 product financial-effect / settlement / suspense / compensating contract |
| INC-A7-008 — Product reconciliation incident | A7 product reconciliation review; A7T09 is the only product reconciliation authority | A7T09 / Reconciliation | Reconciliation review approves the A7 product reconciliation report, support trace, certification evidence, and handoff |
| INC-A7-009 — Product data-minimization incident | A7 product data-minimization review; A7T10 is the only product data-minimization authority | A7T10 / Privacy / Security | Privacy / Security review approves the A7 product data-minimization classification, consent, retention, legal-hold, secret, disclosure, support-trace projection, and partner-payload validation |

The A7 decision matrix is a read-only review surface. The A7 decision matrix does **not** introduce a new A7 incident authority or a new A7 recovery authority.

## 7. Support-trace contract

The A7 support-trace contract is the A7 product reconciliation support trace (A7T09) and the A7 product data-minimization support-trace projection (A7T10) acting together as the only A7 support-trace authority. The A7 support-trace contract is a read-only consumer of the A5 Ledger, the A6T05 external operation, the A6T08 settlement / suspense / compensating, the A6T09 external reconciliation, the A6T10 data-classification / disclosure / support-trace / partner-payload validation, the A7 product catalog, the A7 product-policy, the A7 product customer-binding, the A7 product command, the A7 product notification-delivery, the A7 product lifecycle, the A7 product financial-effect, and the shared Operations audit / idempotency / outbox / metrics / diagnostics.

The A7 support-trace contract classifies the A7 support trace fields for the A1 data classification, retention, legal-hold, and support-access controls. The A7 support-trace contract uses the A1 PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED vocabulary. The A7 support-trace contract does **not** include raw credentials, callback signatures, full funding credentials, unrestricted risk / compliance data, or unnecessary customer data.

The A7 support-trace contract is consumed by the A7 product reconciliation report, the A7 product reconciliation support trace, the A7 product reconciliation certification evidence, the A7 product reconciliation handoff envelope, the A7 product data-minimization disclosure projection, and the A7 product data-minimization support-trace projection.

## 8. Ownership and stop conditions

The A7 ownership and stop conditions are:

- The A7 product catalog is owned by Product and Architecture (A7T02).
- The A7 product-policy is owned by A4 and Product (A7T03).
- The A7 product customer-binding is owned by A3 and Product (A7T04).
- The A7 product command / idempotency is owned by A6T05 and Product (A7T05).
- The A7 product notification-delivery is owned by A7T06 and Privacy (A7T06).
- The A7 product lifecycle is owned by A7T07 and Operations (A7T07).
- The A7 product financial-effect is owned by A7T08, Finance, and Ledger (A7T08).
- The A7 product reconciliation is owned by A7T09 and Reconciliation (A7T09).
- The A7 product data-minimization is owned by A7T10, Privacy, and Security (A7T10).
- The A7 release-gate review is owned by Architecture (A7T11).
- The A7 owner approval is owned by Product, Architecture, Engineering, Finance, Ledger, Privacy, Security, Legal, Risk, Compliance, Operations, Reconciliation, Support, and the partner (A7T11).
- The A7 partner certification is owned by the partner and Engineering (A6T11 / A7T11 cross-reference).
- The A7 environment emergency-stop is owned by Engineering and Operations (A6T11 / A7T11 cross-reference).

The A7 stop conditions are:

- A7 release-gate review stops if any A7 product catalog / product-boundary / product-policy / product customer-binding / product command / product notification-delivery / product lifecycle / product financial-effect / product reconciliation / product data-minimization acceptance criterion is unverified.
- A7 release-gate review stops if the A7 integration matrix evidence is incomplete.
- A7 release-gate review stops if the A7 route exposure review identifies a new public API, mobile / web channel, marketing consent, or production rollout.
- A7 release-gate review stops if the A7 ADR review status identifies an un-authored ADR that is required for the first product.
- A7 release-gate review stops if the A7 operational recovery runbook is incomplete.
- A7 release-gate review stops if the A7 owner approval is incomplete.
- A7 release-gate review stops if the A7 partner certification is incomplete.
- A7 release-gate review stops if the A7 Finance / Ledger approval is incomplete.
- A7 release-gate review stops if the A7 Privacy / Security approval is incomplete.
- A7 release-gate review stops if the A7 Legal / Risk / Compliance approval is incomplete.
- A7 release-gate review stops if the A7 Operations / Reconciliation / Support approval is incomplete.
- A7 release-gate review stops if the A7 product activation approval is incomplete.
- A7 release-gate review stops if any unresolved A7 implementation risk is unowned.
- A7 release-gate review stops if any A7 prohibited edge is detected.
- A7 release-gate review stops if A7 begins A8 or any product-roadmap expansion beyond the first selected product.

## 9. Cross-reference

- [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md) — A7 task-to-evidence matrix and end-to-end product authority trace.
- [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md) — A7 route exposure review and rollback procedures.
- [`A7-ADR-REVIEW-STATUS.md`](A7-ADR-REVIEW-STATUS.md) — A7 ADR review status against committed implementation evidence.
- [`A7-EXIT-CHECKLIST.md`](A7-EXIT-CHECKLIST.md) — A7 exit checklist and A7 phase result.
- [`A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md) — A7 owner approval register and no-go recommendation.
- [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md) — A7 to A8 bounded handoff, prohibited edges, A8 entry conditions, and blocked handoff status.
