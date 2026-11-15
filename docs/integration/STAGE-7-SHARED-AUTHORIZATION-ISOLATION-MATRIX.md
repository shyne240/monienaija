# Stage 7 — shared authorization and financial isolation reconciliation

Branch `arena/ca576774-monienaija` · synthetic data only · no provider call, no live money.

The consolidation's purpose is that **every** financial flow uses the same authorization,
eligibility, ownership and institutional-isolation machinery. This document reconciles the seven
money-movement flows against the shared guards, names the evidence for each, and states the two
flows where the accepted rule is a refusal rather than a posting.

## 1. The shared controls (one implementation, seven consumers)

| Control                               | Implementation                                                                                                               | What it enforces                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer financial eligibility        | `src/kyc-verification/customer-financial-eligibility.service.ts` (`require`)                                                 | ACTIVE non-synthetic customer, APPROVED at LEVEL_1/2, governed tier policy in force, no hold, no identity conflict, exactly one verified primary phone, trusted-provider evidence with matching identity revision and required tier. Unconfigured policy / unavailable reader / unverifiable evidence fail closed. |
| Wallet ownership + obligation binding | `src/wallet/wallet-financial-boundary.service.ts` (`requireCustomerWallet`, `requireWithdrawalOperation`, `requireAccounts`) | Wallet is customer-owned and unresolved/system ownership is refused; a withdrawal external operation must match the exact persisted obligation (wallet, amount, currency, status).                                                                                                                                 |
| Wallet creation authority             | `src/wallet/wallet.service.ts` (`createWalletInTransaction`)                                                                 | CUSTOMER wallets require eligibility; AGENT wallets require an ACTIVE, non-deleted Agent; anything else requires review.                                                                                                                                                                                           |
| Session/credential binding            | `src/customer-authentication/authentication-session.service.ts` (`validate`, `requireBoundCredential`)                       | Session audience, expiry, revocation, current customer status, live eligibility and the bound credential (`onboarding_password_version` = current `password_version`, not locked, not rotation-required) are re-read per request.                                                                                  |
| Institutional attribution             | `src/institution/*` + migration `1785753600401`                                                                              | Institution scope resolution, governed wallet attribution, and a database CHECK that a half-attributed account cannot exist.                                                                                                                                                                                       |
| Ledger isolation                      | `src/ledger/ledger.service.ts` (`resolveJournalInstitution`)                                                                 | A journal is single-institution; institutional + unattributed/platform mixing is refused; cross-institution postings are refused.                                                                                                                                                                                  |
| Protected authority                   | `src/protected-authority/*` + `protected_authority` schema                                                                   | Checker decisions and approval consumptions only through the authority role; runtime DML is rejected by guard trigger and by role grants.                                                                                                                                                                          |

## 2. The seven flows

| #   | Flow                                                 | Entry point                                                                                               | Shared controls actually invoked                                                                                                                                                                                                | Evidence (real PostgreSQL unless stated)                                                                                                                                               |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Customer funding (approved customer-funding request) | `src/customer-funding/customer-funding.service.ts`                                                        | maker/checker commercial decision + `LedgerService` (`requireAccounts` → wallet boundary → eligibility), institutional journal resolution                                                                                       | `v1-001-customer-funding`, `v1-commercial-scenario-matrix-01`, `v1-commissions-*`, `a2-*` approval suites                                                                              |
| 2   | Customer withdrawal (A6 outbound)                    | `src/financial-commitment/financial-commitment.service.ts` → `src/partner/external-operation*.service.ts` | authenticated customer session + PIN, beneficiary/destination evidence (0141), `requireCustomerWallet`, `requireWithdrawalOperation`, atomic reservation, `WithdrawalExecutionAuthority` (unavailable by default → fail closed) | `financial-commitment-initiation` + `a7-inbound-admission` (41 together), `a6-settlement-lifecycle` (20), `financial-commitment-schema` in the migration-readiness group (34 together) |
| 3   | Customer transfer (wallet→wallet)                    | `src/transfer/transfer.service.ts`                                                                        | idempotency recovery, both wallets through the ledger boundary, eligibility on both sides                                                                                                                                       | `v1-transfer-*`, and `v1-system-01-suspended-customer-financial-boundary` inside the migration-readiness group (34 together)                                                           |
| 4   | Agent cash-in (customer → Agent)                     | `src/agent/agent-cash-in.service.ts`                                                                      | Agent principal + PIN + class capability + Agent ACTIVE, recipient customer eligibility, ledger boundary                                                                                                                        | `a13-agent-cash-in` (in the consolidated matrix)                                                                                                                                       |
| 5   | Agent cash-out (Agent ↔ customer, OTP/PIN)          | `src/agent/agent-cash-out.service.ts` + `cash-out-institution.resolver.ts`                                | Agent session/credential re-read inside the transaction, desk OTP bound to the operation key, customer PIN, `cash_out_intents.institution_scope` equality, eligibility                                                          | `a14-agent-cash-out`, `a14-otp-hardening`, `a14-otp-migration`, `a24-*`                                                                                                                |
| 6   | Agent cash-to-cash (Agent ↔ Agent)                  | `src/agent/agent-cash-to-cash*.service.ts`                                                                | institutional funding policy (`CashToCashFundingPolicy`, fail-closed), institution suspense attribution, transaction-bound claim authority + `CASH_TO_CASH_CLAIM` OTP                                                           | `a15-agent-cash-to-cash`, `v1-w2w-recovery-audit-01`, expiry/claim/handoff suites                                                                                                      |
| 7   | Agent funding/defunding (platform float)             | `src/agent/agent-funding.service.ts`                                                                      | Decision-7 maker/checker (ANM maker, Finance Controller checker, SUPER_ADMIN excluded, MFA), pool classification guard (Stage 6), ledger boundary                                                                               | `a19-agent-funding` + `v1-commission-runtime-wiring` (45 together), `agent-funding-pool-classification` (4), `a8`+`a20`+`v1-agent-history-01` (63 together)                            |

Two further money paths are reconciled elsewhere and reuse the same guards: the **governed ledger
reversal** (`src/ledger/ledger-reversal-governance.service.ts`, Stage 3) and the **A7 verified
inbound receipt** (`src/virtual-account/inbound-funding.service.ts`, Stage 5), which calls
`requireCustomerWallet` and refuses outbound-debit substitution.

## 3. Reconciliation decisions taken during the replay

1. **Session fixtures must satisfy the bound-credential contract.** Arena 1 suites created
   `authentication_sessions` without `onboarding_password_version`; the accepted Arena 2 gate
   refuses such a session. Fixed in the fixtures (not in the gate).
2. **Wallet creation for a non-ACTIVE Agent is refused.** A13/A14 cases that pre-provisioned a
   wallet for a PENDING Agent to "avoid masking" the auth failure now assert the authorization
   refusal itself.
3. **Eligibility fixtures must have a governed policy in force** when the case intends to prove the
   eligibility decision; otherwise the correct outcome is the fail-closed
   `Customer financial policy is unavailable`, which the shared KYC fixture contract now asserts.
4. **Platform float never funds an institution-attributed Agent** (Stage 6). Attributed float must
   come from that institution's own funding authority, which does not exist; the flow fails closed.
5. **Institution attribution cannot be forged by SQL.** The database, not only the service,
   refuses to attribute a ledger account without a governed wallet attribution execution.

## 4. What this reconciliation does _not_ claim

- No licensed institution, funding authority, settlement source or suspense policy was invented.
- No flow is production-enabled: readiness reports `financial_dependencies_not_ready`, the
  withdrawal execution authority and inbound verifier are unavailable by default, and generic
  withdrawal initiation remains disabled.
- These are controlled synthetic acceptance results, not production readiness.
