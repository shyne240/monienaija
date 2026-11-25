# Transaction History CSV export

**Status: draft, unmerged.** One button, labelled **Export CSV**, on the unified Transaction History
page. Scope is CSV only.

- Base for this work: PR #23 at **`46e9ff703884dff6aa4d9b520a1b6817c8c5b705`** (the last reviewed
  head), itself branched from `41edf587c262edafbd3eb2cc1b3042c614a9730e`.
- This PR targets PR #23's branch (`arena/19545571-monienaija`) so the diff contains only export
  work. Once #23 merges, retarget to `arena/5-main-web-integration`.
- Out of scope, deliberately: PDF, native Excel workbooks, mobile apps, and any change to the
  existing local accounts or passwords.

## What an export contains

Every record matching the filters **applied on screen** — all pages, not the page being viewed.
There is no second query: `TransactionHistoryExportService` drains the exact `list()` the page calls,
so these are shared by construction rather than by convention:

| Concern | Shared with the list |
| --- | --- |
| Query | `HISTORY_SQL` — one `UNION ALL` over the nine supported products |
| Filters | `type`, `status`, exact `reference`, `from`/`to` — ANDed before paging |
| Date boundaries | `lagosBoundary()`: whole Lagos days, UTC+01:00, half-open `[from, to+1day)` |
| Permissions | `transaction.view`, principal types `OPERATOR`/`SERVICE`/`PRIVILEGED` |
| Institution scope | `ACTIVE` `workforce_institution_assignments`, re-checked **per page** |
| Masking | whatever the list projection returns — the export adds no field |

An export therefore cannot contain a record or field the operator cannot read in the list. Fields
that are not in the list projection (journals, VAT, investigation payloads, unmasked phone numbers)
are not in the file either.

### Columns (stable order, append-only)

```
transaction_reference, product, product_label, status, created_at_lagos, created_at_utc,
amount, currency, fee, fee_recorded, business_transaction_id
```

- `product` is the stable machine type (`CASH_TO_CASH`); `product_label` is the same human label the
  screen shows (`Cash to Cash`). Downstream reconciliation can key on the machine value.
- `created_at_lagos` is `YYYY-MM-DD HH:MM:SS` in Africa/Lagos (fixed UTC+01:00, no DST), matching the
  list's "Created · Lagos" column. `created_at_utc` is the same instant in UTC.
- `amount` and `fee` are exact decimal strings from integer minor units (`125000` → `1250.00`).
  Conversion is integer string arithmetic; it never passes through `Number`, so amounts above
  2^53 are not rounded.
- **`fee` vs `fee_recorded`**: an unrecorded fee is an empty `fee` cell with `fee_recorded=false`;
  a recorded zero fee is `0.00` with `fee_recorded=true`. A blank cell never silently means zero.
- `business_transaction_id` lets a row be linked back to `/:type/:id` without parsing the reference.

### Excel compatibility

UTF-8 BOM (so Excel on Windows detects the encoding on double-click), CRLF line endings, and no
trailing blank line — a trailing CRLF becomes a spurious empty row in some importers, and "every row
exactly once" is the acceptance criterion.

### CSV escaping

RFC 4180 quoting: a value containing `,` `"` CR LF or leading/trailing whitespace is wrapped in
double quotes and embedded quotes are doubled. A reference such as `COMMA,AND"QUOTE` or one
containing a newline stays in one cell and cannot add a row or a column.

### Spreadsheet formula protection

A cell whose text begins with `=`, `+`, `-`, `@`, TAB or CR is neutralised with a leading apostrophe.
The tab/CR variants are the classic bypass past a naive `=+-@` check. Only untrusted free text is
neutralised (the transaction reference, and the `reference` value copied into the audit record);
constrained vocabulary, numbers and ISO timestamps are escaped but not prefixed, so a legitimate
value cannot be altered. A leading hyphen *inside* a reference (`SYN-C2C-001`) is untouched.

## Size limit — refusal, never truncation

Two independent guards, because a partial file presented as a complete one is worse than no file:

1. **Row ceiling** — `MAX_EXPORT_ROWS = 50,000`, supplied through the
   `TRANSACTION_HISTORY_EXPORT_LIMITS` token so a deployment can tune it from measured capacity.
   Above it the request fails with **413** and a message naming the limit and telling the operator to
   narrow the date range or add a filter. No file is produced. `0` or a non-integer is rejected at
   construction: the ceiling cannot be configured away.
2. **Page bound** — a cursor that does not advance fails loudly instead of looping.

A row is emitted once per `type/id`. If the data shifts between pages so the cursor re-yields a row,
the duplicate is dropped and counted in the audit record (`duplicateSuppressed`) rather than written
twice.

## Audit trail

Each attempt writes exactly one `audit_events` row through the existing `AuditService`:

- `entity_type = TRANSACTION_HISTORY_EXPORT`, `action = TRANSACTION_HISTORY_CSV_EXPORTED`
- `actor` — the signed-in principal id
- `new_values.filters` — the filters that were actually applied, so an auditor can reproduce the file
- `new_values.outcome` — `SUCCEEDED`, `REFUSED_SIZE_LIMIT` or `FAILED`
- `new_values.rowCount`, `duplicateSuppressed`, `pages`, `fileName`, `format: 'CSV'`

A refused or failed attempt is recorded too — attempting to take a copy of transaction data is
itself the accountable act. If the audit write fails, the export fails: the file is never handed
over as if it had been recorded.

## API

`GET /api/v1/internal/admin/transaction-history/export.csv` — same filters as the list.
`limit` and `cursor` are **rejected with 400** rather than ignored, so a caller cannot ask for a
partial file that looks whole. The route policy that guards the list (`WORKFORCE_SESSION`,
`transaction.view`, `OPERATOR`/`SERVICE`/`PRIVILEGED`, no customer/agent/aggregator access) covers
`export.csv` because it is under the same path prefix; `transaction-history.controller.spec.ts`
asserts it explicitly so the coverage cannot be lost by a refactor.

Response headers: `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="…"` plus `filename*=UTF-8''…`,
`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Export-Id`, `X-Export-Rows`,
`X-Request-Id`.

## UI

`Export CSV` sits with `Refresh history` in the page header. Its state is separate from the list's,
so a slow export never makes the table look like it is reloading and a list refresh never cancels a
running export.

- **Progress**: the button becomes `Exporting…` (disabled) and an `aria-live` status reads
  "Preparing export…". A spinner is shown, with a reduced-motion fallback.
- **Success**: "Exported 47 transactions to transaction-history_….csv. These are all records matching
  the applied filters, not just this page." The count comes from the server's `X-Export-Rows`, not
  from the visible page.
- **Size refusal**: the server's own message is shown in an error region together with the narrow-
  your-filters instruction. No download starts.
- **Denial**: a 403/401 message is surfaced the same way.

The export URL is built from the same `query` state the list uses (`exportUrl()`), so the filters on
screen and the filters in the file cannot drift.

## Verification

Exact tested commit and full command list: [evidence/test-results.md](evidence/test-results.md).

- `test/transaction-history-csv-export.integration.spec.ts` — fully migrated disposable PostgreSQL,
  real `AppModule`, real local workforce **email/password sign-in**, real workforce session guard,
  real audit sink. 7 tests.
- `scripts/transaction-history-csv-export-acceptance.cjs --browser` — the same, driven through
  Chromium: signs in, applies filters, moves to page 2, clicks **Export CSV**, saves the real
  download and reconciles it row for row. 12 checks.
- `src/admin/transaction-history-csv.spec.ts` (19 tests) and
  `src/admin/transaction-history-export.service.spec.ts` (14 tests) cover escaping, formula
  protection, fee-vs-zero, exact minor-unit conversion, paging, duplicates, the size limit and audit
  recording without needing a database.
- `apps/admin-web/__tests__/transaction-history-workspace.test.tsx` adds the button, progress,
  success, refusal and denial states.

## Known limits of this evidence

- The business rows are synthetic. There is no supported product API that creates settled
  transactions in bulk, so the fixture writes them directly; the read path, sessions, guards,
  authorization and audit are the real ones.
- The 50,000 ceiling is exercised by lowering it through the documented constructor option, not by
  loading 50,001 real rows. The default value itself is asserted.
- Chromium here is the npm-provided serverless build: a genuine engine and renderer, not Safari and
  not a handset. Excel files were not opened in Excel; compatibility is asserted structurally (BOM,
  CRLF, quoting, no trailing row) and by the RFC 4180 parse.
- Volume/query-plan behaviour for a 50,001-row export was not re-measured; the existing history
  query plans on PR #23 remain the only plan evidence.
