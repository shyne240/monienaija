# A10 Agent Service Capability & Authorization — Unresolved Blocker Documentation

This file records the exact boundaries where A10 stops rather than inventing business/regulatory or accounting policy, as required by the fail-closed rule.

## 1. Existing Agent Service Metadata Discovered (2026-09-25)

**AgentClass:**
- `agent_classes.applicableServices` JSONB nullable, no enum, stored as `unknown | null` via `AgentClassService`. No canonical service constants, no validation, no runtime use before A10. Same for `applicableLimits`, `requirements`, `requiredInformation`, `requiredDocumentCategories`.
- No `AgentService` / `AgentCapability` / `CASH_IN` etc. exist in `src/agent` or elsewhere; closest is A7 `virtual-account.inbound-funding` and B2 `commercial.agent-assisted.inbound-funding` (billing scope, not Agent service).
- `agents` has `agentClassId` nullable FK, `status PENDING|ACTIVE|SUSPENDED|TERMINATED`, `deletedAt`. No per-agent service override column.

**Authorization:**
- `AuthorizationService` / `RuntimeAccessGuard` / `RoutePolicyRegistry` exist. `Agent` principal is `type: 'AGENT'` with `agentId` UUID, `agentAccess: SELF`, `customerAccess: NONE`. `AGENT_LOGIN` mode for `POST /api/v1/agents/sessions|/login` and `AGENT_LOGIN` for `POST /api/v1/agents/applications*` (unauthenticated). All other `/api/v1/agents/*` → `AGENT` `SELF`. Internal `/api/v1/internal/agents/*` → `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` `internal:access`.
- No Agent service-capability gate existed; transactions would have checked `agentAccess: SELF` only, not `applicableServices`.

**Limits:**
- `LimitEngine` is Customer-wallet scope (`customerId, walletId, paymentType`) with `single/daily/monthly` minor checks. `AgentClass.applicableLimits` is generic JSONB, not runtime-authoritative; no Agent limit engine exists.

**Wallet/Finance:**
- `wallet_accounts.customerId VARCHAR(160)` opaque, but `customer_wallets` is Customer-wallet `PRIMARY`. F-1/F-2 Agent wallet is WalletAccount-linked via opaque `customerId` (= agentId string) + `ledger_accounts`; no per-service financial execution in A10.

## 2. Final V1 Service Vocabulary (Additive)

No canonical identifiers existed → smallest additive `src/agent/agent-service.enum.ts`:

```ts
export enum AgentService {
  CASH_IN = 'CASH_IN',           // Cash → Wallet (alias CASH_TO_WALLET)
  CASH_OUT = 'CASH_OUT',         // Wallet → Cash (alias WALLET_TO_CASH)
  CASH_TO_CASH = 'CASH_TO_CASH',
  AGENT_FUNDING = 'AGENT_FUNDING',
  AGENT_DEFUNDING = 'AGENT_DEFUNDING',
}
export const AGENT_SERVICE_ALIASES = { CASH_TO_WALLET: CASH_IN, WALLET_TO_CASH: CASH_OUT, ... };
```

Only these 5 canonical (7 with aliases) for V1. No cards/airtime/bills/electricity/betting/dollar/non-NGN. `normalizeAgentService(raw)` trims/uppercases → alias map → canonical or null. If ambiguous, repository's `CASH_IN` convention is kept as canonical rather than `CASH_TO_WALLET`.

## 3. Runtime Capability Architecture

**Domain service:** `AgentServiceCapabilityService` (`src/agent/agent-service-capability.service.ts`), provided by `AgentModule` (TypeOrm `Agent` + `AgentClass`, `DataSource`, `AuditService`). No new table, reuses `agent_classes.applicableServices` JSONB.

**Method:** `evaluate(agentId, service)` + `evaluateWithPrincipal(agentId, service, principal)` → `AgentServiceCapabilityEvaluation { allowed, decision: ALLOWED|DENIED, reason, agentId, service, canonicalService, agentStatus, agentClassId, agentClassActive, applicableServices, applicableLimits }`. Pure read, no `wallet_accounts`/`ledger_journals`/`ledger_lines`/`customer` side-effects.

**Decision (fail-closed):**
1. `agentId` must be UUID → else `INVALID_AGENT_ID`
2. `service` trim → `normalizeAgentService` → null → `UNKNOWN_SERVICE`/`INVALID_SERVICE`
3. Optional principal: `CUSTOMER` → `PRINCIPAL_NOT_AGENT` (M); `AGENT` with `agentId` mismatch → `PRINCIPAL_MISMATCH` (L); `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` → `WORKFORCE_NOT_PERMITTED` (N) — workforce never auto-acquires Agent service.
4. `agents` lookup: missing → `AGENT_NOT_FOUND`; `deletedAt` → `AGENT_DELETED`; `PENDING` → `AGENT_PENDING` (C); `SUSPENDED` → `AGENT_SUSPENDED` (D, no exception); `TERMINATED` → `AGENT_TERMINATED` (E); not `ACTIVE` → `AGENT_NOT_ACTIVE`.
5. `agentClassId` null → `MISSING_AGENT_CLASS` (H); lookup miss → `AGENT_CLASS_NOT_FOUND`; `deletedAt` → `AGENT_CLASS_DELETED`; `!isActive` → `AGENT_CLASS_INACTIVE` (G).
6. `applicableServices` must be non-empty array of known services (normalized via same alias): null/undefined → `EMPTY_APPLICABLE_SERVICES` (I); not array → `MALFORMED_APPLICABLE_SERVICES` (J); `[]` → `EMPTY`; any entry unknown → `MALFORMED`; requested canonical not in normalized array → `SERVICE_NOT_PERMITTED` (B).
7. Else `ALLOWED` (A), returns `applicableLimits` for future limits (no ₦1.2m, no daily/monthly hardcoded).

**No new table:** `applicableServices` JSONB is sufficient; additive migration would be cleaner but not required per §11.

## 4. Authorization / Status / Class Integration

- Status semantics preserved: `PENDING`/`SUSPENDED`/`TERMINATED`/`deleted` always DENIED; only `ACTIVE` with active class and explicit service is ALLOWED. No global lifecycle change.
- `AgentClass.applicableServices` is now runtime-authoritative: class must be active **and** service explicitly permitted.
- No hardcoding "every Agent can do every service"; no regulatory permissions hardcoded.
- Capability is additional gate after authentication / `AGENT` `SELF` / status, before PIN/limits/financial execution (conceptual flow 1-7 in ticket).

## 5. Limits

Not implemented. `LimitEngine` remains Customer-wallet. `applicableLimits` is returned in evaluation for future Agent limit engine, but no ₦1.2m/daily/monthly/CBN values are invented. Documented dependency: future Agent limits must resolve `agentClass.applicableLimits` and delegate to Agent-limit engine (fail-closed if missing).

## 6. Audit

Denied attempts are recorded best-effort via `AuditService` `AGENT_SERVICE_CAPABILITY: DENIED` (entityId `agentId`, `actor` `principalType ?? 'system'`, `newValues {service, canonicalService, reason, agentStatus, agentClassId, agentClassActive}`) without PINs/passwords/OTPs/secrets. Allowed reads are not audited (no noise) per conventions.

## 7. API Surface

No public `check my permissions` endpoint. Primary is domain `AgentServiceCapabilityService.evaluate*`. No new `AgentModule` controllers for capability (internal diagnostic not required). Future financial commands can inject `AgentServiceCapabilityService` as gate.

## 8. What Remains

- No Agent limit enforcement, no per-Agent service override column (if needed, add `agents.applicableServicesOverride` JSONB or `agent_service_permissions` table — not required now).
- No `AGENT`→`Customer` bridging, no `ADMIN` financial permissions, no balance column.
- When limits / per-Agent overrides are defined, only `evaluate` needs to consult them; table stays.

## 9. Verification

- `npx tsc --noEmit` 0, `npm run build` 0, `npm run lint` exit 0 (pre-existing 43 warnings)
- Migration chain: 56 (`1785753600055`), no A10 migration
- `test/a10-agent-service-capability` 19/19 (A-Q + security + alias): A allowed, B denied not permitted, C pending, D suspended, E terminated, F deleted, G inactive class, H missing class, I empty, J malformed/unknown, K runtime config change, L A≠B, M Customer, N workforce, O no wallet/ledger, P no Customer row, Q deterministic, plus bypass attempts and alias.
- Full PG integration 226/226, unit 1764/1766 (2 pre-existing `ExternalReconciliationService`).
