# A6 to A7 Handoff Package

- **From:** A6 — External Partners & Settlement
- **To:** A7 — Product Expansion Infrastructure (future phase)
- **Task:** A6T11 — A6 Integration, Partner Certification, Release Gate, and A7 Handoff
- **Status:** Handoff prepared; **blocked until A6, A1, A2, A3, A4, A5, Finance, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, and partner approvals**
- **Classification:** Documentation-only downstream handoff and prohibited-edge evidence
- **Application, database, API, migration, controller, route, scheduler, provider, settlement, and financial-runtime changes in this task:** None

## 1. Handoff purpose

A6 proves one bounded external-rail capability (`external.wallet.withdrawal.settlement` for `NIBSS_NIP`, planning rail; NGN; `CUSTOMER_FUNDS`). It may provide A7 with implementation contracts and evidence patterns, but it does **not** prove external partner reliability, settlement finality, callback authenticity at production scale, suspense behavior under load, or partner reconciliation. A7 must begin from a separately reviewed product-expansion plan. A6 does not authorize A7 code, credentials, customer activation, public APIs, notifications, or product expansion.

## 2. Permitted A7 handoff

A6 may hand off the following bounded artifacts after accountable approval:

### 2.1 Identity, correlation, and provider boundary

- Distinct `Customer.id`, internal command, A6T05 external-operation, A6T05 provider reference, callback event, settlement, journal, suspense, audit, outbox, and reconciliation identifiers.
- A6T05 normalized semantic request hash and the internal/provider idempotency separation.
- A6T05 durable external-operation identity contract; replay vs changed-payload behavior; provider-reference uniqueness.
- A2 / A3 / A4 separation; A3 read-only binding recheck; A4 currentness / evidence / limits / obligations consumption.
- A6T04 verified customer funding-instrument / beneficiary consumption contract (no raw credential, no metadata mutation, explicit A3 internal account chain).

### 2.2 Partner connectivity, lifecycle, and resilience

- A6 partner capability / version / circuit-breaker / disabled-by-default connection boundary; A2-protected callback ingress.
- A6T07 lifecycle state vocabulary and transition guards; bounded retry, circuit-breaker, status-verification, unknown / manual-review / reconciliation recovery paths.
- A6T06 callback authenticity, replay protection, freshness, partner scope, dedupe, and idempotent processing contract.

### 2.3 Settlement, suspense, and reconciliation

- A6T08 Ledger-owned settlement boundary; suspense and compensating-entry contract; immutable Ledger history; provider acknowledgement ≠ settlement.
- A6T09 independent read-only reconciliation, discrepancy vocabulary, classified support trace, and partner certification fingerprint (fixture-based, not live).

### 2.4 Data minimization, consent, and disclosure

- A6T10 field-level classification, consent / mandate evidence, retention / legal hold, secret handling, disclosure audience maximums, and partner payload rejection.
- A2-protected partner payload validation; typed rejection codes; `A6_EXTERNAL_DATA_CONTROL` audit evidence through the shared Operations service.

### 2.5 Operational and release controls

- A6 disable / circuit-breaker / environment emergency-stop / rollback-safe procedure; the rule that disable changes admission, not financial history.
- A6 route exposure evidence and the A2-protected-internal `partner-callback.controller` boundary.
- A6T09 reconciliation as a read-only control and the A6T11 release-gate evidence package.

### 2.6 Reuse of A1–A5 contracts

A7 must continue to use:

- canonical `Customer.id` ownership from A1;
- A2 authorization, audience, route / data exposure, privileged-action, and security-event contracts;
- A3 binding / read / reconciliation contracts and the prohibition on inferring or repairing internal accounts from external data;
- A4 capability / risk / eligibility / restriction / compliance / limit / obligation / evidence contracts;
- A5 customer-aware command, transfer lifecycle, retry / recovery, transactional outbox, pilot disable, and independent transfer reconciliation patterns;
- Operations audit, idempotency, outbox, metrics, diagnostics, retention, and request-context primitives;
- independent Reconciliation as a read-only control.

Every handoff artifact remains subject to A2 audience authorization, retention/classification controls, and owning-boundary approval.

## 3. A6 must not hand off

A6 must **not** hand off:

- bank, NIBSS, partner credentials, tokens, certificates, signing keys, callback secrets, partner confidential material, or unrestricted risk/compliance evidence;
- raw KYC, risk, compliance, investigative, security, device, support-restricted, or customer PIN/OTP payloads;
- mutable balances, posted journal/line data as a new source of truth, or financial correction authority;
- permission to treat an outbox event, payment reference, command ID, provider reference, callback ID, external reference, or suspense row as Ledger truth;
- permission to bypass A2 authorization, A3 binding, A4 policy, A6 partner capability, Ledger, Operations, or Reconciliation controls;
- permission to infer external account ownership from internal customer / wallet / beneficiary / provider data;
- a claim that the selected partner (`NIBSS_NIP`) proves all external provider reliability or settlement finality;
- a broad customer cohort, public route, mobile / web / partner API, or product catalogue;
- permission to broaden the selected partner, currency, or capability into a product catalogue;
- permission to mutate completed A5 transfer, A6 settlement, A6 suspense, or A6 journal history for product or provider correction;
- permission to skip A7 product, channel, disclosure, notification, governance, support, and reconciliation review;
- permission to treat the A6 fixture-based `PartnerCertificationEvidence` as a live NIBSS certification; and
- ADR-0048 itself — it is not authored; the A6T03 follow-on must author and approve it before any partner-specific transport / credential / signing / key-rotation evidence is claimed.

## 4. A7 entry conditions

A7 must not begin implementation until the following are independently approved and recorded:

1. A6 phase exit and accountable-owner approval.
2. A2 route / data-exposure, service audience, security, and privileged-access approval for any A7 surface.
3. A3 binding / read / reconciliation approval for any A7 product / customer-cohort decision.
4. A4 policy mapping for any A7 product / capability, including external-risk / compliance evidence and limits.
5. A6 partner capability and reconciliation owner approval for any A7 product that reuses the A6 external-rail contracts.
6. Finance / Ledger chart, settlement / suspense / reversal / compensating-entry / financial-correction decisions for any A7 product financial effect.
7. Operations provider-idempotency, callback, audit, outbox, diagnostics, retention, and incident ownership for any A7 product that crosses the A6 boundary.
8. Security approval for any A7 product that touches provider credentials, callback authentication, signing, replay protection, or secret rotation.
9. Privacy / Legal / Compliance approval for any A7 data-sharing, consent / mandate, retention / legal hold, or disclosure boundary.
10. Reconciliation / Finance approval for any A7 reconciliation owner or report scope.
11. A separate A7 implementation plan and ADR set.

## 5. Prohibited A7 skip edges from the A6 handoff

A7 must **not**:

- call an external partner from a non-A6 boundary;
- reuse the A6 internal command / idempotency scope as a provider idempotency key;
- treat a provider response / callback / external reference as a journal or balance;
- accept unauthenticated callbacks or trust provider references as canonical internal identity;
- settle externally without immutable internal correlation and independent reconciliation;
- add suspense / settlement accounts without Finance / Ledger approval;
- mutate A6 completed journals, lines, balances, settlements, or operation identity for product or provider correction;
- broaden the A6 partner, capability, currency, or customer cohort without a separate capability decision and release boundary;
- expose public / mobile / web / partner APIs from the A6 handoff;
- introduce notifications, customer messaging, background schedulers, or product pricing without a separate A7 capability decision;
- treat fixture-based partner certification as live NIBSS certification;
- invoke a live provider transport, settlement, or callback before ADR-0048 is authored and approved and a partner certification record is recorded; or
- skip A7 product, channel, disclosure, notification, governance, support, and reconciliation review.

## 6. Handoff status

```text
A6 implementation evidence:  PREPARED (54 test suites / 414 tests passing; lint/build/format:check PASS)
A6 partner activation:       NOT APPROVED — NIBSS_NIP NOT CONNECTED OR CERTIFIED
A6 live migration / deploy:  NOT EXECUTED
A6-to-A7 handoff:            PREPARED, BLOCKED
A7 implementation:           NOT STARTED
ADR-0048 (NIBSS isolation):   NOT AUTHORED — A6T03 FOLLOW-ON REQUIRED
A8 / product roadmap:        OUT OF SCOPE FOR A6
```

The next phase may use the bounded contracts only after the stated entry conditions and approvals are recorded. This handoff is not an A7 start signal, a production release authorization, or a partner certification claim.
