# V1-AGENT-MOBILE-APPLICATION-SPEC-01 — Agent Mobile Application (V1) Specification

- **Date:** 2026-10-01 · **Type:** specification only — **no implementation, no scaffold, no backend/migration/API changes, no modifications to Customer Mobile**
- **Authority:** owner decision (V1-AGENT-MOBILE): the *actual Agent mobile application* is **REQUIRED in V1** as a first-class client. This document defines what is to be built.
- **Sources of truth:** `apps/customer-mobile/**` (architecture baseline), `src/agent/**`, `src/agent-authentication/**`, `src/customer-authentication/mfa-execution.service.ts`, `test/a13–a21` suites. Every endpoint cited exists in code; nothing is invented.

---

## 1. Customer Mobile — inspected architecture (baseline to inherit)

| Area | Evidence | Conclusion |
|---|---|---|
| Stack | `apps/customer-mobile/package.json` | Expo **SDK 52** (`~52.0.7`), React Native **0.76.2**, React **18.3.1**, TypeScript ^5.3, jest-expo ~52, @testing-library/react-native ^12.8 |
| Navigation | `src/navigation/AppNavigator.tsx` | `@react-navigation/native` 6.x + **native-stack**; one stack; **conditional unauthenticated vs authenticated blocks** keyed off `auth-store.isAuthenticated`; `Splash` while `isLoading`; flat `RootStackParamList` with `undefined` params |
| Auth/session | `src/store/auth-store.ts`, `src/services/secure-storage.ts` | zustand store; `expo-secure-store` abstraction with in-memory fallback (tests/web); keys `auth_session_token`, `auth_session_data`; `restoreSession()` checks `expiresAt` locally; logout = best-effort API call + local purge |
| API client | `src/services/api-client.ts` | fetch wrapper; Bearer token pulled from SecureStore **per request**; `idempotency-key` header on POST/PATCH/PUT when provided; `ApiError(status, code, validationErrors)` + `NetworkError`; **401 → purge stored token**; `setBaseUrl/getBaseUrl`, default `http://10.0.2.2:3000` |
| State | `App.tsx` | TanStack Query v5 (`retry: 1`, `refetchOnWindowFocus: false`) + zustand for session |
| Styling | `src/theme/*` | Brand green `#0A3D25`; colors/spacing/typography modules; shared components: `Button/Input/AmountInput/Card/StatusBadge/TransactionRow/ConfirmationDialog/ErrorState/LoadingState/ErrorBoundary` |
| Config | `src/config/index.ts` | `DEFAULT_BASE_URL` const; `DEV_AUTH_MOCK = true` dev fallback for a **customer** login gap |
| Tests | `__tests__/` | 11 suites: api-client, auth-store, navigation, button, deposit, home, profile, registration, transactions, transfer, withdrawal |

> **Departure rule for Agent Mobile:** no `DEV_AUTH_MOCK`-style fallback. The Customer app’s mock exists to paper over a customer-login gap documented in `auth-store.ts`; the Agent authentication surface is complete and UAT-tested, so Agent Mobile fails closed.

## 2. Agent backend contract — exact routes (code-as-truth)

Base path `/api/v1`. All money/session routes require an **AGENT principal** (Bearer token, audience `agent-api`) unless marked **public**.

### 2.1 Authentication & session (`src/agent-authentication/agent-authentication.controller.ts`)
| Route | Auth | Body | Response |
|---|---|---|---|
| `POST /agents/sessions` (200) · alias `POST /agents/login` | public | `AgentLoginDto{agentId:UUID, password(1–1024)}` | `{accessToken, tokenType:'Bearer', expiresAt, agentId, sessionId}` **or** `{rotationRequired:true, agentId}` when the workforce-issued temporary credential is pending rotation (no session issued) |
| `POST /agents/sessions/logout` · alias `POST /agents/logout` | Bearer (header token revoked) | none | `{revoked:true}` |
| `GET /agents/me` | AGENT | — | `{id, reference, status, createdAt, updatedAt}` (never hashes/PII) |
| `POST /agents/credentials/rotate` (200) | **public, self-bootstrapping** | `RotateInitialCredentialDto{agentId:UUID, currentPassword, newPassword(8–128)}` — verifies current password via the real auth path (lockout intact), 403 if rotation not pending | issues the **first real session** (same payload as login) and revokes all sessions of the old credential |
| `POST /agents/me/transaction-pin` (200) | AGENT | `{pin(4–32, enforced numeric 4–12 server-side), pinConfirmation?}` | `{agentId, pinVersion, updatedAt}` |
| `POST /agents/me/transaction-pin/verify` (200) | AGENT | `{pin}` | `{verified:true}` or `{verified:false, reason, locked}` |

### 2.2 Agent `me` read surface (`src/agent/agent-app.controller.ts`) — all AGENT-authenticated, GET
| Route | Response |
|---|---|
| `/agents/me/profile` | `{id, reference, status, agentClassId, agentClass:{id,reference,code,name,isActive}|null, createdAt, updatedAt}` |
| `/agents/me/capabilities` | `{agentId, permittedServices[], evaluations[{service, canonicalService, allowed, reason}]}` evaluated fail-closed over `CASH_IN, CASH_OUT, CASH_TO_CASH, AGENT_FUNDING, AGENT_DEFUNDING` |
| `/agents/me/financial-position` | `{agentId, currency:'NGN', balanceMinor:string (kobo), availableBalanceMinor:string, walletExists, walletId?, ledgerAccountId?, status?}` — ledger-derived, the sole balance truth |
| `/agents/me/receiving-number` | receiving-number view or `{agentId, receivingNumber:null, status:'NONE'}` |
| `/agents/me/outlets` · `/agents/me/outlets/:id` | `[{id, agentId, reference, code, name, displayName, status, addressLine, city, state, country, createdAt, updatedAt}]`; detail is **self-scoped** (404 on foreign id) |
| `/agents/me/terminals` · `/agents/me/terminals/:id` | `[{id, agentId, outletId, reference, code, label, status, serialNumber, …}]`; self-scoped |
| `/agents/me/transactions?page&limit&type` (type ∈ `CASH_IN|CASH_OUT|CASH_TO_CASH|AGENT_FUNDING|AGENT_DEFUNDING`) | unified history items `{id, type, status, amountMinor, currency, direction, createdAt, completedAt, reference, narration, feeMinor, counterparty, commission:{commissionMinor,payable,treatment}|null, failureCode}` — merge order `created_at DESC, id DESC`; read-only, applicant-isolated at the query boundary |

### 2.3 Money movement (`src/agent/agent-*.controller.ts`) — all AGENT-authenticated, idempotency-keyed, kobo minor units, currency `NGN`
| Route/Business | Request (DTO) | Response |
|---|---|---|
| `POST /agents/cash-in` (201) — Cash→Wallet | `CashInDto{recipientIdentifier(1–40), amountMinor(^[1-9]\d*$), currency(^[A-Z]{3}$), idempotencyKey, pin(agent PIN), reference?, description?, correlationId?, metadata?}` | `{status, journalId, agentId, recipientCustomerId, recipientReceivingNumber, amountMinor, currency:'NGN', idempotencyKey, requestHash, replayed, correlationId, reference, createdAt}` |
| `POST /agents/cash-out` (201) — Wallet→Cash | `CashOutDto{customerId, customerPin, mfaChallengeId, otp, amountMinor, currency, idempotencyKey, agentPin, …}` | `{status, journalId, agentId, customerId, amountMinor, currency, idempotencyKey, requestHash, replayed, correlationId, reference, createdAt}` |
| `POST /agents/cash-to-cash` (201) — Cash→Cash initiate | `CashToCashDto{beneficiaryPhone(1–20), amountMinor, currency, idempotencyKey, agentPin, …}` | `{status:'COMPLETED', transferId, journalId, agentId, beneficiaryPhone, principalMinor, feeMinor, vatMinor, totalMinor, currency, amountMinor, idempotencyKey, requestHash, replayed:false, correlationId, reference, createdAt, **transferCode**}` — **plaintext `transferCode` is returned ONLY on the fresh 201 and is redacted from the idempotency record**; replays return `transferCode:undefined` |
| `POST /agents/cash-to-cash/claim` (200) — beneficiary claims cash | `CashToCashClaimDto{transferId:UUID, beneficiaryPhone, transferCode(8–20 digits), customerId:UUID, mfaChallengeId:UUID, otp, idempotencyKey, …}` | `{status, transferId, journalId, beneficiaryPhone, principalMinor, currency, amountMinor, claimantCustomerId, idempotencyKey, requestHash, replayed, correlationId, reference?, claimedAt}` |

### 2.4 Public look-up surfaces (no auth)
| Route | Purpose |
|---|---|
| `GET /recipients/resolve?identifier=` · `GET /recipients/resolve-phone?phone=` | resolves a receiving number / +234 phone to participant identity `{id, status, reference, receivingNumber, participantType}` (identity returned for ACTIVE and SUSPENDED; financial use gated at the command) |
| `GET /agents/:id/receiving-number` | agent receiving number view |

### 2.5 Security model constants
- Agent lifecycle statuses: `PENDING|ACTIVE|SUSPENDED|TERMINATED`; capability evaluation is fail-closed per class bindings + status (`AgentService` canonical five above).
- OTP/MFA: `MfaExecutionService.issueChallenge` is **service-level only — there is no HTTP endpoint that issues a challenge** (all callers are test files). Cash-out and claim *verify* customer OTP embedded in the command; issuance currently has no API surface → **BACKEND GAP** (§5).
- Login identity is `agentId (UUID) + password` (workforce-issued) — *not* phone+PIN; this differs from the customer plane by design.

## 3. Agent Mobile V1 — screens & navigation

Single native stack with conditional blocks (established pattern). Flat param list, `undefined` params.

**Unauthenticated group**
- `Splash` — session restore while loading
- `AgentLogin` — agentId + password; on `{rotationRequired:true}` → forced navigation to `RotateCredential`
- `RotateCredential` — mandatory temporary-credential rotation (`currentPassword`, `newPassword` ≥8) → on success the returned session lands directly on Home (first real login completes here)

**Authenticated group**
- `Home` — available electronic balance (kobo→NGN display, server value only), agent reference/class/status badge, receiving number, capability chips (greyed/denied with `reason`), 3 CTAs
- `CashToWalletFlow` = `C2W_Recipient` (resolve + confirm) → `C2W_Amount` → `C2W_Authorize` (agent PIN) → `C2W_Result`
- `WalletToCashFlow` = `W2C_Customer` (customerId entry — customer physically present; identity confirm via resolution) → `W2C_Amount` → `W2C_Authorize` (agent PIN + customer PIN + customer OTP) → `W2C_Result`
- `CashToCashFlow` = `C2C_BeneficiaryPhone` → `C2C_Amount` → `C2C_Authorize` (agent PIN) → `C2C_Result` (**transferCode shown ONCE with copy/share + warning; never re-derived, never re-displayed**)
- `C2CClaimAssist` — agent-assisted beneficiary claim *only where backend permits*: transferId + transferCode + beneficiary phone + customerId + customer OTP; clearly labelled customer-co-present cash payout
- `Transactions` (unified history list, type filter chips, pull-to-refresh) · `TransactionDetail` (from list item; status/direction/fee/commission/reference/timestamps)
- `AgentAccount` — profile, agent class, status, transaction PIN set/change, credential rotation status, session (logout)
- `Outlets` · `OutletDetail`, `Terminals` · `TerminalDetail` — read-only consistency surfaces

**Not in V1 Mobile:** agent onboarding/application, funding/defunding actions (workforce/aggregator internal endpoints), receiving-number allocation — read-only display only.

## 4. UX principles (bound to the real security model)

1. **Server is the only truth for money.** Balances, fees, VAT, totals come from responses; the client formats kobo → ₦ display only, never computes.
2. **Fail-closed everywhere.** Capability denials display the backend `reason`; no local shortcuts; no mock sessions; 401 → purge token → login (existing client convention).
3. **Idempotency discipline.** Financial submits generate one UUIDv4 `idempotencyKey` per user-intent; retries (timeout/network) resend the **same** key; success with `replayed:true` renders as the original result; primary action disables after first tap ("duplicate submission protection" is client + server).
4. **Secrets are never persisted.** Agent PIN / customer PIN / OTP live only in-memory for the current command; `transferCode` is the only secret displayed — POST-create-only, with an explicit "shown once" pattern.
5. **Recipient confirmation before money.** `/recipients/resolve` (+status) is presented as a confirmation card (masking + status; SUSPENDED renders disabled with backend reason). The customer is physically co-present for W2C and C2C claim (customer PIN + OTP entered on the agent device but are the **customer’s** factors — the UI labels ownership explicitly and must not store them).
6. **Amount entry** uses the proven `AmountInput` pattern (decimal pad, integer kobo conversion, no floats, min validation to satisfy `^[1-9]\d*$`).
7. **Loading/empty/error states** reuse `LoadingState/ErrorState/StatusBadge`; errors map `{status, code, validationErrors}`; 409/Conflict (already-claimed) is a first-class state.
8. **Session restore** exactly like Customer: `expiresAt` check, splash gate, no client-side refresh invention (backend has no refresh endpoint — spec does not assume one).

## 5. Backend compatibility matrix

| Mobile feature | Endpoint | Client auth | Transaction authorization | Required inputs | Expected result | Error cases | Screen |
|---|---|---|---|---|---|---|---|
| Login | `POST /agents/sessions` | public | none | agentId, password | session `{accessToken…}` | 401 invalid; `rotationRequired` branch | AgentLogin |
| Mandatory rotation | `POST /agents/credentials/rotate` | public (current-password proof) | lockout/intact auth path | agentId, currentPassword, newPassword | session | 401, 403 not-pending, 400 same-value | RotateCredential |
| Logout | `POST /agents/sessions/logout` | Bearer | none | — | `{revoked:true}` | 401 | AgentAccount |
| View identity | `GET /agents/me` + `/me/profile` | AGENT | — | — | profile + class + status | 401/404 | AgentAccount/Home |
| Balance | `GET /agents/me/financial-position` | AGENT | — | — | kobo balance strings | 401; `walletExists:false` (empty-state) | Home |
| Receiving number | `GET /agents/me/receiving-number` | AGENT | — | — | number or `NONE` | 401 | Home |
| Capability chips | `GET /agents/me/capabilities` | AGENT | — | — | permitted + reasons | 401 | Home |
| Cash→Wallet | `POST /agents/cash-in` | AGENT | **agent PIN** | recipientIdentifier, amountMinor, currency, idempotencyKey, pin | 201 + journalId/replayed | 401, 400 validation, 403 capability/limit, 404 recipient, PIN fail/locked | C2W flow |
| Recipient confirm (C2W) | `GET /recipients/resolve` | public | — | identifier | identity+status | not-found | C2W_Recipient |
| Wallet→Cash | `POST /agents/cash-out` | AGENT | **agent PIN + customer PIN + customer OTP** | customerId, customerPin, mfaChallengeId, otp, amountMinor, currency, idempotencyKey, agentPin | 201 | 401, 400 (mfa/otp validation), 403 limits, PIN/OTP fail | W2C flow |
| **W2C OTP issuance** | `POST /agents/me/mfa-challenges` ✅ **RESOLVED (V1-AGENT-MFA-API-01)** | AGENT session (registry: `/agents/*` rule, strict SELF) | issue-only | customerId, purpose='WALLET_TO_CASH', ttlSeconds? | 201 `{challengeId, customerId, purpose, deliveryChannel:'SMS', destinationMasked, delivered, issuedAt, expiresAt, ttlSeconds}` — **never the OTP** | 401 unauth, 403 non-agent, 400 invalid purpose / no verified primary phone / no credential, 404 customer unknown | W2C flow (pre-step) |
| **C2C claim OTP issuance** | `POST /agents/me/mfa-challenges` with purpose='CASH_TO_CASH_CLAIM' | AGENT session | issue-only | customerId (beneficiary), purpose, ttlSeconds? | 201 same shape | same as above | C2CClaimAssist (pre-step) |
| Cash→Cash initiate | `POST /agents/cash-to-cash` | AGENT | agent PIN | beneficiaryPhone, amountMinor, currency, idempotencyKey, agentPin | 201 + `transferCode` + feeMinor/vatMinor/totalMinor | 401/403/400 | C2C flow |
| C2C expiry countdown | `expiresAt` | — | — | — | **MINOR GAP:** expiry lives on the record/audit; the initiation response does not return `expiresAt`. Mobile shows lifecycle via history status (`UNCLAIMED/CLAIMED/EXPIRED`) and never invents a TTL. | — | C2C_Result |
| C2C claim assist | `POST /agents/cash-to-cash/claim` | AGENT principal passthrough | customer OTP (+code) | transferId, transferCode, beneficiaryPhone, customerId, mfaChallengeId, otp, idempotencyKey | 200 claimed | 401, 400/404, 409 already-claimed, OTP fail | C2CClaimAssist — **also blocked by OTP-issuance gap** |
| History | `GET /agents/me/transactions` | AGENT | — | page/limit/type | items incl. commission where returned | 401 | Transactions |
| Transaction detail | list-derived | — | — | — | list fields only | **MINOR GAP:** no per-id detail route; detail screen is limited to list-item fields (by A21 design — “history receipts PARTIAL” per completion audit) | TransactionDetail |
| PIN set | `POST /agents/me/transaction-pin` | AGENT | — | pin, confirmation | `{pinVersion, updatedAt}` | 401/400 | AgentAccount |
| PIN verify | `POST /agents/me/transaction-pin/verify` | AGENT | — | pin | verified/locked | locked reason | AgentAccount |
| Outlets/Terminals | `/me/outlets[/:id]`, `/me/terminals[/:id]` | AGENT | — | — | lists/details (self-scoped) | 401/404 | Outlets/Terminals |
| Change normal password post-rotation | *none* | — | — | — | **BACKEND GAP:** `/agents/credentials/rotate` is deliberately rotation-pending-only (403 otherwise); no normal-credential-change route exists. Founder decision required (A7 mirror exists for customers: `POST /customers/me/password`). | — | AgentAccount (hidden in V1 unless approved) |

### 5.1 Implemented OTP-issuance contract (V1-AGENT-MFA-API-01 — verified `test/v1-agent-mfa-api-01.integration.spec.ts`, 12/12 PASS)

- **Method/Path:** `POST /api/v1/agents/me/mfa-challenges` (HTTP 201)
- **Authentication:** Agent session Bearer (audience `agent-api`); RoutePolicyRegistry generic `/agents/*` rule → non-public, `allowedPrincipalTypes:['AGENT']`, `agentAccess:'SELF'`, `customerAccess:'NONE'` — same guard as the rest of the `agents/me` surface.
- **Request body:** `{ customerId: UUID, purpose: 'WALLET_TO_CASH' | 'CASH_TO_CASH_CLAIM', ttlSeconds?: 30–900 (default 300) }`
- **Response (never contains the OTP):** `{ challengeId, customerId, purpose, deliveryChannel:'SMS', destinationMasked ('***NNNN'), delivered:boolean, issuedAt, expiresAt, ttlSeconds }`
- **Purpose binding:** challenge row carries the requested purpose; canonical verification enforces it — a `WALLET_TO_CASH` challenge fails `WRONG_PURPOSE` at claim and vice versa. Legacy purpose-NULL challenges remain generic (unchanged pre-existing behavior).
- **Error responses:** 401 unauthenticated/revoked session · 403 non-agent · 400 invalid purpose, customer without a verified primary phone, customer without an active credential · 404 customer not found.
- **OTP delivery:** the plaintext OTP is delivered ONLY to the customer's verified primary phone via the established provider-neutral DIRECT SMS abstraction (`NOTIFICATION_PROVIDER_TOKEN` → robase/console) with event type `agent.desk.customer_otp` (SECURITY-CRITICAL taxonomy class); never via the notification dispatcher/outbox; never returned by the API; never persisted in plaintext (salted PBKDF2 comparand at rest); never logged.
- **Semantics:** issuance creates no financial side effects (no journals/wallet writes — verified); session/TTL/replay/expiry rules are the canonical `MfaExecutionService` rules, unchanged.
- **Phasing note:** §8 phase 7 (W2C + claim) is **unblocked by this implementation** for client consumption.

## 6. Agent Mobile vs Customer Mobile (hard distinctions)

Agent is a **first-class participant with a different lifecycle**; do not copy customer flows where they don’t apply:
- **Identity/auth:** agent = workforce-issued `agentId + password` with mandatory temporary-credential rotation (`agent-api` audience); customer = self-registered receiving identity (`customer-api`). No registration/onboarding UI in Agent Mobile V1.
- **Money model:** agent operates a **float/wallet** funded/defunded by workforce or aggregator via internal endpoints — the app shows position read-only; customers self-fund.
- **Authorization:** agent transactions require the **agent transaction PIN**; W2C additionally requires the **customer’s PIN + OTP**; the agent-claim lane requires the **customer’s OTP**. Security is never weakened for convenience.
- **Surfaces:** agent screens include capabilities/class/status/receiving number/outlets/terminals; customer screens (welcome/registration/deposit) don’t exist.
- **Status model:** PENDING/ACTIVE/SUSPENDED/TERMINATED vs customer lifecycle states; only ACTIVE means operable (fail-closed).

## 7. Technology decision

**Expo/React Native matching Customer Mobile — chosen.** Repository evidence (§1) shows a proven, tested pattern with zero mobile-only backend changes required and a direct component/API-client/archetype. Pin the same majors: Expo ~52, RN 0.76.2, React 18.3.1, TS ^5.3, @react-navigation 6, TanStack Query 5, zustand 4, expo-secure-store 14, zod 3; jest-expo + RTL 12 for tests. Separate Expo slug (e.g. `moneynaija-agent`) at path **`apps/agent-mobile`** (to be created only when implementation is authorized — not in this task).

## 8. Build phases (dependency-ordered)

1. **Scaffold & foundation** — `apps/agent-mobile` project, theme parity, api-client incl. idempotency + 401-purge, secure-storage, navigation skeleton, ci/test wiring.
2. **Authentication & rotation** — AgentLogin, forced RotateCredential, session store/restore, logout.
3. **Home & identity** — financial position, profile/class/status, receiving number, capabilities gate.
4. **Transaction PIN** — set/change/verify screens + locked-state handling.
5. **Cash→Wallet** — resolve→confirm→amount→PIN→result.
6. **Cash→Cash (initiate + display-once claim info)** — flow + result + history lifecycle; expiry presentation limited to backend truth.
7. **History** — list, filters, detail-from-list, commission display where returned.
8. **Outlets/Terminals + Account/polish** — read-only surfaces, session pane.
9. **Wallet→Cash & C2C Claim Assist** — **GATED on the OTP-issuance gap** (§5) being resolved; until then the screens exist but block at authorization with an explicit “OTP issuance unavailable” state (fail-closed).
10. **Security/error/loading hardening** — replay semantics, lockouts, offline/retry network handling, secret hygiene audit.
11. **Real-device UAT** — Android + iOS, new UAT catalogue lanes (see §10 terminology note), evidence capture.

> Ordering deviation from the task sketch is deliberate: C2C precedes W2C because W2C/claim are blocked by a backend gap; history follows money flows to give the result screens verifiable data.

## 9. Test plan

**Already-passing backend suites (do not rediscover):** `a8` lifecycle, `a13` cash-in, `a14` cash-out + `a14-otp-hardening`, `a15`…`a17` cash-to-cash (+claim, +expiry), `a21` Agent App contract (74 expectations), `v1-agent-history-01`, plus UAT Agent family 20/20. These remain the authority for the API surface.

**NEW Agent-Mobile suites (mirror customer-mobile tests):**
- `api-client.test` — idempotency-key header on writes; 401 → token purge; base-url handling; `ApiError/NetworkError` mapping.
- `auth-store.test` — login, `rotationRequired` branch, rotation→session landing, restore/expiry purge, logout.
- `navigation.test` — conditional unauth/auth blocks; forced `RotateCredential` redirect; splash gate.
- Screen suites: login, rotation, home (balance/class/capability rendering + denial reasons), C2W (recipient confirm, PIN step, replayed-result rendering), C2C (display-once transferCode + copy), W2C/claim (gap-blocked state), transactions (filters/detail), outlets/terminals.
- Security tests — secrets never persisted (SecureStore keys asserted), disabled-submit duplicate protection, PIN masking, transferCode lifetime in memory.
- Device testing: android + ios smoke; network-failure simulation (retry same key), rotation lockout UX.

## 10. Documentation & terminology

**Created (this task):** `docs/V1/V1-AGENT-MOBILE-APPLICATION-SPEC-01.md`.

**Documents that use “Agent App” ambiguously — to be clarified AFTER this spec is approved (not rewritten now):**
1. `docs/V1/A21-AGENT-APP-CONTRACT.md` — title/“future Agent App (mobile)” reads as if the mobile app is the subject; it is the backend contract (add a pointer to this spec).
2. `docs/uat/V1-UAT-MASTER-01.md` §0.3 — defines “Agent app” = `/api/v1/agents/**` surface; needs a vocabulary note distinguishing **Agent Mobile Application (client)** from **Agent API surface**.
3. `docs/uat/V1-UAT-FINAL-01.md` — regenerable; note that "100% complete" covered backend-only.
4. `docs/V1/V1-PRODUCT-COMPLETION-AUDIT.md` §7 “Agent App Audit” — audits backend only.
5. `docs/V1/V1-CAPABILITY-REGISTRY.md` — `AGENT_APP_BACKEND` row; register a distinct `AGENT_APP_MOBILE` capability at implementation time.
6. `docs/README.md` index entry “Agent app backend contract” + `docs/V1/V1-DOCUMENTATION-AUDIT-01.md` archived “pre-build blockers” wording.

## 11. Scope boundary (V1 Mobile must NOT contain)

Bank transfers, NIBSS/external payouts, cards, airtime, bills, rewards, push-only dependencies, aggregator portal, agent self-onboarding, agent funding/defunding actions, profile/privacy edits lacking endpoints, any other V2 functionality. **Existing V1 Agent API capabilities only.**

## 12. Final report summary

- **Customer Mobile findings:** §1 — mature Expo/RN baseline with proven client conventions (idempotency, 401-purge, secure store, conditional nav, component kit).
- **Agent backend capabilities:** §2 — complete login/rotation/session + PIN + 3 money flows + read surface + unified history, all UAT-passed.
- **Proposed screens/navigation:** §3 (unauth 3 screens, auth 12 screens, flat native stack).
- **UX principles:** §4 (server-truth money, show-once secrets, fail-closed, co-present customer factors).
- **Compatibility matrix:** §5 — every mapped feature cites a real route; **BACKEND GAPS:** (1) ~~customer OTP/MFA challenge issuance has no HTTP surface~~ → **RESOLVED by V1-AGENT-MFA-API-01** (`POST /agents/me/mfa-challenges`, full contract in §5.1 — implemented and integration-verified); (2) normal post-rotation credential change route does not exist (403 by design); **MINOR:** no per-id transaction detail route; C2C `expiresAt` absent from initiation response. No endpoint invented to fill any gap.
- **Auth/security model:** §2.5/§4 — preserved unweakened (agent PIN, customer PIN+OTP, rotation, fail-closed capabilities).
- **Technology choice:** §7 — Expo/RN parity with Custome Mobile (slug `moneynaija-agent`).
- **Implementation phases:** §8 — gap-aware ordering (W2C/claim gated, not skipped).
- **Test strategy:** §9 — backend suites remain authority; new mobile suites enumerated.
- **Terminology conflicts:** §10 — six docs queued for clarification post-approval.

*Specification complete. No source code, migration, API contract, Customer Mobile, or `apps/agent-mobile` changes were made. STOP.*

## 13. Implementation status — V1 foundation + authentication layer (VERIFIED)

*Implementation phase: **V1-AGENT-MOBILE-01** (foundation + auth). This section records implementation facts only; it does not alter the design decisions above.*

**Created:** `apps/agent-mobile/` — separate Expo app, flat alongside `apps/customer-mobile/` and `apps/admin-web/` (no workspace added; isolation preserved). App identity: slug `moneynaija-agent`, iOS bundleId / Android package `ng.monienaija.agent` (§7 parity decision).

**Pin parity (verified against customer-mobile):** identical version ranges in `package.json` (expo `~52.0.7`, react-native `0.76.2`, react `18.3.1`, zustand `^4.5.5`, expo-secure-store `~14.0.0`, @tanstack/react-query `^5.59.16`, zod `^3.23.8`, navigation `^6.1.18`/`^6.9.26`, safe-area-context `4.12.0`, screens `~4.0.0`, jest `^29.2.1`, jest-expo `~52.0.0`, RTL `^12.8.0`, TS `^5.3.3`) — resolved to the same minor lines (expo 52.0.49). One additive required devDependency: `react-test-renderer@18.3.1` — identical to the version already present transitively in the customer lockfile (required only so `npm install` deterministically resolves; an explicit declaration, not an upgrade of any dependency).

**Foundation implemented (§3 unauth screens + §2 auth model):**
- `src/services/api-client.ts` — configurable base URL (`10.0.2.2` Android emulator default), Bearer per request from `expo-secure-store`, **`idempotency-key` write support**, 401 → purges `AGENT_SESSION_KEYS` (fail-closed back to login), `ApiError/NetworkError` mapping, no credential logging.
- `src/services/agent-api.ts` — typed contracts for `POST /agents/sessions` (session **or** `rotationRequired` guard), `POST /agents/credentials/rotate`, `POST /agents/sessions/logout`, `GET /agents/me`. No invented endpoints (the §5 "no post-rotation credential change" gap is respected: rotation is the only credential write surface used).
- `src/store/auth-store.ts` (zustand) — login / `rotationRequired` pending-branch / rotate→session / restore with expiry purge / logout (remote revoke best-effort, local purge always). Session metadata persisted under `accessToken/agentId/sessionData`; **passwords, PINs and OTPs are never persisted** (§4).
- `src/navigation/AppNavigator.tsx` + `types.ts` — gated branches: `Splash` (session restore) → `Login` → `RotateCredential` (mandatory gate when pending) → `Home/Account/Transactions/History`.
- Screens: `SplashScreen`, `LoginScreen` (Agent-UUID + password, backend-error surface), `RotateCredentialScreen` (temporary/new/confirm, ≥8, never logged/persisted), `HomeScreen` (queries `GET /agents/me`; reference + status badge; clearly-labelled placeholders for later phases), `AccountScreen`, `PlaceholderScreen` — placeholders state "coming in a later phase"; nothing falsely functional (§11 scope honored; money surfaces, financial position, outlets/terminals/commissions/MFA-challenge/PIN UI are NOT in this build).
- Visual language: theme + component kit (`Button`, `Input`, `Card`, `ErrorBoundary`, `ErrorState`, `LoadingState`) copied from customer-mobile for an independent, safe-to-diverge copy (§6).
- **Fail-closed stance:** no `DEV_AUTH_MOCK` or any dev authentication bypass exists anywhere in `apps/agent-mobile` (statically scanned); any login/network failure leaves the user unauthenticated.

**Tests (all new, all passing):** 6 suites / 31 expectations — `__tests__/api-client.test.ts` (bearer attach, public-endpoint behavior, idempotency-key, 401-purge, error mapping, base-URL), `__tests__/auth-store.test.ts` (login success/failure, network-fail-closed **no-DEV_AUTH_MOCK** guarantee, `rotationRequired` no-session branch, rotation success = first session, rotation 403 path, restore persistence, expired purge, logout best-effort revoke + local purge), `__tests__/navigation.test.tsx` (splash/init, unauth login-only, rotation gate, authenticated stack without auth routes), `__tests__/login.test.tsx`, `__tests__/rotate-credential.test.tsx`, `__tests__/home.test.tsx` (profile load + error retry + no functional cash actions exposed).

**Validation performed:** `npx tsc --noEmit` clean; `npx jest --watchAll=false` 6/6 suites, 31/31 tests; `npx expo config --type public` resolves (SDK 52, slug/identity as specified). Emulator smoke was out of scope (per approval conditions).

**Deferred to later phases (unchanged from §8):** agent money surfaces (Cash→Wallet, Wallet→Cash, Cash→Cash), transaction history, outlets/terminals, financial position, commissions, MFA-challenge UI, PIN management, normal credential-change UX (blocked: no backend route, §5), terminology clarifications in §10 docs.
