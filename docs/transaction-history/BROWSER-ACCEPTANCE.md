# Five-product real workforce browser acceptance

The reproducible acceptance suite is `test/transaction-history-browser-matrix.integration.spec.ts`.
It creates a fully migrated disposable PostgreSQL database (through migration
`CaptureCustomerFundingScope1785753600807`), authenticates all 11 unchanged local
role passwords, and uses genuine workforce browser sign-in, not injected tokens.
All data and screenshots are synthetic.

## Coverage

- Wallet to Bank: RESERVED commitment, exact reference/type/status AND filters,
  label, detail and saved URL reopened after navigating to about:blank.
- Customer Funding: owner-institution PENDING and REJECTED, same list/detail/link
  checks. Fresh foreign-institution OPERATIONS browser sessions see neither record
  by reference nor saved detail URL.
- Agent Funding and Agent Defunding: governed platform EXECUTED records read by
  FINANCE_AUDITOR. Institution OPERATIONS cannot list or open either record.
- Bank to Wallet: UNVERIFIED intake, same filters, detail and saved URL checks.
- Absent fee evidence is null/“Not recorded”, not an invented zero. Recorded bank
  intake fee and available journal UUIDs are asserted in the browser. Empty
  authorized journal evidence says “No journal recorded.”; absent ledger.view
  retains its separate permission message.
- All 11 credential hashes and role/function grants are unchanged after the run.

No institutional funding execution rail is introduced. Customer institutional
execution remains unsupported; platform agent execution uses existing governance.

## Evidence provenance

`evidence/browser-matrix/` contains 18 screenshots and a successful **pre-commit**
development capture. Its JSON explicitly records `workingTreeClean: false` and
must not be described as an exact clean-head run. Source hashes are included.

For the final clean-head local rerun, output goes to ignored
`data/validation/transaction-history-browser-matrix/`; its JSON commit, source hashes
and result are attached in PR23 commentary without changing the tested commit.
CI also runs the browser matrix and uploads the complete screenshot/JSON directory
as `transaction-history-browser-<checkout SHA>`. Inspect `testedCommit` inside the
artifact (PR workflows can use GitHub's synthetic merge checkout). Pending CI is
not a pass.

To reproduce, start a disposable PostgreSQL instance and Vite on port 5173 with
`ADMIN_WEB_DEV_PROXY_TARGET=http://127.0.0.1:3099`; supply the standard PG test
safety variables and database credentials. Run:

```sh
HISTORY_MATRIX_BROWSER=yes \
HISTORY_MATRIX_OUT=data/validation/transaction-history-browser-matrix \
npx jest --config jest.integration.config.js --runInBand \
  test/transaction-history-browser-matrix.integration.spec.ts
```

Use `HISTORY_MATRIX_CHROMIUM_PATH` for a Playwright-installed Chromium executable;
otherwise the repository's Sparticuz binary is used. Without the browser flag the
suite still verifies the real HTTP matrix but makes no browser claim.

## Still open; PR stays draft

- Mixed-product production-shaped query plans.
- Finance25 browser round trip.
- Unprovable legacy inbound transition/detail paths and attribution gaps.
- Unsupported institutional execution/rail decisions; no external governance
  approval is claimed.
