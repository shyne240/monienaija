# V1-LIMIT-05 Verification Report — Limit Regression Matrix, Operational Diagnostics & Safe Reservation Recovery

**Status: VERIFIED**
**Date: 2026-09-27**
**Branch: `arena/01a0d883-monienaija`**

---

## 1. Exact HEAD before / after

| | Commit |
|---|---|
| Verified HEAD before | `86b654f` (docs(limit-04): update verification report HEAD after hash) |
| Parent implementation | `1932dde` (feat(limit-04): runtime limit resolution/evaluation & financial-flow wiring) |
| HEAD after (feat) | `4f37aea` (V1-LIMIT-05 implementation) |
| HEAD after (docs) | `204c02e` (this report) |

Work started from a clean tree on `86b654f`; the V1-LIMIT-04 implementation (8 wired flows, 28-case W→W matrix, SERIALIZABLE + FOR UPDATE reservation-before-posting) is unchanged in its financial semantics.

## 2. Migration count

**70 migrations — unchanged.** Head migration `1785753600069 CreateLimitUsages`.
V1-LIMIT-05 required **zero migrations**: diagnostics and the manual recovery boundary operate entirely on the existing `limit_usages`, `limit_reservations`, and `audit_events` schema; `transfers.failure_code` is `VARCHAR(64)` and accepts the LIMIT_* codes without schema change.

## 3. Files changed

**New (src):**
- `src/limit-catalog/limit-diagnostics.service.ts` — read-only diagnostics service (SELECT-only SQL, safe projection, deterministic pagination, configurable stale threshold)
- `src/limit-catalog/limit-operations.controller.ts` — `GET /internal/limit-usages`, `GET /internal/limit-reservations`, `POST /internal/limit-reservation-recovery/release` with defense-in-depth role checks
- `src/limit-catalog/limit-reservation-recovery.service.ts` — manual PRIVILEGED-only release boundary + orphan analysis documentation

**Modified (src):**
- `src/limit-catalog/limit-catalog.module.ts` — registers new controller/services, imports OperationsModule (explicit; it is `@Global()` so runtime DI is unchanged)
- `src/transfer/transfer.enums.ts` — `TransferFailureCode` extended with the 15 stable LIMIT_* codes + `limitCodeToTransferFailureCode()` type-safe narrowing helper (additive only)
- `src/transfer/transfer.service.ts` — limit-failure marking now uses the typed helper instead of `code as any`
- `src/capability-registry/capability.seed.ts` — +3 capabilities (LIMIT_USAGE_DIAGNOSTICS, LIMIT_RESERVATION_DIAGNOSTICS, LIMIT_RESERVATION_RECOVERY); existing entries untouched

**New (test):**
- `test/v1-limit-05-flow-matrix.integration.spec.ts` — 205 tests: per-flow regression matrix across all 8 wired flows + failure-code union coverage
- `test/v1-limit-05-diagnostics.integration.spec.ts` — 11 tests: authorization, filtering, pagination, safe projection, read-only, stale flag, recovery-route authorization
- `test/v1-limit-05-recovery.integration.spec.ts` — 9 tests: manual release lifecycle, COMMITTED/RELEASED protection, concurrent releases, validation, ledger immutability, automatic-reaping guard

**No deletions. No changes** to Fee Engine, Commission Engine, Reward Engine, Commercial Decision Snapshot, bank/provider integrations, V2 flows, limit profiles/rules/assignments/usage architecture, or the legacy `customer_limit_profiles` / `AgentClass.applicableLimits` / `LimitEngine` surfaces.

## 4. Regression matrix

The V1-LIMIT-04 28-case W→W suite remains green and is now joined by a table-driven matrix executed per flow. Cases (with per-flow applicability documented in §5):

| # | Case | Assertions |
|---|------|-----------|
| 1 | no-applicable-limit | allowed; zero usage rows for product |
| 2 | within-limit | success; used committed; reserved 0 |
| 3 | exactly-at-limit | success at exact boundary |
| 4 | one-unit-above-limit | `LIMIT_DAILY_AMOUNT_EXCEEDED`; nothing consumed |
| 5 | below-min-amount-per-tx | `LIMIT_MIN_AMOUNT_NOT_MET` |
| 6 | above-max-amount-per-tx | `LIMIT_MAX_AMOUNT_EXCEEDED` |
| 7–10 | daily / weekly / monthly / yearly amount exceeded | correct windowed `LIMIT_*_AMOUNT_EXCEEDED` code |
| 11–14 | daily / weekly / monthly / yearly count exceeded | correct windowed `LIMIT_*_COUNT_EXCEEDED` code |
| 15 | multiple simultaneous limits | blocked with one of the breached codes; prior usage untouched |
| 16 | concurrent limit boundary | Promise.all; exactly floor(limit/amount) commits; used = committed sum; reserved 0 |
| 17 | idempotent replay | replay consumes exactly once (funding: one-shot approve 409 replay, still consumed once) |
| 18 | failed financial execution after reservation | ledger rejection after enforce → release path; nothing consumed; no RESERVED rows remain |
| 19 | successful reservation commit | all reservations for the key COMMITTED; reserved counters 0 |
| 20 | product isolation | rule on another product not applied |
| 21 | principal/profile isolation | assignment for another principal not applied |
| 22 | effective-dated rule | future `effective_from` ignored |
| 23 | disabled rule | `is_active=false` ignored |
| 24 | disabled profile | `enabled=false` → unresolved → unlimited |
| 25 | assignment precedence | higher precedence wins; usage (if any) only against winning profile |
| 26 | wallet-balance-max (INCOMING flows only) | balance+amount over max → `LIMIT_WALLET_BALANCE_EXCEEDED`; within max allowed |

**Total: 205 matrix tests** (8 flows × applicable cases + failure-code union test), all passing on real PostgreSQL with concurrency via `Promise.all` and client-side SERIALIZABLE-abort retry emulation.

## 5. Per-flow applicability

| Flow | Product | Principal (type) | Direction | MIN/MAX | 4 amount windows | 4 count windows | WALLET_BALANCE_MAX |
|---|---|---|---|---|---|---|---|
| Wallet→Wallet | WALLET_TRANSFER | source customer (CUSTOMER) | OUTGOING | ✓ | ✓ | ✓ | N/A (credit-side only) |
| Cash→Wallet | CASH_TO_WALLET | recipient customer (CUSTOMER) | INCOMING | ✓ | ✓ | ✓ | ✓ |
| Wallet→Cash | WALLET_TO_CASH | payer customer (CUSTOMER) | OUTGOING | ✓ | ✓ | ✓ | N/A |
| Cash→Cash initiation | CASH_TO_CASH | initiating agent (AGENT) | OUTGOING | ✓ | ✓ | ✓ | N/A |
| Cash→Cash claim | CASH_TO_CASH | beneficiary customer (CUSTOMER) | INCOMING | ✓ | ✓ | ✓ | ✓ |
| Customer Funding (approve) | CUSTOMER_FUNDING | funded customer (CUSTOMER) | INCOMING | ✓ | ✓ | ✓ | ✓ |
| Agent Funding | AGENT_FUNDING | funded agent (AGENT) | INCOMING | ✓ | ✓ | ✓ | ✓ |
| Agent Defunding | AGENT_DEFUNDING | defunded agent (AGENT) | OUTGOING | ✓ | ✓ | ✓ | N/A |

Deliberate exclusions (not mechanically applied):
- **WALLET_BALANCE_MAX on OUTGOING flows** — V1-LIMIT-04 enforces it against the authoritative ledger balance on credit only; outgoing flows spend balance down, so the dimension is semantically inapplicable and is not tested there (documented in the spec header).
- **Idempotent-replay semantics differ per flow** — W→W / cash-in / cash-out / C2C / agent funding replay the same idempotency key; Customer Funding replays request creation (approve is one-shot; second approve returns 409 already-approved). Both paths assert the limit is consumed exactly once.
- **Concurrency degree differs by flow** — MFA-guarded flows (Wallet→Cash, C2C claim) use 3-way concurrency (limit 70000, 3×30000 → exactly 2 commit), matching the repository's own 2-way MFA concurrency convention in a14 tests W/X/Y; other flows use 5-way (limit 100000, 5×30000 → exactly 3 commit).

## 6. Diagnostic APIs

### `GET /api/v1/internal/limit-usages`
Filters (all optional, validated): `limitProfileCode`, `principalType`, `principalId`, `product`, `dimension`, `currency`, `windowKey`, `windowType`, `windowFrom`/`windowTo` (against `window_start`), `page`, `limit` (1–100, default 50).
Ordering: `created_at DESC, id DESC` (deterministic). Response: `{ page, limit, total, totalPages, data[] }` with used/reserved counters, window boundaries, profile/rule references, timestamps.

### `GET /api/v1/internal/limit-reservations`
Filters: `status` (RESERVED|COMMITTED|RELEASED), `limitProfileCode`, `principalType`, `principalId`, `product`, `dimension`, `currency`, `windowKey`, `idempotencyKey`, `correlationId`, `reservedFrom`/`reservedTo` (against `reserved_at`), `stale` (true → RESERVED-only older than threshold), `page`, `limit`.
Ordering: `reserved_at DESC, id DESC`. Items include `ageSeconds` and `stale` flags for RESERVED rows plus `staleThresholdMinutes` on the envelope.

### `POST /api/v1/internal/limit-reservation-recovery/release`
Body: `{ reservationId, reason, correlationId? }`. PRIVILEGED-only. Manual boundary — not part of the diagnostics resource; documented separately in §9.

Operators can answer: what usage a principal has consumed; which windows are active; what reservations exist; which are still RESERVED; when created; which transaction/correlation reference is associated; which profile/rule generated the usage. **No mutation endpoints exist on the diagnostics resource.**

## 7. Authorization

- Route policy: both GETs and the recovery POST fall under the existing `RoutePolicyRegistry` block for `/api/v1/internal/limit-*` → `WORKFORCE_SESSION`, `allowedPrincipalTypes: ['OPERATOR','SERVICE','PRIVILEGED']`, customer/agent/aggregator access NONE. SUPPORT is therefore excluded (the limit- block is a strict subset of generic internal, which does allow SUPPORT).
- Controller defense-in-depth: `requireWorkforce` (OPERATOR/SERVICE/PRIVILEGED) on both GETs; `requirePrivileged` (PRIVILEGED only) on the recovery POST.
- Verified by tests: OPERATOR/SERVICE/PRIVILEGED → 200; SUPPORT → 403; CUSTOMER/AGENT tokens → 401/403; no auth → 401; OPERATOR/SERVICE on the recovery POST → 403.
- Inspected conventions before deciding: the limit catalogue/assignment routes (V1-LIMIT-01/02) already use this exact workforce-only pattern; SUPPORT is not permitted by any existing authoritative operational policy for limit surfaces, so it remains excluded.

## 8. Safe projection

- `request_hash` (internal hash of the originating request payload) is **never returned**; tests assert its absence from all diagnostics payloads.
- No secrets, credentials, or database-only internals beyond operationally necessary fields (ids, counters, window bounds, correlation/idempotency references, lifecycle timestamps, version for optimistic inspection).
- The idempotency key is exposed as an operator-supplied correlation reference (safe: it is caller-provided and already used operationally across the repository).
- All diagnostics queries are SELECT-only; a dedicated test checksums `limit_usages`, `limit_reservations`, and `ledger_lines` before/after repeated diagnostics calls and asserts zero change.

## 9. Reservation recovery design

**Automatic reaping: BLOCKED (reported, not implemented).** What was implemented instead is a safe operational/manual boundary:

`POST /api/v1/internal/limit-reservation-recovery/release` (PRIVILEGED-only, mandatory reason ≥ 10 chars, audited):
- RELEASED is the **only** transition performed;
- COMMITTED → 409 immutable; RELEASED → idempotent `ALREADY_RELEASED` acknowledgement; missing → 404;
- SERIALIZABLE + `SELECT ... FOR UPDATE` on the reservation row and its usage row → exactly-once semantics under concurrency;
- decrements reserved counters with underflow guards (refuses to mutate on inconsistency);
- writes an audit event (`entityType: limit_reservation`, `action: MANUAL_RELEASE`, actor, reason) inside the same transaction;
- never touches the financial ledger; never DELETEs; never rewrites history.

The stale threshold (`LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES`, default 30) is **diagnostics-only**: it flags candidates for human investigation. The repository/product requirements do not establish 30 minutes as a business rule for any automatic action, so it is configuration-driven and documented purely as an operational default for flagging.

## 10. Orphan-detection logic

Investigation performed (per the task instruction to determine exactly how a reservation can become orphaned):

1. **All 8 wired flows execute the full reservation lifecycle inside ONE transaction.** `enforceWithManager` (reserve) → ledger posting → `commitReservationsWithManager` / `releaseReservationsWithManager` all run on the flow's own SERIALIZABLE `EntityManager`. A crash or abort rolls back the reservation rows together with the journal — there is no window where a RESERVED row can outlive its transaction.
2. **No background jobs, async financial processors, schedulers, or external-provider legs exist** in the repository that could hold a reservation open across process boundaries (no `@nestjs/schedule` usage anywhere in `src`).
3. **No authoritative cross-product correlation-terminal-state exists.** Reservations carry a free-form `correlation_id` string, but there is no single table mapping every correlation to a terminal financial status across all 8 products — so no program can prove, from repository state alone, that a RESERVED row is orphaned while some financial operation is legitimately processing.

**Conclusion:** a stale timestamp alone is NOT sufficient, and the repository does not contain the authoritative state to prove orphaning. Per the task's explicit fallback, V1-LIMIT-05 implements diagnostics + a manual operational boundary and **reports the blocker for automatic reaping** (registered in the capability registry as `LIMIT_RESERVATION_RECOVERY`, lifecycle BLOCKED, blocker type PRODUCT_DECISION).

## 11. Concurrency / reaper behavior

- **No reaper exists** — therefore no concurrent-reaper race is possible; test 09 of the recovery suite asserts that a 7-day-old RESERVED reservation survives every diagnostics query untouched (automatic-reaping guard).
- **Concurrent manual releases** are safe by construction: `SELECT ... FOR UPDATE` row locking inside SERIALIZABLE with a bounded retry loop (40001/40P01). Tested with 3 concurrent releases: exactly one `RELEASED`, others `ALREADY_RELEASED`, counters decremented exactly once, exactly one audit event.
- **Concurrent financial flows** continue to honor V1-LIMIT-03/04 semantics: boundary tests prove exactly floor(limit/amount) commits under `Promise.all`, with reserved counters back to 0 afterwards.
- All flow services retain their existing SERIALIZABLE retry loops (`MAX_SERIALIZABLE_ATTEMPTS`); the matrix additionally emulates an idempotent API client retrying SERIALIZABLE aborts.

## 12. Failure-code changes

`TransferFailureCode` (src/transfer/transfer.enums.ts) extended **additively** with the established stable union — no renames, no removed members:

```
LIMIT_MIN_AMOUNT_NOT_MET        LIMIT_DAILY_COUNT_EXCEEDED     LIMIT_WALLET_BALANCE_EXCEEDED
LIMIT_MAX_AMOUNT_EXCEEDED       LIMIT_WEEKLY_COUNT_EXCEEDED    LIMIT_PROFILE_MISSING
LIMIT_DAILY_AMOUNT_EXCEEDED     LIMIT_MONTHLY_COUNT_EXCEEDED   LIMIT_RULE_INVALID
LIMIT_WEEKLY_AMOUNT_EXCEEDED    LIMIT_YEARLY_COUNT_EXCEEDED    LIMIT_CONFIGURATION_INVALID
LIMIT_MONTHLY_AMOUNT_EXCEEDED                                  LIMIT_RESERVATION_FAILED
LIMIT_YEARLY_AMOUNT_EXCEEDED
```

- Persistence unchanged: `transfers.failure_code VARCHAR(64)` already accepts these strings (verified: W→W limit failures persist `LIMIT_MIN_AMOUNT_NOT_MET`).
- New `limitCodeToTransferFailureCode(code)` returns the typed member or `null`, so the transfer service no longer relies on `code as any` and never widens the contract implicitly.
- A matrix test asserts every `LimitFailureCode` value exists verbatim in `TransferFailureCode` (type-coverage requirement).

## 13. Capability registry changes

| Capability | Lifecycle | enabled | Notes |
|---|---|---|---|
| LIMIT_USAGE_DIAGNOSTICS (new) | FULLY_ENABLED | true | workforce-only read-only GET, safe projection, deterministic pagination |
| LIMIT_RESERVATION_DIAGNOSTICS (new) | FULLY_ENABLED | true | incl. stale flag (configurable threshold, diagnostics-only) |
| LIMIT_RESERVATION_RECOVERY (new) | **BLOCKED** | false | blockerType PRODUCT_DECISION; blockerDescription records the orphan-proof gap; manual PRIVILEGED-only boundary implemented & tested |
| LIMIT_ENGINE, CUSTOMER_RUNTIME_LIMITS, AGENT_RUNTIME_LIMITS | unchanged (FULLY_ENABLED v5) | true | accurately reflect V1-LIMIT-04; only test/documentation references extended where the seed entries already pointed at the limit reports |
| COMMERCIAL_DECISION_SNAPSHOT | unchanged (PLANNED) | false | untouched |

Nothing was marked fully enabled merely because diagnostics exist: recovery is honestly BLOCKED pending an operational policy + authoritative correlation state.

## 14. Exact test results

Real PostgreSQL 18.4 (embedded, 127.0.0.1:5432), `--runInBand`, NODE_ENV=test.

| Suite | Result |
|---|---|
| v1-limit-05-flow-matrix (NEW) | **205/205 PASS** (30.6 s) |
| v1-limit-05-diagnostics (NEW) | **11/11 PASS** (13.5 s) |
| v1-limit-05-recovery (NEW) | **9/9 PASS** (12.6 s) |
| v1-limit-01 + 02 + 03 + 04 + capability-registry | **99/99 PASS** |
| **Full integration suite** | **50 suites, 1156/1156 PASS** (563.0 s) — baseline was 47 suites / 931 tests |
| Unit suite | 1764/1766 — the 2 failures are the **pre-existing** `external-reconciliation.service.spec.ts` failures already identified against the verified V1-LIMIT-04 baseline (re-confirmed: identical suite, identical count; not touched by this task) |

Concurrency coverage: boundary Promise.all on all 8 flows; concurrent duplicate idempotency (V1-LIMIT-04 suite re-run); concurrent manual releases (recovery suite).

## 15. tsc / build / lint

- `tsc --noEmit`: **0 errors**.
- `npm run build` (nest build): **exit 0**.
- eslint on changed files: all new files clean; `transfer.service.ts` shows 4 pre-existing-style `any` errors in the unchanged exception-parsing block — the base file had **6** in the same region, so the typed failure-code change reduced lint errors by 2. The repository is not lint-clean at the verified base; no new error classes introduced.

## 16. Financial safety

Verified by test, per requirement:

| Property | Evidence |
|---|---|
| No ledger mutation from diagnostics | checksum of `ledger_lines`/`ledger_journals` unchanged across repeated GETs (diag test 09) |
| No balance mutation from diagnostics | same checksum; diagnostics are SELECT-only by construction |
| No duplicate reservation | idempotent-replay cases on all 8 flows (consumed exactly once); V1-LIMIT-04 28-case suite re-run green |
| No duplicate commit | commit-on-success cases assert all reservations COMMITTED with reserved counters 0 |
| No unauthorized release | recovery route 403 for OPERATOR/SERVICE/SUPPORT/no-auth; validation failures leave rows RESERVED (recovery tests 05/08, diagnostics test 11) |
| COMMITTED immutable | 409 refusal; usage untouched (recovery test 02) |
| RELEASED protection | idempotent acknowledgement, no double decrement (recovery test 03) |
| Failed transactions do not consume | failed-financial-execution cases on all 8 flows; V1-LIMIT-04 case 20 |
| Successful transactions retain committed usage | within-limit/commit cases on all 8 flows |
| Idempotent replay does not consume twice | replay cases on all 8 flows |
| Stale age never auto-releases | 7-day-aged RESERVED row survives all diagnostics queries (recovery test 09) |
| Released allowance restored | reserve → release → reserve again succeeds (recovery test 07) |

The financial meaning of a successful transaction is unaltered: no flow code paths were touched except the typed failure-code mapping in `TransferService` (string values identical).

## 17. Unresolved operational/product decisions

- **UD-10: automatic reservation reaping.** Requires (a) an operational policy decision, and (b) authoritative cross-product correlation-terminal-state (e.g., a durable operation-state table mapping every correlation id to terminal status) before any automated release can be proven safe. Registered as BLOCKED/PRODUCT_DECISION in the capability registry.
- **UD-11: maker-checker for manual releases.** The manual boundary currently requires a single PRIVILEGED actor + mandatory reason + audit. Whether releases should additionally flow through the workforce maker-checker configuration is an operational policy decision.
- **UD-12: SUPPORT visibility of limit diagnostics.** SUPPORT remains excluded (consistent with all existing limit surfaces). If support tooling needs read access, an authoritative policy change to the RoutePolicyRegistry limit- block would be required.
- **UD-13: stale threshold default.** 30 minutes is an operational diagnostic default (env-configurable), not a business rule — no repository/product requirement establishes a reaping window.

## 18. Known limitations

- **L-09:** Diagnostics pagination is offset-based (consistent with repository patterns); extremely deep pages are not cursor-optimized.
- **L-10:** `windowFrom`/`windowTo` filter on `window_start`; there is no separate "captured at" filter beyond `created_at` ordering.
- **L-11:** The manual recovery endpoint releases one reservation at a time (by design — human-in-the-loop). Bulk release is deliberately not provided.
- **L-12:** MFA-guarded flows (Wallet→Cash, C2C claim) are concurrency-tested at 3-way only, matching the repository's existing MFA concurrency conventions; the MFA layer (single active enrollment per customer, one-time OTPs) is the limiting factor, not the limit engine.
- **L-13:** The matrix creates fresh principals per test instead of truncating between tests (isolation by identity), keeping the 205-test suite at ~30 s; table schemas are exercised by the other suites which truncate.

## 19. Exact next recommended task

**V1-COMMERCIAL-SNAPSHOT-01 — Commercial Decision Snapshot Foundation (PLANNED → designed/implemented)** — or, if limits must be fully closed out first, the natural limit follow-up is:

**Recommended: V1-LIMIT-06 — Authoritative Correlation State & Recovery Operationalization**
1. Introduce an additive migration creating a durable `limit_operation_states` (or reuse outbox-style) table mapping `correlation_id → product → terminal status`, written by the 8 wired flows inside their existing SERIALIZABLE transactions.
2. Re-evaluate automatic reaping against real authoritative state (bounded batch, `FOR UPDATE SKIP LOCKED`, audit, RELEASED-only) — still gated on the UD-10 product decision.
3. Wire maker-checker (UD-11) over the manual release boundary using the existing workforce `makerCheckerRules` configuration.
4. Extend diagnostics with correlation-state joins so operators see terminal status alongside each RESERVED reservation.

Constraints for either task: continue from the verified V1-LIMIT-05 HEAD; do not redesign V1-LIMIT-01..05; do not implement fees/commissions/rewards unless that task explicitly is the Commercial Decision Snapshot; keep the capability registry truthful.
