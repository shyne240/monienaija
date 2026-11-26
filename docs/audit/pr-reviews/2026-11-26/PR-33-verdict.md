# PR #33 — “Finance: Platform Funds vs. Bank Balance” — refreshed readiness verdict

**Verdict: FUNCTIONALLY READY; HOLD only for owner merge authorisation.** The Platform Funds change now
merges cleanly onto the latest integration tip after resolving migration-pin conflicts in a candidate
commit. The retargeted tree preserves integrated Finance #25 and Transaction History #23, and its
targeted Finance, migration, HTTP and real-browser checks pass. The PR remains OPEN, DRAFT and UNMERGED.

## Exact refs

| Item | SHA / ref |
| --- | --- |
| Integration target (reviewed tip) | `39e0811d928c54537d120a5efad94cc76afb71ca` |
| Earlier reviewed integration tip | `85b8a953eb3563d800f5a50118c4dddbdaf04965` |
| Original PR head | `f729f185d2cd4c4f4c6626acd8c165b7b8885320` |
| Original declared base | `arena/76e596b2-monienaija` @ `4c007f007bbaa20596a16efdf154361aed7b1589` (Finance #25 head) |
| Finance #25 merge into integration | `7ecbb71522a2092ea2e0f0cb9a7f4a36200414e5` |
| Conflicted test tree on new tip | `2054e920f35da4a899fae413d5e3067cb214d75d` (`merge-tree` exit 1) |
| Retarget candidate head (current PR head) | `e96a984962e2c04b4d8af7de11bfaac76c4c0ffe` |
| PR base after retarget | `arena/5-main-web-integration` @ `39e0811d928c54537d120a5efad94cc76afb71ca` |
| Candidate merge parents | `39e0811d…` (integration) + `f729f185…` (original PR head) |

PR: https://github.com/shyne240/monienaija/pull/33

## Retarget and scope proof

- A direct retarget of `f729f185…` onto `39e0811d…` was **not clean**: conflicts in
  `production-readiness.service.ts` and nine migration/integration expectation specs. Integration #23
  advanced the schema head to `1785753600807` (`CaptureCustomerFundingScope`) while #33 pinned `0813`
  (`CreatePlatformFundsBankComparisons`). Both sides were preserved: the candidate expects
  `0805 → 0806 → 0807 → 0813`, with a 172-migration inventory (169 + 0806 + 0807 + 0813).
- Candidate diff against `39e0811d…`: **42 files, +9068/−51** — the same paths as the original PR’s
  42-file, +9064/−46 diff against `4c007f0…`. The extra five changed lines are the integrated
  `0806`/`0807` identities retained in head-pinning assertions; nothing else was added.
- No `node_modules` gitlinks, generated evidence rewrites, transaction-history source changes, or
  unrelated source files are in the candidate diff. Integrated #25 finance-operations code and #23
  transaction-history code are intact.
- `npm run lint` passes (one pre-existing unused eslint-disable warning in `b9-custom-role.integration.spec.ts`);
  `npm run format:check` passes; backend `nest build` and Admin Web `tsc`/Vite build pass.
- Retarget mechanics: PR base changed via `gh api PATCH /pulls/33` because `gh pr edit` fails with a
  GitHub Projects-classic deprecation GraphQL error. Head branch advanced by fast-forward push from
  `f729f185…` to `e96a9849…`. Both PRs remain unmerged.

## Required CI (from `.github/workflows/ci.yml`; branch-protection API returned 403 to this token)

Classify changes; Backend (lint, format, build, unit tests); Backend (real PostgreSQL integration);
Backend (container image builds); Backend (isolated PostgreSQL suites); Admin Web (types, tests, build);
Agent Mobile (types, tests); Customer Mobile (types, tests).

- CI at the original head `f729f185…`: https://github.com/shyne240/monienaija/actions/runs/45736462417 — all eight jobs SUCCESS.
- CI at the updated candidate `e96a9849…`: https://github.com/shyne240/monienaija/actions/runs/45856239360
  (push run https://github.com/shyne240/monienaija/actions/runs/45856227480).
  Seven of eight jobs had completed SUCCESS at last check; **Backend (real PostgreSQL integration) was still
  running**. Final status is recorded in `00-checkpoint.md` once finished.
- GitHub’s configured required-check list could not be read with this token (HTTP 403); job names are
  inferred from the workflow file.

## Checks independently run on the combined candidate tree

- Admin Web full Jest: **107 suites / 1088 tests passed** (the new tip adds tests versus the earlier 1000).
- Targeted backend Jest: **6 suites / 76 tests passed**, including Finance #25 `finance-operations.service`
  and `finance-operations.route-policy` specs alongside the Platform Funds suite.
- Migration inventory: **10/10**; disposable PG reported **172 migrations** applied, head `0813`.
- Real-PostgreSQL integration specs touched by conflict resolution: **9 suites / 144 tests passed**
  (`a8`, `a19`, `a20`, arena5 consolidation, `migration-0804`, `migration-chain`, `stage10`, `stage8`,
  `v1-customer-onboarding-03`). One earlier candidate attempt failed `migration-chain` because the
  integrated `0806/0807` rows had been dropped; it was fixed by preserving both, then the full nine-suite
  set was rerun green.
- Disposable-PG HTTP acceptance: **37/37** (`pr33-combined-candidate/platform-funds-http-acceptance.json`).
- Institution-scope HTTP acceptance: **22/22**
  (`pr33-combined-candidate/platform-funds-institution-scope-acceptance.json`).
- **Primary real-browser evidence**: production Admin Web bundle + real Nest AppModule/Fastify + same-origin
  `/api/v1` proxy + fresh migrated disposable PostgreSQL, 11 accounts unchanged, **11/11 passed**
  (`pr33-combined-candidate/browser-report.json` and four screenshots). FINANCE_PREPARER recorded a
  50,000-minor staff-entered balance against a 0 ledger expectation, added a referenced timing item,
  submitted (self-approval prohibited), and an independent FINANCE_CONTROLLER signed off (HTTP 201,
  “Signed off” visible). No page errors.
- Earlier real-browser evidence at the original head: `pr33-browser-real/report.json`, 11/11.
- **Historical, non-primary evidence**: `pr33-browser-fixture/` 17/17 drives the production bundle with
  the API stubbed at the browser network layer. It asserts UI behaviour only and proves nothing about
  the server. The fixture JSON committed in the PR itself predates the reviewed head (`3c26f7c…`).

## Scope and controls observed

No bank API calls, payouts, ledger adjustments, provider statement changes, mobile edits, or password
changes. Bank balance is staff-entered with a statement reference. Institution scope is re-resolved per
request; maker/checker, MFA, self-approval prohibition, mapping blocker and immutable evidence controls
behaved as claimed. All eleven workforce accounts/passwords and configurable permissions were preserved.

## Outstanding decisions

1. Owner must explicitly authorise merging the now-draft PR #33; this review leaves it UNMERGED.
2. Owner should replace or relabel the PR’s committed historical fixture browser JSON; the refreshed
   real-backend run is the authoritative evidence. PR body has been updated accordingly.
3. GitHub branch-protection required-check list remains unverifiable (403); workflow job results are reported.
