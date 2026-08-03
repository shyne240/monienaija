# MonieNaija Wallet and Ledger Backend

Production-oriented NestJS backend for MonieNaija. The verified backend foundation now includes customer wallet accounts, a double-entry ledger, internal wallet-to-wallet transfers, controlled internal deposits and withdrawals, non-money-moving expanded financial product tooling, and database-backed operational resilience. Identity, authentication, KYC, external payment rails, external synchronization, settlement, and later financial products remain outside this milestone.

## Architecture

- **NestJS 11** with the **Fastify** HTTP adapter and strict TypeScript.
- **PostgreSQL** through TypeORM, with schema synchronisation disabled and migrations required for every schema change.
- **Wallet accounts** hold an opaque customer reference, ISO currency, lifecycle status, and a one-to-one customer-funds liability ledger account. Wallet balances are calculated from posted ledger lines; there is no direct balance mutation.
- **Double-entry ledger** consists of a chart of accounts, immutable posted journals, and immutable debit/credit lines. Each journal must contain at least two positive lines and equal debit and credit totals in one currency and accounting unit.
- **Wallet-to-wallet transfers** execute a transfer record and its balanced ledger journal in one serializable PostgreSQL transaction. Wallet balances remain derived from ledger lines.
- **Controlled payments** provide internal deposit and withdrawal lifecycles backed by system settlement accounts and ledger journals.
- **Integer minor units** are used for money. API monetary values are strings so PostgreSQL `BIGINT` values cannot be rounded by JSON or JavaScript numbers.
- **Idempotent commands** require an idempotency key. Journal, transfer, and quote requests are fingerprinted so reusing a key with a different command is rejected.
- **Database controls** enforce positive line amounts, valid currencies and directions, foreign-key ownership, journal balance at transaction commit, and immutability of posted journals and lines.
- `/api/v1` is the global API prefix. The existing validation pipe, structured error contract, request logging, and health endpoints remain installed.

## Prerequisites

- Node.js 22 or later
- npm 10 or later
- Docker Engine with Docker Compose v2 (for local PostgreSQL)

## Local setup

1. Create the local environment file:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   npm ci
   ```

3. Start PostgreSQL and wait for its health check:

   ```bash
   docker compose up -d postgres
   docker compose ps
   ```

4. Run all pending migrations:

   ```bash
   npm run migration:run
   ```

5. Start the API:

   ```bash
   npm run start:dev
   ```

The service binds to `0.0.0.0:3000` by default. Change `PORT` in `.env` when required.

## Environment configuration

Use `.env.example` as the complete local reference. These database values are required and are validated before Nest starts:

- `DB_HOST`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

`DB_PORT`, `PORT`, `NODE_ENV`, log level, and SSL controls have validated defaults. `DB_SSL` and `DB_SSL_REJECT_UNAUTHORIZED` must be the literal strings `true` or `false`. Never commit a real `.env` file or production credentials.

## Wallet and ledger API

All routes below are prefixed with `/api/v1`. These routes are the domain contract for this milestone. Authentication and privileged-operation authorisation are intentionally not implemented until the identity/access domain exists; the ledger posting and chart-of-accounts routes must therefore be treated as internal development operations, not a public production surface.

### Create a customer wallet

`POST /wallets` requires an `Idempotency-Key` header (or `idempotencyKey` in the body):

```json
{
  "customerId": "customer-reference",
  "currency": "NGN"
}
```

The operation atomically creates an active customer wallet and its customer-funds liability account. A customer has at most one wallet per currency. The initial `balanceMinor` is `"0"`.

`GET /wallets/:walletId` returns the wallet and its ledger-derived balance. `GET /wallets?customerId=...` lists a customer's wallets. `GET /wallets/:walletId/balance` is an equivalent balance read for channel code that needs an explicit balance route.

### Create ledger accounts

`POST /ledger/accounts` creates a non-wallet chart-of-accounts account. A normal balance is derived from the account type and cannot be overridden inconsistently:

```json
{
  "code": "CASH-NGN",
  "name": "NGN settlement cash",
  "accountType": "ASSET",
  "currency": "NGN",
  "allowNegativeBalance": false
}
```

`GET /ledger/accounts`, `GET /ledger/accounts/:accountId`, and `GET /ledger/accounts/:accountId/balance` expose ledger-owned account reads.

### Post a balanced journal

`POST /ledger/journals` requires an `Idempotency-Key` header (or `idempotencyKey` in the body):

```json
{
  "currency": "NGN",
  "reference": "controlled-funding-operation",
  "lines": [
    {
      "accountId": "00000000-0000-4000-8000-000000000001",
      "direction": "DEBIT",
      "amountMinor": "125000"
    },
    {
      "accountId": "00000000-0000-4000-8000-000000000002",
      "direction": "CREDIT",
      "amountMinor": "125000"
    }
  ]
}
```

Every line amount is a positive integer in minor units (for NGN, kobo). The ledger validates account existence, active status, currency and accounting-unit compatibility, exact debit/credit equality, and non-negative customer-funds accounts. `GET /ledger/journals/:journalId` returns the immutable journal and lines. `POST /ledger/journals/:journalId/reversal` creates a compensating journal linked to the original; it never edits the original record.

## Wallet-to-wallet transfers

`POST /transfers` creates an internal wallet-to-wallet transfer. It requires an `Idempotency-Key` header and accepts integer minor units:

```json
{
  "sourceWalletId": "wallet-a-uuid",
  "destinationWalletId": "wallet-b-uuid",
  "amountMinor": "50000",
  "currency": "NGN",
  "reference": "customer-transfer-001",
  "narration": "Wallet-to-wallet transfer"
}
```

The transfer service locks both wallets in deterministic order, validates their active status and currency, and posts a debit to the source wallet and a credit to the destination wallet through the existing ledger. The transfer record and journal commit or roll back together. `GET /transfers/:transferId` returns the transfer and journal references. `GET /wallets/:walletId/transactions?page=1&limit=20` returns newest-first sent and received transfer history.

See [docs/M3-MANUAL-VERIFICATION.md](docs/M3-MANUAL-VERIFICATION.md) for a complete local transfer verification sequence.

## M4 finance verification

The internal-only reconciliation and finance verification routes are available under `/api/v1/internal/reconciliation`. They independently check ledger integrity, wallet/account ownership, transfer journal references, currency/accounting-unit consistency, trial balance, assets, liabilities, conservation, and account activity. See [docs/M4-FINANCE-VERIFICATION.md](docs/M4-FINANCE-VERIFICATION.md) for the reconciliation, failure-recovery, and disaster-recovery checklist.

## Controlled deposits and withdrawals

M5 exposes internal-only payment lifecycle endpoints:

- `POST /deposits` and `GET /deposits/:depositId`
- `POST /deposits/:depositId/complete`, `/fail`, and `/cancel`
- `POST /withdrawals` and `GET /withdrawals/:withdrawalId`
- `POST /withdrawals/:withdrawalId/process`, `/complete`, `/fail`, and `/cancel`

Creation requires an `Idempotency-Key`. Deposits and withdrawals generate globally sequenced payment references. Only completed deposits and withdrawals create ledger journals; pending, failed, and cancelled operations do not mutate wallet balances. See [docs/M5-MANUAL-VERIFICATION.md](docs/M5-MANUAL-VERIFICATION.md) for the controlled local verification sequence.

## M6 expanded financial products

M6 adds non-money-moving internal capabilities for virtual accounts, beneficiaries, the bank directory, immutable payment quotes, pure fee calculations, and pure limit evaluations:

- `POST/GET /virtual-accounts`, lookup, and deactivation routes.
- `POST/GET/PATCH/DELETE /beneficiaries`.
- `POST/GET/PATCH/DELETE /banks` with search and status filtering.
- `POST/GET /quotes` and quote-use lifecycle.
- `POST /fees/calculate`.
- `POST /limits/evaluate`.

Virtual-account and quote references use the shared payment-reference generator. These APIs do not execute payments, mutate wallet balances, or call external providers. See [docs/M6-MANUAL-VERIFICATION.md](docs/M6-MANUAL-VERIFICATION.md) for the verification sequence.

## M7 scale and resilience

M7 adds PostgreSQL-backed operational resilience primitives without Redis, Kafka, RabbitMQ, or background workers:

- Distributed idempotency records with retention, replay detection, hash validation, and cleanup.
- Immutable audit events.
- Transactional outbox storage with pending, published, failed, and retry states.
- Database-backed operational metrics.
- Internal diagnostics and expanded readiness checks.

Internal routes are available at `/api/v1/internal/metrics`, `/api/v1/internal/diagnostics`, `/api/v1/internal/audit`, and `/api/v1/internal/outbox`. See [docs/M7-MANUAL-VERIFICATION.md](docs/M7-MANUAL-VERIFICATION.md) for the operational checklist.

## Health endpoints

| Endpoint                   | Meaning                                                             | Expected response                          |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `GET /api/v1/health`       | Liveness: the HTTP process is running. Does not query dependencies. | `200 { "status": "ok", "timestamp": "…" }` |
| `GET /api/v1/health/ready` | Readiness: PostgreSQL can be queried.                               | `200` when ready; `503` when unavailable.  |

## Quality commands

```bash
npm run lint
npm run format:check
npm test
npm run build
```

## Database migrations

TypeORM schema synchronisation is permanently disabled. Use migrations for every future schema change:

```bash
npm run migration:generate -- src/migrations/MeaningfulChange
npm run migration:run
npm run migration:revert
```

The wallet, ledger, transfer, controlled-payment, expanded-financial-product, and operational-resilience migrations are intentionally reversible. The M7 migration adds no external service dependency and stores only operational state. Review generated migrations, test upgrade and rollback behaviour on representative synthetic data, and never alter a migration that has been applied to a shared environment.

## Operational and scope notes

- Posted journal headers and lines are immutable at both the application and database layers. Corrections use linked compensating journals.
- Wallet balances are derived from the ledger source of truth; no controller or service directly updates a balance column.
- `customerId` is an opaque reference. Customer identity, authentication, KYC, limits, fees, reconciliation operations, and external payment orchestration are not part of this change.
- Transfers, controlled deposits/withdrawals, and M6 verification/configuration tools are internal only. Bank rails, NIBSS, cards, QR, USSD, notifications, external synchronization, AML, external settlement, webhooks, reporting, and background jobs are not part of this milestone.
- Do not use real customer data or credentials in local or automated tests. Production release still requires the governance, finance, risk, security, reconciliation, and operational evidence described by the repository documentation.

## Container image

A production-oriented `Dockerfile` is included. Build it after producing a lockfile-consistent dependency install:

```bash
docker build -t monienaija-backend:local .
```

Supply the required environment variables through your deployment platform or an approved secret manager. The image deliberately contains no `.env` file.
