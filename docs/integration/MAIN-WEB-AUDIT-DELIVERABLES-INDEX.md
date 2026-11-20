# Arena 5 Main Web Audit — Deliverables Index

**Branch:** `arena/1f37a4f3-monienaija` @ `0350563d` → integration: `arena/5-main-web-audit` + `arena/5-main-web-integration` (both @ `0350563d`)
**Application candidate:** `e9e5651d` · 166 migrations · `dist/main.js` + `dist/config/data-source.js` (`migrationsRun:false`) verified
**Date:** 2026-11-20 · **Lead:** Arena 5 (integration/architecture)
**Frozen predecessors (never mutate):** `arena/defdd0fd-monienaija`, `arena/bcf44621-monienaija`, `main`
**Financial engine:** Preserved (no `src/ledger|reconciliation|commercial-accounting|banking|transfer` change without defect + Arena 5 approval)

---

## Deliverables (7 + P2–P5 overlay) — location + status

| # | Deliverable | File | Status |
|---|---|---|---|
| 1 | Navigation audit (8 sections, 33 routable = 32 menu + 1 contextual, 9 legacy aliases, 42 AdminView values, guards, classification 21/8/4/0) | `docs/integration/MAIN-WEB-NAVIGATION-AUDIT.md` | Done — reconciled |
| 2 | Backend service → page mapping (10 domains + §5 uncovered capabilities without UI, controller prefixes, cross-arena deps, gaps) | `docs/integration/MAIN-WEB-BACKEND-SERVICE-MAPPING.md` | Done — expanded |
| 3 | Arena ownership boundaries (single primary owner per route, 1–5 owned/prohibited files, shared file protocol, institution overlap) | `docs/integration/MAIN-WEB-ARENA-OWNERSHIP-AND-INTEGRATION-RULES.md` (§1–§2) | Done — reconciled |
| 4 | Integration rules (baseline, design/API/permission/navigation conventions, order, handoff, regression) | `docs/integration/MAIN-WEB-ARENA-OWNERSHIP-AND-INTEGRATION-RULES.md` (§4–§6) | Done |
| 5 | 4 copy-ready implementation prompts (scope/routes/owned dirs/backend reqs/acceptance; baselines corrected, no conflicting shared-file assignments) | `docs/integration/arena-prompts/ARENA-{1,2,3,4}-*.md` | Done — corrected |
| 6 | Master page-by-page functionality matrix (33 routes × status/missing/Arena/deps/priority/acceptance; source of truth) | `docs/integration/MAIN-WEB-MASTER-FUNCTIONALITY-MATRIX.md` | Done — reconciled, source of truth (priority overlay in new doc §1) |
| 7 | This index + reconciled totals + branch/regression instructions | This file | Done |
| 8 | **Priority overlay P2–P5** — commercial (fees/commissions/limits) audit, claiming flows, automatic-POS resolution, 10-item acceptance gates, approval decisions | `docs/integration/MAIN-WEB-PRIORITY-PLAN-P2-P5.md` | **Done — new (§1–§8)** |

---

## Navigation summary (preserved — do not reorganize)

`apps/admin-web` is the main web (no separate `main-web` app). IA is defined in `Layout.tsx:312–500` (`sections[]` 8 objects: `home`, `servicing`, `institutions`, `money`, `finance`, `commercial`, `compliance`, `platform`) and enforced by `navigation-access.ts` (33 canonical `AdminView` + 9 legacy aliases = 42 `AdminView` values, function-code guards). Totals: **8 sections, 33 routable views (32 menu items + 1 contextual `institutionWorkspace`), 9 legacy aliases, 0 broken routes, 21 COMPLETE / 8 PARTIAL / 4 PLACEHOLDER**. Conceptual missing capabilities (reporting/analytics, automatic POS, etc.) are separate — see Deliverable 2 §5 and are not counted in the 33.

See Deliverable 1 for the full 33-row table with guards and Deliverable 6 (source of truth) for the priority-gated matrix.

---

## Arena summary

| Arena | Scope | Entry PR | Depends on |
|---|---|---|---|
| 1 | Customers, KYC, customer service (complaints/disputes) | `arena/5-a1-customers-kyc` | — (start immediately) |
| 2 | Agents, POS, agent classes | `arena/5-a2-agents-pos` | Institutions (5) — read-only |
| 3 | Transactions, banking, finance, reconciliation, commercial | `arena/5-a3-transactions-finance` | 1 (customer context) ideal |
| 4 | Notifications, admin, system health, audit, dashboard | `arena/5-a4-notifications-admin` | 1+2+3 proposals (approvals sink) |
| 5 | Shell, navigation, API contract, institutions, QA, merges | This branch + `arena/5-main-web-audit` + `arena/5-main-web-integration` | All |

Centrally owned (Arena 5 only): `Layout.tsx`, `navigation-access.ts`, `api-client.ts`, `auth-store.ts`, `config/*`, `design-system/tokens.css`.

---

## Reconciled inventory totals

| Dimension | Count | Note |
|---|---|---|
| Sections (Layout.tsx `sections[]`) | **8** | `home`, `servicing`, `institutions`, `money`, `finance`, `commercial`, `compliance`, `platform` — comment "Seven" in source is stale |
| Menu items | **32** | 2+4+1+4+3+6+5+7 across the 8 sections |
| Contextual routes (no menu entry) | **1** | `institutionWorkspace` (requires `institutionId`) |
| Routable destinations | **33** | 32 + 1 — the 33 rows in the master matrix |
| Legacy aliases | **9** | `ledger→ledgerExplorer` etc. — not separate destinations |
| AdminView union size | **42** | 33 canonical + 9 legacy |
| COMPLETE | **21** | See master matrix |
| PARTIAL | **8** | Arena-owned completions in progress |
| PLACEHOLDER | **4** | cashIn/cashOut aliases + rewardRules + productCatalogue |
| BROKEN | **0** | |
| Conceptual missing (not routable) | **8** | Reporting/analytics hub, automatic POS provisioning, wallet/virtual-account admin, aggregator admin, disputes standalone, partner-callback inspector, policy/B1/B2 engines UI, external-settlement viewer — see Deliverable 2 §5 |

This table is the reconciled count. If any other doc disagrees, this doc + the master matrix win.

## Branch & regression model

```bash
# Integration branches already exist at 0350563d:
#   arena/5-main-web-audit        — frozen audit baseline (do not force-push)
#   arena/5-main-web-integration  — merge target for Arenas 1–4

# Each arena (verified start instructions — see also ARENA-*-*.md §7):
git fetch origin && git checkout arena/5-main-web-audit
git checkout -b arena/5-a<N>-<slug>   # e.g. arena/5-a1-customers-kyc
# ...implement owned screens only (see ownership doc §2 for prohibited files)...
npm run --prefix apps/admin-web test -- --watchAll=false   # must pass

# Verify no financial-engine or shared-file violation before PR:
git diff --name-only origin/arena/5-main-web-audit | grep -E "^(apps/admin-web/src/screens/authenticated/Layout\.tsx|apps/admin-web/src/screens/authenticated/navigation-access\.ts|apps/admin-web/src/services/api-client\.ts|apps/admin-web/src/store/auth-store\.ts|src/(ledger|reconciliation|commercial-accounting|banking|transfer)/)" && echo "BLOCKED — get Arena 5 approval" || echo "OK"

gh pr create --base arena/5-main-web-integration --title "Arena <N>: <scope> — COMPLETE" --body "Files | Routes | Endpoints | Guards | Tests | Evidence | Regression — see ARENA-<N> prompt §6"
```

**Regression gate:** `npm run --prefix apps/admin-web test -- --watchAll=false` (~87 suites 880 tests incl. `menu-visibility-11-roles`, `navigation-access`, `m1-*`, `m2-*`) + `apps/api` 16+4 release gate (16 migration/config/data-source, 4 readiness) must stay green. No deploy/merge to `main`. Arena 5 reviews and integrates after acceptance tests pass — do not self-merge.

---

## How to review this audit

1. Read this index.
2. Read `MAIN-WEB-NAVIGATION-AUDIT.md` for the per-screen classification.
3. Read `MAIN-WEB-BACKEND-SERVICE-MAPPING.md` for endpoint→page proof.
4. Read `MAIN-WEB-ARENA-OWNERSHIP-AND-INTEGRATION-RULES.md` for ownership + integration rules.
5. Read `MAIN-WEB-MASTER-FUNCTIONALITY-MATRIX.md` for the single-table work planner (33 routes).
6. Read `MAIN-WEB-PRIORITY-PLAN-P2-P5.md` for commercial/claiming/POS priority overlay and acceptance gates (§1–§8).
7. Open the `arena-prompts/ARENA-<N>-*.md` relevant to your Arena — it is paste-ready into your session.

Questions → file an issue against `arena/5-main-web-audit` for Arena 5 triage.

---

## Priority overlay (P1–P5) at a glance

P1 Customer/agent management — Arenas 1/2 continue, no rebuild. P2 Commercial (fees/commissions/limits, KYC≠CoS, CoS never overrides KYC) — Arena 3 configures catalogue/rules, Arenas 1/2 integrate auto-assignment on onboarding. P3 Account claiming (2 flows, duplicate-safe) — Arena 1 verifies existing `MobileAccountClaimService` contracts. P4 Automatic POS — supported outlets/terminals CRUD is Arena 2 (existing contracts); auto-provisioning is explicitly blocked pending product approval. P5 Ten acceptance gates (tier assignment, fees from approved rules, limits enforced including concurrency, no self-approval, etc.). Decisions requiring your approval are in `MAIN-WEB-PRIORITY-PLAN-P2-P5.md §7`.
