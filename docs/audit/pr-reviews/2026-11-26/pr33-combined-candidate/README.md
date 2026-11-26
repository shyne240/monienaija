# PR #33 retarget candidate evidence (primary)

Tree: `e96a984962e2c04b4d8af7de11bfaac76c4c0ffe`
Target: `arena/5-main-web-integration` @ `39e0811d928c54537d120a5efad94cc76afb71ca`
Original PR head: `f729f185d2cd4c4f4c6626acd8c165b7b8885320`

Everything here was generated on disposable PostgreSQL with synthetic records only. No live bank call,
payout, ledger adjustment, or password change occurred.

| File | What it proves |
| --- | --- |
| `browser-report.json` | **Primary**: 11/11 real-backend browser checks through the production Admin Web bundle against a real Nest API and a freshly migrated DB. Includes independent checker approval, 11 accounts unchanged, zero page errors. `gitHead` in the report is the candidate SHA above. |
| `pf-real-*.png` | Four screenshots from that real-backend browser run (created, timing explained, submitted, approved). |
| `platform-funds-http-acceptance.json` | 37/37 HTTP checks on a fresh disposable migrated DB; payout reserve/settle/release conservation, commission counted once, governed maker/checker, mapping blocker, evidence drift, immutable snapshots. |
| `platform-funds-institution-scope-acceptance.json` | 22/22 institution-scope HTTP checks, including 404 anti-probe after grant revocation. |

The older `../pr33-browser-fixture/` run (17/17) is **stubbed fixture evidence**: the API was intercepted
in the browser network layer. It is historical UI evidence only, not proof of the backend, and is
superseded by this directory. `../pr33-browser-real/` is the equivalent real-backend run at the original,
pre-retarget PR head; this directory repeats it on the integrated candidate tree.
