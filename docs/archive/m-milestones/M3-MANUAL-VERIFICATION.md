# M3 Wallet-to-Wallet Transfer Manual Verification

This guide verifies internal wallet-to-wallet transfers on a fresh local installation. It uses only MonieNaija wallets and the existing ledger; no external payment system is involved.

## Prerequisites

Start PostgreSQL, apply migrations, and start the API:

```bash
docker compose up -d postgres
npm run migration:run
npm run start:dev
```

The commands below require `curl` and `jq`.

```bash
set -euo pipefail

BASE_URL="http://localhost:3000/api/v1"
RUN_ID="$(date +%s)"
AMOUNT_MINOR="125000"
```

`125000` NGN minor units is ₦1,250.00.

## 1. Create Wallet A and Wallet B

```bash
WALLET_A_RESPONSE="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/wallets" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: wallet-a-${RUN_ID}" \
    --data @- <<JSON
{
  "customerId": "manual-customer-a-${RUN_ID}",
  "currency": "NGN"
}
JSON
)"

WALLET_B_RESPONSE="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/wallets" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: wallet-b-${RUN_ID}" \
    --data @- <<JSON
{
  "customerId": "manual-customer-b-${RUN_ID}",
  "currency": "NGN"
}
JSON
)"

WALLET_A_ID="$(echo "${WALLET_A_RESPONSE}" | jq -er '.id')"
WALLET_A_LEDGER_ACCOUNT_ID="$(echo "${WALLET_A_RESPONSE}" | jq -er '.ledgerAccountId')"
WALLET_B_ID="$(echo "${WALLET_B_RESPONSE}" | jq -er '.id')"
WALLET_B_LEDGER_ACCOUNT_ID="$(echo "${WALLET_B_RESPONSE}" | jq -er '.ledgerAccountId')"

echo "${WALLET_A_RESPONSE}" | jq .
echo "${WALLET_B_RESPONSE}" | jq .
```

Both wallets should be `ACTIVE` with a `balanceMinor` of `"0"`.

## 2. Fund Wallet A through the existing ledger

Create a synthetic local asset account. This is only a test counterpart account; it does not represent an external settlement integration.

```bash
CASH_RESPONSE="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/ledger/accounts" \
    -H "Content-Type: application/json" \
    --data @- <<JSON
{
  "code": "CASH-NGN-${RUN_ID}",
  "name": "Synthetic NGN cash funding ${RUN_ID}",
  "accountType": "ASSET",
  "currency": "NGN",
  "accountingUnit": "CUSTOMER_FUNDS",
  "allowNegativeBalance": false
}
JSON
)"

CASH_LEDGER_ACCOUNT_ID="$(echo "${CASH_RESPONSE}" | jq -er '.id')"
echo "${CASH_RESPONSE}" | jq .
```

Post a balanced journal that debits the synthetic asset and credits Wallet A:

```bash
FUNDING_RESPONSE="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/ledger/journals" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: funding-${RUN_ID}" \
    --data @- <<JSON
{
  "currency": "NGN",
  "accountingUnit": "CUSTOMER_FUNDS",
  "reference": "manual-funding-${RUN_ID}",
  "lines": [
    {
      "accountId": "${CASH_LEDGER_ACCOUNT_ID}",
      "direction": "DEBIT",
      "amountMinor": "${AMOUNT_MINOR}"
    },
    {
      "accountId": "${WALLET_A_LEDGER_ACCOUNT_ID}",
      "direction": "CREDIT",
      "amountMinor": "${AMOUNT_MINOR}"
    }
  ]
}
JSON
)"

FUNDING_JOURNAL_ID="$(echo "${FUNDING_RESPONSE}" | jq -er '.id')"
echo "${FUNDING_RESPONSE}" | jq .
```

Verify Wallet A has `"125000"` minor units and Wallet B remains at `"0"`:

```bash
curl --fail-with-body -sS "${BASE_URL}/wallets/${WALLET_A_ID}/balance" | jq .
curl --fail-with-body -sS "${BASE_URL}/wallets/${WALLET_B_ID}/balance" | jq .
```

## 3. Transfer funds from Wallet A to Wallet B

```bash
TRANSFER_RESPONSE="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/transfers" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: transfer-${RUN_ID}" \
    --data @- <<JSON
{
  "sourceWalletId": "${WALLET_A_ID}",
  "destinationWalletId": "${WALLET_B_ID}",
  "amountMinor": "50000",
  "currency": "NGN",
  "reference": "manual-transfer-${RUN_ID}",
  "narration": "Wallet-to-wallet verification"
}
JSON
)"

TRANSFER_ID="$(echo "${TRANSFER_RESPONSE}" | jq -er '.id')"
JOURNAL_ID="$(echo "${TRANSFER_RESPONSE}" | jq -er '.journalId')"
echo "${TRANSFER_RESPONSE}" | jq .
```

The transfer must have `status: "COMPLETED"`, a non-null `journalId`, and a `journalReference` matching the supplied reference.

## 4. Verify balances and the ledger journal

```bash
curl --fail-with-body -sS "${BASE_URL}/wallets/${WALLET_A_ID}/balance" | jq .
curl --fail-with-body -sS "${BASE_URL}/wallets/${WALLET_B_ID}/balance" | jq .
curl --fail-with-body -sS "${BASE_URL}/transfers/${TRANSFER_ID}" | jq .
curl --fail-with-body -sS "${BASE_URL}/ledger/journals/${JOURNAL_ID}" | jq .
```

Expected wallet balances:

- Wallet A: `"75000"`
- Wallet B: `"50000"`

The transfer journal must contain exactly two lines:

- Wallet A ledger account: `DEBIT`, `"50000"`
- Wallet B ledger account: `CREDIT`, `"50000"`

The journal must remain balanced.

## 5. Retry the same idempotency key

Repeat the exact transfer request from step 3 with the same `Idempotency-Key` and payload. The response must contain the same `id` and `journalId`; no second transfer or journal should be created.

Changing `amountMinor`, either wallet, currency, reference, or narration while retaining the same key must return HTTP `409`.

## 6. Attempt an overdraft

Attempt to transfer more than Wallet A's remaining balance:

```bash
curl -sS \
  -o /tmp/monienaija-overdraft.json \
  -w "HTTP status: %{http_code}\n" \
  -X POST "${BASE_URL}/transfers" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: overdraft-${RUN_ID}" \
  --data @- <<JSON
{
  "sourceWalletId": "${WALLET_A_ID}",
  "destinationWalletId": "${WALLET_B_ID}",
  "amountMinor": "100000",
  "currency": "NGN",
  "reference": "manual-overdraft-${RUN_ID}"
}
JSON

cat /tmp/monienaija-overdraft.json | jq .
```

The request should return HTTP `422`. Wallet A, Wallet B, and the ledger must remain unchanged by the failed transfer.

## 7. Attempt a self-transfer

```bash
curl -sS \
  -o /tmp/monienaija-self-transfer.json \
  -w "HTTP status: %{http_code}\n" \
  -X POST "${BASE_URL}/transfers" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: self-transfer-${RUN_ID}" \
  --data @- <<JSON
{
  "sourceWalletId": "${WALLET_A_ID}",
  "destinationWalletId": "${WALLET_A_ID}",
  "amountMinor": "1000",
  "currency": "NGN"
}
JSON

cat /tmp/monienaija-self-transfer.json | jq .
```

The request should return HTTP `400`.

## 8. Retrieve Wallet A transaction history

```bash
curl --fail-with-body -sS \
  "${BASE_URL}/wallets/${WALLET_A_ID}/transactions?page=1&limit=20" | jq .
```

Wallet A should show the completed transfer with `direction: "SENT"`. Wallet B should show the same transfer with `direction: "RECEIVED"`:

```bash
curl --fail-with-body -sS \
  "${BASE_URL}/wallets/${WALLET_B_ID}/transactions?page=1&limit=20" | jq .
```

History is newest first and includes pagination metadata.
