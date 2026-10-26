# V1-CUSTOMER-06 — Customer Registration OTP Lockout Security

Status: **COMPLETE**. Scope: the Customer self-service registration phone-verification OTP
lockout boundary only (`src/customer-registration/`). No PIN, limits, transaction history,
EAS/APK, physical UAT, SMS infrastructure, or real-money testing is covered by this task.

## 1. Original defect (as reported)

The intended policy is `REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS = 5`: a challenge should accept
at most 5 verification attempts before being locked. The reported symptom was that the
persisted `attempt_count` on `customer_registration_phone_challenges` could reach **6**
instead of stopping at 5 — i.e. the lockout boundary had an off-by-one defect.

This was independently reproduced before any fix, via the pre-existing integration test
`test/v1-customer-onboarding-01.integration.spec.ts` → proof 19 ("failed-attempt lockout"):

```
expect(received).toBe(expected)
Expected: 5
Received: 6
```

## 2. Root cause (full lifecycle trace — not assumed to be a `>`/`>=` typo)

`CustomerRegistrationService.verifyOtp()` (`src/customer-registration/customer-registration.service.ts`)
runs every rejection path through one shared `fail(reason)` closure that records audit
details and persists state. Before this fix, `fail()` **unconditionally** did:

```ts
challenge.attemptCount += 1;
if (challenge.attemptCount >= REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS) {
  challenge.status = 'REVOKED';
  challenge.revokedAt = now;
} else if (now > challenge.expiresAt) {
  challenge.status = 'EXPIRED';
}
await repository.save(challenge);
```

`fail()` is invoked for **every** rejection reason, not only a genuine wrong-code guess:
`NO_CHALLENGE`, `ALREADY_VERIFIED`, `CHALLENGE_INACTIVE`, `EXPIRED`, `LOCKED`, and `MISMATCH`.
The entry guard sequence is:

```ts
if (!challenge) return fail('NO_CHALLENGE');
if (challenge.status === 'VERIFIED') return fail('ALREADY_VERIFIED');
if (challenge.status !== 'ACTIVE') return fail('CHALLENGE_INACTIVE');
if (now > challenge.expiresAt) return fail('EXPIRED');
if (challenge.attemptCount >= REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS) return fail('LOCKED');
// ...only here is the OTP hash actually compared...
const matches = this.verifyOtpCode(code, challenge.codeSalt, challenge.codeHash);
if (!matches) return fail('MISMATCH');
```

Walking the exact sequence that produced the reported symptom:

1. Attempts 1–4 wrong → each is a genuine `MISMATCH`; `attempt_count` goes 1, 2, 3, 4.
   `attempt_count (4) >= 5` is false, so nothing else happens — correct so far.
2. Attempt 5 wrong → also `MISMATCH`; `attempt_count` becomes 5. Because `5 >= 5`, the old
   code additionally flipped `status` to `REVOKED`.
3. Attempt 6 (even with the **correct** code) → the entry guard now sees `status !== 'ACTIVE'`
   (it is `REVOKED` from step 2) and short-circuits to `fail('CHALLENGE_INACTIVE')` **before
   the OTP is ever compared**. But `fail()` still unconditionally ran
   `challenge.attemptCount += 1`, so the persisted counter advanced to **6** — for an
   attempt that was never actually evaluated against the stored OTP hash at all.

So the defect is not a boundary-comparison typo; it is that **the attempt counter was
charged for rejections that never represented a real guess against the OTP** (an
already-dead, already-verified, or already-locked challenge). Any further post-lockout
probe (7th, 8th, …) would have kept incrementing indefinitely with no ceiling.

This same root cause also meant:

- `fail('EXPIRED')` (hit via the dedicated early time-check, before any guess) also charged
  `attempt_count`, even though no comparison occurred.
- `fail('ALREADY_VERIFIED')` — triggered when a client replays the correct code *after*
  the challenge already succeeded — also charged `attempt_count`. Since the old code flipped
  `status` to `REVOKED` once the counter reached 5, **repeating the replay 5 times after a
  successful verification could flip an already-`VERIFIED` challenge to `REVOKED`**, which
  would have made `completeRegistration()` (which requires `status === 'VERIFIED'`) refuse
  an otherwise legitimate, already-verified registration. This was a latent, more severe
  defect than the reported off-by-one; it shared the exact same root cause and is fixed by
  the same change. It is covered by new test `19d`.

## 3. Intended / corrected semantics

- Attempts 1–4 wrong → `MISMATCH`, `attempt_count` increments 1-for-1, `status` stays
  `ACTIVE`.
- Attempt 5 wrong → `MISMATCH`, `attempt_count` reaches the cap (5). The challenge is now
  **locked by virtue of `attempt_count >= REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS`** — this is
  already an existing, independent guard in `verifyOtp()`
  (`if (challenge.attemptCount >= REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS) return fail('LOCKED')`)
  that simply needed to stop being undermined by the unconditional increment elsewhere.
- Attempt 6 (and 7, 8, …) — correct or wrong — is rejected as `LOCKED` and **must never
  move `attempt_count` past 5, ever again**, because no further genuine comparison against
  the OTP hash should be charged once the budget is exhausted.
- `status` is **not** used to represent "attempts exhausted". `status` stays `ACTIVE` for a
  locked-by-attempts challenge. `REVOKED` is reserved exclusively for **supersession by a
  fresh OTP request** (`requestOtp()`'s resend path) and `EXPIRED` for the TTL boundary.
  Overloading `REVOKED` for both meanings (as the old code did) made a locked-but-live
  challenge indistinguishable from a resend-superseded one, and (per §2) could corrupt a
  `VERIFIED` challenge's status via replay. This matches the entity's own documented status
  machine (`ACTIVE → VERIFIED | EXPIRED | REVOKED`) and the pre-existing test suite's
  expectation (`status` stays `'ACTIVE'` through the lockout in proof 19).

## 4. The fix

`src/customer-registration/customer-registration.service.ts`, inside `verifyOtp()`'s
`fail()` closure: the attempt-count increment and the time-based `EXPIRED` status
transition are now gated to the specific failure reasons that represent a genuine,
in-budget action against a still-live challenge:

```ts
const isGenuineAttempt = reason === 'MISMATCH';
const flipsToExpired = reason === 'EXPIRED';
if (isGenuineAttempt) {
  challenge.attemptCount += 1;
}
if (flipsToExpired) {
  challenge.status = 'EXPIRED';
}
if (isGenuineAttempt || flipsToExpired) {
  await repository.save(challenge);
}
```

The erroneous `attemptCount >= MAX → status = 'REVOKED'` transition is removed entirely:
lockout is represented purely by `attempt_count >= REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS`
while `status` remains `ACTIVE`, matching §3. All other rejection reasons
(`NO_CHALLENGE`, `ALREADY_VERIFIED`, `CHALLENGE_INACTIVE`, `LOCKED`) now only write an audit
record — no state mutation at all, because the request never reached a real OTP
comparison.

No change was needed to, and none was made to, the independent `LOCKED` guard itself
(`attempt_count >= MAX`) or to the successful-verification path — both were already
correct.

## 5. Concurrency analysis

`verifyOtp()`'s transaction already used `SERIALIZABLE` isolation plus
`.setLock('pessimistic_write')` on the single challenge row read, which prevents two
concurrent requests from ever reading the same pre-increment `attempt_count` and both
writing the same post-increment value (the classic lost-update race that would let more
than 5 genuine attempts through). This is proven by new test `19e`, which fires 6
simultaneous wrong-code requests at the same challenge and asserts the final persisted
`attempt_count` never exceeds 5.

One gap was found and fixed as the smallest safe correction, reusing an **existing**
pattern already established elsewhere in this codebase (the B2F policy services in
`src/policy/*.ts`) rather than inventing new locking: `verifyOtp()`, `requestOtp()`, and
`completeRegistration()` called `this.dataSource.transaction('SERIALIZABLE', ...)` directly,
with no retry on PostgreSQL's `40001`/`40P01` (serialization failure / deadlock) errors —
which a `SERIALIZABLE` transaction can still raise even under a row lock, under real
contention. All three call sites now go through the existing
`runSerializableWithRetry()` helper (`src/common/serializable-transaction.ts`,
`MAX_SERIALIZABLE_ATTEMPTS = 3`), exactly as already used by
`src/policy/b1-payment-term.service.ts`, `b2f-account-mapping.service.ts`,
`b2f-accounting-treatment.service.ts`, `b2f-finance-control.service.ts`,
`b2f-fiscal-period.service.ts`, and `b2f-journal-governance.service.ts`. This bounds
transient contention to a client-visible `ConflictException` (409) after 3 attempts instead
of a raw, unretried database error — it is a drop-in substitution of the transaction-runner
function, not a new locking architecture.

**Residual, documented, out-of-scope finding**: under very high concurrency (6+ simultaneous
requests against the same phone's verify-rate-limit bucket) a minority of requests can still
surface as `503` from the separate, pre-existing `A2SecurityRateLimitService.consume()`
(`src/authorization/security-rate-limit.service.ts`), which catches *any* transaction error
from its own internal `SERIALIZABLE` + `pessimistic_write` rate-bucket update and
unconditionally rethrows `ServiceUnavailableException`, with no retry at all — even for the
same retryable `40001`/`40P01` codes that `runSerializableWithRetry` already handles
elsewhere. This is a shared, repo-wide component (it also gates Agent/Workforce rate
limits); it is **not** part of the OTP-lockout code path and is explicitly **not modified**
by this task to avoid uncontrolled scope expansion. Recommended as a follow-up: apply the
same `runSerializableWithRetry` substitution to `A2SecurityRateLimitService.consume()`.
Test `19e` tolerates `503` for this reason while still proving the OTP attempt-counter
itself never over- or under-counts.

## 6. Related OTP / attempt-counter implementations audited (not modified)

Per the task's instruction to find but not blanket-fix every attempt-counter in the
codebase, the following were traced from source:

| Implementation | File(s) | Finding |
|---|---|---|
| Customer registration OTP (this task) | `src/customer-registration/*` | Fixed — see above. |
| Customer password-login lockout | `src/customer-authentication/customer-authentication.service.ts` (`MAX_FAILED_AUTHENTICATIONS = 5`), `authentication-execution.service.ts` | **Different, already-correct design.** A dedicated `accountLocked` boolean on the credential is checked by `credentialAvailability()` *before* any password comparison or call to `recordFailedAuthentication()`; a locked credential never reaches the increment path. Not the same code path; no defect found. |
| Agent transaction PIN lockout | `src/agent-authentication/*` | Previously audited and secured under V1-AGENT-05 (separate task); reuses `AgentAuthenticationService`'s shared 5-attempt lockout machinery, already verified correct. Not touched here. |
| Agent Cash→Cash claim transfer-code lockout | `src/agent/agent-cash-to-cash-claim.service.ts` (`MAX_FAILED_ATTEMPTS = 5`, `is_locked` boolean + `failed_attempts` column on `cash_to_cash_transfers`) | **Different design, not the same shared code path** — explicitly out of scope to fix. Uses a dedicated `is_locked` boolean checked *before* any code-comparison/increment, so it does **not** share this task's root cause. A separate, minor observation (not fixed, not in scope): the failed-attempt read and the `UPDATE ... SET failed_attempts=...` are two unguarded, non-transactional `this.dataSource.query()` calls rather than one locked read-modify-write, so two truly concurrent wrong-code submissions could both compute the same `nextAttempts` and *undercount* (never overcount/bypass the lock). Documented for a future, separate task. |
| MFA challenges (`mfa_challenges`, used by Agent-desk Wallet→Cash and Cash→Cash claim OTP) | `src/customer-authentication/mfa-execution.service.ts`, `mfa-challenge.entity.ts` | **No attempt-count/lockout concept exists at all** — the entity has no `attempt_count` column. A wrong guess (`MISMATCH`) leaves the challenge `ACTIVE` and audits a failure; only expiry or success changes status. This is a materially different, single-budget-free design (bounded only by the challenge TTL). Out of scope; no defect of this class is applicable. |
| Customer password-reset tokens / recovery codes | `src/customer-authentication/password-reset-token.entity.ts`, `recovery-code.entity.ts` | No `attempt_count` column; these are long, cryptographically-random, single-use tokens delivered out-of-band (not a short numeric code guessed by the user), so this bug class does not apply. |
| Shared SERIALIZABLE-retry infrastructure | `src/common/serializable-transaction.ts`, used by `src/policy/b1-payment-term.service.ts` and 5 other B2F policy services | Pre-existing, established pattern; now also adopted by `customer-registration.service.ts` (§5). |
| Shared rate-limiter concurrency fragility | `src/authorization/security-rate-limit.service.ts` | Related finding, **not fixed** — see §5 residual finding. |

## 7. Tests added / corrected

All in `test/v1-customer-onboarding-01.integration.spec.ts` (real PostgreSQL, no mocking):

- **19** (existing, strengthened): walks each of the 5 permitted wrong attempts
  individually, asserting `attempt_count` advances 1,2,3,4,5 and `status` stays `ACTIVE`
  at every step; then asserts the 6th attempt (with the *correct* code) is rejected and
  `attempt_count` stays at 5, not 6; then asserts a 7th/8th probe still never moves it past 5.
- **19a** (new): the correct code presented as exactly the 5th attempt (after 4 prior wrong
  ones) still succeeds — proves the fix does not introduce a new off-by-one in the opposite
  (too-strict) direction.
- **19b** (new): a locked-out challenge cannot be rescued by the correct code, repeated
  across 3 further post-lockout probes; `attempt_count` and `status` stay pinned.
- **19c** (new): a time-expired, never-guessed-against challenge flips to `EXPIRED` but is
  never charged against the attempt budget (`attempt_count` stays 0).
- **19d** (new): replaying the correct code 6 times after a successful verification is
  completely inert — `attempt_count` stays 0, `status` stays `VERIFIED` (proving the
  previously-latent VERIFIED→REVOKED corruption path from §2 cannot occur), and
  `completeRegistration()` still succeeds afterwards.
- **19e** (new): 6 simultaneous wrong-code requests against the same challenge never push
  `attempt_count` past 5 and never produce a `200`, proving the concurrency guard from §5.
- Existing proofs 16, 17, 20, 21, 22, 23, 24, 25/26 were re-verified unchanged and still
  pass against the new implementation (no test was weakened to accommodate the old buggy
  behaviour).

## 8. Exact test results (fresh runs this session)

- `test/v1-customer-onboarding-01.integration.spec.ts` (real PostgreSQL): **20/20 passing**
  (was 14/15, with proof 19 failing, before the fix).
- `test/customer-registration.service.spec.ts` (unit): **7/7 passing**, unchanged.
- `npx tsc --noEmit` (backend): clean, no errors.
- Full backend unit suite (`npx jest --runInBand`, clean environment — see note below):
  **171/171 suites, 1797/1797 tests passing.**
- Full backend integration suite (`npx jest --config jest.integration.config.js --runInBand`,
  real embedded PostgreSQL): **76/79 suites passing, 1576/1580 tests passing.** The 3
  remaining failing suites (4 failing tests) are **pre-existing and unrelated** to this
  change — the same three were already failing before this task started, per the session's
  recorded baseline, and are reproduced here with the exact same root causes:
  - `v1-hardening-06-admin-customer-investigation.integration.spec.ts`: asserts a hard-coded
    migration count/list that is stale relative to the current migration chain (unrelated
    schema-inventory test, last touched long before this task).
  - `v1-workforce-bootstrap-01.integration.spec.ts`: `ENOENT` — reads a
    `docs/config/v1-workforce-bootstrap.env.template` file that does not exist in this
    checkout (missing fixture asset, unrelated to OTP).
  - `migration-chain.integration.spec.ts`: asserts an exact count of 80 migrations; the
    chain currently has 81. Unrelated to this task (no migration was added or removed by
    this fix — see §9).
  - `v1-customer-onboarding-01.integration.spec.ts` is **no longer** in this failing list —
    it is the suite this task fixed.
- Customer Mobile app (`apps/customer-mobile`): `npx tsc --noEmit` clean;
  `npx jest --watchAll=false`: **10/10 suites, 47/47 tests passing**, including
  `__tests__/registration.test.tsx` — no API contract change was made (same endpoints,
  same request/response shapes), so no mobile code changes were required.

**Note on environment**: this sandbox's `node_modules` and embedded PostgreSQL data
directory are not persisted between sessions; `npm ci` (root and `apps/customer-mobile`)
and the bundled `scripts/embedded-pg.js` were (re-)run at the start of this task before any
test was executed. One transient, environment-only false failure
(`test/partner-connection.service.spec.ts`) was observed when unit tests were run with the
full `.env.example` sourced into the shell (it sets several `A6_PARTNER_*` variables to an
empty-but-defined string, which the partner-connection status check treats as "configured");
re-running with a clean shell environment reproduced the true, unaffected baseline
(171/171 suites). This is a pre-existing test/environment-coupling artifact, not caused by
or related to this fix, and is not claimed as resolved by this task.

## 9. Registration regression (task §6)

Full flow PHONE → OTP REQUEST → OTP VERIFICATION → REGISTRATION → CUSTOMER CREATED →
WALLET PROVISIONED → LOGIN continues to pass end-to-end, exercised by the existing
real-PostgreSQL integration proofs (1, 2, 11) and by proof 19a/19d added this task (which
both complete a full `verifyOtp()` → `completeRegistration()` round trip after the fix).
No separate wallet-provisioning or login test was modified; none needed to be, since the
fix is confined to `verifyOtp()`'s failure-bookkeeping and does not touch
`completeRegistration()`'s business logic (only its transaction now retries safely — see §5).

## 10. Migration impact

**No migration was created or is required.** The `customer_registration_phone_challenges`
table and its `attempt_count` / `status` columns, constraints
(`chk_reg_phone_challenges_attempts: attempt_count >= 0`), and indexes already fully
support the corrected semantics; this was a pure service-logic fix (§4) plus a transaction
runner substitution (§5). No new column, index, or check constraint was needed, and none was
added.

## 11. Remaining findings / recommended follow-ups (not fixed in this task)

1. `A2SecurityRateLimitService.consume()` lacks retry-on-serialization-failure and converts
   any transaction error into a blanket `503` (§5) — repo-wide, shared component;
   recommend applying `runSerializableWithRetry` there as a dedicated follow-up.
2. `agent-cash-to-cash-claim.service.ts`'s transfer-code failed-attempt counter uses two
   unguarded, non-transactional queries (read then update) rather than one locked
   read-modify-write — a minor, non-exploitable (undercounts, never bypasses the lock)
   concurrency gap, different file/entity, out of scope here (§6).
3. The 3 pre-existing failing integration suites from §8 (`v1-hardening-06-admin-customer-investigation`,
   `v1-workforce-bootstrap-01`, `migration-chain`) are unrelated to OTP/registration and were
   not investigated or fixed as part of this task.
4. No in-app secure recovery exists for a customer whose registration OTP challenge becomes
   permanently locked within its TTL — by design, they must wait for the 5-minute challenge
   TTL to expire and request a fresh OTP (the resend-cooldown-bounded `requestOtp()` path),
   which is intended, bounded, enumeration-safe self-service behaviour, not a gap.

## 12. Commits

- `fix(auth): enforce OTP maximum attempt boundary` — the service fix (§4), the
  `runSerializableWithRetry` adoption (§5), and the new/strengthened tests (§7) in a single
  commit.
- This documentation file, committed separately per the task's change-control guidance.

Exact commit hashes are stated in the final report delivered alongside this document (doc
commits are necessarily authored after the code commit and cannot self-reference their own
resulting HEAD).
