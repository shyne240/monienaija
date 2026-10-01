# A21 Agent App Backend Foundation / Contract — V1

**Scope:** Thin backend contract for the future Agent App (mobile) reusing A1–A20 domain truth. No mobile UI, no Flutter/React Native, no new balance model, no device pairing, no second auth/PIN/capability/outlet model.

## 1. Authority & Truth Reuse

- **Agent lifecycle/status/class:** `Agent` (`agents` table) + `AgentClass` (`agent_classes`) — unchanged. Status `PENDING|ACTIVE|SUSPENDED|TERMINATED`, class.applicableServices/applicableLimits is source for capabilities.
- **Auth / Session:** `AgentAuthenticationService` + `AgentAuthenticationSessionService` — unchanged. PBKDF2 password hash, tokenHash stored, not raw, `audience=agent-api`, 15 min TTL (A7). No new auth model.
- **PIN:** `AgentAuthenticationService` transaction PIN (`agent_transaction_pins`, PBKDF2) — unchanged.
- **Capabilities:** `AgentServiceCapabilityService.evaluate`/`evaluateWithPrincipal` fail-closed (ACTIVE + class allows + HMAC etc). Canonical `AgentService`: `CASH_IN, CASH_OUT, CASH_TO_CASH, AGENT_FUNDING, AGENT_DEFUNDING`.
- **Receiving Number:** `AgentReceivingNumberService` (`agent_receiving_numbers`, 10 digits `^[789][0-9]{9}$`, ACTIVE/REVOKED).
- **Financial position:** Ledger-derived via `WalletService.listWallets` → `LedgerService.getAccountBalance` (double-entry, `ledger_accounts` + `ledger_journals` + `ledger_lines`). **No `agents.balance_minor`, no `AgentBalance`, no second ledger, no cached truth.** Agent wallet is a `wallet_accounts` row where `customer_id = agentId` (reusing customer wallet infrastructure — no new wallet table).
- **Outlets/Terminals:** `OutletService`/`TerminalService` (`agent_outlets`, `agent_terminals`) + `AggregatorAgentRelationshipService`. No wallet/ledger side-effects.
- **Financial ops:** Existing `AgentCashInService`, `AgentCashOutService`, `AgentCashToCashService`, `AgentCashToCashClaimService`, `AgentFundingService` — unchanged semantics (idempotency, journal, OTP/claim, expiry).
- **Aggregators:** Existing `AggregatorService` — relationship-only, no ledger account for aggregator in V1.

## 2. HTTP Surface ( `/api/v1` prefix, Fastify )

### 2.1 Authentication & Session (existing, reused — A7)

| Method | Path | Auth | Behaviour |
|--------|------|------|-----------|
| POST | `/agents/sessions` | `AGENT_LOGIN` (none) | `{agentId, password}` → `{accessToken, tokenType: Bearer, expiresIn, agentId}`. ACTIVE only. Idempotency via password verification, tokenHash stored. |
| POST | `/agents/login` | `AGENT_LOGIN` | Alias of above. |
| POST | `/agents/sessions/logout` | AGENT (SELF) | Revokes caller's session (tokenHash). |
| POST | `/agents/logout` | AGENT (SELF) | Alias. |
| GET | `/agents/me` | AGENT (SELF) | `{id, reference, status, createdAt, updatedAt}` — minimal identity. |
| POST | `/agents/me/transaction-pin` | AGENT (SELF) | `{pin}` → `{agentId, hasPin:true}`. Never returns pin/hash. |
| POST | `/agents/me/transaction-pin/verify` | AGENT (SELF) | `{pin}` → `{verified:boolean}`. |

**Auth expectation:** `Authorization: Bearer <accessToken>`. `RuntimeAccessGuard` resolves `AuthorizationPrincipal{type:'AGENT', agentId, principalId, agentAccess:'SELF', customerAccess:'NONE'}` via `AgentAuthenticationSessionService`. Unauthenticated → 401, wrong principal → 403, cross-agent → 404 or 403 per service.

### 2.2 Agent App V1 Thin Adapters (new, additive, no business-logic duplication)

All paths **AGENT SELF** (`RoutePolicyRegistry`: `path.startsWith('/api/v1/agents/')` → `allowedPrincipalTypes:['AGENT'] , agentAccess:'SELF'`).

| Method | Path | Service reused | Response (success 200) | Errors |
|--------|------|----------------|------------------------|--------|
| GET | `/agents/me/profile` | `AgentRepository` + `AgentClassRepository` | `{id, reference, status, agentClassId, agentClass:{id,reference,code,name,isActive}|null, createdAt, updatedAt}` | 401 no token, 404 deleted |
| GET | `/agents/me/capabilities` | `AgentServiceCapabilityService.evaluateWithPrincipal` per canonical service | `{agentId, permittedServices:string[], evaluations:[{service, canonicalService, allowed, reason}]}` — reason∈`INACTIVE_AGENT|UNKNOWN_SERVICE|SERVICE_NOT_APPLICABLE|ALLOWED` etc | 401 |
| GET | `/agents/me/financial-position` | `WalletService.listWallets` (ledger-derived) | `{agentId, currency:'NGN', balanceMinor:string, availableBalanceMinor:string, walletExists:boolean, walletId?, ledgerAccountId?, status?}` — `balanceMinor` is `BIGINT` string, `'0'` when no wallet. Never exposes ledger internals beyond `ledgerAccountId`. | 401 |
| GET | `/agents/me/receiving-number` | `AgentReceivingNumberService.getByAgentId` | `{agentId, receivingNumber:string|null, status:'ACTIVE'|'NONE', ...}` — alias of `GET /agents/:id/receiving-number` but SELF-bound. | 401, 200 with null when none |
| GET | `/agents/:id/receiving-number` | `AgentReceivingNumberService` (existing) | Same as above, `:id` must equal principal.agentId else 403/404 via SELF policy. | 401/403 |
| GET | `/agents/me/outlets` | `OutletService.listByAgent(principal.agentId)` | `[{id, agentId, reference, code, name, displayName, status, addressLine, city, state, country, createdAt, updatedAt}]` — filtered to own agent | 401 |
| GET | `/agents/me/outlets/:outletId` | `OutletService.getById` + ownership check | Single outlet or 404 if `outlet.agentId !== principal.agentId` | 401/404 |
| GET | `/agents/me/terminals` | `TerminalService.listByAgent` | `[{id, agentId, outletId, reference, code, label, status, serialNumber, createdAt, updatedAt}]` | 401 |
| GET | `/agents/me/terminals/:terminalId` | `TerminalService.getById` + ownership | Single terminal or 404 | 401/404 |

**Notes:**
- No pagination in V1 (list returns full own set; small cardinality). Future pagination will follow existing `?page&limit` convention when needed.
- `code` may be null (optional unique where not deleted). `reference` is globally unique (where `deleted_at IS NULL`).
- Outlets/terminals lifecycle is workforce-owned (`internal/...`); Agent App only **reads** own. Create/suspend/terminate remain `POST/PATCH /internal/...` via `OutletService` with `PRIVILEGED/SUPPORT/OPERATOR/SERVICE` principal.

### 2.3 Financial Operations (existing, unchanged — reused via same AGENT SELF guard)

| Method | Path | Idempotency | PIN/OTP | Ledger/journal |
|--------|------|-------------|---------|----------------|
| POST | `/agents/cash-in` | `idempotencyKey` (unique per agent) | `pin` required | `CASH_IN` → journal `agent → wallet`, receipt |
| POST | `/agents/cash-out` | `idempotencyKey` | `pin` | `CASH_OUT` → journal `wallet → agent` |
| POST | `/agents/cash-to-cash` | `idempotencyKey` | `pin` | Creates `cash_to_cash_transfers` + journal (hold), `transferCodeHash`, `expiresAt` |
| POST | `/agents/cash-to-cash/claim` | `claimIdempotencyKey` | `transferCode` (+ OTP hardening A14) + recipient verification | Moves hold to claimant, journal claim, idempotent |
| POST | `/internal/agents/:id/fund` / `/defund` & `/internal/aggregators/:id/agents/:agentId/fund` | Workforce only | — | Platform pool ↔ agent wallet (no aggregator ledger account in V1) |

All financial writes preserve: **idempotency** (`uq_*_agent_idempotency`), **ledger double-entry** (`ledger_journals`/`ledger_lines` balanced, `total_minor`), **PIN verification** (PBKDF2, not returned), **OTP/lockout/expiry** for cash-to-cash, **claim idempotency**, **audit** (`audit_events` without secret).

### 2.4 History

No dedicated `GET /agents/me/history` in V1. History is available via existing domain queries where supported (e.g., `cash_to_cash_transfers` where `agent_id = principal.agentId`, wallet ledger lines via `LedgerService`). A future `GET /agents/me/transfers?status&from&to` will be a thin read adapter over existing repositories, not a new event store. Documenting as intentionally deferred.

## 3. Auth & Access Semantics

- **Principal types:** `AGENT` (SELF), `PRIVILEGED|SUPPORT|OPERATOR|SERVICE` (workforce), `CUSTOMER` (never permitted on `/agents/*`). `AGGREGATOR` is not used for Agent App.
- **Route policy:** `RoutePolicyRegistry.resolve` — `PUBLIC` only for `/health`, `/internal/version`, `POST /agents/sessions|login` (`AGENT_LOGIN`), `POST /agents/applications*`. Every other `/api/v1/agents/*` → `AGENT` SELF. `internal/*` → workforce only.
- **Cross-agent:** Service-layer ownership check (`entity.agentId !== principal.agentId` → 404). No enumeration of other agents' outlets/terminals.
- **Customer trying Agent App:** `AuthorizationPrincipal.type='CUSTOMER'` → `RuntimeAccessGuard` denies (403) for `allowedPrincipalTypes:['AGENT']`.
- **Lifecycle restrictions:** `AgentServiceCapabilityService` returns `allowed:false, reason:INACTIVE_AGENT` when `status !== ACTIVE` or `class.isActive=false`. Financial ops additionally reject `SUSPENDED|TERMINATED` at service layer with `409/403`. Reads (`profile`, `outlets`, `terminals`, `receiving-number`, `financial-position`) remain readable regardless of status (except deleted) to allow the app to display restricted state.

## 4. Request / Response Conventions

- **Headers:** `Authorization: Bearer <accessToken>`; `Content-Type: application/json`; `X-Request-Id`/`X-Correlation-Id` propagated via `LoggerModule`/`request-context`.
- **Body:** `ValidationPipe({whitelist:true, transform:true})`. DTOs use `class-validator` (`@IsString`, `@IsUUID`, `@IsOptional`).
- **Success:** `200` with JSON view (no envelope). Sensitive fields never serialized: `passwordHash`, `pinHash`, `tokenHash`, `secret`, `codeHash`.
- **Errors:** Nest `HttpException` → `{statusCode, message, error}`. Common: `401` (no/invalid/expired session), `403` (principal not allowed), `404` (not found or not owned), `409` (duplicate reference/code, already used idempotency key), `422` (ledger insufficient balance), `400` (validation).
- **Idempotency:** Client supplies `idempotencyKey` (max 255) for writes. Server stores `idempotencyKey` + `requestHash` (`sha256` canonical JSON) and returns prior result on retry (see `LedgerService`, `AgentCash*Service`). No `Idempotency-Key` header.
- **PIN/OTP:** `pin` (4–6 digits) sent only in body over TLS, verified via `AgentAuthenticationService.verifyPin`, never logged (redacted paths in `LoggerModule` include `pin`, `pinHash`, `token`, `transferCode`). Cash-to-cash claim uses `transferCode` (hash verification, `failedAttempts` + lock after threshold, A14 hardening).
- **Error redaction:** `audit_events.new_values`/`previous_values` never contain `password`, `pin`, `secret`, `token` (verified in A20/A7).

## 5. OpenAPI

No committed OpenAPI spec exists in this repo (no `swagger`/`openapi` in `src`). This contract is the source of truth for V1. A future `GET /api/docs` (Swagger) will be generated from decorators without changing behaviour.

## 6. Non-Goals for V1

- Mobile SDK, push, biometrics, device attestation, certificate pinning.
- New outlet/terminal write via Agent App (remains workforce).
- Agent-to-aggregator ledger account (V1 aggregator is relationship-only).
- Cached `balance_minor` on `agents` or `agent_balances` table — **prohibited** (ledger is truth).
- Pagination field `balance`, `availableBalance` beyond `balanceMinor` (single source).

## 7. Testing & Gates

- **Real-PostgreSQL** integration harness (`test/support/pg-harness.ts`, `EmbeddedPostgres` at `data/embedded-pg`) — migrations run per suite, isolated DB `mn_it_<label>_<pid>`.
- **New suite:** `test/a21-agent-app.integration.spec.ts` (13 tests, see §2) covering auth/self, cross-agent 404, unauthenticated 401, capability visibility, ledger-derived balance (0 and funded via `WalletService`+`LedgerService`), receiving number, outlet/terminal read, sensitive-data redaction, route policies, financial-op compatibility, no migration.
- **Regression:** A7 (auth), A8 (lifecycle), A9 (receiving number), A10/A11 (capabilities), A13–A17 (cash-*), A20 (outlets/terminals) remain green.
- **Gates:** `tsc --noEmit` 0, `nest build` 0, `npm run test:pg -- a21,a20` pass, no `agents.balance*` column (`information_schema.columns`).

## 8. Migration & Readiness

- **Migration count:** 63 (`CreateAgentOutletsAndTerminals1785753600062` head). A21 adds no migration (contract-only).
- **Readiness:** `GET /api/v1/agents/me/*` endpoints are immediately usable by the future Agent App with the same `POST /agents/sessions` token. No feature flag.

---
*Generated for branch `arena/01a0d883-monienaija` — 2026-09-26.*
