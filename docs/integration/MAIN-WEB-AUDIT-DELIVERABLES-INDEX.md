# Arena 5 Main Web Audit — Deliverables Index

**Branch:** `arena/1f37a4f3-monienaija` (this session) → next: `arena/5-main-web-audit` → `arena/5-main-web-integration`
**Baseline:** `e9e5651d` (→ `HEAD 98b067bc`) · 166 migrations · `dist/main.js` + `dist/config/data-source.js` (`migrationsRun:false`) verified
**Date:** 2026-11-20 · **Lead:** Arena 5 (integration/architecture)
**Frozen predecessors (never mutate):** `arena/defdd0fd-monienaija`, `arena/bcf44621-monienaija`, `main`
**Financial engine:** Preserved (no `src/ledger|reconciliation|commercial-accounting|banking|transfer` change without defect + Arena 5 approval)

---

## Deliverables (7) — location + status

| # | Deliverable | File | Status |
|---|---|---|---|
| 1 | Navigation audit (8 sections, 33 views, 11 legacy aliases, guards, classification COMPLETE/PARTIAL/PLACEHOLDER/BROKEN) | `docs/integration/MAIN-WEB-NAVIGATION-AUDIT.md` | Done |
| 2 | Backend service → page mapping (all 10 domains, controller prefixes, cross-arena deps, gaps) | `docs/integration/MAIN-WEB-BACKEND-SERVICE-MAPPING.md` | Done |
| 3 | Arena ownership boundaries (1–5 owned/prohibited files, shared file protocol, institution overlap) | `docs/integration/MAIN-WEB-ARENA-OWNERSHIP-AND-INTEGRATION-RULES.md` (§1–§2) | Done |
| 4 | Integration rules (baseline, design/API/permission/navigation conventions, order, handoff, regression) | `docs/integration/MAIN-WEB-ARENA-OWNERSHIP-AND-INTEGRATION-RULES.md` (§4–§6) | Done |
| 5 | 4 copy-ready implementation prompts (scope/routes/owned dirs/backend reqs/acceptance) | `docs/integration/arena-prompts/ARENA-{1,2,3,4}-*.md` | Done |
| 6 | Master page-by-page functionality matrix (status/missing/Arena/deps/priority/acceptance) | `docs/integration/MAIN-WEB-MASTER-FUNCTIONALITY-MATRIX.md` | Done |
| 7 | This index + branch/regression instructions | This file | Done |

---

## Navigation summary (preserved — do not reorganize)

`apps/admin-web` is the main web (no separate `main-web` app). IA is defined in `Layout.tsx:312–500` (sections[]) and enforced by `navigation-access.ts` (40 `AdminView` + 8 legacy aliases, function-code guards). Totals: 7 sections, 33 routable views, 0 broken routes, 4 placeholders (deferred P3), 10 partials (arena-owned), 18 completes.

See Deliverable 1 for the full 33-row table with guards and Deliverable 6 for the priority-gated matrix.

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

## Branch & regression model

```bash
# Arena 5 creates integration branches (next step after this audit is pushed):
git checkout arena/1f37a4f3-monienaija
git checkout -b arena/5-main-web-audit && git push -u origin arena/5-main-web-audit
git checkout -b arena/5-main-web-integration && git push -u origin arena/5-main-web-integration

# Each arena:
git fetch origin && git checkout arena/5-main-web-audit
git checkout -b arena/5-a<N>-<slug>   # per prompt §7
# ...implement...
npm run --prefix apps/admin-web test -- --watchAll=false   # must pass
gh pr create --base arena/5-main-web-integration
```

**Regression gate:** `npm run --prefix apps/admin-web test -- --watchAll=false` (~80 tests incl. `menu-visibility-11-roles`, `navigation-access`, `m1-*`, `m2-*`) + `apps/api` 16+4 release gate (16 migration/config/data-source, 4 readiness) must stay green. No deploy/merge to `main`.

---

## How to review this audit

1. Read this index.
2. Read `MAIN-WEB-NAVIGATION-AUDIT.md` for the per-screen classification.
3. Read `MAIN-WEB-BACKEND-SERVICE-MAPPING.md` for endpoint→page proof.
4. Read `MAIN-WEB-ARENA-OWNERSHIP-AND-INTEGRATION-RULES.md` for ownership + integration rules.
5. Read `MAIN-WEB-MASTER-FUNCTIONALITY-MATRIX.md` for the single-table work planner.
6. Open the `arena-prompts/ARENA-<N>-*.md` relevant to your Arena — it is paste-ready into your session.

Questions → file an issue against `arena/5-main-web-audit` for Arena 5 triage.
