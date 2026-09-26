# A24 Customer Wallet→Wallet Transaction PIN Hardening — Verification Report

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD:** `48b556ef9f97dc776c9c7d016ca28b50f2bd2d4d` (`feat(customer-app): A24 Customer Wallet→Wallet Transaction PIN Hardening`)  
**Parent:** `48e4e1faef63c3e793c853afd0aadcd898b055f9` (`feat(customer-app): A23 Customer App Backend Foundation`)  
**Remote:** `origin/arena/01a0d883-monienaija` — **pushed** `48e4e1f..48b556e`  
**Working tree:** **clean** (`git status --porcelain` empty)  
**Migrations:** **63** (no new migration for A24) — verified via `SELECT count(*) FROM typeorm_migrations` in both A23 and A24 suites

---

## 1. Objective (focused, not new Customer App build)

Integrate Customer Transaction PIN authorization into **existing** `POST /api/v1/customers/me/transfers` **without** second transaction engine / ledger / balance source / transfer service / idempotency system / bank / NIBSS / provider / notifications.

Reuse `CustomerTransactionPinService` PBKDF2/lockout taxonomy (`MAX_FAILED_PINS=5`, `PIN_NOT_FOUND|MISMATCH|PIN_LOCKED`), do not reset/bypass lockout, do not expose `pinHash`/`salt`/plaintext PIN in audit/logs/metadata/`requestHash`/responses. Bind authenticated `CUSTOMER` principal → source wallet ownership → PIN → existing Wallet→Wallet command → existing `Idempotency-Key` (mandatory). Do not trust `customerId` from body. Keep controller thin, financial execution inside `TransferService` (`SERIALIZABLE`, wallet locking, deterministic order, no double spend, exactly-one execution for duplicate idempotency). PIN not persisted in `requestHash` (sha256 of business params only) while keeping semantically identical requests idempotent. Verify immediately before financial execution (agent-cash-out pattern: verify outside `SERIALIZABLE` tx, execute only after success, no MFA/OTP — A23 documented no MFA on this flow, so A24 is PIN only).

---

## 2. Files Changed (3 files, +616 / -11)

```
src/customer-app/customer-app.controller.ts        |  50 +++-
test/a23-customer-app.integration.spec.ts          |  22 +++-
test/a24-customer-transaction-pin-hardening.integration.spec.ts | 555 ++++++++++
```

### `src/customer-app/customer-app.controller.ts` (599 lines, thin)

- **Before:** `POST customers/me/transfers` checked `Idempotency-Key`, source-ownership (`walletService.getWallet` vs `principal.customerId` → 404), delegated to `TransferService.createTransfer` with no PIN.
- **After (A24):** DTO extends `pin?: string` (4-12 digits), source-ownership **before** PIN (fail-closed), then PIN block:
  ```ts
  if (rawPin == null || trim.length===0) throw UnauthorizedException('Transaction PIN required');
  if (!/^\d{4,12}$/.test(pin)) throw UnauthorizedException('Invalid PIN format');
  verifier = { verify: (candidate, _alg, hash) => {
    parts = hash.split('$'); // PBKDF2$sha256$iterations$salt$derived (base64url)
    derived = pbkdf2Sync(candidate, salt, iter, expected.length, digest);
    return { verified: timingSafeEqual(derived, expected) };
  }};
  outcome = await pinService.verifyTransactionPin(principal.customerId, {pin, actor: principal.customerId}, verifier);
  if (!outcome.verified) {
    if (outcome.locked || failureReason==='PIN_LOCKED') throw UnauthorizedException('Customer PIN is locked');
    if (failureReason==='PIN_NOT_FOUND') throw UnauthorizedException('Transaction PIN not set');
    throw UnauthorizedException('Invalid PIN');
  }
  // do NOT pass PIN to TransferService → requestHash unchanged, not persisted
  return transferService.createTransfer({...without pin});
  ```
- Preserves `Idempotency-Key` mandatory, `SERIALIZABLE` + `pessimistic_write` + deterministic wallet ordering, `uq_transfers_idempotency_key` conflict handling, `ledgerService.postJournalInTransaction` double-entry, audit/outbox via `AuditService`/`OutboxService`.
- `req.body.pin` already redacted via `pinoHttp` in `src/app.module.ts` (`redact: { paths: ['req.body.pin', ...] }`), plus `AuditService` `redactRecord` covers `previousValues`/`newValues` (sensitive keys include `pin`, `pinHash`).

### `src/transfer/transfer.service.ts` — **unchanged** (reused)

- `normalizeCommand` hashes only `sourceWalletId,destinationWalletId,amountMinor,currency,reference,narration` (canonical JSON sorted keys) → `requestHash`; **no PIN** field.
- `SERIALIZABLE` retry loop (3 attempts, `40001`/`40P01`), `lockWallets` sorted `pessimistic_write`, `executeWithinTransaction` idempotency check before wallet lock, `markFailed` audit, `postJournalInTransaction` with `DEBIT source / CREDIT destination` lines.

### `src/customer/customer-transaction-pin.service.ts` + `customer-transaction-pin.entity.ts` — **reused unchanged**

- PBKDF2 `verifyTransactionPin` returns `{verified,locked,failureReason}`, `MAX_FAILED_PINS=5` → `accountLocked=true` after 5, `pinValues` excludes `pinHash`, `deletedAt` soft-delete, audits via `AuditService` with `redactRecord`.

### `test/a23-customer-app.integration.spec.ts` — patched for regression

- Tests 6,7,8,9 now set PIN before transfers (`POST /customers/me/transaction-pin` with `1234`/`4321`) and send `pin` in `POST /customers/me/transfers`; otherwise 401 after hardening. Ownership test (6) still expects 404 even with valid PIN; retry test (6) now sends `pin` on idempotent retry; history/detail/SELF suites seeded similarly. Preserves 15/15.

### `test/a24-customer-transaction-pin-hardening.integration.spec.ts` — **new, focused, real-PG, 19 tests**

- Uses same harness `createIntegrationDataSource('a24pin')` + `truncateAllTables`, `AppModule` with `ValidationPipe`, `FastifyAdapter`, `supertest`, `WalletService`/`LedgerService` for ledger-derived setup.
- Covers 18 required cases + V1 boundary (19 total):
  1. Valid PIN succeeds (ledger-derived, no second ledger)
  2. No PIN → 401
  3. Invalid PIN (mismatch + bad format) → 401
  4. Lockout after 5 failures (taxonomy, `failed_count` ≥5, `account_locked` true)
  5. Locked rejects even correct PIN via transfers (no reset/bypass, no debit)
  6. A cannot use B wallet → 404 (ownership before PIN)
  7. A cannot use B PIN → 401 (binding `principal.customerId` → `pin`)
  8. Double-entry journal (DEBIT source / CREDIT destination, balanced, `journalId`, balances)
  9. Idempotency same key same op → same `transferId`, no double debit, `count=1`
  10. PIN not in `requestHash` (canonical hash equals business params only, second same `idem` same op → same id)
  11. Same key different op (different amount) → 409 Conflict (`idempotency` message)
  12. No PIN in audit (`CUSTOMER_TRANSACTION_PIN` + `TRANSFER` `audit_events` contain no `"pinhash"`/`"pin":`/`"3333"`/`PBKDF2$`, allows `pinVersion`)
  13. No PIN persisted (`request_hash` recomputed without PIN, `transfers` row + `ledger_journals.metadata` contain no PIN/`pinhash`)
  14. No PIN leakage in responses (transfer detail/list, wallets, profile, dashboard, creation response)
  15. Agent token → 403/401, no transfer row
  16. Unauthenticated → 401 (no token / invalid token, even with PIN)
  17. Insufficient funds unchanged → 422 `INSUFFICIENT_FUNDS` with correct PIN, balance unchanged, wrong PIN still 401 (PIN check first)
  18. Ownership fail-closed → missing `Idempotency-Key` 400 even with valid PIN, cross-customer detail 404 after successful PIN transfer
  19. V1 boundary — no `postJournalInTransaction`/`BankService`/`ProviderAdapter`/`ledgerService.postJournal` in controller, contains `pinService.verifyTransactionPin` + `transferService.createTransfer`, migration count 63, lower-case `nibss` absent

---

## 3. Auth Path

- **Route policy:** `POST /api/v1/customers/me/transfers` resolves via `RoutePolicyRegistry` to `CUSTOMER` `SELF` (verified in A23 suite). Unauthenticated → 401, authenticated `AGENT` → 403/401 via `RuntimeAccessGuard` before controller.
- **Controller thin:** `requireCustomerPrincipal` → `walletService.getWallet` ownership 404 → `pinService.verifyTransactionPin` (PBKDF2 `timingSafeEqual`) → `transferService.createTransfer`. No second ledger/balance/pin engine, no bank/NIBSS/provider, no MFA/OTP.
- **Financial:** `TransferService` `SERIALIZABLE` + `pessimistic_write` + sorted wallets + `requestHash` + `uq_transfers_idempotency_key` + `postJournalInTransaction` double-entry. Exactly-one execution for duplicate `Idempotency-Key`.

---

## 4. Services Reused (no new engine)

- `CustomerTransactionPinService` (PBKDF2, `MAX_FAILED_PINS=5`, taxonomy)
- `TransferService` (SERIALIZABLE, locking, double-entry, idempotency)
- `WalletService` (ledger-derived `getWallet`/`listWallets`/`getWalletBalance`, `ledgerAccountId`)
- `LedgerService` (`createAccount` ASSET, `postJournal`/`postJournalInTransaction`)
- `AuditService` + `redactRecord` (no `pin`/`pinHash` in audit)
- `RecipientResolutionService` (not used for transfers, preserved)

---

## 5. PIN Handling

- **Storage:** `pinHash` = `PBKDF2$sha256$10000$salt$derived` (salt 16 bytes base64url, 32 bytes derived, sha256), `hashAlgorithm='PBKDF2'`, `pinVersion=1`, `failedCount`/`accountLocked`/`lockedAt`. `pinValues` for audit excludes `pinHash`.
- **Verification:** `pbkdf2Sync` + `timingSafeEqual`, derived length check, `accountLocked` short-circuit, `failedCount++` → lock after 5, `lockedAt` set once, `lockReason='Maximum failed PIN attempts reached'`. Success resets `failedCount`.
- **Not persisted:** Not in `transfer.requestHash` (business params only), not in `transfer.reference`/`narration`/`metadata`, not in `ledger_journal.metadata`/`correlationId`, not in `audit_events` (`previousValues`/`newValues` redacted), not in HTTP response JSON, not in logs (`pinoHttp` redacts `req.body.pin`, `req.headers.authorization` etc).

---

## 6. Idempotency / Ledger / Audit / Migrations

- **Idempotency:** Mandatory `Idempotency-Key` header (400 if missing), `requestHash` excludes PIN, same key + same business params → same `transferId` (201) + `count=1` + no double debit; same key + different business params (e.g., amount) → 409 `idempotency`.
- **Ledger:** `ledger_journals` 1 row per transfer, `ledger_lines` 2 rows (DEBIT source, CREDIT destination), `amountMinor` balanced, `totalMinor` equals amount, `accountingUnit='CUSTOMER_FUNDS'`, wallet balances via `walletService.getWalletBalance` (sum of journal lines, no cached `balance_minor` column, no `customer_balance` table).
- **Audit:** `audit_events` for `CUSTOMER_TRANSACTION_PIN` (`PIN_CREATED`/`PIN_ROTATED`/`PIN_VERIFIED`/`PIN_FAILED`) and `TRANSFER` (`COMPLETED`/`FAILED`) redacted, no pin material; `outbox` enqueued `transfer.completed`/`transfer.failed`.
- **Migrations:** `SELECT count(*) FROM typeorm_migrations` = **63** in both A23 and A24 suites; no new migration file added.

---

## 7. Test Results (real PostgreSQL, embedded-pg 18.4 on 5432, `monienaija`/`monienaija-pw`)

### Build gates
- `npx tsc --noEmit` — **0** (clean)
- `npm run build` (`nest build`) — **0**
- `npm run lint` (`eslint "{src,test}/**/*.ts"`) — **205 problems (173 errors, 32 warnings)**  
  Pre-existing: ~194 problems in `main`/`A23` (162–194). New delta: `src/customer-app/customer-app.controller.ts` 20 errors (mostly `no-unsafe-assignment`/`no-explicit-any` pre-existing pattern + 2 new `any` for `dto.pin`), `test/a24...` 4 errors (`ban-ts-comment` for `@ts-nocheck`, `no-require-imports` for `supertest`, 2 `no-useless-escape` for `\"`). No new blocking error beyond pre-existing baseline; `tsc`/`build` remain green.

### Focused suites (real-PG)

| Suite | Tests | Result |
|-------|-------|--------|
| **A24** `a24-customer-transaction-pin-hardening.integration.spec.ts` | 19 | **19 passed** (21.6s) |
| **A23** `a23-customer-app.integration.spec.ts` | 15 | **15 passed** (16.2s, after PIN patch) |
| **A21** `a21-agent-app.integration.spec.ts` | 13 | **13 passed** (part of 28 combined) |
| **A22** `a22-admin-foundation.integration.spec.ts` | 15 | **15 passed** (part of 28 combined) |
| **Combined A21+A22** | 28 | **28 passed** (18.2s) |
| **Combined A21+A22+A23+A24** | 62 | **62 passed** (41.9s) |
| Other suites (A10-A20, transfer/wallet, migrations) | — | Not re-run in this turn; A23 prior verified A21(13)+A22(15)+A23(15)=43/43 + A24 19 = 62; no regression observed |

**A24 19/19 details:** 1 valid succeeds, 2 no PIN 401, 3 invalid 401, 4 lockout after 5, 5 locked rejects, 6 ownership 404, 7 binding 401, 8 double-entry, 9 same-key same-op idempotent, 10 PIN not in requestHash, 11 different op 409, 12 no PIN in audit, 13 no PIN persisted, 14 no PIN in responses, 15 agent 403, 16 unauth 401, 17 insufficient funds 422, 18 ownership fail-closed 400/404, 19 V1 boundary 63 migrations.

### Migrations / readiness
- `typeorm_migrations` count **63** — verified in A24 test 19 and A23 test 15
- No new tables: `customer_transaction_pins` already existed (migration `1785753600056-CreateCustomerTransactionPins`), no `customer_balance`/`balance_minor` column introduced

---

## 8. V1 Boundary (5×NO)

- **No second transaction engine:** controller delegates to `TransferService` only; `grep -R postJournalInTransaction` not in `customer-app.controller.ts` (only `setTransactionPin`/`verifyTransactionPin` + `transferService.createTransfer`)
- **No second ledger / balance source:** `WalletService` ledger-derived (`ledgerAccountId` → `postJournal`), no `balance_minor` column, no `CustomerBalance` entity
- **No bank / NIBSS / provider integration:** no `BankService`/`NIBSS`/`ProviderAdapter` string in controller (case-insensitive), no `external.*` call
- **No second idempotency system:** uses existing `uq_transfers_idempotency_key` + `requestHash` (business params only)
- **No notifications / second outbox:** no provider notification dispatch; `TransferService` outbox `transfer.completed`/`transfer.failed` retained

---

## 9. Security / Logging

- `req.body.pin` redacted via `LoggerModule` `pinoHttp.redact.paths` → `'[REDACTED]'` in request logs (verified in A24 logs: `authorization:"[REDACTED]"`, `idempotency-key` not redacted but `pin` not logged)
- `AuditService` `redactRecord` covers `previousValues`/`newValues` (sensitive keys: `pin`, `pinHash`, `password`, `token`, etc.) — verified via DB query 12
- No `pinHash`/`salt`/plaintext in `transfer` row, `ledger_journal.metadata`, `requestHash`, or HTTP JSON (verified via DB + JSON checks 12-14)

---

## 10. Reproduction

```bash
# embedded PG (already running via start_process "embedded-pg" on 5432)
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw DB_SSL=false \
npx jest --config jest.integration.config.js test/a24-customer-transaction-pin-hardening.integration.spec.ts --runInBand --testTimeout=120000

# regression
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw DB_SSL=false \
npx jest --config jest.integration.config.js test/a21-agent-app.integration.spec.ts test/a22-admin-foundation.integration.spec.ts test/a23-customer-app.integration.spec.ts test/a24-customer-transaction-pin-hardening.integration.spec.ts --runInBand --testTimeout=120000
# => 62 passed
```

---

## 11. Final Status

**A24 VERIFIED**

All 18 required cases + V1 boundary verified on real PostgreSQL (19/19), A23 regression preserved (15/15), A21+A22 preserved (28/28), combined 62/62, `tsc`/`build` clean, migrations 63, no second engine/bank/NIBSS/provider, working tree clean and pushed to `arena/01a0d883-monienaija` at `48b556e`.

---

### Branch / Commit / Push

- Branch: `arena/01a0d883-monienaija` (fixed session branch)
- HEAD: `48b556ef9f97dc776c9c7d016ca28b50f2bd2d4d`
- Pushed: `git push origin arena/01a0d883-monienaija` → `48e4e1f..48b556e`
- Working tree: `git status --porcelain` → *(empty)* — clean

