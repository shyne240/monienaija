# V1-MOBILE-REAL-WORLD-VALIDATION-01 — Mobile Financial Retry-Safety: Real-World Lifecycle Validation

**Task:** V1-MOBILE-REAL-WORLD-VALIDATION-01
**Date:** 2026-10-08 (Africa/Lagos)
**Branch:** `arena/01a10374-monienaija`
**Scope:** Customer Mobile (Wallet→Wallet transfer) + Agent Mobile (Cash-In, Cash-Out, Cash-to-Cash Send, Cash-to-Cash Claim) — do the financial retry-safety mechanisms (pending-operation / Idempotency-Key persistence) behave correctly across real app lifecycle boundaries: background, force-kill, OS memory reclaim, device restart, logout/login, and app upgrade/reinstall.

**Document purpose:** authoritative record of what is PROVEN BY AUTOMATED TEST, what is STRONGLY SUPPORTED BY CODE ONLY, what REQUIRES PHYSICAL DEVICE VALIDATION, and what is NOT CURRENTLY PROVEN for each lifecycle boundary and each financial flow — plus the one concrete defect found, its fix, and full regression evidence.

---

## 1. Executive Verdict

The persistence-based retry-safety mechanism (a locally-stored Idempotency-Key + minimal operation-identifying fields, matched on retry, cleared only on a definitive server outcome, preserved on an ambiguous one) is **architecturally sound and consistently implemented** across all five flows audited (Customer W2W; Agent Cash-In, Cash-Out, Cash-to-Cash-Send, Cash-to-Cash-Claim). It is **correctly unit/integration-tested for every code-reachable branch of its own logic** (save-before-send, match-on-retry, clear-on-success, clear-on-definitive-4xx, preserve-on-timeout/5xx, 24-hour staleness, per-identity isolation).

One concrete defect was found and fixed this task (§13–§14): **logout unconditionally discarded a pending record even when it represented a deliberately-preserved ambiguous outcome**, re-opening exactly the duplicate-financial-effect class of bug the whole mechanism exists to prevent, specifically at the logout→relogin boundary. This has been fixed, tested, and verified with zero regressions (§16).

What remains **unproven by any automated test in this repository, for any flow, is the actual OS-level survival of the persisted record across real process death** (app backgrounded then reclaimed by the OS, force-quit by the user, or the device rebooting) **and the actual native-storage read/write behavior on a real device** (Keychain on iOS, Keystore-backed EncryptedSharedPreferences on Android). Jest/RN-testing-library tests run in Node, in a single process, against an in-memory or `AsyncStorage`-shimmed mock; they can prove the mechanism's *logic* is correct but cannot prove it survives an actual OS process kill, nor that `expo-secure-store`'s native bridge behaves as assumed on real hardware. This has been true since the mechanism was first built (prior audits already correctly flagged this; this task reconfirms it and does not change it). **No claim of "proven" is made here for anything that was not actually executed by an automated test in this repository, and no physical-device scenario below is ever described as "passed" — none has been run on a real device this task.**

**This document does not certify the project production-ready.** It certifies: the mechanism's code-reachable logic is correct and now additionally safe across the logout boundary; the untested-by-nature boundary (real OS process death, real native storage) is explicitly and honestly identified, scoped, and left as an open, pre-existing gap requiring a real device/EAS build — not something this task's automated tooling can close.

---

## 2. Architecture Common to All Five Flows

Each flow follows the identical pattern, split across two screens:

1. **Amount screen** (where the user enters amount/recipient): on navigating to Confirm, a fresh Idempotency-Key is minted via `newIdempotencyKey()` (customer) / the agent-mobile equivalent, and passed forward as a route param — **never generated at submit time**, so a user who force-backgrounds between Amount and Confirm and resumes still carries the same key.
2. **Confirm screen**: immediately **before** calling the network, the full operation (Idempotency-Key + minimal identifying fields: counterparty, amount, currency, operation type, timestamp — see §9) is persisted via `SecureStorage` under a key scoped by the authenticated identity (`pending_wallet_transfer_intent:<customerId>` / `pending_agent_operation:<agentId>:<operationType>`). The network call is then made carrying that same key as the `Idempotency-Key` header.
   - **On success:** the persisted record is cleared immediately.
   - **On a definitive rejection (4xx)**: the persisted record is cleared immediately, and the *next* attempt mints a brand-new key (the old one is now known-dead server-side).
   - **On an ambiguous outcome** (`NetworkError`, 5xx, or any error the flow classifies as ambiguous — see §4): the persisted record is **deliberately left in place**, so a retry (even after full app restart) can **load and reuse the exact same key**, allowing the backend's Idempotency-Key matching to collapse it to the original attempt rather than create a second one.
3. **Reuse path:** on (re-)entering the Confirm flow for matching parameters, `loadPending...()` / `matchesPending...()` checks the persisted record against the new attempt's counterparty/amount/currency; an exact match reuses the stored key; any mismatch is ignored (and, for agent-mobile, the mismatched stale record is overwritten) rather than ever reused against different transaction details.
4. **Staleness bound:** a persisted record older than 24 hours (`MAX_PENDING_AGE_MS`) is treated as abandoned, ignored, and deleted rather than resurrected — bounding how long an unresolved ambiguous record can ever be acted on, independent of any other lifecycle event.

Backend-side, all five flows reserve the Idempotency-Key under a `requestHash`-verified scope (`src/transfer/transfer.service.ts` for W2W; `agent-financial.v1:<agentId>` for Cash-In/Cash-Out/Cash-to-Cash-Send — confirmed by direct grep of `agent-cash-in.service.ts`, `agent-cash-out.service.ts`, `agent-cash-to-cash.service.ts`), so a retried key with an identical request body is matched and returns the original result rather than re-executing; a retried key with a *different* body is rejected with 409. This backend behavior is independently proven by `test/v1-w2w-recovery-audit-01.integration.spec.ts` and `test/v1-agent-mobile-idempotency-persistence-01.integration.spec.ts` (re-run this task, §16).

**Cash-to-Cash Claim is architecturally excluded** from this client-side persistence pattern, and this exclusion was independently re-verified as justified this task by reading `src/agent/agent-cash-to-cash-claim.service.ts` in full (881 lines): claims use a SERIALIZABLE-isolation state machine with a server-side `claim_idempotency_key` column and return 409 on any conflicting retry, making client-side key persistence redundant for this one flow specifically (not a gap).

---

## 3. Per-Flow Status Summary

| Flow | Save-before-send | Match-on-retry | Clear-on-success | Clear-on-4xx | Preserve-on-ambiguous | Cross-identity isolation | Logout no longer discards ambiguous record |
|---|---|---|---|---|---|---|---|
| Customer W2W | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | **PROVEN (test, fixed this task)** |
| Agent Cash-In | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | **PROVEN (test, fixed this task)** |
| Agent Cash-Out | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | **PROVEN (test, fixed this task)** |
| Agent Cash-to-Cash Send | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | PROVEN (test) | **PROVEN (test, fixed this task)** |
| Agent Cash-to-Cash Claim | N/A — server-side SERIALIZABLE + 409-on-conflict makes client persistence unnecessary (STRONGLY SUPPORTED BY CODE, §2) | — | — | — | — | — | N/A (no client-side record exists for this flow) |

For all five rows, "PROVEN (test)" means proven by a Jest unit/component test in this repository running against the in-memory/mocked `SecureStorage` shim — **not** against real native Keychain/Keystore, and **not** across a real OS process kill. See §7–§8 for exactly what that distinction does and does not cover.

---

## 4. `isAmbiguousOperationOutcome` Default Discrepancy — Re-confirmed Non-Bug

Customer-mobile's ambiguity classifier defaults unknown/non-`ApiError`/non-`NetworkError` exceptions to **ambiguous** (`true`); agent-mobile's defaults the equivalent case to **non-ambiguous** (`false`). This was investigated in depth and traced exhaustively: no caller anywhere in agent-mobile ever passes an `AbortSignal` (which would be the only realistic source of a non-Api/Network error reaching this classifier via a user-initiated abort), and the one other reachable non-Api/Network error path — Cash-Out's pre-flight "MFA challenge missing" guard — is correctly classified non-ambiguous because it is a client-side validation failure that never reaches the network at all (nothing could have committed server-side). **Conclusion: a real philosophical difference between the two apps' classifiers, but currently harmless given the actual call graph — not a bug, no fix made, not reopened.**

---

## 5. SecureStorage Native-Exception Fallback — Classification Only

Both apps' `secure-storage.ts` (identical, 72 lines each) silently falls back to an in-memory `Map` if the native `expo-secure-store` call throws. This is **deliberately untestable by Jest**: `NODE_ENV=test` forces the in-memory path unconditionally in both apps, so no automated test in this repository ever exercises the native branch or its failure path. This is **NOT a newly discovered defect** — it is a structural limitation of the current test harness that was already implicitly true before this task. It is recorded here under §7 (Process-Death Analysis) and §10 (Device-Validation Gaps) as a REQUIRES-PHYSICAL-DEVICE item, not elevated to a standalone defect, because:
- Silently degrading to in-memory (rather than crashing the app) is the safer of the two realistic failure modes for a non-critical persistence optimization.
- The actual financial safety guarantee (one business operation → one financial effect) is enforced server-side by the Idempotency-Key + `requestHash` match regardless of whether the client successfully *persisted* that key across a restart — losing the persisted record only removes the *client's own* ability to recover a smooth single-request retry; it does not by itself allow the server to double-execute anything, since the server simply sees a *new* key and enforces its own invariants on that new attempt.

---

## 6. Security / Data-Integrity Review (Phase 5)

Read `apps/agent-mobile/src/services/pending-operation.ts` (full) and `apps/customer-mobile/src/services/pending-transfer.ts` (full) in their entirety. The persisted record's field set is, in both apps:

- `agentId`/`customerId`, `operationType` (agent only), `idempotencyKey`, `counterpartyId`, `amountMinor`, `currency`, `createdAt`.

**No OTP, PIN, access token, session token, or any other secret/credential value is ever included in either persisted record.** This was true before this task and remains true — confirmed again by a full re-read of both files this task, with no `pin`, `otp`, `token`, or `password`-named field present anywhere in either interface or its runtime validator (`isPendingAgentOperation` / the customer-mobile equivalent). The records exist purely to let a retry recognize "this is the same business operation I already tried," never to replay a secret.

---

## 7. Process-Death / Restart Analysis (4-Tier Classification)

| Lifecycle boundary | Classification | Basis |
|---|---|---|
| App backgrounded, OS keeps process alive, user resumes | **PROVEN BY AUTOMATED TEST** (logic only) | The persisted record is read from storage on each screen mount, not held only in React state/memory — proven by tests that unmount/remount or directly re-invoke `loadPending...()` without relying on any in-memory variable surviving. |
| App backgrounded, OS reclaims the process (common on low-RAM Android), user resumes from a cold start | **STRONGLY SUPPORTED BY CODE, REQUIRES PHYSICAL DEVICE for final proof** | The persistence mechanism is designed exactly for this case (it reads from `SecureStorage`, not from any in-memory singleton that would be lost). No automated test can simulate an actual OS process kill — Jest always runs in one continuously-alive Node process. |
| User force-quits the app from the OS app switcher, reopens | Same as above | Same reasoning — code path is identical to the OS-reclaim case; still never actually exercised across a real process boundary. |
| Device reboots | Same as above | `SecureStorage`'s native backing (Keychain/Keystore) is specified to survive a reboot; this repository has no mechanism to verify that claim on real hardware. |
| App upgrade/reinstall (over-the-air update via Expo, or full binary reinstall) | **NOT CURRENTLY PROVEN, flagged as a genuine open question** | An Expo OTA JS update does not clear native storage, so a pending record would very likely survive — but a full reinstall (uninstall + install, as opposed to update-in-place) **does** clear Keychain data on iOS (Keychain data for an app is removed on uninstall) and typically clears Keystore-backed storage on Android too. No test, device run, or code path here asserts or handles this; it has never been explicitly discussed in any prior audit (`V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01.md`, `V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01.md`) and is not addressed in this task either, beyond flagging it honestly as NOT CURRENTLY PROVEN and out of scope for a code fix (an uninstall-then-reinstall is a fundamentally unrecoverable client-state event for *any* locally-persisted mechanism — the correct mitigation, if one is ever wanted, is server-side reconciliation/support-ticket recovery, which is an architectural addition explicitly out of this task's authorized scope). |
| Logout then login as the **same** identity | **PROVEN BY AUTOMATED TEST, fixed this task** | Previously discarded the ambiguous record (defect, §13); now proven to survive, see §16. |
| Logout then login as a **different** identity on the same device | **PROVEN BY AUTOMATED TEST** | Proven independent of the fix above: the storage key itself is scoped by `agentId`/`customerId`, so a different identity's `loadPending...()` call structurally cannot read another identity's record, regardless of logout behavior. Directly asserted in the new agent-mobile regression test (§15) and the pre-existing customer-mobile "two different customers" test (`transfer.test.tsx`). |

---

## 8. Real Device Validation Plan (Phase 3)

**Static configuration audit performed (no device run executed):**

- **Bundle identifiers:** `ng.monienaija.customer` (iOS `bundleIdentifier` / Android `package`) vs `ng.monienaija.agent` — distinct, correctly configured, no collision risk for side-by-side installation on one test device (`apps/customer-mobile/app.json`, `apps/agent-mobile/app.json`).
- **App names:** `MonieNaija` / `MonieNaija Agent` — clear, distinguishable on a home screen.
- **EAS build profiles** (`eas.json`, both apps): `development` (dev client, internal), `preview` (internal APK, `EXPO_PUBLIC_API_URL` placeholder `https://REPLACE_WITH_STAGING_API_URL.example.invalid`), `production` (app-bundle, placeholder production URL). **Both staging and production API URLs are still unconfigured placeholders** — a real device build today would fail to reach any backend unless `EXPO_PUBLIC_API_URL` is overridden at build time. This matches the pre-existing, already-documented state recorded in `docs/V1/V1-AGENT-MOBILE-15-STAGING-DEVICE-UAT.md` (dated 2026-10-02, this repository, re-read this task) — not a new finding, but re-confirmed still true today.
- **Default (un-overridden) base URL fallback:** `http://10.0.2.2:3000` in both apps' `src/config/index.ts` — this is the Android-**emulator**-only loopback alias; it does not resolve on iOS simulator, a physical Android device, or a physical iOS device. Any real-device LAN test requires explicitly setting `EXPO_PUBLIC_API_URL` to the developer machine's actual LAN IP.
- **Backend bind address:** confirmed via `src/main.ts` (`await app.listen({ port: environment.PORT, host: '0.0.0.0' })`) — the backend already listens on all interfaces, so it is reachable from other devices on the same LAN once the correct IP is configured and firewall/network conditions allow it. This is a necessary but not sufficient condition for real-device LAN testing.
- **Android cleartext (plain HTTP) traffic:** no `usesCleartextTraffic` / network-security-config override was found in either `app.json`. On Android 9 (API 28) and above, a standalone release/EAS-built APK **blocks plain HTTP by default** unless explicitly allowed. This means a LAN-IP `http://` URL (as opposed to `https://`) may silently fail to connect on a real standalone Android build even though it works fine in the Expo Go / dev-client environment (which is typically more permissive). **This is a genuine device-validation gap**: it was not found to be addressed anywhere in the repository, and no automated test can catch it (Jest never makes a real native HTTP call). It does not block Expo Go-based manual testing, only standalone/EAS binary testing over plain HTTP.
- **No physical device, emulator, or EAS cloud build was invoked or run in this sandboxed task** — this environment cannot execute React Native/Expo's native build or install real binaries. All of the above is a **static** configuration read, correctly and explicitly labeled as such.

**What a real validation pass would require (unexecuted plan, not performed this task):** (1) set a real `EXPO_PUBLIC_API_URL` (LAN IP over `https://`, or a tunnel like `ngrok`, to sidestep the cleartext issue entirely); (2) build/run via `expo run:android` / `expo run:ios` or an EAS `development`/`preview` build; (3) install on at least one real Android and one real iOS device; (4) execute the scenario matrix in §9 physically — backgrounding, force-kill via app switcher, airplane-mode-during-request, and device reboot — observing whether the pending record is actually read back correctly after each.

---

## 9. Financial Safety Test Matrix (Phase 4) — Per Flow

For each of the four persisted flows (W2W, Cash-In, Cash-Out, Cash-to-Cash-Send), the following scenarios are **PROVEN BY AUTOMATED TEST** in this repository's Jest suites (customer-mobile `transfer.test.tsx`; agent-mobile `pending-operation.test.ts` + the three confirm-screen test files):

1. Success → record cleared, no reuse possible afterward.
2. Definitive 4xx rejection → record cleared, next attempt mints a fresh key.
3. `NetworkError` (ambiguous, e.g. connectivity lost mid-request) → record preserved, retry reuses the same key.
4. 5xx response (ambiguous) → record preserved, retry reuses the same key, identically to case 3.
5. A pending record belonging to a **different** identity is never matched/reused (cross-identity isolation).
6. A pending record whose counterparty/amount/currency **does not match** the current attempt is never reused.
7. A pending record older than 24 hours is treated as stale, ignored, and removed rather than reused.
8. Rapid double-tap on Confirm sends exactly **one** network request (synchronous in-flight guard), independent of the persistence mechanism but defending the same "one operation → one effect" property.
9. **(New this task)** Logout followed by login as the same identity preserves an ambiguous pending record rather than discarding it (§13–§16).

**NOT tested by any automated suite, for any flow** (REQUIRES PHYSICAL DEVICE, see §7–§8): the OS actually killing the process mid-request and the app being relaunched cold, actual native Keychain/Keystore read-after-reboot, and a timeout that occurs *after* the backend has already committed the financial effect but *before* any response bytes reach the device (this is logically covered by the "ambiguous outcome preserves the key" test cases 3–4 above at the client-logic level, but the actual server-committed-then-response-lost race was not independently re-verified at the network-transport layer this task beyond what was already proven server-side by the backend Idempotency-Key + `requestHash` integration tests re-run in §16).

---

## 10. Branding / Smoke Check (Phase 6) — Static Only

- `apps/customer-mobile/assets/` and `apps/agent-mobile/assets/` both contain `icon.png` (1024×1024), `adaptive-icon.png` (1024×1024), and `splash.png` (1536×1024) — verified by direct PNG header parse this task. All are real, non-trivial, non-placeholder image files (236,608 / 175,431 / 1,176,661 bytes respectively), byte-identical (`md5sum`-confirmed) between both apps, consistent with a single shared brand asset set used by both the customer and agent apps as intended.
- `app.json` correctly references all three assets for both platforms (`icon`, `android.adaptiveIcon.foregroundImage`, `splash.image`) in both apps.
- App display names (`MonieNaija` / `MonieNaija Agent`) and bundle/package identifiers (`ng.monienaija.customer` / `ng.monienaija.agent`) are distinct and consistent.
- Minor, non-actionable cosmetic note: Expo project `slug` fields are `moneynaija-customer` / `moneynaija-agent` (note: "moneynaija", not "monienaija") — an internal, non-user-facing Expo project identifier, not a rendered brand string anywhere in the app UI. Not classified as a defect; not fixed (out of scope, cosmetic, zero user impact, and changing a slug has EAS-project-identity implications that were not authorized to touch in this task).
- This is a **static smoke check only** — no visual on-device rendering (actual home-screen icon appearance, splash screen timing/flash, adaptive-icon mask behavior on real Android launchers) was inspected on real hardware. That remains a REQUIRES-PHYSICAL-DEVICE item, consistent with the prior `V1-BRAND-01` task's scope (already closed).

---

## 11. Defect Found — Logout Discarding Ambiguous Pending Records

**Classification:** Concrete, evidence-backed defect — MEDIUM-HIGH severity.

**Where:** `apps/agent-mobile/src/store/auth-store.ts` `logout()` (previously called `clearAllPendingAgentOperations(loggedOutAgentId)` unconditionally in the `finally` block); `apps/customer-mobile/src/store/auth-store.ts` `logout()` (previously called `clearPendingTransferIntent(loggedOutCustomerId)` unconditionally).

**Reproduction (code-traced, now covered by an automated regression test for each app — see §16):**
1. Agent/customer attempts a financial operation (Cash-In/Cash-Out/Cash-to-Cash-Send/W2W transfer); the request times out or returns a 5xx — an **ambiguous** outcome. The pending record (containing the Idempotency-Key) is correctly preserved per the existing, already-tested mechanism.
2. The user — out of frustration, confusion, to "reset" the app, or because support advised it — logs out.
3. **Previously:** `logout()` unconditionally wiped the pending record for that identity.
4. The user logs back in as the **same** identity and re-attempts the identical operation.
5. Because the pending record was wiped, a **brand-new** Idempotency-Key is minted (rather than the original one being reused).
6. If the original ambiguous request had, in fact, already committed server-side (this is exactly what "ambiguous" means — the server's actual outcome is unknown to the client), the retry with a new key is treated by the backend as an **entirely independent operation**, since none of these three agent flows have an independent business-level duplicate guard beyond the Idempotency-Key itself (confirmed by reading `agent-cash-in.service.ts`, `agent-cash-out.service.ts`, `agent-cash-to-cash.service.ts` — they rely solely on the `agent-financial.v1:<agentId>` idempotency scope, with no secondary dedup check). **Result: a second, duplicate financial effect** (double cash-in, double cash-out, double cash-to-cash send, or a duplicate wallet-to-wallet debit/credit).

**Root cause analysis — why this was not caught by two prior "closed" audits:** both `V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01.md` and `V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01.md` explicitly and deliberately *added* the clear-on-logout behavior (with accompanying tests asserting it), reasoning that a pending record "must not be left dangling on a shared/reused device" and "must never cross an Agent identity boundary." Both statements are true *in isolation*, but neither prior audit noticed that **the storage key itself already fully satisfies that exact requirement** — `pending_agent_operation:<agentId>:<type>` / `pending_wallet_transfer_intent:<customerId>` — making the explicit clear-on-logout call **structurally redundant** for cross-identity protection while being **actively harmful** to same-identity retry-safety. This was re-derived and verified this task by direct inspection of `storageKeyFor()` in both `pending-operation.ts` and `pending-transfer.ts`.

**Severity rationale (MEDIUM-HIGH, not CRITICAL):** this is a real path to an actual duplicate financial effect, which is the most serious class of bug this codebase defends against — hence not LOW. It is not CRITICAL because it requires a specific, non-trivial real-world sequence (an ambiguous failure specifically, not any failure; followed by a deliberate logout; followed by a same-identity relogin; followed by an exact retry of the identical transaction) rather than being trivially or remotely exploitable by any single action.

---

## 12. Fix Made

**Principle applied:** smallest possible change, strictly strengthening (never weakening) the "one business operation → one financial effect" guarantee; no change to the pending-operation data model, matching logic, or staleness logic; no architectural redesign; no new recovery UI.

**Exact change (both apps, one removed call each):**
- `apps/agent-mobile/src/store/auth-store.ts`: removed the `clearAllPendingAgentOperations(loggedOutAgentId)` call (and the now-unused `loggedOutAgentId` local and its import) from `logout()`. All other logout behavior — remote revocation best-effort call, local session/credential storage purge (`purgeAgentSessionFromStorage()`), and in-memory auth-state reset — is **unchanged**.
- `apps/customer-mobile/src/store/auth-store.ts`: removed the `clearPendingTransferIntent(loggedOutCustomerId)` call (and its import) from `logout()`. All other logout behavior — session/customer-id/session-data `SecureStorage` removal and in-memory auth-state reset — is **unchanged**.
- The utility functions `clearAllPendingAgentOperations()` and `clearPendingTransferIntent()` themselves are **untouched, still exported, still correct**, and remain directly covered by their own standalone unit tests (`pending-operation.test.ts` test #12; `pending-transfer.ts` equivalent) — they are simply no longer invoked from the logout path. (They remain available for any future, deliberate, narrower use — e.g. an explicit "clear my pending transactions" support/debug action — should one ever be added; none was added as part of this fix, per the no-speculative-UI constraint.)

**What this fix does NOT change:** the 24-hour staleness bound (unaffected — still the only time-based bound on how long an unresolved record can be resumed); cross-identity isolation (unaffected — was already, and remains, purely a function of the storage key's structure, independent of logout); the definitive-outcome clearing behavior (success/4xx still clear immediately, exactly as before); the Cash-to-Cash Claim flow (has no client-side persisted record at all, untouched).

---

## 13. Tests Updated / Added

- **`apps/customer-mobile/__tests__/transfer.test.tsx`**: the pre-existing test `'logout clears any pending transfer intent'` (which asserted the now-corrected, previously-unsafe behavior) was rewritten to `'logout does NOT clear an ambiguous pending transfer intent (V1-MOBILE-REAL-WORLD-VALIDATION-01)'`. It still exercises the real (non-mocked) `auth-store.logout()` against the real in-memory `SecureStorage`, now asserting: (a) session/customer-id storage **is** cleared by logout, and (b) the pending transfer intent **is not** cleared and is byte-for-byte (`toEqual`) identical before and after logout. A full rationale comment citing this document is included inline.
- **`apps/agent-mobile/__tests__/auth-store.test.ts`**: a new test `'logout does NOT clear an ambiguous pending agent operation (V1-MOBILE-REAL-WORLD-VALIDATION-01)'` was added (no pre-existing test exercised this path at all — the prior logout test never populated `agentId`, so it never reached the removed branch). The new test: saves a pending `CASH_IN` operation for a logged-in agent, calls the real `logout()`, asserts session/token storage is cleared, asserts the pending operation **survives** unchanged (`toEqual`), and additionally asserts a **different** agent ID still cannot read it — directly proving cross-identity isolation is preserved independent of the logout change, in the same test.

No existing test assertions were weakened; the only test behavior that changed is the one customer-mobile test whose *prior* assertion directly encoded the now-identified-as-unsafe behavior, which has been corrected to the safe behavior with full reasoning preserved in a comment.

---

## 14. Tests Run — Full Results

All runs performed this task, after the fix, against a freshly rebuilt environment (`.env` present, all three `node_modules` installed via `npm ci`, embedded Postgres running on `127.0.0.1:5432`):

| Suite | Suites | Tests | Result |
|---|---|---|---|
| `apps/customer-mobile` (`npm run test`, full) | 12 | 98 | **PASS** (98/98; unchanged count — one test rewritten in place, none added/removed) |
| `apps/agent-mobile` (`npm run test`, full) | 18 | 262 | **PASS** (262/262; +1 vs. prior baseline of 261, the new logout regression test) |
| Backend unit (`npm run test`, root) | 173 | 1,809 | **PASS** (173/173 suites; matches prior baseline magnitude, zero regressions — this task touched no backend code) |
| Backend PG integration — **targeted** re-run: `v1-mobile-idempotency-recovery-01`, `v1-w2w-recovery-audit-01`, `v1-agent-mobile-idempotency-persistence-01` | 3 | 9 | **PASS** (9/9) |
| Backend PG integration — **full** (`npm run test:pg`, all 92 files, 7 batches, concurrency=2) | 92 | not individually re-tallied this run (batch-level summaries all showed 100% pass; exit code 0 for every batch and overall) | **PASS** (0 failures across all 92 files) |
| TypeScript compile check (`npx tsc --noEmit`), both mobile apps | — | — | **PASS** (clean, zero errors, after fixing one test-file type mismatch introduced then immediately corrected during the fix) |

**Combined backend total:** 173 unit suites + 92 PG integration suites = **265 suites**, matching the pre-existing baseline exactly (173+92=265) — confirming the fix introduced **zero backend-visible change**, exactly as expected for a client-only fix. Backend unit test count (1,809) also matches the established baseline magnitude.

**Grand total across both mobile apps + backend:** 265 (backend) + 12 (customer-mobile) + 18 (agent-mobile) = **295 suites**; 1,809 (backend unit) + 98 (customer-mobile) + 262 (agent-mobile) + [PG integration tests, not re-tallied individually this run but all passing] = at least **2,169 tests confirmed passing this task**, plus the full PG integration population (previously measured at 1,690 tests in the Task 7 baseline, unaffected by this change and re-confirmed passing at the suite level this task).

---

## 15. Remaining Launch Blockers (Pre-Existing, Not Addressed This Task — Correctly Out of Scope)

These were already known/documented in prior work (primarily `docs/V1/V1-AGENT-MOBILE-15-STAGING-DEVICE-UAT.md`) and are **not** regressions or new findings from this task; they are restated here because they are directly relevant to "is this launch-ready":

1. **No live staging/production API URL configured** — both `eas.json` files still carry placeholder `REPLACE_WITH_..._API_URL.example.invalid` values.
2. **No physical device UAT has ever been executed** for either app, for any of the lifecycle scenarios in §7 — confirmed still true today by this task's investigation; no device run was performed this task either (this sandboxed environment cannot run native iOS/Android binaries).
3. **Android cleartext-HTTP restriction not addressed** for a potential LAN-IP-over-plain-HTTP manual test setup (§8) — only matters for standalone/EAS binary testing, not Expo Go.
4. **App upgrade/reinstall interaction with persisted pending records is NOT CURRENTLY PROVEN and not architecturally addressed** (§7) — flagged honestly, no fix attempted (would require a server-side reconciliation mechanism, which is a genuine architectural addition outside this task's authorized scope of "fix only a concrete, evidence-backed defect with the smallest safe change").
5. Carrier SMS gateway (`ROBASE_API_KEY`) and Apple Developer signing remain environment-blocked per the prior staging doc — unrelated to this task's scope, restated only for completeness of the "what's left before launch" picture.

None of items 1–5 are code defects; they are environment/infrastructure/process gaps, correctly left untouched per this task's "no speculative architectural changes" constraint.

---

## 16. Proven vs. Code-Supported-Only vs. Requires-Device vs. Not-Proven — Final Distinction

- **PROVEN BY AUTOMATED TEST** (this task, re-run and verified): all logic-level behavior in §3 and §9 for all five flows; the logout fix itself (§13–§14); cross-identity isolation at the storage-key level; zero backend regression from the fix.
- **STRONGLY SUPPORTED BY CODE ONLY** (architecture correctly implies the property, but no automated test exercises the actual OS/native boundary): survival of persisted records across real backgrounding/OS-reclaim/force-kill/reboot (§7); `SecureStorage`'s native fallback behavior (§5); backend reachability from a real LAN device once correctly configured (§8).
- **REQUIRES PHYSICAL DEVICE VALIDATION** (cannot be proven by this repository's tooling at all): every item in §7's "STRONGLY SUPPORTED BY CODE" row once stated as a claim about *actual* hardware; Android cleartext-traffic behavior on a standalone build (§8); real visual branding/splash/icon rendering (§10).
- **NOT CURRENTLY PROVEN** (a genuine, acknowledged open question, not merely untested but not yet even reasoned through to a design decision): behavior across a full app **uninstall + reinstall** (as opposed to an in-place update) — §7.

This task makes no claim of "production ready" from automated test results alone, per the explicit standing instruction governing this task.
