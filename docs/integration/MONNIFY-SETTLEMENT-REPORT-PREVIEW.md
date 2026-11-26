# Arena 10 — Monnify settlement report upload and preview

**Status:** read-only preview implemented in the Admin Web Finance Reconciliation workspace. Draft PR work is **not merged**. No production toggle, balance, journal, transfer, refund, staff account, password, grant or audit history was changed.

## 1. Exact SHAs fetched and inspected

| Item | Exact SHA | Notes |
| --- | --- | --- |
| `arena/5-main-web-integration` (target integration branch) | `aa8b1cf47c80e865a18934cdab46aa66fedbad3c` | `git fetch origin arena/5-main-web-integration`; `FETCH_HEAD` and local branch `HEAD` both equal this SHA. This is also the branch base recorded for this session. |
| Current work branch `arena/3b4f687e-monienaija` at start | `aa8b1cf47c80e865a18934cdab46aa66fedbad3c` | Branch note and `git rev-parse HEAD` agree. |
| PR #40 `arena/27ec64e3-monienaija` head | `f59a1c87833a892524bc559f9a4a5d8d220bcaba` | `gh pr view 40` reports **OPEN / DRAFT**, base `arena/5-main-web-integration`. Inspected read-only; not merged, rebased or copied. |
| `origin/main` | `39a9e504e3881911c94438321e7c60f771469d21` | Fetched for context only. |

PR #40 explicitly remains open and unmerged. It is a dependency for the final deposit-to-journal check in §7; **that check has not been run** because its code is not yet on the target branch.

## 2. Official sources and sample availability

### 2.1 Sources used

- [Downloading your transaction reports — Monnify Knowledge Base](https://support.monnify.com/topics/help-and-account-settings-263) — dashboard paths for Collections (`Transactions → Export CSV`), Payouts (`Transfers → Export CSV`), Settlements (`Settlement → Export Settlements → start/end date → Export Transaction`) and wallet statement (`Balances → Download Statement`). It documents that all report types except settlements can be date-filtered, and that a wallet statement shows a settlement rather than each underlying transaction.
- [Reconciliation — Monnify developer docs](https://developers.monnify.com/docs/collections/manage-payments/reconciliation) — two layers (transaction-level and settlement-level), matching on `paymentReference`, `amountPaid` vs expected amount, `paymentStatus`, and comparing `settlementAmount` to the wallet/bank credit. It explicitly says `amountPaid` is gross and `settlementAmount` is net.
- [Settlements — Monnify developer docs](https://developers.monnify.com/docs/settlements) — settlement destination is a Monnify wallet or an external bank account; retrieval by settlement reference or transaction reference; settlement webhook.
- [Webhook Event Types — Monnify developer docs](https://developers.monnify.com/docs/webhooks/event-types) — documented field names for successful collection, disbursement, reversed disbursement and settlement notifications, including `sessionId`.
- [References and Statuses: Payment Collections](https://support.monnify.com/topics/integrating-monnify-244/references-and-statuses-payment-collections-599) and [References and Statuses: Payouts](https://support.monnify.com/topics/integrating-monnify-244/references-and-statuses-payouts-disbursements-600) — authoritative reference names and status values.
- [Get Transactions By Settlement Reference](https://teamapt.atlassian.net/wiki/spaces/MON/pages/223149907/Get+Transactions+By+Settlement+Reference) and [Get Status Of Transaction](https://teamapt.atlassian.net/wiki/spaces/MON/pages/212008662) are used only as examples of documented response envelopes; the preview does not call either endpoint.

### 2.2 Redacted sample search — result

No redacted dashboard export sample was available:

- Connected Google Drive: `search_files` for `Monnify` in name or full text returned **0 files**; the full file listing returned 18 unrelated files and 0 shared drives.
- Repository: no Monnify `.csv`/`.xlsx` report, no settlement CSV/XLSX fixture and no redacted dashboard export exists at the base SHA.
- Monnify's public pages provide documented JSON payloads and screenshots, not a downloadable redacted CSV with a header row.

Therefore **dashboard CSV layouts are unverified**. The preview refuses CSV with `UNVERIFIED_CSV_FORMAT`; it never guesses a header, column order or reference position. The documented JSON envelopes below are the only confirmed formats implemented.

## 3. Actual fields in the confirmed documented formats

These are field names from Monnify's official documentation, not invented CSV headers.

### 3.1 Collections — `SUCCESSFUL_TRANSACTION` / `GET /api/v1/merchant/transactions/search`

`eventType`, `eventData` with `product.reference`, `product.type`, `transactionReference`, `paymentReference`, `paidOn`, `paymentDescription`, `metaData`, `paymentSourceInformation[]` (`bankCode`, `amountPaid`, `accountName`, `sessionId`, `accountNumber`), `destinationAccountInformation` (`bankCode`, `bankName`, `accountNumber`), `amountPaid`, `totalPayable`, `cardDetails`, `paymentMethod`, `currency`, `settlementAmount`, `paymentStatus`, `customer` (`name`, `email`). API status responses also show `accountDetails` and `accountPayments[]`, both of which can carry `sessionId`.

Documented `paymentStatus` values: `PAID`, `OVERPAID`, `PARTIALLY_PAID`, `PENDING`, `UNDERPAID`, `REFUNDED`, `ABANDONED`, `CANCELLED`, `FAILED`, `REVERSED`, `EXPIRED`. `PAID` is confirmation.

### 3.2 Payouts — `SUCCESSFUL_DISBURSEMENT` / `FAILED_DISBURSEMENT` / `REVERSED_DISBURSEMENT`

`eventType`, `eventData` with `amount`, `transactionReference`, `fee`, `transactionDescription`, `destinationAccountNumber`, `sessionId`, `createdOn`, `destinationAccountName`, `reference`, `destinationBankCode`, `completedOn`, `narration`, `currency`, `destinationBankName`, `status`.

Documented status values: `SUCCESS`, `FAILED`, `PENDING`, `IN_PROGRESS`, `REVERSED`, `PENDING_AUTHORIZATION`, `PENDING_BATCH_AUTHORIZATION`. `SUCCESS` is confirmation.

### 3.3 Settlements — `SETTLEMENT` / settlement retrieval

`eventType`, `eventData` with `amount`, `settlementTime`, `settlementReference`, `destinationAccountNumber`, `destinationBankName`, `destinationAccountName`, `transactionsCount`, `transactions[]`. Each included transaction carries `product`, `transactionReference`, `paymentReference`, `paidOn`, `paymentDescription`, `accountPayments[]`, `amountPaid`, `totalPayable`, `accountDetails`, `cardDetails`, `paymentMethod`, `currency`, `paymentStatus`, `customer`. Some documented settlement payloads also carry `destinationBankCode`; the adapter reads it when present and reports its absence otherwise.

### 3.4 References available for matching

| Reference | Where present | How this preview uses it |
| --- | --- | --- |
| Provider transaction reference | `transactionReference` in collections, payouts and settlement's included transactions | Primary transaction key. Matched to internal `providerTransactionReference` or durable `businessReference`. |
| Settlement reference | `settlementReference` on settlement rows only | Batch key for **net settlement → actual destination statement** only. Never treated as a transaction identifier. |
| NIP session ID | `sessionId` in collection `paymentSourceInformation[]`, `accountDetails`, `accountPayments[]`, and top-level payout `sessionId` | Secondary transaction key, used only when actually present. Its source field is displayed. Not assumed to exist in CSV. |
| Merchant reference | `paymentReference` (collections) / `reference` (payouts) | Secondary key; mapped to internal `reference`/`businessReference`. Under PR #40 this includes `B2W-<sha256(provider|environment|provider transaction reference|institution|receiving account)>`. |

PR #40's durable reference and journal metadata (`bankIntakeId`, `businessReference`, `ledger_transaction_id`, immutable intake UUID) were read from its head at `f59a1c87833a892524bc559f9a4a5d8d220bcaba`. No #40 implementation was copied into this branch; the internal snapshot contract only expects those reference field names.

### 3.5 Exact exports needed to verify CSV formats

1. **Collections CSV** — Monnify dashboard → **Transactions → Export CSV**, date range selected, redacted while retaining `paymentReference`, `transactionReference`, `paymentStatus`, `amountPaid`, `totalPayable`, `settlementAmount`, `paidOn`, `currency`, `paymentMethod` and `sessionId` where present.
2. **Payouts CSV** — dashboard → **Transfers → Export CSV**, date range selected, redacted while retaining `reference`, `transactionReference`, `sessionId`, `amount`, `fee`, `status`/`transactionStatus`, `currency`, `createdOn`, `completedOn`, `destinationAccountNumber`, `destinationBankCode`, `destinationAccountName` and `destinationBankName`.
3. **Settlements CSV** — dashboard → **Settlement → Export Settlements**, start and end date, then **Export Transaction**, redacted while retaining `settlementReference`, `settlementTime`, `amount`, `transactionsCount`, destination account/bank fields and the included transaction rows.

Until each file is supplied, that CSV format stays **unverified**; only the documented JSON envelopes above are accepted.

## 4. What was built

- `apps/admin-web/src/services/settlement-preview/types.ts` — provider-neutral rows, internal records, statement lines and results.
- `apps/admin-web/src/services/settlement-preview/monnify-adapter.ts` — Monnify-only format detection, field normalisation, observed-column capture, content fingerprint and CSV refusal. Registry hook `registerAdapter` exists for a future NIBSS adapter; NIBSS is **not** registered.
- `apps/admin-web/src/services/settlement-preview/matching.ts` — shared, provider-agnostic matcher: provider transaction reference → NIP session ID → merchant reference → settlement-reference-plus-amount; amount/status/currency checks; duplicate-upload detection; ambiguous candidates; separate net settlement-to-statement matching including destination account and batch composition.
- `apps/admin-web/src/services/settlement-preview/internal-snapshot.ts` — strict local validation for redacted/synthetic internal and statement snapshots.
- `apps/admin-web/src/screens/authenticated/ProviderReportPreviewPanel.tsx` — new **Provider Report Preview** tab in the existing Independent Reconciliation & Breaks Desk. Displays observed fields, matched/unmatched rows, amount/status mismatches, duplicate uploads, ambiguous matches, net settlement results and a Finance review queue. No write action is offered.
- `apps/admin-web/src/services/settlement-preview/synthetic-fixtures.ts` — clearly labelled synthetic example used by the UI and tests. No real customer, account, transaction or journal is represented.

Transaction matching and net settlement matching are deliberately separate: a perfect transaction match with no statement is `NOT_PERFORMED` for settlement, and `reconciliationEstablished` is always `false` for a preview.

## 5. Safety and permissions

- The preview reads local files into memory. It imports no API client, calls no endpoint, changes no balance, posts no journal, retries no transfer, initiates no refund and resolves no break. Tests assert `ApiClient.post`/`delete` are never called.
- The tab is gated on `reconciliation.view`; without it the file inputs are not rendered.
- Existing institution scope, staff permissions, role-function grants, 11 workforce accounts and passwords are untouched: no backend, migration, seed or auth file was modified.
- Audit history is untouched; no file upload is written to the server or to Drive.
- CSV is rejected rather than parsed heuristically; unverified format claims are not made.

## 6. Tests and evidence

Run from this worktree at the final code state:

| Check | Command | Result |
| --- | --- | --- |
| Admin Web type check | `npx --prefix apps/admin-web tsc --noEmit -p apps/admin-web/tsconfig.json` | PASS (no output) |
| Focused adapter/matcher and UI tests | `cd apps/admin-web && npx jest --runInBand __tests__/settlement-report-matching.test.ts __tests__/settlement-report-preview.test.tsx` | 2 suites / 11 tests PASS |
| Full Admin Web suite | `cd apps/admin-web && npx jest --runInBand` | **109 suites / 1100 tests PASS** |
| Admin Web production build | `cd apps/admin-web && npx vite build` | PASS (existing chunk-size warning only) |

Focused coverage includes documented collection/payout/settlement envelope mapping, documented amount conversion, NIP session extraction, CSV refusal with exact export names, matched / unmatched / mismatch / ambiguous / duplicate outcomes, net settlement matched vs `NOT_PERFORMED`, registry extension for a future NIBSS adapter, permission gating and absence of mutating API calls.

Not run: live Monnify API, live dashboard export, real bank statement, physical device/emulator, PostgreSQL integration suites (no backend code changed).

## 7. Remaining dependency — one Monnify deposit, report row → transaction → ledger journal

This check is **blocked, not claimed**. PR #40 head `f59a1c87833a892524bc559f9a4a5d8d220bcaba` is still a draft, and the target integration branch is still `aa8b1cf47c80e865a18934cdab46aa66fedbad3c`. Once #40 is available on `arena/5-main-web-integration`, the verification must use a synthetic deposit and record the new exact SHAs:

1. Post one Bank → Wallet deposit through #40's `BankToWalletService.verifyAndPost` with a deterministic in-memory Monnify transport and a synthetic provider transaction reference.
2. Capture the provider row from a documented collections envelope (`transactionReference`, `paymentReference`, `amountPaid`, `settlementAmount`, `sessionId` if supplied).
3. Upload that row plus a scoped internal snapshot to the preview and assert exactly one `MATCHED` transaction with amount, currency and status agreement.
4. Read the MonieNaija transaction by the durable `B2W-…` business reference / immutable intake UUID and confirm `resolution_state=CREDITED`, `ledger_transaction_id` and journal metadata `bankIntakeId`/`businessReference`.
5. Confirm the posted ledger journal is balanced, institution-scoped and that Finance journal → source returns to the same transaction detail.
6. Record whether the net settlement was actually observed for the configured destination; if not, leave settlement `NOT_PERFORMED` rather than treating the deposit match as settlement.

No result from those steps exists on this branch. PR #40's own evidence (`docs/integration/BANK-TO-WALLET-MONNIFY-PROVENANCE.md`, `bank-to-wallet-history-compatibility/results.json`) is a separate draft's claim at its own SHA and is not reused as this branch's proof.
