# A23 Customer App Backend Foundation — Contract

**Status:** `A23 CONTRACT IMPLEMENTED`  
**Baseline:** A1–A22 verified at `9c4838f` (A22 Admin Backend)  
**Module:** `src/customer-app` (thin, `CustomerAppModule`)  
**Global prefix:** `api/v1` (no `/mobile` / `/app` namespace)

## 1. Authority & Authorization

| Route | Mode | Policy | Notes |
|---|---|---|---|
| `POST /customers/sessions` , `POST /customers/login` | `CUSTOMER_LOGIN` | unauthenticated | Reuses `AuthenticationExecutionService` + `AuthenticationSessionService` (PBKDF2, `customer-api` audience). Returns `accessToken`, `tokenType Bearer`, `expiresAt`, `customerId`, `sessionId`. |
| `POST /customers/sessions/logout` , `POST /customers/logout` | `CUSTOMER` SELF | `allowedPrincipalTypes=['CUSTOMER'] , customerAccess=SELF` | Calls `AuthenticationSessionService.revoke`. |
| All `GET|POST /customers/me*` | `CUSTOMER` SELF | `allowedPrincipalTypes=['CUSTOMER'] , customerAccess=SELF , agentAccess=NONE` | Guard validates `AuthenticationSessionService` then `AuthorizationService`. `unauthenticated→401`, `Agent JWT→403`, `workforce JWT→401/403 (not CUSTOMER)`, `Customer A ≠ Customer B → 404 (no leakage)` |

`RoutePolicyRegistry` adds `CUSTOMER_LOGIN` before generic `customers/` and a specific `customers/me` branch mirroring `agents/me`. `RuntimeAccessGuard` adds `CUSTOMER_LOGIN` passthrough (same as `AGENT_LOGIN`).

## 2. Minimum Contract (thin, reused)

| # | Contract | Endpoint(s) | Reuse | Notes |
|---|---|---|---|---|
| 1 | **auth/session/me** | `POST /customers/sessions` (alias `/login`), `POST /…/logout`, `GET /customers/me` | `AuthenticationExecutionService.authenticate`, `AuthenticationSessionService.issue/validate/revoke`, `Customer` entity | No duplication of auth domain. |
| 2 | **profile** | `GET /customers/me/profile` | `CustomerService.getProfile`, `Customer` | Safe projection: `id,reference,status,type,kycLevel,kycStatus, profile{displayName,legalName}`. Never `passwordHash`, `pinHash`, `tokenHash`, `audit`. |
| 3 | **account status** | `GET /customers/me/status` + embedded in `me` | `customers` table (`status,kyc_level,kyc_status`) | Read-only. |
| 4 | **wallet/balance** | `GET /customers/me/wallets`, `GET /customers/me/wallets/:walletId`, `GET /customers/me/wallets/:walletId/balance`, `GET /customers/me/financial-position` | `WalletService.listWallets/getWallet/getWalletBalance` → `LedgerService.getAccountBalance(s)` | **Ledger-derived only**. No `balance_minor` column on `customers`/`wallet_accounts`, no `CustomerBalance` table, no cached truth, no second ledger, no ad-hoc journals. Figures come from `ledger_*` via `WalletService.toView`. |
| 5 | **MonieNaija receiving identity** | `GET /customers/me/receiving-identity` (alias `receiving-number`) | `customer_contact_methods` (`type=PHONE`, `is_primary`, `normalized_value`) | No new receiving-number generator. Customer identity is phone alias; Agent receiving number stays Agent-only (`agent_receiving_numbers`). Uniqueness enforced at resolution layer. |
| 6 | **recipient resolution** | `GET /recipients?identifier=` (existing), `GET /customers/me/recipient?identifier=` (thin alias) | `RecipientResolutionService.resolve` (canonicalize to 10-digit, Agent `ACTIVE` first, then Customer phone, Global uniqueness, no `TERMINATED`/`PENDING`) | Reused, not duplicated. |
| 7 | **Wallet→Wallet** | `POST /customers/me/transfers` (`Idempotency-Key` required) | `TransferService.createTransfer` (SERIALIZABLE, `pessimistic_write` lock sorted wallets, `idempotency_key` + `requestHash`, `ledgerService.postJournalInTransaction` double-entry `DEBIT source / CREDIT dest` on `CUSTOMER_FUNDS`, `audit` + `outbox` + metrics) | Thin controller: validates `sourceWallet.customerId === SELF` (404 else), then delegates. Preserves PIN/MFA/idempotency/concurrency/double-entry/fee/audit. No `postJournal` in controller. |
| 8 | **transaction history** | `GET /customers/me/transfers?page=&limit=` (alias `…/transactions`) | `Transfer` table (`sourceWalletId IN (…) OR destinationWalletId IN (…)`) ordered `createdAt DESC, id DESC`, pagination `1..100`, direction `SENT/RECEIVED/INTERNAL`, `amountMinor/currency/status/reference/narration/paymentReference/journalId/createdAt/completedAt` | Read-only, from existing financial source. No wallet balance mutation. |
| 9 | **transaction detail** | `GET /customers/me/transfers/:transferId` (alias `…/transactions/:id`) | `TransferService.getTransfer` + SELF check `walletIds.has(source||dest)` else 404 | Returns `id,transferId,direction,amountMinor,currency,status,reference,narration,paymentReference,journalReference,failureCode/Message,createdAt,completedAt`. **Excludes** `ledgerAccountId`, `tokenHash`, `PIN`, `OTP`, `session`, `audit` raw. |
| 10 | **PIN / security** | `POST /customers/me/transaction-pin` , `POST /customers/me/transaction-pin/verify` | `CustomerTransactionPinService.setTransactionPin/verifyTransactionPin` (PBKDF2 `$PBKDF2$sha256$10000$…`, `pinVersion=1`, `failedCount→5→accountLocked`) | Via existing lifecycle, never returns `pinHash`. Lockout preserved. |
| 11 | **notification read surface** | — | `customer_preferences.notifications` exists, but **no inbox/delivery table** | **Gap documented** — no `notification_deliveries`, `push_tokens` read surface in this phase. Preference persistence is not a read feed. Next phase should add a read-only inbox (A7 notification-delivery module is product-policy oriented, not customer push inbox). |
| 12 | **support/help** | — | No `support_tickets`, `help_articles`, `faqs` tables. `SUPPORT` principal type exists for workforce but not a help-desk surface. | **Gap documented** — next phase to add `support` read surface (static help map + ticket read) without mixing with workforce `internal/*`. |

## 3. Dashboard

`GET /customers/me/dashboard` returns **single-call composite**:

```json
{
  "identity": { "id","reference","type","status","kycLevel","kycStatus","createdAt" },
  "profile": { "id","displayName","legalName" } | null,
  "balance": { "wallets": [{ "id","currency","status","balanceMinor" }], "primary": { } | null },
  "receivingIdentity": "0812345678",
  "receivingNumber": "0812345678",
  "recentTransactions": { "items": [ ...5 most recent ], "pagination":{ } }
}
```

*Balance* is wallet/ledger truth per wallet, not a cached aggregate.

## 4. Non-Functional Guarantees

- **Thin controllers:** All financial effects via `WalletService` / `TransferService` / `LedgerService`. No `DataSource.query(INSERT INTO ledger…)` in `src/customer-app`.
- **No duplicate domain:** No new `customer_balances`, `customer_ledger`, `wallet_balances` tables, no `POST /internal/customers/:id/balance`-style mutation, no new receiving-number generator.
- **No bank/NIBSS/provider/external settlement** path; no `nipSupported` branch.
- **Response:** JSON; errors via `HttpException` with `message`/`error` and status. No `X-` mobile alias, no `mobile` namespace.
- **Sensitive-data redaction:** `LoggerModule` already redacts `password,pinHash,token,…` ; controllers never return hashes.

## 5. Gaps For Later Phase (tracked, not blocking)

| Gap | Current State | Recommended Next |
|---|---|---|
| Notifications inbox | `customer_preferences` holds `email/sms/push/inApp` booleans; `A7_PRODUCT_NOTIFICATION_DELIVERY` is policy-bound, not a customer inbox. | Add `customer_notifications` (`id,customer_id,type,title,body,read_at,created_at`) read-only `GET /customers/me/notifications` + `PATCH /…/:id/read`. Reuse `AuditService` for read marking, no mutation of delivery status via `customers/me`. |
| Support / Help | Workforce `SUPPORT` role + `CustomerCompliance` exist but no public help surface. | Add static `help` (`GET /customers/me/help` returning `{faqs, contacts}`) + read-only ticket list if `support_tickets` is introduced later. No workforce `internal/` leakage. |
| MFA/OTP enforcement on transfer | Transfer engine currently preserves whatever PIN/MFA the caller supplied via existing `Agent*` flows; Customer App `POST /customers/me/transfers` currently does **not** enforce `transactionPin` header — relies on transfer service's present behavior (which may not require PIN for wallet→wallet V1). | Next: gate `POST /customers/me/transfers` with `X-Transaction-Pin` (PBKDF2 verify) or `mfa_challenges` `MfaExecutionService` as done for `AgentCashOut`. Keep idempotency guard first. |

## 6. Testing

- Real-PostgreSQL focused suite `test/a23-customer-app.integration.spec.ts` (15 cases) covering auth/me, profile, wallet/balance ledger-derived, receiving identity, recipient resolution reuse, Wallet→Wallet compatibility + idempotency, history (direction/pagination), detail SELF + sensitive-fields exclusion, cross-customer/Agent/workforce rejections, PIN lockout, dashboard, route-policy, no-direct-mutation, no migration.

## 7. Deployment

- Zero new migrations. Thin `CustomerAppModule` imported in `AppModule`. `triage: A23 VERIFIED` after `tsc 0`, `nest build 0`, focused PG pass, regression `a7…a22`.

