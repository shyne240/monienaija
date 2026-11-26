# PR #35 — "Allow first dashboard assignment for custom roles" — independent readiness verdict

**Verdict: READY to merge (no functional defect found).** Recommend the owner refresh the branch onto the
current integration tip or merge as-is; `git merge-tree` shows a clean merge either way. Leave unmerged until
the owner makes that call.

## Exact refs

- Review date: 2026-11-26.
- Integration target tip: `arena/5-main-web-integration` @ `85b8a953eb3563d800f5a50118c4dddbdaf04965`.
- PR head: `codex/custom-role-dashboard-assignment` @ `871410000514972a1c8819ff7e7ac42cbc88b798`
  (commits `f13716b5a49fa86e0a8c9b41ba5e570c13a98319`, then merge `871410000514972a1c8819ff7e7ac42cbc88b798`).
- Merge base with integration: `f1a51dd818e1fdca16596351d9c760970dcdc7e4` (one integration merge behind tip).
- Clean target merge tree (test only): `2da570c7bd094a0d1705e1bcd4e8a7ec9fe3884f`.
- Clean target diff: 3 files, +78/−33 — only `DashboardSettingsScreen.tsx` and its two test files.
  The apparent deletion of `workforce-compliance-fraud-support-operational.test.tsx` in a naive
  `git diff integration..head` is an artefact of the stale base; the real merge keeps that newer integration file.
- PR: https://github.com/shyne240/monienaija/pull/35.

## Required CI (from `.github/workflows/ci.yml`; branch-protection API returned 403 to this token)

Classify changes; Backend (lint, format, build, unit tests); Backend (real PostgreSQL integration);
Backend (container image builds); Backend (isolated PostgreSQL suites); Admin Web (types, tests, build);
Agent Mobile (types, tests); Customer Mobile (types, tests).

- CI at exact head: https://github.com/shyne240/monienaija/actions/runs/45814306693 — all eight jobs SUCCESS
  (second push-triggered run: https://github.com/shyne240/monienaija/actions/runs/45814297592).
  `gh pr view 35` also reports all checks SUCCESS.

## Checks independently run at the exact head (detached worktree; disposable PostgreSQL)

- `npm run build` (backend) and `ADMIN_WEB_API_BASE_URL=/api/v1 npm run build` (production Vite bundle): pass.
- Admin Web full Jest suite: **105 suites / 1074 tests passed**.
- Backend targeted Jest: **3 suites / 83 tests passed** (`workforce-administration-validation`,
  `governed-action.registry`, `arena6-dashboard-layout-additions`).
- Real-PostgreSQL integration suite `v1-admin-configurable-dashboard-platform-01.integration.spec.ts`:
  **47/47 passed** (all eleven seeded roles, per-widget authorization, no unauthorized data leakage, fallback).
- Real-session browser harness (production bundle + real Nest AppModule/Fastify + migrated disposable PG,
  no stubbed API): **26/26 passed**. Evidence: `pr35-browser-real/report.json` and screenshots in this directory.
  The harness created a synthetic `D35_REVIEWER` role through the real role-definition maker/checker flow,
  assigned it to a synthetic staff credential, and then used the actual Dashboard Settings screen as
  `SUPER_ADMIN`:
  - before assignment the staff member's `my-dashboard` resolved to `DEFAULT_FALLBACK`;
  - the unassigned custom role appeared as “No dashboard assigned”; selecting `FINANCIAL_AUDIT_ASSURANCE`
    produced `PUT .../assignments/D35_REVIEWER -> 200` and the exact server receipt in the UI;
  - on fresh sign-in the staff member saw `FINANCIAL_AUDIT_ASSURANCE` with nine tiles; after reassignment
    to `TRANSACTION_OPERATIONS` the next sign-in showed the new template; removing the synthetic assignment
    row returned the safe fallback; governed role revocation invalidated the old token (401) and the UI session;
  - session scopes were byte-identical before/after assignment (`customer.view`, `fee_rule.view`; no `ledger.view`),
    `ledger-summary` was `authorized:false` with no drill-down, both protected widget endpoints returned 403,
    `/api/v1/ledger/accounts`, `/internal/workforce/directory` and role-definition proposals returned 403 while
    the actually granted fee-rule and customer reads returned 200; no protected sidebar/drill-down routes appeared;
  - all eleven workforce accounts/passwords still authenticated, and `FINANCE_AUDITOR` still resolved its
    seeded `FINANCIAL_AUDIT_ASSURANCE` dashboard; zero page errors.

## Scope and controls observed

No backend permission, widget registry, route-policy or maker-checker code is changed by this PR. Configurable
role definitions, grants and dashboards for the seeded roles behaved as before. Institution scope was untouched.

## Outstanding decisions / limitations

1. Optional: refresh the PR branch onto `85b8a95`; the merge is clean and no content changes result.
2. GitHub branch-protection required-check list could not be read (403); workflow jobs are all green.
3. A local attempt to run the *entire* backend unit suite concurrently for both PRs exhausted sandbox memory
   (jest worker SIGKILL); this was a harness/resource artefact, not an assertion failure. CI's isolated full run
   at the exact head is green and the targeted suites above were rerun successfully.
4. Both PRs remain unmerged.

## Refreshed integration tip check (2026-11-26, later in the session)

The integration ref advanced from `85b8a953…` to `39e0811d928c54537d120a5efad94cc76afb71ca`
(Transaction History integration). `git merge-tree --write-tree 39e0811d… 87141000…` exits 0 with tree
`a1e9a3a4235c1c61a7a667db35ebc98ab0261fb4`. The target diff remains exactly the same three files,
+78/−33, and none of the new integration commits touch `DashboardSettingsScreen.tsx`,
`dashboard.test.tsx` or `m2-dashboard-settings.test.tsx`. The reviewed merge result is therefore
unchanged; no affected-check rerun was triggered by this tip change. PR #35 head and state remain
unchanged (`87141000…`, OPEN, DRAFT, UNMERGED); CI at that exact head remains all-green.
