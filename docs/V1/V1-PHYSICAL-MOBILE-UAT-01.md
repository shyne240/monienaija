# V1-PHYSICAL-MOBILE-UAT-01 — Staging Readiness and Real-Device UAT Execution Plan

**Task:** V1-PHYSICAL-MOBILE-UAT-01
**Date:** 2026-10-08 (Africa/Lagos)
**Branch:** `arena/01a10374-monienaija`
**Starting commit:** `518b43a` (V1-MOBILE-REAL-WORLD-VALIDATION-01)
**Final commit:** `74247e6`

**Critical distinction maintained throughout this document:** "the repository is configured for device UAT" and "physical-device UAT has passed" are **never** conflated. No Android/iOS device or emulator was available in this environment (verified, §6–§7). No scenario below is ever reported as "passed on a device" — only as backend-API-level verified, repository-configuration verified, or not-yet-executable-here.

---

## 1. Executive Verdict

MonieNaija V1 is **closer to real-device-ready than it was this morning, but is not yet there**, and genuine physical-device UAT has **not** been performed by this task (no device/emulator exists in this sandbox — confirmed, §6–§7).

Two concrete, evidence-backed outcomes came out of this task:

1. **A real, reproducible build blocker was found and fixed.** A clean install of `apps/agent-mobile` produced a `node_modules` layout where `expo-asset` (a real dependency of the `expo` package) was not hoisted to the top level, so every Metro bundle — `expo export`, `expo start`, and therefore any real Android/iOS build — failed outright with `expo-asset cannot be found`. This was invisible to both `tsc` and Jest (neither invokes Metro), and was only caught because this task actually ran the real bundler, per the explicit instruction not to claim "build works" from TypeScript/Jest alone. **Fixed, verified reproducibly across a clean `npm ci`, committed as `74247e6`.** `apps/customer-mobile` was unaffected and bundles successfully.
2. **The real backend was exercised exactly as a mobile device would exercise it** — real HTTP over TCP (not Jest's in-process test harness) against a live NestJS process bound to `0.0.0.0:3000`, through the real customer registration (OTP via console log) → funding → transfer flow, and the real agent credential-rotation → PIN → Cash-In flow, including a genuine duplicate-request-with-identical-Idempotency-Key retry verified against the raw Postgres ledger to prove **exactly one financial effect** for two identical requests (§10–§11). This is real, but it is **backend-only** — no mobile UI, no native SecureStorage, no real device OS was involved, and it is explicitly not claimed to be.

What remains **not yet possible in this environment, and therefore genuinely unproven**: anything requiring actual mobile native code execution — a real Android/iOS install, SecureStorage's native Keychain/Keystore path, app backgrounding/force-kill/OS-reclaim, Android cleartext-HTTP behavior on a standalone binary, or real icon/splash rendering. These require Kenneth's own local machine or a real device (§12).

---

## 2. Current Staging Readiness

There is **no live staging deployment** today. `eas.json` in both mobile apps still carries literal placeholder URLs (`https://REPLACE_WITH_STAGING_API_URL.example.invalid`, `https://REPLACE_WITH_PRODUCTION_API_URL.example.invalid`) — unchanged since the prior `V1-AGENT-MOBILE-15-STAGING-DEVICE-UAT.md` audit (2026-10-02) and still true today. No production infrastructure (host, TLS certificate, DNS) exists or is invented by this task, per instruction.

**What a controlled LAN staging setup looks like instead (sufficient for first UAT — see §14 for the full recommendation):** the backend already binds to `0.0.0.0` (confirmed in `src/main.ts`) and was run live in this task on port 3000, reachable over real HTTP. A developer's own machine running the backend + embedded/local Postgres, with a phone on the same Wi-Fi network pointed at that machine's LAN IP via `EXPO_PUBLIC_API_URL`, is a complete, sufficient, zero-new-infrastructure staging environment for the first round of financial UAT. No production hosting, TLS, or DNS is required for this first pass — see §6 for the one Android-specific caveat (cleartext HTTP) this implies.

---

## 3. Backend Connectivity Requirements

| Requirement | Status |
|---|---|
| Backend binds to all interfaces (`0.0.0.0`), not just loopback | **Met** — confirmed in `src/main.ts`: `await app.listen({ port: environment.PORT, host: '0.0.0.0' })`. |
| Backend reachable over real HTTP from an external TCP client | **Proven this task** — a live `node dist/main.js` process was started and exercised via `curl` from a separate shell (real TCP, real NestJS/Fastify HTTP stack, not Jest's in-process `supertest`). |
| PostgreSQL reachable | **Met locally** — embedded Postgres (`scripts/embedded-pg.js`) starts in seconds, listens on `127.0.0.1:5432`. For a real device to reach the backend over LAN, only the *backend's* port needs to be LAN-reachable — Postgres itself never needs to be reachable from the phone. |
| HTTPS | **Not required for first controlled-LAN UAT**, but see the Android cleartext caveat in §6 — it is required specifically to avoid that one platform restriction, not for any cryptographic reason at this stage. |
| CORS | **Not applicable to mobile.** CORS is a browser-enforced mechanism; React Native's native HTTP stack is not subject to it. (This was already settled as SAFE/INTENTIONAL in a prior audit for the same reason, re-confirmed here — no CORS configuration exists in `src/main.ts` and none is needed for either mobile app.) |

---

## 4. Customer Mobile Readiness

| Aspect | Status |
|---|---|
| TypeScript compiles | PASS (`tsc --noEmit`, clean) |
| Jest suite | PASS, 98/98, 12 suites |
| Real Metro bundle (`expo export --platform android`) | **PASS** — produced a real Hermes bundle, 802 modules, reproducible. This is genuine build-tooling evidence, not inferred from tests. |
| Bundle/package identifiers | `ng.monienaija.customer` (iOS `bundleIdentifier` / Android `package`) — valid, distinct from agent-mobile. |
| API base URL | Defaults to the Android-emulator-only alias `http://10.0.2.2:3000` unless `EXPO_PUBLIC_API_URL` is set; correctly overridable per EAS build profile. |
| Real backend flow exercised | **Yes, this task** — real registration (OTP via console) → login → PIN set → funded wallet → W2W transfer → idempotent-retry proof, all over real HTTP against the real backend (§10). |
| Blockers | **None found for Android.** iOS cannot be evaluated in this Linux sandbox at all (§7). |

## 5. Agent Mobile Readiness

| Aspect | Status |
|---|---|
| TypeScript compiles | PASS (`tsc --noEmit`, clean) |
| Jest suite | PASS, 262/262, 18 suites |
| Real Metro bundle (`expo export --platform android`) | **FAILED before this task's fix, PASS after** — this was a genuine, reproducible blocker (§1, §15) found by actually running the bundler rather than trusting `tsc`/Jest. Fixed in commit `74247e6`; re-verified 3 times including after a clean `rm -rf node_modules && npm ci`. |
| Bundle/package identifiers | `ng.monienaija.agent` — valid, distinct from customer-mobile. |
| API base URL | Same pattern as customer-mobile. |
| Real backend flow exercised | **Yes, this task** — real local-dev agent creation → credential rotation → PIN set → float funding (via the real `LedgerService`, same technique as the repo's own `local-dev-fund-wallet.js`) → Cash-In → idempotent-retry proof with an explicit `"replayed": true` server response on the duplicate, all over real HTTP (§10). |
| Blockers | **None remaining** — the one found blocker (§1) is fixed. |

---

## 6. Android Readiness

| Target | Classification | Basis |
|---|---|---|
| Android emulator | **READY WITH CONFIGURATION** | No emulator/AVD/Android SDK/Java exists in this sandbox (`adb`, `emulator`, `java` all absent — verified directly), so this was never actually run on an emulator either. But both apps now produce a real, valid Metro/Hermes bundle, and `app.json`/`eas.json` are structurally correct (distinct package names, versionCode, adaptive icon). Configuration (a real `EXPO_PUBLIC_API_URL`) is the only remaining gap. |
| Physical Android device | **READY WITH CONFIGURATION, plus one real caveat** | Same as above, plus: no `usesCleartextTraffic` / network-security-config override was found in either `app.json`. On Android 9 (API 28)+, a **standalone** release/EAS-built APK blocks plain HTTP by default. A controlled-LAN staging URL using `http://<LAN-IP>:3000` would very likely be silently rejected on a real standalone install (Expo Go / a `developmentClient` dev build is typically more permissive, so this specifically affects `preview`/`production` EAS builds). **Recommendation (not implemented — a configuration decision, not a code defect):** either tunnel the LAN backend behind HTTPS for the device test (e.g. a TLS-terminating tunnel), or explicitly add Android cleartext permission for the controlled UAT build only, never for the real production profile. |

## 7. iOS Readiness

| Target | Classification | Basis |
|---|---|---|
| iOS Simulator | **NOT APPLICABLE in this environment** | iOS Simulator requires Xcode, which requires macOS. This sandbox is Linux x86_64 (`uname -a` confirmed) — categorically impossible here, not a configuration gap. |
| Physical iPhone | **NOT APPLICABLE in this environment, READY WITH CONFIGURATION in principle** | Same hard platform limitation for *building* the iOS binary in this sandbox. `app.json`'s `ios.bundleIdentifier` (`ng.monienaija.customer` / `ng.monienaija.agent`) and `buildNumber` are structurally present and correct; an EAS cloud build (which does not require local macOS) remains a real, un-invented path available to Kenneth outside this sandbox, using the same `EXPO_PUBLIC_API_URL` mechanism. |

---

## 8. Security Configuration Findings (Phase 4)

No production secrets, database credentials, API keys, signing credentials, OTP secrets, transaction PINs, or JWT secrets were found committed to any tracked file.

- `.env` is correctly git-ignored (`.gitignore` lines 4–6: `.env`, `.env.*`, `!.env.example`) and was never tracked.
- The only password-looking literals found in tracked files (`scripts/embedded-pg.js`, `scripts/infra03-seed.js`, `scripts/go-live-01-backup-drill.js`, `scripts/infra03-part-d-*.js`) are all the **same local-only embedded-Postgres development password** (`monienaija-pw`), used exclusively by this sandbox's ephemeral, non-persistent (`persistent: false`), disposable local database. This is not a production credential and was already an established, reviewed, intentional pattern from prior tasks — reconfirmed here, not re-flagged as new.
- **No JWT secret exists anywhere in the codebase.** Agent and Customer session tokens are opaque, server-generated random values (`randomUUID()`-backed), stored server-side in `agent_sessions`/`customer` session tables — there is no shared signing secret to leak in the first place, which is a safer design than JWT for this purpose.
- `NOTIFICATION_SMS_PROVIDER` correctly defaults to `console` in development and is validated by `src/config/environment.ts` to be **rejected at startup** if `NODE_ENV=production` and the provider is not explicitly `robase` with a valid `robe_`-prefixed key — there is no way to accidentally ship the console (log-only, OTP-leaking-to-stdout) provider to production undetected.
- The `console` SMS provider (`ConsoleNotificationProvider`) logs the **full message text, including the live OTP code**, to server stdout — this is by design for local development and is exactly the mechanism a tester must use to read OTP codes during manual device UAT (see §10 and §9 Test Group observability notes). This is safe only because it is provably disabled outside non-production environments (previous bullet).
- No `DEV_AUTH_MOCK` or equivalent authentication bypass exists in either mobile app today (confirmed by direct grep — agent-mobile's config file comment explicitly documents that this exception was deliberately never copied from an older customer-mobile pattern that has since been removed).

**No secrets were found that require redaction from this report.**

---

## 9. Exact Physical-Device UAT Matrix

Every scenario below that was actually exercised this task is marked **[EXECUTED — BACKEND ONLY]** with a pointer to §10/§11. Every scenario requiring a real device/native OS is marked **[REQUIRES PHYSICAL DEVICE]** — none of these were run.

### Test Group A — Customer W2W
| # | Scenario | Status |
|---|---|---|
| 1 | Normal successful transfer | **[EXECUTED — BACKEND ONLY]** — real HTTP, real DB, §10. |
| 2 | Duplicate tap | **[EXECUTED — BACKEND ONLY]** — simulated via two identical real HTTP requests with the same `Idempotency-Key`; proven to collapse to one effect at the ledger level, §10–§11. True duplicate-tap (two near-simultaneous taps from the actual UI) is **[REQUIRES PHYSICAL DEVICE]** to additionally prove the UI's in-flight guard, though that specific guard is already **PROVEN BY AUTOMATED TEST** per the prior task's Jest coverage. |
| 3 | Definitive server rejection | Already **PROVEN BY AUTOMATED TEST** (prior task's Jest + integration suites); not re-executed here. |
| 4 | Ambiguous network failure before server processing | Already **PROVEN BY AUTOMATED TEST** (Jest, mocked `NetworkError`); real-device airplane-mode timing is **[REQUIRES PHYSICAL DEVICE]**. |
| 5 | Ambiguous network failure after server processing (response lost post-commit) | **STRONGLY SUPPORTED BY CODE** (the same "ambiguous outcome preserves the key" logic covers this), but the specific physical race of "server committed, then the device's radio drops before the response frame arrives" is **[REQUIRES PHYSICAL DEVICE]**. |
| 6–7 | Kill application during ambiguous state / reopen | **[REQUIRES PHYSICAL DEVICE]** — no real OS process-kill boundary exists in this sandbox or in Jest. |
| 8 | Confirm pending operation behavior (persisted across restart) | **STRONGLY SUPPORTED BY CODE** (reads from `SecureStorage`, not memory) — real-device confirmation is **[REQUIRES PHYSICAL DEVICE]**. |
| 9 | Retry using original idempotency key | **[EXECUTED — BACKEND ONLY]** — proven at the HTTP+DB layer, §10–§11. |
| 10 | Verify exactly one financial effect in backend ledger | **[EXECUTED — BACKEND ONLY]** — this is the authoritative proof in §11, independent of which client (device or curl) produced the two requests. |

### Test Group B — Agent Cash-In
Same ten categories; #1, #2, #9, #10 **[EXECUTED — BACKEND ONLY]** this task (§10–§11, including the explicit `"replayed": true` server signal); #3–#8 same classification reasoning as Group A, already proven-by-test or requires-device.

### Test Group C — Agent Cash-Out
Same ten categories, **not independently re-executed live this task** (time-bounded; the underlying mechanism is architecturally identical to Cash-In, already confirmed in the prior task's code audit and this task's Group B execution). Classification: #1/#2/#9/#10 would be **[EXECUTABLE — BACKEND ONLY]** using the identical procedure documented in §10 with the Cash-Out endpoint; #3–#8 same as above. Cash-Out additionally involves a customer-side MFA/OTP step (console-logged, same mechanism as registration) not present in Cash-In.

### Test Group D — Agent Cash-to-Cash Send
Same ten categories, same note as Group C — architecturally identical idempotency mechanism (confirmed by the prior task's direct code read of `agent-cash-to-cash.service.ts`), not independently re-executed live this task.

### Test Group E — Logout/Relogin (all four persistence-based flows)
This exact sequence (start → ambiguous outcome → confirm pending exists → logout → login same identity → confirm pending remains → retry → verify one effect) is **PROVEN BY AUTOMATED TEST** for all four flows as of the prior task (`V1-MOBILE-REAL-WORLD-VALIDATION-01`, commit `518b43a`) — this was the exact defect found and fixed in that task. Re-confirmed still passing this task (§16). **Not re-executed on a physical device** — the Jest-level proof exercises the real `logout()`/`SecureStorage` code paths in a Node process, not a real native app lifecycle boundary; a device run remains **[REQUIRES PHYSICAL DEVICE]** for the OS-level part specifically.

### Test Group F — Cross-Identity Isolation
**PROVEN BY AUTOMATED TEST** for both apps (prior task) — the storage key is scoped by `agentId`/`customerId`, directly asserted in both apps' test suites. Not device-dependent; this property is pure application logic, not an OS boundary.

### Test Group G — Process Lifecycle
| Scenario | Can be safely tested without a real device? |
|---|---|
| Background then resume (OS keeps process alive) | No — requires a real device/OS. **[REQUIRES PHYSICAL DEVICE]** |
| Force-stop then reopen | No — requires a real device/OS. **[REQUIRES PHYSICAL DEVICE]** |
| Device reboot | No. **[REQUIRES PHYSICAL DEVICE]** |
| Network loss / restoration | **Partially safe without a device**: the backend-level ambiguous-outcome behavior (what happens when a request never gets a response) was proven this task by observing real HTTP timeouts are not needed — the *application logic* for "treat network errors as ambiguous" is already Jest-proven with a mocked `NetworkError`; the *actual radio-level* network loss/restoration timing on a real device remains **[REQUIRES PHYSICAL DEVICE]**. |

None of Group G was executed this task; none is claimed to have passed.

---

## 10. Observability / Financial-Proof Procedure — What Was Actually Done

To prove **ONE BUSINESS OPERATION = ONE FINANCIAL EFFECT** without relying on the UI reporting "successful," this task built a complete, real, reproducible procedure using the backend as the authoritative source, exactly as instructed. Executed this session (exact commands and outputs recorded in the session transcript; the data itself no longer exists because the embedded Postgres instance is explicitly non-persistent by design, but the procedure below is fully reusable and was proven to work end-to-end):

1. **Build & run the real backend** as a live process (`npm run build && npm run migration:run && node dist/main.js`), bound to `0.0.0.0:3000` — not the Jest in-process test harness.
2. **Real customer registration over HTTP**: `POST /customers/registration/otp` → read the plaintext OTP from the server's own stdout (`[Notification][SMS] ... your registration verification code is NNNNNN ...`) → `POST /customers/registration/otp/verify` → `POST /customers/registration` → received a real `customerId` + provisioned `walletId`.
3. **Funded the wallet** using the repository's own `scripts/local-dev-fund-wallet.js` (uses the real `LedgerService.postJournal`, never touches a balance column directly).
4. **Logged in** (`POST /customers/sessions`), **set a transaction PIN** (`POST /customers/me/transaction-pin`), created a second recipient customer the same way.
5. **Fired two identical real HTTP `POST /customers/me/transfers` requests with the same `Idempotency-Key` header** (simulating a duplicate tap / lost-response retry) — both returned byte-identical `id`, `journalId`, and timestamps.
6. **Queried the raw Postgres ledger directly** (via a plain `pg` Node client, since no `psql` binary exists in this sandbox): confirmed exactly **one** `transfers` row, exactly **one** `ledger_journals` row (status `POSTED`), exactly **two** `ledger_lines` (one balanced debit + credit), and the sender/recipient wallet balances computed from the raw ledger lines matched exactly one transfer's worth of movement (NGN 50,000.00 funded → NGN 48,500.00 after, recipient NGN 1,500.00 — not NGN 3,000.00, proving no duplication).
7. **Repeated the identical procedure for Agent Cash-In**: created an agent via `scripts/local-dev-create-agent.js`, rotated its credential and logged in over real HTTP, set a transaction PIN, funded its float via the real `LedgerService` (the one ad-hoc, non-committed script used only for this demonstration — this repository has no existing agent-float local-dev helper; see §15), then fired two identical `POST /agents/cash-in` requests with the same body-level `idempotencyKey`. The **second response explicitly returned `"status": "REPLAYED", "replayed": true`** with the identical `journalId` — an even more explicit confirmation than W2W's silent reuse. Verified at the ledger level the same way: exactly 2 lines for the one journal, and the recipient's final computed balance reflected exactly one credit, not two.

This procedure is the authoritative template Kenneth (or any tester) should use on a real device too: **never trust the mobile UI's "Transfer Successful" screen alone** — after any ambiguous-outcome test on a real device, the same raw-ledger query technique (steps 6 above, substituting the real transfer/journal IDs shown in the device's own pending-operation state or server logs) is what proves or disproves "one financial effect," not the screen.

What must be inspected for every ambiguous test, specifically: the `transfers` (or agent-financial execution) row's `id`, `idempotency_key`, and `request_hash`; the `ledger_journals` row's `id` and `status`; the exact count and amounts of `ledger_lines` for that journal; and the computed wallet balance (sum of signed `ledger_lines.amount_minor` for the account) before and after — never the `wallet_accounts` table's own columns in isolation, since `wallet_accounts` carries no balance column itself (confirmed by schema inspection — balance is always a computed/derived ledger aggregate, consistent with the standing "wallet_accounts is identity/metadata only, ledger is sole-authoritative for balance" finding from prior tasks).

---

## 11. Actual Tests / Execution Performed by Arena This Task

- **Real backend process**, live HTTP, real Postgres — executed (§10), not simulated.
- **Real Metro/Expo bundle export**, both apps, multiple times including post-fix and post-clean-reinstall — executed, not simulated. This is genuine native-tooling execution (Hermes bytecode compilation), though it stops short of installing on/running inside an actual OS.
- **Automated regression suites**, run after the one code fix made this task:
  - `apps/customer-mobile`: 98/98 tests, 12 suites — PASS (unchanged from baseline).
  - `apps/agent-mobile`: 262/262 tests, 18 suites — PASS (unchanged from the prior task's post-fix baseline; this task's `expo-asset` fix touched only dependency resolution, not application code).
  - Targeted backend integration suites (`v1-mobile-idempotency-recovery-01`, `v1-w2w-recovery-audit-01`, `v1-agent-mobile-idempotency-persistence-01`): 9/9 tests, 3 suites — PASS.
  - `tsc --noEmit`: clean for customer-mobile, agent-mobile, and the backend.
- **No Android/iOS emulator, simulator, or physical device was available or used** — confirmed absent (`adb`, `emulator`, `java`, all missing; Linux kernel, so no Xcode/Simulator is even theoretically possible).

## 12. What Still Requires Kenneth's Local/Device Environment

Everything in §9 marked **[REQUIRES PHYSICAL DEVICE]**, specifically and exhaustively: installing either app on a real Android device or emulator (the bundle is now proven buildable, but was never installed/launched on an OS); any iOS testing whatsoever (requires a Mac); SecureStorage's actual native Keychain/Keystore behavior (Jest forces an in-memory shim via `NODE_ENV=test`, unconditionally, for both apps); app backgrounding, force-kill, OS memory reclaim, and device reboot; Android's real cleartext-HTTP rejection behavior on a standalone build; real icon/splash/adaptive-icon visual rendering on an actual launcher; and the true "duplicate tap" scenario at the touchscreen/UI level (as opposed to this task's two-identical-curl-requests simulation of the same server-facing effect).

---

## 13. Uninstall/Reinstall Risk Assessment (Documented Only — No Reconciliation Implemented)

**Exact risk restated:** an ambiguous outcome commits a pending record to `SecureStorage` → the user uninstalls the app (not merely backgrounds/force-kills it) → Keychain (iOS) / Keystore-backed storage (Android, typically) data for that app is removed by the OS as part of uninstall → the user reinstalls → the local pending record, and with it the original Idempotency-Key, is permanently gone → if the user retries the identical transaction, a brand-new key is minted, and if the original ambiguous request had in fact already committed server-side, a duplicate financial effect can occur, with no client-side mechanism left to prevent it.

**Does the backend already retain enough information to support a future reconciliation feature? Yes, substantially.** Confirmed this task:
- Every original attempt's `transfers` row (W2W) or agent-financial execution row (Cash-In/Out/Cash-to-Cash) already permanently stores `idempotency_key`, `request_hash`, `status`, `amount_minor`, `createdAt`/`completedAt` — queryable by the authenticated identity.
- A **unified transaction history endpoint already exists and is already used by both apps** (`GET /customers/me/transactions`, `GET /agents/me/transactions` — confirmed via `apps/customer-mobile/src/services/transfer-view.ts`, which is the real, shipped adapter for exactly this endpoint). This means a freshly-reinstalled app, with zero local state, can **already** ask the server "what did I actually do recently?" via a real, existing, already-authenticated API call — it simply isn't used for this specific recovery purpose today.

**What additional API/data model would be required for true reconciliation (described, not built):**
1. A client-side check, on first screen-load after a fresh install/login with no local pending record, that queries recent transaction history and **surfaces a passive warning** if a transaction matching the user's about-to-be-submitted amount/recipient/currency exists within a short recent window (e.g. the last 15–30 minutes) — "You sent a similar transfer 4 minutes ago, still processing — are you sure you want to send another?" This requires no new backend endpoint (the history endpoint already exists) — only new client-side logic, and critically, it is advisory/non-blocking, never an automatic silent resume.
2. A more automated version would need a new, narrowly-scoped server endpoint such as `GET /customers/me/transfers/unresolved` (or agent equivalent) that returns only genuinely ambiguous/in-flight records (not the full history) for the authenticated identity — a small, well-defined addition, but still a new endpoint and a product decision about exactly what "unresolved" should mean and for how long.
3. A deliberately-rejected option: deriving the Idempotency-Key itself from a deterministic hash of the request parameters (so the same transfer details always produce the same key even after reinstall) — this was considered and explicitly **not recommended**, because it would make two independently-intended, coincidentally-identical transfers (e.g. the same amount to the same person twice in one day, both legitimate) silently collapse into one, which is strictly worse than the current rare tail risk.

**Explicit V1 launch-blocker assessment: this should NOT block V1 launch.** Reasoning: it requires the specific intersection of (a) an ambiguous outcome specifically — not any failure, (b) a full uninstall — not a background/force-kill/restart, all of which are already handled, (c) the user then manually retrying with exactly identical transaction details, without first checking their own transaction history or noticing the duplicate in their recipient's account. This is a narrow tail risk common to effectively all mobile financial apps that rely on local idempotency state, is bounded per-transaction (not systemic), and is the kind of gap normally closed by a post-launch support/reconciliation process and a later, deliberately-designed hardening task — not a reason to delay the initial release. It is recorded here explicitly so it is a **deliberate, documented product decision**, not an accidental oversight, per this task's stated objective.

---

## 14. Recommended Staging Architecture

For the **first** round of genuine physical-device financial UAT (not a permanent production staging environment):

1. Run the real backend + embedded/local Postgres on Kenneth's own development machine (exactly as this task did, via `node scripts/embedded-pg.js` + `npm run build && npm run migration:run && node dist/main.js`).
2. Put one Android test device on the **same Wi-Fi network** as that machine.
3. Set `EXPO_PUBLIC_API_URL` to that machine's LAN IP (e.g. `http://192.168.x.x:3000`) when starting the dev client (`expo start --dev-client`) or building a `development`/`preview` EAS profile.
4. For a `developmentClient`/Expo-Go-style test, plain HTTP over LAN should work without the Android 9+ cleartext restriction biting (that restriction specifically targets standalone release-style binaries). For a true `preview`/`production`-profile APK, either tunnel behind HTTPS (e.g. a reverse tunnel) or accept the extra step of enabling cleartext for that build profile only, never for the real production profile.
5. Keep `NOTIFICATION_SMS_PROVIDER=console` (the default) and watch the backend's terminal output directly to read OTP codes during testing, exactly as demonstrated in §10.
6. Use the repository's own `scripts/local-dev-create-agent.js` and `scripts/local-dev-fund-wallet.js` to provision one test Agent and fund one test Customer wallet before starting — no new infrastructure or invented credentials needed.
7. For Agent-side float funding specifically, **no local-dev helper script currently exists in the repository** (unlike customer wallet funding) — this task used a one-off, non-committed script for its own demonstration (§10, step 7). Recommended future addition (not made this task, to avoid an unrelated code change): a `scripts/local-dev-fund-agent.js` mirroring `local-dev-fund-wallet.js`'s existing pattern exactly.
8. This setup requires zero production secrets, zero real SMS provider cost, and zero public DNS/TLS — it is sufficient for everything in the Test Matrix (§9) except the eventual pre-launch pass against the real staging/production endpoint once that infrastructure actually exists.

---

## 15. Exact Remaining Blockers

| # | Blocker | Severity | Owner action needed |
|---|---|---|---|
| 1 | No live staging or production API URL configured (both `eas.json` still have placeholder values) | Launch-blocking for a real pre-launch pass, not for first controlled-LAN UAT | Provision real staging infra when ready; not fabricated by this task. |
| 2 | No physical Android/iOS device or emulator available in this Arena sandbox | Hard environment limitation | Must be executed on Kenneth's own machine/device — this task cannot close this gap itself. |
| 3 | Android cleartext-HTTP restriction on standalone builds not addressed | Only affects `preview`/`production`-profile APKs over plain HTTP | Either tunnel the LAN URL behind HTTPS for device testing, or add a scoped cleartext allowance for non-production build profiles only. |
| 4 | No local-dev agent-float-funding helper script exists (customer wallet funding has one, agent float funding does not) | Minor convenience gap, not a correctness defect | Add `scripts/local-dev-fund-agent.js` mirroring the existing `local-dev-fund-wallet.js` pattern, as a follow-up. |
| 5 | Uninstall/reinstall reconciliation gap | Explicitly assessed as **not** a V1 launch blocker (§13) | Deliberate, documented, deferred product decision — track as a post-launch hardening backlog item. |

**Resolved this task (no longer a blocker):** `apps/agent-mobile`'s Metro/Expo bundle failure (`expo-asset` not hoisted) — fixed in commit `74247e6`, verified reproducibly.

---

## 16. Recommended Next Action

Execute the actual physical-device pass on Kenneth's own machine using the exact staging architecture in §14 and the exact test matrix in §9, starting with Test Groups A and B (Customer W2W, Agent Cash-In) since those have a fully proven, reproducible backend procedure already documented in §10 ready to extend onto a real device; capture real-device-specific evidence for the items explicitly marked **[REQUIRES PHYSICAL DEVICE]** throughout this document, particularly SecureStorage's native-fallback behavior and real process-kill timing, which remain the two highest-value genuinely-unproven items in the whole mobile financial-safety story.
