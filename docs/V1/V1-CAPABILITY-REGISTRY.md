# V1 Capability Registry

**Date (Lagos):** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**HEAD:** `ec038da` → `1785753600066-CreateCapabilityRegistry` (67 migrations)
**Module:** `src/capability-registry/` (`capability.enums.ts`, `capability.entity.ts`, `capability.service.ts`, `capability.controller.ts`, `capability.seed.ts`, `capability-seed.service.ts`)
**API:** `GET /api/v1/internal/capabilities` + `GET /api/v1/internal/capabilities/summary` + `GET /api/v1/internal/capabilities/:code` (WORKFORCE_SESSION)
**Production readiness:** `EXPECTED_MIGRATION_TIMESTAMP='1785753600066'` `EXPECTED_MIGRATION_NAME='CreateCapabilityRegistry1785753600066'`

> Generated from authoritative registry (`src/capability-registry/capability.seed.ts` via `capabilities` table). Safe projection only — no `password/hash/ledger/pin/otp/secret/token` exposure. Financial flows unchanged (Transfer/AgentCashIn/CashOut/CashToCash/funding ledger paths untouched). Commercial Decision ledger NOT implemented — registry is metadata/control-plane only.

---

## 1. Purpose — answering 16 questions

For any capability `capabilityCode`, the registry answers:

| # | Question | Field |
|---|----------|-------|
| 1 | What is it? | `name`, `description`, `domain`, `productScope`, `owner`, `version` |
| 2 | Backend? | `backendStatus` ∈ `{PLANNED,DESIGNED,BACKEND_IMPLEMENTED,DISABLED,DEPRECATED,BLOCKED}` |
| 3 | API? | `apiStatus` ∈ `{NOT_EXPOSED,API_READY,DEPRECATED}` — `API_READY` means HTTP route exists and authz is wired (RoutePolicyRegistry) even if UI missing |
| 4 | Admin UI? | `adminUiStatus` ∈ `{NOT_EXPOSED,ADMIN_UI_READY,DEPRECATED}` |
| 5 | Customer UI? | `customerUiStatus` ∈ `{NOT_EXPOSED,CUSTOMER_UI_READY,DEPRECATED}` |
| 6 | Agent UI? | `agentUiStatus` ∈ `{NOT_EXPOSED,AGENT_UI_READY,DEPRECATED}` |
| 7 | Configured? | `configurationStatus` ∈ `{NOT_CONFIGURED,CONFIGURED,DISABLED}` — configured means persisted config exists and is valid (e.g., product rules, fee_rules if authoritative) |
| 8 | Enabled? | `enabled` boolean — runtime gate; independent of `configurationStatus` and `backendStatus` (enabled≠configured, backend≠enabled) |
| 9 | Blocked? | `blockerType` ∈ `{NONE,PRODUCT_DECISION,ACCOUNTING_DECISION,EXTERNAL_DEPENDENCY,V2}` + `blockerDescription` + `lifecycle=BLOCKED` where blocked |
| 10 | Dependencies? | `dependencies: string[] | null` — upstream `capabilityCode` array |
| 11 | Implementation? | `implementationReferences: string[] | null` — file paths (`src/...`) to entity/service/controller |
| 12 | Migration? | `migrationReferences: string[] | null` — migration names (`CreateWalletAndLedger`) without timestamp prefix |
| 13 | Tests? | `testReferences: string[] | null` — `test/*.spec.ts` covering |
| 14 | Docs? | `documentationReferences: string[] | null` — `docs/*.md` audit |
| 15 | V1 vs V2? | `productScope` ∈ `{V1,V2}` |
| 16 | Lifecycle? | `lifecycle` ∈ `{PLANNED,DESIGNED,BACKEND_IMPLEMENTED,API_READY,ADMIN_UI_READY,CUSTOMER_UI_READY,AGENT_UI_READY,FULLY_ENABLED,DISABLED,BLOCKED,DEPRECATED}` — overall rolled status |

**Distinguishing rules (enforced):**
* `BACKEND_IMPLEMENTED` ≠ `FULLY_ENABLED` (needs API + at least one UI + `enabled:true` + `configurationStatus=CONFIGURED`).
* `API_READY` independent of UI (API can be ready while Admin/Customer/Agent UI `NOT_EXPOSED`).
* `implemented` ≠ `configured` (engine can exist but `fee_rules` not authoritative → `NOT_CONFIGURED` + `enabled:false`).
* `enabled` is the commercial toggle; `configurationStatus=DISABLED` means administratively disabled even if code exists.

---

## 2. Data Model (normalized, additive)

**Table `capabilities`:** additive migration `1785753600066` idempotent seed via `CapabilitySeedService.onApplicationBootstrap` (if empty full seed, else upserts new codes). No ledger mutation.

```
capabilities (
  capability_code VARCHAR(80) PK           -- e.g. WALLET_TO_WALLET, FEE_ENGINE
  domain VARCHAR(40) NOT NULL              -- CUSTOMER|AGENT|AGGREGATOR|ADMIN|PLATFORM|WALLET|LEDGER|NOTIFICATION|SUPPORT|RECONCILIATION|COMMERCIAL|SECURITY|IDENTITY|FUNDING|OUTLET
  name VARCHAR(200) NOT NULL
  description VARCHAR(800) NOT NULL
  product_scope VARCHAR(20) NOT NULL CHECK (V1|V2)
  lifecycle VARCHAR(40) NOT NULL CHECK (PLANNED..DEPRECATED)
  backend_status VARCHAR(40) NOT NULL CHECK (PLANNED|DESIGNED|BACKEND_IMPLEMENTED|DISABLED|DEPRECATED|BLOCKED)
  api_status VARCHAR(40) NOT NULL CHECK (NOT_EXPOSED|API_READY|DEPRECATED)
  admin_ui_status VARCHAR(40) NOT NULL CHECK (NOT_EXPOSED|ADMIN_UI_READY|DEPRECATED)
  customer_ui_status VARCHAR(40) NOT NULL CHECK (NOT_EXPOSED|CUSTOMER_UI_READY|DEPRECATED)
  agent_ui_status VARCHAR(40) NOT NULL CHECK (NOT_EXPOSED|AGENT_UI_READY|DEPRECATED)
  enabled BOOLEAN NOT NULL DEFAULT FALSE
  configuration_status VARCHAR(40) NOT NULL CHECK (NOT_CONFIGURED|CONFIGURED|DISABLED)
  dependencies JSONB                    -- ["CUSTOMER_WALLET", ...]
  implementation_references JSONB       -- ["src/fee/fee.engine.ts"]
  migration_references JSONB            -- ["CreateWalletAndLedger"]
  test_references JSONB                 -- ["test/a23-customer-app.integration.spec.ts"]
  documentation_references JSONB        -- ["docs/archive/v1-implementation/V1-COMMERCIAL-ENGINE-CAPABILITY-REGISTRY-AUDIT.md"]
  version INTEGER NOT NULL DEFAULT 1 CHECK (>0)
  owner VARCHAR(80)
  blocker_type VARCHAR(40) NOT NULL DEFAULT 'NONE' CHECK (NONE|PRODUCT_DECISION|ACCOUNTING_DECISION|EXTERNAL_DEPENDENCY|V2)
  blocker_description VARCHAR(800)
  notes VARCHAR(800)
  created_at TIMESTAMPTZ DEFAULT NOW()
  updated_at TIMESTAMPTZ DEFAULT NOW()
  indexes: idx_capabilities_domain, idx_capabilities_product_scope, idx_capabilities_backend_status, idx_capabilities_enabled, idx_capabilities_lifecycle, idx_capabilities_blocker_type
)
```

**Entity** `src/capability-registry/capability.entity.ts` maps snake_case columns (`capability_code`, `product_scope`, `backend_status`, `api_status`, `admin_ui_status`, `customer_ui_status`, `agent_ui_status`, `configuration_status`, `implementation_references`, `migration_references`, `test_references`, `documentation_references`, `blocker_type`, `blocker_description`) to camelCase props. `@Check('version > 0')`. Seed validated: `CAPABILITY_CODE_PATTERN /^[A-Z0-9_]{3,80}$/`, enum asserts, `version≥1`, `name/description` non-empty.

---

## 3. Status Model (PLANNED → DEPRECATED)

```
PLANNED → DESIGNED → BACKEND_IMPLEMENTED → API_READY → (ADMIN|CUSTOMER|AGENT)_UI_READY → FULLY_ENABLED
                         ↓                     ↓
                      DISABLED              DEPRECATED
                         ↓
                       BLOCKED
```

* **PLANNED:** Spec exists (audit), no code.
* **DESIGNED:** Types/calculator exist without authoritative config (e.g., `PRODUCT_CATALOGUE` — `QuotePaymentType`).
* **BACKEND_IMPLEMENTED:** Service + entity + ledger path exist (e.g., `FEE_ENGINE` `src/fee/fee.engine.ts`, `LIMIT_ENGINE` `src/limit/limit.engine.ts`) but not necessarily wired into Transfer/Agent flows (fee-free pilot `pilot_controls enabled=false`).
* **API_READY:** HTTP route + `RoutePolicyRegistry` + `ValidationPipe` exist even if UI `NOT_EXPOSED`.
* **FULLY_ENABLED:** `backendStatus=BACKEND_IMPLEMENTED` + at least one `*_UI_READY` + `apiStatus=API_READY` + `enabled=true` + `configurationStatus=CONFIGURED` — only those count in `summary.fullyEnabled`.

---

## 4. Seed — 101 capabilities (V1 89, V2 12)

**Seed source** `src/capability-registry/capability.seed.ts` `CAPABILITY_SEED: CapabilityCreateInput[]` — idempotent via `CapabilitySeedService.seedIfEmpty()`. Counts derived at runtime via `summary()`.

### 4.1 CUSTOMER (6) + IDENTITY (4) + WALLET (5) + FUNDING/SUPPORT/NOTIFICATION (3) = 18 V1 customer-facing

| capabilityCode | lifecycle | backend | api | adminUi | customerUi | agentUi | enabled | config | blocker |
|---|---|---|---|---|---|---|---|---|---|
| CUSTOMER_IDENTITY | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| CUSTOMER_AUTHENTICATION | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | NOT_EXPOSED | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| CUSTOMER_SESSIONS | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | NOT_EXPOSED | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| CUSTOMER_PASSWORD_MANAGEMENT | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | NOT_EXPOSED | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| CUSTOMER_TRANSACTION_PIN | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | NOT_EXPOSED | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| NIGERIAN_PHONE_NORMALIZATION | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | NOT_EXPOSED | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| RECEIVING_NUMBER | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | NOT_EXPOSED | CUSTOMER_UI_READY | AGENT_UI_READY | true | CONFIGURED | NONE |
| CUSTOMER_WALLET | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| WALLET_BALANCE | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | CUSTOMER_UI_READY | AGENT_UI_READY | true | CONFIGURED | NONE |
| WALLET_TO_WALLET | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| RECIPIENT_RESOLUTION | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | NOT_EXPOSED | CUSTOMER_UI_READY | AGENT_UI_READY | true | CONFIGURED | NONE |
| NAME_CONFIRMATION | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | NOT_EXPOSED | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| CUSTOMER_BENEFICIARIES | DISABLED | BACKEND_IMPLEMENTED | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | false | CONFIGURED | NONE | // backend-only, Customer App not exposed
| CUSTOMER_TRANSACTION_HISTORY | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| CUSTOMER_FUNDING | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| CUSTOMER_NOTIFICATIONS | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | NOT_EXPOSED | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| CUSTOMER_SUPPORT_TICKETS | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |
| CUSTOMER_PROFILE_SETTINGS | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | CUSTOMER_UI_READY | NOT_EXPOSED | true | CONFIGURED | NONE |

### 4.2 AGENT (22) V1 fully-enabled

`AGENT_IDENTITY, AGENT_WALLET, AGENT_FINANCIAL_BINDING, AGENT_AUTHENTICATION, AGENT_TRANSACTION_PIN, AGENT_CLASSES, AGENT_APPLICATION, AGENT_APPROVAL, AGENT_ACTIVATION, AGENT_LIFECYCLE, AGENT_CAPABILITIES, AGENT_RECEIVING_NUMBER, AGENT_FUNDING, AGENT_DEFUNDING, CASH_TO_WALLET, WALLET_TO_CASH, CASH_TO_CASH, CASH_TO_CASH_CLAIM, CASH_TO_CASH_EXPIRY, OUTLETS, TERMINALS, AGENT_APP_BACKEND` — all `FULLY_ENABLED` `BACKEND_IMPLEMENTED` `API_READY` `enabled:true` `CONFIGURED` (verified via `a8`, `a9`, `a13-a17`, `a19-a21`, `v1-003`).

### 4.3 AGGREGATOR (4) V1 fully-enabled

`AGGREGATOR_IDENTITY, AGGREGATOR_LIFECYCLE, AGGREGATOR_AGENT_RELATIONSHIPS, AGGREGATOR_FUNDING_ARCHITECTURE` — fully-enabled (no aggregator ledger account V1 — relationship authorization only — intended).

### 4.4 ADMIN/OPS (11) + PLATFORM (7) = 18 V1 fully-enabled (incl. DISABLED/BACKEND_ONLY edge)

* **ADMIN (8 fully-enabled):** `ADMIN_AUTHZ, ADMIN_CUSTOMER_INVESTIGATION, ADMIN_CUSTOMER_WALLETS_BALANCE, ADMIN_CUSTOMER_TRANSACTIONS, ADMIN_AGENT_LIFECYCLE, ADMIN_AGENT_FINANCIAL_POSITION, FUNDING_MAKER_CHECKER, NOTIFICATION_DIAGNOSTICS, RECONCILIATION_REPORTING, SUPPORT_SERVICING, AUDIT_TRAIL` — all fully-enabled.
* **PLATFORM (5 fully-enabled + 2 backend-only):** `DOUBLE_ENTRY_LEDGER, RECONCILIATION, NOTIFICATION_DELIVERY_ARCHITECTURE, NOTIFICATION_INBOX, SUPPORT_TICKETING` fully-enabled; `IDEMPOTENCY, AUDIT_OUTBOX` `BACKEND_IMPLEMENTED` `NOT_EXPOSED` but `enabled:true` `CONFIGURED` (backend-only, counted in `backendOnly` summary — not user-facing).

### 4.5 COMMERCIAL (31) V1 FUTURE — accurately NOT enabled

Reflects `docs/archive/v1-implementation/V1-COMMERCIAL-ENGINE-CAPABILITY-REGISTRY-AUDIT.md` + engine inspection (`src/fee/fee.engine.ts`, `src/limit/limit.engine.ts` calculators not wired into Transfer flows — pilot fee-free `02A BLOCKED`):

| capabilityCode | lifecycle | backend | api | enabled | config | blocker | notes |
|---|---|---|---|---|---|---|---|
| PRODUCT_CATALOGUE | DESIGNED | DESIGNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | `QuotePaymentType` canonical but no `products` table |
| FEE_ENGINE | DISABLED | BACKEND_IMPLEMENTED | API_READY | false | NOT_CONFIGURED | PRODUCT_DECISION | calculator exists (`fee.engine.ts`) but `fee_rules` not authoritative, `POST /fees/calculate` exists but TransferService not calling — fee-free pilot |
| FLAT_FEE | DESIGNED | DESIGNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| PERCENTAGE_FEE | DESIGNED | DESIGNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| PERCENTAGE_MINIMUM_FEE | DESIGNED | DESIGNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| PERCENTAGE_MAXIMUM_FEE | DESIGNED | DESIGNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| PERCENTAGE_MIN_MAX_FEE | DESIGNED | DESIGNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| FLAT_PLUS_PERCENTAGE_FEE | DESIGNED | DESIGNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| TIERED_FEE | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| PROGRESSIVE_FEE | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| USAGE_BASED_PRICING | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| VOLUME_BASED_PRICING | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| PROMOTIONAL_PRICING | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| CUSTOMER_SPECIFIC_PRICING | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| KYC_LEVEL_PRICING | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| AGENT_CLASS_PRICING | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| COMMISSION_ENGINE | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | separate from fees, allocation Agent/Aggregator/platform undecided |
| AGENT_COMMISSION | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| AGGREGATOR_COMMISSION | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| PLATFORM_REVENUE_ALLOCATION | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | fee - commission - reward |
| REWARD_ENGINE | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | V1 design only |
| CASHBACK | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| LIMIT_ENGINE | DISABLED | BACKEND_IMPLEMENTED | API_READY | false | NOT_CONFIGURED | PRODUCT_DECISION | `limit.engine.ts` exists but runtime enforcement bypassed (`pilot_controls enabled=false`, no `limit_usages FOR UPDATE`) |
| CUSTOMER_RUNTIME_LIMITS | BLOCKED | BLOCKED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | requires 10 decisions + Lagos day + FOR UPDATE |
| AGENT_RUNTIME_LIMITS | BLOCKED | BLOCKED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| COMMERCIAL_DECISION_SNAPSHOT | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | immutable `commercial_decisions` + `product_ledger_mappings` not created |
| COMMERCIAL_RULE_VERSIONING | PLANNED | PLANNED | NOT_EXPOSED | false | NOT_CONFIGURED | PRODUCT_DECISION | |
| (plus 4 auxiliary: included in counts — see seed) |

> **No CommercialDecision ledger created, no Transfer/Agent funding ledger changes.** Fee/Commission/Reward/Limit runtime remains fee-free pilot (`02A BLOCKED`) irrespective of calculator existence.

### 4.6 V2 (12) — explicitly out-of-scope

`WALLET_TO_BANK, NIBSS_INTEGRATION, WEMA_INTEGRATION, PROVIDUS_INTEGRATION, NINEPSB_INTEGRATION, EXTERNAL_SETTLEMENT, CARDS, DOLLAR_CARDS, AIRTIME, BILLS_ELECTRICITY, BETTING, NON_NGN_PRODUCTS` — all `PLANNED` `productScope=V2` `blockerType=V2|EXTERNAL_DEPENDENCY` `enabled:false` `NOT_CONFIGURED` (do not present as V1 missing — see `docs/V1/V1-PRODUCT-COMPLETION-AUDIT.md`).

---

## 5. V1/V2 classification

* **V1 (89):** Wallet, Customer, Agent, Aggregator, Admin/Platform, Commercial future (PLANNED/DESIGNED/BLOCKED). Deterministic: `productScope=V1`.
* **V2 (12):** Wallet→Bank (NIBSS/Wema/Providus/NinePSB), External settlement, Cards (incl. Dollar/Non-NGN), Airtime/Bills/Betting — `V2` `EXTERNAL_DEPENDENCY` — never block V1 launch gate.

---

## 6. Commercial statuses accurate (as of HEAD `ec038da`)

* `PRODUCT_CATALOGUE` `DESIGNED` not `BACKEND_IMPLEMENTED` — no `products` table.
* `FEE_ENGINE` `BACKEND_IMPLEMENTED` `API_READY` but `enabled:false` `NOT_CONFIGURED` `lifecycle=DISABLED` — accurate: `src/fee/fee.engine.ts` `calculate` flat+percentage+min/max+VAT exists and `POST /fees/calculate` is `API_READY`, but `fee_rules` not authoritative (`TransferService` not calling `FeeEngine`) → fee-free pilot.
* `LIMIT_ENGINE` same (`src/limit/limit.engine.ts` `evaluate`) but `pilot_controls enabled=false` → balance-only enforcement, no `limit_usages` SERIALIZABLE — correctly `DISABLED`/`NOT_CONFIGURED`.
* `COMMISSION_ENGINE/REWARD_ENGINE/COMMERCIAL_DECISION_SNAPSHOT` `PLANNED` — correctly not `BACKEND_IMPLEMENTED` (no `commercial_decisions` table).

---

## 7. Internal read-only API (least privilege)

**Routes** (`CapabilityController` `GET /internal/capabilities`):

* `GET /api/v1/internal/capabilities` — list with filtering + pagination. Query params: `domain`, `lifecycle`, `backendStatus`, `apiStatus`, `adminUiStatus`, `customerUiStatus`, `agentUiStatus`, `productScope`, `blockerType`, `enabled` (`true|false`), `page` (1..`, `limit` 1..100 default 20, deterministic `ORDER BY capability_code ASC`). Returns `{ data: CapabilitySafeProjection[], total, page, limit, totalPages, hasNextPage }`. Safe projection only (no hash/secret). 401 if principal missing, 403-ish `UnauthorizedException('Privileged access required')` for `CUSTOMER|AGENT|AGGREGATOR` (enforced in controller `requireWorkforce` + `RoutePolicyRegistry` `authenticationMode=WORKFORCE_SESSION` `allowedPrincipalTypes=[SUPPORT,OPERATOR,SERVICE,PRIVILEGED]`).
* `GET /api/v1/internal/capabilities/summary` — derived summary (see §8).
* `GET /api/v1/internal/capabilities/:code` — single `capabilityCode` (`/^[A-Z0-9_]{3,80}$/`), 404 if not found.

**Filtering:** exact match upper-cased (`t.toUpperCase()`) for `domain`/`lifecycle`/…; `enabled` parsed strictly.

**Auth:** `RoutePolicyRegistry` explicit `path.startsWith('/api/v1/internal/capabilities')` → `WORKFORCE_SESSION` `resourceType=capability-registry` `allowedPrincipalTypes=[SUPPORT,OPERATOR,SERVICE,PRIVILEGED]` `customerAccess=NONE` `agentAccess=NONE` + generic `internal-route` fallback. Controller also calls `requireWorkforce(req)` checking `req.authorizationPrincipal` type.

**No writes:** read-only.

---

## 8. Summary endpoint (derived)

`GET /api/v1/internal/capabilities/summary` (`CapabilityService.summary()`):

```ts
{
  total: number,                      // all
  fullyEnabled: number,               // enabled && configured && backendImplemented
  backendOnly: number,                // backendImplemented but NOT_EXPOSED all UIs+API
  apiReadyButUiMissing: number,       // apiReady while customerUi & agentUi NOT_EXPOSED
  configuredButDisabled: number,      // configured but enabled==false
  blocked: number,                    // blockerType!=NONE || lifecycle BLOCKED || backend BLOCKED
  planned: number,                    // lifecycle PLANNED || backend PLANNED
  v1: number,                         // productScope V1
  v2: number,                         // productScope V2
  byDomain: Record<string,number>,
  byBackendStatus: Record<string,number>
}
```

All counts re-derived from `capabilities` table — not cached.

---

## 9. Docs generated

* This file `docs/V1/V1-CAPABILITY-REGISTRY.md` — authoritative — generated from `capability.seed.ts` (see counts above).
* `docs/archive/v1-implementation/V1-CAPABILITY-REGISTRY-VERIFICATION-REPORT.md` — PG integration verification (67 migrations, API filtering/pagination/auth/safe-projection/summary).

---

## 10. Migration

* **Next additive** `1785753600066-CreateCapabilityRegistry.ts` — `CREATE TABLE capabilities ... CHECK ... indexes` + idempotent seed. No down-mutation of ledger.
* **Count:** 67 (`1785753600000` → `0066`).
* **Readiness:** `src/production/production-readiness.service.ts` `EXPECTED_MIGRATION_TIMESTAMP='1785753600066'` `EXPECTED_MIGRATION_NAME='CreateCapabilityRegistry1785753600066'`.
* **Existing tests updated** to expect `0066` (production-readiness spec + 18 integration specs `latest.timestamp` + `count 67`).

---

## 11. Financial safety

* **Do NOT implement** Fee/Commission/Reward/Limit runtime nor `commercial_decisions` ledger nor change `TransferService`/`AgentCashIn`/`CashOut`/`CashToCash`/funding flows (validated: `ledger_journals`/`ledger_lines` counts unchanged for beneficiary/Capability CRUD — see verification report).
* Registry is metadata/control-plane only; controllers are `GET` only; seed runs on bootstrap (no `postJournalInTransaction`).

---

## 12. References

* `src/capability-registry/capability.enums.ts` — 10 enums
* `src/capability-registry/capability.entity.ts` — entity + indexes + Check
* `src/capability-registry/capability.types.ts` — `CapabilityCreateInput`/`SafeProjection`/`Summary`
* `src/capability-registry/capability.service.ts` — `create`/`findByCode`/`list`/`summary`/`count`
* `src/capability-registry/capability.controller.ts` — `GET /internal/capabilities*`
* `src/capability-registry/capability.module.ts` + `capability-seed.service.ts` — bootstrap seed
* `src/app.module.ts` — `CapabilityRegistryModule` wired
* `src/authorization/route-policy-registry.ts` — `capability-registry` workforce policy
* `src/migrations/1785753600066-CreateCapabilityRegistry.ts`
* `src/production/production-readiness.service.ts`

---

*Generated: 2026-09-27 Africa/Lagos. Registry is the single source of truth; docs follow DB.*
