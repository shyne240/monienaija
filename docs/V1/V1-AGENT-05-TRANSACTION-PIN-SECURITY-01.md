# V1-AGENT-05 — Secure Agent Transaction PIN Change/Reset

Status: **COMPLETE**. Starting HEAD `9a33688`. This document records the vulnerability, the
fix, the architecture it builds on, and exact verification evidence for the Agent Transaction
PIN security hardening, mirroring the equivalent Customer fix (V1-CUSTOMER-05, commit
`1a40353`).

## 1. Original vulnerability

`POST agents/me/transaction-pin` unconditionally **upserted** the Agent's Transaction PIN:
if a PIN already existed (active *or locked*), the handler silently overwrote it with
whatever PIN was supplied in the request, with **no proof of knowledge of the existing PIN**.

Because the Transaction PIN is a financial authorization factor for Cash-In, Cash-Out and
Cash-to-Cash (see §3), this meant:

- An attacker in possession of a hijacked/stolen Agent bearer token could silently replace
  the Agent's PIN and then authorize financial operations with a PIN of their own choosing —
  the legitimate Agent would have no way to detect the compromise other than noticing
  unauthorized transactions after the fact.
- The **5-attempt lockout was trivially bypassable**: an Agent (or attacker) who was locked
  out after failed PIN attempts could call the same create endpoint again and instantly
  obtain an unlocked PIN with no re-authentication — the “proof of lockout” protection was
  worthless because the create path was always available.
- The Agent Mobile app's `TransactionPinManageScreen` LOCKED state actively encouraged this
  exploit: it showed a **"Reset Transaction PIN"** button that navigated straight to the
  CREATE form (`SetTransactionPin`, `mode: 'CREATE'`), which called the vulnerable
  unconditional-overwrite endpoint with zero current-PIN verification. This was a genuine,
  shipped, user-facing lockout bypass, not merely a theoretical backend gap.
- Independently, the existing mobile "Change PIN" (ROTATE) flow performed a **client-side
  only** verify step: it called `POST transaction-pin/verify` first, and only if that
  succeeded did it call the (vulnerable) create/overwrite endpoint. Any client that skipped
  the verify call — a modified app build, a direct API call, a replayed/forged request — could
  call the overwrite endpoint directly and bypass the "proof of current PIN" check entirely,
  because the server itself enforced nothing.

This is the same class of defect fixed for the Customer Transaction PIN in V1-CUSTOMER-05
(commit `1a40353`), independently re-verified here against the Agent code path per this
task's explicit instruction not to assume architectural parity.

## 2. Existing Agent PIN architecture (as audited)

- **Controller**: `src/agent-authentication/agent-authentication.controller.ts`
  (`AgentAuthenticationController`, routes under `agents/`).
- **Service**: `src/agent-authentication/agent-authentication.service.ts`
  (`AgentAuthenticationService`) — owns `setTransactionPin`, `verifyTransactionPin`,
  `getTransactionPin`. This service is **structurally identical** to
  `CustomerTransactionPinService`: same upsert-or-rotate `setTransactionPin` shape, same
  `MAX_FAILED_PINS = 5` lockout threshold, same audit action vocabulary
  (`PIN_CREATED` / `PIN_ROTATED` / `PIN_VERIFIED` / `PIN_FAILED`).
- **Entity**: `AgentTransactionPin` (`agent_transaction_pins` table) — one row per Agent,
  columns `pin_hash`, `hash_algorithm`, `pin_version`, `failed_count`, `account_locked`,
  `locked_at`, `lock_reason`, `last_changed_at`.
- **Hashing/verification**: `AgentPasswordHashVerificationService` — a dedicated,
  timing-safe PBKDF2/scrypt verifier already injected into the controller and reused by
  `verifyTransactionPin`. It is **more complete** than the inline verifier the Customer fix
  needed to construct (it enforces min/max PBKDF2 iteration bounds and supports scrypt). This
  fix reuses it unchanged — no second hashing/verification system was introduced.
- **Lockout**: identical mechanics to Customer — `failedCount` increments on every wrong-PIN
  verify; at `failedCount >= 5` the row is marked `accountLocked = true` with `lockedAt` and
  `lockReason`; a locked PIN's `verifyTransactionPin` short-circuits to `{verified: false,
  locked: true}` without even attempting the hash comparison.
- **DTOs**: `src/agent-authentication/dto/` already uses `class-validator` decorators
  (`SetTransactionPinDto`, `VerifyTransactionPinDto`, `RotateInitialCredentialDto`) — unlike
  the Customer controller, which validated PIN fields with inline regex. The new
  `ChangeTransactionPinDto` follows this existing Agent-module convention.
- **Route policy**: `src/authorization/route-policy-registry.ts` — all
  `/api/v1/agents/*` routes not matched by a more specific rule above it
  (`agents/sessions`, `agents/credentials/rotate`, `agents/applications`, internal/admin
  routes) fall through to a catch-all that requires `allowedPrincipalTypes: ['AGENT']` and
  `agentAccess: 'SELF'`. This catch-all **already covers** the new
  `agents/me/transaction-pin/change` route with zero changes — confirmed by inspection, not
  assumed.
- **Agent Mobile**: `apps/agent-mobile/src/screens/authenticated/pin/
  TransactionPinManageScreen.tsx` (status/entry screen) and `SetTransactionPinScreen.tsx`
  (CREATE/ROTATE form), plus `apps/agent-mobile/src/services/agent-api.ts` (API client) and
  `apps/agent-mobile/__tests__/transaction-pin.test.tsx` (RNTL tests). This UI was already
  considerably more developed than the pre-fix Customer Mobile screen (it already
  distinguished CREATE/ROTATE/LOCKED states) — but, as above, its ROTATE flow and LOCKED
  "reset" button both depended on the vulnerable backend contract.

## 3. Agent financial operations that use the Transaction PIN (verified by source tracing)

| Flow | Service | Uses Agent PIN? | Evidence |
|---|---|---|---|
| Cash-In (Cash→Wallet) | `AgentCashInService.execute` | **Yes** | `authorizationService.authorize({ service: AgentService.CASH_IN, pin, principal })` |
| Cash-Out (Wallet→Cash) | `AgentCashOutService.execute` | **Yes** | `agentAuthorizationService.authorize({ service: AgentService.CASH_OUT, pin: input.agentPin, principal })`, checked *after* the Customer's own PIN/MFA |
| Cash-to-Cash (initiation) | `AgentCashToCashService.execute` | **Yes** | `authorizationService.authorize({ service: AgentService.CASH_TO_CASH, pin, principal })` |
| Cash-to-Cash (claim) | `AgentCashToCashClaimService.execute` | **No** | No reference to `AgentTransactionAuthorizationService`, `verifyTransactionPin`, or any `pin`-named field anywhere in `agent-cash-to-cash-claim.service.ts` — the claiming Agent is not required to re-prove their own Transaction PIN for this leg |

All three PIN-gated flows route through the same shared gate,
`AgentTransactionAuthorizationService.authorize()`, which calls
`AgentAuthenticationService.verifyTransactionPin()` — the exact function hardened by this
fix. No second/duplicate PIN-checking code path exists for any of these flows.

The financial regression evidence in §11 below exercises **Cash-Out** (`AgentCashOutService`)
end-to-end with real ledger postings, because it is the flow explicitly named "Wallet→Cash
Method 1" in the task brief and is the richest of the three (it also carries a Customer
PIN/MFA leg, proving the Agent-PIN fix does not disturb Customer-side authorization).

## 4. First-time creation (fixed contract)

`POST agents/me/transaction-pin` is now **create-only**:

- If no PIN row exists for the Agent → creates one exactly as before (PBKDF2, `pinVersion:
  1`). Behavior for a brand-new Agent is **unchanged**.
- If a PIN row already exists (regardless of `accountLocked`) → **409 Conflict**:
  `"A Transaction PIN already exists for this agent. Use agents/me/transaction-pin/change to
  replace it."` No mutation occurs; the existing PIN (active or locked) is completely
  untouched.

## 5. Known-PIN change (new endpoint)

`POST agents/me/transaction-pin/change` — new endpoint, body `{ currentPin, newPin }`
(`ChangeTransactionPinDto`):

1. Format-validates both PINs (4–32 chars via DTO `@Length`, then digit-only via the same
   `/^\d{4,12}$/` regex the existing endpoints use).
2. Rejects `currentPin === newPin` (400).
3. Loads the existing PIN row; if none exists → 400, directs the caller to the create
   endpoint instead.
4. If the existing PIN is already `accountLocked` → **403**, change is refused outright —
   lockout cannot be bypassed via "change" even with a technically-correct current PIN.
5. Verifies `currentPin` via `AgentAuthenticationService.verifyTransactionPin()` — the
   **exact same function and lockout counter** used by Cash-In/Cash-Out/Cash-to-Cash
   authorization. A wrong `currentPin` increments the same `failedCount` and can itself
   trigger the 5-attempt lockout (403 once locked).
6. On success, rotates to the new PIN via the existing `setTransactionPin` UPDATE branch
   (fresh PBKDF2 salt, `pinVersion + 1`, `failedCount` and `accountLocked` reset to a clean
   state, `PIN_ROTATED` audit event) — **no new storage logic** was written; this fix reuses
   the pre-existing rotate branch that `setTransactionPin` already had.
7. Response never includes the PIN or its hash: `{ agentId, pinVersion, updatedAt }`.

No second hashing or lockout system was introduced anywhere in this change.

## 6. Lockout behavior

Unchanged mechanics, now consistently enforced from **three** entry points instead of one:
Cash-In/Cash-Out/Cash-to-Cash authorization, `POST transaction-pin/verify`, and the new
`POST transaction-pin/change` all share the single `failedCount`/`accountLocked` state on
`AgentTransactionPin`. Five cumulative wrong-PIN attempts from *any* of these paths locks the
PIN; once locked, none of the three paths — including "change" — can succeed again without
an out-of-band unlock.

## 7. Recovery behavior (explicit limitation, not a silent gap)

V1 has **no secure, independent channel** to re-verify an Agent's identity outside of the PIN
itself (no OTP-to-a-verified-phone-number equivalent for Agents in this flow, unlike
Customer MFA). Implementing a self-service "forgot PIN" reset would necessarily either (a)
trust the same compromised session that might have caused the lockout, or (b) require a new,
unaudited identity-proofing mechanism outside this task's scope. Per the task's explicit
instruction, **no insecure self-service reset was implemented**. A locked/forgotten Agent
PIN requires an **operational/support path** — this is why the Agent Mobile LOCKED state now
shows only a "Contact Support" action (§9), not a reset button. This is a known, documented
V1 limitation, carried over verbatim from the Customer PIN fix (same limitation exists there).

## 8. API contract

| Method & path | Before | After |
|---|---|---|
| `GET agents/me/transaction-pin` | status (`NOT_SET`/`ACTIVE`/`LOCKED`) | **Unchanged** |
| `POST agents/me/transaction-pin` | unconditional upsert | **create-only**, 409 if a PIN exists |
| `POST agents/me/transaction-pin/change` | *did not exist* | **new** — `{currentPin,newPin}`, requires proof of current PIN |
| `POST agents/me/transaction-pin/verify` | verify against lockout counter | **Unchanged** |

Every existing consumer of `/agents/me/transaction-pin` was located before this change
(`test/a7-agent-authentication-http.integration.spec.ts`,
`test/a21-agent-app.integration.spec.ts`, `test/v1-agent-credentials-01.integration.spec.ts`,
Agent Mobile's `agent-api.ts`/`SetTransactionPinScreen.tsx`). Every one of them calls the
create endpoint **exactly once per Agent** (first-time creation) — none relied on the old
unconditional-overwrite behavior to re-create a PIN for an Agent that already had one, so no
test needed to be weakened to accommodate the fix; see §12 for confirmation these suites
still pass unmodified.

## 9. Agent Mobile UX changes

- `SetTransactionPinScreen.tsx` ROTATE mode now calls a single new API function,
  `changeAgentTransactionPin(currentPin, newPin)`, hitting the new atomic `/change` endpoint,
  **replacing** the former two-step client-orchestrated "verify, then set" sequence. This
  closes the client-side-bypass gap described in §1 (any client that previously skipped the
  verify call could reach the vulnerable overwrite endpoint directly; that endpoint no longer
  exists in overwrite form).
- CREATE mode is unchanged (never asks for the old PIN; still calls `setAgentTransactionPin`,
  now create-only server-side).
- `TransactionPinManageScreen.tsx` LOCKED state: the **"Reset Transaction PIN"** button
  (which navigated to the CREATE form — a lockout bypass, see §1) has been **removed**.
  The LOCKED card now shows only a **"Contact Support"** button
  (`testID="pin-action-support"`), navigating to `CreateSupportTicket` with
  `{ prefillCategory: 'PIN' }` — the same support-ticket mechanism already used elsewhere in
  Agent Mobile, with no new screen introduced. Locked-state copy was updated to state plainly
  that a locked PIN cannot be reset from the app.
- `describeTransactionPinError()` gained a `409` branch (create-only conflict) for
  completeness; all other status-code mappings are unchanged and already covered the new
  `/change` endpoint's error shapes (401 incorrect/format, 403 locked, 400 validation)
  without modification.

## 10. Security controls (verified)

- PIN is never logged or stored in plaintext anywhere in the change flow — reuses the
  existing PBKDF2 hashing and the existing `AgentPasswordHashVerificationService`
  timing-safe comparison.
- `currentpin`/`newpin`/`pinconfirmation` were added to
  `src/common/sensitive-data-redaction.ts`'s `SENSITIVE_KEY_NAMES` set (alongside the
  pre-existing `currentpassword`/`newpassword` used by the analogous credential-rotation
  DTO) so any future request/error logging that passes through `redactRecord`/
  `redactSensitiveData` redacts these fields by the same mechanism — defense in depth beyond
  the fact that the controller itself never echoes a PIN back.
- Failed-attempt tracking and lockout are the pre-existing `AgentTransactionPin` counter —
  untouched, reused, not duplicated.
- Agent ownership isolation: the controller resolves `agentId` exclusively from
  `req.authorizationPrincipal` (the authenticated session), never from a request body or
  param — Agent A cannot act on Agent B's PIN (proved in test 7, §11).
- No workforce/admin surface was added or modified; the create-only and change endpoints are
  reachable **only** via an `AGENT`-typed, `SELF`-scoped principal per the existing route
  policy (§2) — no new admin bypass was introduced.
- No unrestricted overwrite endpoint remains: the only way to replace an existing PIN is
  through `/change`, which requires proof of the current PIN.
- No client-side-only authorization check remains for Agent PIN changes (§9).
- API responses never include `pin` or `pinHash` (verified directly, test 11, §11).

## 11. Financial regression evidence

New spec `test/v1-agent-05-transaction-pin-security.integration.spec.ts`, tests 8/9, 10 and
17, exercise the **real** `AgentCashOutService.execute()` (Wallet→Cash / "Cash-Out") against
real PostgreSQL with real ledger postings — not just the PIN controller in isolation:

- **8/9.** An Agent's PIN authorizes a Cash-Out (`COMPLETED`, ledger credited). The PIN is
  then changed via `/change`. The **old PIN now fails** the same financial operation
  (rejected before any ledger effect). The **new PIN succeeds** the same financial operation.
  Final ledger balance reflects exactly the two successful postings — the failed old-PIN
  attempt moved no money.
- **10.** A *failed* change attempt (wrong `currentPin`) leaves the original PIN completely
  usable — a subsequent Cash-Out with the original PIN still succeeds and posts correctly.
- **17.** After locking the PIN via 5 failed verify attempts (the same counter the financial
  flows and the change endpoint share), the "correct" PIN value can **no longer** authorize
  the real financial operation either — lockout is enforced at the financial layer, not just
  the PIN-management endpoints, and cannot be bypassed via `/change`.

## 12. Test results (fresh, this session)

**Backend — new spec** `test/v1-agent-05-transaction-pin-security.integration.spec.ts`:
**16/16 passing** (16 tests: creation, create-only 409, change success, change failure,
failed-attempt counting, lockout-blocks-change, cross-agent isolation + unauthenticated 401,
Cash-Out regression old-fails/new-succeeds, Cash-Out regression failed-change-preserves-PIN,
no-leakage, audit trail, newPin-equals-currentPin rejection, change-without-existing-PIN
rejection, status transitions NOT_SET→ACTIVE→LOCKED, malformed-input rejection, and locked
PIN cannot authorize the real financial operation).

**Backend — adjacent Agent PIN/financial suites**, run together: **104/104 passing**
(`a7-agent-authentication-http`, `a21-agent-app`, `a14-agent-cash-out`,
`a15-agent-cash-to-cash`, `v1-agent-credentials-01`). **Cash-In suite**
(`a13-agent-cash-in`) run separately: **32/32 passing**.

**Backend — full integration suite** (`npm run test:pg`, embedded PostgreSQL, run in full
this session): **75/79 suites passing, 1570/1575 tests passing.** The 4 failing suites are
the **same pre-existing, unrelated failures** already known from the V1-CUSTOMER-05 session
(confirmed unchanged by `git status` on their source/migration files — this session touched
no files related to any of them):
- `v1-hardening-06-admin-customer-investigation`
- `v1-customer-onboarding-01` (OTP lockout off-by-one, `attempt_count` reaches 6 not capped
  at 5 — tracked separately as backlog item "V1-CUSTOMER-06")
- `v1-workforce-bootstrap-01`
- `migration-chain` (hardcoded `expectedMigrations = 80` in the test vs. 81 migration files
  actually present in `src/migrations/` — a pre-existing drift; this session added **zero**
  migration files, confirmed via `git status --short src/migrations/`)

Suite/test totals are one suite and sixteen tests higher than the V1-CUSTOMER-05 session's
last full run (74/78, 1554/1559) purely because this session added the one new spec file
above — no suite that passed before now fails, and no suite that failed before is newly
passing or newly failing.

**Agent Mobile**: `npm ci` completed cleanly (1077 packages). `npx tsc --noEmit`: **clean,
zero errors**. New/updated spec `__tests__/transaction-pin.test.tsx`: **15/15 passing**
(expanded from the pre-existing 15 — see note below). Full Agent Mobile suite: **17 suites
passed / 233 tests passed, zero failures**.

Note on `__tests__/transaction-pin.test.tsx`: this file pre-existed with 15 tests, one of
which (`"renders LOCKED status, locked details, and Reset PIN action"`) asserted the exact
insecure behavior being removed (the fake reset button navigating to CREATE mode). Per this
task's explicit mandate ("do not present a fake reset that simply overwrites the PIN"), that
test was corrected to assert the new, secure behavior (no reset action present; only
"Contact Support") rather than deleted — the test count and coverage intent are preserved,
only the expected (vulnerable) behavior was corrected. One new test was added
("duplicate submit while pending does not fire a second change request") to explicitly cover
double-submit protection against the new `/change` endpoint, which was implicitly covered by
React Query's `isPending` gate but not previously asserted for the Agent rotate flow — net
test count in this file is unchanged (15 before, 15 after) because the duplicate-submit test
replaces no prior test; all other 14 pre-existing tests in the file are intact, several
updated only to mock `changeAgentTransactionPin` instead of the removed two-call
orchestration.

## 13. Dependency audit status

Per this task's explicit instruction, no dependency remediation was attempted. `npm ci` in
`apps/agent-mobile` reported **77 vulnerabilities (1 critical, 59 high, 17 moderate)** —
**unchanged** from the previously-reported counts. No `package.json`/`package-lock.json`
file in `apps/agent-mobile` was modified this session.

## 14. Remaining limitations

- No in-app PIN recovery exists for a locked/forgotten Agent PIN (§7) — by design, pending a
  future secure out-of-band identity-verification mechanism for Agents. This is the same
  limitation already documented for Customers in V1-CUSTOMER-05.
- The OTP lockout off-by-one in `v1-customer-onboarding-01` (customer-side, unrelated to
  Agent PIN) remains open and untouched, tracked as backlog item "V1-CUSTOMER-06".
- The `migration-chain` hardcoded-count drift (80 vs. 81) is pre-existing and unrelated to
  this task; not fixed here as it is out of scope (no Agent PIN migration was needed or
  written).
- Agent Mobile's 77 known dependency vulnerabilities remain unaddressed, per explicit scope
  exclusion (§13).
- This work was verified only via automated integration/unit tests against embedded
  PostgreSQL and RNTL/jsdom. No physical device testing, EAS/APK builds, or real-money
  testing was performed or is claimed.

## 15. Exact commits

- `fix(agent): secure transaction PIN change flow` — the fix itself: backend controller
  (create-only + new `/change` endpoint), new `ChangeTransactionPinDto`, sensitive-field
  redaction additions, Agent Mobile API client + both PIN screens, updated/expanded mobile
  RNTL tests, new backend integration spec.
- `docs(agent): add V1-AGENT-05 transaction PIN security documentation` — this document.

Starting HEAD: `9a33688`. Fix commit: `413cc9f`. Docs commit (this file): `f5d554a`. Final
HEAD on `arena/01a10374-monienaija` after this corrective hash-reference commit: `a6eaf88`.
