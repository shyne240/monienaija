# Arena 4 — phased institutional architecture proposal

**Date:** 2026-11-13
**Branch:** `arena/5ee539a0-monienaija`
**Preserved baseline:** `af67f5292f4785e765426b8aa411fcf95ebacd94` (affiliation investigation) — parent `e1c80d0…` (governed wallet ownership resolution). **Neither is modified by this document.**
**Status:** design proposal only. No institution schema, no migration, no Cash-Out/OTP/settlement change, no deployment, no provider call, no branch merge.

Derived from the accepted investigation (`docs/ARENA4-INSTITUTIONAL-AFFILIATION-INVESTIGATION-20261113.md`) and verified against a live PostgreSQL 18.4 database built from the full 119-migration chain.

---

## 0. Summary of the recommendation

1. Introduce a **`financial_institutions`** aggregate as the financial party, and **`institution_agent_affiliations`** as the single authoritative link from an agent to exactly one (or zero) institution.
2. **Keep aggregators exactly as they are** — an organizational relationship with agents, with **no** financial entitlement and **no** automatic role in institution resolution. Add an explicit many-to-many `aggregator_institution_relationships` instead of repurposing `aggregators`.
3. Make every affiliation change a **governed maker-checker action** reusing `PrivilegedActionApprovalService`, with an immutable change record (the pattern proven by `governed_wallet_ownership_resolutions`).
4. Give Arena 2 an **immediate, zero-schema dependency**: a resolver interface plus a "no institution configured" null-object implementation, wired into Cash-Out's transaction-bound authorization as explicit evidence (`RESOLVED` / `UNRESOLVED`). No schema, no behaviour change, no default institution — and it swaps to the real resolver in Phase 1b without touching Cash-Out again.
5. Apply institutional isolation to money **incrementally and additively** — first the agent affiliation, then wallets/ledger/limits/fees, then providers/settlement. Every isolation column is nullable with **no backfill and no fabrication**; historical rows stay `NULL` and are reported as _unattributed_, forever.

---

## 1. Domain vocabulary and hard boundaries

| Actor                                      | What it is in this platform                                                                                                                        | Owns                                                                                                                                                              | Must never be conflated with                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Platform**                               | This deployment: the technology, ledger engine, provider integrations, catalogue.                                                                  | Ledger infrastructure, global catalogues, workforce identity, KYC policy engine                                                                                   | An institution. The platform is not a default institution and must never be used as a fallback institutional context. |
| **Financial institution (FI)** _(new)_     | A licensed/regulated party that operates agent financial services on the platform and is a financial party in its own right.                       | Its own institutional context: customer financial relationships, agent affiliations, settlement accounts, limits/fees policy overrides, provider config overrides | The platform, an aggregator, a bank directory entry, or a workforce operator.                                         |
| **Aggregator** _(existing)_                | A corporate organization that manages agents (relationship only; no wallet/ledger/funding — `src/aggregator/aggregator.entity.ts:12-19`).          | Organizational management of agents, outlets, terminals                                                                                                           | A licensed institution, an accounting party, or an automatic determinant of an agent's institution.                   |
| **Agent** _(existing)_                     | A cash point / agent business entity (`agents`, no organizational column).                                                                         | Its wallet, its operational capability                                                                                                                            | An institution or an aggregator.                                                                                      |
| **Workforce operator** _(existing)_        | Human internal staff identity (A2 `a2_workforce_sessions`, `support_workforce_users`); `OPERATOR` is a **principal type**, not an organization.    | Nothing financially; acts under role/function authority                                                                                                           | An institution. Staff identity never establishes institutional context.                                               |
| **Customer** _(existing)_                  | A person/business with **one global identity and one KYC history** (`customers`), which may hold financial relationships at multiple institutions. | Identity, KYC, preferences                                                                                                                                        | A per-institution duplicate customer record.                                                                          |
| **External payment provider** _(existing)_ | NIBSS/NIP or a notification/KYC provider — transport/rails.                                                                                        | Provider connectivity                                                                                                                                             | An institution.                                                                                                       |

**Non-negotiable boundaries**

- An agent may have **no aggregator** but **financial execution must have an authoritative institutional context** — explicit `RESOLVED`, or explicit `UNRESOLVED` and fail closed.
- An aggregator relationship **never** silently becomes an institution. A single-match aggregator→institution link is _evidence a human can cite_, never an inference the system applies.
- **No single-institution fallback, no invented default institution, no "platform institution".**

---

## 2. Design invariants (these become the test matrix)

| #       | Invariant                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I1**  | An agent has **at most one ACTIVE institution affiliation** (database-enforced). Zero is legal and means _unaffiliated_.                                                                      |
| **I2**  | Resolution succeeds only if the affiliation is `ACTIVE` **and** the institution is `ACTIVE` and not soft-deleted.                                                                             |
| **I3**  | The resolver always returns an **explicit outcome** (`RESOLVED` / `UNRESOLVED` with reason). No default, no inference, no fallback.                                                           |
| **I4**  | A journal may not contain lines from **two institutions** (structural trigger). Inter-institution settlement is out of scope.                                                                 |
| **I5**  | A wallet's institution is fixed at creation and equals its owner's resolved institution. An affiliation change **never moves an existing wallet**; attribution is a separate governed action. |
| **I6**  | Historical money rows are **never retro-attributed**. `NULL` institution means _unattributed_, permanently, and is reported as such.                                                          |
| **I7**  | Institution-scoped staff act only within their institution. Platform-wide reach requires an **explicit** catalogue function, never an implicit bypass.                                        |
| **I8**  | Affiliation changes are maker-checker, fingerprinted, and atomic (approval consumption + affiliation write in one transaction).                                                               |
| **I9**  | Customer identity and KYC remain **global and unified**; only financial relationships are institution-scoped.                                                                                 |
| **I10** | Unattributed legacy rows stay readable and operable at today's behaviour until a channel is explicitly switched to enforced mode.                                                             |
| **I11** | An institution cannot be terminated while it has active affiliations, open wallets, or unreconciled settlement obligations.                                                                   |
| **I12** | Every enforcement step is per-channel, documented, readiness-gated, and reversible by configuration — not by a code change.                                                                   |

---

## 3. Schema — Phase 1 foundation (institutions and affiliations only)

All tables are **new**; no existing table is altered in Phase 1. UUID primary keys, `version`, `created_at`/`updated_at`, `deleted_at` soft delete, and `created_by`/`updated_by` follow the repository's prevailing conventions.

### 3.1 `financial_institutions`

```sql
CREATE TABLE financial_institutions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           VARCHAR(80)  NOT NULL,
  code                VARCHAR(40)  NOT NULL,
  legal_name          VARCHAR(320) NOT NULL,
  display_name        VARCHAR(160),
  institution_type    VARCHAR(32)  NOT NULL,
  licence_reference   VARCHAR(160),          -- recorded evidence; NOT validated or asserted as regulatory truth
  regulator_reference VARCHAR(160),
  status              VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  status_reason       VARCHAR(500),
  created_by          VARCHAR(160) NOT NULL,
  updated_by          VARCHAR(160),
  version             INTEGER      NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT chk_financial_institutions_type CHECK (
    institution_type IN ('MMO','COMMERCIAL_BANK','MICROFINANCE_BANK','PAYMENT_SERVICE_BANK','PSP','PARTNER')),
  CONSTRAINT chk_financial_institutions_status CHECK (
    status IN ('PENDING','ACTIVE','SUSPENDED','TERMINATED')),
  CONSTRAINT chk_financial_institutions_version CHECK (version > 0)
);
CREATE UNIQUE INDEX uq_financial_institutions_reference ON financial_institutions (reference) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_financial_institutions_code      ON financial_institutions (code)      WHERE deleted_at IS NULL;
CREATE INDEX idx_financial_institutions_status ON financial_institutions (status);
```

Lifecycle: `PENDING → ACTIVE → SUSPENDED ↔ ACTIVE → TERMINATED` (terminal), following the existing `AggregatorStatus`/`AgentStatus` state-machine idiom. No wallet, ledger account, balance or funding column is added here — the institution is a _party_, not an account.

### 3.2 `institution_agent_affiliations`

```sql
CREATE TABLE institution_agent_affiliations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    UUID NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
  agent_id          UUID NOT NULL REFERENCES agents(id)                ON DELETE RESTRICT,
  status            VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  effective_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to      TIMESTAMPTZ,
  affiliation_source VARCHAR(32) NOT NULL,       -- 'GOVERNED_CHANGE' | 'OPERATOR_RECORDED_EVIDENCE'
  evidence_type     VARCHAR(40),                 -- 'AGGREGATOR_RELATIONSHIP' | 'INSTITUTION_LETTER' | 'REGULATOR_RECORD' | ...
  evidence_reference VARCHAR(160),
  approval_id       UUID REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
  assigned_by       VARCHAR(160) NOT NULL,
  unassigned_by     VARCHAR(160),
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_institution_agent_status CHECK (status IN ('ACTIVE','SUSPENDED','TERMINATED')),
  CONSTRAINT chk_institution_agent_effective CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT chk_institution_agent_terminated CHECK (
    (status = 'TERMINATED' AND effective_to IS NOT NULL) OR (status <> 'TERMINATED' AND effective_to IS NULL))
);
CREATE UNIQUE INDEX uq_institution_agent_active
  ON institution_agent_affiliations (agent_id) WHERE status = 'ACTIVE';            -- I1
CREATE UNIQUE INDEX uq_institution_agent_pair_open
  ON institution_agent_affiliations (institution_id, agent_id) WHERE status <> 'TERMINATED';
CREATE INDEX idx_institution_agent_institution ON institution_agent_affiliations (institution_id, status);
CREATE INDEX idx_institution_agent_agent       ON institution_agent_affiliations (agent_id, status);
```

Rationale for **single-active**: one agent equals one cash point equals one set of agent ledgers and one settlement counterparty; multi-institution agents would require per-institution agent wallets and split settlement, which nothing in V1 needs. The model can be widened later (drop `uq_institution_agent_active`, key wallets by `(institution, owner, currency)`) without touching this table's shape.

### 3.3 `aggregator_institution_relationships`

```sql
CREATE TABLE aggregator_institution_relationships (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregator_id  UUID NOT NULL REFERENCES aggregators(id)           ON DELETE RESTRICT,
  institution_id UUID NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
  status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  approval_id    UUID REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
  assigned_by    VARCHAR(160) NOT NULL,
  unassigned_by  VARCHAR(160),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to   TIMESTAMPTZ,
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_aggregator_institution_status CHECK (status IN ('ACTIVE','SUSPENDED','TERMINATED'))
);
CREATE UNIQUE INDEX uq_aggregator_institution_pair_open
  ON aggregator_institution_relationships (aggregator_id, institution_id) WHERE status <> 'TERMINATED';
CREATE INDEX idx_aggregator_institution_institution ON aggregator_institution_relationships (institution_id, status);
```

**Deliberately many-to-many**: an aggregator may manage agents for several institutions. Because of that, this table **cannot** be the resolver's authority (an agent under a two-institution aggregator would be ambiguous) — which is precisely why resolution reads `institution_agent_affiliations` only, and why aggregator links are _evidence_, not inference.

### 3.4 Governed change record — `governed_institution_affiliations`

Mirrors `governed_wallet_ownership_resolutions` (`src/migrations/1785753600118-GovernedWalletOwnershipResolution.ts`): immutable, bound one-to-one to a **consumed** approval, and required for any affiliation row whose `affiliation_source = 'GOVERNED_CHANGE'`.

```sql
CREATE TABLE governed_institution_affiliations (
  approval_id             UUID PRIMARY KEY REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
  affiliation_id          UUID NOT NULL UNIQUE REFERENCES institution_agent_affiliations(id) ON DELETE RESTRICT,
  agent_id                UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  institution_id          UUID NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
  previous_institution_id UUID REFERENCES financial_institutions(id) ON DELETE RESTRICT,
  change_kind             VARCHAR(24) NOT NULL,   -- 'ASSIGN' | 'TRANSFER' | 'SUSPEND' | 'REACTIVATE' | 'TERMINATE'
  evidence_type           VARCHAR(40) NOT NULL,
  evidence_reference      VARCHAR(160) NOT NULL,
  evidence_digest         CHAR(64) NOT NULL,
  reason                  VARCHAR(500) NOT NULL,
  executed_by             VARCHAR(160) NOT NULL,
  executed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Immutability (UPDATE/DELETE refused) and the "approval must be `CONSUMED`, action `INSTITUTION_AGENT_AFFILIATION_CHANGE`, resource `AGENT`, same agent" validation are enforced by trigger, exactly as the wallet ownership precedent does.

### 3.5 Institution-scoped workforce access — `workforce_institution_assignments`

```sql
CREATE TABLE workforce_institution_assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id   VARCHAR(160) NOT NULL,          -- A2 workforce principal, as used by a2_workforce_sessions
  institution_id UUID NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
  status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  granted_by     VARCHAR(160) NOT NULL,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by     VARCHAR(160),
  revoked_at     TIMESTAMPTZ,
  approval_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  version        INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_workforce_institution_status CHECK (status IN ('ACTIVE','REVOKED'))
);
CREATE UNIQUE INDEX uq_workforce_institution_active
  ON workforce_institution_assignments (principal_id, institution_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_workforce_institution_principal ON workforce_institution_assignments (principal_id, status);
```

**Not a token claim.** `a2_workforce_sessions` snapshots roles/scopes at login; institution scope is mutable data and must be read per request (with a short-lived cache and invalidation on revoke/institution suspend). Putting it in the bearer would create the same staleness class Arena 2 is fixing for agent sessions.

### 3.6 Resolution view (read-only, no data mutation)

```sql
CREATE VIEW agent_institution_resolution AS
SELECT a.id                        AS agent_id,
       af.id                       AS affiliation_id,
       af.institution_id           AS institution_id,
       af.status                   AS affiliation_status,
       fi.status                   AS institution_status,
       fi.deleted_at               AS institution_deleted_at,
       CASE WHEN af.id IS NOT NULL AND af.status = 'ACTIVE'
                 AND fi.status = 'ACTIVE' AND fi.deleted_at IS NULL
            THEN 'RESOLVED' ELSE 'UNRESOLVED' END AS resolution_state
FROM agents a
LEFT JOIN institution_agent_affiliations af
       ON af.agent_id = a.id AND af.status = 'ACTIVE'      -- I1 guarantees at most one row
LEFT JOIN financial_institutions fi ON fi.id = af.institution_id;
```

### 3.7 Unattributed reconciliation view

```sql
CREATE VIEW institution_attribution_gaps AS
SELECT 'AGENT'    AS entity, a.id AS entity_id, NULL::uuid AS institution_id FROM agents a
  WHERE a.deleted_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM institution_agent_affiliations f WHERE f.agent_id = a.id AND f.status = 'ACTIVE')
UNION ALL
SELECT 'WALLET', w.id, w.institution_id FROM wallet_accounts w WHERE w.institution_id IS NULL
UNION ALL
SELECT 'JOURNAL', j.id, j.institution_id FROM ledger_journals j WHERE j.institution_id IS NULL;
```

(This view is Phase 3 when the columns exist; Phase 1b ships only the AGENT branch.)

---

## 4. Service architecture

New module `src/institution/` (mirrors `src/aggregator/` structure):

| Component                                 | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FinancialInstitutionService`             | Create/update, lifecycle state machine, `assertActive()`, audit, `I11` guards on terminate.                                                                                                                                                                                                                                                                                                                               |
| `InstitutionAgentAffiliationService`      | Read-only affiliation views (`getForAgent`, `listForInstitution`), plus the _non-governed_ read helpers. All **writes** go through the governed flow.                                                                                                                                                                                                                                                                     |
| `InstitutionAffiliationGovernanceService` | `request()` → `approvals.request(...)`; `execute()` → single transaction: lock approval → validate payload/fingerprint/resource → lock agent + current affiliation → re-verify evidence and institution status → `consumeInTransaction` → write affiliation + `governed_institution_affiliations` → audit. Exactly the shape of `WalletOwnershipResolutionService` (`src/wallet/wallet-ownership-resolution.service.ts`). |
| `AgentInstitutionResolver`                | **The single authoritative read path.** Interface below; DB-backed implementation in 1b, null-object in 1a.                                                                                                                                                                                                                                                                                                               |
| `InstitutionScopeService`                 | `requireInstitution(principal, institutionId)` / `requirePlatform(principal)`; reads `workforce_institution_assignments`.                                                                                                                                                                                                                                                                                                 |
| `InstitutionReconciliationService`        | Unattributed inventory, per-institution summaries, affiliation history.                                                                                                                                                                                                                                                                                                                                                   |
| `InstitutionModule`                       | Wires the above, exports `AgentInstitutionResolver` and `InstitutionScopeService` for other modules.                                                                                                                                                                                                                                                                                                                      |

Reuse (no parallel mechanisms):

| Concern                             | Reused infrastructure                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Approval lifecycle, MFA, separation | `PrivilegedActionApprovalService`                                                    |
| Action registration                 | `src/authorization/governed-action.registry.ts`                                      |
| Deterministic request binding       | `governedChangeFingerprint`                                                          |
| Denial semantics                    | `governedChangeConsumptionError`                                                     |
| Audit trail                         | `AuditService`                                                                       |
| Route gating                        | `route-policy-registry` + `RuntimeAccessGuard` + catalogue functions                 |
| Readiness                           | `src/production/production-readiness.service.ts` (migration head + enforcement gate) |

Registry entries (proposed, all `MFA`, `minimumApprovals 1`, `selfApprovalProhibited`):

| Action                                                 | Resource                | Maker                                             | Checker                                                  |
| ------------------------------------------------------ | ----------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| `INSTITUTION_AGENT_AFFILIATION_CHANGE`                 | `AGENT`                 | `OPERATIONS` + `institution.affiliation.prepare`  | `FINANCE_CONTROLLER` + `institution.affiliation.approve` |
| `FINANCIAL_INSTITUTION_CHANGE`                         | `FINANCIAL_INSTITUTION` | `FINANCE_PREPARER` + `institution.manage.prepare` | `FINANCE_CONTROLLER` + `institution.manage.approve`      |
| `WALLET_INSTITUTION_ATTRIBUTION` _(Phase 3, deferred)_ | `WALLET_ACCOUNT`        | `FINANCE_PREPARER`                                | `FINANCE_CONTROLLER`                                     |
| `CUSTOMER_INSTITUTION_ENROLMENT` _(Phase 3, deferred)_ | `CUSTOMER`              | `CUSTOMER_SERVICE`/`OPERATIONS`                   | `COMPLIANCE`                                             |

New catalogue function codes must be added to `authorization-catalogue.seed.ts` as `IMPLEMENTED` **only when the route exists**, following the repository's rule that a function code is never invented at a call site.

---

## 5. Authorization model

### 5.1 Principal and policy extensions

```ts
// authorization.types.ts (additive, all optional)
institutionId?: string;
institutionAccess?: 'NONE' | 'SELF' | 'ANY';

// AuthorizationPolicy
institutionAccess?: 'NONE' | 'SELF' | 'ANY';
institutionId?: string;      // route-level resource institution, like the existing agentId/aggregatorId
```

`validPrincipal` extensions (fail-closed):

- `AGENT`, `CUSTOMER`, `AGGREGATOR` principals **must not** carry `institutionId` (same separation rule that today forbids `AGENT` + `aggregatorId`, `authorization.service.ts:403-419`).
- Workforce principals may carry `institutionId` only when it was resolved from `workforce_institution_assignments` for that request.
- `institutionAccess` defaults to `NONE`; `SELF` requires a matching `institutionId`; `ANY` requires the explicit platform function code.

### 5.2 Route model

| Route class                                                                       | Principal                                    | Institution requirement                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Agent self-service (`/api/v1/agents/*`)                                           | `AGENT` only, `agentAccess SELF` (unchanged) | None in the policy; institutional context is resolved **server-side** by the financial service, never from the principal |
| Institution administration (`/api/v1/internal/institutions/*`)                    | workforce                                    | `institutionAccess SELF` or platform `ANY`; functions `institution.view` / `institution.manage.*`                        |
| Institution-scoped operations (agents of an institution, wallets, reconciliation) | workforce                                    | `institutionAccess SELF` + resource `institutionId`; cross-institution → **404** (no existence disclosure)               |
| Platform operations (catalogue, global reconciliation)                            | workforce                                    | explicit `institution.scope.platform` function; never implied by role alone                                              |

`checkInstitutionScope` is implemented alongside the existing `checkAgentScope`/`checkAggregatorScope` (`authorization.service.ts:320-371`) and, unlike `checkAggregatorScope`, it must be **reachable** — every institution-scoped route passes a resource `institutionId`, and `ASSIGNED`/`ANY` must not silently degrade to `RESOURCE_SCOPE_MISSING` in a way that blocks legitimate scoped staff.

### 5.3 What never authorizes institutional context

Role membership, `SUPER_ADMIN`, `privileged:execute`, service principals, the agent's aggregator, any request field, any configuration default, or the platform itself.

---

## 6. Authoritative resolution contract (the reusable product boundary)

```ts
export type InstitutionResolution =
  | { outcome: 'RESOLVED'; institutionId: string; affiliationId: string; resolvedAt: Date }
  | {
      outcome: 'UNRESOLVED';
      reason:
        | 'NO_AFFILIATION' // agent has never been affiliated
        | 'AFFILIATION_SUSPENDED'
        | 'INSTITUTION_INACTIVE' // SUSPENDED / PENDING / TERMINATED / soft-deleted
        | 'AMBIGUOUS' // >1 ACTIVE affiliation: schema violation, fail closed
        | 'NOT_CONFIGURED'; // Phase 1a null object: no institution model yet
      resolvedAt: Date;
    };

export interface AgentInstitutionResolver {
  /** Authoritative, server-side. `manager` is mandatory: resolution must share the caller's transaction. */
  resolve(manager: EntityManager, agentId: string): Promise<InstitutionResolution>;
}
```

**Implementation rules**

1. Read from `institution_agent_affiliations` + `financial_institutions` **only** (never aggregators, never wallets, never sessions).
2. `LIMIT 2`; 2 rows → `UNRESOLVED/AMBIGUOUS` + alert (a unique-index violation symptom), never "pick one".
3. Join institution `status = 'ACTIVE' AND deleted_at IS NULL` (`I2`).
4. Take the caller's `EntityManager` so the answer belongs to the same transaction and isolation level as the posting.
5. Return an explicit outcome. **`null` is not a valid return**: absence is `UNRESOLVED`, and every consumer must decide its policy explicitly.
6. Persist/bind the outcome — `{ institutionId, outcome, reason, resolvedAt }` — into authorization evidence, idempotency fingerprint and audit metadata, so replay cannot swap institutions.

**Phase 1a null object** (`NotConfiguredInstitutionResolver`): returns `{ outcome: 'UNRESOLVED', reason: 'NOT_CONFIGURED' }` deterministically, with no database access. Arena 2 codes and tests against the interface today; Phase 1b injects the DB-backed provider with no Cash-Out change.

---

## 7. Financial isolation boundaries — target model

Phase numbers refer to §8. "Enforced" means the corresponding gate is switched on per channel.

### 7.1 Wallets and financial accounts — Phase 3

| Today (verified live)                                                                                                                                                                                                    | Target                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `wallet_accounts(customer_id VARCHAR owner-ref, currency, status, ledger_account_id, owner_class)`; unique `(customer_id, currency)` **and** `uq_wallet_accounts_canonical_uuid_owner_currency (lower(owner), currency)` | add `institution_id UUID NULL REFERENCES financial_institutions(id)`; uniqueness becomes institution-aware |
| `customer_financial_account_bindings`; unique `(customer_id, currency) WHERE state='ACTIVE'`                                                                                                                             | add `institution_id`; active unique becomes `(institution_id, customer_id, currency)`                      |
| legacy `customer_wallets(customer_id, type, currency, status)`                                                                                                                                                           | same nullable treatment if still used; not the source of truth                                             |

```sql
-- Phase 3 (illustrative)
ALTER TABLE wallet_accounts ADD COLUMN institution_id UUID REFERENCES financial_institutions(id);
CREATE UNIQUE INDEX uq_wallet_accounts_institution_owner_currency
  ON wallet_accounts (institution_id, lower(customer_id), currency)
  WHERE institution_id IS NOT NULL AND wallet_owner_ref_is_uuid(customer_id);   -- reuse 118 helper
-- existing indexes keep serving legacy rows where institution_id IS NULL
```

Rules: a wallet created under enforcement must carry its owner's resolved institution (`I5`); a governed ownership resolution (migration `1785753600118`) **never** changes the institution; moving a wallet between institutions is a separate `WALLET_INSTITUTION_ATTRIBUTION` maker-checker action with evidence, never automatic, never a bulk script.

### 7.2 Ledger and settlement — Phase 3

| Concern                       | Design                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts                      | `ledger_accounts.institution_id UUID NULL`. Existing `code` stays globally unique; institution accounts use a namespaced code convention `INST:<code>:<BASE>` (e.g. `INST:ACME:CUSTOMER_FUNDS-NGN`). Splitting global uniqueness into `(institution_id, code)` is a later, optional migration. |
| Journals                      | `ledger_journals.institution_id UUID NULL`.                                                                                                                                                                                                                                                    |
| Structural invariant (**I4**) | Trigger on `ledger_lines`: every line's account must match the journal's institution (both `NULL`, or both the same). This makes a cross-institution posting impossible at the book level, not just in service code.                                                                           |
| Settlement                    | `external_settlements.institution_id`; `settlement_asset_ledger_account_id` must belong to that institution (trigger). `external_suspense_entries` institution-tagged via its operation.                                                                                                       |
| Unattributed history          | Rows keep `NULL` (**I6**); institutional statements exclude them and report them separately.                                                                                                                                                                                                   |

### 7.3 Customer financial relationships — Phase 3 (identity stays global)

- `customers` **unchanged**: one identity, one KYC history, one `kyc_tier_policy_head` (**I9**). No per-institution customer record is ever created.
- New `customer_institution_enrolments(id, customer_id, institution_id, status, external_customer_reference, enrolled_at, approval_id, …)` with `UNIQUE (customer_id, institution_id)`. A customer may be enrolled at several institutions; each enrolment is its own financial relationship.
- `customer_financial_account_bindings` gains `institution_id`; an active binding is per `(institution, customer, currency)`.
- Eligibility (`customer_eligibilities`) stays a global customer fact; institution-specific _acceptance_ is a separate decision recorded against the enrolment (a new field/row), never a second KYC run and never a duplicated customer.
- A customer wallet may only be used by an operation at the institution it belongs to; a mismatch is `CROSS_INSTITUTION_OPERATION_NOT_SUPPORTED` (deferred product decision).

### 7.4 Cash-In, Cash-Out, Cash-to-Cash — Phases 1–3

| Phase | Behaviour                                                                                                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a    | Cash-Out resolves institutional context (null object → `UNRESOLVED/NOT_CONFIGURED`), records it in evidence/audit/fingerprint. No behavioural change.                                                                       |
| 1b    | Real resolver; affiliation data begins to exist; enforcement mode `off`/`advisory`/`enforced` per channel, default `advisory` outside production and required `enforced` by production readiness before launch.             |
| 3     | Wallet/limit/fee institution consistency enforced; agent institution must equal the customer wallet's institution, else fail closed. Cash-In and Cash-to-Cash adopt the same resolver and gate so channels cannot disagree. |

Today's Cash-Out posts customer wallet → agent wallet with no affiliation read (`src/agent/agent-cash-out.service.ts:291-345`); nothing about that posting changes in Phases 1a/1b.

### 7.5 External transfers — Phase 4

`external_operations.institution_id`, `external_settlements.institution_id`; institution must be `ACTIVE` at every lifecycle transition (submit/pending/verify/settle); settlement accounts and provider credentials resolved through the institution; reversal/compensation carries the same institution.

### 7.6 Transaction limits — Phase 3

- Extend `limit_assignments.subject_type` CHECK with `'INSTITUTION'`; `subject_id` = institution id, `segment_code` NULL (mirrors `AGENT_CLASS`).
- Add `institution_id` to `limit_usages` and to the unique window key `uq_limit_usages_window` (currently principal/profile/product/direction/channel/dimension/currency/window).
- Resolution precedence (documented and tested): `INSTITUTION` → `AGENT` → `AGENT_CLASS` → `SEGMENT` → `GLOBAL`, with the first _applicable_ assignment winning per the existing resolver's precedence rules.
- Until Phase 3, institution limits do not exist and behaviour is unchanged.

### 7.7 Classes of Service — Phase 4

Platform classes stay global (`agent_classes`, no institution column). An institution **enables** classes rather than duplicating them:

```sql
CREATE TABLE institution_agent_class_enablement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
  agent_class_id UUID NOT NULL REFERENCES agent_classes(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'ENABLED',
  enabled_by VARCHAR(160) NOT NULL,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_institution_class_status CHECK (status IN ('ENABLED','DISABLED'))
);
CREATE UNIQUE INDEX uq_institution_class ON institution_agent_class_enablement (institution_id, agent_class_id);
```

Under enforcement, an agent's class must be enabled for its institution; until then, behaviour unchanged.

### 7.8 Fees and commissions — Phase 4

- `fee_rules.institution_id UUID NULL` (NULL = platform default). The identity index `uq_fee_rules_identity (product_code, currency, effective_from)` must include `COALESCE(institution_id, '000…')`; resolution precedence: institution-specific → platform default.
- `commission_rules` already scopes by `agent_class_id`/`agent_id`/`aggregator_id`; add `institution_id` and include it in `uq_commission_rules_identity`. **No institution recipient type** in V1 (recipient accounting is fail-closed today, `COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED`); institution revenue participation remains a separate commercial decision.
- `commercial_decision_snapshots` record the resolved institution so a later fee change cannot rewrite history.

### 7.9 Provider configurations — Phase 4

`notification_provider_configurations` is singleton-per-channel and `kyc_provider_configuration` is a single row — **they cannot be extended by adding a column**. Institution overrides therefore need new tables:

```sql
CREATE TABLE institution_provider_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
  channel VARCHAR(40) NOT NULL,              -- 'SMS' | 'EMAIL' | 'KYC' | 'SETTLEMENT'
  provider_key VARCHAR(80) NOT NULL,
  configuration JSONB NOT NULL,
  credential_reference VARCHAR(200),         -- secret-manager path, never the secret
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  approved_by VARCHAR(160), approval_id UUID,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX uq_institution_provider_channel ON institution_provider_configurations (institution_id, channel, provider_key);
```

Resolution: institution override → platform singleton. Credentials are namespaced `institution/<id>/<channel>/<provider>` and are **not** shared implicitly; absent override means the platform provider, which must be an explicit, documented choice.

### 7.10 Reconciliation — Phases 1b/3

- Phase 1b: `GET /api/v1/internal/institutions/attribution-gaps` — agents without an active affiliation (with aggregator relationship listed as _candidate evidence only_), never auto-resolved.
- Phase 3: institution dimension on settlement/reconciliation matching, unattributed wallet/journal buckets, per-institution statements and trial balances.
- Phase 4: institution-facing (workforce) reconciliation views scoped by `institutionAccess`.

### 7.11 Administrative access — Phase 2 with Phase 1b data

- Institution admins (`institutionAccess SELF`) see only their institution's agents, affiliations, wallets, limits, fees and reconciliation; cross-institution access returns **404**.
- Platform staff keep today's global reach **explicitly** (function code `institution.scope.platform`), not implicitly.
- Every affiliation change, institution lifecycle change and attribution is audited with actor, approval id and evidence digest.
- Existing OPERATOR principals are unchanged until Phase 2 migration of scopes; no silent downgrade or silent grant.

---

## 8. Phasing, migration and backfill strategy

Additive only. **Nothing is backfilled in any phase.** New columns are nullable, no defaults that fabricate meaning, and no `UPDATE` statements that invent institutions. Migration identifiers must be coordinated (next free is `1785753600119`; a sibling arena reusing it must be renumbered before release — the same rule recorded for `1785753600118`).

| Phase                                             | Contents                                                                                                                                                                                                                                                            | Migrations     | Behaviour change                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------- |
| **0 — Decisions**                                 | Ratify §14. No code.                                                                                                                                                                                                                                                | none           | none                                                                                    |
| **1a — Arena 2 unblock**                          | `AgentInstitutionResolver` interface + `NotConfiguredInstitutionResolver`; Cash-Out binds the outcome into evidence/audit/fingerprint; readiness wiring prepared (flag defaults `off`).                                                                             | **none**       | none                                                                                    |
| **1b — Institution foundation**                   | `financial_institutions`, `institution_agent_affiliations`, `aggregator_institution_relationships`, `governed_institution_affiliations`, `agent_institution_resolution` view, governance action, resolver swap, attribution-gap report, affiliation reconciliation. | 1 migration    | only when an operator records an affiliation                                            |
| **2 — Scoped workforce access**                   | `workforce_institution_assignments`, principal/policy extensions, `checkInstitutionScope`, institution admin routes, catalogue function codes.                                                                                                                      | 1 migration    | institution-scoped staff can no longer cross institutions; platform scope made explicit |
| **3 — Financial isolation**                       | nullable `institution_id` on wallets/bindings/journals/accounts; `I4` trigger; customer enrolments; limit subject + usage dimension; fee rule identity; attribution views; per-channel enforcement ramp.                                                            | 2–3 migrations | new rows carry institution; enforcement per channel after attribution runway            |
| **4 — Providers, classes, settlement, reporting** | institution provider configs, class enablement, `external_operations`/`external_settlements` institutional columns, institution statements.                                                                                                                         | 2–3 migrations | opt-in per institution                                                                  |

**Enforcement ramp (per channel, `I12`)**

`off` → `advisory` (resolve, record, never block) → `enforced` (unresolved → deny). Promotion criteria for `enforced`: 100 % of active agents in that channel have a resolved affiliation, 100 % of wallets used by that channel carry a matching institution, reconciliation shows zero unexplained gaps, and the readiness gate requires it. `off` is a temporary migration state only; **production readiness must refuse `off`/`advisory` for channels already declared institutionally scoped.**

**Down-migration policy:** each `down()` drops only what its `up()` created and **refuses** (throws) if the table holds rows — the same stance as `1785753600118`'s `down()`. No destructive rollback of financial history, ever.

**Rollout sequencing (critical):** affiliation onboarding → agent-side enforcement → wallet attribution → wallet-side enforcement → fees/limits/providers. Enforcing a channel before its wallets are attributed would block live customers, which is the single largest operational risk in this design.

---

## 9. Existing data treatment

| Existing data                             | Proposed state                     | Treatment                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Independent agents** (no aggregator)    | `UNRESOLVED / NO_AFFILIATION`      | No row created. Visible in the attribution-gap report. Fully operable at today's behaviour; blocked only in channels explicitly switched to `enforced`. Boarded by an operator who records evidence and passes maker-checker.                                                                                                                              |
| **Aggregator-affiliated agents**          | `UNRESOLVED / NO_AFFILIATION`      | **No automatic assignment**, even when the aggregator has exactly one institution (many-to-many table ⇒ not authoritative). The aggregator relationship is listed as _candidate evidence_; a human cites it (`evidence_type='AGGREGATOR_RELATIONSHIP'`, `evidence_reference=<assignment id>`), and the checker validates it before the affiliation exists. |
| **Historical transactions**               | `institution_id NULL`, permanently | Never rewritten or grouped into an institution (**I6/I10**). Labelled _unattributed history_; excluded from institutional statements. Any retrospective labelling would be a read-only derived view, explicitly marked non-authoritative, and only if the product owner approves.                                                                          |
| **Existing wallets**                      | `institution_id NULL`              | Not moved, not merged, not closed. A wallet joins an institution only via the governed `WALLET_INSTITUTION_ATTRIBUTION` action with evidence. Until then it is usable under non-enforced channels and blocked under enforced ones. Balances and ledger history untouched.                                                                                  |
| **Existing workforce operators**          | Global reach, unchanged            | No institution grant implied. Phase 2 adds explicit platform scope; institution grants are then made deliberately, with approval references. No operator is silently narrowed or widened.                                                                                                                                                                  |
| **Unresolved institutional affiliations** | First-class state                  | Reported, queryable, and never inferred from aggregators, agent names, business names, reference prefixes, configuration or geography.                                                                                                                                                                                                                     |

**Explicitly forbidden:** creating a placeholder/"legacy"/"default" institution and assigning history to it; bulk `UPDATE … SET institution_id = …`; deriving an institution from an agent's `reference` or `business_name`; treating an aggregator as its institution; soft-deleting or rewriting rows to "tidy" attribution.

---

## 10. Immediate scope for Arena 2 (smallest safe foundation)

**Build now (no schema, no migration, no behaviour change):**

1. `AgentInstitutionResolver` interface + `NotConfiguredInstitutionResolver` in `src/institution/`, exported by `InstitutionModule` (imported by `AgentModule`).
2. Cash-Out calls `resolve(manager, agentId)` **inside its existing transaction**, and adds `institution: { outcome, institutionId, reason, resolvedAt }` to:
   - the authorization evidence returned by `AgentTransactionAuthorizationService`,
   - the audit metadata of the operation,
   - the idempotency request fingerprint (so a replay cannot claim a different institution).
3. A single enforcement helper `InstitutionPolicy.assertPermitted(resolution)` implementing `off | advisory | enforced` with no default institution, and a unit test that `enforced` + `UNRESOLVED` denies for every reason.
4. Do **not** add institution columns, do **not** touch wallets or ledger, do **not** change OTP, settlement or wallet ownership, and do **not** invent an institution id.

**Acceptance criteria (Phase 1a):**

- Cash-Out responses and current status codes are unchanged (all existing Cash-Out tests pass unmodified).
- Evidence always contains an explicit institutional outcome; no code path can produce `undefined`.
- No request field, header, token claim or configuration can inject an institution id (attempts are rejected with `400`).
- `enforced` + unresolved denies; `enforced` + resolved (resolver stub) proceeds; `off`/`advisory` proceed and record.
- Fingerprint changes if the institutional outcome changes.

**Why this is the right cut:** Arena 2 gets an authoritative, reusable contract with zero coordination cost, the platform gains a single resolution authority before any table exists, and nothing is asserted about institutions that the data cannot support.

---

## 11. Deferred scope (explicitly not in this proposal's implementation)

- Institution self-service login and institution-initiated operations.
- Cross-institution transfers/settlements and any inter-institution journal.
- Institution revenue share, commission payouts, institution settlement of its own obligations.
- Multi-institution agents (widening `uq_institution_agent_active`).
- Institution-specific KYC policy or duplicated customer identity.
- Regulatory reporting, licence validation, capital/liquidity constructs.
- Retail/corporate customer segmentation, FX, multi-currency institutions (NGN only remains).
- Aggregator login, aggregator financial entitlement, aggregator commission accounting.
- Retroactive attribution of any historical record.

---

## 12. Risks and failure modes

| Risk                                                            | Mitigation                                                                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A default/fallback institution is created for convenience       | `I3` + explicit outcome type + tests asserting `UNRESOLVED` never resolves; production readiness refuses `off` in scoped channels                         |
| Enforcement switched on before data exists → operational outage | Phased ramp per channel with numeric promotion criteria; affiliation onboarding precedes enforcement; wallet attribution precedes wallet-side enforcement |
| Affiliation inference from aggregators or names                 | Prohibited in service code and review checklist; evidence type must be explicit and human-validated                                                       |
| Cross-institution journal posting                               | Database trigger (`I4`), not service-level discipline                                                                                                     |
| Stale institution scope in a session                            | Scope read per request from `workforce_institution_assignments`, cache with short TTL, invalidate on revoke and institution suspend                       |
| Wallet silently changing institution                            | `I5`: attribution is a governed action; ownership resolution (`0118`) never touches institution                                                           |
| Historical entries double-counted in institution statements     | Unattributed rows excluded and reported separately                                                                                                        |
| Ledger code collisions across institutions                      | Namespaced codes now; `(institution_id, code)` uniqueness later                                                                                           |
| Governance gap: affiliation change is single-actor today        | New governed action (`INSTITUTION_AGENT_AFFILIATION_CHANGE`) before any institution row exists                                                            |
| Sibling arena reusing migration `1785753600119`                 | Identifier coordination note in the PR and readiness check on migration head                                                                              |

---

## 13. Verification plan

| Phase | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1a    | Unit: resolver null object, policy matrix (`off/advisory/enforced` × 5 unresolved reasons × resolved), fingerprint sensitivity, request-injection rejection. Integration: existing Cash-Out suite unchanged; evidence assertions; enforced-denial HTTP case with a stub.                                                                                                                                                                                     |
| 1b    | Real-PostgreSQL: institution lifecycle transitions and refusals; affiliation single-active + pair uniqueness; governed request/approve/execute; self-approval denial; fingerprint tamper; concurrent affiliation changes serialize; replay idempotency; suspended/terminated institution refuses resolution; attribution-gap report; immutability of `governed_institution_affiliations`; no auto-assignment from aggregator links (explicit negative test). |
| 2     | Scope matrix: institution admin sees own institution only; cross-institution 404; platform function required for global reads; revoked grant loses access immediately; suspended institution blocks scoped writes.                                                                                                                                                                                                                                           |
| 3     | Wallet institution uniqueness (institution-aware); `I4` journal trigger blocks cross-institution lines; unattributed history untouched by any migration; limit precedence INSTITUTION → … → GLOBAL; enforcement ramp matrix.                                                                                                                                                                                                                                 |
| 4     | Provider override precedence and credential isolation; class enablement gate; settlement institution consistency; per-institution statement totals reconcile to unattributed + attributed totals.                                                                                                                                                                                                                                                            |

Every phase: `npx tsc --noEmit`, full `npm run lint`, `npm test`, targeted real-PostgreSQL integration runs, migration-chain and production-readiness constant synchronisation.

---

## 14. Decisions requiring product-owner approval

| #       | Decision                                                                                                  | Recommendation                                                                     | If deferred                                             |
| ------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **D1**  | Is a financial institution a full financial party (own customer relationships, settlement, limits, fees)? | **Yes** — that is the stated direction                                             | Nothing beyond Phase 1a can proceed                     |
| **D2**  | One ACTIVE institution per agent, or multi-institution agents?                                            | **Single-active** for V1                                                           | Keep `I1`; widen later behind a migration               |
| **D3**  | May an unaffiliated agent perform financial operations?                                                   | Explicit policy per channel; `enforced` denies                                     | Channels remain `advisory`; must be recorded in writing |
| **D4**  | Can an aggregator relationship alone establish an institution?                                            | **No** — evidence only, always human-approved                                      | Auto-assignment is prohibited; do not implement         |
| **D5**  | Are historical transactions ever retro-attributed?                                                        | **No**; label only                                                                 | History stays `NULL` and is reported as unattributed    |
| **D6**  | Do customers hold wallets at multiple institutions?                                                       | **Yes**, one wallet per `(institution, customer, currency)`; identity stays single | Wallet-side enforcement cannot start                    |
| **D7**  | Are cross-institution operations (customer at A, agent at B) in V1?                                       | **No** — fail closed with `CROSS_INSTITUTION_OPERATION_NOT_SUPPORTED`              | Requires settlement design                              |
| **D8**  | Who checks affiliation changes?                                                                           | Maker `OPERATIONS`, checker `FINANCE_CONTROLLER` (+ compliance later)              | Governance action cannot be registered                  |
| **D9**  | Is `licence_reference` authoritative or evidentiary?                                                      | **Evidentiary only**; never validated or asserted                                  | Keep nullable and unvalidated                           |
| **D10** | Provider credentials per institution or shared platform?                                                  | Per-institution override with explicit platform default                            | Phase 4 stays deferred                                  |
| **D11** | Do institutions need their own agent class catalogue or enablement of platform classes?                   | **Enablement** (no duplication)                                                    | Phase 4 deferred                                        |
| **D12** | Institution revenue/commission participation?                                                             | Out of V1; fail-closed today                                                       | No institution `recipient_type`                         |

---

## 15. Handoff summary for Arena 2

- **You do not need institutions to exist to finish transaction-bound Cash-Out authorization.** Code against `AgentInstitutionResolver`, record the explicit outcome, and let the enforcement mode stay `off` until Phase 1b data exists.
- **Never** accept an institution from the caller, the token, the aggregator, or a default.
- When Phase 1b lands, the same call returns `RESOLVED` for affiliated agents with no Cash-Out change; the only follow-up is flipping the per-channel mode after the attribution runway.
- If Arena 2 needs institution-aware _financial_ behaviour (institution-specific limits, fees or settlement), that is Phase 3/4 and must be requested as its own scope — not folded into Cash-Out authorization.
