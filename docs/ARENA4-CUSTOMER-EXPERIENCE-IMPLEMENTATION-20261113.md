# ARENA 4 — Customer Onboarding and Banking Experience

Date: 2026-11-13
Branch: `arena/5ee539a0-monienaija`
Baseline for this mission: `26f5fb4110d303224f2fe45f9a57eeecfe35c57b` (institutional administration console)
Checkpoints added by this mission:

| SHA       | Scope                                                                                       |
| --------- | ------------------------------------------------------------------------------------------- |
| `86ab653` | Backend: `GET /api/v1/customers/me/kyc` customer-safe KYC projection + real-PostgreSQL spec |
| `699f491` | Mobile: banking dashboard, verification screen, receipt, add-money, registration/login UX   |

No merge to `main`, no deployment, no live BVN/NIN provider call, no real financial transaction was
performed. Nothing in Arena 1 (core financial lifecycle), Arena 2 (cash-out / cash-to-cash) or
Arena 3 (consolidation) was modified; the institutional ownership/ledger model is untouched.

---

## 1. What was inspected first

`apps/customer-mobile` was classified screen by screen before any edit, so working onboarding was not
rebuilt:

| Area                                                                                    | State at mission start                                                                                                                     | Action taken                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Phone → OTP → profile → synthetic BVN/NIN → consent → assessment (`RegistrationScreen`) | Functional against the real `registration-sessions/*` contract, with resume, claim, onboarding login and credential setup                  | **Preserved**; only verification-state clarity and requirement checklist added            |
| Claim of an existing customer (`claim-match`, `claim-credentials`)                      | Functional (verified-phone session + internal identifier match, no duplicate record)                                                       | **Preserved**; mismatch/pending/locked now render as distinct states                      |
| Six-digit login passcode + separate transaction PIN                                     | Functional via `synthetic-credentials` / `claim-credentials`; stored hashed by the backend, never persisted on device by the app           | **Preserved**                                                                             |
| Onboarding resume                                                                       | Functional (`status`, `onboarding-route`, `synthetic-profile/status`, `synthetic-credentials/status`, `onboarding-session`)                | **Preserved**                                                                             |
| Returning login (`/customers/sessions`)                                                 | Functional but error handling collapsed every failure into one banner                                                                      | **Completed** (status-aware messaging)                                                    |
| Dashboard (`HomeScreen`)                                                                | Incomplete: read `/me/wallets` + `/me/transactions`, printed the raw `customerId` as the greeting, no account details, no KYC, no receipts | **Rebuilt** on `/customers/me/dashboard`                                                  |
| Transaction history                                                                     | Functional (paginated `/me/transactions`, unified types) but rows had no detail/receipt                                                    | **Completed** (`TransactionDetail`)                                                       |
| Verification/tier UX                                                                    | Placeholder — no customer-readable tier, requirement or limit explanation                                                                  | **Added** (`KycStatus` + backend projection)                                              |
| Wallet funding / withdrawal screens                                                     | Unregistered orphans (`FundWallet`, `Withdraw` route keys only)                                                                            | **Left unregistered**; `AddMoney` explains the real state instead of reviving a mock form |

## 2. Contracts consumed (all pre-existing unless stated)

| Endpoint                                            | Used by                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/v1/customers/me/dashboard`                | Home (identity, profile, wallets/balances, receiving identity, 5 recent unified transactions) |
| `GET /api/v1/customers/me/kyc`                      | **New** (`86ab653`) — Home KYC card, `KycStatus`                                              |
| `GET /api/v1/customers/me/limits`                   | `KycStatus`, `AddMoney`                                                                       |
| `GET /api/v1/customers/me/transactions/:transferId` | `TransactionDetail` (receipt)                                                                 |
| `GET /api/v1/customers/me/funding-requests`         | `AddMoney` history                                                                            |
| `POST /api/v1/customers/sessions`                   | Login                                                                                         |
| `customers/registration-sessions/*`                 | Onboarding (unchanged contract)                                                               |

### The one backend addition and why it was necessary

The customer app could not show tier, verification status or upgrade pathway without either
hardcoding thresholds or computing eligibility client-side — both explicitly forbidden. The new read
projects only what the backend already decided:

```
GET /api/v1/customers/me/kyc
{
  customerId, kycLevel, kycStatus,
  assessment: { level, status, reason, expiresAt } | null,
  policy: { configured, version },
  requirements: { level, regulatory: {all,any}, operator: {all,any} } | null,
  evidenceAssessment: { status: 'UNAVAILABLE', reason: 'TRUSTED_EVIDENCE_UNAVAILABLE', note },
  lastEvaluation: { outcome, reason, newLevel, policyVersion, decidedAt } | null,
  manualHold: { reason, since } | null,
  upgradePathway: { status: 'TOP_TIER'|'POLICY_NOT_CONFIGURED'|'MANUAL_REVIEW'|'EVIDENCE_UNAVAILABLE',
                    nextLevel: 'LEVEL_1'|'LEVEL_2'|null },
  asOf
}
```

It is additive, `@Controller('customers/me/kyc')`, self-only (`UnauthorizedException` for non-customer
principals), `Cache-Control: no-store`, and exposes requirement **evidence types** — never amounts,
thresholds, policy authorship or actor ids. `KycTierEvidenceReader.read()` has no confirmed provider
adapter and returns `null` by design, so the projection reports `EVIDENCE_UNAVAILABLE`; `null` is
_not_ an empty evidence set and is never rendered as an unmet requirement.

Coverage: `test/arena4-customer-kyc-view.integration.spec.ts` — 5 tests against real PostgreSQL
(`PG_TEST_RUN_ID=a4kyc10`, 5/5 pass).

## 3. Screens delivered (`apps/customer-mobile`)

**Home — premium banking dashboard.** Cream canvas, forest balance card with a restrained gold rule,
greeting from the real profile name, initials avatar, balance visibility toggle (`••••••`),
`NGN wallet` + real wallet status badge, copyable receiving number (labelled _receiving number_, not
"account number"), Send money / Add money / History actions, KYC card showing tier + status + policy
version + the backend's upgrade-pathway sentence, recent activity that opens the receipt, and a
footer with Support / Security / Log out. Failure, no-wallet, no-receiving-number and empty-history
states are explicit; a failed load shows an error with Retry and **no** balance.

**Verification & limits (`KycStatus`).** Current tier, status, policy version, latest assessment,
manual hold, the published requirement shape split into _Regulatory_ and _MonieNaija policy_ layers
(with `all` items and `any` groups rendered as "one of …"), the evidence-assessment note and reason
code, per-product limit windows with remaining allowances, and a plain explanation that the backend
grants the highest tier whose requirements are all satisfied. No threshold is hardcoded; an
unconfigured policy or product renders as unconfigured rather than as zero.

**Receipt (`TransactionDetail`).** Amount, status badge, narration, type, recording/completion time,
counterparty, fee and copyable reference, with status-specific wording:
`COMPLETED` → "settled"; `PENDING`/`PROCESSING` → "not complete, do not treat as settled";
`PENDING_RECOVERY` → "neither completed nor failed"; `FAILED` → backend `failureMessage`/`failureCode`.
Record types without a detail endpoint (funding, cash-to-cash, cash-in/out) fall back to the history
preview and the screen says so, pointing at support.

**Add money.** States plainly that no customer-initiated in-app funding product exists, shows the
real receiving number for an agent cash deposit, lists recorded funding requests with their true
statuses (including rejection reasons) and shows incoming limits where configured. No amount form,
no POST, no simulated success.

**Onboarding additions.** `VerificationNotice` renders seven distinct states — pending, successful,
failed, information mismatch, service unavailable, additional information required, manual review
required. `SUCCESS` is only ever shown for a backend-confirmed match, and its copy explicitly says
financial access still needs every remaining requirement. An `RemainingRequirements` checklist lists
phone / identity / consent / passcode / PIN / KYC assessment with only backend-confirmed items
ticked. The claim step shows mismatch vs pending vs locked distinctly.

**Login.** Maps real failures: 401 credential error, 403 forbidden, 409 _financial access not yet
available_, 423 lockout, 429 rate limit, 503 service unavailable ("no session was created"), offline,
and a temporary-password rotation notice. Adds a "Start or resume onboarding" entry point and states
that sessions are never restored after backend rejection.

## 4. Institutional relationship and dashboard dependencies (documented, not invented)

- The dashboard shows **no institution** and no institution selector. Institutional affiliation is an
  administrative relationship, not a customer-facing entitlement, and there is no approved product
  policy for customer-initiated institution selection.
- `GET /customers/me/dashboard` is the sole dependency for the balance card: it returns
  `balance.wallets[]` and `balance.primary` (`currency === 'NGN'`). No wallet ⇒ no balance card, an
  explicit "no wallet provisioned yet" state and a support path.
- `receivingIdentity` comes from `/customers/me/receiving-identity` (phone-derived). When it is
  absent, the screen says the number has not been issued and that cash-in/transfers to this customer
  stay unavailable — it does not print a NUBAN.
- Transaction history additionally requires at least one wallet; the backend returns an empty page
  otherwise, which the UI presents as "no transactions yet".
- Institutional ownership and ledger records are never read or written by any of these screens.

## 5. Auth and session model (accepted framework, reconciled in Arena 4)

- Onboarding sessions (`registration-sessions/*`, bearer `registrationBearer`) are separate from
  financial sessions (`/customers/sessions`). `onboarding-login` returns
  `audience: 'customer-onboarding'` when the customer is not financial-eligible and
  `audience: 'customer-api'` plus a full session when it is; the app only ever sets the finance
  store from a `customer-api` token.
- **Reconciliation outcome (Arena 4, task 1).** Arena 2's completed authentication
  (`9466cc2`) and Arena 3's accepted consolidated version were compared rather than merged: the
  accepted session/authentication services and the eligibility service were adopted into this
  branch (`5cf0a27`), the passcode gap (C-6) was closed by integrating that accepted implementation,
  and no second credential store, session issuer, passcode verifier or eligibility mechanism was
  created. Financial authority still comes only from the eligibility gate, never from a successful
  authentication.
- **First-login rotation.** A workforce-issued temporary credential authenticates but issues **no**
  session; `POST /customers/credentials/rotate` re-verifies it, replaces it, revokes the rotated
  credential's sessions and then issues the customer's first real session. The app exposes this as
  `CredentialRotationScreen` and never fabricates a session for it.
- **Self-service credential recovery (C-9, new).** Unauthenticated by design (the caller has no
  session): `GET /customers/credential-recovery/policy`,
  `POST …/challenges` → `202 {status:'ACCEPTED', challengeId}`,
  `POST …/challenges/verify` → `200 {status:'VERIFIED', recoveryToken}`,
  `POST …/complete` → `200 {status:'COMPLETED', purpose, sessionsRevoked}`. Authority is the six-digit
  phone OTP **plus** the trusted-evidence gate; the OTP alone, the phone alone and the recovery token
  alone are all insufficient. `challengeId` is returned for every request — including unknown numbers
  and disabled policy — so acceptance never enumerates accounts; it only becomes usable with the OTP.
  Failures are explicit: `401 INVALID_OR_EXPIRED`, `409 SUPPORT_REQUIRED` (+reason),
  `423` lockout, `429` rate limit. Completion replaces exactly one credential, bumps its version,
  consumes the token in the same transaction and revokes every live session.
- Session expiry unchanged: the API client fires `onCustomerSessionExpired` on 401 and the store
  drops the session with "Your session has expired. Please log in again." No client-side refresh.
- Expiry/revocation: the API client fires `onCustomerSessionExpired` on 401 and the store drops the
  session with "Your session has expired. Please log in again." No token is refreshed client-side.
- Nothing persists a raw OTP, passcode or transaction PIN: OTPs are transient screen state,
  credentials go to the backend and are cleared from state in `finally` blocks (existing behaviour,
  re-asserted by tests).

## 6. Remaining backend dependencies and exact gaps

| ID  | Gap                                                                                                                                 | Impact                                                                                                                                                                                                                         | Recommendation (not implemented here)                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 | No customer-readable account number / NUBAN anywhere (`src/customer-wallet` and `src/customer-app` contain no account-number field) | Dashboard cannot show or copy a bank account number                                                                                                                                                                            | Product decision + NUBAN issuance/allocation service; UI already has a copyable-account slot tested against the receiving number                                                                                                                    |
| C-2 | Tier ↔ limit linkage is not published                                                                                              | `KycStatus` lists limits and requirements side by side but cannot say "this limit is because you are Tier 1"                                                                                                                   | Add `sourceTier`/`reason` to `CustomerLimitsView` (Arena 1/limit-catalog surface)                                                                                                                                                                   |
| C-3 | `GET /customers/me/transactions/:transferId` resolves only wallet transfers                                                         | Funding, cash-in, cash-out and cash-to-cash receipts are unavailable                                                                                                                                                           | Extend the existing unified-history service with a per-type detail projection; the UI already renders a fallback                                                                                                                                    |
| C-4 | No customer-initiated funding product (`POST` funding request)                                                                      | "Add money" can only point at agents                                                                                                                                                                                           | Approved product policy + request-intake endpoint; do not add a client-side form before that exists                                                                                                                                                 |
| C-5 | No identity-evidence provider adapter (`KycTierEvidenceReader.read()` → `null`)                                                     | Upgrades are not assessable; `EVIDENCE_UNAVAILABLE` is the honest state                                                                                                                                                        | Provider integration mission (explicitly deferred)                                                                                                                                                                                                  |
| C-6 | **Resolved.** Passcode is not accepted by `/customers/sessions` (password-only)                                                     | Closed by integrating the accepted Arena 2/3 authentication implementation (commit `5cf0a27`) rather than adding a second credential path; the six-digit passcode is verified by the existing authentication execution service | Done — no new verifier or credential store exists; the mobile app signs in with the passcode through `/customers/sessions`                                                                                                                          |
| C-7 | Financial session issuance requires a trusted evidence source (real production dependency, not a defect)                            | Without an approved evidence reader every customer is refused 409/503 — correct fail-closed behaviour that was **not** weakened                                                                                                | Acceptance now runs end-to-end against real PostgreSQL with the established authoritative KYC fixtures and controlled trusted evidence (`test/support/trusted-tier-fixture.ts`); a production evidence adapter remains an external dependency (C-5) |
| C-8 | **Resolved.** `apps/customer-mobile` had no eslint config or `lint` script                                                          | Closed: flat config mirroring the root convention + `lint`/`format:check` scripts; 0 errors (24 documented warnings: `no-explicit-any` on pre-existing screens + stale disable directives)                                     | Type-aware root rules (`no-floating-promises`, `no-misused-promises`, `consistent-type-imports`) are deliberately deferred: retro-fitting them to shipped screens is a code migration, not a config change                                          |
| C-9 | **Resolved.** No self-service credential-recovery endpoint                                                                          | Closed by `src/customer-recovery/*` (OTP + trusted evidence, fail-closed `SUPPORT_REQUIRED`) and `CredentialRecoveryScreen` (passcode and transaction-PIN purposes, support pathway, no OTP/token persistence)                 | Verified by `test/arena4-customer-journey.integration.spec.ts` (7/7, real PostgreSQL) and `__tests__/credential-recovery.test.tsx` (11 tests)                                                                                                       |

## 7. Controlled test evidence boundary

- Registration's identity step talks to `synthetic-verification` / `synthetic-*` endpoints, which the
  backend only exposes in test/simulation mode (`simulation-availability`, `__DEV__` guard). The app
  labels it "Development simulation only. Use test data; never enter a real BVN or NIN."
- No live BVN/NIN provider is called anywhere in this mission.
- The KYC projection never reports evidence as verified: without an adapter it reports
  `TRUSTED_EVIDENCE_UNAVAILABLE`.

## 8. Acceptance matrix

| Requirement                                        | Evidence                                                                                                                                                                                                                                                                       | Real backend or mocked UI                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| New-customer onboarding                            | `registration.test.tsx` (BVN + NIN walks, no activation claim)                                                                                                                                                                                                                 | Mocked HTTP; backend contract pre-existing                             |
| Existing-customer claim without duplicate identity | `registration.test.tsx` (claim BVN/NIN after OTP, mismatch, resumed match) + backend `claim-match` semantics                                                                                                                                                                   | Mocked UI over real contract                                           |
| Interrupted-onboarding recovery                    | `registration.test.tsx` (resume profile, resume matched attempt, recover credential setup, resume claim)                                                                                                                                                                       | Mocked UI                                                              |
| Verification failure / unavailable states          | `verification-notice.test.tsx` (7 states, only one success), `registration.test.tsx` pending/mismatch                                                                                                                                                                          | Pure component + mocked UI                                             |
| Passcode + PIN setup                               | `registration.test.tsx` (separate six-digit values, no secrets persisted)                                                                                                                                                                                                      | Mocked UI                                                              |
| Returning authentication + session transition      | `login.test.tsx` (401/403/409/423/429/503/offline, rotation-required), `auth-store.test.ts` + `api-client.test.ts` (expiry/revocation)                                                                                                                                         | Store + client unit tests                                              |
| Accurate KYC status                                | `arena4-customer-kyc-view.integration.spec.ts` (5/5, real PostgreSQL), `kyc-status.test.tsx`, `home.test.tsx`                                                                                                                                                                  | **Real backend** for the projection; UI mocked                         |
| Dashboard with real account/balance data           | `home.test.tsx` (balance, name, receiving number, visibility toggle, receipt navigation)                                                                                                                                                                                       | Mocked UI over the real projection shape                               |
| Dashboard without an active financial account      | `home.test.tsx` no-wallet state; `add-money.test.tsx` no-wallet state                                                                                                                                                                                                          | Mocked UI                                                              |
| Financial-eligibility restriction                  | `login.test.tsx` 409 copy; backend eligibility gate untouched                                                                                                                                                                                                                  | Mocked UI over real refusal                                            |
| Transaction history + receipt                      | `transaction-detail.test.tsx` (settled/pending/recovery/failed/fallback), existing `transactions.test.tsx`                                                                                                                                                                     | Mocked UI over real contract                                           |
| No fabricated financial success                    | `presentation.test.ts` (pending never SUCCESS, non-terminal unresolved), `transaction-detail.test.tsx`, `add-money.test.tsx` (no POST, no fake form)                                                                                                                           | Unit                                                                   |
| Expired/revoked session handling                   | `api-client.test.ts` listener tests, `auth-store.test.ts` restore-with-expiry                                                                                                                                                                                                  | Unit                                                                   |
| Auth reconciliation (passcode login, rotation)     | `5cf0a27` (accepted Arena 2/3 session + eligibility services adopted), `arena4-customer-journey` cases 5-6 and 13-14, `credential-recovery.test.tsx` rotation cases                                                                                                            | **Real backend + PostgreSQL** for the login/rotation contract          |
| Self-service credential recovery (passcode + PIN)  | `arena4-customer-journey` case 13-14 (OTP wrong-code accounting, verified token, atomic replacement, replay refused, sessions revoked, new credential usable in the accepted stores), `credential-recovery.test.tsx` (5 screen cases)                                          | **Real backend + PostgreSQL**; screen behaviour mocked                 |
| Recovery fails closed / no enumeration             | `arena4-customer-journey` final case (unknown number ⇒ identical `202` and no row; withdrawn evidence ⇒ `409 SUPPORT_REQUIRED` with the credential hash unchanged; disabled policy ⇒ no challenge)                                                                             | **Real backend + PostgreSQL**                                          |
| Credential rotation UX                             | `CredentialRotationScreen` + `credential-recovery.test.tsx` (validation, 409 eligibility copy, no pending rotation)                                                                                                                                                            | Mocked UI over the real contract                                       |
| Financial denial after eligibility loss            | `arena4-customer-journey` case 15 (manual hold ⇒ request refused, live session revoked with reason, reauthentication refused)                                                                                                                                                  | **Real backend + PostgreSQL**                                          |
| Full authenticated journey (15 steps)              | `test/arena4-customer-journey.integration.spec.ts` **7/7** — registration front door, enrolment, passcode + separate PIN, eligibility refusal then grant, dashboard/KYC/limits, transfer → history → receipt, logout → reauthentication, credential recovery, eligibility loss | **Real backend + PostgreSQL** (mobile UI substituted only where noted) |
| `test/a23-customer-app.integration.spec.ts`        | **15/15** (was 13 failed / 2 passed) after the `TrustedTierFixture` fix and controlled evidence                                                                                                                                                                                | **Real backend + PostgreSQL**                                          |

## 9. Verification runs

| Check                                       | Command                                                                                                               | Result                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Backend typecheck                           | `npx tsc --noEmit`                                                                                                    | clean                                                                                        |
| Backend lint                                | `npm run lint`                                                                                                        | 0 errors, 0 warnings                                                                         |
| Backend format                              | `npm run format:check`                                                                                                | clean                                                                                        |
| Backend unit                                | `npm test`                                                                                                            | **241 suites / 2863 tests pass**                                                             |
| Backend build                               | `npm run build`                                                                                                       | clean                                                                                        |
| KYC projection integration                  | `PG_TEST_RUN_ID=a4kyc10 … jest --config jest.integration.config.js test/arena4-customer-kyc-view.integration.spec.ts` | **5/5 pass** (real PostgreSQL)                                                               |
| Backend build at final head                 | `npm run build` (`nest build`)                                                                                        | clean                                                                                        |
| Full journey acceptance                     | `PG_TEST_RUN_ID=a4journey13 … --runTestsByPath test/arena4-customer-journey.integration.spec.ts`                      | **7/7 pass** (real PostgreSQL, 15 journey steps)                                             |
| Customer app integration (a23)              | `PG_TEST_RUN_ID=a4auth03 … --runTestsByPath test/a23-customer-app.integration.spec.ts`                                | **15/15 pass** (was 13 failed / 2 passed)                                                    |
| Auth / session / notification regression    | `PG_TEST_RUN_ID=a4auth04` on a23 + journey + kyc-view + notification-registry + migration-chain                       | **5 suites / 54 tests pass**                                                                 |
| Recovery unit + client unit                 | `npx jest --runTestsByPath test/authentication-session.service.spec.ts test/customer-authentication*.spec.ts`         | **4 suites / 36 tests pass**                                                                 |
| Mobile typecheck                            | `npm run ts:check`                                                                                                    | clean                                                                                        |
| Mobile format                               | `npm run format:check`                                                                                                | clean (whole app formatted under the root Prettier config)                                   |
| Mobile tests                                | `npm test`                                                                                                            | **21 suites / 175 tests pass** (baseline before Arena 4 was 14/122; 20/164 before this task) |
| Mobile lint                                 | `npm run lint` (new flat config, C-8)                                                                                 | **0 errors**; 24 warnings (pre-existing `no-explicit-any`, stale disable directives)         |
| `test/a23-customer-app.integration.spec.ts` | `PG_TEST_RUN_ID=a4auth03`                                                                                             | **15/15 pass**                                                                               |

### 9.1 Visual-acceptance attempt (2026-11-13)

Task 5 required an _attempt_ at rendering, not just an assertion that rendering was impossible. What
was actually done:

1. Exported the real production web bundle of `apps/customer-mobile`:
   `EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4318 npx expo export --platform web`
   → **succeeded** (`/tmp/a4web/index.html` + 886 kB `AppEntry-*.js`). This needed
   `react-native-web@0.19.13` and `@expo/metro-runtime@~4.0.1` installed with `--no-save` (sandbox
   only: neither is added to the app's `package.json`/lockfile, because a real web target is out of
   scope for this mission).
2. Wrote a harness that serves the bundle plus a **visual-only** stub API and drives it with Playwright,
   using the Chromium binary already available at `@sparticuz/chromium` 153.0.0.
3. The browser **could not start**: `ldd /tmp/chromium` reports `libnspr4.so`, `libnss3.so` and
   `libnssutil3.so` as `not found`; the sandbox runs as uid 1001 (no root), has no apt cache and no
   network access to distribution archives, so those libraries cannot be installed.

Consequence: the export proves the code compiles and bundles for a real renderer, but **no frame was
ever rendered**, so no screenshot, layout, spacing, contrast or touch-target claim is made for the new
auth screens (or any other screen). Everything visual remains asserted structurally only.

## 10. What is explicitly not claimed

- **No visual acceptance.** The Expo app was not rendered in this environment (no device, emulator,
  web target or screenshot pipeline was available), so no claim is made that the layout looks correct
  on a physical screen. Everything visual is asserted structurally in jest/react-native-testing-library
  only.
- **No visual acceptance** of the two new auth screens (`CredentialRecoveryScreen`,
  `CredentialRotationScreen`): like the rest of the app they are asserted structurally only.
- **Not claimed:** that self-service recovery works against a live SMS/identity provider. Acceptance
  used the test notification provider and the established authoritative KYC fixtures; the production
  evidence adapter (C-5) and a real SMS provider are external dependencies.
- No live BVN/NIN call, no real transfer, no deployment, no `main` merge. The journey spec's transfer
  is a Platform→Customer journal against the real ledger inside a disposable PostgreSQL cluster, and
  the spec states that explicitly.
