# A9 Agent MonieNaija Receiving Number — Unresolved Blocker Documentation

This file records the exact boundaries where A9 stops rather than inventing business/regulatory or accounting policy, as required by the fail-closed rule.

## 1. Existing Customer Implementation (Inspected 2026-09-25)

**Finding:**
- `grep -rn receiving src` → 0 results; `find src -name "*.ts" | xargs grep -l "phone|Phone"` only hit `customer.service.ts:504` (ContactMethod phone validation) and not a MonieNaija receiving-number table.
- `customers` has no `receiving_number` / `monienaija_number` column; identity is `reference` (`^[a-z0-9][a-z0-9_.:-]{0,159}$`) and contact phone is stored in `customer_contact_methods.normalized_value` after `value.replace(/[\s()-]/g,'')` validated by `^\+?[1-9]\d{7,14}$` (ContactMethodType PHONE, unique on `(type, normalized_value) WHERE deleted_at IS NULL`).
- `customer_contact_methods` stores `value` (raw) + `normalizedValue` (trimmed/sanitized) + `isPrimary` + `verifiedAt`; no 10-digit canonical sequence/table was found for a MonieNaija receiving number.
- No virtual-account or wallet column stores a 10-digit MonieNaija number; `virtual_accounts.accountNumber` is provider-scoped 4-32 digits with provider-unique constraint, not a MonieNaija namespace.
- `CustomerProfile.displayName` / `legalName` + `Customer.reference` are the display identities; phone resolution is via `customer_contact_methods`.

**Conclusion:** No globally unique Customer 10-digit MonieNaija namespace exists in HEAD that could safely be extended to contain Agent numbers without inventing a second format or assuming a Customer-only column is globally unique. The smallest additive is therefore an independent Agent mechanism.

## 2. What Agent Lacks (Before A9)

- `agents` has no `receiving_number` column, no phone field, and `agent_applications` stores only `contact_email` / `business_name` / `payload` / `applicantReference` (no authoritative Nigerian phone).
- No `Agent → receiving_number → AgentWallet → WalletAccount → LedgerAccount` binding existed; `agent_applications.agentId` links to canonical `agents` only.
- No recipient-resolution service could distinguish `CUSTOMER` vs `AGENT`; Beneficiary/VirtualAccount resolution is provider/bank-scoped, not MonieNaija canonical.
- Lifecycle (`AgentLifecycleService`) had no receiving-number hooks; transitions were audited but did not allocate/retain/revoke any identity.

## 3. Missing Decision (Fail-Closed)

- **Nigerian 10-digit allocation algorithm:** The repo contains no approved algorithm for generating a MonieNaija 10-digit number (range, prefix, checksum, NIBSS, recycling, privacy). The implementation MUST NOT use Agent UUID substring, wallet UUID, random UUID conversion, sequence exposed as phone-like, or timestamp unless that is the canonical V1 algorithm (it is not documented).
- **Global registry enforcement:** True DB-level global uniqueness across `customer_contact_methods` and `agent_receiving_numbers` would require a shared `receiving_number_registry` table with triggers or a cross-table exclusion constraint plus CustomerService also checking Agent numbers on `addContactMethod`. No such registry exists and inventing one would couple Customer writes to Agent identity without product approval.
- **Phone vs receiving number equivalence:** Customer phone may be stored as `+234803...`, `0803...`, or `803...`; the canonical 10-digit equivalence (`803...`) is not formally defined for regulatory purposes.
- **Recycling / reassignment policy:** Whether a revoked `TERMINATED` number may be recycled after cooling, and privacy/accounting treatment of historic journals, is undefined.
- **Authorization scope for resolution:** Whether `GET /api/v1/recipients/resolve` should be public, authenticated-any, or privileged-only is not defined; currently `CUSTOMER|AGENT|SUPPORT|OPERATOR|SERVICE|PRIVILEGED` with `ANY`.

## 4. Smallest Safe Implementation (This Change)

- **Table:** `agent_receiving_numbers` (migration `1785753600055`) — `id UUID PK`, `agent_id UUID UNIQUE WHERE deleted_at IS NULL`, `receiving_number VARCHAR(10) UNIQUE WHERE deleted_at IS NULL` with checks `~'^[0-9]{10}$'` and `~'^[789][0-9]{9}$'`, `status ACTIVE|REVOKED`, `assigned_at`, `revoked_at`, `version`, `created_at`, `updated_at`, `deleted_at`, FK `agent_id → agents(id)`, no `balance` / `ledger_account_id` / `wallet` columns.
- **Allocation:** At `PENDING→ACTIVE` (both `activate()` and `activateFromApplication()` paths) within the same DB transaction, `AgentReceivingNumberService.ensureForAgentInManager()` is called; allocation is idempotent per `agent_id`, persists via unique constraints + `pessimistic_write` lock on `agents`, and is audited (`AGENT_RECEIVING_NUMBER:ALLOCATED` + `AGENT:RECEIVING_NUMBER_ALLOCATED`). Generation is `randomInt` 10-digit `^[789]\d{9}$` (first digit 7/8/9, 9 random digits) with up to 12 retries; each candidate is checked for collision against `customer_contact_methods` (`normalized_value = $1 OR +234||$1 OR 234||$1 OR 0||$1` where `type='PHONE'` and `deleted_at IS NULL`) and against existing `agent_receiving_numbers`; concurrency safety via `23505` retry and post-violation re-read of the agent's row.
- **Lifecycle:** `DRAFT/SUBMITTED/UNDER_REVIEW/REJECTED` → no number (application service does not allocate); `PENDING` → no active number (`ensureForAgent` throws); `APPROVED-not-ACTIVE` → no active number until `activateFromApplication`; `ACTIVE` → must have exactly one ACTIVE row; `SUSPENDED` → retains ACTIVE identity (no revoke, `transition` does not modify `agent_receiving_numbers`); `TERMINATED` → revoked (`status=REVOKED`, `revokedAt=NOW()`, audit `REVOKED`/`RECEIVING_NUMBER_REVOKED`) and never re-allocated; `deleted_at IS NOT NULL` agents never resolve.
- **Resolution:** `RecipientResolutionService.resolve(identifier)` canonicalizes via `replace(/[\s()-]/g,'')` → strip `+234`/`234`/`0` → `^[789]\d{9}$`; first checks `agent_receiving_numbers` (`status=ACTIVE`, `deleted_at IS NULL`) and verifies `agents.status IN (ACTIVE,SUSPENDED)` and `deleted_at IS NULL` → returns `{ownerType:AGENT, ownerId, receivingNumber: canonical, display: origin application businessName || agent.reference, status}`; else checks `customer_contact_methods` via same OR-match → verifies `customers.status != CLOSED` and `deleted_at IS NULL` → returns `{ownerType:CUSTOMER, ownerId, receivingNumber: canonical, display: customer_profiles.displayName || customers.reference, status}`; else `NotFoundException`. This preserves Customer phone + MonieNaija resolution and never exposes `PENDING`/`REJECTED`/`deleted`/`TERMINATED` (Agent) or `CLOSED`/`deleted` (Customer). Uniqueness is enforced at allocation time; `A-E` global uniqueness `Customer A → X` and `Agent B → X` cannot occur for same canonical unless a Customer phone is inserted after an Agent allocation without checking Agent numbers (documented as the remaining registry gap).
- **Financial isolation:** No `Customer` row is created for Agent (`Agent.reference = applicantReference` only), no `wallet_accounts` / `ledger_accounts` / `ledger_journals` / `ledger_lines` / `customer_wallets` / `customer_financial_account_bindings` rows are created by `AgentLifecycleService` or `AgentReceivingNumberService` (verified by `test/a9` P/Q/R and existing `a8` V/W/Y). Balance and ledger are untouched on `SUSPENDED`/`TERMINATED`; allocation has `no balance` column (`Y`).
- **Auth:** No new role; Agent cannot self-allocate arbitrary numbers — allocation is only via privileged lifecycle (`POST /api/v1/internal/agents/:id/activate`, `.../applications/:id/activate`, `.../:id/suspend|terminate|reactivate` with `requirePrivileged` + `RuntimeAccessGuard` `internal:access`); Agent self-service is limited to `GET /api/v1/agents/:id/receiving-number` (agentAccess `SELF` via `RoutePolicyRegistry` `AGENT`); internal `GET /api/v1/internal/agents/:id/receiving-number` is privileged. Resolution `GET /api/v1/recipients/resolve?identifier=` and `resolve-phone` are `CUSTOMER|AGENT|SUPPORT|OPERATOR|SERVICE|PRIVILEGED` `ANY`.
- **Audit:** Every allocation/change/revoke is recorded via `AuditService.record(manager, {entityType, entityId, action, actor, previousValues, newValues})` with no secrets (only `agentId`, `receivingNumber`, `status`, `revokedAt`). Correlation via `dataSource.transaction`.

## 5. What Remains Unimplemented (Explicitly)

- No Customer `receiving_number` table and no shared `receiving_number_registry` with triggers; true DB-level cross-table uniqueness is not yet enforced by a single unique index.
- No generation from Customer phone, no deterministic hash from `applicantReference`, no sequence-derived phone, no NIBSS integration, no outlet/POS class gating, no fee/limit/transfer routing, no Agent wallet/LedgerAccount creation on activation.
- When a canonical algorithm and registry are defined, only `AgentReceivingNumberService.generateCandidate()` and the `hasCustomerCollision` check need to change; the `agent_receiving_numbers` table, lifecycle hooks, `RecipientResolutionService`, indexes, constraints and audits remain.

## 6. Operational Verification (2026-09-25)

- `npx tsc --noEmit` 0
- `npm run build` 0
- `npm run lint` (eslint) exit 0 (43 pre-existing warnings in `src/operations`, `test/*` unrelated to A9)
- `test/migration-chain` 15/15, head `1785753600055`
- `test/a8-agent-lifecycle` 23/23 (including AB migration chain 56)
- `test/a9-agent-receiving-number` 10/10 (A-J, K-O, P-R, Y)
- `npm run test` 1764/1766 (2 pre-existing `ExternalReconciliationService` at 1087/1197 unrelated)
- `DB_HOST=... npm run test:pg` 216→226/226 (13→14 suites) after adding A9
- No `balance`/`ledger_account_id` column in `agent_receiving_numbers` (`information_schema` check Y)
