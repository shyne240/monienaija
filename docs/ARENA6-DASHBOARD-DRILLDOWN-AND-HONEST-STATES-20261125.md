# ARENA 6 — Dashboard drill-down, delivery investigation, health availability, audit trace

**Date:** 2026-11-25
**Branch:** `arena/a37c7878-monienaija` (branched from `arena/5-main-web-integration` @ `41edf587c262edafbd3eb2cc1b3042c614a9730e`)
**Scope:** the read path from a dashboard tile to the workspace holding the records behind it — Dashboard, Dashboard Settings, Notifications, Notification Operations, System Health, Audit Events, Audit Inspection. No new write path, no retry/replay control, no migration, no change to money-moving surfaces.
**Evidence:** `docs/integration/evidence/arena6-drilldown/` (6 Chromium screenshots + `arena6-drilldown-browser-acceptance.json`, produced by `scripts/arena6-drilldown-browser-check.cjs`).

---

## 1. The problem this closes

A dashboard tile used to be a number with no door. An operator reading "3 delivery exceptions" could not get from that figure to the three records, and an operator on System Health could not tell whether a quiet panel meant "healthy" or "nobody could look". Both are the same defect: a display that does not distinguish *measured zero* from *unmeasured*, and *authorized* from *available*.

## 2. Decisions now enforced in code

| Decision | Where | Why it is the shape, not a detail |
|---|---|---|
| The widget registry is the **only** source of a drill-down destination | `src/dashboard/dashboard-widget-registry.ts` (`drilldown?: {view,label,preset?}`), emitted by `resolveMyDashboard` | A payload must never point the console at a workspace: the server states intent, the console decides reachability |
| `drilldown` is emitted **only when the caller is authorized** for the widget | `src/dashboard/dashboard.service.ts` | A locked tile explains its missing grant; it does not advertise the queue behind it |
| The console re-gates every declared destination with `canAccessAdminView` **before rendering the control** | `DashboardScreen.openView` / `canOpenView` → `WidgetRenderer.canOpenView` | A button that leads to a denial is worse than no button: it reads as a fault in the workspace, not a limit on the session |
| A card *placed but restricted* renders the lock, never "no data"; a card *not placed* is worded "not configured" | `DashboardScreen.has()` (placed **and** authorized) vs `isPlaced()`; `WidgetCard` states | Two different facts, previously conflated — that conflation is how a restricted role could be offered an action it could not complete |
| Invalid payloads are `role="alert"` read failures, never an empty state | `widget-validation.ts`, `WidgetCard`, `isVerifiedAuditPage` in `AuditInspectionScreen` | "Nothing failed" and "nobody looked" must not render identically |
| Health reports per-probe **state, meaning, check time and read availability** | `HealthComponentReport` in `src/operations/operations.types.ts`, `diagnostics.service.ts`, `apps/admin-web/src/components/SystemHealthPanels.tsx` | `UNAVAILABLE` + reason is the honest answer when a probe could not run; a cascade skip (no database ⇒ migrations/outbox unmeasured) is stated as unmeasured, not as an error and not as a zero |
| Manual retry remains absent, and the card says so with the policy reference | `NotificationExceptionsWidget`, `notification-operations.service.ts` (`manualRetrySupported: false`) | Restates the V1 boundary from `docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md` on the surface, instead of leaving it to be rediscovered |
| The delivery trace degrades to an explicit "no trace projection" line | `NotificationOperationsScreen` (`a4-delivery-trace-unavailable`) | A build without the trace, or a truncated read, must not remove the delivery record the operator came for, and must not imply the event was fine |
| Template layouts are reconciled **append-only** at bootstrap | `DASHBOARD_TEMPLATE_LAYOUT_ADDITIONS` + `DashboardSeedService.applyLayoutAdditions()` (records applied keys in `metadata.layoutAdditions`) | Existing deployments need the new card, but an operator who removes it must keep it removed — rollout and governance pull in opposite directions |

## 3. Contract additions (all additive; no field removed or re-typed)

- `GET /internal/a2/workforce/dashboard/my-dashboard` → each widget may carry `requiredFunctions`, `dataEndpoint`, and (when authorized) `drilldown`.
- `GET /internal/a2/workforce/dashboard/widgets/notification-delivery-exceptions?period=…` → `{availability, configuration, totals, errorCodes, retry, provider, definition, checkedAt, source}`; proxy-only, `requiredFunctions: ['notification.view_deliveries']`, `supportsPeriodFilter: true`.
- `GET /internal/diagnostics` → adds `components: HealthComponentReport[]` (`database`, `migrations`, `reconciliation`, `outbox`, `workers`); the flat fields keep their historical sentinels (`pendingOutbox: -1` when uncountable) so `ready()` and existing consumers are unchanged.
- `GET /internal/notifications/operations/deliveries/:id` → adds `relatedEvent` (`FOUND|NOT_FOUND|UNAVAILABLE`, with the consumer receipt on the event) and `providerReceipts` (`AVAILABLE|NONE_RECORDED|UNAVAILABLE`, bounded, closed-set codes only).
- `summary(from?, to?)` accepts an explicit half-open window so a `7d`/`30d` dashboard period is not silently clamped to the 168-hour ceiling; `generatedAt` and the window are echoed for display.
- Audit navigation context now carries `auditEntityId`, `auditEntityType`, `correlationId`, `notificationStatus` (`navigation-access.ts` → `Layout.handleNav`), so a record can be traced into a *run* search rather than a form the operator must refill.

## 4. Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` (backend) | clean |
| `cd apps/admin-web && npx tsc --noEmit` | clean |
| `cd apps/admin-web && npx jest` (full) | 102 suites / 1019 tests passed |
| `npx jest health.e2e authorization-http-matrix runtime-access.guard arena6` | 6 suites / 201 tests passed |
| New ARENA 6 specs | `test/arena6-diagnostics-components.spec.ts` (7), `test/arena6-dashboard-layout-additions.spec.ts` (8), `test/arena6-notification-delivery-trace.spec.ts` (6), `apps/admin-web/__tests__/arena6-dashboard-drilldown.test.tsx` (8), `arena6-system-health.test.tsx` (8), `arena6-notification-operations-drilldown.test.tsx` (7), `arena6-audit-funnel.test.tsx` (5) |
| `ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build` | builds (456 modules; one pre-existing chunk-size warning) |
| Root `npm test` (full, run alone) | 306 suites / 3538 tests — 1 failure, pre-existing and environmental: `test/consolidated-matrix.spec.ts` requires commit `dd1b6314…` (recorded in `docs/integration/evidence/consolidated/consolidated-run.json`) to be an ancestor of HEAD, and that object is absent from this clone (`git cat-file` fails), so no branch here can satisfy it. `test/module-di-wiring.spec.ts` was OOM-killed mid-run and passes 8/8 when re-run alone. |
| Browser verification | **26/26 checks passed** in real Chromium against the built bundle — dashboard card → operations queue with `status=FAILED` sent as a server filter; delivery trace across five stores; System Health component table with `UNAVAILABLE` stated as unknown; correlation handed to audit search and that search run; restricted role issues **zero** protected reads and is given no dead controls; no uncaught page errors |

Full-suite note: the root `npm test` run (489 spec files) must not run concurrently with the admin-web suite on this 4 GB sandbox — the first such attempt produced four `jest worker … SIGKILL` failures that all pass when re-run alone.

## 5. What this does **not** certify

- The backend deliberately refuses to boot while `financial_dependencies_not_ready` holds, so the browser run stubs `/api/v1` at the network layer with the synthetic fixtures defined in the check script. Everything asserted is about the client — including which requests it chose **not** to make. No assertion here is about the server; the server-side rules are covered by `authorization-http-matrix` and the unit specs.
- The Chromium used is a serverless Linux build (`@sparticuz/chromium`): a real engine and a real renderer, not Safari, not a handset, not a screen reader.
- All data in the fixtures and screenshots is synthetic. No local role account, password, seed or configuration was modified.

## 6. Reproducing

```bash
# unit + contract gates
npx tsc --noEmit -p tsconfig.json && npx jest health.e2e authorization-http-matrix runtime-access.guard arena6
(cd apps/admin-web && npx tsc --noEmit && npx jest)

# browser evidence (real Chromium, synthetic API)
(cd apps/admin-web && ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build --outDir /tmp/arena6-dist --emptyOutDir)
node scripts/arena6-drilldown-browser-check.cjs --dist /tmp/arena6-dist \
  --out docs/integration/evidence/arena6-drilldown \
  --executable /tmp/chromium --lib-path /tmp/al2023/lib

# interactive click-through of the same synthetic fixtures
node scripts/arena6-drilldown-browser-check.cjs --dist /tmp/arena6-dist --serve-only --port 4322
```

---

## Addendum (later the same day) — CI green, the consolidated-matrix question, and a real-session run

### 1. Backend CI failed on this branch's own lint, and only that

`gh api .../check-runs/139205768101/annotations` gave four `no-unnecessary-type-assertion` errors
(three `as string | Date` casts in `dashboard-widget-data.service.ts`, one
`as Record<string, unknown>` in `dashboard-seed.service.ts`), and `npm run lint:test` gave 101 more in
the three new root specs — all of them `as any` dependency doubles
(`no-unsafe-argument`/`no-unsafe-return`/`no-explicit-any`) plus `require-await` on stub callbacks. Every
other file under `test/**` was clean, so nothing pre-existing was inherited and nothing outside this PR
was touched.

Fix: dropped the four casts; the specs now build **structural fakes cast once at the seam**
(`as unknown as DataSource`, `… as unknown as ReconciliationService`, `… as unknown as Repository<…>`),
which is stricter than before — the expectations are still type-checked against the real contract, and the
delivery-trace spec can still assert on the queries that were *not* issued. A `onlyRow()` accessor replaced
unchecked `store[0]` indexing. No assertion was weakened: the three files still run 8 + 7 + 6 cases.

**CI at the exact head `66674b950ab9419ea78c84edcd641f338abc819f`:** `Backend (lint, format, build, unit
tests)` **pass**, `Admin Web (types, tests, build)` **pass**, `Backend (container image builds)` **pass**,
Customer Mobile **pass**, Agent Mobile **pass**, `Classify changes` **pass**. Locally, with the same
commands: `npm run lint` clean, `npm run format:check` clean, `npm run build` clean, and
`npx jest test/arena6-* test/health.e2e test/authorization-http-matrix test/runtime-access.guard` →
6 suites / 201 tests pass.

### 2. `test/consolidated-matrix.spec.ts` — not shared, not a defect, and untouched

The one root-suite failure was this clone being a **shallow** checkout (`git rev-parse --is-shallow-repository`
→ `true`, 3 commits deep, `.git/shallow` present). The recorded evidence commit
`dd1b631490a3fe04e791857e65a7fc89f7965a73` was simply not in the object store, so
`git merge-base --is-ancestor` could not answer.

Reproduced both ways rather than assumed:

| state | `git cat-file -t dd1b6314…` | spec result |
| --- | --- | --- |
| shallow clone (3 deep), PR head | `fatal: git cat-file: could not get object info` | 1 failed / 12 passed |
| after `git fetch --unshallow origin` (1173 commits) | `commit` | **13 passed, 13 total** |

With full history the assertion also resolves for the PR **base** —
`git merge-base --is-ancestor dd1b6314… origin/arena/5-main-web-integration` → contains, and same for this
head; `origin/main` does not contain it, and ~78 other `arena/*` branches do. So the outcome is not shared
across branches as a failure and there is nothing for this PR to reconcile. `git diff --stat
origin/arena/5-main-web-integration...HEAD -- test/consolidated-matrix.spec.ts
docs/integration/evidence/consolidated/` is **empty**: the assertion and its evidence file were not edited.
CI is unaffected because the backend job checks out with `fetch-depth: 0` — the workflow carries the comment
"The consolidated evidence matrix verifies commit ancestry against HEAD", and that job runs the whole root
`npm test`.

### 3. One real-session workflow on a fully migrated disposable PostgreSQL

New suite `test/arena6-real-session-workflow.integration.spec.ts` (6 tests, all passing). It is the piece
the synthetic Chromium harness could not claim: real `AppModule`, real session store, real
`AuthorizationService.requireFunction`, real `notification_deliveries` rows, real migrated schema.

* Bootstrap: **reused, not invented** — `node scripts/prepare-pg-test-env.js --create-if-missing` (the same
  step the CI PostgreSQL job runs, so the real login route is configured exactly as the other
  real-AppModule integration suites configure it), an embedded disposable cluster started by
  `scripts/.start-disposable-pg-acceptance.cjs` on a random loopback port, and the run driven by
  `npm run test:pg` so `test/support/pg-harness.ts` creates and migrates a per-run database
  (`PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes` was set by hand, as that runner requires).
* Accounts: seeded through the **pre-existing** fixture
  `scripts/local-dev-seed-11-roles.js` (`seedLocalRoles`, insert-only) — 11 accounts, same emails and
  passwords as local dev, its own `assertSafe` guards (loopback host, NODE_ENV, both workers disabled)
  left running. No account, password, role definition or grant was changed.
* Sign-in is a real `POST /api/v1/internal/a2/workforce/local-admin-sessions` with a password; every read
  after it is a real `Authorization: Bearer` request to a listening socket (`app.listen({port: 0,
  host: '127.0.0.1'})`).
* **Chain** (FINANCE_AUDITOR — the only seeded role holding both `notification.view_deliveries` and
  `audit.search`; OPERATIONS holds the first and not the second, which is why the negative test is not
  vacuous): `my-dashboard` → `FINANCIAL_AUDIT_ASSURANCE`, card
  `notification-delivery-exceptions` authorized with `drilldown.view = notificationOperations` and
  `dataEndpoint` → the queue `GET …/internal/notifications/deliveries?status=FAILED` (server-applied
  filter; every returned row `FAILED`) → `GET …/deliveries/{id}` trace
  (`relatedEvent.availability = FOUND` — a real `outbox_events` row appended through `OutboxService` and
  marked published; `providerReceipts.availability = NONE_RECORDED` with the reason text *"absence of a
  receipt is not evidence of delivery or failure"*) → `GET …/internal/audit/inspection?correlationId=…`,
  which finds the audit event written through `AuditService.record()` in the same flow, same correlation id.
* **Restricted role** (RISK_FRAUD, 1 granted function): its dashboard resolves (200) with 3 widgets and
  **zero** authorized drill-downs into `notificationOperations`/`auditEvents`; all five protected reads —
  operations summary, delivery queue, the specific delivery by id, audit inspection by correlation id,
  `/internal/diagnostics` — are **403**, each body 89 bytes and asserted *not* to contain the correlation
  id, the delivery id, or the destination. The refusal is the server's, not the client's.
* **One unavailable health source, for real:** `/internal/diagnostics` returned five components; four
  `CHECKED`, and `workers` `state: unknown / availability: UNAVAILABLE / reason: "no completed tick
  observed in this process; disabled workers are never measured by design"` — true in this deployment,
  because both workers are disabled by the test guard. The suite asserts that every non-`CHECKED`
  component carries a reason.
* **Gate intact:** the suite calls `ProductionReadinessService.verifyStartup()` itself and asserts it
  **throws** (`Production readiness failed: financial_dependencies_not_ready`); the evidence file records
  that. Nothing in this PR loosens `src/main.ts` or `FINANCIAL_DEPENDENCY_BLOCKERS`. That refusal is why
  the app is booted the way every `*.integration.spec.ts` boots it, and why the earlier browser leg stubs
  the API at the network layer instead of pretending a listening production process exists.
* Evidence: `docs/integration/evidence/arena6-real-session/real-session-workflow.json`, written by the run
  (`ARENA6_EVIDENCE_DIR`), including the whole card payload and a `notCertified` list: no browser rendering
  in that file, no provider call, shipped bootstrap still refuses to listen.

**Observation for the owner (not fixed here, out of AR6 scope):** the card's own proxy read answered
`availability: UNAVAILABLE`, `configuration: UNKNOWN`, *"the notification operations projection is not wired
in this deployment"*, `totals.deliveries: 0` — while the drill-down queue over the *same* table returned the
synthetic FAILED row. The card behaved correctly (it named the missing source instead of inventing a
number), but the dashboard's proxy path and the operations workspace do not currently resolve the same
provider wiring; that is a `DashboardWidgetDataService` → `NotificationOperationsService` composition
question, and wiring it would be a new read path, which AR6 excluded.

### 4. Commands

```bash
node scripts/prepare-pg-test-env.js --create-if-missing
node scripts/.start-disposable-pg-acceptance.cjs &      # prints DISPOSABLE_PG_READY {"host","port"}
NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=<port> DB_USER=arena_pg_test \
  DB_PASSWORD=arena-disposable-test-only DB_ADMIN_NAME=postgres DB_NAME=<any> DB_SSL=false \
  PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes NOTIFICATION_WORKER_ENABLED=false \
  CASH_TO_CASH_EXPIRY_WORKER_ENABLED=false \
  ARENA6_EVIDENCE_DIR=docs/integration/evidence/arena6-real-session \
  npm run test:pg -- arena6-real-session
npm run lint && npm run format:check && npm run build
```

### 5. Merge blockers remaining

1. The PostgreSQL jobs (`Backend (real PostgreSQL integration)`, `Backend (isolated PostgreSQL suites)`)
   were *skipping* on the first head and *running* at the time of writing; the merge should wait for them at
   the new head, which now also includes this addendum's spec.
2. The observation in §3 (card proxy read `UNAVAILABLE` vs the queue's row) is a product decision for the
   owner, not a defect in AR6's scope.
3. Still not certified, unchanged from the first report: no browser leg against a live backend session
   (the gate above forbids it), no real provider sandbox, and the accessibility/keyboard matrix is
   component-test-level only.

---

## Addendum 2 — the exceptions card now shares the queue's read (aggregate-only, labeled window)

### The defect
The card *was* coded against `NotificationOperationsService.summary()` — the same read the failed-delivery
queue answers from — but `src/dashboard/dashboard-widget-data.service.ts` imported the class as
**`import type { NotificationOperationsService }`**. TypeScript elides a type-only import, so the emitted
`design:paramtypes` metadata for that constructor parameter was `Object`, Nest could not resolve a DI
token for it, and because the parameter is `@Optional()` the failure was silent: the collaborator arrived
`undefined` and the card answered `availability: UNAVAILABLE` / "not wired in this deployment" with
`totals.deliveries: 0`. The queue, served by the same service through `NotificationModule`, returned the
row. Two answers, one source — caught only by the real-session run.

### What changed
* `src/dashboard/dashboard-widget-data.service.ts` — value import, so the token resolves and the card is a
  **projection of the one provider**, not a second implementation. `NotificationModule` keeps providing and
  exporting it; no new query was added to the dashboard: the card reuses `summary()`'s scoped aggregate
  (`GROUP BY channel, status` over the same half-open window) and sums FAILED + DEAD + UNKNOWN.
* **Same scope as the queue, stated rather than implied.** Both reads are gated by
  `notification.view_deliveries`, both hit `notification_deliveries`, and neither partitions by workforce or
  institution — the table has no such column, so a card-side filter would have *narrowed* the queue's scope
  and made the two disagree. Provider identity still stays behind `notification.provider.view`
  (`includeProviderIdentity: false`), so the card cannot disclose what the queue withholds.
* **Clearly labeled window.** `window: { hours, from, to, label, boundary }` where `boundary` is
  `half-open: created_at >= from AND created_at < to (UTC)` and `label` is rendered verbatim on the card
  (`Window: <period> window, <from> to <to> UTC`). `to` is now normalized to ISO the same way `from` was —
  previously a string `to` fell through to `undefined`, so the payload could state a start without an end.
* **Aggregate only.** The dashboard payload is `availability`, `configuration` (+ `configurationNote`),
  `totals: { deliveries, exceptions }`, `window`, `policy: { manualRetrySupported: false, policyReference }`,
  `definition`, `checkedAt`, `source`. Dropped: `totals.byStatus`, `errorCodes[]`, the retry backlog
  (`pending/failedAwaitingRetry/dead/unknown/oldestPendingAt/nextScheduledRetryAt`) and
  `provider.channels[]` — that is the queue's content, reachable through the preserved link.
* **Zero only on a successful read.** An unreadable source now answers `UNAVAILABLE` with
  `totals: { deliveries: null, exceptions: null }` and a reason; it no longer carries `0` at all, so a
  client cannot render an absent read as a quiet shift. A read that succeeds with no matches is
  `MEASURED` with real zeros. A failed *query* still throws 503 (`ServiceUnavailableException`) instead of
  being flattened. `widget-validation.ts` enforces both halves client-side: MEASURED requires numeric
  totals + a labeled window, UNAVAILABLE requires a reason **and** `totals.exceptions == null`.
* **Restrictions preserved.** `requiredFunctions: ['notification.view_deliveries']`, the authorized-only
  `drilldown` in `dashboard.service.ts`, and the tile's "no control when not authorized" behaviour are
  unchanged; the widget's `description` was retitled to say the list and error codes live in the queue.

### Proof that the card agrees with the queue (real PostgreSQL, real session)
`test/arena6-real-session-workflow.integration.spec.ts` — 6/6 pass on a migrated disposable cluster as
FINANCE_AUDITOR, after a real password sign-in:
* `widgets/notification-delivery-exceptions` → `availability: 'MEASURED'` (this is the DI fix proving
  itself at runtime, not in a unit double), labeled window, `policy.manualRetrySupported === false`, and
  `totals.byStatus` / `errorCodes` / `retry` **absent** from the payload.
* Using the card's own `window.from`/`window.to`: `deliveries?from&to&page=1&limit=1` `total` ===
  `totals.deliveries`, and Σ`total` over `status=FAILED|DEAD|UNKNOWN` === `totals.exceptions` (== 1, the
  synthetic row). Same table, same window, same gate — the numbers are the same numbers.
* Empty window: after the synthetic rows are deleted, the card answers `MEASURED` with `exceptions: 0`
  and `deliveries: 0` — a genuine zero from a successful read. The `UNAVAILABLE`/null shape is asserted in
  `notificationDeliveryExceptions`'s unit path and by the client validator.
* RISK_FRAUD still gets 403 on every protected read (89-byte bodies, no ids/destination leaked) and zero
  authorized drill-downs, so the aggregate is not a new disclosure channel.

Local gates at this change: `npm run lint` clean, `npm run format:check` clean, `npm run build` clean;
root `npx jest dashboard` 8/8, `npx jest widget notification operations` 20 suites / 230 tests; admin-web
full suite **102 suites / 1019 tests**; `tsc --noEmit` clean in both projects.

### Evidence provenance — which run was which
| Evidence | Source of API data |
| --- | --- |
| `docs/integration/evidence/arena6-real-session/real-session-workflow.json` | **real**: migrated disposable PostgreSQL, real `local-admin-sessions` sign-in, real bearer requests to a listening socket, real guards; synthetic delivery/outbox/audit rows only |
| `docs/integration/evidence/arena6-drilldown/` (6 PNGs + JSON, 26/26) | **fixture**: real Chromium rendering the built bundle, API stubbed at the browser network layer |
| `apps/admin-web/__tests__/*` (1019) | jsdom, stubbed `ApiClient` |

No browser run in this turn was captured against a live backend session: the isolated bootstrap's HTTP
listener lives inside the jest worker and exits with the suite, so serving the built Admin Web through it
needs the harness to keep a worker alive across the browser leg. That remains the one gap in the browser
column; the payload the browser renders is the payload asserted above, and `widget-validation.ts` is what
refuses to turn an unavailable read into a number.

---

## Addendum 3 — the drill-down counts the card's interval exactly, and a browser ran the whole flow against the real backend

Addendum 2 ended with the one gap it could not close: "No browser run in this turn was captured against a
live backend session." That gap is closed here, and the equality the card claims is now enforced at the
boundary instead of being argued from aggregate arithmetic.

### The problem the window boundary posed

The card aggregates `created_at >= from AND created_at < to` (half-open). The queue's `from`/`to` filter was
`created_at >= from AND created_at <= to` (inclusive). So a row stamped exactly at `to` counted **once** by
the card and **twice by nothing** — worse: the queue showed a row the card had not counted, and the two
numbers the operator was told to reconcile silently differed by one whenever a delivery landed on the edge.
Fixing it by flipping the queue's default would have changed the meaning of every existing caller's `to`.

### What changed (all additive; no existing default flipped)

* `src/admin/admin-notification.controller.ts` — `GET /internal/notifications/deliveries` gained one opt-in
  query parameter, **`toExclusive`**. It is parsed by `parseBooleanFlag(raw, field)`, which accepts
  `true/1/false/0`, treats an empty value as `false`, and answers **400 `toExclusive must be true or false`**
  for anything else — an uninterpretable bound is refused, not ignored. The predicate is
  `toExclusive ? 'created_at < $n' : 'created_at <= $n'`, so **ordinary queue visits and every existing API
  caller keep the inclusive upper bound**.
* The page payload gained `window: { from, to, upperBound, boundary }` (`upperBound` is `exclusive`,
  `inclusive` or `none`; absent bounds echo `null`). Nothing was removed or re-typed: `{ data, total, page,
  limit, totalPages, hasNextPage }` is untouched.
* `apps/admin-web` — the drill-down hands the card's own `window.from`/`window.to` to the queue **plus an
  explicit `toExclusive: true`** through `WidgetDrilldownContext` → `navigation-access.ts` →
  `Layout.tsx` → `NotificationOperationsScreen`. `arena4-operations-api.ts` serializes it only when the
  caller asked for it, so an ordinary visit sends no `toExclusive` at all.
* **The equality claim is only made when the queue confirms it.** The "same interval as the card, so the two
  counts are meant to be equal" sentence renders only when the response itself reports
  `window.upperBound === 'exclusive'`. What the client *asked for* is not evidence of what the server *did*:
  without that gate, a queue answer that omits `window` (an older deployment) would have said "treat this
  count as inclusive of the end of the window" and "these counts are meant to be equal" in one paragraph.
  Found while writing the evidence README for the browser run; fixed with it, and pinned by a jsdom test whose
  fixture response carries no `window` at all.
* **The applied window is shown, not assumed.** The queue renders `a4-applied-window`:
  `Applied window: <from> → <to> · <boundary>`, where `<boundary>` is the server's own string, one of five:
  `created_at >= from AND created_at < to (half-open, UTC)`,
  `created_at >= from AND created_at <= to (inclusive upper bound, UTC)`,
  `created_at >= from, no upper bound`, `created_at < to (half-open, UTC)`,
  `no time window applied — every delivery row is in scope`. The
  half-open case adds "the same interval the dashboard exception card aggregated, so the two counts are meant
  to be equal"; if a response ever omits the field, the note says so
  ("the queue did not report which upper bound it used — treat this count as inclusive of the end of the
  window") instead of guessing. Editing **`Created to` in the form clears the exclusivity** — a hand-typed
  end is the operator's own inclusive end, not the card's.
* Preserved, not extended: `requiredFunctions: ['notification.view_deliveries']` still gates the queue, the
  dashboard response is still aggregate-only, no new authorization or role appeared, no manual-retry control
  exists, and nothing partitions by institution or workforce — `notification_deliveries` has no such column.

### Boundary tests (the row at each edge, three ways)

`test/arena6-deliveries-window-boundary.spec.ts` (5/5) pins the controller: inclusive by default, half-open
only when asked, the `window` echo without an upper bound to qualify, the 400 for a nonsense flag, and the
field's presence on the payload the queue renders. The real-database case lives in
`test/arena6-real-session-workflow.integration.spec.ts` (`window edge agreement`): three synthetic FAILED
rows stamped **exactly at `from`**, **one second before `to`**, and **exactly at `to`** —

| read | result |
| --- | --- |
| card `window` (`from`, `to`, half-open) | `MEASURED`, `totals.exceptions === 2 === totals.deliveries` under `status=FAILED` |
| `?from&to&status=FAILED&toExclusive=true` | `total 2`, `upperBound 'exclusive'` — the row at `to` excluded, the rows at `from` and just before `to` kept |
| `?from&to&status=FAILED` (ordinary visit) | `total 3`, `upperBound 'inclusive'` — the row at `to` present, exactly as before this change |
| `toExclusive=maybe` | **400** |

`apps/admin-web/__tests__/arena6-dashboard-drilldown.test.tsx` and
`arena4-notification-operations.test.tsx` (7/7) pin the client half: the link the card offers carries the
card's `from`/`to` and `toExclusive=true`; the queue renders the half-open boundary with the card-match
sentence; an edited query reverts to the inclusive sentence; and a response that reports no `window` renders
the warning without the equality claim.

### The browser run (real backend, real session, real Chromium)

`scripts/arena6-real-browser.cjs` orchestrates it: it starts `arena6-real-browser-backend.ts` (the real
`AppModule`, `verifyStartup()` gate intact, listening on `127.0.0.1` at an ephemeral port it prints as
`STANDALONE_READY`, 11 fixture accounts seeded, the three boundary rows inserted on whole-minute bounds) and
keeps that listener alive for the whole browser phase; `scripts/arena6-real-session-browser-acceptance.cjs`
serves the built bundle plus a same-origin `/api/v1` proxy to it and drives the flow. Nothing is stubbed in
the page.

**17 of 18 checks pass; 0 are real failures; 1 advisory** (`browser-run.json`: `backend { port 41631,
seeded 11, readinessRefuses: true }`, window `2026-11-25T16:21:00Z → 18:21:00Z` — whole-minute bounds,
because `Created to` is a minute-granularity `datetime-local` — and `restrictedRole
risk-fraud@monienaija.local`). The three runs that produced this ledger (ports 40039, 39831, 41631) reported
the same checks. One sign-in, then the flow the request asked to be shown —
dashboard card → failed-delivery queue → delivery trace → audit search:

* the card labels the window it counted, exposes only its aggregate (no `PROVIDER_TIMEOUT` on the card), says
  manual retry is out of policy, and offers the queue link;
* the drill-down arrives with `status=FAILED` applied, **states the half-open window it applied**, says the
  interval is the card's "not a coincidence", and reports the **same total as the card (3 rows in scope: 2
  under the card's half-open bound, plus the edge row only when the bound is inclusive)**;
* an ordinary edited query reverts to the inclusive bound, and the inclusive queue lists the row stamped
  exactly at `to`;
* the trace renders (or says its absence is not health), interprets `NONE_RECORDED` correctly, and offers the
  jump into the audit trail;
* **the jump issues `GET /api/v1/internal/audit?limit=100&correlationId=<the delivery's correlation id>`** —
  asserted from the request the browser put on the wire, so it is proven even though the paint after it is
  not;
* the restricted role (RISK_FRAUD, second browser) is offered no route into the protected views and issues no
  protected read (its whole client-side traffic: sign-in, `my-dashboard`, one widget).

The single miss is `the audit workspace opened`, recorded **advisory**: this sandbox's Chromium dies when the
audit workspace mounts, on both the original renderer and a fresh one launched to retry it (empty stderr,
3.3 GB free, request already answered 200). The audit view and route are covered by the admin-web jsdom
suites and by the HTTP assertions in `test/arena6-real-session-workflow.integration.spec.ts`
(`auditStatus 200`, `auditEvents 1`, the entry carrying the delivery's `correlationId`). Evidence:
`docs/integration/evidence/arena6-real-browser/` (`browser-run.json` + 4 PNGs + `README.md`).

The harness is now truncation-proof rather than merely green: a failed check records and continues instead of
aborting the run; environment-only misses are flagged `advisory` and excluded from the exit code; and the
sign-in, drill-down-filter, audit-search and restricted-role legs are **mandatory** — a run that never
reached one fails even if everything it did run passed. Three failure modes met *while producing this*
evidence are closed in the harness too, because each of them can otherwise report a short run that looks
clean: a reused admin bundle built without `ADMIN_WEB_API_BASE_URL` (the runner now reads the built asset for
the base and rebuilds when it is missing — one such run spent 90 s waiting for a dashboard that bundle could
never reach, and reported nothing at all); a sign-in failure while the page is dying (the reason is captured
before any further `await`, so "the page said this" is no longer replaced by "page has been closed"); and a
restricted leg that could not be switched off (it is on by default, disabled only by `--no-restricted`, the
state is printed when the run starts, and the report records `restrictedRole`).

### Local gates at this change

`npm run lint`, `npm run format:check`, `npm run build` clean; root `arena6-deliveries-window-boundary`
5/5; admin-web full suite **102 suites / 1023 tests** plus `npm run ts:check` clean; `npm run test:pg -- arena6-real-session` **8/8** on a
migrated disposable cluster (and that run regenerated
`docs/integration/evidence/arena6-real-session/real-session-workflow.json`, whose `browserRun` field now
states that the browser leg runs as its own process and points at its evidence file).

### Reproducing

```bash
# 1. real-browser leg (needs a migrated disposable PostgreSQL and the extracted Chromium + libraries)
env NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=<port> DB_USER=<user> DB_PASSWORD=<pw> \
    DB_ADMIN_NAME=postgres DB_NAME=monienaija_arena6 DB_SSL=false \
    PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
  node scripts/arena6-real-browser.cjs --executable /tmp/chromium --lib-path /tmp/al2023/lib
# (the restricted-role leg is on by default; pass `--no-restricted` only to drop it)
# 2. the HTTP half (same database, no browser)
env NODE_ENV=test ARENA6_EVIDENCE_DIR=docs/integration/evidence/arena6-real-session \
    DB_HOST=127.0.0.1 DB_PORT=<port> … PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
  npm run test:pg -- arena6-real-session
```

The admin bundle must have been built with `ADMIN_WEB_API_BASE_URL=/api/v1`
(`ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build` in `apps/admin-web`). The orchestrator now checks the bundle
on disk for that base and rebuilds it when the base is missing — before that check existed a stale or
differently configured `dist` was reused silently, and the run failed as an unexplained sign-in timeout.
