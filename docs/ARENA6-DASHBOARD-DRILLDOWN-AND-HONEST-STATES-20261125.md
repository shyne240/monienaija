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
