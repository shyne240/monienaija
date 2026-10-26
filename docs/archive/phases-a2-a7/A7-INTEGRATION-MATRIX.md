# A7 Integration and Evidence Matrix

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T11 — A7 Integration, Product Certification, Release Gate, and A8 Handoff
- **Status:** Evidence package prepared; approval, product certification, and activation pending
- **Classification:** Documentation-only integration and phase-exit evidence
- **Application, database, API, migration, controller, route, scheduler, notification, product, and financial-runtime changes in this task:** None
- **Review snapshot:** `2746521` (post-A7T10 committed implementation evidence)

## 1. Purpose and evidence boundary

This matrix integrates the committed A7T01-A7T10 implementation artifacts for the bounded first product selected by A7T01:

```text
product:              VIRTUAL_ACCOUNT (v1)
direction:            inbound funding to provider-backed virtual account
capability:           product.virtual-account (lifecycle action)
partner dependency:   NIBSS_NIP (selected A6 partner; planning rail)
currency:             NGN
accounting unit:      CUSTOMER_FUNDS
internal lifecycle input: existing Customer, CustomerWallet, Ledger, A3 binding, A4 policy
external target input:    A6 partner-issued virtual-account identifier, A6 callback/report, A6 settlement
```

It distinguishes:

- committed source, runtime, migration, test, and documentation evidence;
- design alignment and local automated validation;
- live database migration, deployment, route exposure, product certification, and operational evidence; and
- governance, accountable-owner approval, Finance/Ledger approval, partner certification, and product activation.

No checkbox in this document claims live execution, production deployment, partner certification, owner approval, or product activation unless explicitly identified as such.

## 2. Task-to-evidence matrix

| Task | Committed implementation/documentation evidence | Boundary integrated | Automated evidence | Current status |
| --- | --- | --- | --- | --- |
| **A7T01 — Product expansion baseline and first-product selection** | [`A7-PRODUCT-EXPANSION-BASELINE.md`](A7-PRODUCT-EXPANSION-BASELINE.md), [`A7-IMPLEMENTATION-PLAN.md`](A7-IMPLEMENTATION-PLAN.md) §3.1, §3.2, product candidate matrix, gap register, prohibited adjacent products, certification inputs | One bounded `VIRTUAL_ACCOUNT` v1 product selected; existing `virtual-account` module classified as compatibility input, not as evidence of an A7 product boundary | Document review | Baseline committed; activation not claimed |
| **A7T02 — Product catalog and product-boundary contract** | [ADR-0054](ADR/ADR-0054-Virtual-Account-Product-Boundary.md), [`A7-PRODUCT-CATALOG-CONTRACT.md`](A7-PRODUCT-CATALOG-CONTRACT.md), product capability/version/accounting unit/currency contract | Single frozen product registration; shared product-boundary contract; canonical internal correlation chain | Product catalog tests | Contract aligned; no live product activation |
| **A7T03 — Product-specific A4 policy profile and limit extension** | [`A7-PRODUCT-POLICY-PROFILE-CONTRACT.md`](A7-PRODUCT-POLICY-PROFILE-CONTRACT.md), `a7-product-policy.service.ts`, `a7-product-policy.persistence.repository.ts`, `a7-product-policy.replay.service.ts`, `a7-product-policy.audit.adapter.ts` | A4 capability/profile/version/decision/limits/obligations/expiry/currentness extended without duplicating A4 evaluator | A4 profile, persistence, replay, and audit tests | Implementation-aligned; A4 approval pending |
| **A7T04 — Product customer-binding, ownership, and internal account mapping** | [`A7-PRODUCT-CUSTOMER-BINDING-CONTRACT.md`](A7-PRODUCT-CUSTOMER-BINDING-CONTRACT.md), `a7-product-customer-binding.service.ts`, `a7-product-customer-binding.repository.ts` | Verified, owned, current, purpose-compatible, consented A3 internal account chain; no A6 repair/reassignment; tokenized handoff to A6 | Customer-binding tests | Implementation-aligned; partner certification pending |
| **A7T05 — Product command identity, lifecycle, and idempotency** | [`A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md`](A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md), `a7-product-command.service.ts`, `a7-product-command.repository.ts` | Distinct product command/operation identity; normalized semantic request hash; internal/provider idempotency separation; same-key/same-payload replay and same-key/changed-payload conflict behavior | Command and idempotency tests | Implementation-aligned; live partner submission unavailable |
| **A7T06 — Notification delivery infrastructure and preferences enforcement** | [`A7-NOTIFICATION-DELIVERY-CONTRACT.md`](A7-NOTIFICATION-DELIVERY-CONTRACT.md), `a7-product-notification-delivery.service.ts`, `a7-product-notification-delivery.repository.ts` | `CustomerPreference.notifications` (intent) consumed; A6T10 / A7T10 data controls applied; deduplication, suppression, manual-review, and unknown-outcome delivery states; no live email, SMS, push, or web channel wired | Notification-delivery tests | Implementation-aligned; A2 audience approval pending |
| **A7T07 — Product lifecycle, retry, manual review, and unknown outcomes** | `a7-product-lifecycle.service.ts`, `a7-product-lifecycle.repository.ts` | A6 lifecycle vocabulary reused/extended; bounded retry policy; manual-review and hold states; safe unknown / pending / manual-review / failed product outcomes; no unbounded retry loop | Lifecycle, retry, manual-review, and unknown-outcome tests | Implementation-aligned; live partner traffic pending |
| **A7T08 — Product financial effect, settlement, and Ledger integration** | [`A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md`](A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md), `a7-product-financial-effect.service.ts`, `a7-product-financial-effect.repository.ts` | Ledger-owned financial effect only after verified evidence; A6T08 settlement / suspense / compensating reuse; double-entry, currency, accounting-unit, account-state, balance, lock, journal-correlation; compensating entries only | Financial-effect, suspense, and rollback tests | Implementation-aligned; Finance/Ledger approval pending |
| **A7T09 — Independent product reconciliation and support trace** | [`A7-PRODUCT-RECONCILIATION-CONTRACT.md`](A7-PRODUCT-RECONCILIATION-CONTRACT.md), `a7-product-reconciliation.service.ts`, `a7-product-reconciliation.repository.ts` | REPEATABLE READ read-only product reconciliation; classified support trace; certification evidence; handoff envelope; no source-record mutation; no auto-repair | Reconciliation and support-trace tests | Implementation-aligned; live reconciliation drill pending |
| **A7T10 — Product data minimization, consent, classification, retention, secret, and disclosure controls** | [`A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md`](A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md), `a7-product-data-minimization.service.ts`, `a7-product-data-minimization.repository.ts` | A6T10 data classification / consent / retention / legal-hold / secret / disclosure / support-trace / partner-payload validation reused; A6T10 first-party product purpose `PRODUCT_VIRTUAL_ACCOUNT_INBOUND_FUNDING` registered; 35 A7 product field classifications; read-only | Data-minimization, classification, consent, retention, legal-hold, secret, disclosure, and partner-payload tests | Implementation-aligned; Privacy/Security approval pending |
| **A7T11 — A7 integration, product certification, release gate, and A8 handoff** | This documentation package | End-to-end evidence, certification, rollback, recovery, approval, exit, and A8 handoff | Document review | Prepared; approval pending |

## 3. End-to-end product authority trace

The end-to-end product authority trace for the first selected product (`VIRTUAL_ACCOUNT` v1, capability `product.virtual-account`, action `lifecycle`, direction `inbound funding`, partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`) is the chain:

```text
A2 authenticated principal / protected internal command context
                         |
                         v
A4 current product capability decision (A7T03)
  capability/action + policy version + product limits + obligations + expiry
                         |
                         v
A3 internal account/customer-binding recheck (A7T04)
  Customer.id -> CustomerWallet -> A3 binding -> WalletAccount -> LedgerAccount
  -> A7 product customer-binding map (virtual-account identifier, partner identity, provider-side reference)
                         |
                         v
A7 product command (A7T05)
  internal product command/operation ID
  A4 product policy reference + A3 binding reference + A6 partner dependency
  amountMinor + currency + accountingUnit
  product idempotency + provider idempotency + correlation/causation
                         |
                         v
A7 product catalog and product-boundary contract (A7T02)
  approved product/contract/version
  normalized product request/result envelope
                         |
                         v
A6 partner adapter and isolated transport (A6T02; reused from A6)
  approved A6 partner/capability/version
  authenticated request + provider reference/acknowledgement
                         |
                         v
A7 product lifecycle (A7T07) reusing A6 lifecycle vocabulary
  submitted / pending / retry / unknown / manual review / settled / failed
                         |
                         v
A6 callback authenticity, replay, and freshness (A6T06; reused from A6)
  callback event identity + provider reference + replay state
                         |
                         v
A7 product financial effect, settlement, and Ledger integration (A7T08)
  verified product decision
  Ledger-owned journal/lines
  suspense or controlled exception where finality/matching is unresolved
                         |
                         v
A7 notification dispatcher (A7T06) under CustomerPreference.notifications
  delivery intent (outbox) -> delivery fact (audit) -> deduplication (idempotency)
  sensitive-payload redaction (A6T10 / A7T10)
                         |
                         v
Operations and independent control evidence
  audit + idempotency + transactional outbox
  A6 partner/internal references + A7 product operation + A7 notification + support trace
  A7 independent product reconciliation (A7T09) + discrepancy owner
  A7 product data minimization, classification, consent, retention, legal-hold, secret, disclosure (A7T10)
                         |
                         v
A7 release control
  product disable + A6 circuit-breaker + rollback
  internal financial history preserved
```

The chain above is the only A7 product authority chain. A product event, preference value, product command ID, partner reference, or notification delivery record cannot become financial truth, A2 authorization, A3 binding, A4 policy, or customer intent without the owning boundary's verification.

## 4. Product authority correlation identifiers

The A7 product authority correlation identifiers remain distinct and queryable, per the A7 plan §3.3 product financial-effect boundary and the A7T05 / A7T08 / A7T09 contracts:

| Identifier | Source | Persisted in | Mutable by A7? |
| --- | --- | --- | --- |
| `Customer.id` | A1 customer identity | Customer | No |
| Internal command ID | A5 transfer/deposit/withdrawal | transfer / deposit / withdrawal | No |
| A6T05 external-operation ID | A6 partner boundary | external_operation | No |
| A7T05 product command ID | A7 product command | idempotency_records (response body) | No |
| A7T05 product operation ID | A7 product command | idempotency_records (response body) | No |
| A7T04 product customer-binding map reference | A7 product customer-binding | idempotency_records (response body) | No |
| A7T07 product lifecycle reference | A7 product lifecycle | idempotency_records (response body) | No |
| A7T08 product financial-effect reference | A7 product financial effect | idempotency_records (response body) | No |
| A7T09 product reconciliation reference | A7 product reconciliation | computed | No |
| A7T10 product data-minimization reference | A7 product data minimization | computed | No |
| Provider idempotency key | A6T05 / ADR-0049 | external_operation | No |
| Provider transaction/reference ID | A6 partner | external_operation_references | No |
| Callback event ID | A6T06 partner callback | external_callback_receipts | No |
| Settlement ID | A6T08 | external_settlement | No |
| Suspense entry ID | A6T08 | external_suspense_entry | No |
| Journal ID | A5 Ledger | ledger_journal | No |
| Outbox event ID | Operations | outbox_events | No |
| Audit event ID | Operations | audit_events | No |
| Notification dispatch ID | A7T06 | idempotency_records (response body) | No |

The A7 product reconciliation is the only A7-side authority for cross-identifier correlation evidence; the A7 product data minimization is the only A7-side authority for cross-identifier classification, consent, retention, legal-hold, secret, disclosure, and partner-payload validation evidence.

## 5. Product certification evidence scope

The A7 product certification evidence (per the A7 plan §8 A7T11 deliverables) is the fixture-based, sandbox-only evidence set covering:

- product command (A7T05): happy path, rejection, duplicate, changed payload, replay;
- product validation (A7T05): command validation, idempotency, normalized request hash, scope mismatch;
- callback authenticity (A6T06 / A7T09): partner signature verification, replay protection, freshness;
- duplicate (A7T05 / A6T05): same-key/same-payload replay and same-key/changed-payload conflict;
- outage (A6 circuit-breaker / A7T09): partner circuit-open evidence;
- timeout (A7T07): product retry / status-verification / unknown-outcome;
- status verification (A6T07 / A7T07): provider status query, reconciliation evidence;
- settlement (A7T08 / A6T08): settlement evidence matches Ledger journal and A6 partner;
- suspense (A7T08 / A6T08): suspense aging, exception ownership, compensating entry;
- reconciliation (A7T09): discrepancy classification, support trace, certification fingerprint;
- data minimization (A7T10 / A6T10): field classification, consent, retention, legal-hold, secret, disclosure, partner-payload;
- notification delivery (A7T06 / A6T10): fixture-based delivery intent, audience, suppression, redaction, deduplication;
- rollback (A7T11 / A6T11): disable / circuit-breaker / product-rollback / Ledger-history-preservation.

The evidence set is fixture-based only. No live partner traffic, no live customer activation, no production rollout, and no public API exposure is included.

## 6. Local automated validation

- `npm test` — passes (the test suite includes the A7T01-A7T10 unit, contract, type, service, repository, and module tests plus the A1-A6 phase tests).
- `npm run lint` — passes.
- `npm run build` (`nest build`) — passes.
- `npm run format:check` — passes.

## 7. Live-environment evidence (NOT claimed by this matrix)

The A7T11 evidence package does **not** claim any of the following:

- live database migration execution;
- live deployment to any environment;
- live partner transport call;
- live partner certification;
- live Finance / Ledger approval;
- live Privacy / Security approval;
- live Legal / Risk / Compliance approval;
- live Support / Operations / Reconciliation approval;
- live product activation;
- live customer cohort;
- live public API;
- live mobile / web channel;
- live email / SMS / push channel;
- production rollout;
- A8 scale / extraction;
- product expansion beyond the first selected product.

## 8. Outstanding implementation risk register

| Risk | Owner | Severity | Mitigation | Stop condition | Certification requirement | Rollback / disable behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Live partner transport (A6T02) is unavailable in the current environment | Partner | WARNING | Fixtures, sandbox contracts, and partner sandbox request/response are used; no production traffic | Live partner call not authorized until partner certification | Live partner certification evidence required | A6 circuit-breaker disable + product disable (A7T11) |
| ADR-0048 (Bank/NIBSS isolation) is not yet authored in the proposed A7 range; partner transport/credential/signing evidence lives in `partner-connection.service.ts` and `partner-credentials.service.ts` | Architecture | WARNING | Documentation tracks the gap; no live partner call is performed | ADR-0048 authoring required before live partner call | ADR-0048 authoring evidence required | Disable partner connection (`A6_DATA_MINIMIZATION_ENABLED=false`, partner disabled-by-default) |
| Finance / Ledger approval of the first product's settlement and journal dimensions is pending | Finance | WARNING | A6T08 settlement / suspense / compensating reused; Ledger is the only financial value authority | Finance approval required before product activation | Finance / Ledger approval evidence required | A6T08 disable + product disable; Ledger history preserved |
| Privacy / Security approval of A7T10 data minimization, consent, retention, legal-hold, secret, and disclosure is pending | Privacy / Security | WARNING | A6T10 reused; field-level classification, audience maximums, partner-payload validation, support-trace redaction in place | Privacy / Security approval required before any product field is shared | Privacy / Security approval evidence required | Field classification reversion + A6T10 disclosure rejection + product data-minimization disable |
| A2 audience / authorization approval of the A7 internal command surface, the A6 partner callback surface, and the A7 product data-minimization control surface is pending | Security | WARNING | A2 protected-internal surface contract in place; no public API exposed | A2 approval required before any internal command or callback is opened beyond A2-protected | A2 approval evidence required | A2 protected surface revoke; partner callback disable; product data-minimization disable |
| CustomerPreference intent approval of the A7T06 notification delivery dispatcher is pending | Product / Privacy | WARNING | `CustomerPreference.notifications` is the only intent authority; no live email / SMS / push / web channel is wired | Privacy / Product approval required before any channel is dispatched | Privacy / Product approval evidence required | A7T06 channel suppression override; `CustomerPreference` revocation honored; audit fact only |
| Support ownership of the A7 product reconciliation and A7 product data minimization support trace is pending | Support | WARNING | A7T09 support trace classification and A7T10 disclosure audience maximums in place; no raw credential, callback signature, or unrestricted risk / compliance data in trace | Support ownership required before any support access to product data is opened | Support ownership evidence required | A7T10 audience maximum reversion; A7T09 support trace redaction; A6T10 disclosure rejection |
| Live reconciliation drill is pending | Reconciliation | WARNING | A7T09 read-only REPEATABLE READ transaction; A6T09 external reconciliation reused; classification vocabulary frozen | Reconciliation drill required before product activation | Live reconciliation drill evidence required | A7T09 disable (read-only; never auto-repairs); A6T09 disable |
| Mobile / web channel implementation is out of scope of A7 | Product | INFO | Plan §5 explicitly excludes mobile / web channel; A7T06 dispatcher boundary only | Mobile / web channel not authorized by A7 | N/A (not implemented) | A7T06 channel suppression; no channel registered |
| A8 scale / extraction is out of scope of A7 | Architecture | INFO | A7 hand-off package documents A8 entry conditions; A8 not started | A8 entry blocked until A7 release gate | N/A (not implemented) | A8 hand-off not opened; A7 release-gate first |

## 9. Cross-reference

- [`A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A7-ROUTE-EXPOSURE-AND-ROLLBACK.md) — A7 route exposure review and rollback procedures.
- [`A7-ADR-REVIEW-STATUS.md`](A7-ADR-REVIEW-STATUS.md) — A7 ADR review status against committed implementation evidence.
- [`A7-OPERATIONAL-RECOVERY-RUNBOOK.md`](A7-OPERATIONAL-RECOVERY-RUNBOOK.md) — A7 operational recovery runbook.
- [`A7-EXIT-CHECKLIST.md`](A7-EXIT-CHECKLIST.md) — A7 exit checklist and A7 phase result.
- [`A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md) — A7 owner approval register, no-go recommendation, go conditions, and non-claims.
- [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md) — A7 to A8 bounded handoff, prohibited edges, A8 entry conditions, and blocked handoff status.
