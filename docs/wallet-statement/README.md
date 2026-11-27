# Branded printable wallet statement (Customer 360)

**Status: draft, unmerged.** Authorized staff pick a customer wallet and a Lagos date range in
Customer 360 and download a printable A4 PDF statement. The statement carries the MonieNaija brand
mark, the customer's name, the **masked** wallet identifier, the period, reconciled opening/closing
balances and the posted transactions in between.

- Targets PR #23's branch (`arena/19545571-monienaija`) alongside the CSV export work, in its own
  commits. Once #23 merges, retarget to `arena/5-main-web-integration`.
- Base SHA: #23 head `b6fa3648e61c0bf38856f2e574d131681e2077b0`.
- Deliberately out of scope: emailing statements, statement archives, mobile apps, and any change to
  the existing local accounts or passwords.

## Where it lives

| Layer                                       | File                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Route                                       | `src/admin/admin-customer.controller.ts` — `GET internal/customers/:id/wallets/:walletId/statement` and `…/statement.pdf` |
| Period/Lagos rules, masking, formatting     | `src/admin/wallet-statement/wallet-statement.format.ts`                                                                   |
| Ledger reconciliation                       | `src/admin/wallet-statement/wallet-statement.service.ts`                                                                  |
| PDF drawing                                 | `src/admin/wallet-statement/wallet-statement.pdf.ts`                                                                      |
| Customer name lookup + render orchestration | `src/admin/wallet-statement/wallet-statement-render.service.ts`                                                           |
| UI                                          | `apps/admin-web/src/screens/authenticated/WalletStatementPanel.tsx` (inside the wallet drawer)                            |
| Integration suite                           | `test/wallet-statement-pdf.integration.spec.ts`                                                                           |
| Browser acceptance                          | `scripts/wallet-statement-acceptance.cjs`                                                                                 |

## The balance rule

The ledger remains the only balance authority. The service reads the wallet's ledger account and
folds its **posted** lines; nothing is recomputed from wallet rows, cached totals or request state.

| Concern            | Rule                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| Opening balance    | Signed sum of every posted line **strictly before** `from`                         |
| Rows               | Posted lines in the half-open window `[from, to)`, oldest first                    |
| Running balance    | Opening plus each row in order, carried per row                                    |
| Closing balance    | Opening plus the period's rows, and asserted equal to the ledger's balance at `to` |
| Credits / debits   | Signed split of the period's lines, printed separately                             |
| Ledger unavailable | `Unavailable` — never `0`, never a guess                                           |

## Lagos day boundaries

A business day in this product is a Lagos day (`UTC+01:00`, no DST), so the statement agrees with the
rest of the admin surface rather than using UTC:

- `from=2026-10-01` → the ledger window starts `2026-09-30T23:00:00Z` (00:00 Lagos 1 October).
- `to=2026-10-31` is **exclusive**, ending at `2026-10-31T23:00:00Z` (00:00 Lagos 1 November).
- `2026-09-30T22:59:59.999999Z` is 23:59:59.999999 Lagos on 30 September, so it belongs to a
  September statement and to the opening balance of an October one.

The integration suite proves this with real postings a microsecond either side of both boundaries,
plus a single-day 30 September statement whose closing equals 1 October's opening.

## Limits and refusals

| Case                                               | Result                                          |
| -------------------------------------------------- | ----------------------------------------------- |
| Period longer than **366 Lagos days**              | `400`, before any ledger read                   |
| Malformed, reversed or missing dates               | `400`                                           |
| More than **2,000** posted rows in the period      | `413` with a narrow-your-range message; no file |
| Wallet does not belong to the customer in the path | `404` (no existence oracle)                     |
| Caller lacks `customer.view_wallets`               | `403`                                           |
| Anonymous                                          | `401`                                           |

## Access control

The route policy is `WORKFORCE_SESSION`, `resourceType: internal-route`, principal types
`SUPPORT`/`OPERATOR`/`SERVICE`/`PRIVILEGED`, `customerAccess: NONE` — so the controller enforces
wallet and institution access itself:

1. the caller must hold the function `customer.view_wallets`;
2. the wallet must be attributed to the customer named in the path;
3. an **institution** principal must hold an `ACTIVE` `workforce_institution_assignments` row for the
   wallet's institution;
4. an **unattributed** wallet is readable by platform staff only.

A wallet in another institution answers exactly as a wallet that does not exist, so the endpoint
cannot be used to probe for wallets outside the caller's scope.

## Audit

Every attempt — success, refusal and denial — writes one `audit_events` row through the existing
`AuditService`: actor principal, customer, wallet, period, format (`PREVIEW`/`PDF`), outcome and row
count. If the audit write fails the request fails, so a statement is never produced without its
record.

## The document

- A4, pdfkit, embedded DejaVu fonts (so customer names outside Latin-1 still print).
- Brand mark and product line on **every** page; the table header repeats; a row is never split
  across a page break.
- Footer: `Page n of m` (two-pass render, so the count is exact) and a short statement reference
  `STMT-XXXXXXXX`.
- The raw wallet UUID appears **nowhere** — not on the page, not in the PDF metadata (asserted by
  parsing the file's own `/Producer`/`/Title` objects).
- The same masking rule is used in the drawer, so staff see `•••• 6483` both on screen and in print.

## Verification

- `test/wallet-statement-pdf.integration.spec.ts` — fully migrated disposable PostgreSQL, real
  `AppModule`, real workforce sign-in, **7 tests**.
- `scripts/wallet-statement-acceptance.cjs --browser` — real Chromium: signs in, opens a customer,
  opens the wallet, picks the period, downloads the PDF, **reopens the saved file** with pdf.js and
  raster-decodes every page — **12 checks**. Evidence in [`evidence/`](evidence/): the sample PDF,
  page images, the drawer preview and `acceptance.json` (which records the commit and timestamp).

Run the browser acceptance against a Vite dev server pointed at the script's API port:

```bash
cd apps/admin-web && ADMIN_WEB_DEV_PROXY_TARGET=http://127.0.0.1:3097 npx vite --port 5174 --host 0.0.0.0
STMT_ACCEPTANCE_SPA_ORIGIN=http://127.0.0.1:5174 LD_LIBRARY_PATH=/tmp/al2023/lib \
  node scripts/wallet-statement-acceptance.cjs --browser
```

## Known limits of this evidence

Synthetic business rows on a disposable cluster; the read path, sessions, guards, ledger and audit
are real. The PDF is inspected by pdf.js rasterisation and by parsing its metadata — no physical
printer was used, and print layout is verified structurally (A4 page box, margins, repeated header,
no split rows). Chromium is the npm serverless build, not Safari or a handset. Nothing here implies a
production deployment, approval or merge.
