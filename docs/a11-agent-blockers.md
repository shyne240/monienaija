# A11 Agent Transaction Authorization Foundation — Unresolved Blocker Documentation

This file records where A11 stops rather than inventing accounting/regulatory policy, and how the reusable authorization gate is to be consumed by future financial commands.

## 1. Existing Architectures Discovered (2026-09-25)

**Agent authentication / session**
- `agent_authentication_credentials` (PBKDF2/SCRYPT/ARGON2ID/BCRYPT), `agent_authentication_sessions` (token_hash CHAR64, audience `agent-api`, status ACTIVE/REVOKED/EXPIRED), `AgentAuthenticationExecutionService.authenticate()` (validates `AgentStatus.ACTIVE`, credential `ACTIVE` + not locked/expired, `AgentPasswordHashVerificationService.verify()` PBKDF2/SCRYPT), `AgentAuthenticationSessionService.issue()/validate()/revoke()`.
- `RuntimeAccessGuard` validates Bearer token via `AgentAuthenticationSessionService` first, then Customer session; on success builds `AuthorizationPrincipal {type:'AGENT', principalId:agentId, agentId, sessionId, audience, roles:[], scopes:[], customerAccess:'NONE', agentAccess:'SELF', assuranceLevel:'PASSWORD'}` and calls `AuthorizationService.authorize()` against `RoutePolicyRegistry` (Agent routes: `agentAccess:SELF`, internal: `SUPPORT|OPERATOR|SERVICE|PRIVILEGED`).
- No per-transaction PIN check in `RuntimeAccessGuard`; login and transaction PIN are distinct.

**Agent transaction PIN**
- `agent_transaction_pins` (`agent_id UUID FK`, `pin_hash VARCHAR512`, `hash_algorithm`, `pin_version`, `failed_count INT DEFAULT0`, `account_locked BOOLEAN`, `locked_at`, `lock_reason`, `last_changed_at`, `version`, `deleted_at`, `uq_agent_transaction_pins_active_agent WHERE deleted_at IS NULL`).
- `AgentAuthenticationService.setTransactionPin(agentId, {pinHash, hashAlgorithm, pinVersion, actor})` (transactional, rotate vs create, resets `failed_count`/`accountLocked`, audits `PIN_CREATED|PIN_ROTATED` via `AuditService` + `redactRecord`).
- `AgentAuthenticationService.verifyTransactionPin(agentId, {pin, actor}, verificationService)` (checks `pin.length 1..1024`, `stored` existence (`PIN_NOT_FOUND`), `accountLocked` (`PIN_LOCKED`), delegates to `AgentPasswordHashVerificationService.verify(pin, alg, hash)`, on success resets `failedCount` and audits `PIN_VERIFIED`, on failure increments `failedCount`, locks when `>=5` (`MAX_FAILED_PINS`), audits `PIN_FAILED`, re-reads for `PIN_LOCKED` vs `MISMATCH`). Uses same `AgentPasswordHashVerificationService` as login (PBKDF2/SCRYPT, `timingSafeEqual`).
- Controller `POST /agents/me/transaction-pin` hashes raw PIN `PBKDF2$sha256$10000$salt$hash` (random 16B salt) then calls `setTransactionPin`; `POST /agents/me/transaction-pin/verify` validates `^\d{4,12}$` then calls `verifyTransactionPin`; responses and `audit_events` never contain `pin`/`pinHash` (redacted, pino `req.body.pin` redacted).
- `MAX_FAILED_PINS = 5`, lockReason `Maximum failed PIN attempts reached`, `failedCount >=0`, `pin_version >0`. No per-service PIN, no expiry.

**A10 service capability**
- `AgentServiceCapabilityService` (`agent-service-capability.service.ts`) reuses `AgentClass.applicableServices JSONB` (fail-closed `null/undefined/notArray/empty/unknownEntry → EMPTY/MALFORMED`, `!isActive → AGENT_CLASS_INACTIVE`, `!includes(canonical) → SERVICE_NOT_PERMITTED`), `agents.status` (`PENDING/SUSPENDED/TERMINATED/deletedAt → DENIED`), principal-aware `evaluateWithPrincipal`. No wallet/ledger side effects, audit `AGENT_SERVICE_CAPABILITY DENIED`.

**Customer transaction PIN**
- No Customer transaction PIN analogous to Agent PIN; customer auth uses `customer_authentication_credentials` and session; no `customer_transaction_pins` table. Agent PIN is isolated.

**Authorization contexts**
- `AuthorizationService.evaluate()` produces `AuthorizationDecision {allowed, reason: UNAUTHENTICATED|PRINCIPAL_TYPE_DENIED|...|CUSTOMER_SCOPE_MISMATCH|RESOURCE_SCOPE_MISSING}`; `RuntimeAccessGuard` stores `authorizationPrincipal`/`authorizationDecision` on request. No existing `AgentAuthorizedTransactionContext`; A11 creates the smallest reusable typed context for downstream commands.

**Audit**
- `AuditService.record(manager, {entityType, entityId, action, actor, previousValues?, newValues?})` transactional, `redactRecord` for secrets. Existing patterns: `AGENT_AUTHENTICATION_CREDENTIAL`, `AGENT_TRANSACTION_PIN`, `AGENT_SERVICE_CAPABILITY`, `AUTHORIZATION_DECISION`. A11 follows same without logging `pin`/`pinHash`.

## 2. A11 Authorization Architecture

**Domain service:** `AgentTransactionAuthorizationService` (`src/agent/agent-transaction-authorization.service.ts`), provided by `AgentModule` (imports `forwardRef(() => AgentAuthenticationModule)` to reuse `AgentAuthenticationService` + `AgentPasswordHashVerificationService`). Injects `AgentServiceCapabilityService`, `AgentAuthenticationService`, `AgentPasswordHashVerificationService`, `DataSource`, `AuditService`. No new table, no migration.

**Method:** `authorize({agentId, service, pin?, principal?, actor?}) → AgentTransactionAuthorizationResult` + alias `authorizeWithPrincipal(agentId, service, pin, principal)`. Future financial commands inject this service as single gate instead of reimplementing auth.

**Sequence (conceptual 1-7, fail-closed, documented deviation if any):**
1. `agentId` must be UUID → else `INVALID_AGENT_ID`
2. `principal` must exist → else `UNAUTHENTICATED`
3. Principal type `CUSTOMER → PRINCIPAL_NOT_AGENT`, workforce `SUPPORT|OPERATOR|SERVICE|PRIVILEGED → WORKFORCE_NOT_PERMITTED`, `AGENT` with `agentId` mismatch → `PRINCIPAL_MISMATCH`, other non-AGENT → `PRINCIPAL_NOT_AGENT`, missing type → `INVALID_PRINCIPAL`
4. `service` trim→ `normalizeAgentService` → reused via `AgentServiceCapabilityService.evaluateWithPrincipal` (no duplication of Agent lookup/status/class/active/applicableServices). Capability DENIED → map `CapabilityReason` to `AgentTransactionAuthorizationReason` and return DENIED (audit DENIED best-effort). Capability already audits.
5. `pin` must be non-empty string → else `PIN_REQUIRED`
6. `agentAuthService.verifyTransactionPin(agentId, {pin, actor: actor ?? principal.principalId ?? agentId}, verificationService)` — reuses hashing (PBKDF2/SCRYPT `timingSafeEqual`), attempt counting, lockout (`failedCount >=5 → accountLocked`), policy, audit. No second PIN storage, no raw PIN logging.
   - `verified → AUTHORIZED` with `AgentAuthorizedTransactionContext`
   - `locked/PIN_LOCKED → PIN_LOCKED`
   - `PIN_NOT_FOUND → PIN_NOT_FOUND`
   - `INVALID_PIN/MISMATCH → PIN_INVALID`
7. Else `AUTHORIZED` — returns context for downstream command (no journal, no locking).

**Reuse:**
- **A10:** `AgentServiceCapabilityService.evaluateWithPrincipal(agentId, rawService, principalForCap)` — single source for Agent lookup, `deletedAt`, `status PENDING/SUSPENDED/TERMINATED/ACTIVE`, `agentClassId` null/missing/deleted/inactive, `applicableServices` null/empty/notArray/unknownEntry, `SERVICE_NOT_PERMITTED`. A11 does not duplicate those checks.
- **PIN:** `AgentAuthenticationService.verifyTransactionPin` + `AgentPasswordHashVerificationService.verify` — reuses `pin_hash` storage, `hash_algorithm`, `pin_version`, `failed_count`/`accountLocked`/`lockedAt`, `MAX_FAILED_PINS=5`, `PBKDF2$sha256$10000$...` / `SCRYPT$...` parsing, `timingSafeEqual`. A11 does not create second `pin_hash` column or bypass lockout.

**Authorized transaction context:** `AgentAuthorizedTransactionContext {agentId, principal: AuthorizationPrincipal, service: raw, canonicalService: AgentService, agentStatus, agentClassId, agentClassActive:true, applicableServices, applicableLimits, authorizedAt: Date}`. No `wallet balance`, `pin`, `pinHash`, `OTP`, secrets. `AgentTransactionAuthorizationResult {allowed, decision: AUTHORIZED|DENIED, reason, agentId, service, canonicalService, principal?, context?, agentStatus?, agentClassId?, applicableServices?, applicableLimits?}`. Context is not a financial transaction; downstream commands own `idempotency`, `ledger transaction boundary`, `SELECT ... FOR UPDATE`, journal.

## 3. Failure Taxonomy (explicit, fail-closed)

`AgentTransactionAuthorizationReason = CapabilityReason | 'UNAUTHENTICATED'|'INVALID_PRINCIPAL'|'PRINCIPAL_NOT_AGENT'|'PRINCIPAL_MISMATCH'|'WORKFORCE_NOT_PERMITTED'|'PIN_REQUIRED'|'PIN_NOT_FOUND'|'PIN_INVALID'|'PIN_LOCKED'|'PIN_POLICY_VIOLATION'`

Maps:
- `UNAUTHENTICATED` — no principal (spec: unauthenticated)
- `PRINCIPAL_NOT_AGENT` / `INVALID_PRINCIPAL` / `PRINCIPAL_MISMATCH` / `WORKFORCE_NOT_PERMITTED` — wrong principal type/mismatch (spec: wrong principal type, principal Agent ID mismatch, workforce)
- `AGENT_NOT_FOUND`/`AGENT_DELETED`/`AGENT_PENDING`/`AGENT_SUSPENDED`/`AGENT_TERMINATED`/`AGENT_NOT_ACTIVE`/`MISSING_AGENT_CLASS`/`AGENT_CLASS_NOT_FOUND`/`AGENT_CLASS_DELETED`/`AGENT_CLASS_INACTIVE`/`EMPTY_APPLICABLE_SERVICES`/`MALFORMED_APPLICABLE_SERVICES`/`UNKNOWN_SERVICE`/`SERVICE_NOT_PERMITTED`/`INVALID_AGENT_ID`/`INVALID_SERVICE` — via A10 (spec: not found, deleted, pending, suspended, terminated, class unavailable/inactive, service not permitted, unknown service)
- `PIN_REQUIRED` — pin undefined/empty (spec: transaction PIN missing)
- `PIN_NOT_FOUND` — no `agent_transaction_pins` row (spec: PIN policy)
- `PIN_INVALID` — `INVALID_PIN`|`MISMATCH` (spec: transaction PIN invalid)
- `PIN_LOCKED` — `locked` or `PIN_LOCKED` after `failedCount>=5` (spec: locked, lockout remains enforced)
- `PIN_POLICY_VIOLATION` — reserved for future length/policy (currently mapped via `PIN_INVALID`)

No unnecessary new taxonomy; reuses `CapabilityReason` and `AgentPasswordVerificationFailure`.

## 4. Status Semantics

`PENDING → DENIED (AGENT_PENDING)` cannot authorize; `ACTIVE → may authorize if capability + PIN pass`; `SUSPENDED → DENIED (AGENT_SUSPENDED)` no per-service exception; `TERMINATED → DENIED (AGENT_TERMINATED)`; `deletedAt → AGENT_DELETED`. Tested E-H.

## 5. No Money Movement

No `wallet_accounts`/`ledger_journals`/`ledger_lines`/`customer_financial_account_bindings`/`customers` writes, no `SELECT ... FOR UPDATE`, no `journal`/`commission`/`fee`/`physical-cash`. Proven via `SELECT count(*)::text` before/after `authorize` for both failed (Q) and successful (R) — counts unchanged, `customers WHERE reference=agent.reference` remains 0.

## 6. API Surface

No new public `POST /agents/transactions/authorize` endpoint. Primary is domain `AgentTransactionAuthorizationService.authorize()`. `AgentModule` exports service for future `Cash→Wallet`/`Wallet→Cash`/`Cash→Cash` commands (which will own idempotency/ledger boundary). No diagnostic controller added.

## 7. What Remains (for later financial commands)

- Idempotency key, `ledger transaction boundary`, `pessimistic locking`, `journal` creation, `Agent wallet` debit/credit, `limit` (`single/daily/monthly` + future Agent limits via `applicableLimits`), `commission`/`fee`, `physical-cash` records.
- When limits are defined, only `authorize` needs to consult `agentClass.applicableLimits` before returning context; table stays.
- No migration now; if per-Agent PIN policy override or per-service PIN required flag is needed, add `agent_transaction_pin_policies` additive table — not required now.

## 8. Verification

- `npx tsc --noEmit` 0, `npm run build` 0, `npm run lint` 0 (pre-existing 60+ warnings, A11 service now `eslint-disable no-unnecessary-type-assertion` only)
- `test/a11-agent-transaction-authorization` 24/24: A AUTHORIZED, B PIN_INVALID, C PIN_LOCKED, D SERVICE_NOT_PERMITTED, E PENDING, F SUSPENDED, G TERMINATED, H deleted, I PRINCIPAL_MISMATCH, J CUSTOMER, K workforce, L PIN_REQUIRED, M UNKNOWN, N inactive class, O missing class, P deterministic, Q failed PIN no financial side effect, R success no wallet/ledger/customer, S Agent A cannot authorize B, T capability change respected, U lockout remains, plus security unauthenticated/unknown/terminated, PIN no leak, alias CASH_TO_WALLET.
- `A8+A9+A10+A11` 76/76 (A8+A9+A10 52/52 + A11 24/24)
- `unit` 1764/1766 (2 pre-existing `ExternalReconciliationService` PASS→ERROR)
- `migration-chain` no A11 migration, `CREATE TABLE agent_transaction_pins` remains `1785753600053`
