# PR23: missing-result diagnosis and refreshed Finance browser proof

## Sources

- History executable source: `1b6987e8b7f1a71390f86f4ff1b71a6797097869` (includes f341d0e and a15de1b, pushed to PR23's branch).
- Finance #25: `4c007f007bbaa20596a16efdf154361aed7b1589`.
- Raw merge tree: `8d0f601e226a4191d526258dcec63435733098d8`.
- Explicitly resolved integration tree: `a3490a8e95551aff35cb506ea8b7a5efed81c8b8`.
- Subsequent evidence/template changes do not change executable application or PG runner code. Neither PR was merged.

## Missing suite in run 45647665601

`test/transaction-history-mixed-volume.integration.spec.ts` is explicitly opt-in via `HISTORY_MIXED_VOLUME=yes`. Default CI skips its describe block. Reproduction through **the same** `scripts/run-pg-integration-tests.js` returned a successful Jest child with `1 skipped, 1 total`, no per-file PASS/FAIL line, and consequently `filesWithoutResult` naming this file. This was not a PostgreSQL crash, timeout, or failed performance assertion.

The runner now requests an isolated temporary Jest JSON report per batch, using it only to supplement explicit nonempty wholly-pending suites with status `skipped`. These are counted as `suitesSkipped`, never `suitesPassed`. Missing, incomplete, failed, empty or unexpected reports do not synthesize results. Existing text failure classification remains intact. The missing-result check is preserved and strengthened: the runner itself now exits nonzero if `filesWithoutResult` is nonempty, even if all children exit zero. CI's existing summary/exit gate remains unchanged.

Focused same-runner verification at 1b6987e: **2 discovered; 1 passed, 1 skipped, 0 failed, 0 missing**, exit 0. The other file is the repaired C2C suite (4 passing assertions). `node --test scripts/pg-skipped-results.test.cjs`: 2 passed, covering explicit skip versus missing/invalid results. Evidence: `evidence/ci139325573561/mixed-batch-{before.txt,after.json}`. The 90,300-row opt-in performance test and its recorded plans/results are retained; its default skip is not represented as fresh performance acceptance.

## Refreshed browser acceptance

**PASS**, 34.682 seconds, against fully migrated disposable PostgreSQL and real workforce UI sign-in. Harness: updated pinned `fixtures/finance25-journal-open.integration.spec.ts.template`; preparation: `scripts/prepare-history-journal-integration.cjs` with the exact sources above. Backend listens on 3099; Vite proxies same-origin API requests to it. Chromium uses the packaged AL2023 libraries (`LD_LIBRARY_PATH=/tmp/al2023/lib`); an initial launch lacking libnspr4 was corrected before this successful run.

For **Wallet Transfer and Bank to Wallet**, each test filters History by exact reference, opens its detail, opens the journal, checks Finance's return href, clicks back, and asserts the same canonical `#transaction-history/<TYPE>/<ID>` URL and reference heading. No second link format was introduced.

Permissions/isolation passed for both products:
- FINANCE_AUDITOR: journal and canonical return available.
- OPERATIONS without ledger.view: journal ID/action withheld; both direct journal endpoints return 403.
- OPERATIONS assigned only a foreign institution: original History detail 404, no reference heading exposed.
- Foreign FINANCE_PREPARER: journal UI not-found and both journal endpoints 404.
- All 11 existing local credential/password hashes and role-function grants unchanged.

The documented integration resolution is reused: PR23 owns unified History/Layout, no obsolete cashIn/cashOut cases, a single Transaction History nav entry, Finance journal/reference contexts retained and duplicate journalId removed. Finance owns its richer Ledger workspace; temporary integration removes Finance's one-shot autoOpened ref to retain the documented reentrant StrictMode-safe initial journal effect. This compatibility change remains integration-only, not an assertion that Finance adopted it.

Evidence: `evidence/finance25-4c007f0/` contains the provenance, merge output, result JSON (migration catalogue, exact sources, tested-file hashes, canonical records and checks), successful Jest summary, and 12 screenshots. Both PRs remain unmerged; PR23 stays draft.

## Hosted CI status

The original run at 96bda49 is failed and is not relabeled green. Pushing a15de1b started hosted runs 45664401248 and 45664381661; these precede the skipped-result fix. The final push triggers fresh hosted CI. Full hosted PG acceptance must be read from that exact-head run when it completes; the focused same-runner results above are not a claim that all hosted suites have completed green.
