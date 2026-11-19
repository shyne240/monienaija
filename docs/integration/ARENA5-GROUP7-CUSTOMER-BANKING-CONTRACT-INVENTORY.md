# ARENA 5 — Group 7: Customer banking contract inventory (original 40-group mission)

Snapshot date: 2026-11-19, branch `arena/1f37a4f3-monienaija`, branch base `6816a760`,
tip at capture: `6a47a6d5`. Every row is verified against the working tree; "File" paths are
repository-relative and current at the snapshot date. This inventory covers the **customer**
half of the banking journey only. The agent half is Group 8
(`ARENA5-GROUP8-AGENT-BANKING-CONTRACT-INVENTORY.md`).

## 1. Product decision this inventory is written against (binding, 2026-11-19)

Customers may transfer from their authorized wallet to **any valid external bank beneficiary**:
their own bank account, another individual's bank account, or any eligible bank beneficiary.
There is **no** separate own-account withdrawal product, **no** special own-account permission,
and **no** mandatory own-account restriction. The same rule binds agents (Group 8). The agent
uses the existing operating wallet — no separate personal wallet, no second financial engine.

## 2. Route families serving the customer banking journey today

All `/api/v1/customers/me/*` routes are **CUSTOMER SELF** by the route-policy registry
(`src/authorization/route-policy-registry.ts`, `path === '/api/v1/customers/me' || path.startsWith('/api/v1/customers/me/')`
→ `allowedPrincipalTypes: ['CUSTOMER']`, `customerAccess: 'SELF'`). No banking capability may be
exposed elsewhere for customer use.

| #   | Journey step                                                                              | Route (method)                                                                                                                     | Controller (file)                                                                                                                                                                                        | State                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Receiving account (virtual account) — view own                                            | `GET /customers/me/banking/virtual-account`                                                                                        | `src/banking/banking-customer.controller.ts`                                                                                                                                                             | **IMPLEMENTED** (read; honest NOT_PROVISIONED/PENDING/UNKNOWN states)                                                                                                                                              |
| C2  | Receiving account — request provisioning                                                  | `POST /customers/me/banking/virtual-account`                                                                                       | `src/banking/banking-customer.controller.ts`                                                                                                                                                             | **IMPLEMENTED** (authorized by governed provider capability + readiness; refuses when unconfigured)                                                                                                                |
| C3  | Deposit history (verified inbound only)                                                   | `GET /customers/me/banking/deposits`                                                                                               | `src/banking/banking-customer.controller.ts`                                                                                                                                                             | **IMPLEMENTED**                                                                                                                                                                                                    |
| C4  | Outbound transfer lifecycle (wallet→bank) — commitment                                    | `POST /customers/me/withdrawal-commitments`                                                                                        | `src/financial-commitment/financial-commitment.controller.ts`                                                                                                                                            | **IMPLEMENTED** (customer-self; PIN-bound; reserves funds; provider dispatch intent; `operationReference` on response)                                                                                             |
| C5  | Outbound transfer tracking — by our reference                                             | `GET /customers/me/banking/transfers/:operationReference`                                                                          | `src/banking/banking-customer.controller.ts`                                                                                                                                                             | **IMPLEMENTED** (never renders provider status verbatim; UNKNOWN → CONFIRMING)                                                                                                                                     |
| C6  | Beneficiaries — my list/get/create/update (wallet recipients)                             | `GET/POST /customers/me/beneficiaries`, `GET/PATCH /customers/me/beneficiaries/:id`                                                | `src/customer-app/customer-beneficiary-me.controller.ts`                                                                                                                                                 | **IMPLEMENTED** for wallet recipients ONLY (creation requires phone/identifier resolution; BANK_ACCOUNT creation **not** exposed)                                                                                  |
| C7  | Beneficiaries — service layer bank-account support                                        | (no HTTP route)                                                                                                                    | `src/customer-beneficiary/customer-beneficiary.service.ts` (`createBeneficiary` accepts `BANK_ACCOUNT`; `verifyBeneficiary` marks verified; ownership rows; history/audit)                               | **PARTIAL, backend-only** — no self-service HTTP surface; `BANK_ACCOUNT` beneficiaries are created/verified through workforce-adjacent paths                                                                       |
| C8  | Bank directory — customer-facing                                                          | _none_                                                                                                                             | —                                                                                                                                                                                                        | **MISSING** (`banks` table + `src/bank/bank.controller.ts` are WORKFORCE_SESSION observability at `/api/v1/banks`; provider directory `listBanks()` exists in the Monnify adapter but is not exposed to customers) |
| C9  | Account-name enquiry — customer-facing                                                    | _none_                                                                                                                             | —                                                                                                                                                                                                        | **MISSING** (provider `enquireAccountName()` exists; 10-digit account; `establishesAccountOwnership: false`; documented not-found → NOT_FOUND, else UNAVAILABLE; no customer route)                                |
| C10 | Bank beneficiary creation — self-service (resolve → create ACTIVE/verified-or-pending)    | _none_                                                                                                                             | —                                                                                                                                                                                                        | **MISSING** (blocks the complete public journey; creation service exists but is not bound to a customer session)                                                                                                   |
| C11 | Beneficiary management — bank-account-specific projection (`bankCode`, `destinationName`) | projection shipped on `GET /customers/me/beneficiaries`                                                                            | `src/customer-app/customer-beneficiary-me.controller.ts` (ca81dcad)                                                                                                                                      | **IMPLEMENTED (projection only)**                                                                                                                                                                                  |
| C12 | Confirmation with principal/fee/VAT/total-debit                                           | _none for bank withdrawal_                                                                                                         | `src/quote/*` exists for transfer/deposit/withdrawal quotes; wallet→wallet self-transfer quotes exist (`src/transfer/self-transfer-quote.controller.ts`); bank-withdrawal commitment accepts amount-only | **PARTIAL / MISSING** for the bank journey (no server-authoritative principal+fee+VAT+total-debit confirmation bound to a bank beneficiary/commitment)                                                             |
| C13 | Immutable destination + pricing authorization evidence                                    | service-internal                                                                                                                   | `src/banking/banking-fee-binding.service.ts` (immutable `banking_operation_fee_bindings`), `src/financial-commitment/*` (destination target reference hash)                                              | **IMPLEMENTED (internal)**, not surfaced as customer-visible confirmation evidence                                                                                                                                 |
| C14 | Transaction PIN                                                                           | `GET/POST /customers/me/transaction-pin`, `POST /customers/me/transaction-pin/change`, `POST /customers/me/transaction-pin/verify` | `src/customer-app/customer-app.controller.ts`                                                                                                                                                            | **IMPLEMENTED**; bank-withdrawal commitment verifies PIN server-side                                                                                                                                               |
| C15 | Durable interrupted-submission recovery — bank flow                                       | client-side only, form-lifetime key                                                                                                | `apps/customer-mobile/src/services/bank-withdrawal.ts`; compare wallet-transfer durable pattern `apps/customer-mobile/src/services/pending-transfer.ts` (SecureStorage, process-death safe)              | **MISSING for bank flow** (bank-withdrawal idempotency key does not persist across process termination or lost responses; the wallet→wallet flow has the durable pattern to reuse)                                 |
| C16 | Transfer history + receipt (bank)                                                         | partial via `GET /customers/me/transactions` / `GET /customers/me/transfers/:transferId`                                           | `src/customer-app/customer-app.controller.ts`                                                                                                                                                            | **PARTIAL** — wallet transfers; bank-dispatch operations tracked only by `operationReference` lookup (C5); no unified receipt/history entry for an outbound bank transfer                                          |
| C17 | Settled / rejected / unknown effects (reservation release, ledger)                        | settlement lifecycle                                                                                                               | `src/banking/a6-settlement-lifecycle*` (23/23 PG), `BankingCommitmentBridgeService`                                                                                                                      | **IMPLEMENTED (internal)**; surfacing to the customer is C5/C16                                                                                                                                                    |
| C18 | Commercial accounting + reconciliation                                                    | internal                                                                                                                           | `src/banking/banking-outbound*`, `banking_operation_fee_bindings`, `src/commercial-accounting/*`, reconciliation admin surface                                                                           | **IMPLEMENTED (internal)** + admin reconciliation (`/internal/banking/reconciliation/*`, capability-gated)                                                                                                         |
| C19 | Notifications for transfer outcomes                                                       | outbox/notification infrastructure exists                                                                                          | `src/notification/*`, `src/a7-product-notification-*`                                                                                                                                                    | **UNVERIFIED for bank-transfer outcome events** — no dedicated customer notification for a settled/rejected outbound bank operation has been traced; must be verified in Group 25 (notifications)                  |

## 3. What the customer app exposes today (mobile truth)

`apps/customer-mobile/src/screens/authenticated/`: `BankWithdrawalScreen.tsx` (route
`BankWithdrawal`, Home tile "To bank") — lists verified, active BANK_ACCOUNT beneficiaries
(wallet recipients excluded client-side); over-balance guard; 4–12 digit PIN cleared from state on
submit; stable **form-lifetime** idempotency key; RESERVED-only copy that never claims the bank
paid; "Track this transfer" only when the server returns an `operationReference`; replayed
SETTLED/RELEASED rendered as earlier submissions; empty state routes to support.
`TransferStatusScreen.tsx` consumes C5 with server vocabulary verbatim.

The client itself states what is missing (see header comment of
`apps/customer-mobile/src/services/bank-withdrawal.ts`): no bank directory, no account-name
enquiry, no bank-beneficiary creation/verification path in the customer app.

## 4. Gaps that block the complete customer journey (ordered by dependency)

1. **G10 (this mission):** bank directory + account-name enquiry customer surfaces (call the
   governed provider capability contracts; no direct Monnify calls; no ownership claim from name
   enquiry; surface honest UNAVAILABLE). No fabricated banks, codes, names, or references.
2. **Bank beneficiary self-service creation** (resolve → confirm name → create PENDING, or
   ACTIVE only after a name-enquiry/verification step the institution defines; manage nickname,
   list, suspend/delete under the caller's ownership). Must enforce: caller owns the beneficiary;
   destination binding is immutable once created (versioned); BANK_ACCOUNT requires
   `bankCode`/`accountNumber`/`destinationName` consistent with the resolved enquiry evidence.
3. **Server-authoritative confirmation for bank withdrawal**: quote/commitment preview returning
   principal, service fee, VAT, total debit, currency, destination name/last-4, expiry; bound at
   commitment time to immutable evidence (destination + pricing). Commitment must refuse if the
   authorized total drifts from the preview the customer confirmed.
4. **Durable interrupted-submission recovery for the bank flow**: reuse the SecureStorage pending
   pattern so the idempotency key survives process death and lost responses. The backend enforces
   scoped idempotency (`withdrawal-commitment:<hash>`), but the client must not discard it.
5. **Unified transfer history/receipt** including outbound bank operations (settled/rejected/unknown
   with our references only), plus customer notifications on definitive outcomes.

## 5. What must NOT be built

- No own-account-only product, flag, or permission. No restriction of bank withdrawals to the
  customer's "own" account.
- No exposure of the workforce-only `/api/v1/banks` directory as a customer API.
- No customer route that enquires an arbitrary account's name without going through the governed
  provider capability contract and its eligibility/readiness gates.
- No client-side trust flags (e.g. "isVerified") — verification is always server-side.
- No fabricated provider references anywhere; RESERVED is never presented as settled success.
- No direct route to `BankingOutboundService`; outbound submission remains reachable only via the
  A6 commitment → bridge → dispatch worker path.

## 6. Evidence anchors (intermediate, not final acceptance)

- Backend PG: `financial-commitment-initiation` 43/43; `arena3d-banking-http` + `arena3d-banking-journeys` 62/62;
  `a6-settlement-lifecycle` 23/23; `a23-customer-app` + `v1-hardening-01-customer-beneficiary` 56/56.
- Mobile: `tsc` clean; full unit suite 220/220 (bank-withdrawal 9/9).
- Backend unit: 3403/3403 after the KYC config hardening (`6a47a6d5`).
- These are **intermediate evidence, not final acceptance**. Ledger/settlement effects for bank
  dispatches are covered by internal settlement suites; no live provider calls exist in this tree.
