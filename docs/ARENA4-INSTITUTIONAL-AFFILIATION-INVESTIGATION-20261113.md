# Arena 4 — authoritative institutional / agent affiliation investigation

**Date:** 2026-11-13
**Branch:** `arena/5ee539a0-monienaija`
**Baseline preserved:** `e1c80d035d578bbcc770e5ce7256715c23752487` (governed wallet ownership resolution — unchanged by this investigation)
**Type:** read-only architecture and repository investigation. No code change, no migration, no Cash-Out/OTP/settlement change, no deployment, no provider call, no financial transaction, no branch merge.

---

## 1. Verdict

**An authoritative affiliation that can be resolved server-side from the authenticated agent ID already exists — but it is an _aggregator_, not an "institution", and it is optional.**

| Question                                                                                | Answer                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Can an authenticated agent ID be resolved server-side to an authoritative organization? | **Yes** — `agent_id` → `aggregator_agent_assignments` (status `ACTIVE`) → `aggregators`. Zero or one row.                                                                                                                      |
| Is that organization an "operator" or an "institution"?                                 | **Neither, in the sense Arena 2 means.** It is a corporate participant (_Aggregator_) that manages agents. There is **no `institutions`, `operators`, `organizations`, `branches` or `tenants` table anywhere in the schema.** |
| Is the affiliation mandatory?                                                           | **No.** An agent may be independent (no active aggregator).                                                                                                                                                                    |
| Can an agent belong to multiple institutions?                                           | **No.** At most one `ACTIVE` aggregator at a time (database-enforced); history is preserved as `SUSPENDED`/`TERMINATED` rows.                                                                                                  |
| Is the affiliation in the agent's session/principal?                                    | **No, and it cannot be added there** — `AuthorizationService.validPrincipal` rejects an `AGENT` principal that carries an `aggregatorId` (`src/authorization/authorization.service.ts:403-410`).                               |
| Do financial operations already enforce it?                                             | **Only partially.** Agent funding (when aggregator-attributed) and outlet/terminal creation via an aggregator check it. **Cash-In, Cash-Out and Cash-to-Cash do not touch it at all.**                                         |
| Is there a single-institution fallback anywhere?                                        | **No** such fallback exists, and none may be introduced.                                                                                                                                                                       |
| Does a workforce identity imply organizational ownership?                               | **No.** `OPERATOR` is a _human staff principal type_, not an institution.                                                                                                                                                      |

**Consequence for Arena 2:** the Cash-Out transaction-bound authorization must obtain the affiliation by **resolving `agent_id → ACTIVE aggregator` inside the same database transaction that authorizes/posts**, treat the result as `string | null`, and never take an institution/operator id from the request, the token, configuration, or a default. The precise contract is in §7.

---

## 2. Terminology disambiguation (the source of the confusion)

Four different things in this repository are easily mistaken for "the institution":

1. **`OPERATOR`** — a principal type for a _human internal staff member_ authenticated through the A2 workforce session (`AuthorizationPrincipalType` in `src/authorization/authorization.types.ts:1-7`). It carries `principalId`, `roles`, `scopes`; it has no organizational id and no institution relationship. This is **workforce identity**, not organizational ownership.
2. **`AGGREGATOR`** — a first-class corporate participant that manages agents, with its own principal type, `aggregatorId` field and `aggregatorAccess` scope (`src/aggregator/aggregator.entity.ts`). **This is the only corporate organization in the model today.** It is relationship-only: no wallet, no ledger account, no funding (`src/aggregator/aggregator.entity.ts:12-19`).
3. **`banks`** — an external bank _directory_ used as a transfer/settlement _destination_ (`src/bank/bank.entity.ts`; `customer_beneficiaries.destination_institution`, `external-funding-target.service.ts:78-88`). It describes where money is sent, not who owns an agent.
4. **Partner / provider** — `NIBSS_NIP` plugin configuration read from environment (`src/partner/partner-connection.service.ts`), single-partner by construction (`external_settlements` has `CHECK partner_key = 'NIBSS_NIP'`). It is not an organizational owner of agents.

The platform itself is a single mobile-money operator deployment: configuration is environment-scoped (`src/config/environment.ts`); the word "operator" there means _the human deploying the platform_. There is no multi-operator dimension.

---

## 3. Schema evidence — the complete organizational inventory

Verified against a live PostgreSQL 18.4 instance created by running the full migration chain (`chain118b`, 119 migrations, head `1785753600118`).

### 3.1 No institution-like table exists

All 200+ tables created by the migration chain were enumerated from `CREATE TABLE` statements in `src/migrations/*.ts`. There is **no** `institutions`, `institution_agents`, `operators`, `organizations`, `tenants`, `branches` or `companies` table.

A direct `information_schema.columns` query for organizational column names across every non-KYC/finance table returned exactly **two** rows in the entire database:

```
aggregators.corporate_name              character varying   -- free text corporate name
customer_beneficiaries.destination_institution  character varying  -- external bank destination
```

There is no `*_id` column anywhere that references an institution, operator, tenant, branch or organization.

### 3.2 `agents` carries no organizational column

`agents` is defined in `src/migrations/1785753600053-CreateAgentAuthenticationTables.ts:8-21`:

```
id UUID, reference VARCHAR(160), status VARCHAR(20), version, created_at, updated_at, deleted_at
CHECK status IN ('PENDING','ACTIVE','SUSPENDED','TERMINATED')
```

and is extended only with `agent_class_id` and `origin_application_id`
(`src/migrations/1785753600054-CreateAgentClassAndApplicationTables.ts:74-84`; entity `src/agent/agent.entity.ts:22-45`).

Live foreign-key introspection (`pg_constraint`) for `agents`:

```
agents: FK (agent_class_id) REFERENCES agent_classes(id)
agents: FK (origin_application_id) REFERENCES agent_applications(id)
```

**No aggregator, institution, operator, branch or tenant foreign key.**

### 3.3 The one organizational relationship: aggregator ↔ agent

`aggregators` (`src/aggregator/aggregator.entity.ts:22-77`; DDL `1785753600060-CreateAggregators.ts`):
`id`, `reference` (unique), `code` (unique), `corporate_name`, `display_name`, `contact_email`, `contact_phone`,
`status` (`PENDING|ACTIVE|SUSPENDED|TERMINATED`), `created_by`, `updated_by`, `version`, timestamps, `deleted_at`.
No registry/registration number, no parent aggregator, no hierarchy, no licence, no wallet, no ledger account.

`aggregator_agent_assignments` (`src/aggregator/aggregator-agent-relationship.entity.ts`; DDL `1785753600060-CreateAggregators.ts:41-88`):

```
aggregator_id UUID NOT NULL → FK aggregators(id) ON DELETE RESTRICT
agent_id      UUID NOT NULL → FK agents(id)      ON DELETE RESTRICT
status        VARCHAR(20)  CHECK IN ('ACTIVE','SUSPENDED','TERMINATED')
assigned_at, assigned_by, unassigned_at, unassigned_by, version, timestamps
CHECK ((status='TERMINATED' AND unassigned_at IS NOT NULL) OR (status!='TERMINATED' AND unassigned_at IS NULL))
```

Uniqueness invariants (verified indexes on the live database):

```
uq_aggregator_agent_active            UNIQUE (agent_id)                WHERE status='ACTIVE'
uq_aggregator_agent_pair_not_terminated UNIQUE (aggregator_id, agent_id) WHERE status!='TERMINATED'
idx_aggregator_agent_agent            (agent_id)      <-- the lookup index for resolution
idx_aggregator_agent_aggregator       (aggregator_id)
```

So: **zero or one ACTIVE aggregator per agent, enforced by PostgreSQL**, and history is retained rather than deleted. The entity's own documentation states the deliberate cardinality decision (`src/aggregator/aggregator-agent-relationship.entity.ts:14-31`): _"One Agent may belong to at most ONE ACTIVE Aggregator at a time… An Agent may exist without an Aggregator (independent)… History preserved via status transitions, not by deleting rows."_

### 3.4 Affiliation is established _after_ registration, never during it

Agent registration (`agent_applications`) captures class, applicant reference, business name, contact email and a free-form `payload` JSONB — no aggregator (`src/agent/agent-application.entity.ts:30-70`). Both agent-creation paths write only `reference`, `status`, `agentClassId`, `originApplicationId`:

- `src/agent/agent-application.service.ts:336-342`
- `src/agent/agent-lifecycle.service.ts:107-115`

Affiliation is created independently, by a privileged workforce caller, through the aggregator administration API:

- `POST /api/v1/internal/aggregators` (create), `:id/activate|suspend|reactivate|terminate`
- `POST /api/v1/internal/aggregators/:aggregatorId/agents` (assign)
- `POST …/:aggregatorId/agents/:agentId/suspend|reactivate|terminate`
  (`src/aggregator/aggregator.controller.ts:31-131`)

### 3.5 How affiliation changes are governed

`AggregatorAgentRelationshipService` (`src/aggregator/aggregator-agent-relationship.service.ts`):

- `assign()` — 44-146: validates aggregator exists, is not soft-deleted, `status='ACTIVE'`; agent exists; refuses a second ACTIVE assignment; inserts the row, writes an `AGGREGATOR_AGENT_ASSIGNED` audit event, maps the unique-violation race to `409`.
- `transition()` — suspend/reactivate/unassign with an explicit state machine (`ACTIVE → SUSPENDED|TERMINATED`, `SUSPENDED → ACTIVE|TERMINATED`, `TERMINATED` terminal) and audit events.
- `getForAgent()` — 189-196: the existing single-agent resolver (`WHERE agentId AND status='ACTIVE' ORDER BY assignedAt DESC`), returning `null` when independent.

Route gate: `POST /api/v1/internal/aggregators*` requires `allowedPrincipalTypes: ['OPERATOR','SERVICE','PRIVILEGED']` + catalogue function `aggregator.manage` (`src/authorization/route-policy-registry.ts:619-642`). Reads allow `SUPPORT` too.

**Governance limitation:** an affiliation change is a **single privileged-actor action**. It is audited and function-gated, but it is **not** maker-checker. There is no governed-action registration for it (compare `LEDGER_JOURNAL_REVERSAL` / `WALLET_OWNERSHIP_RESOLUTION` in `src/authorization/governed-action.registry.ts`), and therefore no independent second approver, no approval-consumption atomicity and no fingerprint binding.

### 3.6 Aggregator lifecycle does not cascade

`AggregatorService.suspend/terminate` (`src/aggregator/aggregator.service.ts:110-130`) transition **only** the aggregator row. No assignment row is touched and no agent status changes. A `SUSPENDED` aggregator therefore leaves its `ACTIVE` assignments in place — any consumer must join `aggregators.status`/`deleted_at` itself (the existing funding/outlet checks do exactly that).

---

## 4. Authentication evidence — why the affiliation is not (and cannot be) a token claim

The agent principal is constructed in `src/authorization/runtime-access.guard.ts:344-357` from the agent session alone:

```ts
principal = {
  type: 'AGENT',
  principalId: agentValidation.principal.agentId,
  agentId: agentValidation.principal.agentId,
  sessionId: agentValidation.principal.sessionId,
  audience: agentValidation.principal.audience,
  roles: [],
  scopes: [],
  customerAccess: 'NONE',
  agentAccess: 'SELF',
  assuranceLevel: 'PASSWORD',
};
```

`agent_authentication_sessions` stores `agent_id`, `credential_id`, `token_hash`, `audience`, status and timestamps only (`src/agent-authentication/agent-authentication-session.entity.ts`) — no organizational attribute is stored, so none can be derived from the session row either.

`AuthorizationService.validPrincipal` then **forbids** an agent principal from carrying organizational identity:

```ts
if (principal.type === 'AGENT') {
  return Boolean(
    principal.agentId &&
      UUID_PATTERN.test(principal.agentId) &&
      !principal.customerId &&
      !principal.aggregatorId,
  ); // line 403-410
}
if (principal.type === 'AGGREGATOR') {
  return Boolean(
    principal.aggregatorId &&
      UUID_PATTERN.test(principal.aggregatorId) &&
      !principal.customerId &&
      !principal.agentId,
  ); // line 411-419
}
```

This is a deliberate separation: an agent session is one agent, an aggregator session is one aggregator, and neither may borrow the other's identity. **Attaching the affiliation to the token would require weakening that invariant** and would also freeze a mutable relationship into a bearer credential for its whole lifetime. Resolution must therefore be a **database read** (or a cache keyed by agent id with an explicit staleness policy), never a token claim.

The agent's own read surface reflects this: `GET /api/v1/agents/profile` returns id, reference, status, agent class (`src/agent/agent-app.controller.ts:62-86`) — no aggregator. `docs/V1/A21-AGENT-APP-CONTRACT.md:72` states explicitly: _"`AGGREGATOR` is not used for Agent App."_

---

## 5. What already enforces the affiliation (and what does not)

Complete list of code that joins `aggregator_agent_assignments` (verified by repository-wide grep):

| Path                                     | File:line                                                                          | Behaviour                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent funding / defunding via aggregator | `src/agent/agent-funding.service.ts:1586-1614`                                     | If a caller supplies `aggregatorId`: aggregator must exist, not be soft-deleted, `ACTIVE`, **and** have an `ACTIVE` assignment to the agent, else `404`/`403`. `aggregatorId` is optional — the platform path is allowed with `is_aggregator_funding=false`. |
| Outlet creation via aggregator           | `src/outlet/outlet.service.ts:92, 341-368`                                         | Same `ACTIVE` aggregator + `ACTIVE` assignment check, `FOR UPDATE`, inside the mutation transaction.                                                                                                                                                         |
| Terminal creation via aggregator         | `src/outlet/terminal.service.ts:83, 341-365`                                       | Same.                                                                                                                                                                                                                                                        |
| Aggregator admin reads/writes            | `src/aggregator/aggregator.service.ts`, `aggregator-agent-relationship.service.ts` | Management only.                                                                                                                                                                                                                                             |

**Nothing else touches it.** In particular:

- `src/agent/agent-cash-in.service.ts` — no affiliation.
- `src/agent/agent-cash-out.service.ts` — posts customer wallet → agent wallet (`:291-345`) with no affiliation lookup.
- `src/agent/agent-cash-to-cash*.service.ts` — no affiliation (only a literal `aggregatorId: null` in commercial attribution, `:810`).
- `src/agent/agent-transaction-authorization.service.ts` / `.types.ts` — the authorized context exposes agent id, status, class, services and limits; **no organizational dimension**.
- `src/agent/agent-lifecycle.service.ts` — no aggregator awareness.

`agent_funding_requests` does record the affiliation **when used** (`aggregator_id UUID REFERENCES aggregators(id)`, `is_aggregator_funding`, with `CHECK ((is_aggregator_funding AND aggregator_id IS NOT NULL) OR (NOT is_aggregator_funding AND aggregator_id IS NULL))` — `src/migrations/1785753600090-CreateAgentFundingRequests.ts:18,26,48-51`), and the governed funding fingerprint binds it (`src/agent/agent-funding-governance.service.ts:26-38`). That is the only financial record in which an agent's organizational attribution currently appears.

**Therefore: yes, financial operations partially enforce affiliation (funding, outlets, terminals), but no payment-authorization path for Cash-In/Cash-Out/Cash-to-Cash enforces or even reads it.** This is consistent with `docs/V1/A21-AGENT-APP-CONTRACT.md:96` — _"Agent-to-aggregator ledger account (V1 aggregator is relationship-only)"_.

---

## 6. Classes of Service and configuration have no organizational dimension

- **Classes of Service** (`agent_classes`): global catalogue rows (`reference`, `code`, `name`, `applicable_services`, `applicable_limits`, `is_active`) — no aggregator/institution column, no per-organization class (`src/agent/agent-class.entity.ts`).
- **Limits** (`limit_assignments`): subject types are constrained to `'GLOBAL','SEGMENT','AGENT_CLASS','CUSTOMER','AGENT'` (`src/limit-catalog/limit-assignment.entity.ts:28-48`). **There is no `AGGREGATOR`/`INSTITUTION` subject type**, so an institution-scoped limit cannot be expressed today without a schema change.
- **Commission** (`commission_rules`): `recipient_type IN ('AGENT','AGGREGATOR','PLATFORM')` but there is **no recipient id** (`src/commission/commission-rule.entity.ts:87,104-105`), and aggregator commission accounting is fail-closed (`COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED`, `src/commercial-accounting/commercial-accounting.service.ts:310`). No specific aggregator can be paid.
- **Configuration**: environment/ConfigService only (`src/config/environment.ts`); nothing is keyed by institution.
- **Wallet ownership** (Arena 4's completed scope): `wallet_accounts.owner_class ∈ {CUSTOMER, AGENT, REVIEW, SYSTEM}` — there is no institution owner class, so no wallet, balance or ledger entitlement can belong to an institution (migration `1785753600118`).

Explicitly **not** authoritative affiliation, and must not be used as such:
`b2_agent_activation_readiness.supervising_merchant_id` / `supervising_customer_id` (`src/migrations/1785753600040-…:86,108`) — unvalidated `VARCHAR(64)` attestation values in a decision record with no FK to `agents`/`merchants`; and `aggregator_id` on `agent_funding_requests`, which is a per-request attribution, not the agent's institution.

---

## 7. Recommended Cash-Out integration contract for Arena 2

### 7.1 Resolution (authoritative, server-side, transaction-bound)

Resolve from the **authenticated principal's** `agentId` — never from request input — inside the same transaction (and with the same isolation level) that authorizes and posts the Cash-Out:

```sql
SELECT a.aggregator_id
FROM aggregator_agent_assignments a
JOIN aggregators g ON g.id = a.aggregator_id
WHERE a.agent_id = $1
  AND a.status = 'ACTIVE'
  AND g.status = 'ACTIVE'
  AND g.deleted_at IS NULL
LIMIT 2;
```

Then:

| Rows | Meaning                                                                                 | Required behaviour                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Agent is affiliated with an active aggregator                                           | Bind that `aggregatorId` into the authorization evidence                                                                                                               |
| 0    | Agent is independent, **or** its aggregator is suspended/terminated/soft-deleted        | Affiliation = `null`. Apply the channel's explicit independent-agent policy (see 7.4). **Never** substitute a default institution, the platform, or another aggregator |
| ≥2   | Structurally impossible (`uq_aggregator_agent_active`); would indicate schema tampering | **Fail closed** (`409`/`CONFLICT`), never pick one                                                                                                                     |

Proven empirically on the live migrated database (all inside a rolled-back transaction):

```
ACTIVE assignment            -> [ { aggregatorId: 'cda6fc1e-…' } ]
aggregator SUSPENDED         -> []
aggregator soft-deleted      -> []
second ACTIVE assignment     -> ERROR duplicate key value violates unique constraint "uq_aggregator_agent_active"
```

If a lock is required for a mutable relationship, take `FOR SHARE`/`FOR UPDATE` on the aggregator row only in paths that also mutate affiliation (outlet/terminal creation) — Cash-Out must **not** lock the aggregator, because that would serialize unrelated payments behind affiliation administration.

### 7.2 Hard rules (each maps to a constraint from this task)

1. **Do not accept** `institutionId`, `operatorId`, `aggregatorId` (or any equivalent) from the request body, query string, headers or metadata. Reject unexpected fields rather than ignoring them.
2. **Do not read** it from the agent token/session — it is not there, and adding it would breach `validPrincipal`.
3. **Do not default** to a single institution, the platform, or a "primary" aggregator when resolution returns no row.
4. **Do not conflate** workforce `OPERATOR` staff identity with organizational ownership; a workforce principal never determines an agent's institution.
5. **Do not** derive the affiliation from `agent_outlets`/`agent_terminals` — they have no aggregator FK by design (`src/outlet/agent-outlet.entity.ts:26-27`, `agent-terminal.entity.ts:27`) and only _optionally_ validated one at creation time.
6. **Re-resolve inside the posting transaction** (or verify an unchanged tuple) if any decision is taken earlier — affiliation can change between authorization and posting; this is the same TOCTOU class Arena 2 is fixing for the session itself.
7. **Bind the resolved value into the authorization evidence/fingerprint** and record it in the audit metadata (e.g. `{ affiliation: { agentId, aggregatorId|null, resolvedAt, source: 'aggregator_agent_assignments' } }`) so replay/idempotency cannot swap institutions. `fundingFingerprint` (`src/agent/agent-funding-governance.service.ts:26-38`) is the existing precedent for hashing an `aggregatorId` into a governed payload.
8. **Do not create** a ledger account, wallet or settlement relationship for the aggregator: it has none in V1, and Cash-Out today posts customer wallet → agent wallet only (`src/agent/agent-cash-out.service.ts:291-345`). Affiliation must remain **evidence and policy input**, not an accounting party.

### 7.3 Suggested seam (so Arena 2 does not duplicate resolution logic)

A single read-only provider — e.g. `AgentAffiliationResolver.resolve(manager, agentId): Promise<{ aggregatorId: string } | null>` living in `src/aggregator/` and exported from `AggregatorModule` (which already exports `AggregatorAgentRelationshipService` and imports `Agent`/`Aggregator`/`AggregatorAgentAssignment`) — would let Cash-Out, Cash-In and Cash-to-Cash share one authority. Note that `AgentModule` does **not** currently import `AggregatorModule`; wiring it (or injecting the relationship service) is a one-line module change, not a schema change. Reusing `AggregatorAgentRelationshipService.getForAgent()` is acceptable only **inside** the transaction (its repository is not transaction-bound and it does not check `aggregators.status`), so the contract above should be implemented as a manager-scoped query.

### 7.4 The one product decision Arena 2 needs from its owner

_"May an agent with no active aggregator perform cash-out?"_

- **If yes** (matches today's behaviour — Cash-Out never checked affiliation): resolve, record `affiliation: null`, proceed. This is not a fallback; it is the explicit independent-agent policy.
- **If no** (channel restricted to institution-affiliated agents): `403`/`409` with an explicit denial reason (e.g. `AFFILIATION_REQUIRED`), and the same rule must be documented for Cash-In and Cash-to-Cash to avoid inconsistent channels.

Do not encode either choice implicitly. Today the repository has **no** declared policy, so Arena 2 must not invent one; record the decision before implementing.

---

## 8. Missing infrastructure (nothing here is a defect in Arena 2's scope)

1. **No institution/operator entity.** No table, no id, no registry/reference, no licence, no settlement account, no parent/hierarchy. "Institution" is currently represented only by `aggregators.corporate_name` free text.
2. **No multi-operator (tenant) model.** Configuration, catalogues and paths are global; a single deployment serves one operator.
3. **No institutional data scoping for staff.** Every workforce route declares `aggregatorAccess: 'NONE'` and no route populates a resource-level `aggregatorId`, so `AuthorizationService.checkAggregatorScope` (`:347-371`) can never authorize a scoped aggregator resource; `ASSIGNED`/`ANY` scopes intentionally return `RESOURCE_SCOPE_MISSING`. Any `OPERATOR` holding `aggregator.manage` can manage **any** aggregator and any agent's affiliation.
4. **No aggregator authentication.** `AGGREGATOR` is a principal type, but nothing issues such a session; `src/authorization/route-policy-registry.ts:642-643` records _"A18 does not expose aggregator login; foundation only"_, and `docs/V1/END-TO-END-FUNCTIONALITY-AUDIT.md:200` lists aggregator self-service login as **DECISION REQUIRED**.
5. **Affiliation change is not maker-checker.** Single privileged actor + audit; no governed approval, no two-person control, no atomic approval consumption (contrast wallet ownership resolution, `1785753600118`).
6. **No cascade or denormalisation.** Aggregator `SUSPENDED`/`TERMINATED` leaves assignments `ACTIVE`; `agents` has no cached `aggregator_id`, so every consumer must join and must remember to check aggregator status — easy to get wrong.
7. **No institution dimension in financial configuration.** Limits (`GLOBAL/SEGMENT/AGENT_CLASS/CUSTOMER/AGENT` only), classes of service, commission recipients (no recipient id) and wallet ownership classes (`CUSTOMER/AGENT/REVIEW/SYSTEM`) cannot represent an institution.
8. **Unverified attestation fields that look like affiliations** (`b2_agent_activation_readiness.supervising_merchant_id` / `supervising_customer_id`) — no FK, no validation.
9. **No institutional reconciliation/settlement.** Aggregators cannot hold value or settle; funding attribution is per-request only.

---

## 9. Minimal implementation proposal — only if a true institution is genuinely required

**Recommendation: do not build one now.** For Arena 2's transaction-bound Cash-Out authorization, **Option A** fully answers "which organization is responsible for this agent" without any schema change.

### Option A — adopt the existing aggregator affiliation (preferred; zero migrations)

Adopt §7 as the contract, with one small hardening task (separate, reviewable, not inside Arena 2's Cash-Out change):

1. Add a manager-scoped `AgentAffiliationResolver` in `src/aggregator/` (single authoritative query, `LIMIT 2`, fail-closed on >1, `null` when absent), exported via `AggregatorModule`; back it with a unit test for the 0/1/2-row matrix.
2. Have Cash-Out (and, for consistency, Cash-In / Cash-to-Cash as a follow-up decision) call it inside its existing transaction and bind the result into its authorization evidence and audit metadata.
3. Record the §7.4 policy decision in writing next to the A21 contract.

Explicit non-goals for that task: no new tables, no aggregator wallet/ledger, no aggregator login, no changes to affiliation governance.

### Option B — introduce a real institution/operator entity (only if licence-level or settlement-level separation is required)

If the business requirement is _"agents operate under a licensed institution that is itself a financial party"_ — which the current model cannot express — the smallest coherent shape is:

- `institutions` (id, reference, code, legal name, institution_type, licence_reference, status, timestamps, soft delete) — no wallet/ledger in the first migration.
- `institution_agent_affiliations` mirroring the aggregator assignment pattern: `institution_id`, `agent_id`, `status`, `assigned_at/by`, `unassigned_at/by`, partial unique `(agent_id) WHERE status='ACTIVE'`, `UNIQUE (institution_id, agent_id) WHERE status<>'TERMINATED'`.
- A **governed** change action (`INSTITUTION_AFFILIATION_CHANGE`) registered in `governed-action.registry.ts` with maker `OPERATIONS`/checker `FINANCE_CONTROLLER` (or compliance), reusing `PrivilegedActionApprovalService` — i.e. exactly the pattern used for `WALLET_OWNERSHIP_RESOLUTION`, so affiliation changes are two-person, fingerprinted and atomic.
- Decide explicitly whether the _aggregator_ remains, is derived from the institution, or is retired; do not run both as competing authorities.
- Only then consider `wallet_accounts`/ledger entitlement, limit subjects and commission recipients for institutions — each a separate decision.

This is a multi-sprint change with financial-model consequences and is **out of scope** here; it must not start until the organizational model is approved.

---

## 10. Cross-institution isolation limitations (current state, for the record)

1. **No staff-side scoping.** A workforce principal with `aggregator.manage` can act on any aggregator, and any agent's affiliation. There is no "operator may only manage its own aggregators" control.
2. **No aggregator-side isolation.** Aggregators cannot authenticate, so they can neither read nor act on their own portfolio; any future login must also define scoping (currently impossible to express: `validPrincipal` gives an aggregator principal nothing but `aggregatorId`).
3. **Stale affiliation is invisible.** Because aggregator status does not cascade, a suspended aggregator's agents keep `ACTIVE` assignments; only consumers that join `aggregators.status` see the truth.
4. **Funding attribution is optional.** An agent belonging to an aggregator can still be funded through the platform path (`is_aggregator_funding = false`), so funding records alone can never be used to infer affiliation.
5. **No financial consequence of affiliation exists yet**, which is precisely why adding it to Cash-Out is safe today (no balances, fees or commissions change) — and also why it cannot be validated financially.
6. **No institutional limits or commission entitlement**, so "institution-level" policy (the likely intent behind Arena 2's requirement) has no configuration surface today.
7. **Suggested-but-unverified fields** (`supervising_merchant_id`, free-text `corporate_name`) must not be treated as authoritative.

---

## 11. Verification performed

- Read the full organizational surface: agent registration/lifecycle, agent entities, aggregator entities and services, workforce/support identities, outlets/terminals, funding, authorization principals/sessions/route policies, classes of service, limits, commission, wallet ownership.
- Enumerated every `CREATE TABLE` in all 119 migrations; confirmed absence of institution/operator/organization/branch/tenant tables.
- Ran the full migration chain on a disposable local PostgreSQL 18.4 (`chain118b`), then introspected `information_schema.columns` (organizational columns), `pg_constraint` (FKs on `agents`, `aggregators`, assignments, sessions) and `pg_indexes` (uniqueness invariants).
- Executed the proposed resolution query against that live schema with synthetic rows inside rolled-back transactions, demonstrating: 1 row when ACTIVE, 0 rows when the aggregator is suspended or soft-deleted, 0 rows for an independent agent, and a database-enforced refusal of a second ACTIVE assignment.
- No repository file was modified for this investigation; no test was authored against Cash-Out; no branch was created; nothing was pushed except this report on the assigned branch.

**Reproduce:**

```sh
node /tmp/pgstart/start.mjs && node /tmp/pgstart/createdb.mjs chain118b
DB_NAME=chain118b npx typeorm-ts-node-commonjs migration:run -d src/config/data-source.ts
node /tmp/pgq/inspect.mjs && node /tmp/pgq/probe2.mjs   # introspection + resolution probe (rolled back)
```

---

## 12. Decisions required before any code

| #   | Decision                                                                                                   | Owner                | Blocks                               |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------ |
| 1   | Is the aggregator the institution for payment authorization, or is a distinct licensed institution needed? | Product / compliance | Any schema or contract work          |
| 2   | May an unaffiliated (independent) agent perform cash-out, cash-in and cash-to-cash?                        | Product / risk       | Cash-Out gate semantics              |
| 3   | Should affiliation changes require maker-checker (today single-actor + audit)?                             | Governance           | Any change to affiliation governance |
| 4   | Is aggregator self-service login (§23-9) in scope for V1?                                                  | Product              | Aggregator-scoped isolation          |
| 5   | Do institutional limits/commissions need to exist in V1?                                                   | Commercial           | Limit/commission schema              |

Until decision 1 is recorded in writing, **no migration and no institution table should be introduced**, and Arena 2 should implement only §7 (resolve, bind, never trust the caller, never default).
