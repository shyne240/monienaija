# M5 Controlled Payment Capabilities Manual Verification

This guide verifies the internal deposit and withdrawal lifecycle using synthetic NGN data. It does not connect to a bank, NIBSS, gateway, webhook, or external payment rail.

## Prerequisites

```bash
cp .env.example .env
npm ci
docker compose up -d postgres
npm run migration:run
npm run start:dev
```

The commands below require `curl` and `jq`.

```bash
set -euo pipefail
BASE_URL="http://localhost:3000/api/v1"
RUN_ID="$(date +%s)"
```

## 1. Create a wallet

```bash
WALLET_RESPONSE="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/wallets" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: m5-wallet-${RUN_ID}" \
    --data @- <<JSON
{
  "customerId": "m5-customer-${RUN_ID}",
  "currency": "NGN"
}
JSON
)"

WALLET_ID="$(echo "${WALLET_RESPONSE}" | jq -er '.id')"
WALLET_LEDGER_ACCOUNT_ID="$(echo "${WALLET_RESPONSE}" | jq -er '.ledgerAccountId')"
echo "${WALLET_RESPONSE}" | jq .
```

The wallet should be `ACTIVE` with a zero balance.

## 2. Locate the seeded settlement asset

The M5 migration seeds NGN internal accounts:

- `PAYMENT-SETTLEMENT_ASSET-NGN`
- `PAYMENT-SETTLEMENT_CLEARING-NGN`
- `PAYMENT-SYSTEM_SUSPENSE-NGN`

```bash
SETTLEMENT_ASSET_ID="$(
  curl --fail-with-body -sS "${BASE_URL}/ledger/accounts?currency=NGN" \
    | jq -er '.[] | select(.code == "PAYMENT-SETTLEMENT_ASSET-NGN") | .id'
)"
```

## 3. Fund the settlement asset synthetically

The settlement asset must have a debit-normal balance before a deposit can complete. Create a synthetic equity funding account:

```bash
FUNDING_ACCOUNT_RESPONSE="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/ledger/accounts" \
    -H "Content-Type: application/json" \
    --data @- <<JSON
{
  "code": "M5-EQUITY-NGN-${RUN_ID}",
  "name": "Synthetic M5 NGN funding ${RUN_ID}",
  "accountType": "EQUITY",
  "currency": "NGN",
  "accountingUnit": "CUSTOMER_FUNDS",
  "allowNegativeBalance": true
}
JSON
)"

FUNDING_ACCOUNT_ID="$(echo "${FUNDING_ACCOUNT_RESPONSE}" | jq -er '.id')"
```

Post a journal that funds the settlement asset:

```bash
curl --fail-with-body -sS \
  -X POST "${BASE_URL}/ledger/journals" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: m5-settlement-funding-${RUN_ID}" \
  --data @- <<JSON | jq .
{
  "currency": "NGN",
  "accountingUnit": "CUSTOMER_FUNDS",
  "reference": "m5-settlement-funding-${RUN_ID}",
  "lines": [
    {
      "accountId": "${SETTLEMENT_ASSET_ID}",
      "direction": "DEBIT",
      "amountMinor": "200000"
    },
    {
      "accountId": "${FUNDING_ACCOUNT_ID}",
      "direction": "CREDIT",
      "amountMinor": "200000"
    }
  ]
}
JSON
```

## 4. Create and complete a deposit

Create a pending deposit:

```bash
DEPOSIT_RESPONSE="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/deposits" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: m5-deposit-${RUN_ID}" \
    --data @- <<JSON
{
  "walletId": "${WALLET_ID}",
  "amountMinor": "100000",
  "currency": "NGN",
  "reference": "m5-deposit-reference-${RUN_ID}",
  "narration": "Controlled deposit verification"
}
JSON
)"

DEPOSIT_ID="$(echo "${DEPOSIT_RESPONSE}" | jq -er '.id')"
DEPOSIT_PAYMENT_REFERENCE="$(echo "${DEPOSIT_RESPONSE}" | jq -er '.paymentReference')"
echo "${DEPOSIT_RESPONSE}" | jq .
```

Expected status: `PENDING`. The wallet balance must remain zero while the deposit is pending.

Complete the deposit:

```bash
COMPLETED_DEPOSIT="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/deposits/${DEPOSIT_ID}/complete" \
    -H "Content-Type: application/json" \
    --data '{}'
)"
echo "${COMPLETED_DEPOSIT}" | jq .
```

Expected results:

- Status is `COMPLETED`.
- `paymentReference` starts with `MN` and is globally generated.
- `journalId` is present.
- Wallet balance is `"100000"`.
- The journal debits the settlement asset and credits the wallet.

Retry the completion request. It must return the same completed deposit and must not create another journal:

```bash
curl --fail-with-body -sS \
  -X POST "${BASE_URL}/deposits/${DEPOSIT_ID}/complete" \
  -H "Content-Type: application/json" \
  --data '{}' | jq .
```

## 5. Create and complete a withdrawal

```bash
WITHDRAWAL_RESPONSE="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/withdrawals" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: m5-withdrawal-${RUN_ID}" \
    --data @- <<JSON
{
  "walletId": "${WALLET_ID}",
  "amountMinor": "40000",
  "currency": "NGN",
  "reference": "m5-withdrawal-reference-${RUN_ID}",
  "narration": "Controlled withdrawal verification"
}
JSON
)"

WITHDRAWAL_ID="$(echo "${WITHDRAWAL_RESPONSE}" | jq -er '.id')"
echo "${WITHDRAWAL_RESPONSE}" | jq .
```

Expected status: `PENDING`. Move it through the lifecycle:

```bash
curl --fail-with-body -sS \
  -X POST "${BASE_URL}/withdrawals/${WITHDRAWAL_ID}/process" \
  -H "Content-Type: application/json" | jq .

WITHDRAWAL_COMPLETED="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/withdrawals/${WITHDRAWAL_ID}/complete" \
    -H "Content-Type: application/json"
)"
echo "${WITHDRAWAL_COMPLETED}" | jq .
```

Expected results:

- Status is `COMPLETED`.
- A journal ID is present.
- The journal debits the wallet and credits the settlement asset.
- Wallet balance is now `"60000"`.

Repeating `process` or `complete` must not create another journal. Attempting to complete a `PENDING` withdrawal without processing must return a state-transition error.

## 6. Verify overdraft protection

Create and process a withdrawal larger than the remaining wallet balance:

```bash
OVERDRAFT_RESPONSE="$(
  curl -sS \
    -X POST "${BASE_URL}/withdrawals" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: m5-overdraft-${RUN_ID}" \
    --data @- <<JSON
{
  "walletId": "${WALLET_ID}",
  "amountMinor": "100000",
  "currency": "NGN"
}
JSON
)"
OVERDRAFT_ID="$(echo "${OVERDRAFT_RESPONSE}" | jq -er '.id')"

curl --fail-with-body -sS \
  -X POST "${BASE_URL}/withdrawals/${OVERDRAFT_ID}/process" \
  -H "Content-Type: application/json" | jq .

curl -sS \
  -o /tmp/m5-overdraft-completion.json \
  -w "HTTP status: %{http_code}\n" \
  -X POST "${BASE_URL}/withdrawals/${OVERDRAFT_ID}/complete" \
  -H "Content-Type: application/json"

cat /tmp/m5-overdraft-completion.json | jq .
```

Completion should return HTTP `422`, the withdrawal should be `FAILED`, no journal should be created, and the wallet balance should remain `"60000"`.

## 7. Verify cancellation and failure states

Create a second pending deposit and cancel it:

```bash
CANCEL_DEPOSIT_ID="$(
  curl --fail-with-body -sS \
    -X POST "${BASE_URL}/deposits" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: m5-cancel-deposit-${RUN_ID}" \
    --data "{\"walletId\":\"${WALLET_ID}\",\"amountMinor\":\"1000\",\"currency\":\"NGN\"}" \
    | jq -er '.id'
)"

curl --fail-with-body -sS \
  -X POST "${BASE_URL}/deposits/${CANCEL_DEPOSIT_ID}/cancel" \
  -H "Content-Type: application/json" \
  --data '{"reason":"Manual cancellation verification"}' | jq .
```

The deposit must be `CANCELLED` and must have no journal. Repeating the cancellation is idempotent; completing it afterwards is rejected.

## 8. Verify globally unique payment references

```bash
curl --fail-with-body -sS "${BASE_URL}/deposits?walletId=${WALLET_ID}" | jq 'map(.paymentReference)'
curl --fail-with-body -sS "${BASE_URL}/withdrawals?walletId=${WALLET_ID}" | jq 'map(.paymentReference)'
```

No deposit and withdrawal should share a payment reference.

## 9. Run finance verification

```bash
curl --fail-with-body -sS \
  "${BASE_URL}/internal/reconciliation/report" | jq .

curl --fail-with-body -sS \
  "${BASE_URL}/internal/reconciliation/finance" | jq .
```

Completed deposits and withdrawals must have journals. The report must show no currency or accounting-unit inconsistency. Any failed payment records should be visible as warnings for investigation; they must not have successful journals.
