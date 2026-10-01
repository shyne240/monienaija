# A5 to A6 Handoff Package

- **From:** A5 — Internal Financial Pilot
- **To:** A6 — External Partners and Settlement (future phase)
- **Task:** A5T10 — A5 Integration, Pilot Release Gate, and A6 Handoff
- **Status:** Handoff prepared; **blocked until A5, A2, A3, A4, Finance, Security, Risk, Compliance, Operations, and Reconciliation approvals**
- **Classification:** Documentation-only downstream handoff and prohibited-edge evidence
- **Application, database, API, migration, controller, route, scheduler, provider, settlement, and financial-runtime changes in this task:** None

## 1. Handoff purpose

A5 proves one bounded internal customer-to-customer transfer boundary. It may provide A6 with implementation contracts and evidence patterns, but it does not prove external bank/provider reliability, settlement correctness, callback authenticity, suspense behavior, or partner reconciliation.

A6 must begin from a separately reviewed external-integration plan. A5 does not authorize A6 code, credentials, partner contracts, or production activation.

## 2. Permitted A5 handoff

A5 may hand off the following bounded artifacts after accountable approval:

### Command and identity

- `InternalTransferCommandV1` identity/correlation contract.
- Canonical `Customer.id` source/destination semantics.
- Explicit CustomerWallet, A3 binding, WalletAccount, and LedgerAccount assertion relationships.
- Amount/currency/accounting-unit and business reference rules.
- Command/request/correlation/trace/causation/idempotency/reference separation.

### Gate and policy consumption

- A2 authorization separation and exact command scope recheck pattern.
- A4 `wallet.transfer/create` policy subject/capability/action/profile/version/currentness/obligation/limit handoff.
- A3 read-only binding/account ownership/dimension recheck pattern.
- Fail-closed error vocabulary and prohibited authority substitutions.

### Lifecycle and financial invariants

- Transfer lifecycle metadata and pending/processing/recovery/unknown/completed/failed/cancelled state model.
- Immutable command identity and deterministic recovery reference rules.
- Existing Ledger double-entry, currency, accounting-unit, account-state, balance, and deterministic lock patterns.
- Transfer-to-Ledger journal correlation and no-direct-balance-write boundary.

### Resilience and Operations

- Operations-backed idempotency scopes, replay/conflict behavior, bounded serialization/deadlock retry, timeout verification, and unknown-outcome handling.
- Minimal `transfer.completed` transactional outbox fact shape and deterministic event key.
- Audit, diagnostics, support trace, and safe payload minimization patterns.
- Independent read-only reconciliation and discrepancy classification pattern.

### Pilot safety

- Durable cohort/limit/threshold control contract.
- Environment emergency-stop and durable disable behavior.
- Stop-condition and rollback-safe disable rules.
- Evidence that disabling new internal admission does not rewrite completed financial history.

Every handoff artifact remains subject to A2 audience authorization, retention/classification controls, and owning-boundary approval.

## 3. A5 must not hand off

A5 must not hand off:

- claims that internal pilot evidence proves external provider reliability or settlement finality;
- bank/NIBSS/provider credentials, tokens, certificates, signing keys, callback secrets, or partner data;
- raw KYC, risk, compliance, investigative, security, device, or support-restricted payloads;
- mutable balances, posted journal/line data as a new source of truth, or financial correction authority;
- permission to treat an outbox event, payment reference, command ID, or provider reference as Ledger truth;
- permission to bypass A2 authorization, A3 binding, A4 policy, Ledger, Operations, or Reconciliation controls;
- permission to infer external account ownership from internal customer/wallet references; or
- a broad customer cohort, public route, production activation, or product catalogue.

## 4. A6 entry conditions

A6 must not begin implementation until the following are independently approved and recorded:

1. A5 phase exit and accountable-owner approval.
2. A2 route/data-exposure, service audience, security, and privileged-access approval for any A6 surface.
3. A3 binding/account and ownership integration approval for external mapping use.
4. A4 policy mapping for the external capability/action, including external-risk/compliance evidence and limits.
5. Finance/Ledger chart, settlement account, suspense, reversal, and financial correction decisions.
6. Operations provider-idempotency, callback, audit, outbox, diagnostics, retention, and incident ownership.
7. Security approval for provider credentials, callback authentication, signing, replay protection, and secret rotation.
8. Compliance/Risk approval for external transaction monitoring, sanctions/AML/PEP controls, limits, reviews, and evidence retention.
9. Reconciliation/Finance approval for external settlement and provider-to-Ledger reconciliation.
10. Product/Support/Legal approval for customer disclosures, disputes, notifications, and support/reporting.
11. A separate A6 implementation plan and ADR set.

## 5. Prohibited A6 skip edges

A6 must not:

- call an external provider from the A5 internal transfer path;
- reuse the internal `wallet.transfer.create.v1` scope as provider idempotency without a separate provider contract;
- treat a provider response/callback as a journal or balance;
- accept unauthenticated callbacks or trust provider references as canonical internal identity;
- settle externally without immutable internal correlation and independent reconciliation;
- add suspense/settlement accounts without Finance/Ledger approval;
- mutate A5 completed journals, lines, balances, or transfer identity for provider correction;
- broaden the A5 pilot cohort to external customers;
- expose public/mobile/web APIs from the A5 handoff; or
- skip A6 partner, security, compliance, settlement, rollback, and reconciliation review.

## 6. Handoff status

```text
A5 implementation evidence: PREPARED
A5 pilot activation:        NOT APPROVED
A5-to-A6 handoff:            PREPARED, BLOCKED
A6 implementation:           NOT STARTED
```

The next phase may use the bounded contracts only after the stated entry conditions and approvals are recorded. This handoff is not an A6 start signal or production release authorization.
