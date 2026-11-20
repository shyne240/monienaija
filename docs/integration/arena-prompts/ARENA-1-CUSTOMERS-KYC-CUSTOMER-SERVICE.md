# ARENA 1 — Customers, KYC & Customer Service (Complaints/Disputes)

**Copy-ready implementation prompt — paste into Arena 1 branch session** — RECONCILED 2026-11-20
**Author:** Arena 5 (integration/architecture)
**Baseline:** `arena/1f37a4f3-monienaija` @ `0350563d` → `arena/5-main-web-audit` + `arena/5-main-web-integration` @ `0350563d` · Application candidate `e9e5651d` · 166 migrations · `dist/main.js` + `dist/config/data-source.js` (`migrationsRun:false`) verified — reconciled 8 sections, 33 routable (32 menu + 1 contextual), 21/8/4/0
**Frozen predecessors:** `arena/defdd0fd-monienaija`, `arena/bcf44621-monienaija`, `main` — never mutate or merge into.
**Financial engine:** Preserved — do not touch `src/reconciliation`, `src/commercial-accounting`, `src/ledger`, `src/transfer`, `src/banking` double-entry/balance logic unless Arena 5 approves a demonstrated defect with regression.

---

## 1) Your mission

Own **Customers + KYC + customer-support/complaints/disputes** in `apps/admin-web` and make every owned screen COMPLETE (no mock money, real pagination/search/filters, proper loading/empty/error/permission states).

You parallelize with Arenas 2/3/4. Arena 5 owns navigation/shell/API contract and merges you.

---

## 2) Scope — menu sections & routes you own

From `apps/admin-web/src/screens/authenticated/Layout.tsx` (8 sections, 33 views) and `navigation-access.ts` (function-code guards):

| Section | View key | Label | Guard | Status at baseline |
|---|---|---|---|---|
| Customers & agents | `customers` | Customers | `customer.view` | COMPLETE |
| Customers & agents | `support` | Support Inbox | `customer.manage_support_case` | COMPLETE |
| Products & pricing | `limitAssignments` | Limit assignments | `limit.view/modify/assign` | COMPLETE (co-own with Arena 3 — customer side) |
| Risk & compliance | `kycQueue` | KYC reviews | `kyc.view` | COMPLETE |
| Risk & compliance | `kycProviders` | KYC providers | `kyc.provider.view` | COMPLETE |
| Risk & compliance | `kycTierPolicies` | KYC tier policies | `kyc.policy.view` | COMPLETE |
| Risk & compliance | `complianceCases` | Compliance cases | `compliance.manage_case` | COMPLETE |
| Risk & compliance | `fraudCases` | Fraud cases | `risk_fraud.manage_fraud_case` | PARTIAL — you enrich it |

**Institution workspace — customer-facing slices:** you own the *customer* tabs inside `InstitutionWorkspaceScreen` and `InstitutionRelationshipTabs` (enrolment + KYC tier-limit policy). Coordinate with Arena 5; do not edit Layout's section definition.

---

## 3) Exact files you own / may create

### Owned (edit freely — exactly one primary owner per file, not shared)

```
apps/admin-web/src/screens/authenticated/CustomerDirectoryScreen.tsx
apps/admin-web/src/screens/authenticated/Customer360Workspace.tsx
apps/admin-web/src/screens/authenticated/CustomerPersonalInformationPanel.tsx
apps/admin-web/src/screens/authenticated/CustomerProofOfAddressPanel.tsx
apps/admin-web/src/screens/authenticated/CustomerRegistrationWizard.tsx
apps/admin-web/src/screens/authenticated/CustomerTier3ReadinessPanel.tsx
apps/admin-web/src/screens/authenticated/CustomerFormFields.tsx
apps/admin-web/src/screens/authenticated/SupportTicketsScreen.tsx
apps/admin-web/src/screens/authenticated/ComplianceScreen.tsx
apps/admin-web/src/screens/authenticated/KycProviderManagementScreen.tsx
apps/admin-web/src/screens/authenticated/KycTierPolicyManagementScreen.tsx
apps/admin-web/src/screens/authenticated/RiskFraudScreen.tsx
apps/admin-web/src/screens/authenticated/LimitAssignmentScreen.tsx   # primary Arena 1 — catalogue contract from Arena 3, not co-owned
apps/admin-web/__tests__/a1-*.test.tsx                                 # you create
```

### Services (owned)

```
apps/admin-web/src/services/kyc-governance-api.ts          # primary Arena 1 — KYC provider routing is Arena 1; Arena 4 owns notification provider config separately (distinct module: notification/provider-config)
# institution-admin-api.ts is Arena 5 owned — you are a read-only consumer (do not edit) for customer enrolment / KYC tier-limit policy reads
# Do not create a new api client — use ApiClient from services/api-client.ts (Arena 5 owned)
```

### Backend modules you will touch (only if needed — prefer frontend-first)

`src/customer*`, `src/customer-registration`, `src/customer-proof-of-address`, `src/kyc-verification`, `src/identity-verification`, `src/compliance`, `src/fraud`, `src/support`, `src/disputes`, `src/limit` (assignment slice only)

---

## 4) Prohibited — never edit these in Arena 1 PRs

```
apps/admin-web/src/screens/authenticated/Layout.tsx          # Arena 5 — 8 sections
apps/admin-web/src/screens/authenticated/navigation-access.ts # Arena 5 — 42 AdminView, 9 aliases
apps/admin-web/src/services/api-client.ts                     # Arena 5
apps/admin-web/src/store/auth-store.ts                        # Arena 5
apps/admin-web/src/services/institution-admin-api.ts          # Arena 5 — read-only consumer only
apps/admin-web/src/components/CountrySelect.tsx               # Arena 5 — do not fork
apps/admin-web/src/config/*
apps/admin-web/src/design-system/tokens.css
apps/admin-web/src/screens/authenticated/AgentNetworkScreen.tsx    # Arena 2
apps/admin-web/src/screens/authenticated/AgentClassesScreen.tsx   # Arena 2
apps/admin-web/src/components/AgentClassAssignmentPanel.tsx   # Arena 2
apps/admin-web/src/components/AgentFundingPanel.tsx           # Arena 2
apps/admin-web/src/screens/authenticated/NotificationManagementScreen.tsx # Arena 4
apps/admin-web/src/screens/authenticated/BankingOperationsScreen.tsx      # Arena 3
apps/admin-web/src/screens/authenticated/LedgerOperationsScreen.tsx       # Arena 3
apps/admin-web/src/screens/authenticated/CommercialRulesScreen.tsx         # Arena 3
src/ledger/**        # financial engine — frozen
src/reconciliation/** # financial engine — frozen
src/banking/**       # financial engine (readiness display is Arena 3 — not you)
src/commercial-accounting/** # frozen
```

If you need a new view key or nav label → open an issue for Arena 5; Arena 5 adds `AdminView` + alias + guard, then you implement the screen.

Shared `LimitAssignmentScreen` rule: you may change customer-assignment flows; if you need catalogue-side changes → PR against Arena 3's integration branch and Arena 5 merges. Never break agent-assignment paths.

---

## 5) Backend requirements — endpoints you must use (all exist)

| Need | Endpoint pattern | Module |
|---|---|---|
| Customer directory/search/page | `GET internal/admin/customers?search=&page=&tier=` | `internal/admin/customers` |
| Customer 360 reads | `GET internal/admin/customers/:id/*`, `GET internal/customers/:id` | `admin` |
| Customer registration | `POST customers/registration`, `GET customers/registration-sessions` | `customer-registration` |
| Proof-of-address | `GET/POST customers/:customerId/proof-of-address` | `customer-proof-of-address` |
| KYC queue / tier review | `GET internal/kyc/tier-reviews?status=PENDING`, `POST internal/kyc/tier-reviews/:id/approve\|reject` | `kyc-verification` |
| KYC providers | `GET /internal/kyc/providers`, `PUT /internal/kyc/providers` (via proposal) | `kyc-verification` |
| KYC tier policies | `GET /internal/kyc/tier-policies`, `GET internal/institutions/:id/kyc-tier-limit-policy` | `kyc-verification`, `institution` |
| Support cases | `GET internal/admin/support?status=`, `PATCH internal/admin/support/:id` | `support` |
| Compliance/fraud cases | `GET compliance/*`, `GET fraud/*` | `compliance`, `fraud` |
| Limit assignments | `GET limits/assignments`, `POST limits/assignments` (proposal) | `limit`, `product-governance` |

All writes that change governed state are **maker→checker**: your maker screen creates a proposal, Arena 4's `approvalsInbox` (checker with `FINANCE_CONTROLLER+privileged:approve`) approves. Never `POST` a direct mutation where the backend expects a proposal — check `src/authorization-catalogue` for the governing function code.

---

## 6) Acceptance criteria (every PR you open must meet these)

- [ ] **Real data path:** Customer directory paginates real `internal/admin/customers` data (not static mock array). Search, filter, sort, pagination all hit the API.
- [ ] **Customer 360:** Personal info, proof-of-address, tier-3 readiness panels load real records; contextual navigation `onBackToCustomer` / `onNavigate(view,customerId)` works from and to `customers`.
- [ ] **KYC queue:** Queue lists `tier-reviews` with filters (PENDING/APPROVED/REJECTED), approve/reject persists, evidence visible, decision audit-linked.
- [ ] **KYC providers/policies:** Configure primary/fallback routing and tier policies; changes go through proposal → approval (visible in `approvalsInbox` when Arena 4 is present).
- [ ] **Support inbox:** Lifecycle OPEN→IN_PROGRESS→RESOLVED with assignment, SLA, agent↔customer deep-link (`navContext.agentId/customerId`).
- [ ] **Compliance/fraud:** Compliance cases lifecycle; fraud cases at least paginate, assign, and show detail — enrich beyond baseline thin 252-line view (evidence, resolution).
- [ ] **Limit assignments (customer side):** Browse catalogue, assign to customer with tier override, override validated, approval-gated where governed.
- [ ] **States:** Every owned screen has loading, empty, error, and permission-denied (`Guarded` banner via `on*GuardChange`) states. No silent 403.
- [ ] **Guards:** All `canAccessAdminView` codes from `navigation-access.ts` are respected; `menu-visibility-11-roles.test.tsx` style coverage passes for your views.
- [ ] **Design tokens:** Use `design-system/primitives`, `WorkspaceDrawer`, `tokens.css`. No new color token without Arena 5.
- [ ] **API hygiene:** All calls via `ApiClient` with idempotency on mutating POST. Handle `ApiError 401→onWorkforceSessionExpired`.
- [ ] **Tests:** New `__tests__/a1-customer-kyc-support.test.tsx` covers guards + key actions + pagination; existing `apps/admin-web` tests still pass (`npm run --prefix apps/admin-web test -- --watchAll=false`).
- [ ] **No financial engine change:** `src/ledger`, `src/reconciliation`, `src/banking` untouched (or Arena-5-approved with regression).
- [ ] **Handoff:** PR description lists owned files, backend endpoints used, guard assertions, test file, screenshot/log evidence path.

---

## 7) Branch & integration rules

- **Branch from:** `arena/5-main-web-audit` @ `0350563d` (already exists — frozen audit). Name: `arena/5-a1-customers-kyc`.
- **PR into:** `arena/5-main-web-integration` @ `0350563d` (already exists).
- **Shared files:** Never edit `Layout.tsx`/`navigation-access.ts`/`api-client.ts`/`institution-admin-api.ts` without Arena 5. `LimitAssignmentScreen` is primary Arena 1 (catalogue contract from Arena 3 via typed `limit-catalog` API) — no co-ownership; catalogue reads do not conflict.
- **Handoff format:** PR must include `files | routes | endpoints | guards | tests | evidence | regression` (see criterion above).

---

## 8) How to start (copy commands)

```bash
git fetch origin
git checkout arena/5-main-web-audit   # @ 0350563d — already exists
git checkout -b arena/5-a1-customers-kyc
# implement owned screens only (see §3 — 13 files, no shared-file violation), then:
npm run --prefix apps/admin-web test -- --watchAll=false
# verify no shared-file violation:
git diff --name-only origin/arena/5-main-web-audit | grep -E "^(apps/admin-web/src/screens/authenticated/Layout\.tsx|apps/admin-web/src/screens/authenticated/navigation-access\.ts|apps/admin-web/src/services/api-client\.ts|apps/admin-web/src/services/institution-admin-api\.ts|apps/admin-web/src/components/CountrySelect\.tsx)" && echo "BLOCKED — shared file edited, needs Arena 5 approval" || echo "OK"
gh pr create --base arena/5-main-web-integration --title "Arena 1: customers/KYC/support — COMPLETE" --body "See ARENA-1 prompt §6 acceptance criteria — files | routes | endpoints | guards | tests | evidence | regression"
```
