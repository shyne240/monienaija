# ARENA 2 — Agents, POS & Agent Management

**Copy-ready implementation prompt — paste into Arena 2 branch session** — RECONCILED 2026-11-20
**Author:** Arena 5 (integration/architecture)
**Baseline:** `arena/1f37a4f3-monienaija` @ `0350563d` → `arena/5-main-web-audit` + `arena/5-main-web-integration` @ `0350563d` · Application candidate `e9e5651d` · 166 migrations · `dist/main.js` + `dist/config/data-source.js` (`migrationsRun:false`) verified — reconciled 8 sections, 33 routable (32 menu + 1 contextual), 21/8/4/0
**Frozen predecessors:** `arena/defdd0fd-monienaija`, `arena/bcf44621-monienaija`, `main` — never mutate.
**Financial engine:** Preserved — no `src/ledger|reconciliation|commercial-accounting|banking` core change without Arena 5 + defect proof.

---

## 1) Mission

Own **Agents + POS/outlet + agent classes** and make every owned screen COMPLETE. The admin web's largest screen (`AgentNetworkScreen.tsx` 5215 lines) is yours — replace aggregator-fallback mocks with real pagination, finish the funding/defunding + lifecycle approval loop, and wire outlet/POS linkage.

Parallel with Arenas 1/3/4; Arena 5 merges.

---

## 2) Scope — menu/routes

| Section | View key | Label | Guard | Baseline |
|---|---|---|---|---|
| Customers & agents | `agents` | Agents & network | `agent.view` | PARTIAL |
| Customers & agents | `agentClasses` | Agent classes | `agent.view` | COMPLETE |

Contextual: `institutionWorkspace` agent-affiliation tab — you own the *agent-facing* affiliation actions (assign/transfer/suspend/reactivate/terminate). Coordinate with Arena 5.

---

## 3) Files you own

```
apps/admin-web/src/screens/authenticated/AgentNetworkScreen.tsx          # 5215 — your core
apps/admin-web/src/screens/authenticated/AgentClassesScreen.tsx          # 1784
apps/admin-web/src/components/AgentClassAssignmentPanel.tsx
apps/admin-web/src/components/AgentFundingPanel.tsx
apps/admin-web/src/components/AgentCredentialPanel.tsx
apps/admin-web/src/components/AgentUnifiedHistoryPanel.tsx
apps/admin-web/src/components/AgentTransactionPinSupportPanel.tsx
apps/admin-web/__tests__/a2-*.test.tsx                                    # you create
```

Services:

```
apps/admin-web/src/services/ordinary-agent-admin-api.ts   # owned — thin wrappers over internal/admin/agents/*
# read-only consumer of institution-admin-api for affiliations
```

Backend modules you may touch (frontend-first preferred):

`src/agent*`, `src/agent-authentication`, `src/agent-application*`, `src/agent-funding`, `src/outlet`, `src/aggregator`, `src/admin` (agent lifecycle/credentials, affiliations), `src/institution` (affiliation read)

---

## 4) Prohibited — never edit in Arena 2 PRs

```
apps/admin-web/src/screens/authenticated/Layout.tsx          # Arena 5 — 8 sections
apps/admin-web/src/screens/authenticated/navigation-access.ts # Arena 5 — 42 AdminView, 9 aliases
apps/admin-web/src/services/api-client.ts                     # Arena 5
apps/admin-web/src/store/auth-store.ts                        # Arena 5
apps/admin-web/src/services/institution-admin-api.ts          # Arena 5 — read-only consumer only
apps/admin-web/src/components/CountrySelect.tsx               # Arena 5
apps/admin-web/src/config/*
apps/admin-web/src/design-system/tokens.css
apps/admin-web/src/screens/authenticated/Customer*.tsx        # Arena 1
apps/admin-web/src/screens/authenticated/SupportTicketsScreen.tsx # Arena 1
apps/admin-web/src/screens/authenticated/ComplianceScreen.tsx # Arena 1 (kyc+cases)
apps/admin-web/src/screens/authenticated/Kyc*.tsx             # Arena 1
apps/admin-web/src/screens/authenticated/LimitAssignmentScreen.tsx # Arena 1 — primary (catalogue from Arena 3)
apps/admin-web/src/screens/authenticated/LedgerOperationsScreen.tsx # Arena 3
apps/admin-web/src/screens/authenticated/ReconciliationObservabilityScreen.tsx # Arena 3
apps/admin-web/src/screens/authenticated/CommercialRulesScreen.tsx # Arena 3
apps/admin-web/src/screens/authenticated/NotificationManagementScreen.tsx # Arena 4
src/ledger/**  src/reconciliation/**  src/banking/**  src/commercial-accounting/**
```

Need a new view key → issue for Arena 5 (Arena 5 adds `AdminView` + guard).

**Funding safety boundary:** You may implement maker proposal creation and checker approval flow; you may NOT mutate ledger balances directly — `agent-funding` backend is the sole writer. If you touch funding, include `src/agent-funding` change justification + Arena 5 review.

---

## 5) Backend requirements — endpoints (all exist)

| Need | Endpoint | Module |
|---|---|---|
| Agent directory (paged) | `GET internal/admin/agents?search=&status=&page=&limit=` | `admin/admin-agent.controller` |
| Agent lifecycle | `POST internal/admin/agents/:id/suspend\|reactivate\|terminate` (proposal) | `admin/admin-agent-lifecycle.controller` |
| Agent credentials/PIN | `POST internal/admin/agents/:id/credentials/*` | `admin/admin-agent-credentials.controller` |
| Agent applications | `GET internal/agents/applications?status=`, `POST internal/agents/applications/:id/approve` | `agent-application-*` |
| Agent classes | `GET internal/agents/classes`, `POST internal/agents/classes`, `POST internal/agents/classes/:id/assign` | `agent-class.controller` |
| Affiliations | `POST internal/agent-affiliations`, `POST internal/institution-agent-directory` (read) | `admin`, `institution` |
| Outlets/POS | `GET outlet/*`, `POST internal/admin/agents/:id/outlets` | `outlet` |
| Aggregator | `GET internal/aggregators` | `aggregator` |
| Funding | `GET/POST agent-funding/*` via admin adapter | `agent-funding`, `ordinary-agent-admin-api` |

Maker→checker: lifecycle/credential/funding mutations are proposals; checker approves in `approvalsInbox` (Arena 4 + `FINANCE_CONTROLLER`).

---

## 6) Acceptance criteria

- [ ] **Directory pagination real:** `AgentNetworkScreen` paginates `internal/admin/agents` (not 37 mock rows). Search, status filter, aggregator filter, sort all hit API. Empty/error/loading states correct.
- [ ] **Agent detail:** Selecting a row opens a workspace (drawer/panel) with funding, credentials, history, affiliation — each tab loads real data.
- [ ] **Funding lifecycle:** View funding balance/history, create funding/defunding proposal (maker), approval visible in `approvalsInbox` (Arena 4) when checker completes; balance never mutated via direct `fetch` bypass.
- [ ] **Outlet/POS:** List outlets for agent, assign outlet (proposal), show outlet status; error when agent has no eligible outlet — not silent success.
- [ ] **Agent classes:** CRUD class with capability matrix persists via `internal/agents/classes`; assignment panel `AgentClassAssignmentPanel` assigns/unassigns class to agent with proposal.
- [ ] **Credentials/PIN support:** Credential issuance/rotation via `admin-agent-credentials`; transaction-PIN support panel shows PIN status (no plaintext PIN ever rendered).
- [ ] **History:** `AgentUnifiedHistoryPanel` merges lifecycle + funding + affiliation + transaction references with correct timestamps; no invented figures.
- [ ] **Affiliations:** Assign/transfer/suspend/reactivate/terminate agent↔institution affiliation (when you own that flow) — proposal-gated, evidence reference required.
- [ ] **Guards:** `agent.view` controls `agents`+`agentClasses` nav visibility and screen access; `menu-visibility-11-roles` coverage for your views.
- [ ] **Funding safety:** No client-side balance arithmetic; no ledger double-entry from your screen — `agent-funding` backend owns.
- [ ] **Design/API hygiene:** `ApiClient` only, idempotency on POST, `Guarded` banner on guard fail, `WorkspaceDrawer` for detail, tokens.css spacing only.
- [ ] **Tests:** `__tests__/a2-agents.test.tsx` — guards, pagination, class CRUD, assignment, funding proposal, credential flow; all `apps/admin-web` tests pass.
- [ ] **Handoff:** PR lists files | routes | endpoints | guards | tests | evidence | regression.

---

## 7) Branch & integration

- **Branch from:** `arena/5-main-web-audit` @ `0350563d` (already exists — frozen audit) → `arena/5-a2-agents-pos`.
- **PR into:** `arena/5-main-web-integration` @ `0350563d` (already exists).
- **Coordination:** Institution affiliations (Arena 5) + funding approvals (Arena 4) — read-only consumers, not file co-ownership. `LimitAssignmentScreen` is primary Arena 1; you do not edit it — agent limits there are read via `limit-catalog` contract. No conflicting file assigned to Arena 1.
- **Reconciled baseline guard:** Your 2 views (`agents`, `agentClasses`) are exactly those in master matrix with Arena=2. Verified no shared file assigned to both 1 and 2.
- **Handoff format:** `files | routes | endpoints | guards | tests | evidence | regression`.

---

## 8) Start commands

```bash
git fetch origin
git checkout arena/5-main-web-audit   # @ 0350563d — already exists
git checkout -b arena/5-a2-agents-pos
# implement owned screens only (see §3 — 7 files, no shared-file violation), then:
npm run --prefix apps/admin-web test -- --watchAll=false
# verify no shared-file violation:
git diff --name-only origin/arena/5-main-web-audit | grep -E "^(apps/admin-web/src/screens/authenticated/Layout\.tsx|apps/admin-web/src/screens/authenticated/navigation-access\.ts|apps/admin-web/src/services/api-client\.ts|apps/admin-web/src/services/institution-admin-api\.ts|apps/admin-web/src/components/CountrySelect\.tsx)" && echo "BLOCKED — shared file edited, needs Arena 5 approval" || echo "OK"
gh pr create --base arena/5-main-web-integration --title "Arena 2: agents/POS — COMPLETE" --body "See ARENA-2 prompt §6 acceptance criteria — files | routes | endpoints | guards | tests | evidence | regression"
```
