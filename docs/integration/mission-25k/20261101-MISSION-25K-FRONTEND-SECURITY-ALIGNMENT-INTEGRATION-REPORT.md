# MISSION 25K — FINAL FRONTEND SECURITY ALIGNMENT INTEGRATION (Arena 3)

**Controlled integration and independent verification. Not feature development.**

- Mission: 25K — integrate Mission 25J's Admin Web customer-preference security alignment into the
  Mission 25H backend security integration candidate, and produce **one pinned backend-and-frontend
  candidate for independent reassessment by Arena 4**.
- Date of execution: 2026-11-01 (Africa/Lagos).
- Executed by: Arena 3 agent, on branch `integration/mission-25k-frontend-security-alignment`.
- Verdict, gate results, evidence paths and the Arena 4 readiness statement are in §A–§K below.

---

## §A — Verdict

**PASS — integration correct and fully verified. Two frontend security findings (F-25H-01, F-25H-02)
are closed. Arena 4 independent reassessment may proceed on the pinned candidate.**

Explicitly **not** claimed here:

- This is **not** a production-readiness determination.
- This is **not** final security acceptance — that is Arena 4's determination.
- The **carried product-policy blockers H-04, H-06, H-07 and the workforce-preference denial
  decision are preserved unchanged and are NOT resolved by this mission** (§I).

Why PASS rather than CONDITIONAL PASS: every gate specified for 25K ran to completion with exact
counts recorded, zero failures, zero skips and zero non-zero exit codes (§G); the two findings that
drove the 25H CONDITIONAL PASS verdict are now demonstrably closed at source, at unit level, and in
a real browser across all 11 workforce roles (§E, §H); and no backend, authorization, migration,
provider, ledger or role behaviour changed (§D).

---

## §B — Branch and pushed SHA

| Item | Value |
| --- | --- |
| Integration branch | `integration/mission-25k-frontend-security-alignment` |
| Base (exact 25H pin) | `5d034163b366a92e45397e261762df77ea56ea09` |
| Integrated commit (exact 25J pin) | `1049280e0615abe82ebafdde224e7a283ce553b1` |
| **Integration merge commit** | **`587c3763944368b9260c9299d18bce1189ca5919`** |
| Merge parents | `5d03416` (25H baseline) + `1049280` (25J) |
| **Code candidate SHA (composed tree)** | **`587c3763944368b9260c9299d18bce1189ca5919`** |
| Evidence/report commits | one or more **docs-only** commits after `587c376` |
| Branch tip at hand-off | `1818f0ad17bbe0c85a31a2930931db4e0afee25b` — remote verified equal via `git ls-remote` |
| Merge conflicts | none (0) |
| Integration-only corrections | none (0) |

The branch was created **from the exact 25H pinned baseline**, not from any later tip. Because 25J
is a verified **direct child** of that baseline, the integration is fast-forward-equivalent; a
`--no-ff` merge was used **only** to record the integration event with both parents explicitly
(`git diff --name-only 1049280 HEAD` = 0 files, tree identical, `31af770…`).

The merge commit is annotated with the full rationale, including that it introduces **no**
integration-only corrections.

**Two SHAs, one candidate — read this before reassessing.** Arena 4's *code* candidate is
`587c376…`: the merge of `5d03416…` with `1049280…`. The branch tip `3666fce…` adds **only** this
report and its evidence files. `git diff --name-only 587c376 <tip> -- src apps test` = **0 files**,
so the composited application tree under review is byte-identical to `587c376…`; reviewing either
SHA yields the same code. This mirrors the 25H hand-off, where the evidence commit followed the
integration merge on the same branch.

### Pre-existing branches preserved (remote tips re-read after the push)

| Branch | Tip | Status |
| --- | --- | --- |
| `main` | `39a9e504e3881911c94438321e7c60f771469d21` | untouched |
| `integration/mission-23-fast-uri-security` (Ordinary Agent V1 baseline) | `019de996950b07e9312af455ce0d9b840e6e14f1` | untouched, preserved |
| `integration/mission-25h-customer-preference-security` | `5d034163b366a92e45397e261762df77ea56ea09` | untouched, preserved |
| `arena/ea070127-monienaija` (25J source) | `1049280e0615abe82ebafdde224e7a283ce553b1` | untouched, preserved |
| `integration/mission-25k-frontend-security-alignment` (new) | `587c3763944368b9260c9299d18bce1189ca5919` | new |

No merge into `main`. No force-push. No history rewrite. Every prior pin is byte-identical to the
value declared before this mission.

---

## §C — Ancestry verification (independently re-derived, before integrating)

All three authoritative pins were re-read from the remote and matched the declared values **before**
any branch was created:

| Pin | Declared | Observed | Match |
| --- | --- | --- | --- |
| 25H baseline | `5d034163b366a92e45397e261762df77ea56ea09` | same | ✅ |
| 25J hand-off commit | `1049280e0615abe82ebafdde224e7a283ce553b1` | same | ✅ |
| Ordinary Agent V1 baseline | `019de996950b07e9312af455ce0d9b840e6e14f1` | same | ✅ |

Ancestry was proven, not assumed:

- `git rev-list --parents -n 1 1049280` → **exactly one** parent: `5d03416`. 25J is a **direct
  child** of the 25H baseline; it is not a merge and not a rebase of unrelated work.
- `git merge-base --is-ancestor 5d03416 1049280` → **true**.
- `git rev-list --count 5d03416..1049280` → **1** (no intermediate commits, nothing smuggled in).
- `git merge-base 5d03416 1049280` → `5d03416` itself.

Committing identity/authz metadata of 25J: author `shyne240`, `Sun Nov 1 15:10:41 2026 +0000`,
co-authored `arena-agent`.

**No material discrepancy was found in Phase A**, so the mission proceeded.

Evidence: `evidence/ancestry-verification.txt`.

---

## §D — Changed-file inventory and method

Range verified: `5d03416` (25H pin) → `587c376` (integration head).

| Status | Path |
| --- | --- |
| M | `apps/admin-web/__tests__/customer-personal-information.test.tsx` |
| M | `apps/admin-web/src/screens/authenticated/CustomerPersonalInformationPanel.tsx` |
| M | `apps/admin-web/src/services/notification-domain.ts` |
| M | `apps/admin-web/src/services/notification-management-api.ts` |
| A | `docs/integration/mission-25j/20261101-MISSION-25J-HANDOVER.md` |

**Totals: 5 files, 261 insertions, 355 deletions (net −94).**

Method: `git diff --name-status` and `git diff --stat` between the two pins, plus per-path guard
counts over the same range restricted to each guarded path.

Scope guards — all **0**:

| Guarded path | Changed files |
| --- | --- |
| `src/` (backend) | 0 |
| `test/` (backend tests) | 0 |
| `scripts/` | 0 |
| `src/migrations/` | 0 |
| `docs/deployment/` | 0 |
| root `package.json` / `package-lock.json` | 0 / 0 |
| `apps/admin-web/package.json` / lock | 0 / 0 |
| `.env.example` | 0 |

Consequences confirmed: **no backend, authorization, migration, provider, ledger or role change**
reaches this candidate. The backend is bit-identical to the 25H candidate that was already
independently verified. Only the Admin Web presentation/test layer and one hand-over document moved.

Evidence: `evidence/changed-file-inventory.txt`.

---

## §E — F-25H-01 / F-25H-02 closure evidence

### F-25H-01 — Admin Web issued workforce preference requests that the backend denies

**Closed at source.** `NotificationManagementApi.getCustomerPreferences()` and
`listCustomerPreferenceHistory()` are deleted (not gated — deleted), and the corresponding
`CustomerCommunicationPreferences` / `CustomerPreferenceHistoryRecord` domain types are removed from
`notification-domain.ts`. The `CustomerPersonalInformationPanel` no longer contains any preference
fetch, preference state, or value/history rendering path.

Dangling-symbol scan over `apps/admin-web/src` — **0 occurrences** for every retired symbol:

`getCustomerPreferences`, `listCustomerPreferenceHistory`, `customer-preferences-denied`,
`customer-preferences-empty`, `customer-preferences-section`, `customer-preference-history-list`,
`customer-pref-*`.

The only remaining occurrences of these names anywhere in the app are **negative assertions** in
`__tests__/customer-personal-information.test.tsx` (`expect(...).toBeNull()`,
`expect('getCustomerPreferences' in NotificationManagementApi).toBe(false)`), i.e. the test now
*forbids* their return.

**Closed dynamically.** In the real 11-role browser matrix the Admin Web issued
**exactly 0** customer-preference requests of any method on any visited surface, per role and in
aggregate (`totalPreferenceRequests: 0`).

### F-25H-02 — Stale `customer.view` / "operational and privileged" visibility claim

**Closed at source.** The preference card no longer describes a workforce visibility model. It now
renders a static enforced-restriction notice whose text is asserted exactly:

> Customer preferences are restricted to authenticated customers accessing their own records.
> Workforce preference access is not authorized.

The stale subtitle "Mandatory security OTPs bypass channel opt-outs by policy." and the badge/copy
implying `customer.view`-based visibility are gone. The card renders **no** value nodes, **no**
history list, **no** buttons and **no** checkboxes.

**Closed dynamically.** For all 6 roles that can reach Customer 360, the rendered card text is
byte-equal to the expected copy, and contains no `customer.view`, no "operational and privileged",
and no "read-only" claim. Verified simultaneously with a non-vacuous panel-presence assertion.

### Backend authority unchanged and still enforcing

The closure is a **frontend alignment**, not a policy change. The backend still denies all workforce
preference access (verified: 11/11 roles denied on GET/POST/PATCH/history, §F), and customer
self-service continues to work (§H). The frontend now agrees with the backend instead of probing it.

Evidence: `evidence/f-25h-closure.txt`, `evidence/browser-results.json`,
`evidence/screenshots/*-preference-card.png`.

---

## §F — Backend authorization regression (real HTTP, real PostgreSQL)

Harness: `evidence/harness/authz.cjs` — 13 principals authenticated through the **real login
endpoints** (11 single-role workforce identities, 2 customers), plus SUPPORT and AGENT sessions.

**Result: 105 / 105 checks passed, 0 failed, exit code 0** (identical to the 25H baseline —
expected, because no backend file changed).

Coverage re-confirmed in this candidate:

- **Self-only access** — a customer may read/update only its own preference record; `SELF` +
  identity match enforced, with defence-in-depth in the controller.
- **Cross-customer denial** — customer B on customer A's id → 403 for GET, POST, PATCH, history;
  the denial is **identical for a non-existent customer id** (no enumeration oracle).
- **All 11 workforce roles denied** — GET, POST, PATCH and history each denied for every role.
- **AGENT and SUPPORT denied** — non-customer principal types rejected on the preference routes.
- **Encoded / alternate-path probes denied** — percent-encoded static segment, trailing slash,
  encoded slash in the descendant, extra descendant segment, query string, `/customers/me`
  alias, non-UUID id, alternate method `PUT`.
- **Anonymous → 401** on every method.
- **Actor attribution** — history and audit actor is the **validated session identity**, never a
  body-supplied or header-supplied actor; spoofed `actor` in the body is ignored.
- **Spoofing** — session/principal binding cannot be redirected by request content.
- **Generic-audit disclosure** — preference-route authorization decisions exist in PostgreSQL but
  are **not** exposed through generic audit HTTP; audit projections contain no per-customer
  preference values.

Evidence: `evidence/authz-results.json`.

---

## §G — Full test results (exact counts, failures, skips, exit codes)

Environment: Node 22, disposable embedded PostgreSQL 18.4 on 5432, `NODE_ENV=development`,
synthetic fixtures only. PG matrix deliberately run at `PG_TEST_CONCURRENCY=1`.

| # | Gate | Command | Result | Failures | Skips | Exit |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Backend TypeScript | `npx tsc --noEmit` | clean | 0 | 0 | **0** |
| G2 | Backend build | `npm run build` (nest build) | clean | 0 | 0 | **0** |
| G3 | Backend unit | `npm test` | **229 / 229 suites, 2,713 / 2,713 tests** | 0 | 0 | **0** |
| G4 | PostgreSQL integration | `PG_TEST_CONCURRENCY=1 node scripts/run-pg-integration-tests.js` | **132 / 132 suites, 2,452 / 2,452 tests, 9 / 9 batches** | 0 | 0 | **0** |
| G5 | Admin Web TypeScript | `npm run ts:check` | clean | 0 | 0 | **0** |
| G6 | Admin Web build | `npm run build` (vite build) | clean | 0 | 0 | **0** |
| G7 | Admin Web Jest | `npm test` | **37 / 37 suites, 284 / 284 tests** | 0 | 0 | **0** |
| G8 | Targeted 25J suite | `npx jest __tests__/customer-personal-information.test.tsx` | **10 / 10 tests** | 0 | 0 | **0** |
| G9 | Backend authz regression | `node evidence/harness/authz.cjs` | **105 / 105** | 0 | 0 | **0** |
| G10 | Notification regression | `node evidence/harness/notification.cjs` | **15 / 15** | 0 | 0 | **0** |
| G11 | Support recipient binding | `node evidence/harness/support.cjs` | **5 / 5** | 0 | 0 | **0** |
| G12 | 11-role real browser | `node evidence/harness/browser-25k.cjs` | **75 / 75** | 0 | 0 | **0** |

### Ordinary Agent V1 financial / security coverage (preserved baseline `019de99…`)

The Agent V1 baseline is **preserved** (`019de99…` untouched, §B) and its suites ran inside the two
full gates above, not in isolation — so the integration is shown not to regress them:

- Unit: `test/v1-test-01-agent-cash-to-cash-retry-exhaustion.spec.ts` and the surrounding V1 agent
  suites pass inside the 229/2,713 unit result.
- PostgreSQL integration: `a13-agent-cash-in`, `a14-agent-cash-out`, `a15-agent-cash-to-cash`,
  `a16-agent-cash-to-cash-claim`, `a17-agent-cash-to-cash-expiry`, `v1-agent-history-01`,
  `phase1-agent-security`, `v1-commercial-decision-03e-agent-funding-snapshot` — all pass inside the
  132/2,452 result.

No agent, ledger or financial file was modified by this mission (0 files in `src/`), so these
results are the same code paths the 25H candidate already exhibited.

### Deltas vs the 25H baseline (which backend is identical to)

| Gate | 25H | 25K | Delta |
| --- | --- | --- | --- |
| Backend unit | 229 suites / 2,713 tests | 229 / 2,713 | 0 (backend untouched) |
| PG integration | 132 suites / 2,452 tests | 132 suites / 2,452 tests | expected 0 |
| Admin Web Jest | 37 suites / 284 tests | 37 / 284 | 0 (test count preserved, assertions strengthened) |
| Backend authz | 105 / 105 | 105 / 105 | 0 |
| Notification | 15 / 15 | 15 / 15 | 0 |
| Support binding | 5 / 5 | 5 / 5 | 0 |

The Admin Web suite keeps the **same** 37/284 totals: 25J **replaced and strengthened** the
preference assertions (one 11-role matrix test with GET/POST/PATCH/DELETE absence assertions +
explicit retirement test) rather than deleting coverage. This was verified by reading the test diff,
not merely by counting.

Evidence: `evidence/test-summary.json`.

---

## §H — Real-browser and real-API evidence

### H.1 — 11-role real browser (headless Chromium 153.0.8010.0, real login form, real backend, real PG)

6 roles reach Customer 360 and its preference surface; 5 have no Customers navigation for their
scope set (expected, unchanged RBAC):

| Role | Customers nav | Preference panel state | Notification console |
| --- | --- | --- | --- |
| SUPER_ADMIN | yes | `RESTRICTED-COPY` | `CONSOLE` |
| FINANCE_AUDITOR | yes | `RESTRICTED-COPY` | `CONSOLE` |
| ADMINISTRATOR | yes | `RESTRICTED-COPY` | `NOT-EXPOSED` |
| OPERATIONS | yes | `RESTRICTED-COPY` | `CONSOLE` |
| COMPLIANCE | yes | `RESTRICTED-COPY` | `NOT-EXPOSED` |
| CUSTOMER_SERVICE | yes | `RESTRICTED-COPY` | `NOT-EXPOSED` |
| FINANCE_PREPARER | no (`NO-CUSTOMERS-NAV`) | n/a | `NOT-EXPOSED` |
| FINANCE_CONTROLLER | no (`NO-CUSTOMERS-NAV`) | n/a | `CONSOLE` |
| AGENT_NETWORK_MANAGER | no (`NO-CUSTOMERS-NAV`) | n/a | `NOT-EXPOSED` |
| RISK_FRAUD | no (`NO-CUSTOMERS-NAV`) | n/a | `NOT-EXPOSED` |
| TREASURY | no (`NO-CUSTOMERS-NAV`) | n/a | `NOT-EXPOSED` |

Asserted for the specified acceptance criteria, in aggregate:

- **Zero workforce preference GET/history requests** across all 11 roles → `totalPreferenceRequests = 0`.
- **Zero unauthorized mutations** — no POST/PATCH/DELETE to any preference route was observed.
- **Zero preference values rendered** — no `customer-pref-*` node, no value/history/denied/empty
  node, and no value-shaped text (`en-NG`, `SYSTEM`, `v<n>`, `Enabled`, `Disabled`, alert names) in
  the card.
- **Correct restricted copy** — exact-string match for all 6 panel-reaching roles.
- **No stale `customer.view` claim** — asserted absent from the rendered card.
- **No unnecessary 403** — zero HTTP 400/403/500 responses on the visited surfaces, for every role.
- **No uncaught JS error** — zero page errors and zero console errors for every role.
- **Customer 360 non-preference content intact** — profile/contact/address/identity sections still
  render for the 6 panel-reaching roles.
- **Notification RBAC unchanged** — console exposed for 4 roles and withheld for 7; not collapsed.
- **Non-vacuity guard** — every negative assertion is paired with a positive panel-presence
  assertion, so a missing panel cannot make the "no values rendered" check pass vacuously.

Evidence: `evidence/browser-results.json`, `evidence/screenshots/` (11 page screenshots + 6
element-crop cards + notification console + H-04 receipt filter).

### H.2 — Customer self-service over real HTTP

The customer path still works end-to-end against the integrated candidate (this is the side of the
policy the frontend must not break):

- `POST /customers/{id}/preferences` on a **virgin** customer → **201**, with a spoofed `actor` in
  the body supplied deliberately and ignored.
- `GET /customers/{id}/preferences` → **200**, returns the values just created (and **404** before
  creation, i.e. genuinely absent, not silently empty).
- `PATCH /customers/{id}/preferences` → **200**, change persisted and read back.
- `GET /customers/{id}/preferences/history` → **200**, history contains the create and the update
  with **actor = the authenticated customer principal**.
- `GET /customers/me` and `GET /customers/me/profile` → **200** (session unaffected).

### H.3 — H-04 auxiliary re-check

The 25E/25H outbox-receipt recheck was re-executed against this candidate. The `QUARANTINED` filter
still exists and `MATERIALIZED` still appears in the section-level textContent (the known 25E
measurement artefact), while the **data rows** contain no `MATERIALIZED` row — the same conclusion
recorded in 25H. On this virgin disposable database the quarantine data set itself does not exist
(`receiptRowCount = 0`), so **H-04's underlying 4 quarantined deposit/withdrawal events were not
re-materialised and remain carried as documented, not fixed and not re-created.**

Evidence: `evidence/recheck-results.json`.

---

## §I — Outstanding defects vs product-policy blockers

Nothing in the table below is introduced, worsened or "solved" by 25K. All are preserved as-is, per
instruction; no policy decision was invented or implemented.

| ID | Class | Status after 25K | Owner |
| --- | --- | --- | --- |
| F-25H-01 | Frontend defect (was blocking) | **CLOSED** — no workforce preference request exists in code or at runtime | closed by 25J/25K |
| F-25H-02 | Frontend defect (was blocking) | **CLOSED** — stale `customer.view` claim removed and asserted absent | closed by 25J/25K |
| Workforce preference access | **Product/security policy decision** | Preserved: all workforce access denied. **No** workforce preference UI, API client or route was added. | product/security |
| H-04 | Backend/data (carried) | Preserved as documented: 4 deposit/withdrawal events remain quarantined in the original dataset; this virgin DB does not contain them | Arena 2 |
| H-06 | Backend (carried) | Preserved unchanged: trigger-lock disagreement | Arena 2 |
| H-07 | Backend/config (carried) | Preserved unchanged: `ENV_SECRET` binding unimplemented; blocks external-provider activation | Arena 2 |

**No new defects were discovered by 25K. No defects were fixed other than the two assigned findings
via the prior 25J commit.**

Known and accepted limitations of this evidence base (unchanged from 25H, restated so Arena 4 does
not over-read this report):

- Verification uses **synthetic identities and synthetic fixtures** in a disposable database.
- Notifications ran with a **fake/local transport**; no live SMS/email was sent and no external
  provider was activated.
- H-04/H-06/H-07 require backend work owned by Arena 2 and were intentionally not addressed.

---

## §J — Committed hand-over and evidence paths

All evidence is committed on the integration branch (nothing is left only in the sandbox):

| Path | Contents |
| --- | --- |
| `docs/integration/mission-25k/20261101-MISSION-25K-FRONTEND-SECURITY-ALIGNMENT-INTEGRATION-REPORT.md` | this report |
| `docs/integration/mission-25k/evidence/ancestry-verification.txt` | pins, parenthood, tree identity of the merge |
| `docs/integration/mission-25k/evidence/changed-file-inventory.txt` | name-status, diffstat, scope guards, method |
| `docs/integration/mission-25k/evidence/f-25h-closure.txt` | F-25H-01/F-25H-02 source + runtime closure |
| `docs/integration/mission-25k/evidence/test-summary.json` | every gate with exact counts and exit codes |
| `docs/integration/mission-25k/evidence/authz-results.json` | 105-check backend authorization matrix |
| `docs/integration/mission-25k/evidence/browser-results.json` | 75-check 11-role real-browser matrix |
| `docs/integration/mission-25k/evidence/notification-results.json` | 15-check notification regression |
| `docs/integration/mission-25k/evidence/support-results.json` | 5-check support recipient binding |
| `docs/integration/mission-25k/evidence/recheck-results.json` | H-04 auxiliary re-check |
| `docs/integration/mission-25k/evidence/harness/` | all harnesses as executed (`browser-25k.cjs`, `authz.cjs`, `notification.cjs`, `support.cjs`, `fixtures.cjs`, `recheck.cjs`) |
| `docs/integration/mission-25k/evidence/screenshots/` | real-browser screenshots incl. per-role preference cards |

No credential, token or password is committed: the 11-role credential manifest and the
support/agent principal file stay **outside** the repository (mode 600). Harnesses contain no
secrets.

---

## §K — Operational-boundary confirmation

| Boundary | Confirmation |
| --- | --- |
| Production deployment | **None.** No deployment, no release, no environment promotion. |
| Live SMS / email | **None.** Notification verification used the local/fake transport; no message left the sandbox. |
| External providers | **Not activated.** No provider credential was supplied or used. |
| `main` | **Not merged to.** `main` remains `39a9e504…`. |
| Git history | **Not rewritten.** No force-push, no rebase, no reset of any pushed branch. |
| Existing integration branches | **Preserved** at their exact pinned commits (§B). |
| Ordinary Agent V1 baseline | **Preserved** at `019de996950b07e9312af455ce0d9b840e6e14f1`. |
| Databases | **Disposable only.** Embedded PostgreSQL in a temporary data directory, dropped with the process. |
| Production data | **Never touched.** Fixtures are synthetic (`m25h-cust-000*`, `m25k-support`, synthetic agent). |
| Policy changes | **None.** H-04/H-06/H-07 and the workforce-preference denial decision are documented, not implemented. |
| Application-code changes beyond the assignment | **None.** Zero backend file changed; zero dependency/lockfile changed. |

---

## Arena 4 — explicit readiness statement

> **The pinned candidate `587c3763944368b9260c9299d18bce1189ca5919` (code composition; branch
> `integration/mission-25k-frontend-security-alignment`, tip `1818f0a…` adding evidence only) is
> READY FOR ARENA 4 INDEPENDENT REASSESSMENT.**
>
> It is the exact composition of the Mission 25H backend security integration candidate
> (`5d03416…`) with the Mission 25J Admin Web customer-preference security alignment (`1049280…`),
> containing no other implementation change. Every gate specified for this mission executed to
> completion with zero failures, zero skips and zero non-zero exit codes, and the two frontend
> findings that previously blocked acceptance (F-25H-01, F-25H-02) are closed at source, at unit
> level and in a real browser across all 11 workforce roles.
>
> This statement is **readiness for reassessment only**. It is **not** production readiness and
> **not** an acceptance determination; acceptance, and the disposition of carried blockers H-04,
> H-06, H-07 and the workforce-preference policy decision, remain Arena 4's.
