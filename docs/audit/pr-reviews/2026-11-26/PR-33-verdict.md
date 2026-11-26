# PR #33 — "Finance: Platform Funds vs. Bank Balance" — independent readiness verdict

**Verdict: FUNCTIONALLY READY, HOLD for branch/evidence decisions.** Every behavioural, authorization,
accounting and browser check passed at the exact head against the real backend on disposable PostgreSQL.
Merge readiness is blocked only by governance/hygiene items: the stacked base should be retargeted, the
attached browser evidence predates the head, and the PR is still draft. **No branch or PR base was changed;
the PR remains unmerged.**

## Exact refs

- Review date: 2026-11-26.
- Integration target tip: `arena/5-main-web-integration` @ `85b8a953eb3563d800f5a50118c4dddbdaf04965`.
- PR head: `arena/751ace82-monienaija` @ `f729f185d2cd4c4f4c6626acd8c165b7b8885320`.
- Declared base: `arena/76e596b2-monienaija` @ `4c007f007bbaa20596a16efdf154361aed7b1589` (PR #25 head).
  PR #25 is already merged into integration as `7ecbb71522a2092ea2e0f0cb9a7f4a36200414e5`.
- Merge base PR #33 ↔ integration: `4c007f0...` (so the PR is stacked on already-integrated Finance code).
- Clean target merge tree (test only): `04e60f2b98b4b8b354aeb3f0be1ca00422b19939`.
- Clean target diff: **42 files, +9064/−46**, byte-identical to `git diff 4c007f0..f729f18`.
  `git merge-tree --write-tree 85b8a95 f729f18` exits 0 with no conflicts; later integration merges
  (#26/#29/#30/#31) are preserved. The misleading 172-file/+9367/−24318 `git diff 85b8a95..f729f18`
  is purely the stale base showing those later commits in reverse.
- PR: https://github.com/shyne240/monienaija/pull/33.

## Verification against Finance code already integrated from #25

- Overlap with later integration commits is limited to `menu-visibility-11-roles.test.tsx`, `Layout.tsx`,
  `navigation-access.ts` and `route-policy-registry.ts`; the clean merge preserves their integrated form.
- Targeted backend suite included the PR #25 finance-operations unit/route-policy specs together with the new
  platform-funds specs: **6 suites / 76 tests passed** at head.
- The real-backend HTTP and browser runs used a fully migrated database containing the integrated
  `finance-operations` module and its route policies; no provider reconciliation or banking exception code was
  altered.

## Required CI (from `.github/workflows/ci.yml`; branch-protection API returned 403 to this token)

Classify changes; Backend (lint, format, build, unit tests); Backend (real PostgreSQL integration);
Backend (container image builds); Backend (isolated PostgreSQL suites); Admin Web (types, tests, build);
Agent Mobile (types, tests); Customer Mobile (types, tests).

- CI at exact head: https://github.com/shyne240/monienaija/actions/runs/45736462417 — all eight jobs SUCCESS
  (second push-triggered run: https://github.com/shyne240/monienaija/actions/runs/45736456064).
  `gh pr view 33` also reports all checks SUCCESS.

## Checks independently run at the exact head

- `npm run build` (backend) and production Vite build: pass.
- Admin Web full Jest suite: **99 suites / 1000 tests passed**.
- Targeted backend Jest: **6 suites / 76 tests passed** (mapping, payout cases, platform-funds route policy,
  governed-action registry, finance-operations service and route policy).
- Disposable-PG HTTP acceptance `scripts/platform-funds-http-acceptance.cjs`: **37/37 passed** at head
  (evidence: `pr33-http/platform-funds-http-acceptance.json`). It proves:
  - reserve leaves ledger-expected bank unchanged; settle reduces it once by exactly the reserved amount;
    release restores the wallet with no bank outflow (second reserve also unchanged);
  - commission accrued → credited to agent wallet is counted once, in `UNPAID_AGENT_COMMISSIONS` then
    `AGENT_FLOAT`, never both; fee transfer to earnings leaves expected bank unchanged;
  - staff-entered bank balance recomputes the difference (50,000), a referenced timing item absorbs it to
    unexplained 0, zero-value timing item refused (400), items freeze at submit (409), double submit refused (409);
  - maker `FINANCE_PREPARER` create/submit → independent `FINANCE_CONTROLLER` review; controller-as-maker and
    preparer-as-checker refused (403); self-approval prohibited; unauthenticated 401; TREASURY without
    `ledger.view` 403; auditor/SUPER_ADMIN reads 200; snapshots CREATED→UPDATED→SUBMITTED→REVIEW_APPROVED;
  - unmapped account surfaces `ACCOUNT_NOT_MAPPED`, conserves the ledger and blocks sign-off (409);
    ledger-evidence drift after submission refuses approval (409); snapshot tampering rejected by DB trigger.
- Institution-scope HTTP acceptance `scripts/platform-funds-institution-scope-acceptance.cjs`: **22/22 passed**
  (evidence: `pr33-http/platform-funds-institution-scope-acceptance.json`), including 404 anti-probe after grant
  revocation and own-institution create/read/patch/timing/snapshot flows.
- Fixture browser harness `scripts/platform-funds-browser-acceptance.cjs`: **17/17 passed** at the current head
  (`pr33-browser-fixture/`). It drives the production bundle in Chromium with the API stubbed at the browser
  network layer: **no assertion claims anything about the server**. The PR's committed browser JSON was generated
  at older commit `3c26f7cfe7681c30c64c30541376dc89de45bbc2`, not at `f729f18`.
- **Real-backend browser run**: **11/11 passed** (`pr33-browser-real/report.json`, four screenshots) using the
  production bundle, real Nest AppModule/Fastify, same-origin `/api/v1` proxy, and a fresh disposable PostgreSQL
  database with the eleven seeded accounts. FINANCE_PREPARER signed in through the UI, opened Finance →
  Platform funds vs. bank, selected the real settlement account, entered 50,000 minor units as the verified
  bank balance (expected 0), recorded a referenced +50,000 timing item with explanation, submitted with a note,
  saw the self-approval prohibition, and an independent FINANCE_CONTROLLER signed off in a second browser
  context (HTTP 201, “Signed off” visible). Eleven accounts still authenticate; zero page errors.
  An earlier real-backend attempt against the HTTP-acceptance database correctly refused sign-off because that
  fixture deliberately leaves an unmapped account; the clean run used a fresh database to isolate the happy path.

## Scope and controls observed

No bank API calls, payouts, ledger adjustments or provider statement changes. Bank balance is staff-entered with
a statement reference. Institution scope is re-resolved per request. Maker/checker, MFA, self-approval,
mapping blocker and immutable evidence controls all behaved as claimed. All eleven workforce accounts/passwords
and configurable permissions were preserved; no mobile code was touched.

## Outstanding decisions

1. **Retarget base** from `arena/76e596b2-monienaija` to `arena/5-main-web-integration` (clean, recommended) so
   GitHub and CI review the 42-file delta rather than a stale 172-file delta. Not done in this review.
2. Replace the stale attached browser evidence (`3c26f7c`) with head-specific fixture **and** real-backend runs,
   or explicitly label the committed JSON as historical. New evidence is in this directory.
3. Decide whether to take the PR out of draft once 1–2 are complete.
4. GitHub branch-protection required-check list could not be read (403); workflow jobs are all green.
5. Both PRs remain unmerged.
