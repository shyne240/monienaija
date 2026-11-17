# ARENA 3D banking — application integration map

Produced at the start of the application-integration mission, so the wiring work has a stated
target rather than an improvised one. Every implemented banking service is listed with the caller it
did NOT have at commit `4342b9d8`, and the module, controller, worker, lifecycle and frontend surface
it is now expected to reach.

## 1. Services with no application caller at `4342b9d8`

| Service                                | Intended module    | Intended controller / worker                                                | Financial lifecycle               | Frontend consumer                       |
| -------------------------------------- | ------------------ | --------------------------------------------------------------------------- | --------------------------------- | --------------------------------------- |
| `BankingProviderRegistry`              | `BankingModule`    | constructed at module init from configuration                               | gates every provider call         | — (indirect)                            |
| `MonnifyProvider`                      | `BankingModule`    | bound as a `BankingProvider`                                                | transport for every capability    | —                                       |
| `MonnifyTokenManager` / `monnify.http` | inside the adapter | —                                                                           | credential handling               | —                                       |
| `BankingProviderGovernanceService`     | `BankingModule`    | `internal/banking/governance/*`                                             | approve who may move money        | admin · Provider governance             |
| `BankingVirtualAccountService`         | `BankingModule`    | `customers/me/banking/virtual-account`, `agents/me/banking/funding-account` | customer/agent receiving identity | customer · Add Money; agent · Funding   |
| `BankingInboundService`                | `BankingModule`    | `internal/banking/deposits` reads; worker verification                      | A7 inbound deposit                | admin · Banking transactions            |
| `BankingWebhookService`                | `BankingModule`    | `POST /webhooks/monnify` (provider-authenticated)                           | inbound observation               | admin · Webhook operations              |
| `BankingOutboundService`               | `BankingModule`    | `customers/me/banking/transfers` + dispatch worker                          | A6 outbound transfer              | customer · Send Money; admin · Outbound |
| `BankingReconciliationService`         | `BankingModule`    | `internal/banking/reconciliation/*`                                         | reconciliation runs/exceptions    | admin · Reconciliation                  |

## 2. The one boundary that must not be duplicated

`WithdrawalService` + `FinancialCommitmentService` + `WithdrawalExecutionAuthority` already implement
the A6 commitment lifecycle: eligibility, limits, PIN authorization, destination binding, durable
commitment, atomic reservation, ledger posting and provider reference creation. `BankingOutboundService`
must not reimplement any of it.

The binding point is `WITHDRAWAL_EXECUTION_AUTHORITY`. Its current implementation is
`UnavailableWithdrawalExecutionAuthority`, which returns `UNAVAILABLE` for everything, which is why
customer withdrawals are refused today. The banking-aware implementation replaces that decision — and
only that decision — with: is there an approved provider configuration for this institution whose
governed capability set actually supports outbound transfer? Answering "no" preserves today's refusal
exactly.

## 3. Route families (no competing endpoints)

| Concern                       | Route family                                       | Principal                                         |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| Customer receiving account    | `/customers/me/banking/virtual-account`            | CUSTOMER SELF                                     |
| Customer deposit history      | `/customers/me/banking/deposits`                   | CUSTOMER SELF                                     |
| Customer outbound transfer    | reuses `POST /customers/me/withdrawal-commitments` | CUSTOMER SELF                                     |
| Customer transfer status      | `/customers/me/banking/transfers/:reference`       | CUSTOMER SELF                                     |
| Agent funding account         | `/agents/me/banking/funding-account`               | AGENT SELF                                        |
| Agent funding history         | `/agents/me/banking/funding-history`               | AGENT SELF                                        |
| Bank directory                | `/internal/banking/directory`                      | catalogue function                                |
| Account-name enquiry          | `/internal/banking/account-name-enquiry`           | catalogue function                                |
| Provider governance           | `/internal/banking/governance/*`                   | `banking.provider.*`                              |
| Provider readiness            | `/internal/banking/providers`                      | catalogue function                                |
| Deposits / outbound / unknown | `/internal/banking/*`                              | catalogue function                                |
| Reconciliation                | `/internal/banking/reconciliation/*`               | `reconciliation.view` / separate resolve function |
| Webhook ingress               | `POST /api/v1/webhooks/monnify`                    | provider callback, HMAC                           |

## 4. Worker

`BankingDispatchWorker` — application-managed, durable, exclusive per operation via a lease, bounded
attempts with backoff, safe shutdown, restart recovery. It dispatches only operations that a committed
A6 commitment produced, and it never mints a provider reference.

## 5. Readiness vocabulary

`IMPLEMENTED` (code can do it) · `APPROVED` (governed configuration permits it for this institution) ·
`CREDENTIALED` (secret references resolve) · `OPERATIONAL` (operators marked it ready) ·
`ENTITLED` (provider-side commercial entitlement — never inferable from code) ·
`DISABLED` (operational emergency disablement) · `UNSUPPORTED` (no documented contract).

A registered adapter must never collapse these into "authorized".
