# PR23 + Finance PR25 real-session integration diagnostic

**Historical inputs: BLOCKED.** The [new journal navigation evidence](JOURNAL-NAVIGATION.md) supersedes the forward-action and two-product return findings using newer exact heads and an explicit integration resolution. This file remains the unchanged-in-substance record of the original blocked run.

## Exact tested inputs

PR heads were read from GitHub at the start and reconfirmed before publishing:

| Input | SHA |
| --- | --- |
| PR23 | `3c7f5c98fee27cb7164ee27f75605aeb58226c51` |
| PR25 | `891a1c1777855b9e921cfc50c962f2626d7eecf8` |
| Combined merge-tree before conflict resolution | `94d5de66d2f444ad8749fb244830a561dcc3d5e2` |
| Resolved product tree actually tested | `80bd7493d35148bfb37d26296f4d82d0f85540bf` |

These are Git **tree** objects, not merge commits. Neither PR was merged into
`arena/5-main-web-integration`, and no branch was created, switched or renamed.
The temporary archive checkout is ignored at `data/validation/finance25-combined/`.
The only product-source adjustment was resolving the Layout conflict below;
there were no hidden navigation fixes or mocked browser API responses.
The later evidence-publication commit is not claimed as the combined tested head.

## Environment and evidence

- New disposable PostgreSQL **18.4**, all **171 migrations** applied from scratch,
  ending at `CaptureCustomerFundingScope1785753600807`.
- Actual Nest AppModule, actual Finance and History controllers, real workforce
  credential/session endpoints and real Chromium sign-in form.
- All 11 exact fixture passwords authenticated; credential hashes and role/function
  grants unchanged at completion. No mobile changes or production data.
- Governed institution creation and workforce scope assignment/revocation.
- Synthetic institution-scoped balanced ledger journals posted by LedgerService.
  The wallet transfer source row is a synthetic read-model fixture, not a claim of
  exercising transfer execution. The bank record uses the existing controlled
  sandbox verification + policy-backed float-funding fixture, producing the real
  intake → durable float link → posted receipt journal. No external bank was called,
  production authority enabled, or institutional funding execution boundary changed.
- Final diagnostic: **1 suite / 1 diagnostic test PASS, 70.52 seconds**. The test
  explicitly asserts the observed missing links and writes `acceptance: BLOCKED`;
  this is **not** a successful two-product end-to-end round trip.
- Combined backend and Admin Web TypeScript checks passed. No combined GitHub CI
  run or external approval is claimed.

[evidence/finance25-roundtrip/results.json](evidence/finance25-roundtrip/results.json)
records the exact synthetic business IDs, journal IDs, source response, migrations,
source hashes and 11 screenshot filenames. The provenance file records the tree
IDs; merge-output.txt records the textual conflict. Evidence is from this combined
run, not the earlier five-product screenshots.

## What the browser actually did

For each posted product, FINANCE_AUDITOR opened unified Transaction History,
filtered by the exact reference, and clicked the matching row's **View details**.
The drawer showed its authoritative business key and the expected posted journal.

| Product | Authoritative key | Observed journey |
| --- | --- | --- |
| Wallet transfer, COMPLETED | `WALLET_TRANSFER/<transfers.id>` | History has journal text but **no journal link**. Diagnostic continuation: close drawer → Finance → Ledger & reversals → manually audit that exact journal. Finance resolves `TRANSFER/<same transfers.id>` through `transfers.journal_id`. Clicking **Open unified transaction detail** returns to exactly the original canonical History hash and matching detail. |
| Bank to Wallet, CREDITED | `BANK_TO_WALLET/<banking_inbound_payments.id>` | History has the posted float journal but **no journal link**. The same manual Ledger lookup opens the POSTED institution-scoped journal. Finance detail returns `source: null` and renders **No source transaction linked**; no return link exists. The linked float receipt ID is not substituted for the canonical bank intake ID. |

Manual Ledger lookup is deliberately disclosed: it is **not** counted as a working
History → journal click. A direct browser journal-detail hash is also not supplied
by these heads; direct protected journal URL checks below target the actual APIs.

## Permission and institution checks

Both records are in the owner institution. No grants were broadened for testing.

| Reader / direct resource | Result |
| --- | --- |
| Owner-institution OPERATIONS → History detail | 200; readable drawer, no journal UUID; “Ledger information requires ledger.view.” |
| OPERATIONS without ledger.view → core and Finance journal URLs | **403** on both, through real-session HTTP and browser fetch using the token issued by UI sign-in |
| Fresh OPERATIONS sign-in scoped only to foreign institution → each canonical History hash / detail API | **404**; drawer error, no reference heading |
| FINANCE_PREPARER scoped only to foreign institution → each core and Finance journal URL | **404** on both, including browser requests; manual Ledger audit also shows not found |
| FINANCE_AUDITOR → both journals | 200, POSTED, owner institution and balanced posting lines |

OPERATIONS and FINANCE_PREPARER are separate existing roles: the former has
transaction.view without ledger.view; the latter supplies a genuinely scoped
ledger.view reader without the platform attribution marker. Using the platform
FINANCE_AUDITOR as a “foreign” reader would not prove institution isolation.

## Conflicts and fix ownership

1. **PR23 — missing History → journal navigation.**
   `TransactionHistoryScreen.tsx` renders journal IDs in `<code>`, not links/buttons.
   Wire a journal-open action into the shell's existing guarded Ledger navigation,
   preserve the originating business TYPE/ID, and only expose it with ledger.view.
   Keep server authorization mandatory. Do not claim the wallet's manually opened
   journal proves the forward half already works.
2. **PR25 — incomplete Finance source resolution and return adapter.**
   `FinanceOperationsService.sourceFor()` does not resolve the posted institutional
   float receipt/bank-intake relation. For this proven lifecycle it must traverse
   receipt journal → `agent_float_funding_receipts` →
   `banking_inbound_float_links` → canonical bank intake UUID, then expose the
   authoritative `BANK_TO_WALLET` target. Extend the Finance return-link contract/
   adapter accordingly. Preserve standalone receipts and scoped aliases without
   guessing from reference prefixes or inventing bank/receipt matches.
3. **PR23 navigation owner + PR25 integration coordination — Layout merge conflict.**
   PR25 retains separate `cashIn`/`cashOut` switch cases that PR23 removed. Temporary
   resolution keeps PR23's unified routes and discards only those obsolete cases;
   it retains PR25's Ledger props and all other auto-merged changes. Retired routes
   must continue to canonicalize through the existing guarded unified view; no
   separate Deposit/Withdrawal pages should be restored.

No routing-policy collision or module-wiring startup failure occurred after that
explicit Layout resolution. The observed Finance bank failure is missing source
identity/navigation, not an authorization failure. Passing denials cover these two
synthetic posted records, not every product or historical attribution gap.

## Reproduce

Install the root and Admin Web dependencies; fetch the two recorded commits if
absent, then run from the repository root:

```sh
node scripts/prepare-finance25-history-checkout.cjs \
  3c7f5c98fee27cb7164ee27f75605aeb58226c51 \
  891a1c1777855b9e921cfc50c962f2626d7eecf8
```

The script refuses to overwrite an existing snapshot or accept unreviewed heads.
It creates no branch and leaves the repository index alone. It installs the pinned
`.ts.template` harness as a test **only inside the combined checkout**: running it
as an ordinary PR23-only test would not test Finance #25. The template is diagnostic
coverage of current blockers, not a merge gate that treats missing links as success.

Start disposable PostgreSQL and, from the temporary Admin Web directory, Vite:

```sh
ADMIN_WEB_DEV_PROXY_TARGET=http://127.0.0.1:3099 npm run dev -- --host 0.0.0.0
```

From the temporary checkout, supply its standard local test environment and the
PG test safety variables (`PG_TEST_RUN_ID` must match `[a-z][a-z0-9]{3,15}`):

```sh
NODE_ENV=test PG_TEST_RUN_ID=fin25repro \
PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
DB_HOST=127.0.0.1 DB_PORT=55440 DB_USER=monienaija DB_PASSWORD=monienaija-pw \
NOTIFICATION_WORKER_ENABLED=false CASH_TO_CASH_EXPIRY_WORKER_ENABLED=false \
FINANCE25_EVIDENCE_OUT=/absolute/path/to/evidence \
npx jest --config jest.integration.config.js --runInBand \
  test/finance25-history-roundtrip.integration.spec.ts
```

Use only disposable credentials; these are the synthetic local defaults. The
sandbox run supplied `LD_LIBRARY_PATH=/tmp/al2023/lib` for the repository's
Sparticuz Chromium binary. Do not commit local `.env` files or dependencies.

## Checklist remains open

- [ ] Actual History → journal → same canonical detail for both products, after
  the PR23 and PR25 fixes above, rerun against fresh exact heads.
- [ ] Mixed-product representative-volume query plans.
- [ ] Unresolved legacy wallet/suspense inbound transitions and attribution gaps.

**PR23 stays draft.** No external governance signoff is inferred from this fixture.
