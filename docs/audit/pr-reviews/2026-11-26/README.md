# Independent Admin Web PR review — 2026-11-26 (refreshed)

Latest integration tip reviewed: `arena/5-main-web-integration` @ `39e0811d928c54537d120a5efad94cc76afb71ca`
(the earlier review used `85b8a953eb3563d800f5a50118c4dddbdaf04965`). Both PRs were reviewed in
separate detached worktrees against separate disposable PostgreSQL clusters. No live bank call, payout,
ledger adjustment, mobile change, password change, or merge was made. **Both PRs remain OPEN, DRAFT
and UNMERGED.**

| PR | Original head | Current head | Target | Verdict |
| --- | --- | --- | --- | --- |
| #35 Dashboard Assignment | `871410000514972a1c8819ff7e7ac42cbc88b798` | unchanged | `39e0811d…` | [READY](PR-35-verdict.md) — newer tip does not change the clean merge result |
| #33 Platform Funds vs. Bank Balance | `f729f185d2cd4c4f4c6626acd8c165b7b8885320` | retarget candidate `e96a984962e2c04b4d8af7de11bfaac76c4c0ffe` | `39e0811d…` (base changed) | [FUNCTIONALLY READY — HOLD for owner merge authorisation](PR-33-verdict.md) |

## Refreshed #33 retarget

- Direct `merge-tree` of `f729f185…` onto the new tip was **not clean**: 10 files conflicted because
  integration PR #23 advanced the migration head from `0805` to `0807` while #33 pinned `0813`.
- Conflicts were resolved in a throwaway worktree into candidate `e96a9849…`, preserving both
  integrated Finance migrations `1785753600806/0807` and the Platform Funds migration `1785753600813`.
- Candidate diff against the new tip is the same 42-file Platform Funds change as the original PR
  (`+9068/−51`; original `+9064/−46`, extra lines are the preserved integrated migration identities).
  It contains no node_modules/gitlink, generated evidence rewrite, or unrelated source change.
- PR #33 base was changed with the GitHub REST API because `gh pr edit` fails on a Projects-classic
  deprecation. Head branch was advanced by a fast-forward push of the merge-resolution commit.
- Real-nest-browser evidence was rerun on the exact candidate and is primary. The older fixture/stub
  browser run remains in the packet but is explicitly labelled non-authoritative.

Evidence is strictly separated:

- `pr35-browser-real/` — real Nest API + real workforce sessions + Chromium, 26/26 at the #35 head.
- `pr33-browser-fixture/` — **fixture/stubbed API**, 17/17 at the original #33 head; proves only UI behaviour,
  explicitly **not** backend correctness. Historical, non-primary.
- `pr33-browser-real/` — real Nest API + Chromium at the original #33 head, 11/11 on a fresh disposable DB.
- `pr33-http/` — disposable-PG HTTP acceptance (37/37) and institution scope (22/22), original head.
- `pr33-combined-candidate/` — **primary** real-nest browser (11/11), HTTP (37/37) and institution scope
  (22/22) at retarget candidate `e96a9849…` integrated with #25 and #23.

[00-checkpoint.md](00-checkpoint.md) records exact refs, CI runs, clean/conflicted merge trees and commands.
