# ARENA 4 — Notifications (Events/Templates/Config/Provider/Deliveries) + Administration & System Settings

**Copy-ready implementation prompt — paste into Arena 4 branch session**
**Author:** Arena 5 (integration/architecture) · **Date:** 2026-11-20
**Baseline:** `arena/1f37a4f3-monienaija @ 98b067bc` (→ `arena/5-main-web-audit` integration branch) · 166 migrations
**Frozen predecessors:** `arena/defdd0fd-monienaija`, `arena/bcf44621-monienaija`, `main` — never mutate.
**Financial engine:** Preserved — no `src/ledger|reconciliation|commercial-accounting|banking` core change without Arena 5 + defect proof.

---

## 1) Mission

Own **notifications (the deepest screen at 5165 lines) + workforce/roles + approvals inbox (maker-checker) + admin recovery + system health + audit + dashboard settings**. You are the governance backbone: Arenas 1–3 create proposals, your `approvalsInbox` approves them, and your notification pipeline powers agent/customer communications.

---

## 2) Scope — menu/routes

| Section | View key | Label | Guard | Baseline |
|---|---|---|---|---|
| Overview | `dashboard` | Dashboard | none | COMPLETE (co-own with Arena 5) |
| Overview | `dashboardSettings` | Dashboard Settings | `workforce.dashboard.view` | COMPLETE |
| Risk | `kycProviders` | KYC providers | `kyc.provider.view` | COMPLETE (you own provider contract; Arena 1 consumes) |
| Admin | `workforceAccess` | Workforce access | `workforce.dashboard.view\|user.create` | COMPLETE |
| Admin | `roleGovernance` | Role governance | `SUPER_ADMIN+assign` | COMPLETE |
| Admin | `approvalsInbox` | Approvals | `FINANCE_CONTROLLER+privileged:approve` | COMPLETE |
| Admin | `superAdminRecovery` | Admin recovery | `workforce.super_admin.recover` | COMPLETE |
| Admin | `notifications` | Notifications | `notification.*` | COMPLETE (largest, most wired) |
| Admin | `systemHealth` | System health | `metrics.view\|diagnostics.view\|outbox.view` | COMPLETE |
| Admin | `auditEvents` | Audit events | `audit.search` | COMPLETE |

You also own the **provider test-send** and **notification config** maker→checker paths that all arenas depend on.

---

## 3) Files you own

```
apps/admin-web/src/screens/authenticated/NotificationManagementScreen.tsx   # 5165 — your core
apps/admin-web/src/screens/authenticated/WorkforceAdminScreen.tsx          # 674
apps/admin-web/src/screens/authenticated/RoleAssignmentScreen.tsx          # 879
apps/admin-web/src/screens/authenticated/ApprovalsScreen.tsx               # 732
apps/admin-web/src/screens/authenticated/SuperAdminRecoveryScreen.tsx      # 511
apps/admin-web/src/screens/authenticated/SystemHealthScreen.tsx            # 638
apps/admin-web/src/screens/authenticated/AuditTrailScreen.tsx              # 428
apps/admin-web/src/screens/authenticated/DashboardScreen.tsx               # 199 — co-owned with Arena 5
apps/admin-web/src/screens/authenticated/DashboardSettingsScreen.tsx       # 930
apps/admin-web/__tests__/a4-*.test.tsx
```

Services:

```
apps/admin-web/src/services/notification-domain.ts         # 1708 — owned
apps/admin-web/src/services/notification-management-api.ts # 1997 — owned (events→templates→config→provider→deliveries)
apps/admin-web/src/services/kyc-governance-api.ts          # provider contract owner
apps/admin-web/src/services/banking-admin-api.ts           # read-only consumer for provider credential read
```

Backend modules (frontend-first; approval execution contract is your key backend touch):

`src/notification`, `src/admin` (notification+support), `src/authorization`, `src/authorization-catalogue`, `src/capability-registry`, `src/operations`, `src/health`, `src/deployment`, `src/readiness`, `src/dashboard`, `src/a2/workforce`

---

## 4) Prohibited — never edit in Arena 4 PRs without Arena 5

```
apps/admin-web/src/screens/authenticated/Layout.tsx
apps/admin-web/src/screens/authenticated/navigation-access.ts
apps/admin-web/src/services/api-client.ts
apps/admin-web/src/store/auth-store.ts
apps/admin-web/src/config/*
apps/admin-web/src/design-system/tokens.css
apps/admin-web/src/screens/authenticated/Customer*.tsx
apps/admin-web/src/screens/authenticated/AgentNetworkScreen.tsx
apps/admin-web/src/screens/authenticated/LedgerOperationsScreen.tsx
apps/admin-web/src/screens/authenticated/ReconciliationObservabilityScreen.tsx
apps/admin-web/src/screens/authenticated/CommercialRulesScreen.tsx
# Financial core — read-only:
src/ledger/**  src/reconciliation/**  src/commercial-accounting/**  src/banking/** (except provider-config read)
```

You may NOT add a notification side-effect that moves money — notifications are communication only.

New view key → issue for Arena 5.

---

## 5) Backend requirements — endpoints (all exist)

| Need | Endpoint | Module |
|---|---|---|
| Notifications: events | `GET internal/notifications/events`, `POST internal/notifications/events` | `notification` |
| Notifications: templates | `GET internal/notifications/templates`, `POST internal/notifications/templates` (proposal) | `notification` |
| Notifications: config | `GET internal/notifications/config`, `PUT internal/notifications/config` (proposal) | `notification` |
| Notifications: provider | `GET internal/notifications/provider-config`, `PUT internal/notifications/provider-config` (proposal), `POST internal/notifications/provider-config/test-send` | `notification` |
| Notifications: deliveries | `GET internal/notifications/deliveries?status=`, `GET internal/notifications/deliveries/:id` | `notification` |
| Workforce | `GET internal/a2/workforce/users`, `POST internal/a2/workforce/users`, `PATCH internal/a2/workforce/users/:id` | `a2/workforce` |
| Role governance | `GET internal/a2/workforce/role-definitions`, `POST internal/a2/workforce/role-definitions`, `POST internal/a2/workforce/users/:id/roles` | `a2/workforce` |
| Approvals inbox | `GET internal/product-governance/proposals`, `POST internal/a2/workforce/approvals/:id/approve\|reject`, `POST internal/institutions/:id/approve` | `authorization`, `a2`, `institution` |
| Admin recovery | `POST internal/a2/workforce/super-admin/recover` | `a2/workforce/super-admin` |
| Dashboard | `GET internal/a2/workforce/dashboard`, `PUT internal/a2/workforce/dashboard/widgets` | `dashboard`, `a2` |
| System health | `GET health`, `GET internal/operations/health`, `GET internal/operations/metrics`, `GET internal/operations/outbox`, `GET internal/operations/diagnostics` | `operations`, `health` |
| Audit | `GET audit/events?actor=&action=&entity=`, `GET audit/search` | `audit`, `support` |
| KYC providers (contract) | `GET internal/kyc/providers`, `PUT internal/kyc/providers` (proposal) | `kyc-verification` |

Maker→checker: notification template/config/provider/KYC provider changes are proposals → `FINANCE_CONTROLLER+privileged:approve` in your own `approvalsInbox`. You own the checker UX.

---

## 6) Acceptance criteria

- [ ] **Notifications pipeline complete:** Events→templates→config→provider status→deliveries is a navigable pipeline in `NotificationManagementScreen`. Each stage loads real `internal/notifications/*` data with pagination. Console provider test harness is not "mock" — it is the correct provider for test environments.
- [ ] **Notification maker→checker:** Creating/editing a template or config creates a proposal (maker); the inbox shows it with Approve/Reject (checker with `FINANCE_CONTROLLER`). Test-send (`POST .../test-send`) works with a target address/phone and shows delivery status.
- [ ] **Deliveries observability:** Paginated deliveries with status filters (QUEUED/SENT/FAILED), detail view with attempt log, retry visibility. No invented delivery status.
- [ ] **KYC provider contract:** Primary/fallback routing for Monnify/Dojah/Synthetic with capability matrix; changes are proposal-gated; catalogue readiness respected (`confirmedCapabilities`). Consumer Arenas 1 can read via your API contract.
- [ ] **Workforce access:** User CRUD (create/invite/disable), search/filter, scope assignment — all via `internal/a2/workforce/*`; permission `user.create` gates creation.
- [ ] **Role governance:** Role definitions CRUD with function-code matrix (authorization-catalogue); assignment of roles to users with guard `SUPER_ADMIN+assign`; sensitive-role assignment audit-linked.
- [ ] **Approvals inbox (critical):** Lists proposals from ALL arenas (KYC, agent lifecycle/funding, fee/commission, ledger reversal, institution, notification config). Approve/reject/execute with correct checker guard. Self-approval blocked (backend enforces; you show correct error). This is the governance sink — if Arenas 1–3 have no proposals yet, inbox correctly shows empty with guidance, not error.
- [ ] **Admin recovery:** Break-glass `superAdminRecovery` flow completes (challenge→recover→audit) with `workforce.super_admin.recover` guard; strictly limited — no recovery UI leaks to normal users.
- [ ] **Dashboard + settings:** Dashboard metrics real (from `internal/a2/workforce/dashboard` + `internal/financial-context`); settings persist widget configuration per user/institution.
- [ ] **System health:** Metrics, diagnostics, outbox backlog, worker liveness all from `internal/operations/*`; health API readiness reflected accurately; no invented uptime figure.
- [ ] **Audit events:** Paginated audit search with actor/action/entity/date filters; detail shows `actor_id`, `action`, `entity_type`, `entity_id`, `timestamp`, `metadata` — correct `audit.search` guard.
- [ ] **Guards:** Every view above respects its `canAccessAdminView` code; `menu-visibility-11-roles` coverage for your views; `notification.*` or checker grant for notifications.
- [ ] **Design/API hygiene:** `ApiClient` only; `Guarded` banner on guard fail; `WorkspaceDrawer` for detail; loading/empty/error per stage; idempotency on mutating POST.
- [ ] **Tests:** `__tests__/a4-notifications-admin.test.tsx` — guards, notification pipeline, maker→checker, workforce/role CRUD, approvals, audit pagination, health; all `apps/admin-web` tests pass.
- [ ] **Handoff:** PR lists files | routes | endpoints | guards | tests | evidence | regression. Evidence includes notification template proposal→approval→delivery round-trip.

---

## 7) Branch & integration

- **Branch from:** `arena/5-main-web-audit` → `arena/5-a4-notifications-admin`.
- **PR into:** `arena/5-main-web-integration`.
- **Coordination:** You are last to integrate fully — Arenas 1–3 seed proposals; you approve them. Start early with notifications/workforce/roles (independent), then approvals inbox once proposals exist. KYC provider work coordinates with Arena 1's consumer.
- **Handoff format:** `files | routes | endpoints | guards | tests | evidence | regression`.

---

## 8) Start commands

```bash
git fetch origin
git checkout arena/5-main-web-audit
git checkout -b arena/5-a4-notifications-admin
# implement, then:
npm run --prefix apps/admin-web test -- --watchAll=false
gh pr create --base arena/5-main-web-integration --title "Arena 4: notifications/admin — COMPLETE" --body "See criteria"
```
