# Arena 3D — Banking integration continuation record

Durable, tracked continuation record for the **banking provider, settlement, reconciliation and
agent funding** mission. Updated before approaching tool-call limits so completed implementation is
never left in an uncommitted working tree.

**Active branch:** `arena/defdd0fd-monienaija`
**Starting checkpoint:** `5b9cd3e6` (accepted KYC documentation checkpoint; local == remote verified)
**Accepted KYC application checkpoint:** `e9609925`

---

## 1. Baseline verification

| Question                     | Answer                                                 |
| ---------------------------- | ------------------------------------------------------ |
| Local HEAD at mission start  | `5b9cd3e6944d35ed58a8b7c81d315b67616b0499`             |
| Remote HEAD at mission start | `5b9cd3e6944d35ed58a8b7c81d315b67616b0499` (identical) |
| Working tree                 | clean                                                  |
| Frozen branches              | read-only; `arena/5b239ff5` still `004dd800`           |

### 1.1 Accepted KYC baseline preserved

| Gate                   | Result                             |
| ---------------------- | ---------------------------------- |
| Full PostgreSQL matrix | 153/153 suites, 2751 tests, exit 0 |
| Root unit suite        | 257/257 suites, 2981/2981 tests    |
| Isolated KYC sweep     | 11/11 suites, 149/149 tests        |

### 1.2 The 256-versus-257 documentation inconsistency — corrected

Two stale figures existed in `ARENA3D-CONTINUATION-RECORD.md`:

- the §7.4 "where the numbers now stand" table reported **256/256 suites, 2978 tests**, superseded by
  the fixture-race regression test. Corrected to the recorded transcript figure **257/257, 2981**;
- §7.2 recorded 256/2978 as though current. It is correct _for commit `a34574c5` only_, so it is kept
  as history with an explicit "Superseded" note naming the current figure and the cause of the delta.

Both corrections are taken from the recorded transcripts, not from arithmetic.

---

## 2. Migration allocation — decided before any migration was written

The institutional governance sequence occupies `1785753600300`–`1785753600505`. Migrations apply in
filename order and a published identifier is never reused or renumbered.

**Allocation for banking integration: `1785753600600`–`1785753600699`.**

Verified free before use:

```
$ ls src/migrations/ | grep -cE "^17857536006"
0
```

No collision with any published identifier. Every migration added is listed in §6 as it lands.

---

## 3. Provider documentation references

Fetched page content is not persisted, so the contracts that later decisions depend on are recorded
here. `docs.monnify.com` returned **HTTP 522** during this session; nothing was invented to fill the
gap, and anything unconfirmed is marked as such.

| Capability            | Endpoint / contract                                                                                                                                                                                             | Source                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Authentication        | `POST /api/v1/auth/login`, `Authorization: Basic base64(apiKey:secretKey)` → `accessToken`, `expiresIn`                                                                                                         | Monnify docs                                 |
| Reserved account      | `POST /api/v2/bank-transfer/reserved-accounts`                                                                                                                                                                  | Confluence "Reserve An Account (V2)"         |
| Reserved account read | `GET /api/v2/bank-transfer/reserved-accounts/{accountReference}`                                                                                                                                                | Monnify Go SDK constants                     |
| Reserved acct dealloc | `DELETE /api/v1/bank-transfer/reserved-accounts/reference/{accountReference}`                                                                                                                                   | Monnify Go SDK constants                     |
| Reserved acct txns    | `GET /api/v1/bank-transfer/reserved-accounts/transactions?accountReference=&page=&size=`                                                                                                                        | Monnify Go SDK constants                     |
| Reserved acct KYC     | `PUT /api/v1/bank-transfer/reserved-accounts/{accountReference}/kyc-info`                                                                                                                                       | Monnify Go SDK constants                     |
| Bank directory        | `GET /api/v1/sdk/transactions/banks` → `[{name, code, ussdTemplate, baseUssdCode, transferUssdTemplate}]`                                                                                                       | Confluence "Get Banks With USSD Short Code"  |
| Account-name enquiry  | `GET /api/v1/disbursements/account/validate?accountNumber=&bankCode=` → `{accountNumber, accountName, bankCode}`                                                                                                | Monnify OpenAPI                              |
| Single disbursement   | `POST /api/v2/disbursements/single`                                                                                                                                                                             | Monnify Go SDK constants                     |
| Disbursement OTP      | `POST /api/v2/disbursements/single/validate-otp`                                                                                                                                                                | Monnify Go SDK constants                     |
| Transfer status       | `GET /api/v2/disbursements/single/summary?reference=`                                                                                                                                                           | Monnify Go SDK constants                     |
| Transaction status    | `GET /api/v2/transactions/{transactionReference}`                                                                                                                                                               | Monnify Go SDK constants                     |
| Settlement lookup     | `GET /api/v1/transactions/find-by-settlement-reference?reference=`                                                                                                                                              | Monnify Settlements API                      |
| Settlements list      | `GET /api/v1/settlements`                                                                                                                                                                                       | Monnify Settlements API                      |
| Wallet balance        | `GET /api/v1/disbursements/wallet-balance?walletId=` — documented **deprecated**                                                                                                                                | Confluence "Get Wallet Balance (Deprecated)" |
| Refunds               | `POST /api/v1/refunds/initiate-refund`, `GET /api/v1/refunds/{refundReference}`                                                                                                                                 | Monnify "Transaction Refunds"                |
| Webhook               | header `monnify-signature`; events `SUCCESSFUL_TRANSACTION`, `SUCCESSFUL_DISBURSEMENT`, `FAILED_DISBURSEMENT`, `REVERSED_DISBURSEMENT`, `SETTLEMENT`, `SUCCESSFUL_REFUND`, `FAILED_REFUND`, `LOW_BALANCE_ALERT` | developers.monnify.com/docs/webhooks         |

### 3.1 Four documented caveats that shape the implementation

These separate an integration that works against the docs from one that works against the provider.
Each is encoded in the adapter rather than assumed:

1. **The webhook signature prose is wrong.** The docs say `SHA-512(client secret + request body)`.
   Monnify's own published example hash only reproduces as **`HMAC-SHA512(key = client secret,
message = raw body)`**. Implementing the prose yields a check that never passes. The adapter
   implements HMAC-SHA512 over the **raw bytes** and proves it against the documented example digest.
2. **Sandbox webhooks carry no signature header.** Production does. Requiring the header
   unconditionally makes sandbox untestable; permitting its absence unconditionally is a forgery hole
   in production. The adapter treats a missing signature as **invalid** in `production` always, and in
   sandbox accepts it only from the controlled fixture transport.
3. **The per-payload `transactionHash` is a different scheme.**
   `SHA512(clientSecret|paymentReference|amountPaid|paidOn|transactionReference)`, pipe-separated, no
   spaces. It is **not** the `monnify-signature` header and the two are never substituted for
   one another.
4. **A HTTP 200 with `requestSuccessful:false` is a provider rejection.** Status is read from
   `responseCode`/`responseMessage`, never inferred from the HTTP status.

Further constraints: `wallet-balance` is documented **deprecated** (advertised, flagged deprecated,
nothing financial depends on it); disbursement is **two-factor**, so an OTP challenge is _not_ an
accepted transfer; and reserved accounts and disbursements are merchant products — agency-banking
float custody and third-party wallet issuance are separately regulated and are **not** claimed.

### 3.2 Commercial boundary

The product owner is pursuing provider activation. That is **not** evidence of commercial
entitlement, financial licensing, or institutional approval, and nothing here asserts otherwise.
Alternative providers (Anchor, Paystack) are referenced only to justify the provider-independent
boundary; **no speculative alternative-provider contract is implemented.**

---

## 4. Implementation groups

| #   | Group                                                      | State       |
| --- | ---------------------------------------------------------- | ----------- |
| 1   | Provider capability contracts + registry                   | in progress |
| 2   | Monnify transport, auth, token coordination, error mapping | pending     |
| 3   | Banking provider governance (protected, maker/checker)     | pending     |
| 4   | Bank directory + account-name enquiry                      | pending     |
| 5   | Virtual account provisioning lifecycle                     | pending     |
| 6   | Webhook ingestion + signature verification                 | pending     |
| 7   | Inbound deposits (A7 integration)                          | pending     |
| 8   | Outbound transfers (A6) + durable dispatch                 | pending     |
| 9   | Transfer status + financial recovery                       | pending     |
| 10  | Fees and charges                                           | pending     |
| 11  | Settlement verification                                    | pending     |
| 12  | Reconciliation engine + exception management               | pending     |
| 13  | Admin banking workspace                                    | pending     |
| 14  | Customer mobile banking                                    | pending     |
| 15  | Agent mobile banking                                       | pending     |
| 16  | KYC residual machine code                                  | pending     |
| 17  | Consolidated acceptance                                    | pending     |

---

## 5. Tests executed

| Suite                                    | Result | Command                                                                                         |
| ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `banking-provider-registry.unit.spec.ts` | 6/6    | `npx jest --config jest.config.js --runTestsByPath test/banking-provider-registry.unit.spec.ts` |
| `monnify-token-manager.unit.spec.ts`     | 14/14  | `npx jest --config jest.config.js --runTestsByPath test/monnify-token-manager.unit.spec.ts`     |

**A real defect the error-mapping tests caught.** The credential scrubber used `\S+`, which stops at
the first space. `authorization: Bearer abc.def` was therefore rewritten to
`[REDACTED] abc.def` — the credential **survived**, and the output looked sanitised, which is worse
than not scrubbing because it stops anyone looking. The pattern now consumes an optional scheme word
plus the whole token run. This is exactly the class of bug that a test written against the intended
behaviour catches and a code review does not.

The registry tests are not decoration — two of them encode rules that are otherwise easy to erode:

- a provider that **advertises** `OUTBOUND_TRANSFER_SUBMIT` without implementing
  `submitOutboundTransfer` is refused at registration, so the failure cannot surface at 3am during a
  real transfer;
- `require('unknown')` throws and `supports()` returns false. There is deliberately **no** `getAny()`
  or fallback, because silently rerouting to a different provider is the one thing this architecture
  must never do.

## 6. Migration inventory

| Migration                                 | Purpose                                                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1785753600600-BankingProviderGovernance` | protected banking-provider configuration: heads, proposals, append-only versions, protected decision evidence, immutable-approved-record triggers, and emergency operational disablement |

Within the reserved allocation `1785753600600`–`1785753600699`; no published identifier was reused.
Verified to apply by running the full real migration chain (the PG template database is built by
running every migration), then exercised structurally by
`banking-provider-governance-schema.integration.spec.ts`.

## 7. Remaining implementation

All groups 1–17.

## 8. Exact next action

Next: **Group 6 — webhook signature verification**, then the Monnify capability methods
(bank directory, account-name enquiry, reserved accounts, disbursement, status, settlement) on top
of the transport now in place, followed by **Group 3 — protected banking governance** (migrations
`1785753600600`+), virtual accounts, inbound/outbound lifecycles and reconciliation.

### 8.1 What is landed and safe

| Commit     | Content                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6dd25a1d` | Banking continuation record, migration allocation `1785753600600-0699` verified free, provider contracts recorded, 256/2981 documentation figure corrected |
| `afa50a11` | Provider capability contracts + registry (6 tests)                                                                                                         |
| `0f418084` | Normalized Monnify errors + coordinate token refresh (14 tests)                                                                                            |
| `d5869436` | Hardened transport + exact-segment path allowlist (9 tests)                                                                                                |

All pushed; local == remote verified after each. 29/29 banking unit tests pass; eslint, prettier and
tsc clean on every banking file.

### 8.2 Two real defects already caught by those tests

Worth carrying forward because they show the test strategy is working:

1. the credential scrubber's `\S+` left `Bearer abc.def` intact after `[REDACTED]`, so a leaked token
   would have looked sanitised;
2. the path allowlist accepted `/validateX` by prefix, and then refused the legitimate reserved-account
   reference path — one bypass and one false negative in the same matcher.

## 9. Genuine external blockers

| Blocker                              | Consequence                                                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs.monnify.com` returned HTTP 522 | Contracts recorded from official Confluence pages, the Monnify OpenAPI description and Monnify's own SDK constants (§3). No endpoint invented; unconfirmed items are marked unconfirmed. |
| No provider credentials              | No sandbox or live call is made. Every provider interaction in acceptance uses controlled fixtures.                                                                                      |
| No commercial entitlement            | Production activation blocked; see §3.2.                                                                                                                                                 |
