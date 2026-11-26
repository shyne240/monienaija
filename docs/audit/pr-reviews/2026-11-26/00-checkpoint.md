# Checkpoint — Admin Web PR review (2026-11-26, refreshed)

Both PRs remain OPEN, DRAFT and UNMERGED. Review branch `arena/908c9055-monienaija` advanced to the
committed review packet; the only later change to GitHub was the explicitly requested PR #33 retarget
and candidate head push.

## Exact refs

| Item | SHA / ref |
| --- | --- |
| Original integration baseline | `85b8a953eb3563d800f5a50118c4dddbdaf04965` |
| Latest integration tip | `39e0811d928c54537d120a5efad94cc76afb71ca` |
| PR #35 head (unchanged) | `871410000514972a1c8819ff7e7ac42cbc88b798` |
| PR #35 merge base with original tip | `f1a51dd818e1fdca16596351d9c760970dcdc7e4` |
| PR #35 clean merge tree on new tip | `a1e9a3a4235c1c61a7a667db35ebc98ab0261fb4` |
| PR #33 original head | `f729f185d2cd4c4f4c6626acd8c165b7b8885320` |
| PR #33 original base (PR #25 head) | `4c007f007bbaa20596a16efdf154361aed7b1589` |
| Finance #25 integration merge | `7ecbb71522a2092ea2e0f0cb9a7f4a36200414e5` |
| PR #33 conflicted tree on new tip | `2054e920f35da4a899fae413d5e3067cb214d75d` |
| PR #33 retarget candidate head | `e96a984962e2c04b4d8af7de11bfaac76c4c0ffe` |
| PR #33 clean target diff (candidate) | 42 files, +9068/−51 |

## CI

- PR #35 at exact head `87141000…`: https://github.com/shyne240/monienaija/actions/runs/45814306693 — all 8 jobs SUCCESS (also 45814297592).
- PR #33 at original head `f729f185…`: https://github.com/shyne240/monienaija/actions/runs/45736462417 — all 8 jobs SUCCESS (also 45736456064).
- PR #33 updated candidate `e96a9849…`: https://github.com/shyne240/monienaija/actions/runs/45856239360 (push run https://github.com/shyne240/monienaija/actions/runs/45856227480).
  At last check: Classify changes, Customer Mobile, Backend lint/format/build/unit, Agent Mobile, Admin Web,
  Backend container images, Backend isolated PostgreSQL suites all SUCCESS; Backend real PostgreSQL integration
  still running. Final outcome to be recorded when it completes.
- Branch-protection API returned 403; required contexts cannot be read. Workflow jobs inferred from
  `.github/workflows/ci.yml`: Classify changes; Backend lint/format/build/unit; Backend real PostgreSQL
  integration; Backend container image builds; Backend isolated PostgreSQL suites; Admin Web types/tests/build;
  Agent Mobile types/tests; Customer Mobile types/tests.

## Merge/retarget notes

- New integration commits between `85b8a953…` and `39e0811d…` are Transaction History work (#23, plus
  later merges). None touch #35’s three files; `merge-tree` onto the new tip exits 0, tree `a1e9a3a4…`,
  same 3-file +78/−33 delta. No affected-check rerun was required by the merge result.
- #33 direct retarget onto the new tip conflicts in 10 files because #23 advanced the schema head to
  `0807` while #33 pins `0813`. Resolution preserves `0805 → 0806 → 0807 → 0813` and a 172-migration
  inventory. Candidate diff contains only the original Platform Funds paths plus the updated head pins.
- PR #33 base changed with REST API; `gh pr edit` fails on GitHub Projects-classic deprecation.
  Head branch fast-forwarded from `f729f185…` to `e96a9849…`. No merge or close was performed.

## Independent results (all on disposable PostgreSQL, synthetic data)

- PR #35: Admin Web 105/1074 suites/tests, dashboard PG integration 47/47, targeted backend 83/83,
  real-session browser 26/26; 11 accounts and scopes unchanged.
- PR #33 original head: Admin Web 99/1000, targeted backend 76/76, HTTP 37/37, institution scope 22/22,
  real-browser 11/11, fixture browser 17/17 (stubbed, historical only).
- PR #33 candidate: Admin Web 107/1088, targeted backend 76/76, migration inventory 10/10,
  9 touched integration suites/144 tests, HTTP 37/37, institution scope 22/22, real-browser 11/11.
  All evidence at the candidate is in `pr33-combined-candidate/`.

## Outstanding

1. Owner authorisation is still required before either PR may be merged; both remain draft.
2. The PR’s committed fixture browser JSON predates the reviewed head; refreshed real-backend evidence is
   primary and the fixture evidence is explicitly labelled historical/non-authoritative.
3. GitHub required-check list remains unverifiable (403); workflow job statuses are reported instead.
