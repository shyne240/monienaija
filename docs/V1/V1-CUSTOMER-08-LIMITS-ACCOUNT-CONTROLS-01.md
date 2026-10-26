# V1-CUSTOMER-08 — Customer Limits & Account Controls: Audit + Completion Report

**Starting HEAD:** `69da01b1b12fa6cbf4c1f908c8d0ae925ec09d5c` (docs commit closing V1-CUSTOMER-07)
**Final HEAD:** `c94a7f481ad6ce07591ffbd67b70e6bcd8d69e53`
**Branch:** `arena/01a10374-monienaija`
**Commits added this task:**
- `c94a7f4` — `feat(customer): complete limits and account controls`

No separate docs commit; this report is included in the same working tree and will be committed with the session's final state.

---

## 0. Why this report starts with a correction

The task explicitly states that a prior historical Customer Mobile gap-audit report claiming limits display and several account-control items were "missing" is **not authoritative**, and instructs auditing the actual repository at `69da01b` before writing any code. That audit was performed first (documented in full below) and it found a **more nuanced reality** than either "fully missing" or "fully present": the backend already has a complete, real, DB-backed limits-enforcement engine, but **no customer-safe way to read it existed**, and Customer Mobile already fetched (but silently discarded) two relevant fields. The work below is scoped exactly to the gaps that audit actually found.

---

## 1. Part A — Customer Limits Audit (backend)

### 1.1 Two limit systems exist in `src/`

| System | Status | Evidence |
|---|---|---|
| `src/limit/` (`LimitEngine`, `POST /limits/evaluate`, `LimitModule`) | **Dead/legacy.** A stateless calculator that takes all limit values and current usage as request-body input — it never reads actual customer data. | `grep -rln "LimitEngine" src/` → only its own files + a descriptive string in `src/capability-registry/capability.seed.ts` which itself documents it as superseded ("...runtime Allow/Reject wired via TransferService/Agent flows (enforceWithManager...)"). `grep -rn "limits/evaluate" src/ test/ apps/` → **zero matches** anywhere in the codebase. Left untouched; out of scope. |
| `src/limit-catalog/` | **The real, authoritative, DB-backed V1 limit system.** | `limit-profile.entity.ts`, `limit-rule.entity.ts`, `limit-assignment.entity.ts`, `limit-usage.entity.ts`, `limit-reservation.entity.ts`, `limit-profile-resolver.service.ts`, `limit-enforcement.service.ts` (581 lines), migrations `1785753600067/068/069`. |

### 1.2 How limits are represented and enforced

`LimitProfileResolverService.resolve()` resolves exactly one applicable `limit_profiles` row per principal via `limit_assignments`, matching `GLOBAL` (always a candidate) → `SEGMENT` → `AGENT_CLASS` → `CUSTOMER`/`AGENT`, ordered by `precedence DESC, effective_from DESC, created_at DESC`, filtered by `is_active`/`effective_from`/`effective_to`. **No hardcoded KYC/tier logic.** If nothing matches (or the matched profile is disabled/missing), it returns `null`, which `LimitEnforcementService` treats as **unlimited (permissive, not blocking)**.

`LimitEnforcementService.enforceWithManager()` — called inside the **same SERIALIZABLE ledger transaction** as the financial operation — evaluates, per matching active `limit_rules` row:

1. **`MIN_AMOUNT_PER_TX` / `MAX_AMOUNT_PER_TX`** — immediate per-transaction check, no window, no usage tracking.
2. **`WALLET_BALANCE_MAX`** — authoritative, live ledger balance (summed from `ledger_lines`) + projected amount; only enforced on `INCOMING`/`BOTH` (an `OUTGOING` transaction only decreases balance, so it's never blocked by this dimension).
3. **Windowed dimensions** (`DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` × `AMOUNT`/`COUNT`) — tracked per unique key `(principal_type, principal_id, limit_profile_code, product, direction, channel, dimension, currency, window_key)` in `limit_usages`, with a reserve → commit/release lifecycle:
   - On enforcement, the usage row is locked `FOR UPDATE`, checked `used + reserved + delta > limit`, and a `limit_reservations` row is inserted (`RESERVED`) — **pending/in-flight transactions DO hold capacity**.
   - `commitReservationsWithManager()` (called after financial success) moves `reserved → used` — **only successful transactions become permanently "used."**
   - `releaseReservationsWithManager()` (called after financial failure) decrements `reserved` back down — **failed transactions never consume usage.**
   - Idempotent via `idempotencyKey`/`requestHash`; replays return `{allowed:true, reserved:{kind:'REPLAY'}}` without double counting.

### 1.3 The five customer-facing product/direction buckets (exhaustively traced)

`grep -rn "enforceWithManager(" src/` (excluding self/spec files) found exactly 6 call sites. Five are customer-facing (`principalType: 'CUSTOMER'`); one is agent-only:

| Flow | File (line) | `product` | `direction` | `principalType` |
|---|---|---|---|---|
| Send to another wallet | `transfer.service.ts` (~328) | `WALLET_TRANSFER` | `OUTGOING` | `CUSTOMER` (sender) |
| Agent gives cash, customer wallet credited | `agent-cash-in.service.ts` (~178) | `CASH_TO_WALLET` | `INCOMING` | `CUSTOMER` (recipient) |
| Customer wallet debited, agent pays cash | `agent-cash-out.service.ts` (~292) | `WALLET_TO_CASH` | `OUTGOING` | `CUSTOMER` |
| Customer claims a Cash-to-Cash transfer | `agent-cash-to-cash-claim.service.ts` (~403) | `CASH_TO_CASH` | `INCOMING` | `CUSTOMER` (claimant — the **only** customer-facing C2C limit; creation-side is agent-only) |
| Approved wallet funding | `customer-funding.service.ts` (~350) | `CUSTOMER_FUNDING` | `INCOMING` | `CUSTOMER` |
| Agent initiates C2C (gives cash) | `agent-cash-to-cash.service.ts` (~348) | `CASH_TO_CASH` | `OUTGOING` | `AGENT` — **not customer-facing**, excluded |

`product` is part of the `limit_usages` uniqueness key, so **these five buckets are isolated by construction** — a transaction against one product never consumes another product's usage, unless an operator deliberately configures a rule to span multiple products (not observed anywhere in this repo).

### 1.4 Critical fact: no limits are currently configured anywhere in this build

`grep -rln "INSERT INTO limit_profiles\|INSERT INTO limit_rules\|INSERT INTO limit_assignments" src/ scripts/` → **zero matches**. No seed script, no bootstrap, nothing populates these tables. `LimitProfileResolverService.resolve()` will therefore return `null` for every customer in a fresh environment, and `enforceWithManager()` will allow every transaction with zero rules evaluated. **As shipped in this repository, V1 enforces no transaction limits on any customer** — the engine is fully wired and ready, but unconfigured. This is architecturally intentional (`capability.seed.ts`: "generic catalogue only... arbitrary unbounded codes (not fixed Tier 1/2/3)... assignment deferred"), not a bug. The new customer-facing API (§3) reflects this honestly — it reports `configured: false` for every product until an operator configures real policy via the existing internal `/internal/limit-*` admin APIs.

### 1.5 Does a customer-safe API already exist? (Part A items 6–9)

No. `src/limit-catalog/limit-catalog.controller.ts`, `limit-assignment.controller.ts`, and `limit-operations.controller.ts` are **all** mounted under `@Controller('internal')`, and `route-policy-registry.ts` routes every `/api/v1/internal/limit-*` path to `authenticationMode: 'WORKFORCE_SESSION'` (staff/ops only — see line 431). There is no `/me`-scoped limits endpoint anywhere pre-existing. `grep -n "CustomerLimitViewService\|limits" src/customer-app/customer-app.controller.ts` on the pre-task tree returned nothing — Customer Mobile had **zero** way to see applicable limits, configured policy, current usage, or remaining capacity. This is the one genuine gap under Part A, closed in §3.

### 1.6 A second, separate, legacy "limits" concept — correctly left alone

`src/customer-eligibility/customer-limit-profile.entity.ts` defines `CustomerLimitProfile` (`customer_limit_profiles` table: per-customer daily/single/monthly amount + wallet-balance cap). This looked, at first glance, like it might be the authoritative source. It is not:

- `grep -rln "CustomerLimitProfile\b" src/` shows it is referenced **only** by its own module and by `src/policy/capability-policy-evidence.adapters.ts` / `capability-policy-source-readers.ts` — a **read-only evidence/explanation** adapter for the capability-policy decision-audit trail, never part of the actual enforcement path.
- `capability.seed.ts` explicitly documents it: *"V1-LIMIT-02: generic assignment only... legacy customer_limit_profiles & AgentClass.applicableLimits preserved read-only, no auto-migration."*
- `grep -rn "customer_limit_profiles" src/customer-registration/` → zero matches. Nothing in the real customer-registration/activation flow ever creates one; it can only be created via the internal `POST /customers/:id/limit-profile` admin route.

**Conclusion: legacy, ops-only, not authoritative, not customer-facing. Correctly left untouched.**

---

## 2. Part B — Do Not Leak Internal Policy (design constraint honored)

The new `GET /customers/me/limits` endpoint (full contract in §3) projects **only**:
- `product`, `direction`, `currency`
- `configured` (boolean)
- `perTransactionMinMinor` / `perTransactionMaxMinor`
- `walletBalanceMaxMinor` (only ever populated for `INCOMING` products, mirroring enforcement)
- `windows[]`: `dimension`, `period`, `kind`, `limitMinor`/`limitCount`, `usedMinor`/`usedCount`, `reservedMinor`/`reservedCount`, `remainingMinor`/`remainingCount`, `windowResetsAt`

It **never** returns `limitProfileCode`, `assignmentId`, `subjectType`/`segmentCode`, `limitRuleId`, `priority`, `channel`, `createdBy`/`updatedBy`, `version`, or any ledger-account id. This is verified by an automated test (`test/v1-customer-08-limits-view.integration.spec.ts`, test 3) that serializes the full response and asserts none of these internal tokens appear.

---

## 3. Final customer-facing API contract

### `GET /customers/me/limits`

Authenticated (customer bearer session), SELF-only by construction (no `:id` param in the route at all — eliminates IDOR structurally, not just by a scope check).

```jsonc
{
  "customerId": "...",
  "currency": "NGN",
  "asOf": "2026-10-04T18:00:00.000Z",
  "products": [
    {
      "product": "WALLET_TRANSFER",
      "direction": "OUTGOING",
      "currency": "NGN",
      "configured": true,
      "perTransactionMinMinor": "1000",
      "perTransactionMaxMinor": "500000",
      "walletBalanceMaxMinor": null,
      "windows": [
        {
          "dimension": "DAILY_AMOUNT",
          "period": "DAILY",
          "kind": "AMOUNT",
          "limitMinor": "1000000",
          "limitCount": null,
          "usedMinor": "300000",
          "usedCount": null,
          "reservedMinor": "0",
          "reservedCount": null,
          "remainingMinor": "700000",
          "remainingCount": null,
          "windowResetsAt": "2026-10-05T23:00:00.000Z"
        }
      ]
    },
    { "product": "CASH_TO_WALLET", "direction": "INCOMING", "configured": false, "...": "..." },
    { "product": "WALLET_TO_CASH", "direction": "OUTGOING", "configured": false, "...": "..." },
    { "product": "CASH_TO_CASH", "direction": "INCOMING", "configured": false, "...": "..." },
    { "product": "CUSTOMER_FUNDING", "direction": "INCOMING", "configured": false, "...": "..." }
  ]
}
```

`products` always contains exactly the five known customer-facing buckets (§1.3); `configured: false` entries have all limit fields `null`/empty — the endpoint **never fabricates a number** when nothing is configured.

Implementation: `src/limit-catalog/customer-limit-view.service.ts` (`CustomerLimitViewService.getMyLimits`), wired into `src/customer-app/customer-app.controller.ts` via `LimitCatalogModule` import in `src/customer-app/customer-app.module.ts`. It is **read-only** — it never writes to `limit_usages`/`limit_reservations`, is never called from the enforcement path, and re-uses `LimitProfileResolverService.resolve()` plus the identical `limit_rules` filtering and `getWindowForDimension()` window-key computation that `LimitEnforcementService` uses, so the projection cannot silently drift from what's actually enforced.

---

## 4. Exact limit semantics (Part G)

For every dimension actually reachable by a customer transaction:

| Dimension | Period | What consumes it | Do failed tx consume it? | Do pending tx consume it? | Reset |
|---|---|---|---|---|---|
| `MIN_AMOUNT_PER_TX` / `MAX_AMOUNT_PER_TX` | None (per-transaction) | N/A — immediate check only | N/A | N/A | N/A |
| `WALLET_BALANCE_MAX` | None (live) | Current ledger balance + the transaction's own amount (INCOMING/BOTH only) | No — it's not a usage counter, it's a live balance read | N/A | N/A |
| `DAILY_AMOUNT`/`WEEKLY_AMOUNT`/`MONTHLY_AMOUNT`/`YEARLY_AMOUNT` and the `_COUNT` equivalents | Africa/Lagos wall-clock window (`limit-window.util.ts`) | Only the specific `(product, direction)` bucket the transaction was executed as (§1.3) | **No** — `releaseReservationsWithManager` decrements `reserved` back to zero on failure; `used` is never touched | **Yes** — `reserved` is incremented the instant `enforceWithManager` allows the transaction, before the financial side-effect runs, and counts against the limit until commit/release | At the Lagos-local window boundary (midnight for DAILY, Monday 00:00 for WEEKLY, 1st of month for MONTHLY, Jan 1 for YEARLY) |

**CASH_IN / CASH_OUT / C2C / W2W bucket sharing:** confirmed **not shared**. Each of the five flows passes a distinct `product` string (`WALLET_TRANSFER`, `CASH_TO_WALLET`, `WALLET_TO_CASH`, `CASH_TO_CASH`, `CUSTOMER_FUNDING`), and `product` is part of the `limit_usages` unique key — a transaction in one bucket never reduces another bucket's remaining capacity, proven in `test/v1-customer-08-limits-view.integration.spec.ts` test 4 (configuring `WALLET_TRANSFER` leaves `CASH_TO_WALLET` reported as `configured: false`).

**Is displayed remaining authoritative?** Yes, with one documented, deliberate caveat: the view is a plain (non-locking) read of the same `limit_usages` rows the real enforcement reads under `FOR UPDATE`. It is accurate at read time but is **not** inside the same transaction as any concurrent reservation — exactly the same staleness window any "view" endpoint has relative to a live ledger. It is never used to gate any action; the real enforcement always re-checks live, inside the SERIALIZABLE transaction, at the moment of the actual transfer/cash-in/cash-out/claim/funding call. This is stated explicitly in code comments on `CustomerLimitViewService` and is why the mobile UI footnote says *"Figures reflect your account as of now."*

If multiple active rules of the same dimension exist for a product (an edge-case misconfiguration, not currently possible via any seeded config), the service picks the **most restrictive** one for display (`customer-limit-view.service.ts`, `buildProductView` — largest `MIN`, smallest `MAX`/windowed remaining) — it never overstates capacity.

No client-side recalculation was introduced: the mobile app only formats and labels values it receives verbatim from `GET /customers/me/limits`.

---

## 5. Part C — Account Status / Restrictions

### 5.1 The authoritative model

`src/customer/customer.enums.ts`: `CustomerStatus = DRAFT | ACTIVE | SUSPENDED | CLOSED`, stored directly on the `Customer` entity, already exposed via three existing endpoints — `GET /customers/me`, `GET /customers/me/profile`, `GET /customers/me/status` — none of which required any change.

### 5.2 Status is backend-authoritative, not duplicated client-side (verified, not just asserted)

`src/customer-authentication/authentication-session.service.ts` line 129 (pre-existing code, not modified): **every** session-token validation re-reads `customer.status` from the database and rejects with `CUSTOMER_STATUS_INELIGIBLE` if it is not `ACTIVE` — *"the customer's CURRENT lifecycle status is authoritative at request time. A cryptographically valid session is not sufficient when the customer is no longer ACTIVE."* This means a customer who is suspended **mid-session** loses access to every authenticated endpoint on their very next request, not just at next login. Proven by new test 8: a valid bearer token for a customer who is then flipped to `SUSPENDED` directly in the database is rejected with 401 on `/customers/me/status`, `/customers/me/limits`, and `/customers/me` alike.

Login (`authentication-execution.service.ts` line 119) separately rejects with the same `CUSTOMER_STATUS_INELIGIBLE` reason, but the controller (`customer-app.controller.ts` `login()`) intentionally collapses **all** authentication failures — wrong password, unknown customer, suspended account — into one generic `401 Invalid credentials`. This is a **deliberate, correct security decision already in the codebase**, preventing account-status enumeration by an attacker who doesn't yet hold a valid session. Proven by new test 9. **Not changed; not a bug.**

### 5.3 What Customer Mobile displayed before this task

`ProfileScreen.tsx` already fetched `identity.status` and rendered it as plain text, but the styling was **hardcoded green (`styles.activeStatus`) regardless of the actual value** — a `SUSPENDED` customer (in the rare window before their session is invalidated, or if a future flow allows displaying a stale snapshot) would see the correct word in the wrong color, with no explanation. Low real-world exposure (since a suspended customer is logged out on the very next request per §5.2), but a genuine, easily fixed correctness gap per the explicit Part C audit requirement.

### 5.4 What was changed

`apps/customer-mobile/src/screens/authenticated/ProfileScreen.tsx`:
- Status badge color now reflects the actual value (`ACTIVE`→green, `SUSPENDED`/`CLOSED`→red, `DRAFT`→amber) via a pure function `statusStyle()` that only maps colors — it never recomputes or second-guesses the backend's status string.
- Added a visible banner — *"Your account is suspended. Some actions may be unavailable. Please contact Support for help."* — rendered only when `identity.status === 'SUSPENDED'`, giving a useful customer-facing explanation **without any internal admin reason/staff note** (no restriction-reason field is fetched or shown; `src/customer-eligibility`'s internal restriction types like `BLACKLISTED`/`FROZEN`/`MANUAL_REVIEW` are never queried by Customer Mobile — out of scope, internal-only, confirmed in §1.6-adjacent audit).

---

## 6. Part D — KYC/Readiness

`Customer.kycLevel` (`NONE`/`LEVEL_1`/`LEVEL_2`/`LEVEL_3`) and `Customer.kycStatus` (`NOT_STARTED`/`PENDING`/`APPROVED`/`REJECTED`) were **already** returned by `GET /customers/me`, `GET /customers/me/profile`, and `GET /customers/me/status` — no backend change needed. `ProfileScreen.tsx` already declared `kycLevel`/`kycStatus` in its TypeScript interface (dead fields, fetched but never rendered). **Fixed:** both are now displayed verbatim as two new read-only rows ("KYC Level", "KYC Status"), with `kycStatus` color-coded the same defensive way as account status.

Confirmed V1 transaction authorization does **not** currently gate on KYC/readiness state anywhere in the real transaction flows traced in §1.3 (no `kycStatus`/`kycLevel` check found in `transfer.service.ts`, `agent-cash-in/out.service.ts`, `agent-cash-to-cash*.service.ts`, or `customer-funding.service.ts`). Per the task's explicit instruction, **no KYC gating was introduced** — this remains readiness-only display, exactly as the existing architecture intends.

(A separate, legacy `CustomerEligibility`/`CustomerEligibilityStatus` concept in `src/customer-eligibility/` **does** gate wallet *provisioning* — `src/customer-wallet/customer-wallet.service.ts` line 317 requires an `ELIGIBLE` eligibility record before a wallet can be created — but this is a one-time, ops-driven onboarding gate, not a per-transaction authorization check, and it is not exposed to Customer Mobile. It is out of scope per Part D's instruction not to invent new KYC enforcement or expose internal eligibility workflow state.)

---

## 7. Part E — PIN/Security Account Controls

Audited `GET/POST /customers/me/transaction-pin` and `POST /customers/me/transaction-pin/change` (both pre-existing, secured under V1-CUSTOMER-05) and `apps/customer-mobile/src/screens/authenticated/TransactionPinScreen.tsx`. Confirmed:

- `GET /customers/me/transaction-pin` returns a tri-state `status: 'NOT_SET' | 'ACTIVE' | 'LOCKED'` plus `exists`, `accountLocked`, `pinVersion`, `lastChangedAt`, `failedCount`, `lockedAt`, `lockReason`.
- First-time creation (`POST .../transaction-pin`) is **create-only**: returns `409 Conflict` if a PIN already exists, directing the caller to the change endpoint — closing the historical "unconditional overwrite" vulnerability that V1-CUSTOMER-05 fixed.
- `TransactionPinScreen.tsx` already renders three fully distinct UI states: `NOT_SET` → creation form; `ACTIVE` → change form (requires current PIN); `LOCKED` → plain message plus a "Contact Support" button, with an explicit code comment: *"V1 has no secure, out-of-band way to prove identity [to unlock]... This screen says so plainly and links to Support rather than [implementing recovery]."*
- No PIN-recovery flow exists or was added, per Part J.

**No regression found. No code changed in this area**, consistent with "V1-CUSTOMER-05 already secured transaction PIN change — do not modify unless this audit finds a regression."

---

## 8. Part F — Customer-Facing Design Decision

**Decision: enhance the existing `ProfileScreen`, add one new backend endpoint, no new screens, no new navigation.** `ProfileScreen` already was the natural home for account/identity/security information (it already linked to "Transaction PIN" and "Support"). Adding a "Transaction Limits" card and two KYC rows to the existing "Account Information" card uses the existing MonieNaija visual language (`Card`, `theme.colors`, existing row/divider styles) with zero new components, zero new navigation routes, and zero redesign of anything already working.

---

## 9. Part I — Security Audit

| Concern | Finding |
|---|---|
| IDOR / customer-ID injection on the new endpoint | Structurally impossible — `GET /customers/me/limits` has no `:id` param; the customer id is taken exclusively from the authenticated session principal (`requireCustomerPrincipal`), identical to every other `/customers/me/*` route. Proven by test 6 (two customers, one with a `CUSTOMER`-scoped assignment, each see only their own result). |
| Exposure of internal policy/account IDs | None — verified by automated serialization scan (test 3), see §2. |
| Exposing another customer's limits | Not possible by construction (see IDOR row above). |
| Client-side-only enforcement | None introduced — the view is read-only and informational; `generate`/`transfer`/`cash-in`/`cash-out`/`claim`/`fund` endpoints are completely unaware of this new endpoint and continue to call `LimitEnforcementService.enforceWithManager()` directly, unconditionally, regardless of what the mobile app has cached or displayed. |
| Stale cached limits causing dangerous UI claims | The mobile screen fetches fresh on every `ProfileScreen` mount and does not cache across sessions; the explicit on-screen footnote ("Figures reflect your account as of now") avoids implying a guarantee. The backend remains the sole enforcement point regardless of display staleness. |
| Mobile manipulation of displayed limits | Irrelevant — the mobile app never sends limit values to the backend; it only reads them. All limit decisions are made server-side inside the same transaction as the money movement. |
| Account-status leakage | Confirmed generic login failure (test 9) and generic session-invalidation failure (test 8) — an attacker cannot distinguish "wrong password" from "suspended account" from either surface. |

`A2SecurityRateLimitService` serialization-retry issue — **explicitly not touched**, per task instruction (separate hardening task).

---

## 10. Files changed

| File | Change |
|---|---|
| `src/limit-catalog/customer-limit-view.service.ts` | **New.** `CustomerLimitViewService` — read-only customer-safe limits projection. |
| `src/limit-catalog/limit-catalog.module.ts` | Registered + exported `CustomerLimitViewService`. |
| `src/customer-app/customer-app.module.ts` | Imported `LimitCatalogModule`. |
| `src/customer-app/customer-app.controller.ts` | Injected `CustomerLimitViewService`; added `GET customers/me/limits`. |
| `test/customer-app.login.spec.ts` | Added one `{} as any}` constructor arg for the new controller dependency (unit test scaffolding only — no behavioral change). |
| `test/v1-customer-08-limits-view.integration.spec.ts` | **New.** 10 real-PostgreSQL integration tests (see §11). |
| `apps/customer-mobile/src/screens/authenticated/ProfileScreen.tsx` | Render `kycLevel`/`kycStatus`; color-code status by actual value; SUSPENDED support banner; new "Transaction Limits" card (only renders configured entries). |
| `apps/customer-mobile/__tests__/profile.test.tsx` | Added 4 new tests (see §11). |
| `docs/V1/V1-CUSTOMER-08-LIMITS-ACCOUNT-CONTROLS-01.md` | **New.** This report. |

No migration files were added or modified.

---

## 11. Tests added/changed — exact counts

**Backend, `test/v1-customer-08-limits-view.integration.spec.ts`** (real PostgreSQL, 10 tests, all passing):
1. Unauthenticated request → 401.
2. No profile/assignment configured → all 5 products `configured:false`, nothing fabricated.
3. Response never leaks `limitProfileCode`/`assignmentId`/`ruleId`/`createdBy`/`priority`/`ledgerAccount` (automated serialization scan).
4. Configured per-tx MIN/MAX and windowed `DAILY_AMOUNT`/`DAILY_COUNT` match exactly what was configured; other products stay unconfigured (bucket isolation).
5. After a real `LimitEnforcementService.enforceWithManager()` reserve+commit (the exact engine `transfer.service.ts` calls), `usedMinor`/`remainingMinor` reflect the committed amount exactly.
5b. A `RESERVED`-but-not-yet-`COMMITTED` amount still reduces displayed remaining (pending holds capacity — matches enforcement semantics).
6. Two customers, one with a `CUSTOMER`-scoped assignment: each sees only their own data (IDOR/self-scope proof).
7. `GET /customers/me/status` reflects true backend status.
8. A customer flipped to `SUSPENDED` mid-session loses access to `/customers/me/status`, `/customers/me/limits`, `/customers/me` on the very next request (401) — status never served stale.
9. Login for a `SUSPENDED` customer returns a generic `401 Invalid credentials` with no "suspend" wording (no status leakage pre-auth).

**Customer Mobile, `apps/customer-mobile/__tests__/profile.test.tsx`** (4 new tests, all passing, 6/6 total in file):
1. KYC level/status now render (previously fetched, silently dropped).
2. `SUSPENDED` status renders verbatim with the support-contact banner.
3. Only `configured:true` products render, using friendly labels; raw internal identifiers are never shown.
4. When nothing is configured, the "Transaction Limits" card is omitted entirely (no fabricated zeroes/unlimited claims).

---

## 12. Full regression results

- **Unit suite** (`npx jest --runInBand`, excludes `*.integration.spec.ts`): **1797/1797 passed**, 171 suites.
- **Backend integration suite** (`npx jest --config jest.integration.config.js --runInBand`, real embedded PostgreSQL): **1587/1591 passed**, 77/80 suites green.
  - **4 pre-existing failures, unrelated to this task** (confirmed: this task added zero migration files and `git diff --stat` touches no file under `src/migrations/`):
    - `test/migration-chain.integration.spec.ts` — two assertions expect exactly 80 migrations; the repository already has 81 at the starting commit `69da01b` (a hardcoded-count test that was already stale before this session began).
    - `test/v1-hardening-06-admin-customer-investigation.integration.spec.ts` — same stale hardcoded migration-count/timestamp expectation (`1785753600080` missing from an allow-list that predates it).
    - `test/v1-workforce-bootstrap-01.integration.spec.ts` — `ENOENT` on `docs/config/v1-workforce-bootstrap.env.template`, a docs fixture file that does not exist in this checkout; unrelated to customer limits/account controls.
- **Customer Mobile suite** (`npx jest --watchAll=false` inside `apps/customer-mobile`): **69/69 passed**, 11 suites.
- **TypeScript**: `npx tsc --noEmit` clean on both the backend (`tsconfig.json`) and `apps/customer-mobile`.

---

## 13. Remaining V1 gaps / recommended next task

- The limit-catalog engine is fully wired but **unconfigured** in this build (§1.4) — no `limit_profiles`/`limit_rules`/`limit_assignments` rows exist anywhere. The new customer-facing endpoint will correctly show "not configured" for every customer until an operator populates real commercial policy via the existing internal `/internal/limit-*` admin API. This is a **commercial/ops configuration task**, not an engineering gap, and is explicitly out of scope here (Part A's objective was to audit/expose the architecture, not invent default limit values).
- `src/customer-eligibility`'s restriction types (`BLACKLISTED`/`FROZEN`/`LIMITED`/`MANUAL_REVIEW`) and its `getOperatingStatus()` view are real, DB-backed, and currently unused by any customer-facing surface or by Customer Mobile. If a future task decides these restrictions should be customer-visible (beyond the simple `CustomerStatus` already shown), that reconciliation — and whether `CustomerEligibility` should become customer-facing at all — is a distinct, deliberate product decision, not something to default into silently.
- The 3 pre-existing failing integration-test files (migration-count assertions + missing docs fixture) are unrelated technical debt; recommend a small, separate hardening task to update the hardcoded migration counts/allow-lists and restore (or remove the test's dependency on) `docs/config/v1-workforce-bootstrap.env.template`.
- `A2SecurityRateLimitService` serialization-retry issue remains open, as directed (separate task, not touched here).

---

## 14. Final determination

**A. CUSTOMER LIMITS AND ACCOUNT CONTROLS COMPLETE**
