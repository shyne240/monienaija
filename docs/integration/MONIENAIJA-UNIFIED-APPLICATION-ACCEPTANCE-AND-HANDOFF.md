# MonieNaija — Unified application acceptance and handoff

Branch `arena/ca576774-monienaija`, consolidated from `5acc9c8` (base of `arena/8e59e188-monienaija`).
Arena 3B final checkpoint `cb8b4ea`, customer-application checkpoint `24d73f0`, handoff commit
recorded in §F. Environment: 2 vCPU / 3.8 GiB sandbox, embedded PostgreSQL 18.4, Node 22.22.3,
synthetic data only.

This document is the single handoff for the whole mission: what was integrated, what each part can
actually do today, what was executed and what was not, which production authority is still missing
behind every fail-closed behaviour, and the dependency-ordered path to close those gaps.

**Nothing here is a production-readiness claim.** No production credential, live provider, real
payment, deployment or `main` merge exists in this record. Every number below comes from a command
that was executed in this workspace; unexecuted gates are named as unexecuted.

---

## A. Source register

### A.1 Frozen sources (never modified by this mission)

| Arena                 | Branch / ref       | Commits                                      | Contents                                                                                                                              |
| --------------------- | ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Arena 1               | `arena/44f00580-*` | `8e4da1a` (implementation), `8ff5164` (docs) | Governed financial engine: ledger reversal `0117`, commitments `0140`/`0141`, A7 inbound `0142`-`0146`, agent funding pool, readiness |
| Arena 2               | `arena/ea070127-*` | `0472687` (implementation), `2b4da60` (docs) | Institutional foundation and administration: institutions, enrolments, governed wallet attribution, console                           |
| Arena 3B (agent desk) | base branch        | `740ce95` and predecessors                   | Cash-to-Cash funding authority, institutional obligation attribution, transaction-bound claim authority                               |
| Arena 4               | `arena/5ee539a0-*` | `7167fe9` (implementation), `2e02634` (docs) | Customer application: KYC projection, dashboard/receipt screens, credential recovery, first-login rotation, migration `0402`          |

Frozen refs were read, never written. No `git push` targeted them, no commit was amended in them.

### A.2 Arena 4 replay (Stage 2) — dependency order, `-x` provenance retained

Replayed onto `cb8b4ea` in the order the frozen handoff records, each pick `-x`-tagged:

| #   | Source    | Result    | Conflict and resolution                                                                      |
| --- | --------- | --------- | -------------------------------------------------------------------------------------------- |
| 1   | `86ab653` | `55c8037` | clean — customer KYC projection service/controller                                           |
| 2   | `699f491` | `aa05253` | clean — customer dashboard/receipt/add-money screens                                         |
| 3   | `c0d7161` | `480f5e2` | `UU` `production-readiness.service.ts`, `UU` `a23-customer-app.integration.spec.ts` (D1, D2) |
| 4   | `99d00bf` | `58fe38e` | `UU` `package-lock.json`, `UU` `auth-store.ts` (D3, D4)                                      |
| 5   | `7167fe9` | `f3c3000` | `UU` docs → took theirs (D5)                                                                 |
| 6   | `9526718` | `cf14979` | clean                                                                                        |
| 7   | `aec6d37` | `d58da7a` | clean                                                                                        |
| 8   | `2e02634` | `e6644e9` | `UU` docs → took theirs (D5)                                                                 |

Arena 2's reconciliation commit `5cf0a27` (the passcode/session reconciliation) was **deliberately not
replayed**: its behaviour is already present in the consolidated branch, and the residual diff against
it is Prettier-only for the session service while our `mobile-onboarding-auth.service.ts` and
`customer-financial-eligibility.service.ts` are strictly stronger (savepoint-bounded credential
creation and an explicit `ServiceUnavailableException` path). Re-adopting it would have removed the
savepoint and the 503 branch.

### A.3 Conflict-resolution register (D1–D12)

| ID  | Location                                         | Resolution and reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `src/production/production-readiness.service.ts` | Kept the consolidated constants: `EXPECTED_MIGRATION_TIMESTAMP/NAME` stay `1785753600503` / `CashOutInstitutionalScope…`. Taking Arena 4's would have regressed the head to `…0402`, which is _not_ the head — `0402` is a lower-numbered migration that applies inside the institutional range.                                                                                                                                                                                                                                                         |
| D2  | `test/a23-customer-app.integration.spec.ts`      | Kept `useValue(kycEvidence.reader)` + `makeCustomerFinanciallyEligible` (the governed eligibility helper); the replay's duplicate `KycTierEvidenceReader` import was deleted.                                                                                                                                                                                                                                                                                                                                                                            |
| D3  | `apps/customer-mobile/package-lock.json`         | Took the replay side so the manifest/lock pair stays consistent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D4  | `apps/customer-mobile/src/store/auth-store.ts`   | Merged additively: the consolidated store (audience check + `acceptSession` + `ONBOARDING_TOKEN_STORAGE_KEY`, used by `RegistrationScreen.tsx` and `__tests__/auth-store.test.ts`) plus the replay's `rotationCustomerId`, `rotateTemporaryCredential` (posts `/customers/credentials/rotate`, then `acceptSession`) and `clearRotation`. Taking the replay wholesale would have deleted exports the app and tests still import.                                                                                                                         |
| D5  | `docs/ARENA4-*`                                  | Took the replay side (documentation of the source arena).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D6  | Session issuance refusal mapping                 | The consolidated branch maps an eligibility refusal raised _inside_ session issuance (`ConflictException`) to a generic `401 Invalid credentials` in `POST /customers/sessions` so an unauthenticated caller cannot enumerate eligible accounts; `503` still propagates when trusted evidence is unavailable. The Arena 4 journey assertion was corrected to assert the invariant that matters — **no session is issued** (no `accessToken`, `sessionId` or `rotationRequired`) and the status is one of `401/409/503`. No eligibility rule was relaxed. |
| D7  | Auth store ordering                              | `acceptSession` runs only after a successful rotation, so a failed rotation never leaves a half-signed-in client.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D8  | Rotation surface                                 | Kept the consolidated create-only PIN and single rotation surface (`/customers/credentials/rotate`): rotation is refused with `403` for a credential that is not pending rotation, so it never becomes a second password-management path.                                                                                                                                                                                                                                                                                                                |
| D9  | Wallet→wallet transfer                           | No Arena 4 file reimplemented transfers; the customer app keeps calling the governed `TransferService`. Send stays available only for an approved destination and PIN, with no new rail.                                                                                                                                                                                                                                                                                                                                                                 |
| D10 | Customer KYC projection                          | Arena 4's `CustomerKycViewService` is authoritative-backend-only (policy from the governed tier-policy head, `no-store`); no mobile tier calculator, no upgrade button, no hardcoded regulatory threshold.                                                                                                                                                                                                                                                                                                                                               |
| D11 | Migration inventory                              | `0402` adopted exactly as published; no renumbering, no fabricated `typeorm_migrations` rows; readiness detects and reports a missing `0402` row as `schema_incompatible`.                                                                                                                                                                                                                                                                                                                                                                               |
| D12 | Lint/format gates                                | The Arena 4 mobile lint gate (`apps/customer-mobile/eslint.config.js`, `lint`/`format:check` scripts) was kept; formatting debt was closed in a **separate formatting-only commit** (§E).                                                                                                                                                                                                                                                                                                                                                                |

### A.4 Manifest changes

None to runtime dependencies. Two web-only libraries (`react-native-web`, `@expo/metro-runtime`) are
needed to build the Expo **web** target used for the Stage 9 attempt; they were installed with
`--no-save` so `apps/customer-mobile/package.json` and its lockfile stay exactly as published, and
`npm ci` reproducibility is unaffected.

---

## B. Capability inventory (five classes)

Each capability is marked **live** (exercised end-to-end against real PostgreSQL and the real service
path), **present-but-gated** (implemented, refuses until a named authority exists), or **absent**
(not implemented and not faked).

### B.1 Governed financial core

| Capability                                                                       | State                                                                 | Where                                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| Double-entry ledger, idempotent postings, per-account balance derivation         | live                                                                  | `src/ledger/*`                                           |
| Governed ledger reversal with atomic approval consumption and execution evidence | present-but-gated (approval authority)                                | `src/ledger/reversal/*`, migration `0117`                |
| Financial commitments: reservation, settlement, rejection, compensation          | present-but-gated (verified provider settlement)                      | `src/financial-commitments/*`, migrations `0140`, `0141` |
| A7 inbound receipts bound to a lifecycle                                         | present-but-gated (inbound verifier)                                  | migrations `0142`-`0146`                                 |
| Wallet creation authority (customer eligibility / active agent)                  | live, gated for agents                                                | `src/wallet/*`                                           |
| Withdrawal execution authority                                                   | present-but-gated (institutional entitlement + destination ownership) | `src/withdrawal/*`                                       |
| Agent funding pool `AGENT_FUNDING_POOL-NGN`                                      | present-but-gated (economic classification, see D-6)                  | `docs/integration/AGENT-FUNDING-POOL-CLASSIFICATION.md`  |
| Readiness gate that fails closed on unverified financial dependencies            | live                                                                  | `src/production/production-readiness.service.ts`         |

### B.2 Institutional ownership and authority

| Capability                                                                              | State | Where                                                                                |
| --------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------ |
| Institution registry, lifecycle, suspension                                             | live  | `src/institutions/*`, migrations `…0400` etc.                                        |
| Customer enrolment per institution, confined to its owner                               | live  | `customer_institution_enrolments`                                                    |
| Governed wallet attribution with consumed approval, DB-enforced scope                   | live  | migration `1785753600401`, `src/institutions/*`                                      |
| Same-institution internal posting; cross-institution refusal (service **and** database) | live  | `LedgerService.resolveJournalInstitution`, ownership suites                          |
| Institution-scoped Cash-to-Cash obligation attribution and claim                        | live  | `src/agent/cash-to-cash-*`                                                           |
| Protected authority boundary (separate credential, MFA checker, immutable evidence)     | live  | `src/protected-authority/*`, `test/protected-authority-boundary.integration.spec.ts` |

### B.3 Agent desk

| Capability                                                                                   | State                                                   | Where                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Workforce login, roles, class capabilities                                                   | live                                                    | `src/workforce/*`                               |
| Governed Cash-to-Cash initiation with funding-authority decision                             | live                                                    | `src/agent/cash-to-cash-funding-policy.ts`      |
| Transaction-bound claim with `CASH_TO_CASH_CLAIM` OTP re-read inside the posting transaction | live                                                    | `src/agent/agent-cash-to-cash-claim.service.ts` |
| Agent wallet ownership rules (non-ACTIVE agent cannot own a wallet)                          | live                                                    | `src/wallet/*`                                  |
| Institution-bound agent float rail                                                           | absent — refused rather than funded from platform float | D-7                                             |

### B.4 Customer application (Arena 4, consolidated this mission)

| Capability                                                                                                                         | State                                                                           | Where                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Registration front door + OTP verification, existing-customer claim without duplicate customer/wallet                              | live                                                                            | `src/customer-registration/*`                                                    |
| Six-digit passcode as the `/customers/sessions` credential; separate transaction PIN                                               | live                                                                            | `src/customer-authentication/*`, `POST /customers/me/transaction-pin`            |
| Mandatory first-login rotation of a workforce-issued temporary credential (no session before rotation, atomic rotate→revoke→issue) | live                                                                            | `POST /customers/credentials/rotate`                                             |
| Session audiences and identity-consistency validation, revocation on logout/password change/recovery                               | live                                                                            | `src/customer-authentication/authentication-session.service.ts`, `auth-store.ts` |
| Customer-safe KYC projection (level, policy, limits, upgrade pathway)                                                              | live, gated by evidence provider                                                | `src/customer-app/customer-kyc-view.service.ts`                                  |
| Dashboard with distinct no-wallet / restricted / error states, ledger-derived balance only                                         | live                                                                            | `GET /customers/me/dashboard`, `GET /customers/me/financial-position`            |
| Receiving identity / receiving number (explicitly **not** a NUBAN)                                                                 | live, gated (D-1)                                                               | `GET /customers/me/receiving-identity`                                           |
| Unified history + customer-safe receipt where pending ≠ settled                                                                    | live                                                                            | `GET /customers/me/transactions[/:id]`                                           |
| Self-service credential recovery (passcode and transaction PIN) via OTP + trusted evidence                                         | live, gated by evidence provider                                                | `src/customer-recovery/*`, migration `0402`                                      |
| Wallet→wallet Send                                                                                                                 | live only for an approved destination with PIN; no new rail, no funding surface | `POST /customers/me/transfers`                                                   |
| Customer-initiated funding ("Add money" intake)                                                                                    | absent — screen shows the honest unavailable state                              | D-4                                                                              |
| NUBAN / bank account number                                                                                                        | absent — nothing is invented                                                    | D-1                                                                              |
| Non-wallet receipts (funding, cash-in/out, cash-to-cash)                                                                           | absent — detail resolves wallet transfers only                                  | D-3                                                                              |

### B.5 Platform administration, release gates and tooling

| Capability                                                                            | State                                              | Where                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Admin console (roles, operational writes, institutional administration)               | live                                               | `apps/admin-web`, `src/admin/*`                       |
| Migration inventory guard (unique ids, published names, no renumbering)               | live                                               | `test/migration-inventory.spec.ts`                    |
| Readiness: head + missing-earlier-migration detection + financial dependency blockers | live                                               | `src/production/production-readiness.service.ts`      |
| Notification registry and delivery authorization                                      | live                                               | `src/notification/*`                                  |
| Release tooling: root Prettier scope, app-level lint configs, bounded PG runner       | live (see §E)                                      | `package.json`, `scripts/run-pg-integration-tests.js` |
| Customer web target / visual pipeline                                                 | absent in the shipped app (out of scope, see §C.7) | —                                                     |

### B.6 Customer financial action map (Stage 7)

Every customer-facing financial affordance maps onto a real, existing backend contract. Where a
contract does not exist, the app shows an honest unavailable state instead of inventing one.

| Customer action                         | Endpoint the app calls                              | Backing contract                                                         | State                                                                      |
| --------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Sign in with the six-digit passcode     | `POST /customers/sessions`                          | `AuthenticationExecutionService` → `AuthenticationSessionService.issue`  | live, gated by evidence (D-3)                                              |
| Complete first-login rotation           | `POST /customers/credentials/rotate`                | `rotateInitialPasswordInManager` + revoke-all + issue in one transaction | live                                                                       |
| Read dashboard and balance              | `GET /customers/me/dashboard`                       | `WalletService.listWallets` (ledger-derived), transfer history           | live                                                                       |
| Read KYC level, limits, upgrade pathway | `GET /customers/me/kyc`, `GET /customers/me/limits` | `CustomerKycViewService`, governed tier-policy head, limit catalog       | live, upgrade gated (D-2, D-3)                                             |
| Copy receiving identity                 | `GET /customers/me/receiving-identity`              | `ReceivingNumberService`                                                 | live (not a NUBAN, D-1)                                                    |
| Send to a customer wallet               | `POST /customers/me/transfers`                      | `TransferService` + `LedgerService` + transaction PIN                    | live, only for an existing destination the resolver returned; PIN required |
| Browse history                          | `GET /customers/me/transactions`                    | unified history projection                                               | live                                                                       |
| Open a receipt                          | `GET /customers/me/transactions/:id`                | transfer detail projection                                               | live for wallet transfers (D-5)                                            |
| Set / change the transaction PIN        | `POST /customers/me/transaction-pin[/change]`       | `CustomerTransactionPinService` with lockout accounting                  | live                                                                       |
| Recover passcode or PIN                 | `/customers/credential-recovery/*`                  | `CustomerCredentialRecoveryService` + OTP + trusted evidence             | live, gated by evidence and SMS provider (D-3, D-12)                       |
| Add money                               | none                                                | no approved funding/product intake contract exists                       | **absent, shown as unavailable** (D-4)                                     |
| Change bank account number              | none                                                | no NUBAN allocation service exists                                       | **absent** (D-1)                                                           |
| Refund / return a transfer              | none                                                | no approved return policy or authenticated return outcome                | **absent, refused by design** (D-10)                                       |

No customer-wallet-funded Cash-to-Cash, no new rail, no client-side money creation: the only posting
surfaces the customer app can reach are the governed wallet→wallet transfer and the read models above.

---

## C. Acceptance record

Reference date 2026-11-15 (UTC). Commands are reproduced in §C.8 and §F.

### C.1 Backend PostgreSQL integration matrix — **153 files, 26 batches, 153/153 suites: PASS**

`NODE_ENV=test DB_HOST=127.0.0.1 npm run test:pg:bounded`
(`PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560`)

| Metric                                           | Result                         |
| ------------------------------------------------ | ------------------------------ |
| Files discovered / batches executed              | 153 / 26                       |
| Suites passed                                    | **153 / 153**                  |
| Tests                                            | **2,750 / 2,750 passed**       |
| Exit code                                        | **0**                          |
| Runner-reported duration                         | 62.0 min (wall clock ≈ 83 min) |
| Memory failures / timeouts / unexplained crashes | 0 / 0 / 0                      |
| Failing batches                                  | 0                              |

This is the **final tree** (after the replayed customer application, the journey/rotation additions,
the Stage 10 spec and the formatting-only commit) — not a pre-formatting snapshot.

An earlier full pass on the pre-formatting tree reported **151 passed / 2 failed**; both failures were
corrected expectation drift (§C.2), the two suites re-ran green, and the complete matrix above then
passed with zero failures. Arena 1's accepted baseline was 150 files / 2,722 tests; this run adds the
three customer/migration suites and the new journeys (+28 net tests).

### C.2 The two first-pass failures and their classification

Both were **baseline-relative expectations that the consolidated inventory legitimately invalidated**.
Neither was a behavioural regression; no assertion was relaxed and no retry budget was raised.

| Suite                                                                            | Observed                                                                                                                | Classification and resolution                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/migration-chain.integration.spec.ts` (0400 historical upgrade)             | Applied list contained `CreateCustomerCredentialRecoveryChallenges1785753600402`, which the expected array did not name | **Correct new behaviour**: Arena 4's migration is lower-numbered than the institutional head and must apply in timestamp order inside that range. The expected array gained the entry.                                                                                                                                                                 |
| `test/notification-migration-upgrade-01.integration.spec.ts` (head-096 baseline) | `configs 81 → 83`, `locked_security 6 → 8`, `sms_enabled 24 → 25`                                                       | **Correct new inventory**: the seeding migration reads `NOTIFICATION_SECURITY_DEFAULTS_V1` at run time and Arena 4 added one SECURITY event (`customer.credentials.recovery_otp`) → +2 config rows (SMS+EMAIL), +2 locked rows, +1 enabled SMS channel. Expectation updated with the derivation recorded in the spec; nothing was unlocked or widened. |

Both suites re-ran green: **2 suites / 22 tests**.

### C.3 Isolated KYC PostgreSQL group — **PASS**

`KYC_ISOLATED_CONFIRM_DISPOSABLE=yes npm run test:pg:isolated-kyc` → **10 suites / 114 tests, exit 0**.

### C.4 Suite-level acceptance (backend, apps, gates)

| Group                  | Command                                           | Result                                                                                    |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Backend unit           | `npx jest --config jest.config.js --runInBand`    | **250 suites / 2,923 tests**, exit 0                                                      |
| `apps/admin-web`       | `npm test`                                        | **85 suites / 868 tests**, exit 0                                                         |
| `apps/agent-mobile`    | `npm test`                                        | **20 suites / 310 tests**, exit 0                                                         |
| `apps/customer-mobile` | `npm test`                                        | **21 suites / 178 tests**, exit 0 (Arena 1 baseline: 14 / 125)                            |
| TypeScript             | `npx tsc --noEmit`                                | **0 errors**                                                                              |
| Production build       | `npm run build`                                   | exit 0                                                                                    |
| Lint (repo)            | `npm run lint`                                    | **0 errors**, 5 warnings (5 unused `eslint-disable` directives, pre-existing)             |
| Lint (customer app)    | `cd apps/customer-mobile && npm run lint`         | **0 errors**, 24 warnings (documented `no-explicit-any` + stale directives, pre-existing) |
| Format (repo scope)    | `npm run format:check`                            | **clean** after the formatting-only commit (was 31 files)                                 |
| Format (customer app)  | `cd apps/customer-mobile && npm run format:check` | **clean**                                                                                 |

### C.5 Customer journeys (Stage 8) — 26 numbered steps, all executed

`test/arena4-customer-journey.integration.spec.ts` — **10 cases / 26 numbered steps, 10/10 pass**
(`PG_TEST_RUN_ID=a4j5`, 26 s).

| Journeys | Executed behaviour                                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-4      | Registration front door + OTP verification; controlled identity evidence; approved LEVEL_1 assessment; passcode stored hashed; separate transaction PIN (create-only, hash never returned)                                                            |
| 5-6      | No session for an ineligible customer (401/409/503, never a token); passcode login issues a customer-audience session; wrong passcode 401                                                                                                             |
| 7-10     | Dashboard, KYC projection (`no-store`, governed policy), limits, ledger-funded transfer, history, receipt; foreign customer gets 404 on the receipt; no hashes/journal ids leak                                                                       |
| 11-12    | Logout revokes the session; reauthentication issues a different token                                                                                                                                                                                 |
| 13-14    | Passcode and PIN recovery through OTP + trusted evidence; live sessions revoked; same-token replay refused                                                                                                                                            |
| 15       | Eligibility loss denies financial access and does not restore the withdrawn session                                                                                                                                                                   |
| extra    | Recovery fails closed without trusted evidence and never enumerates accounts; durable attempt limit locks the challenge; expiry is server-enforced; no credential touched                                                                             |
| 16-17    | Temporary credential: no session before rotation; rotation proves the current secret, refuses an unchanged value, revokes sessions, advances `password_version`, clears rotation/expiry, appends `ROTATED` history, refuses a normal credential (403) |
| 18-19    | No-wallet (`walletExists:false`, empty wallet list, no fabricated ₦0 claim) vs a genuine zero vs a suspended (restricted) wallet                                                                                                                      |

Cross-customer isolation is additionally executed in `test/a23-customer-app.integration.spec.ts`
case 9 (SELF enforcement: A cannot read B's data) and case 10 (agent/workforce tokens rejected on
customer surfaces). **Cross-institution rejection** is executed in
`test/institution-financial-ownership.integration.spec.ts` case 11 — refused by the service **and** by
the database — with cases 3-9 and 12-15 covering attribution evidence, atomic consumption,
concurrency, suspension and resolver revalidation.

### C.6 Migration acceptance (Stage 10) — 23 checks, all executed

`test/stage10-recovery-migration.integration.spec.ts` — **13 grouped cases covering 23 checks, 13/13
pass** (26 s):

- published identifier/name/file for `1785753600402`, class name parity, unique and ordered ids;
- fresh install: whole chain applied, zero pending, `0402` positioned between `…0401` and `…0500`,
  head still `1785753600503`, documented columns/constraints/indexes/FK, zero fabricated recovery,
  credential, session or PIN rows, no plaintext OTP/token column, recovery notification event seeded;
- upgrade from this branch's own baseline (`…0401`): `0402` applies in order, nothing left pending,
  head unchanged;
- **row preservation across the upgrade**: customer status, credential version, session status, KYC
  assessments, wallet status, posted journal + its 2 lines, consumed approval, institution registry
  row and ledger-account scope all byte-identical before/after, with zero recovery rows invented;
- readiness: `compatible:true`, `latestTimestamp 1785753600503`, `status:error` /
  `financial_dependencies_not_ready` (still fail-closed), then deleting the `0402` row yields
  `compatible:false` / `schema_incompatible` with the exact missing name, and restoring it recovers.

Migration inventory guard: `test/migration-inventory.spec.ts` **5/5** with `0402` added to the
adopted-published-identifier set. **143** migration files, head `1785753600503`.

### C.7 Security regression (Stage 12)

| Group                                                                                                                                                                                                                                                                                        | Result                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Protected authority boundary (the four reproductions: no protected write path for the ordinary runtime credential; no manufactured request/decision/consumption/execution; immutable checker evidence with a legitimate MFA flow; readiness clamped without a separate authority credential) | **PASS**                                 |
| Institutional ownership and cross-institution rejection (15 cases)                                                                                                                                                                                                                           | **PASS**                                 |
| Customer credit path (a23: SELF enforcement, agent/workforce rejection, PIN lockout, route policies, no direct financial mutation)                                                                                                                                                           | **PASS**                                 |
| Auth/session units (`authentication-session.service.spec.ts`, `customer-authentication{,-runtime,-rate-limit}.spec.ts`)                                                                                                                                                                      | **PASS** (inside the 250-suite unit run) |

Post-formatting re-verification of the security-critical PG group (protected authority + institutional
ownership + customer trio + migration chain + Stage 10 + notification upgrade):
`PG_TEST_RUN_ID=postfmt1` → **8 suites / 88 tests, exit 0**.

### C.8 Resource-aware execution record (Stage 14)

| Field                                | Value                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host                                 | 2 vCPU, 3.9 GiB RAM, Node 22.22.3, embedded PostgreSQL 18.4 on `127.0.0.1:5432`                                                                                                                                                                                                                                                                                                                    |
| PG runner                            | `scripts/run-pg-integration-tests.js` with `PG_TEST_CONCURRENCY=1`, `PG_TEST_BATCH_SIZE=6`, `PG_TEST_MAX_OLD_SPACE_MB=2560`                                                                                                                                                                                                                                                                        |
| Matrix run id                        | `r37caa9a3bd69` (disposable databases `mn_it_*`)                                                                                                                                                                                                                                                                                                                                                   |
| Matrix wall clock                    | 3,640,503 ms (60.7 min), 26/26 batches executed, 0 memory failures, 0 timeouts                                                                                                                                                                                                                                                                                                                     |
| Customer journey runs                | `a4j1` (1 failure, diagnosed), `a4j2`/`a4j3`/`a4j4` (iteration), `a4j5` (10/10)                                                                                                                                                                                                                                                                                                                    |
| Stage 10 runs                        | `s10a` (1 failure: governed enrolment requires a consumed approval — fixture corrected, not the guard), `s10b` (1 failure: `governed_ledger_reversal_executions` has no `id` column — fixture corrected), `s10c` (13/13)                                                                                                                                                                           |
| Other run ids                        | `mc01` (2 suites), `postfmt1` (8 suites), `isokyc` group, `admin`/`agent`/`customer` app runs                                                                                                                                                                                                                                                                                                      |
| Flaky history (recorded, not hidden) | (1) First admin-web run _after_ formatting reported 2 failures in agent-classes tests (`Exceeded timeout of 5000 ms`, `Unable to find role="alert"`); the file passes in isolation and the full suite re-ran green 868/868. Load-induced, not a defect in the code under test. (2) An early `npm run lint` was OOM-killed while the PG matrix was running; it passes with 0 errors when run alone. |
| Deliberate constraint                | No other suite was executed while the PG matrix was running, and the AST/JS-heavy smoke was not run concurrently with jest.                                                                                                                                                                                                                                                                        |

The full matrix was executed **twice**: once before the formatting-only commit (151/153, with the two
expectation-drift failures fixed and re-verified) and once on the final tree after it (153/153, 2,750
tests, exit 0). The numbers in §C.1 are the final pass. Suite-level gates (unit, admin, agent,
customer, tsc, lint, build, `npm ci`) were likewise re-run on the final tree.

### C.9 Stage 9 — visual acceptance: **NOT EXECUTED** (environment limitation)

No screenshot exists and none is claimed; no physical-device acceptance is claimed. Detail and the
exact blocker (no browser binary; Playwright's Chromium download host unreachable; two web libraries
needed, installed `--no-save`) are recorded in
`docs/integration/ARENA3B-CUSTOMER-VISUAL-ACCEPTANCE.md`. What _was_ achieved: the Expo web export of
the real app builds (498 modules, 887,605-byte bundle), mounts in a DOM and reacts to input with zero
console/page errors, and the per-screen rendered text is persisted under
`docs/integration/arena3b-visual-evidence/`.

### C.10 What is explicitly not claimed

- Not claimed: production readiness, real-money behaviour, live SMS/identity/provider settlement.
- Not claimed: visual/device acceptance (§C.7), and no layout/contrast/touch-target statement.
- Not claimed: that the four remaining mission journeys which need a missing production authority
  (NUBAN, funding intake, non-wallet receipts, upgrade assessment) work end-to-end; they are shown as
  honest unavailable states and are recorded in §D.
- Not claimed: that any protected authority, eligibility rule or institutional isolation rule was
  exercised in a weakened form to obtain a green result.

---

### C.11 Tooling defects closed (Stage 11)

| Defect (Arena 1 register)                                                     | Status                                                      | Evidence                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/customer-mobile` `npm ci` failed with **EUSAGE** (lockfile drift)       | **Closed**                                                  | `npm ci --no-audit --no-fund` now exits 0; the replayed `package-lock.json` (resolution D3) is in sync with the manifest. After the clean install `npx tsc --noEmit` is clean and `npm test` is 21/178. `apps/admin-web` and `apps/agent-mobile` `npm ci` also exit 0. |
| Repo-wide formatting debt (31 files outside Prettier style)                   | **Closed in a separate formatting-only commit** (`b6e23c5`) | `npm run format:check` is clean; `apps/customer-mobile` `format:check` is clean. The commit touches only the repo's own Prettier scope plus the admin/agent/customer app trees, and contains no token, branch, dependency, migration, assertion or financial change.   |
| 5 pre-existing lint warnings (unused `eslint-disable` directives)             | **Open, documented**                                        | `npm run lint` = 0 errors / 5 warnings. Removing them is cosmetic; the mission's no-unrelated-refactoring rule keeps them in the register rather than in this commit.                                                                                                  |
| 24 `apps/customer-mobile` lint warnings (`no-explicit-any`, stale directives) | **Open, documented**                                        | `npm run lint` = 0 errors / 24 warnings. Type-aware rules (`no-floating-promises`, `no-misused-promises`, `consistent-type-imports`) stay deferred: retro-fitting them across shipped screens is a code migration, not a config change.                                |

### C.12 Checkpoint register (this branch, on top of `cb8b4ea`)

| Commit                          | Purpose                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `55c8037`                       | customer-safe KYC projection                                                                                      |
| `aa05253`                       | customer dashboard / receipt / add-money screens                                                                  |
| `480f5e2`                       | customer credential recovery + migration `0402` + journey spec                                                    |
| `58fe38e`                       | mobile recovery/rotation UX, mobile lint gate, client-usable challenge reference                                  |
| `f3c3000`                       | durable recovery attempt-limit and expiry tests                                                                   |
| `cf14979`, `d58da7a`, `e6644e9` | Arena 4 documentation (source register, visual attempt, consolidation handoff)                                    |
| `adaf124`                       | integration commit: conflict resolutions D1-D5, corrected journey eligibility assertion, Stage 10 acceptance spec |
| `24d73f0`                       | Stage 8 journeys: first-login rotation, no-wallet/restricted states                                               |
| `aa79954`                       | Stage 9 harnesses + honest visual-acceptance record                                                               |
| `0d3a33b`                       | Stage 13 expectation updates for the consolidated inventory                                                       |
| `b6e23c5`                       | repo-wide formatting (formatting only)                                                                            |
| _this commit_                   | unified acceptance and handoff (this document)                                                                    |

## D. Production dependency register

Every row describes a capability that **fails closed today**. "Next stage" names the work that would
close it; none of it was invented here.

| ID   | Current behaviour (as shipped and executed)                                                    | Missing authority                                                                      | Affected capability                                               | Fail-closed behaviour                                                           | Next stage                                         |
| ---- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| D-1  | Receiving identity returns the customer's own receiving number; no NUBAN field exists anywhere | NUBAN issuance/allocation service + product decision                                   | Account number display, copy-to-clipboard, inbound bank transfers | The app shows a receiving number and never labels it a bank account             | Product decision, then NUBAN service mission       |
| D-2  | `CustomerLimitsView` lists products/limits; tier linkage is not published per limit            | `sourceTier`/`reason` on the limits projection                                         | "This limit is because you are Tier 1" explanation                | Limits render without an unverified causal claim                                | Extend the limit-catalog projection                |
| D-3  | `KycTierEvidenceReader.read()` returns `null` in production                                    | Identity-evidence provider adapter + credentials                                       | Any financial session, upgrade, recovery, eligibility             | Sessions/upgrades/recovery refuse (401/403/503); readiness blocks               | Provider integration mission (explicitly deferred) |
| D-4  | No customer-initiated funding intake exists                                                    | Approved funding product policy + intake endpoint                                      | "Add money"                                                       | Screen states the capability is unavailable; no client-side form invents a rail | Product policy, then intake                        |
| D-5  | `GET /customers/me/transactions/:id` resolves wallet transfers only                            | Per-type detail projection in the unified-history service                              | Funding, cash-in/out, cash-to-cash receipts                       | Non-wallet rows are not fabricated as receipts                                  | Extend history service                             |
| D-6  | `AGENT_FUNDING_POOL-NGN` is platform float and refuses institution attribution                 | Economic classification with a licensed institution                                    | Institution-attributed agent funding                              | Funding from platform float is refused                                          | `AGENT-FUNDING-POOL-CLASSIFICATION.md` decision    |
| D-7  | No institution-bound agent float rail                                                          | Institution funding authority + contract                                               | Institution-bound agent float                                     | Refused; never funded from platform float                                       | Institutional funding mission                      |
| D-8  | Withdrawal execution default is unavailable                                                    | Authoritative institutional entitlement + destination-ownership evidence               | Cash-out                                                          | Withdrawals refuse                                                              | Withdrawal authority mission                       |
| D-9  | Inbound funding verifier default is unavailable                                                | Inbound verifier + suspense policy                                                     | A7 inbound crediting                                              | Arrived-but-uncreditable funds stay in suspense                                 | A7 inbound authority mission                       |
| D-10 | Commitment compensation for settled-but-returned payments is refused                           | Authenticated, operation- and amount-bound return outcome + approved accounting policy | Returns/refunds                                                   | Refused by design; no refund is implemented                                     | Returns policy mission                             |
| D-11 | Protected approvals require a separate authority credential and MFA checker                    | Production authority credential provisioning                                           | Reversals, attribution, high-risk admin actions                   | Protected writes refused without the authority                                  | Deployment/credentialing stage                     |
| D-12 | Notification delivery uses the registered provider; `sms` in tests is a capturing sink         | Live SMS/email provider contract                                                       | OTP delivery for registration/recovery                            | Non-delivery surfaces as a provider error, never a silent success               | Provider onboarding                                |
| D-13 | Customer web target is not shipped; the app is a native target                                 | Deliberate scope decision + web dependencies                                           | Visual/browser acceptance                                         | No web build is claimed for production                                          | Optional web target mission                        |
| D-14 | Rate limiting for customer auth is in-process                                                  | Distributed limiter (shared store)                                                     | Auth abuse protection under horizontal scale                      | Per-instance limits only; documented, not silently widened                      | Platform hardening stage                           |

---

## E. Dependency-ordered roadmap

Order is a dependency order, not a schedule. Each stage lists the authority it needs and the
capability it unlocks; nothing later can be honestly claimed before its predecessor closes.

1. **Identity-evidence provider adapter (D-3, D-10 in part).** Unlocks every financial session,
   eligibility decision, tier upgrade, credential recovery and KYC projection. Prerequisite for all
   customer-facing money movement.
2. **Protected-authority credentialing (D-11).** Unlocks governed reversals, wallet attribution and
   high-risk admin actions in production; already implemented and boundary-tested.
3. **Inbound funding verifier and suspense policy (D-9).** Unlocks A7 crediting and makes "money
   arrived" a settled fact rather than an assumption.
4. **Withdrawal execution authority (D-8).** Unlocks cash-out; needs institutional entitlement and
   destination-ownership evidence.
5. **`AGENT_FUNDING_POOL-NGN` classification and institution funding rail (D-6, D-7).** Unlocks
   institution-attributed agent float without platform float.
6. **Returns/refund policy (D-10).** Unlocks compensation for settled-but-returned payments.
7. **Funding intake product policy (D-4) and NUBAN issuance (D-1).** Unlocks Add money and a real bank
   account number; both are product/policy decisions before engineering.
8. **Per-type receipt detail (D-5) and tier-linked limits (D-2).** Unlocks complete history and
   explainable limits; pure projection work once the authorities above exist.
9. **Notification provider contract (D-12).** Live OTP delivery.
10. **Platform hardening (D-14).** Distributed rate limiting for horizontally scaled auth.
11. **Optional web target (D-13)** if browser acceptance is wanted as a shipping gate.

Everything in stages 1-6 is already implemented and _fails closed_; closing them is authority and
policy work, not new architecture.

---

## F. Reproducing this record

```bash
# 1. PostgreSQL (embedded, disposable)
EMBEDDED_PG_CONFIRM_DISPOSABLE=yes node scripts/embedded-pg.js          # :5432

# 2. Backend PostgreSQL integration matrix (bounded, resource-aware)
NODE_ENV=test DB_HOST=127.0.0.1 npm run test:pg:bounded                  # PG_TEST_CONCURRENCY=1, BATCH_SIZE=6, MAX_OLD_SPACE_MB=2560

# 3. Isolated KYC cluster group
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes npm run test:pg:isolated-kyc

# 4. Unit suites / typecheck / build / lint / format
npx jest --config jest.config.js --runInBand
npx tsc --noEmit
npm run build
npm run lint
npm run format:check

# 5. Application suites
(cd apps/admin-web && npm test)
(cd apps/agent-mobile && npm test)
(cd apps/customer-mobile && npm test && npm run lint && npm run format:check)

# 6. Visual attempt (needs a browser binary this sandbox does not have)
node scripts/customer-web-render-smoke.js          # DOM-level evidence, works here
node scripts/customer-visual-acceptance.js         # 390x844 screenshots, needs chromium
```
