# Mission 25H — Customer-preference security remediation: integration and independent verification

**Prepared by:** Arena 3
**Date:** 2026-11-01
**Candidate:** `integration/mission-25h-customer-preference-security` at `34f05fee6cacacf5dce61885ef3978b6f115a5d3`
**Purpose:** produce a pinned integration candidate suitable for Arena 4 independent security reassessment.

## Verdict

> ## CONDITIONAL PASS — WITH EXPLICIT LIMITATIONS

The Mission 25G backend correction is **integrated unmodified** and the customer-preference
authorization defect found by Mission 25F is **remediated and independently verified** at the
HTTP layer with real guards and real PostgreSQL: **105/105** authorization checks passed, covering
all 11 workforce roles, real AGENT and SUPPORT principals, cross-customer attempts, encoded and
alternate-route probes, actor-spoofing, and generic audit projections. No material incompatibility
was found in Phase A, and no integration-only code correction was required.

The conditions are:

1. **One frontend incompatibility (F-25H-01, Arena 2).** The Admin Web still requests customer
   preferences for workforce roles that the corrected backend now refuses. Every such visit
   produces four HTTP 403s and shows the documented "403" state. No data leaks and no 500 occurs,
   but the interface is performing and advertising an access the policy does not grant.
2. **Stale policy copy (F-25H-02, Arena 2).** `CUSTOMER_SERVICE` is still told that preference
   visibility belongs to "authorized operational and privileged workforce roles with
   `customer.view`" — a statement that is now false.
3. **H-04, H-06 and H-07 remain unresolved** (carried, deliberately unchanged) and continue to
   block their respective capabilities.

No production deployment, provider activation, live send, policy change or `main` merge was
performed. This candidate is **not** production-ready and this report is **not** independent
security acceptance — that is Arena 4's role.

---

## A. Integration branch and pinned final SHA

| Item | Value |
| --- | --- |
| Integration branch | `integration/mission-25h-customer-preference-security` |
| **Final SHA** | **`34f05fee6cacacf5dce61885ef3978b6f115a5d3`** (merge commit) |
| Parent 1 (baseline) | `e0d604fad255629a1362c4ff62abd60eb7f85b6f` — Mission 25E |
| Parent 2 (correction) | `0d6d567c8b6aba861f4350fcb07e0bbc96e3fc2b` — Mission 25G |
| Integration-only corrections | **none** |
| Conflicts | **none** |

The merge is content-identical to the pinned 25G commit: `git diff 0d6d567 34f05fe` is empty and
both commits share tree `f9bac70575132e28966240454f752fd31724aa5e`. The merge commit itself adds
only the documentation directory described in this report.

## B. Phase A compatibility and scope findings

Phase A was performed read-only, **before** any integration branch existed.

### B.1 Pins verified as objects and as branch tips

| Role | Ref | Tip | Pinned | Match |
| --- | --- | --- | --- | --- |
| Mission 25E baseline | `integration/mission-25e-notification-integration` | `e0d604f` | `e0d604f` | **yes** |
| Mission 25G correction | `arena/92fd33dd-monienaija` | `0d6d567` | `0d6d567` | **yes** |
| Ordinary Agent V1 baseline | `integration/mission-23-fast-uri-security` | `019de99` | `019de99` | **yes** |

Ancestry: `019de99` → `e0d604f` → `0d6d567`, each verified with `git merge-base --is-ancestor`.
`0d6d567` has **exactly one parent**, `e0d604f` — a genuine direct child, as declared.

### B.2 Scope confirmed as declared

15 files, +3,375/−14: 6 source files (+141/−14), 2 new test files, 7 documentation/evidence files.
Guard checks all returned zero: no `package.json`/lockfile change, **no migration**, **no Admin Web
change**, no authorization-catalogue change, no notification source change, no financial/ledger
change, no `.env` or deployment-config change. No new role, permission or `/me/preferences` alias
was introduced.

### B.3 Assessment reviewed

Mission 25F's full assessment is archived in the correction commit and its SHA-256
(`86f3e0bc…80992ed1`) **reproduces exactly**, so the remediation was designed against the same
document I reviewed. Mission 25G additionally discloses a **second** disclosure path that 25F did
not find — generic audit endpoints and the audit dashboard projected `CUSTOMER_PREFERENCE` and
`PREFERENCE_HISTORY` rows. I re-verified both the primary and this secondary path independently
(§D.4).

### B.4 Semantics verified in source rather than assumed

Three behaviours decide whether this fix is real, so each was read in source and then exercised:

- **An empty principal-type list denies everyone.** `evaluate()` gates on
  `policy.allowedPrincipalTypes && !includes(...)`; `[]` is truthy, so `[]` yields
  `PRINCIPAL_TYPE_DENIED` for every type. This is the branch used when the router parameter does
  not bind to the path — not a permissive fallthrough.
- **Query strings cannot dodge policy.** `resolve()` uses `url.split('?')[0]`, so `?x=1` cannot
  alter route classification.
- **Branch ordering.** The preference branch sits before the generic customer and
  `/customers/me` branches and after public-route/login checks, so neither can shadow it.

### B.5 Compatibility with the Mission 25E notification backend

The only file shared with notification behaviour is `src/operations/audit.service.ts`. The new
preference filter is **additive and default-on**; the notification-provider filter and its
privileged opt-in are untouched. I reviewed every `auditService.list` call site:

| Call site | Effect of the new filter |
| --- | --- |
| `operations.controller.ts` (HTTP) | Applies to all roles — intended |
| `dashboard-widget-data.service.ts` | Applies — intended |
| `maturity.service.ts` | Explicit `includePreferenceRecords` opt-in keeps the limit-1 health presence indicator; in-process only |
| `policy/a7-product-reconciliation.repository.ts` | `entityType`-scoped reconciliation reads; preference types never match — no functional change expected, and the PostgreSQL reconciliation suites pass |

**Result: no material incompatibility. Integration proceeded.**

## C. Integration diff and changed-file inventory

Exactly the 15 files of §B.2; no additional file. Full inventory and graph in
`evidence/integration-inventory.txt`.

Preservation: Mission 25E (`e0d604f`), the Ordinary Agent V1 baseline (`019de99`), the Mission 25G
branch (`0d6d567`) and `main` (`39a9e50`) are all unchanged. No force-push, rebase or history
rewrite.

## D. Independent customer-preference security verification

Method: real HTTP against the built backend, real authentication and authorization guards, real
PostgreSQL. **No mocks.** Every principal used is a genuine persisted account that logged in
through a public application endpoint:

- 11 seeded single-role workforce identities (`POST /internal/a2/workforce/local-admin-sessions`)
- 3 real customers with PBKDF2 credentials (`POST /customers/:id/authenticate`)
- 1 real SUPPORT user provisioned through `SupportAuthenticationService.provision()` and logged in
  via `POST /internal/support/workforce-sessions`
- 1 real AGENT created through the repo's own agent provisioning script, including the mandatory
  first-login credential rotation, then `POST /agents/sessions`

**Result: 105/105 checks passed, 0 failed.**

| Area | Checks | Result |
| --- | --- | --- |
| Customer self-service (create/read/update/history + `/me` regressions) | 11 | pass |
| Cross-customer access, including non-enumerating denial | 5 | pass |
| All 11 workforce roles × GET / history / POST / PATCH | 44 | pass |
| AGENT and SUPPORT principals × 4 endpoints | 8 | pass |
| Anonymous | 4 | pass |
| Encoded paths, alternate methods, route variants (workforce) | 14 | pass |
| Encoded paths, alternate methods, route variants (customer) | 7 | pass |
| Audit actor attribution and spoofing resistance | 3 | pass |
| Generic audit projections | 8 | pass |

### D.1 Required behaviours, each demonstrated

- **Customers may read and modify their own preferences.** A virgin customer went
  404 → **201 create** → **200 read** → **200 update** → history containing both `CREATED` and
  `UPDATED`. Existing self-service (`/customers/me`, `/customers/me/profile`) still returns 200.
- **Customers cannot reach another customer.** GET, history, PATCH and POST against another
  customer all return **403** with no payload. A **non-existent** customer id returns the same 403,
  so denial does not disclose target existence.
- **All 11 workforce roles are denied** GET, history, POST and PATCH — **44/44**, every one 403,
  and no response body contained preference values.
- **AGENT and SUPPORT cannot bypass.** Both are denied on all four endpoints (**8/8**). SUPPORT
  additionally cannot read preference audit data despite its `GET /internal/audit` exemption.
- **Read-only principals cannot mutate.** `FINANCE_AUDITOR` and every other role are refused POST
  and PATCH at the authorization layer before any handler runs.
- **Encoded paths, alternate methods and route variants do not bypass.** As `SUPER_ADMIN`:
  percent-encoded `%70references`, encoded `%63ustomers`, trailing slash, `%2F` inside the
  descendant, extra descendant segment, query string, `/customers/me/preferences`, a non-UUID id,
  `PUT`, `DELETE`, `OPTIONS`, POST/PATCH to the history child and `HEAD` — none returned 2xx and
  none returned preference data (**14/14**). As the owning customer against *another* customer the
  same probes also fail (**7/7**), while the owning customer's own request **with a query string
  still returns 200** — the restriction is precise, not a blanket denial.
- **Audit actor identity comes from the authenticated principal.** A PATCH carrying
  `actor: "spoofed-actor-EVIL"` succeeded (200) but every `preference_histories.actor` row for that
  customer is the **customer UUID**; no preference audit row and no preference-route authorization
  decision carries the spoofed string.
- **Generic audit endpoints disclose nothing.** `GET /internal/audit` as `SUPER_ADMIN` returns no
  `CUSTOMER_PREFERENCE`/`PREFERENCE_HISTORY` rows, no `customer-preference` decisions and no
  preference field names. The same holds for `SUPPORT` and `COMPLIANCE`, and an explicit
  `entityType=CUSTOMER_PREFERENCE` query returns an empty list. **The rows still exist in
  PostgreSQL** (verified by direct SQL) — they are filtered, not deleted — and unrelated audit
  records remain visible, so the projection change is targeted rather than a blanket blackout.
  The operational audit summary exposes no per-customer preference values.

### D.2 What this verification does not establish

Workforce identities are seeded synthetic accounts; no external OIDC provider was contacted. The
verification proves the authorization boundary in this codebase, not the security of a specific
real-world identity provider. No preference-oversight or workforce-read grant is tested because
none exists — that is a policy decision (§G).

## E. Backend, PostgreSQL, Admin Web and real-browser regression results

All suites executed in an isolated environment: disposable embedded PostgreSQL 18.4 on loopback,
unique run/database namespaces, synthetic credentials, no `.env` committed, no live provider
traffic.

| Gate | Suites | Tests | Skipped | Exit | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Backend unit/regression | **229 / 229** | **2,713 / 2,713** | 0 | 0 | pass |
| Backend PostgreSQL matrix | **132 / 132** | **2,452 / 2,452** | 0 | 0 | pass (all 9 batches exit 0) |
| Admin Web Jest | **37 / 37** | **284 / 284** | 0 | 0 | pass |
| Backend TypeScript (`tsc --noEmit`) | — | — | — | 0 | pass |
| Admin Web TypeScript (`tsc`) | — | — | — | 0 | pass |
| Backend build (`nest build`) | — | — | — | 0 | pass |
| Admin Web build (`vite build`) | — | — | — | 0 | pass |
| Customer-preference authorization matrix (real HTTP) | — | 105 | 0 | 0 | pass |
| Notification regression (real HTTP) | — | 15 | 0 | 0 | pass |
| Support-message recipient binding (real HTTP) | — | 5 | 0 | 0 | pass |
| Real-browser role/console/panel matrix | — | 41 | 0 | 0 | pass |
| Auxiliary receipts-filter recheck (re-derived at row level) | — | 12 | 0 | 0 | pass |

Full counts, exits and skips are also recorded machine-readably in `evidence/test-summary.json`.

Baseline comparison for scale: Mission 25E reported 228 unit suites / 2,701 tests, 131 PostgreSQL
suites / 2,433 tests and 37 Admin Web suites / 284 tests. Mission 25H's **+1 unit suite /
+12 tests** is exactly the new Mission 25G policy suite, verified in isolation at
**1 suite / 12 tests**; the second new Mission 25G spec matches only the PostgreSQL test regex and
therefore appears in the PG matrix instead. Admin Web is unchanged at 37/284, as expected —
Mission 25G touched no frontend file.

### E.1 A failure I caused and corrected

My first PostgreSQL run used `PG_TEST_CONCURRENCY=2` on this 2-vCPU/3.8 GB box. Free memory fell
to ~200 MB and `v1-commission-runtime-wiring.integration.spec.ts` timed out at 120 s
(`"percentage FLOOR on the FEE basis"`). I aborted that run, dropped its leftover integration
databases, and re-ran at `PG_TEST_CONCURRENCY=1`; **that same suite then passed in 49.8 s**. The
timeout was resource contention from my own configuration choice, not a product regression, and
the reported matrix is the `concurrency=1` run.

### E.2 Admin Web compatibility, measured across all 11 roles

Real headless Chromium drove the real login form, notification console and Customer 360 panel.

- Notification console reachable for **SUPER_ADMIN, FINANCE_CONTROLLER, FINANCE_AUDITOR,
  OPERATIONS**; **not** exposed for the other 7 — the 11-role RBAC shape is intact.
- **No role renders preference values.**
- **0 uncaught JavaScript errors** and **0 background HTTP 500** across all 11 role sessions.
- 5 roles still emit preference requests and receive **403** (20 refused requests total), shown the
  documented denial state — see F-25H-01.
- `CUSTOMER_SERVICE` emits no request and shows the stale restricted copy — see F-25H-02.

### E.3 Notification regression results (15/15)

Provider fail-closed: `provider-status` reports `NOT_CONFIGURED`; EMAIL `test-send` returns
**400 `PROVIDER_NOT_CONFIGURED`**; SMS resolves to the **console adapter**, which simulates delivery
and contacts no vendor; no provider credential is configured. A separate instance started with
`NOTIFICATION_SMS_PROVIDER=robase` and an empty `ROBASE_API_KEY` **refused to start**, naming
`ROBASE_API_KEY is required when NOTIFICATION_SMS_PROVIDER=robase` (an instance without that
override started normally, confirming `.env` itself was valid).

Maker-checker: a governed proposal is created by the maker (`SUPER_ADMIN`); the maker **cannot
approve its own proposal (403)**; execution before approval is refused (**409**, "Approval is not
consumable: REQUESTED"). The probe change was left **unapproved and unexecuted**, and its
configuration row is unchanged.

Also verified: catalogue readable; diagnostic destination masking (`+**********001`); delivery and
receipt monitoring readable; H-04 events still absent from the catalogue; a `deposit.completed`
configuration proposal refused.

Support-message recipient binding (5/5, separate harness): a customer can open and read its own
ticket; **another customer cannot read it (404/403) and cannot post a message into it (404/403)**;
and ticket lists are scoped per customer, so one customer never sees the other ticket.

### E.4 The Mission 25E auxiliary browser recheck failure

Mission 25E's `browser-recheck-results.json` reports **11/12**, failing
`UI-RECEIPTS-FILTER-QUARANTINED` with "QUARANTINED filter shows quarantined=true shows
materialized=true". I reproduced this at the Mission 25H candidate and **it is a harness defect,
not a product defect**:

- The receipt-status filter is a `<select>` whose options include a literal
  `<option>MATERIALIZED</option>`. The 25E assertion searched the **whole section's text**, so it
  matched that static option label on **every** render, regardless of data.
- Read at row level with a deliberately seeded QUARANTINED receipt and a seeded MATERIALIZED
  receipt, the QUARANTINED filter returned **only the quarantined row** and correctly excluded the
  MATERIALIZED one. Rows containing `MATERIALIZED`: **0**.

The 25E artifact therefore carries no product signal and must not be presented as a clean rerun;
it is superseded by this row-level verification
(`evidence/aux-browser-recheck-review.txt`).

## F. Frontend incompatibilities requiring Arena 2 correction

Neither was fixed here: independently expanding frontend scope is out of this mission's remit, and
the authorized policy is still "no workforce read".

### F-25H-01 — Panel still requests an access that is no longer granted (medium)

`CustomerPersonalInformationPanel` issues `GET /customers/:id/preferences` and
`/preferences/history` whenever the session holds `customer.view` and is OPERATOR/PRIVILEGED and
not a pure `CUSTOMER_SERVICE` role. The corrected backend denies all workforce access, so each
visit now produces **4 × HTTP 403** (20 observed across 5 roles). The UI handles this correctly by
showing the documented denial state, and nothing leaks — but the interface is exercising, and
implicitly advertising, a capability the policy does not grant.

*Suggested direction (Arena 2, after the policy decision):* gate the panel so no request is
emitted, or replace the fetch with a static "not available to workforce" state.

Roles observed: `SUPER_ADMIN`, `FINANCE_AUDITOR`, `ADMINISTRATOR`, `OPERATIONS`, `COMPLIANCE`.

### F-25H-02 — Stale copy asserting a superseded policy (low)

The restricted state reads: *"Preference visibility is restricted to authorized operational and
privileged workforce roles with `customer.view`."* No workforce role can read preferences under
the corrected policy. The panel's "read-only" framing and the
`notification-management-api.ts` workforce-authorization comments describe the same superseded
model. Observed for `CUSTOMER_SERVICE`.

Also in this finding: `NotificationManagementApi.getCustomerPreferences()` is **dead code** (no
caller anywhere in `apps/admin-web/src`) whose doc comment still asserts the superseded
"OPERATOR/PRIVILEGED with `customer.view`" rule. It poses no runtime risk, but it is a second
stale statement of the old policy that Arena 2 should retire.

*Suggested direction:* align copy and gating with the approved policy once it exists.

## G. Outstanding security findings and product-policy blockers

### G.1 Workforce preference access — restriction preserved (no grant made)

Mission 25G denies workforce preference access pending explicit policy, and this mission
**preserves that denial**. No workforce read or write permission was granted. `customer.view`,
`audit.view`, principal type and UI visibility are **not** authorization for these fields. The
following remain product/security decisions, not engineering ones:

- whether any workforce role may read current preferences, and for what purpose;
- whether history/oversight access is a narrower, separately audited grant;
- whether any workforce role may ever write customer-controlled settings;
- how aggregate operational counts may be shown without per-customer values.

**Interim consequence, disclosed:** generic audit views no longer show preference records or
preference-route decisions for anyone. The underlying rows remain intact in PostgreSQL and are
still written. A future oversight path requires its own explicit, audited policy decision.

### G.2 H-07 — `ENV_SECRET` binding: still unimplemented, still a production blocker

Mission 25G produced a design recommendation only. Verified here: **no credential-binding change
was implemented**, and the fail-closed controls are preserved — an unconfigured provider refuses
`test-send` with 400 `PROVIDER_NOT_CONFIGURED`, and selecting a real provider with an empty
credential aborts startup. External-provider activation therefore remains restricted.

The underlying gap is unchanged: an approval does not bind the **exact** `ENV_SECRET` bytes, so a
changed valid-shaped secret could be activated or used without a new approval. **Do not activate an
external provider using `ENV_SECRET`.** No credential-binding change was made without separate
authorization.

### G.3 H-06 — Trigger-lock policy: exact discrepancy retained

Measured directly against the candidate database:

- Backend rows for `customer.funding.approved`, `customer.funding.rejected` and
  `transfer.completed` have **`is_locked = false`** and `editable = true` across channels.
- The Admin Web statically presents those three events as **locked**.

So the console's lock claim is not enforced by the server: a governed `CONFIGURATION` proposal to
disable such an event is **accepted (201)**, subject to maker (SUPER_ADMIN + MFA) and an
independent checker (FINANCE_CONTROLLER). This is **not** a privilege escalation and **not**
demonstrated unauthorized action — but it is a real policy-enforcement divergence. Whether these
outcomes are mandatory is an unresolved product decision (including D-N8). **No lock was changed
and no mandatory-event policy was invented.** The probe proposal created during this mission was
left unapproved and unexecuted.

### G.4 H-04 — Deposit/withdrawal notifications: contained, incomplete

`deposit.completed`, `deposit.failed`, `withdrawal.completed` and `withdrawal.failed` remain absent
from the notification catalogue (verified: **0 of 4 present**), a configuration proposal for
`deposit.completed` is **refused**, and no delivery was produced. Mapping them requires an approved
recipient/channel/disclosure contract. **No mapping was implemented and no policy was invented.**

### G.5 Carried deferred capabilities

PUSH channel, customer opt-out editing, manual retry execution, receipt ingestion,
bounce/complaint automation, Agent recipient resolution, marketing notification, and decisions
D1, D2, D4, D5, D6, D8, D9, D10, D11, D12 and D-N8 remain deferred or unresolved. They are
unchanged by this mission and are not delivered by this candidate.

## H. Confirmation of restrictions observed

- **No production deployment.** All work on a disposable local database.
- **No external SMS/email activation and no live send.** EMAIL is `none`; SMS is the `console`
  adapter; no vendor credential exists in this environment; no outbound vendor request was made.
- **No merge into `main`.** `origin/main` remains `39a9e504e3881911c94438321e7c60f771469d21`.
- **No change to the accepted Ordinary Agent V1 baseline** (`019de99`, untouched).
- **No unauthorized workforce permission.** Workforce preference access remains denied for all 11
  roles plus AGENT and SUPPORT.
- **No product-policy change.** No event lock, notification mapping, opt-out rule or preference
  policy was created or altered.
- **No unrelated feature work.** The diff contains only the pinned 25G change plus this report's
  documentation.
- **No force-push, rebase or history rewrite.**

## I. Final verdict

> ## CONDITIONAL PASS — WITH EXPLICIT LIMITATIONS

**Ready for Arena 4 independent security reassessment:** yes, on the backend authorization
surface, which is integrated and independently verified here.

**Explicit limitations that travel with this candidate:**

1. **F-25H-01** (medium, Arena 2): the preference panel still requests, and is refused, an access
   the policy does not grant; 20 refused requests observed across 5 roles.
2. **F-25H-02** (low, Arena 2): copy that still asserts workforce preference visibility.
3. **H-07**: `ENV_SECRET` exact-binding is designed but not implemented — external provider use
   remains blocked.
4. **H-06**: the console's lock claim is not server-enforced for three ordinary events; mandatory-
   event policy is undecided.
5. **H-04**: four financial notification outcomes remain unmapped and quarantined.
6. **G.1**: workforce preference oversight/read/write policy is undecided; the audit-oversight
   visibility trade-off is disclosed.
7. Workforces identities in the verification are seeded synthetic sessions; no external identity
   provider was exercised.

**This is not production readiness, not full notification-system completion, and not independent
security acceptance.** H-04, H-06, H-07 and the deferred capabilities above remain unresolved.

---

## Appendix — environment, isolation and disclosed fixtures

- Node v22.22.3, npm 10.9.8, embedded PostgreSQL 18.4 (loopback), Chromium 153.0.8010.0.
- Backend `:3000`, Admin Web Vite `:5173` (same-origin proxy), disposable database `monienaija`.
- Dependencies installed from the committed lockfiles with lifecycle scripts disabled; the
  embedded-Postgres package's own local symlinks were hydrated inside ignored `node_modules`.
- **Disclosed fixtures in the disposable `monienaija` database only:** customers
  `m25h-cust-0001..0003` with profiles, phone contacts, credentials and preference/history rows;
  one SUPPORT user; one AGENT with a rotated credential; two synthetic
  `notification_outbox_receipts` probe rows (one QUARANTINED, one MATERIALIZED) used solely to
  evaluate the receipts filter at row level; one unapproved/unexecuted notification change
  proposal. No production data was read or written.
- Raw run logs (`m25h-unit.log`, `m25h-pg.log`, `m25h-authz.log`, `m25h-browser.log`,
  `m25h-notification.log`, build and type-check logs) are kept outside the repository.

### Evidence index (`docs/integration/mission-25h/evidence/`)

| File | Contents |
| --- | --- |
| `phase-a-assessment.txt` | Pin/ancestry/scope verification and compatibility analysis |
| `integration-inventory.txt` | Merge commit, graph, diffstat, preservation checks |
| `customer-preference-security-verification.txt` | D — 105-check authorization matrix |
| `browser-and-notification-regression.txt` | E.2–E.3 — per-role browser table and notification checks |
| `aux-browser-recheck-review.txt` | E.4 — classification of the 25E recheck failure |
| `pg-matrix-summary.txt` | Full PostgreSQL batch/total counts |
| `test-summary.json` | Machine-readable totals for every gate |
| `authz-results.json`, `browser-results.json`, `notification-results.json` | Raw per-check results |
| `aux-browser-recheck-analysis.json` | Row-level receipts filter reproduction |
| `harness/` | The four verification harnesses actually executed |
| `screenshots/` | Per-role console/panel captures and the receipts filter capture |
