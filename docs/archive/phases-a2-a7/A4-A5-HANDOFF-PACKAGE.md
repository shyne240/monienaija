# A4 to A5 Handoff Package

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T10 — A4 Integration, Reconciliation, and Release Gate
- **Status:** Handoff contract prepared; **blocked until A4, A2, and A3 approvals**
- **Classification:** Documentation-only downstream handoff and prohibited-edge evidence
- **Application, database, API, migration, scheduler, and financial-runtime changes in this task:** None

## 1. Handoff purpose

This package defines the minimized A4 output that a future A5 financial command may consume. It does not implement A5 transfers, deposits, withdrawals, payments, outbox consumers, providers, settlement, financial recovery, or routes.

A4 supplies action-specific policy eligibility. A5 remains responsible for current A2 authorization, A3 binding/account checks, command idempotency, financial invariants, Ledger locking/posting, outbox, transaction recovery, and independent reconciliation.

A4 is not a substitute for any of those boundaries.

## 2. Permitted A4 handoff

A future authorized consumer may receive, through an approved internal contract:

```text
A4PolicyHandoffV1
  subject
    type: CUSTOMER
    customerId                  # canonical Customer.id UUID
  capability
  action
  requestedAt
  policyDecision
    decision                    # ALLOW | ALLOW_WITH_LIMITS | PENDING_REVIEW | DENY | SUSPEND
    decisionReference
    policyVersion
    profileReference
    profileVersion
    definitionHash
    evaluatedAt
    expiresAt?
    reviewAt?
    supersedesDecisionReference?
    reasonCodes                  # approved consumer vocabulary only
    obligations[]
    limits[]                     # exact currency/minor-unit output where applicable
  evidenceContext
    snapshotReference
    snapshotContractVersion
    normalizedInputHash
    sourceReferences[]           # approved safe references only
    sourceVersions/freshness
  accessContext
    authorizationContextReference # reference to separate A2 context
  requestContext
    requestId
    correlationId
    traceId?
    causationId?
  reEvaluation
    currentness/recovery state
    reEvaluationRequired?
```

The exact fields and audience filtering are defined by [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](A4-POLICY-REQUEST-RESULT-CONTRACT.md), [`A4-POLICY-PERSISTENCE-CONTRACT.md`](A4-POLICY-PERSISTENCE-CONTRACT.md), [`ADR-0039-Customer-Visible-Decision-Reasons.md`](ADR/ADR-0039-Customer-Visible-Decision-Reasons.md), and [`A4-POLICY-RECOVERY-RUNBOOK.md`](A4-POLICY-RECOVERY-RUNBOOK.md).

A4 handoff may include source references, versions, freshness, and hashes. It must not include raw source payloads merely because a future command is financial.

## 3. Required A5 consumer gates

Before executing any financial command, A5 must independently:

1. **Authenticate and authorize through A2.** Confirm the current principal, customer scope, audience, assurance, route/service action, and any privileged approval required by the command. A4 `ALLOW` is not authorization.
2. **Validate the A4 subject/scope.** Match canonical `Customer.id`, capability, action, request context, policy version/profile, policy contract version, and current time window.
3. **Check A4 currentness.** Reject expired, review-due, retired, superseded, integrity-mismatched, stale, conflicting, unavailable, pending, denied, suspended, or unknown results according to the command contract. Do not treat a missing result as allow.
4. **Recheck the A3 binding.** Confirm the explicit Customer-to-Financial-Account binding, CustomerWallet/WalletAccount/LedgerAccount dimensions, currency, accounting unit, lifecycle, source versions, and control/reconciliation state. A4 cannot make an unresolved binding active.
5. **Recheck limits/usage.** Use the authoritative customer limit configuration and current usage/ledger read boundary. A4 limit output is not a usage reservation or command-time lock.
6. **Apply financial invariants.** Enforce amount/currency, account state, balance/negative-balance, journal, fee/commission, authorization, concurrency, and transaction rules owned by the financial command/Ledger boundary.
7. **Apply command idempotency and transaction recovery.** The command must use its own idempotency scope and durable outcome verification; an A4 unknown outcome is not a financial command retry instruction.
8. **Post only through Ledger.** A5 may create financial effects only through approved Ledger/Wallet/financial command contracts and must preserve journal/line/balance authority.
9. **Publish only approved facts.** If an outbox fact is later approved, it must be minimal, versioned, redacted, correlated, and atomically linked to the owning financial mutation.
10. **Reconcile independently.** Financial/source reconciliation remains read-only and independently owned; a policy result cannot repair discrepancies.

## 4. Capability handoff matrix

| A4 profile/capability             | A4 may provide                                                                                                     | A5/future consumer must recheck                                                                                                  | A5 implementation status               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `wallet.transfer` / `create`      | Policy decision, exact transfer limits/obligations, policy/profile/version, A3 references, evidence freshness/hash | A2 transfer authorization, A3 active binding/dimensions, usage/limit lock, funds/journal invariants, idempotency, reconciliation | Not implemented in A4T10               |
| `wallet.deposit` / `create`       | Policy decision and deposit policy limits/obligations                                                              | A2/A3, deposit source/ledger rules, amount/currency, idempotency, financial posting/reconciliation                               | Not implemented in A4T10               |
| `wallet.withdrawal` / `create`    | Policy decision and withdrawal policy limits/obligations                                                           | A2/A3, available funds, withdrawal controls, fees, idempotency, Ledger posting/reconciliation                                    | Not implemented in A4T10               |
| `wallet.payment` / `create`       | Policy decision, payment capability limits, obligations, profile provenance                                        | A2/A3, merchant/payment/provider boundaries, financial invariants, idempotency, settlement/reconciliation                        | Not implemented in A4T10               |
| `customer.product` / `enroll`     | Policy eligibility and safe obligations for a later source-owner enrollment action                                 | A2 authorization and CustomerEligibility-owned enrollment mutation; no A5 money movement implied                                 | Not an A5 command; no activation in A4 |
| `product.virtual-account` / `use` | Policy result and A3/product evidence references                                                                   | A2, product-owner/provider contract, A3/account state, any external integration controls                                         | Not implemented in A4T10               |
| `wallet.account` / `read`         | Policy read result/reference for an approved consumer                                                              | A2 read authorization, A3 account read, Ledger-derived balance, privacy/audience controls                                        | No new read route in A4T10             |
| `channel.api` / `use`             | Policy result for declared customer/channel context                                                                | A2 service/audience/route authorization, API credential boundary, product/source checks                                          | No API exposure in A4T10               |

A4 capability profiles are not a product catalogue and do not activate any of these capabilities.

## 5. A4 must not hand off

A4 must not provide A5 with:

- passwords, password hashes, session/access tokens, refresh tokens, recovery codes, MFA proofs, device fingerprints, or privileged-action fingerprints;
- raw KYC documents, unrestricted customer profile fields, raw risk notes, factor remarks, compliance comments, investigative evidence, or case payloads;
- an assertion that policy `ALLOW` is A2 authorization, privileged approval, account ownership, or financial execution approval;
- a mutable customer balance, journal line, posted value, transaction usage ledger, or financial correction;
- a binding or account selected from `WalletAccount.customerId`, customer reference, wallet alias, payment reference, provider ID, currency, or policy result;
- an external-provider, bank, NIBSS, settlement, callback, notification, or financial-recovery result; or
- a request to mutate Customer, eligibility, enrollment, permission, risk, compliance, A3, Wallet, Ledger, or Reconciliation records.

A4 also must not use A5 consumers to back-write policy decisions or source evidence.

## 6. Handoff trace and ownership

```text
A2 authorization context
        |
        v
A4 policy request + immutable evidence snapshot
        |
        v
A4 versioned decision/explanation/recovery result
        |
        +--> A5 validates A2 again
        +--> A5 validates A3 binding/account state again
        +--> A5 validates limits and financial invariants
        +--> Ledger owns financial posting/value
        +--> Operations owns command idempotency/audit/outbox
        +--> Reconciliation independently verifies source/financial consistency
```

| Concept                                       | Owner                  | A4 handoff role                               | A5 prohibition                                      |
| --------------------------------------------- | ---------------------- | --------------------------------------------- | --------------------------------------------------- |
| Customer identity                             | Customer               | Canonical UUID subject                        | Do not use A4/reference/alias as identity           |
| Eligibility/restriction/enrollment/permission | CustomerEligibility    | Read-only evidence and policy result          | Do not mutate source to pass command                |
| Risk/compliance evidence                      | Risk/Compliance        | Minimized references, freshness, safe reasons | Do not treat A4 result as screening or raw evidence |
| Principal/authorization                       | A2                     | Separate authorization-context reference      | Do not substitute A4 decision for A2                |
| Binding/account association                   | A3/Wallet              | Explicit binding/read/control reference       | Do not infer/reassign account                       |
| Financial account/journal/line/balance        | Ledger/Wallet          | Approved dimension/read evidence only         | Do not make A4 policy history financial truth       |
| Audit/idempotency/outbox/diagnostics          | Operations             | Correlation and lifecycle evidence            | Do not create divergent command controls            |
| Reconciliation                                | Reconciliation/Finance | Independent control result                    | Do not repair from policy output                    |
| Financial command                             | A5                     | Future consumer of A4 contract                | Not implemented in A4T10                            |

## 7. A5 entry conditions

A5 entry remains blocked until the following are approved and recorded:

- A2 authentication, authorization, route/data-exposure, privileged approval, security/privacy, and rollback gates;
- A3 binding, account read, reconciliation, repair, migration, and rollback gates;
- A4 ADR-0036 through ADR-0040 review and A4 exit/approval;
- A4T06 physical persistence/replay/retention artifacts and their approved live migration/operational evidence if A5 depends on durable policy decisions;
- source-adapter and Operations production wiring with transactionality, idempotency, audit, and diagnostic evidence;
- exact A5 command contracts for amount/currency/account/limit/ledger/outbox/recovery/reconciliation behavior;
- independent Finance/Ledger/Reconciliation approval; and
- a reviewed A5 implementation plan that does not broaden A4 or source ownership.

A4T10 only prepares the handoff. It does not mark these conditions complete.

## 8. Prohibited-edge register

- A4 does not call or implement transfer, deposit, withdrawal, payment, fee, commission, settlement, external bank, NIBSS, provider callback, or financial recovery code.
- A4 does not create or mutate financial accounts, bindings, journals, lines, balances, usage counters, or reconciliation records.
- A5 must not duplicate A4 risk/restriction/compliance/eligibility precedence in each command.
- A5 must not use a policy result to bypass A2 authorization, A3 binding, Ledger locks, command idempotency, or reconciliation.
- No policy explanation or recovery diagnostic becomes a source writer or authorization bypass.
- No route/API is implied by this handoff document.

## 9. Handoff result

**A4 handoff status:** `PREPARED — BLOCKED UNTIL A4, A2, A3, AND FINANCIAL OWNER APPROVALS ARE RECORDED.`

The handoff contains the permitted contract and prohibited edges. It is not an A5 start signal, financial execution authorization, product activation approval, or production release approval.
