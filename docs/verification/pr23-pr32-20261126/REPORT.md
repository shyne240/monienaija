# Integration confirmation — PR #23 (Transaction History) and PR #32 (CSV + branded PDF)

Date: 2026-11-26 · Verification branch: `arena/2403241e-monienaija` · **Both PRs left open, unmerged, untouched.**

## 1. Exact tested objects

| Object | Ref | Exact SHA |
| --- | --- | --- |
| Intended integration base | `arena/5-main-web-integration` | `85b8a953eb3563d800f5a50118c4dddbdaf04965` |
| PR #23 head | `arena/19545571-monienaija` | `f9b14d589707989db517bdf0899157fc90a87d87` |
| PR #32 head | `arena/1ca9ab81-monienaija` | `43a9a2ddfc33919d1c0874a8fda7cec7fc3d365d` |
| Base↔#23 merge base | — | `f1a51dd818e1fdca16596351d9c760970dcdc7e4` |
| **#23 integration candidate (tested)** | `git merge 85b8a95 ← f9b14d58` | `a3cb2dc58ebb27c361c93ce5afc88874c20f4e0b` (tree `bf0d5bd6c1c9ed317c64290de2f2289fd8c02c49`) |
| **#32 candidate on that History revision (tested)** | `git merge a3cb2dc5 ← 43a9a2dd` | `42402f1e68177faeeecfd77dab2510e2e2779b87` |

Tree identity check: `git merge-tree 85b8a95 f9b14d58` produced exactly `bf0d5bd6…`, the tree of
`a3cb2dc5`. The #23 candidate is therefore **byte-identical to the merge commit GitHub would create**
for PR #23 (GitHub reports `MERGEABLE`/`CLEAN`), not a hand-edited tree.

The base had moved after #23 branched (merge base `f1a51dd8`, PR #30). The four base-side commits
(`85b8a953`, `ca3cbf4c`, `17086158`, `7e09d13d` — PR #31 compliance/KYC/fraud/support + Admin Web)
auto-merged, including `apps/admin-web/src/screens/authenticated/Layout.tsx` and
`src/authorization/route-policy-registry.ts`. Both were exercised in the real browser runs below.

### PR #32 merge resolution (required — see §5)

`src/admin/admin.module.ts` only. PR #32 was authored on `b6fa3648` and re-declared
`NotificationOperationsService` in `providers`. That service is now provided **and exported** by
`NotificationModule` (ARENA 6 moved it there) and `AdminModule` already imports that module, so the
duplicate declaration was dropped (its own comment warns a second provider forks the delivery-log
aggregate) and all of PR #32's new providers kept: `TransactionHistoryExportService`,
`WalletStatementService`, `WalletStatementRenderService` and the `TRANSACTION_HISTORY_EXPORT_LIMITS`
token. `tsc`, lint, Prettier and the module specs all pass with that resolution.

## 2. Reused vs repeated

| Check | Previous evidence | This turn |
| --- | --- | --- |
| CI on #23 head `f9b14d58` | 2 full workflow runs, all green incl. real PostgreSQL | **Reused** (unchanged; links in §4) |
| CI on #32 head `43a9a2dd` | 2 full workflow runs, all green | **Reused for the PR's own head**, but *does not cover the required History revision* → repeated below |
| #23 live journal round-trip (`JOURNAL-NAVIGATION.md`, Finance25-resolved tree) | resolved `6df5ba3a` + Finance `8301fa2` | **Repeated** on `a3cb2dc5` (Finance now integrated in-tree via `d175c115`) |
| #23 five-product browser matrix | `f9b14d58`-era | **Repeated** on `a3cb2dc5` |
| #32 CSV evidence | `docs/transaction-history-csv/evidence/test-results.md` built on `96bda49` (older #23 revision) | **Repeated** on `42402f1e` |
| #32 statement evidence | authored on `b6fa3648` | **Repeated** on `42402f1e` |

## 3. PR #23 — verdict: **PASS** (ready to merge as-is, from the checks requested)

Tested object `a3cb2dc5` (= PR #23 head merged onto the current base).

**Infrastructure.** Disposable PostgreSQL **18.4** cluster created for this turn on loopback;
**171 migrations from scratch** (`CreateWalletAndLedger1785753600000` → `CaptureCustomerFundingScope1785753600807`);
real `AppModule`; real Admin Web SPA (Vite) and real Chromium; **real workforce email/password
sign-in**. All **11** fixture accounts authenticated; credential hashes and role/function grants
compared byte-for-byte before/after — unchanged. Synthetic records only.

**Wallet Transfer and Bank to Wallet, History → Open journal → back to the same transaction**

| Assertion | Wallet Transfer | Bank to Wallet |
| --- | --- | --- |
| Business reference preserved (list row, detail heading, URL, return link) | `FIN25-WALLET` | `MNFY-0cd87929` |
| Canonical business id | `5ba31bfb-7fdc-4ba9-aab5-ebfcea14bc6c` | `7ec2a085-600f-4fff-9006-7d725535f242` |
| Journal exposed and opened from History | `79382a75-4c98-47f4-b905-3e4ea301f189` | `5e02a6dd-b29d-408c-a88b-b4c8b8f53665` |
| Finance source mapping | `TRANSFER` / `linkedBy: JOURNAL_ID` | `BANK_TO_WALLET` / `linkedBy: DURABLE_INBOUND_LINK` |
| Return link `href` equals the origin URL | `#transaction-history/WALLET_TRANSFER/<id>` — asserted equal to `auditor.url()` after click | `#transaction-history/BANK_TO_WALLET/<id>` — same |
| Same record on return | detail dialog heading = original reference | same |

Screenshots: `journal-open/WALLET_TRANSFER-*.png` and `journal-open/BANK_TO_WALLET-*.png`
(`history-open-journal`, `journal-return-link`, `returned-canonical-detail`, `no-ledger-permission`,
`foreign-detail-denied`, `foreign-journal-denied`). The Bank to Wallet return link resolves the bank
intake UUID through the durable link, not the float receipt or journal UUID.

**Journal access denied without permission.** `OPERATIONS` (holds `transaction.view`, not
`ledger.view`): both `ledger/journals/:id` and `internal/finance-operations/ledger/journals/:id`
answer **403** from the browser's own fetch with the real token; the UI shows
"Ledger information requires ledger.view.", exposes **no** journal UUID and **no** Open journal action.

**Records from another institution remain inaccessible.** After the governed re-scope, `OPERATIONS`
sees **404** on both details (browser shows an alert, never the reference) and a foreign
`FINANCE_PREPARER` gets **404** from both journal APIs and "not found" from the Ledger audit form.

**Supporting suites on `a3cb2dc5`**

- Five-product real-workforce browser matrix: **PASS** (49.5 s), `results.json` records
  `testedCommit: a3cb2dc5…`, `workingTreeClean: true`, 6 list+detail rows / 18 screenshots.
- `test/finance-operations.route-policy.spec.ts` + `…service.spec.ts`: **36/36 pass**.
- Admin Web targeted (`transaction-history-workspace`, `finance-transaction-history-link`,
  `ledger-operations`, `m2-ledger`): 35/36 in the batch; the single failure
  (`m2-ledger › shell navigation protects a ledger reversal draft`, 20 s jest timeout) **passes in
  isolation in 4.7 s** — CPU contention on this 2-vCPU sandbox, not a regression. The same suite
  later ran green in the full 108-suite run at `42402f1e`.

**Disclosed boundaries (unchanged from the PR's own docs).** The Wallet Transfer record is a
synthetic `COMPLETED` transfer plus a balanced journal (read-model fixture); Bank to Wallet uses the
controlled sandbox verifier and sandbox float-policy authority, with a real posted ledger journal.
Neither certifies wallet-transfer execution or an external bank connection.

## 4. PR #32 — verdict: **PASS on the tested resolution; NOT mergeable as-is**

Tested object `42402f1e` = PR #32 merged onto `a3cb2dc5` (the §1 History revision), with the §1
`admin.module.ts` resolution. Every requested check passes **on that tree**; the PR's own head
`43a9a2dd` cannot reach that tree by itself.

### CSV export from a filtered history view

`docs/verification/pr23-pr32-20261126/csv/acceptance.json` — `commit: 42402f1e…`, `browser: true`,
**12/12 checks PASS**, real Chromium sign-in, `Export CSV` clicked on **page 2** of the filtered list.

- Downloaded `browser-download.csv`: **47 data rows**, the exact set the paginated list shows
  (fixture: 47 visible, 9 foreign-institution, 2 outside the Lagos day) — re-verified independently:
  47 rows, **47 distinct `transaction_reference`**, **47 distinct `business_transaction_id`** (each row
  once), all `product = BANK_TO_WALLET`, all `created_at_lagos = 2026-11-24`, 3 export pages at 100.
- Institution scope respected: every row is `ACC-OWN-*`; the 9 foreign rows and both out-of-range
  Lagos rows are **absent**. Plain list scope is per-request (the `FINANCE_AUDITOR` sees the foreign
  institution through the same filters in the integration suite).
- Unauthorized: **403** for a role without `transaction.view` (no CSV body), **401** anonymous, no
  audit row left by the refused principal. Empty result → header-only file; over-size → 413 with a
  narrowing instruction and no file; successful export audited with actor/filters/outcome.

### Branded wallet statement

`docs/verification/pr23-pr32-20261126/statement/acceptance.json` — `commit: 42402f1e…`,
`browser: true`, **12/12 checks PASS**, real browser: sign-in → Customer 360 → wallet drawer →
statement → PDF downloaded and reopened page by page.

Text extracted from the downloaded `browser-download.pdf` (2 pages, A4, pdfjs-dist):

- Brand: **MonieNaija** logo mark + wordmark + "Customer wallet statement" on **every** page,
  repeated header and page numbers (`Page 1 of 2`).
- Selected wallet: customer **Chinedu Adeyemi Okafor**, masked identifier **`•••• DE1E`**
  (`NGN wallet · ACTIVE`) — never the full wallet id.
- Period: **2026-10-01 to 2026-10-31 (Africa/Lagos)**, generated timestamp in Lagos.
- Balances: **Opening NGN 1,257.77** (`125777` minor), **Money in 13,569.60**, **Money out 0.00**,
  **Closing NGN 14,827.37** (`1482737`); closing equals the ledger's balance at the window end and
  equals the next period's opening. Disclosed separately: "Ledger-derived balance at generation
  NGN 14,836.25" (as-of-now, includes post-period postings — intended, and labelled).
- Figures vs synthetic postings: **64 rows** with running balance, starting 1,257.77 → 1,468.13 →
  … → 14,827.37; Lagos-midnight boundary postings land in the correct period.
- Unauthorized: **404** for a foreign-institution operator even with exact customer/wallet ids and a
  valid session (indistinguishable from a wallet that does not exist, no `%PDF`), **401** anonymous
  on both statement routes, **403** for a session lacking `customer.view_wallets` — see the gap in §6.

### Suites and gates on `42402f1e`

| Check | Result |
| --- | --- |
| `test/transaction-history-csv-export.integration.spec.ts` (7 tests) | PASS |
| `test/wallet-statement-pdf.integration.spec.ts` (7 tests) | PASS |
| `npx jest src/admin` | 7 suites / 98 tests PASS |
| Admin Web full suite | **108 suites / 1104 tests PASS** (136.7 s) |
| `npm run lint` | 0 errors (1 pre-existing warning in `test/b9-custom-role.integration.spec.ts`) |
| `npm run format:check` | PASS |
| `npm run build` (Nest) · `tsc --noEmit` + `vite build` (Admin Web) | PASS |

## 5. Current CI links (unchanged PR heads)

PR #23 head `f9b14d589707989db517bdf0899157fc90a87d87` — all checks green, two workflow runs:

- `actions/runs/45814764849` (push) — Backend (real PostgreSQL integration) ✅ 13:43:49Z,
  Backend (isolated PostgreSQL) ✅, Backend (lint/format/build/unit) ✅, Backend (container) ✅,
  Admin Web ✅, Customer Mobile ✅, Agent Mobile ✅
  <https://github.com/shyne240/monienaija/actions/runs/45814764849>
- `actions/runs/45814760348` (pull_request) — same job set, all ✅; real PostgreSQL ✅ 14:26:57Z
  <https://github.com/shyne240/monienaija/actions/runs/45814760348>

PR #32 head `43a9a2ddfc33919d1c0874a8fda7cec7fc3d365d` — all checks green, two workflow runs
(these cover `43a9a2dd` **on its old base**, not on the current #23 head):

- `actions/runs/45785700016` — real PostgreSQL ✅ 10:34:58Z
  <https://github.com/shyne240/monienaija/actions/runs/45785700016>
- `actions/runs/45785691242` — real PostgreSQL ✅ 11:02:57Z
  <https://github.com/shyne240/monienaija/actions/runs/45785691242>

Base `85b8a953eb3563d800f5a50118c4dddbdaf04965` — 8 checks, all ✅ (real PostgreSQL ✅ 13:51:39Z).

No CI exists for `a3cb2dc5` / `42402f1e`: those are local verification merges, not PR heads. They are
committed on `arena/2403241e-monienaija` so the SHAs are fetchable.

## 6. Blockers and residual gaps

**PR #32 is blocked from merging by a real conflict, not by a failing check.** GitHub reports
`CONFLICTING` / `DIRTY` against base `arena/19545571-monienaija`: PR #32 branched at `b6fa3648`, and
`src/admin/admin.module.ts` collides with ARENA 6's relocation of `NotificationOperationsService`.
The merge resolution in §1 is the fix, and everything in §4 passes on it.

- **Blocker:** PR #32's own head does not contain that resolution.
- **First remaining check:** land the `admin.module.ts` resolution on
  `arena/1ca9ab81-monienaija` (or retarget #32 to `arena/5-main-web-integration` after #23 merges),
  then re-run the two browser acceptance scripts and the two integration suites once at the new head
  and read its CI. Nothing else is outstanding.

Secondary gap found in PR #32's own suite (not a product defect, an evidence defect):

- `wallet-statement-pdf.integration.spec.ts › refuses callers without the function…` asserts **401
  anonymous** and **400 malformed** only, and elsewhere accepts `[403, 200]` for a read-only
  principal, although `docs/wallet-statement/README.md` claims "Caller lacks
  `customer.view_wallets` → 403". The behaviour is correct — a `TREASURY` session with an ACTIVE
  assignment to the wallet's institution was probed and returns **403** on both `statement` and
  `statement.pdf` with no `%PDF`, while `OPERATIONS` returns **200** — but that assertion should be
  tightened in the PR rather than left to a probe.
- PR #32's narrative docs still cite `96bda49` / `62a37f3` / `43a9a2dd` as the tested commits; the
  regenerated `acceptance.json` files record `42402f1e`.

No blocker for PR #23. Its own `README.md` release-status section still lists "exact new-head CI must
be explicitly checked" and the historical Finance #25 diagnostic as open gates; this turn closes the
CI check for `f9b14d58` and re-proves the round-trip with Finance integrated in-tree.

## 7. Safety

Synthetic data only; disposable loopback PostgreSQL 18.4 dropped after use; all live providers,
real funds and both mobile apps untouched; no grants, credential hashes, migrations or mobile code
changed; both PRs left open and unmerged with their heads unmodified.
