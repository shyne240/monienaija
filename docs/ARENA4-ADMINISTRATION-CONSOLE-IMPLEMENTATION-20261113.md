# ARENA 4 — Institutional Administration Console (Admin Web) — 2026-11-13

Status: implemented in this branch on top of the completed institutional foundation
(`684271e`) and the Phase 3 console reads (`0b3138f`).

Scope of this document: the operational console that makes the institutional foundation usable by
workforce operators. It adds **no** new financial authority, **no** second approval system, **no**
balance migration, and **no** mock data.

---

## 1. What was reused (Admin Web architecture inspection)

| Concern                                             | Existing mechanism reused                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell, navigation, section groups, mobile drawer    | `screens/authenticated/Layout.tsx`, `navigation-access.ts` (`AdminView`, `canAccessAdminView`, contextual `AdminNavigationContext`)              |
| Route guard                                         | `canAccessAdminView` — function-code based; the backend route guard stays authoritative                                                          |
| Design system                                       | `design-system/primitives.tsx` (`PageHeader`, `Button`, `Field`, `StatusBadge`, `Alert`, `ScrollRegion`), `tokens.css`, `workspace-patterns.css` |
| Approvals (maker–checker, MFA, payload fingerprint) | Existing `POST /internal/a2/workforce/approvals/:id/approve`; the console renders the same progress the foundation already records               |
| Confirmations for consequential actions             | `window.confirm` gate before any execute/revoke (same convention as `WorkforceAdminScreen`)                                                      |
| Tables, loading/empty/error states                  | Console-local `mn-inst__*` classes over the existing semantic tokens                                                                             |
| API transport / error semantics                     | `services/api-client.ts` (`ApiClient`), error `status` mapped to actionable copy                                                                 |

No parallel application, no duplicate design system, no new approval infrastructure.

## 2. Screens and routes

Navigation: a new **Institutions** section (`section-institutions`) with one sidebar entry,
`nav-institutions` ("Institution directory"). The workspace is a **contextual** route, reachable
only with an institution id selected in the directory — it has no sidebar entry, exactly like the
customer-contextual transaction routes.

| View (`AdminView`)                                   | Component                    | Route                       |
| ---------------------------------------------------- | ---------------------------- | --------------------------- |
| `institutions`                                       | `InstitutionDirectoryScreen` | `/` shell → Institutions    |
| `institutionWorkspace` (contextual: `institutionId`) | `InstitutionWorkspaceScreen` | opened from a directory row |

Workspace tabs (`role="tab"`): **Overview**, **Lifecycle & approvals**, **Agents & affiliations**,
**Workforce access**, **Customer enrolments**, **Accounts & attribution**, **Activity**
(`InstitutionRelationshipTabs.tsx` holds the last four).

### 2.1 Directory

Listing scoped by the backend; search (reference/code/legal name/regulator) and lifecycle-status
filter; coverage strip derived from the listed records only; platform attribution-gap summary when
the principal holds `institution.attribution.view`; registration form gated on
`institution.manage`. Copy states that a licence reference is recorded evidence, not proof of a
licence, and that registration grants no financial authority.

### 2.2 Overview

Identity/evidence record (regulator, licence reference labelled _unverified evidence_, evidence
reference, status + status reason, authority flag, suspended/closed timestamps, version), coverage
view counts, and a "Needs attention" list: actions awaiting a checker, gaps for this institution,
platform gap total with the resolver's gap reasons. Every figure comes from an endpoint.

### 2.3 Lifecycle & approvals

- Record regulatory evidence (`institution.manage`).
- Request a lifecycle change (`institution.lifecycle.prepare`) → shows the approval id, expiry and
  the requirement that a _different_ principal decides it.
- Execute an approved change (`institution.lifecycle.approve`) with an explicit confirmation; copy
  warns that target status and reason must match the approved payload or the server refuses (403).
- Pending queue from the new institution-scoped read. `Approve` is enabled only when the principal
  holds `privileged:approve` **and** the action's approving function **and** an MFA session **and**
  is not the requester. Approved items offer "Use for execution" (never auto-execute).

### 2.4 Agents & affiliations

Affiliation records for the institution (+ per-agent history from
`GET /internal/agent-affiliations/:agentId/history`), the platform directory filtered to
_affiliated to this institution_ or _unattributed_, and governed request/execute forms. The three
relationships are labelled distinctly (`INSTITUTION_AFFILIATED`, `AGGREGATOR_LINKED`,
`INDEPENDENT`); choosing `AGGREGATOR_RELATIONSHIP` as evidence is explicitly described as
human-supplied evidence, not an automatic affiliation.

### 2.5 Workforce access

Assignments (active + revoked, with granted/revoked actors and timestamps), grant and revoke gated
on `institution.workforce.assign` with a `SUPER_ADMIN`/`ADMINISTRATOR` principal. Copy states that
an institution assignment only adds institution scope — it never adds a function code or widens an
existing authority.

### 2.6 Customer enrolments

Enrolment list (reference, customer, status, financial eligibility, KYC reuse declared, effective
window, approval). One form requests, then executes with the approval id; KYC reuse is
all-or-nothing (evidence + consent + policy) and validated client-side before the request. Copy
states enrolment ≠ financial eligibility and that customer identity stays unified. The
customer-anchored lookup is shown only to the platform marker because that is how the endpoint is
guarded.

### 2.7 Accounts & attribution

Institutional ledger accounts (with scope/purpose), open-account form (settlement/suspense/clearing
only), governed attribution request/execute, and the platform unattributed-account list where each
row is labelled **Attributable via governed request** or **Posted history — not attributable**. The
panel explains that attribution moves no money, that posted ledger history cannot be re-attributed
because the ledger is append-only, and that a governed cut-over is a separate, out-of-scope
operation.

### 2.8 Activity

Entity-anchored audit read (`audit.search`) for `FINANCIAL_INSTITUTION` + id. Roles without
`audit.search` see an explicit "not available to this role" notice instead of a fabricated feed.

## 3. APIs consumed

Existing (Phase 1/2, unchanged):

- `GET /internal/institutions`, `GET /internal/institutions/:id`
- `POST /internal/institutions`, `POST /internal/institutions/:id/evidence`
- `POST /internal/institutions/:id/lifecycle/request`, `POST /internal/institutions/:id/lifecycle`
- `GET /internal/institutions/:id/affiliations`, `GET /internal/institutions/:id/workforce`
- `POST /internal/institutions/:id/workforce`, `DELETE /internal/institutions/:id/workforce/:principalId`
- `GET /internal/agent-affiliations/:agentId/history`, `POST /internal/agent-affiliations/:agentId/request|execute`
- `GET|POST /internal/institutions/:id/enrolments`, `POST /internal/institutions/:id/enrolments/execute`
- `GET|POST /internal/institutions/:id/wallet-attributions`, `POST …/wallet-attributions/execute`
- `GET|POST /internal/institutions/:id/ledger-accounts`
- `GET /internal/institution-ledger/unattributed`, `GET /internal/institution-ledger/coverage`
- `GET /internal/institutions/attribution-gaps[/summary]`
- `GET /internal/institution-enrolments/customers/:customerId`
- `POST /internal/a2/workforce/approvals/:approvalId/approve`
- `GET /internal/audit?entityType=&entityId=&limit=`

Added in this phase (read-only, no financial authority):

1. `GET /internal/institutions/:institutionId/pending-approvals[?limit]`
   — requires `institution.view` **and** `InstitutionWorkforceScopeService.assertCanAccessInstitution`;
   returns `{approvalId, actionType, resourceType, resourceId, requesterPrincipalId, approvedBy,
status, reason, requestedAt, expiresAt, approvedAt, awaitingChecker}` filtered on
   `policy->'requestDetails'->>'institutionId'`. The frozen payload is not returned.
2. `GET /internal/institution-agent-directory[?institutionId&affiliation=AFFILIATED|UNAFFILIATED&search&limit]`
   — requires `institution.attribution.view`; per-agent `{agentId, agentReference, agentStatus,
affiliation…, aggregator…, relationship}`. No balances, no ledger, no writes.

## 4. Authorisation reflected in the UI

| UI affordance                                                                      | Function code(s)                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Open the directory                                                                 | `institution.view`                                                       |
| Register / evidence / open ledger account                                          | `institution.manage` (+ not read-only principal)                         |
| Request lifecycle                                                                  | `institution.lifecycle.prepare`                                          |
| Execute lifecycle                                                                  | `institution.lifecycle.approve`                                          |
| Request affiliation                                                                | `institution.affiliation.prepare`                                        |
| Execute affiliation                                                                | `institution.affiliation.approve`                                        |
| Workforce grant/revoke                                                             | `institution.workforce.assign` + platform role                           |
| Request attribution / enrolment                                                    | `institution.attribution.prepare` / `institution.enrolment.prepare`      |
| Execute attribution / enrolment                                                    | `institution.attribution.approve` / `institution.enrolment.approve`      |
| Approve any governed action                                                        | `privileged:approve` + action's approving function + MFA + not requester |
| Attribution gaps, unattributed accounts, agent directory, customer-anchored lookup | `institution.attribution.view`                                           |
| Activity                                                                           | `audit.search`                                                           |

Hiding an action is presentation only; the backend guard is unchanged and authoritative.

## 5. Verification performed

- Admin Web: `npx jest --watchAll=false` → **85 suites / 867 tests pass**, including the new
  `__tests__/a4-institution-console.test.tsx` (11 tests: route guard, directory listing/registration
  gating, contextual workspace, no-authority warning, governed lifecycle request, self-approval
  disabled, independent MFA checker approval, approval-id + confirmation required before execution,
  posted-history attribution restriction) and the updated
  `__tests__/menu-visibility-11-roles.test.tsx` (30 tests; new section/route markers and the seeded
  `institution.*` grants for all 11 roles).
- Admin Web `npm run ts:check` → clean; `ADMIN_WEB_API_BASE_URL=https://admin.example.test npm run build`
  → success (loopback base URLs are refused by the existing fail-closed config).
- Backend `npx tsc --noEmit`, `eslint`, `prettier --check` → clean.
- Backend integration: `test/institution-console.integration.spec.ts` → **6/6** (run `a4c03`):
  institution-scoped queue, checker progress without payload exposure, cross-institution 404 /
  missing-scope 403 / bad-session 401, platform-only directory with three-way classification, no
  financial data and no row-count change, enrolment request visible in the queue.

## 6. Documented gaps (not worked around)

1. **No generic approval listing.** `GET /internal/a2/workforce/approvals` does not exist; the
   approvals inbox needs a known approval id. The console therefore reads the institution-scoped
   queue added in `0b3138f`. A cross-institution "all institutional approvals" listing would need a
   platform-level paginated read; it was not added because the platform approvals inbox already owns
   that responsibility.
2. **No closed approval history per institution.** The queue returns `REQUESTED`/`APPROVED` items
   only. Executed history is read from the audit stream, entity-anchored.
3. **Audit search is entity-anchored only** (no free-text, actor or date filters). The Activity tab
   states this instead of implying a search it cannot perform.
4. **No workforce principal search endpoint** is consumed: grant/revoke take a principal id typed by
   the operator. The backend validates it; the console cannot offer a picker without a principal
   directory read.
5. **Customer- and wallet-anchored reads are platform-only by design** (`institution.attribution.view`);
   institution-scoped staff cannot enumerate another institution's customer relationship. The UI
   hides those panels accordingly instead of degrading the guard.
6. **No "agents eligible for affiliation" read scoped to one institution.** The directory is
   platform-scoped; an institution-scoped operator must paste/select an agent id obtained from the
   agent records they already see.

## 7. Remaining operational dependencies

- **Governed cut-over for historical accounts.** Wallets/ledger accounts with posted ledger lines
  cannot be re-attributed in place (append-only ledger, immutable attribution records). A production
  cut-over needs its own approved operation, reconciliation evidence and accounting treatment; this
  console documents the restriction and performs no migration.
- **Institution-scoped approval visibility policy.** Today the queue requires both `institution.view`
  and an active workforce institution assignment. If the platform wants auditors to see an
  institution's queue without an assignment, that is a policy change to the read guard, not a UI
  change.
- **MFA session assurance** is enforced by the approval service; the console only reflects it
  (checker button disabled without `assuranceLevel === 'MFA'`).

## 8. Out of scope (explicitly not done)

Institution fee engines, commission redesign, provider configuration isolation, live provider
integration, cross-institution transfers, financial commitment changes, Cash-Out changes, new ledger
architecture, historical balance migration, general authorization redesign, Arena 1/Arena 2 product
changes, deployment, or real financial transactions.
