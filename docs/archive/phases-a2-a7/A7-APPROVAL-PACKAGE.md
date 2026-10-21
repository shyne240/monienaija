# A7 Product Expansion Infrastructure Approval Package

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T11 — A7 Integration, Product Certification, Release Gate, and A8 Handoff
- **Status:** Prepared for accountable-owner review; **not approved**
- **Classification:** Documentation-only approval and release evidence
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Executive summary

A7 implements the shared product-expansion infrastructure and one first bounded product (`VIRTUAL_ACCOUNT` v1) inside the existing modular monolith. The selected first product is provider-backed virtual account assignment, inbound funding, and lifecycle under the existing A6 partner boundary (`NIBSS_NIP` planning rail, `NGN`, `CUSTOMER_FUNDS` accounting unit). The first product is limited to a bounded flow: assign / activate a virtual account identifier, receive inbound funds, post the verified financial effect through the A6 partner boundary, and represent the product operation through product lifecycle states.

The committed artifacts establish:

- A7 product expansion baseline and first-product selection (A7T01; baseline committed; activation not claimed);
- A7 product catalog and product-boundary contract (A7T02; one frozen product registration; shared product-boundary contract);
- A7 product-specific A4 policy profile and limit extension (A7T03; A4 capability / profile / decision / limits / obligations / expiry / currentness extended without duplicating A4 evaluator);
- A7 product customer-binding, ownership, and internal account mapping (A7T04; verified, owned, current, purpose-compatible, consented A3 internal account chain; no A6 repair / reassignment);
- A7 product command identity, lifecycle, and idempotency (A7T05; distinct product command / operation identity; normalized semantic request hash; internal / provider idempotency separation);
- A7 notification delivery infrastructure and preferences enforcement (A7T06; `CustomerPreference.notifications` consumed; A6T10 / A7T10 data controls applied; no live email, SMS, push, or web channel wired);
- A7 product lifecycle, retry, manual review, and unknown outcomes (A7T07; A6 lifecycle vocabulary reused / extended; bounded retry policy; safe unknown / pending / manual-review / failed outcomes);
- A7 product financial effect, settlement, and Ledger integration (A7T08; Ledger-owned financial effect only after verified evidence; A6T08 settlement / suspense / compensating reuse);
- A7 independent product reconciliation, certification, and support trace (A7T09; REPEATABLE READ read-only product reconciliation; classified support trace; no source-record mutation);
- A7 product data minimization, consent, classification, retention, secret, and disclosure controls (A7T10; A6T10 data classification / consent / retention / legal-hold / secret / disclosure / support-trace / partner-payload validation reused).

The A7T11 evidence package is the A7 release-gate review evidence. The A7T11 evidence package does **not** claim A7 release-gate approval, A7 owner approval, A7 partner certification, A7 Finance / Ledger approval, A7 Privacy / Security approval, A7 Legal / Risk / Compliance approval, A7 Operations / Reconciliation / Support approval, A7 product activation, or A8 handoff.

## 2. No-go recommendation

The A7T11 evidence package records the following **no-go recommendation** until the A7 release-gate review actions are completed.

The A7T11 evidence package does **not** recommend the following:

- A7 release-gate review approval;
- A7 product activation;
- A7 partner certification;
- A7 Finance / Ledger approval of the A7T08 product financial effect;
- A7 Privacy / Security approval of the A7T10 product data minimization;
- A7 A2 audience / authorization approval of the A7 internal command, the A6 partner callback, and the A7 product data-minimization control surface;
- A7 `CustomerPreference` intent approval of the A7T06 notification delivery dispatcher;
- A7 Support ownership of the A7T09 product reconciliation and A7T10 product data-minimization support trace;
- A7 live reconciliation drill;
- A7 broad customer activation;
- A7 mobile / web channel implementation;
- A7 public API implementation;
- A7 marketing consent;
- A7 A8 scale / extraction;
- A7 product expansion beyond the first selected product.

The A7T11 evidence package recommends that the A7 release-gate review actions be completed by the responsible owners (Architecture, Product, Engineering, Finance, Ledger, Privacy, Security, Legal, Risk, Compliance, Operations, Reconciliation, Support, and the partner) before any A7 release-gate approval, A7 product activation, A7 partner certification, A7 broad customer activation, A7 mobile / web channel implementation, A7 public API implementation, A7 marketing consent, A7 A8 scale / extraction, or A7 product expansion is approved.

## 3. Go conditions

The A7T11 evidence package records the following go conditions for the A7 release-gate review.

### 3.1 Architecture go conditions

- A7 product expansion baseline and first-product selection are committed (A7T01).
- A7 product catalog and product-boundary contract are committed (A7T02).
- A7 product-specific A4 policy profile and limit extension are committed (A7T03).
- A7 product customer-binding, ownership, and internal account mapping are committed (A7T04).
- A7 product command identity, lifecycle, and idempotency are committed (A7T05).
- A7 notification delivery infrastructure and preferences enforcement are committed (A7T06).
- A7 product lifecycle, retry, manual review, and unknown outcomes are committed (A7T07).
- A7 product financial effect, settlement, and Ledger integration are committed (A7T08).
- A7 independent product reconciliation, certification, and support trace are committed (A7T09).
- A7 product data minimization, consent, classification, retention, secret, and disclosure controls are committed (A7T10).
- A7T11 documentation package (this evidence package) is prepared.
- A1, A2, A3, A4, A5, A6, A7, Wallet, Ledger, Operations, Outbox, Reconciliation, and `CustomerPreference` authorities remain separate.
- No A8 scale / extraction, public API, mobile / web channel, marketing consent, unapproved second product, unapproved second partner, or broad customer activation is included.

### 3.2 Product go conditions

- A7 first product (`VIRTUAL_ACCOUNT` v1) is selected.
- A7 product key, capability, currency, accounting unit, data, consent, internal command, partner dependency, prohibited adjacent products, and notification / support / reporting surface are explicit.
- A7 product activation is **not** claimed by the A7T11 evidence package.

### 3.3 Engineering go conditions

- A7 local automated validation passes (`npm test`, `npm run lint`, `npm run build`, `npm run format:check`).
- A7 product-side fixtures and tests cover product command, product validation, product idempotency, callback authenticity, replay, duplicate, outage, timeout, status verification, settlement, suspense, reconciliation, data minimization, notification delivery (fixture-based only), and rollback behavior.
- A7 disable / rollback procedures are design-aligned (see [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md)).
- A7 internal financial history preservation is design-aligned.

### 3.4 Finance / Ledger go conditions

- A7T08 product financial effect, settlement, and Ledger integration is implementation-aligned.
- A6T08 settlement, suspense, and exception ownership is reused.
- A5 Ledger is the only financial value authority.
- A7 does not post a journal, mutate a balance, clear suspense, or edit a posted journal / line outside Ledger and Finance-approved correction boundaries.
- A7 does not mutate a Ledger-owned A5, A6, or A7 record to reconcile a product, partner, or notification discrepancy.
- A7 Finance / Ledger approval of the A7T08 product financial effect is **not** claimed by the A7T11 evidence package; Finance / Ledger approval is the release-gate gating review.

### 3.5 Privacy / Security go conditions

- A7T10 product data minimization, consent, classification, retention, legal-hold, secret, and disclosure controls is implementation-aligned.
- A6T10 data classification, consent, retention, legal-hold, secret, disclosure, support-trace, and partner-payload validation is reused.
- A1 data classification, retention, legal-hold, and support-access controls are reused.
- A7 does not store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary identity documents in broad records, logs, traces, events, or notification payloads.
- A7 Privacy / Security approval of the A7T10 product data minimization is **not** claimed by the A7T11 evidence package; Privacy / Security approval is the release-gate gating review.

### 3.6 Legal / Risk / Compliance go conditions

- A7T10 product data minimization, consent, classification, retention, legal-hold, secret, and disclosure controls is implementation-aligned.
- A1 data classification, retention, legal-hold, and support-access controls are reused.
- A7 does not store raw risk / compliance notes, raw compliance case content, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.
- A7 Legal / Risk / Compliance approval is **not** claimed by the A7T11 evidence package; Legal / Risk / Compliance approval is the release-gate gating review.

### 3.7 Operations / Reconciliation / Support go conditions

- A7T09 product reconciliation is implementation-aligned (REPEATABLE READ read-only TypeORM transaction; no source-record mutation; no auto-repair).
- A7T10 product data-minimization is implementation-aligned.
- A6T09 external reconciliation is reused.
- A7 disable / rollback procedures are design-aligned.
- A7 support-trace classification is design-aligned (PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED; A1 data classification reused).
- A7 does not expose raw credentials, callback signatures, full funding credentials, unrestricted risk / compliance data, or unnecessary customer data in support traces.
- A7 Operations / Reconciliation / Support approval is **not** claimed by the A7T11 evidence package; Operations / Reconciliation / Support approval is the release-gate gating review.

### 3.8 Partner go conditions

- A6 partner sandbox / certification contract is inherited from A6.
- A6 partner enablement state is inherited from A6.
- A7 does not introduce a second partner beyond the already-approved A6 partner for the selected first product.
- A7 partner certification is **not** claimed by the A7T11 evidence package; partner certification is the release-gate gating review.

## 4. Owner approval register

The A7 owner approval register records the A7T11 evidence package's go conditions and the responsible owners.

| Owner | Approval scope | Required evidence | Status |
| --- | --- | --- | --- |
| Architecture | A7 release-gate review | A7T11 evidence package; A7 acceptance criteria; A7 prohibited edges; A7 internal financial history preservation | Pending |
| Product | A7 first-product selection; A7 product key, capability, currency, accounting unit, data, consent, internal command, partner dependency, prohibited adjacent products, and notification / support / reporting surface | A7T01; A7T02; A7T04; A7T06 | Pending |
| Engineering | A7 implementation artifacts; A7 disable / rollback procedures; A7 internal financial history preservation; A7 local automated validation | A7T02-A7T10 implementation; A7T11 rollback procedures; `npm test` / `npm run lint` / `npm run build` / `npm run format:check` | Pending |
| Finance / Ledger | A7T08 product financial effect; A6T08 settlement, suspense, and exception ownership; A5 Ledger authority | A7T08 contract; A6T08 contract; A5 Ledger contract | Pending |
| Privacy | A7T10 product data minimization, consent, classification, retention, secret, disclosure; A6T10 data classification; A1 data classification; A7 support-trace classification | A7T10 contract; A6T10 contract; A1 contract; A7T11 support-trace contract | Pending |
| Security | A7T10 product secret handling; A7 partner credential, certificate, signature, token, and secret handling / rotation; A2 audience / authorization for the A7 internal product command surface, the A6 partner callback surface, and the A7 product data-minimization control surface; ADR-0048 authoring | A7T10 contract; A6T10 contract; A2 contract; ADR-0048 | Pending |
| Legal / Risk / Compliance | A7 product data minimization, consent, classification, retention, legal-hold, secret, and disclosure controls | A7T10 contract; A6T10 contract; A1 contract | Pending |
| Operations | A7T07 product lifecycle, retry, manual review, and unknown outcomes; A7 disable / rollback procedures; A7 internal financial history preservation; shared Operations audit / idempotency / outbox / metrics / diagnostics | A7T07 contract; A7T11 rollback procedures; A1 contract | Pending |
| Reconciliation | A7T09 product reconciliation; A6T09 external reconciliation | A7T09 contract; A6T09 contract | Pending |
| Support | A7T09 product reconciliation support trace; A7T10 product data-minimization support-trace projection; A7T11 support-trace classification | A7T09 contract; A7T10 contract; A7T11 runbook §7 | Pending |
| Partner | A6 partner sandbox / certification contract; A6 partner enablement state | A6 contract; A6 partner sandbox / certification evidence | Pending |

The A7T11 evidence package does **not** claim any of the above approvals. The A7T11 evidence package records the owner approval register as the release-gate review surface.

## 5. Implementation-vs-production distinction

The A7T11 evidence package records an explicit implementation-vs-production distinction.

### 5.1 Implementation (committed and verified)

The following A7 implementation artifacts are committed and verified at the A7T10 commit (`2746521`):

- A7T01-A7T10 source files (constants, types, modules, services, repositories);
- A7T01-A7T10 test files (constants, types, modules, services, repositories where applicable);
- A7T01-A7T10 contract documents;
- A7T11 documentation package (this evidence package);
- `npm test` passes;
- `npm run lint` passes;
- `npm run build` passes;
- `npm run format:check` passes.

### 5.2 Production (not claimed)

The A7T11 evidence package does **not** claim the following production activities:

- A7 product activation;
- A7 broad customer activation;
- A7 mobile / web channel implementation;
- A7 public API implementation;
- A7 marketing consent;
- A7 A8 scale / extraction;
- A7 product expansion beyond the first selected product;
- Live partner transport call;
- Live partner certification;
- Live Finance / Ledger approval of A7T08 product financial effect;
- Live Privacy / Security approval of A7T10 product data minimization;
- Live A2 audience / authorization approval of the A7 internal command surface, the A6 partner callback surface, and the A7 product data-minimization control surface;
- Live `CustomerPreference` intent approval of the A7T06 notification delivery dispatcher;
- Live Support ownership of the A7T09 product reconciliation and A7T10 product data-minimization support trace;
- Live reconciliation drill;
- Live product cohort;
- Live production rollout.

The A7T11 evidence package records the implementation-vs-production distinction as the release-gate review surface. The A7T11 evidence package does **not** claim any production activity.

## 6. Cross-reference

- [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md) — A7 task-to-evidence matrix and end-to-end product authority trace.
- [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md) — A7 route exposure review and rollback procedures.
- [`A7-ADR-REVIEW-STATUS.md`](A7-ADR-REVIEW-STATUS.md) — A7 ADR review status against committed implementation evidence.
- [`A7-OPERATIONAL-RECOVERY-RUNBOOK.md`](A7-OPERATIONAL-RECOVERY-RUNBOOK.md) — A7 operational recovery runbook, incident classification, and decision matrix.
- [`A7-EXIT-CHECKLIST.md`](A7-EXIT-CHECKLIST.md) — A7 exit checklist and A7 phase result.
- [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md) — A7 to A8 bounded handoff, prohibited edges, A8 entry conditions, and blocked handoff status.
