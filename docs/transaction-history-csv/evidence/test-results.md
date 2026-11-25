# Test results — CSV export

Real-PostgreSQL evidence for the transaction history CSV export, regenerated on PR #23 head
`96bda49166e27add2d51799eda47f9be374a7bfe` after the export branch was rebased onto it.
Environment: disposable PostgreSQL 18 (`embedded-postgres`, port 55440/55441), fully migrated
schema, real `AppModule`, real local workforce email/password sign-in. The code commit these runs
were made against is recorded as `commit` in `acceptance.json`; it is an ancestor of this PR's head.

| Command | Result |
| --- | --- |
| `npx jest --config jest.integration.config.js --runInBand test/transaction-history-csv-export.integration.spec.ts` | **7 tests passed.** |
| `LD_LIBRARY_PATH=… node scripts/transaction-history-csv-export-acceptance.cjs --browser` | **12 checks passed**, Chromium download reconciled. |
| `npx jest --config jest.config.js src/admin` | **5 suites, 65 tests passed.** |
| `npm test --prefix apps/admin-web` | **99 suites, 1007 tests passed.** |
| `npm run build` (Nest) and `npm run build --prefix apps/admin-web` | PASS. |
| `npm run ts:check --prefix apps/admin-web`, `npx tsc --noEmit` | PASS. |
| `npx eslint src/admin test/transaction-history-csv-export.integration.spec.ts` | PASS. |
| `git diff --check` | PASS. |
| `npm run lint`, `npm run format:check` (repo-wide, as CI runs them) | PASS. |
| GitHub Actions on `62a37f3` | Admin Web, Backend (lint/format/build/unit), Backend (isolated PostgreSQL), Backend (container build), Agent Mobile, Customer Mobile all **pass**. |

Full backend unit suite (`npm test`): **302 suites passed, 4 failed** — the same four fail on the
unmodified base commit (two are `consolidated-matrix.spec.ts`, which asserts a recorded run's commit
is in history and cannot hold in this checkout; the other two are Jest workers SIGKILLed under this
sandbox's memory pressure and pass when run individually). No new failure was introduced.

### One pre-existing integration failure, not caused by this branch

CI's `Backend (real PostgreSQL integration)` job reports **1 failed of 199**:
`test/v1-agent-cash-to-cash-operations.integration.spec.ts:143` expects the legacy
`/internal/admin/cash-to-cash/transfers` route to return `total: 1` and gets `total: 0`.

This was reproduced **on the base commit `96bda49` with none of this branch's changes present**,
and it fails identically there and here. The route under test is the legacy C2C operations endpoint,
which this branch does not touch; the export reads `HISTORY_LIST_SQL` through the transaction
history controller on a different path. It is recorded here as an inherited failure, not a
regression, and is left for PR #23's own line of work rather than silently patched inside an
export PR.

## What the integration suite proves

`test/transaction-history-csv-export.integration.spec.ts`, 7 tests:

1. **Exact match with the list across pages.** 47 visible rows for `OPERATIONS` under
   `from=2026-11-24&to=2026-11-24&type=BANK_TO_WALLET` — five list pages at the UI's page size of
   20, three export pages at 100. The file's 47 references sorted equal the paginated list's 47
   references sorted; all 47 business ids are distinct (each row once). Nine rows belonging to a
   second institution and two own-institution rows outside the Lagos day (one microsecond before
   midnight, one exactly at the next midnight) are absent. Every timestamp renders as
   `2026-11-24 1[23]:…` (Lagos, UTC+01:00).
2. **Scope is per-request, not cached.** The `FINANCE_AUDITOR` (platform visibility) sees 56 rows
   including the foreign institution through the same filters — the export honours each principal's
   own scope rather than a fixed filter list.
3. **Server-side denial.** `TREASURY` (no `transaction.view`) gets 403 with no CSV content; an
   unauthenticated request gets 401; that principal leaves no export audit row. `limit` and `cursor`
   are rejected with 400. Malformed dates/types/reversed ranges are rejected exactly as the list
   rejects them.
4. **Foreign institution with an exact reference.** A real, existing foreign reference returns a
   header-only file with `X-Export-Rows: 0` — never a 404 leak and never the row.
5. **Escaping and formula protection on live data.** Six hostile references written as genuine
   `CUSTOMER_FUNDING` references: `=HYPERLINK(…)`, `+234…`, `-1+1`, `@SUM(A1:A9)`,
   `COMMA,AND"QUOTE`, `LINE\nBREAK`. The four formula triggers come back prefixed with `'`; the
   comma/quote/newline values come back byte-identical and correctly quoted. Every parsed row has
   exactly 11 cells and no data line begins `=`, `+` or `@`.
6. **Empty result.** A non-existent reference returns a header-only file, HTTP 200, `X-Export-Rows:
   0`, audited as `rowCount: 0`.
7. **Size refusal.** With the ceiling lowered to 10 via the documented option, the export throws
   **413** with "…above the supported export size. Narrow the date range or add a product, status or
   reference filter… No file was produced."; the refusal is audited as `REFUSED_SIZE_LIMIT` with
   `rowCount: 0`. The default `MAX_EXPORT_ROWS` of 50,000 is asserted separately.
8. **Revocation is immediate.** Revoking the institution assignment makes the very next export of
   the same URL return zero rows on the same live session; restoring it brings the rows back.

## Browser evidence

`scripts/transaction-history-csv-export-acceptance.cjs --browser`, 12 checks. Screenshots in this
directory:

| File | What it shows |
| --- | --- |
| `export-filters-applied.png` | Signed-in OPERATIONS session, Lagos date range and `Bank to Wallet` applied. |
| `export-page-2.png` | The list showing **Page 2** — proving the export is not "the visible page". |
| `export-confirmed.png` | "Exported 47 transactions to `transaction-history_2026-11-24_to_2026-11-24_bank_to_wallet.csv`. These are all records matching the applied filters, not just this page." |
| `export-size-refusal.png` | The 413 refusal rendered in the UI with the narrow-your-filters instruction and no download. |
| `browser-download.csv` | The actual file the browser saved: 1 header + 47 data rows, UTF-8 BOM, CRLF. |
| `acceptance.json` | Per-check results, the tested commit and the scope statement. |

The download was captured with Playwright's `download` event and saved to disk, then parsed and
reconciled against the API export's header and row set — it is the file the browser produced, not a
server string reused as evidence.

## Limits of this evidence

- **Synthetic business rows.** There is no product API that creates settled transactions in bulk, so
  the fixture inserts inbound payment, customer funding and institution rows directly. Rows, sessions,
  guards, authorization decisions and audit writes are real; the *transactions* are not real money.
- **The ceiling is exercised by lowering it.** 50,001 real rows were not loaded. The default value is
  asserted; the refusal path is proven at a lower, documented ceiling.
- **No Excel execution.** Compatibility is structural (BOM, CRLF, RFC 4180 quoting, no trailing
  blank row) and verified with an independent parser. LibreOffice/Excel were not launched here.
- **Chromium is the npm serverless build.** A genuine engine and renderer; not Safari, not a handset,
  not a screen reader.
- **No mixed-product volume re-measurement.** The existing PR #23 query plans remain the only plan
  evidence; this change adds no new performance claim.
- **No production deployment, approval or merge is implied.** Both PRs stay unmerged.
