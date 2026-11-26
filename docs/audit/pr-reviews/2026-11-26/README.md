# Independent Admin Web PR review — 2026-11-26

Integration tip: `arena/5-main-web-integration` @ `85b8a953eb3563d800f5a50118c4dddbdaf04965`.
Both PRs were reviewed in separate detached worktrees against separate disposable PostgreSQL clusters.
Neither branch, PR base, fixture password, ledger, payout or mobile code was changed. Both PRs remain OPEN and UNMERGED.

| PR | Head | Verdict | Detail |
| --- | --- | --- | --- |
| #35 Dashboard Assignment | `871410000514972a1c8819ff7e7ac42cbc88b798` | **READY** (optional base refresh; clean merge) | [PR-35-verdict.md](PR-35-verdict.md) |
| #33 Platform Funds vs. Bank Balance | `f729f185d2cd4c4f4c6626acd8c165b7b8885320` | **FUNCTIONALLY READY — HOLD** for base retarget, evidence refresh, draft decision | [PR-33-verdict.md](PR-33-verdict.md) |

Evidence is kept strictly separate:

- `pr35-browser-real/` — real Nest API + real workforce sessions + Chromium, 26/26 at the #35 head.
- `pr33-browser-fixture/` — fixture/stubbed API browser run, 17/17 at the #33 head (no server claims).
- `pr33-browser-real/` — real Nest API + Chromium browser run, 11/11 at the #33 head on a fresh disposable DB.
- `pr33-http/` — disposable-PG HTTP acceptance (37/37) and institution-scope acceptance (22/22).

[00-checkpoint.md](00-checkpoint.md) records the exact refs, CI run links and clean-merge trees used during the review.
