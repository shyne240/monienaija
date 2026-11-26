# Checkpoint — Admin Web PR review (2026-11-26)

State saved before final evidence packaging. Both PRs remain OPEN and UNMERGED; no branch or PR base was changed.

## Exact refs

| Item | SHA / ref |
| --- | --- |
| Integration tip `arena/5-main-web-integration` | `85b8a953eb3563d800f5a50118c4dddbdaf04965` |
| PR #35 head (`codex/custom-role-dashboard-assignment`) | `871410000514972a1c8819ff7e7ac42cbc88b798` |
| PR #35 merge base with integration | `f1a51dd818e1fdca16596351d9c760970dcdc7e4` |
| PR #33 head (`arena/751ace82-monienaija`) | `f729f185d2cd4c4f4c6626acd8c165b7b8885320` |
| PR #33 declared base (`arena/76e596b2-monienaija`, PR #25 head) | `4c007f007bbaa20596a16efdf154361aed7b1589` |
| PR #25 merge commit into integration | `7ecbb71522a2092ea2e0f0cb9a7f4a36200414e5` |
| Clean target merge tree, PR #35 | `2da570c7bd094a0d1705e1bcd4e8a7ec9fe3884f` |
| Clean target merge tree, PR #33 | `04e60f2b98b4b8b354aeb3f0be1ca00422b19939` |

## CI links (all jobs success at exact heads)

- PR #35: https://github.com/shyne240/monienaija/actions/runs/45814306693 (also 45814297592)
- PR #33: https://github.com/shyne240/monienaija/actions/runs/45736462417 (also 45736456064)
- Branch protection API returned 403, so "required" checks are taken from `.github/workflows/ci.yml`: Classify changes, Backend (lint/format/build/unit), Backend (real PostgreSQL integration), Backend (container image builds), Backend (isolated PostgreSQL suites), Admin Web (types/tests/build), Agent Mobile (types/tests), Customer Mobile (types/tests).

## Results already obtained

- PR #35: admin-web 105/105 suites, 1074 tests; dashboard integration spec 47/47 on disposable PostgreSQL; targeted backend 83/83; real-session Chromium harness 26/26 (first assignment, sign-in view, reassignment, revocation fallback, governed role revocation, no new functions/widget data/drill-downs, 11 accounts, seeded auditor dashboard, no page errors).
- PR #33: admin-web 99/99 suites, 1000 tests; targeted backend 76/76 (incl. PR #25 finance-operations specs); HTTP acceptance 37/37 on disposable PostgreSQL (payout reserve/settle/release, commission once, maker/checker, mapping blocker, evidence drift, immutable snapshots); institution scope 22/22; fixture browser harness 17/17 at exact head; real-backend browser harness 11/11 on a fresh disposable DB.
- Clean merge tests onto integration tip: both exit 0, no conflicts. PR #35 clean target diff = 3 files, +78/-33. PR #33 clean target diff = 42 files, +9064/-46 (identical to its diff against merge base 4c007f0). Naive two-dot `integration..#33` shows 172 files/+9367/-24318 only because the PR base is stale; retargeting is recommended but NOT performed.

## Outstanding decisions

1. Retarget PR #33 base from `arena/76e596b2-monienaija` to `arena/5-main-web-integration` (clean; needs owner approval).
2. PR #33 draft state / browser evidence: the PR's committed browser JSON was generated at `3c26f7c`, not the current head; the review's fixture and real-backend browser runs are at `f729f18`. Decide whether to replace attached evidence.
3. Required-check status cannot be read from branch protection with this token (403); workflow jobs are all green.
4. Both PRs must remain unmerged.
