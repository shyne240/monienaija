# Arena 4 — Consolidation Handoff (Customer Authentication, Credential Recovery, Customer Journey)

Status: **implementation accepted at the independent functional level; branch frozen for consolidation.**
Prepared 2026-11-13. This document introduces **no application changes** — it is the consolidation
record for the accepted checkpoint.

- Source of truth for behaviour and results: `docs/ARENA4-CUSTOMER-EXPERIENCE-IMPLEMENTATION-20261113.md`
  (gap register C-1…C-9, acceptance matrix, verification runs, visual-acceptance attempt in §9.1).
- This file: what to merge, in what order, what conflicts to expect, and how to re-run or re-render.

---

## 1. Exact final application commit and branch

| Item                                | Value                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Branch                              | `arena/5ee539a0-monienaija` (status `active`, now **frozen**)             |
| Final application commit            | `7167fe954f6fd64e34790cbeccae44b414226b82` (`7167fe9`)                    |
| Base commit the branch was cut from | `81793dd7956963c40e823a4f6b2d2d9186fbce43` of `arena/44f00580-monienaija` |
| Working tree at handoff             | clean (`git status --short` empty)                                        |
| `main`                              | untouched — **not merged, and must not be merged by this branch**         |

Commits added on top of the base: **20** (see §2). Pre-Arena-4 checkpoints preserved exactly:
`e1c80d0`, `ca5b38d`, `684271e`, `26f5fb4`, `a9fabb40de223ab83f80ded39a02c4c809fcc7cc`.

## 2. Required source commits, in dependency order

Apply/merge in this order (the list is the whole branch delta `81793dd..7167fe9`):

| #   | Commit    | Subject                                                                                          | Required for                                        |
| --- | --------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 1   | `58ce201` | Govern legacy wallet ownership resolution with maker-checker evidence                            | Base precondition (Arena 3)                         |
| 2   | `e1c80d0` | Document governed wallet ownership resolution and align registry tests                           | Base precondition (Arena 3)                         |
| 3   | `af67f52` | Document institutional and agent affiliation architecture investigation                          | Docs only                                           |
| 4   | `de21b82` | Propose phased institutional architecture and isolation boundaries                               | Docs only                                           |
| 5   | `f3ebc9a` | feat(institution): arena 4 phase 1 institutional foundation                                      | Migration `1785753600400`, institutions module      |
| 6   | `ca5b38d` | docs(institution): arena 4 phase 1 implementation record                                         | Docs only                                           |
| 7   | `1cf6ac7` | feat(arena4-p2): institutional ownership of financial accounts (schema checkpoint)               | Migration `1785753600401`                           |
| 8   | `684271e` | test(arena4-p2)+docs: financial ownership unit contract, acceptance pins                         | Tests/docs for `0401`                               |
| 9   | `0b3138f` | feat(arena4): institution-scoped pending approval queue and platform agent affiliation directory | Admin backend                                       |
| 10  | `97c9154` | feat(arena4-admin-web): institutional administration console screens, navigation and tests       | Admin web                                           |
| 11  | `26f5fb4` | fix(arena4-admin-web): gate checker approval on the configured approving role too                | Admin web fix                                       |
| 12  | `86ab653` | feat(arena4-customer): customer-safe KYC projection `GET /customers/me/kyc`                      | Customer KYC view                                   |
| 13  | `699f491` | feat(arena4-customer-mobile): banking dashboard, verification and receipt screens                | Customer app screens                                |
| 14  | `9526718` | docs(arena4-customer): record the customer experience implementation and its gaps                | Docs only                                           |
| 15  | `a9fabb4` | docs(arena4-customer): note the missing credential recovery contract (C-9)                       | Accepted pre-Arena-4 checkpoint                     |
| 16  | `5cf0a27` | feat(arena4-auth): adopt the accepted customer authentication session architecture               | **Auth reconciliation (task 1)**                    |
| 17  | `c0d7161` | feat(auth): self-service customer credential recovery + full journey acceptance                  | **Recovery module, migration `0402`, journey spec** |
| 18  | `99d00bf` | feat(arena4): mobile recovery + rotation UX, mobile lint gate, client-usable challenge reference | **Customer app UX, mobile ESLint, `challengeId`**   |
| 19  | `aec6d37` | docs(arena4): record the visual-acceptance attempt and final verification runs                   | Docs only                                           |
| 20  | `7167fe9` | test(arena4): assert durable recovery attempt limits and request expiry                          | **Acceptance evidence (8th journey case)**          |

**Minimum set if the institutional work is already consolidated elsewhere:** `86ab653`, `699f491`,
`5cf0a27`, `c0d7161`, `99d00bf`, `7167fe9` (plus the docs commits). `5cf0a27` must precede
`c0d7161`; `99d00bf` must follow `c0d7161` (it adds the `challengeId` the client needs); `7167fe9`
only adds a test.

## 3. Authentication services adopted from Arena 2 / Arena 3

| Source                                       | Commit / location                                                                                                                                                                                                                                                             | What was taken                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Arena 2 completed authentication             | `9466cc2b26bdc030cf1fd6588fea5f1fae2941f7` — `fix(customer-auth): remediate CD-12 and CD-13 session and credential lifecycle` (2026-11-12)                                                                                                                                    | Session lifecycle/revocation semantics, credential-lifecycle fixes, the `authentication-session.types.ts` additions, the session spec cases |
| Arena 3 accepted consolidated authentication | already present at the branch base `81793dd` (`src/customer-authentication/*`, `src/customer-app/customer-app.controller.ts` session routes, `src/customer-registration/mobile-onboarding-auth.service.ts`, `src/kyc-verification/customer-financial-eligibility.service.ts`) | The accepted session issuance/verification path and the financial-eligibility gate                                                          |

Adoption commit **`5cf0a27`** (7 files):

- `src/customer-authentication/authentication-session.service.ts` (+848 lines)
- `src/customer-authentication/authentication-session.types.ts` (+21)
- `src/customer-authentication/customer-authentication.service.ts`
- `src/customer-registration/customer-registration.module.ts`
- `src/customer-registration/mobile-onboarding-auth.service.ts`
- `src/kyc-verification/customer-financial-eligibility.service.ts`
- `test/authentication-session.service.spec.ts`

**No competing mechanism exists.** There is exactly one credential store
(`customer_authentication_credentials` via `CustomerAuthenticationService`), one PIN store
(`customer_transaction_pins` via `CustomerTransactionPinService`), one session issuer
(`AuthenticationSessionService`), one passcode verifier (the authentication execution/runtime
services) and one eligibility gate (`CustomerFinancialEligibilityService`).

Deliberate residual differences from `9466cc2` at the final head (verified by
`git diff 9466cc2 HEAD -- src/customer-authentication/ src/customer-registration/mobile-onboarding-auth.service.ts src/kyc-verification/customer-financial-eligibility.service.ts`):

| File                                         | Lines still different | Why                                                                          |
| -------------------------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `authentication-session.service.ts`          | 15                    | Base-lineage lock/`lockMode` handling and revocation ordering kept           |
| `customer-authentication-runtime.service.ts` | 71                    | Base-lineage runtime remains the passcode authority                          |
| `customer-financial-eligibility.service.ts`  | 35                    | Base-lineage keeps the 503 "cannot assess" vs 409 "not eligible" distinction |

`9466cc2` must **never** be merged, rebased onto or cherry-picked from as a whole — it deletes
wallet-ownership-resolution, `institution-*` code, `test/support/trusted-tier-fixture.ts` and the
governed-ledger-reversal specs. Adopt file-level implementations only (that is what `5cf0a27` did).

## 4. Migration `1785753600402` and its dependencies

File: `src/migrations/1785753600402-CreateCustomerCredentialRecoveryChallenges.ts`
Class: `CreateCustomerCredentialRecoveryChallenges1785753600402` (`name` matches the file).

Creates **one** table, `customer_credential_recovery_challenges`:

- Columns: `id uuid PK`, `customer_id uuid NOT NULL REFERENCES customers(id)`, `purpose`,
  `normalized_phone`, `destination_phone`, `code_salt`, `code_hash`, `token_hash char(64)`,
  `attempt_count`, `status`, `issued_at`, `expires_at`, `verified_at`, `token_expires_at`,
  `consumed_at`, `revoked_at`, `version`, `created_at`, `updated_at`.
- Check constraints: `chk_ccrc_purpose` (`LOGIN_PASSCODE`|`TRANSACTION_PIN`), `chk_ccrc_status`
  (`ACTIVE`|`CONSUMED`|`EXPIRED`|`REVOKED`), `chk_ccrc_attempts`, `chk_ccrc_version`,
  `chk_ccrc_token_hash` (64-hex or NULL), `chk_ccrc_verified_requires_token`.
- Indexes: `idx_ccrc_customer_purpose`, `idx_ccrc_status_expires`,
  `uq_ccrc_token_hash` (partial unique, `WHERE token_hash IS NOT NULL`),
  `uq_ccrc_live_per_purpose` (partial unique, `WHERE status = 'ACTIVE'` — one live challenge per
  (customer, purpose)).
- `down()` drops the table. The table holds **no** credential material: the OTP is a salted PBKDF2
  digest, the recovery token is a SHA-256 digest, and the passcode/PIN stay in their accepted stores.

Dependencies:

1. `customers` must exist (long-standing base chain) — the only FK target.
2. It must be the **newest** migration: `1785753600400` → `1785753600401` → `1785753600402`.
3. `src/production/production-readiness.service.ts` pins
   `EXPECTED_MIGRATION_TIMESTAMP = '1785753600402'` and
   `EXPECTED_MIGRATION_NAME = 'CreateCustomerCredentialRecoveryChallenges1785753600402'`.
   `test/v1-release-01-production-readiness-migration-sync.integration.spec.ts` (3 tests) fails the
   build if the constant and the newest migration file ever diverge.
4. No new notification/audit migration is required: recovery security events are written through the
   existing audit service under `entity_type = 'CUSTOMER_CREDENTIAL_RECOVERY'`.

## 5. Compatibility requirements with the institutional foundation and financial-ownership migrations

- **Ordering is mandatory**: `1785753600400` (institution foundation) → `1785753600401`
  (institutional financial ownership) → `1785753600402` (this branch). TypeORM applies ascending
  timestamps; the readiness head must be `0402` only after `0400`/`0401` are present.
- **No schema overlap.** `0400` creates `financial_institutions`, `institution_agent_affiliations`,
  `aggregator_institution_relationships`, `governed_institution_affiliations`,
  `workforce_institution_assignments`. `0401` alters `ledger_accounts`, `ledger_journals` and
  `wallet_accounts` (adds `institution_id` + FK) and creates
  `governed_wallet_institution_attributions` and `customer_institution_enrolments`. `0402` touches
  none of those tables — it only references `customers(id)`.
- **Truncation safety.** `test/support/pg-harness.ts` `truncateAllTables` clears recovery challenges
  per suite; no foreign key from the recovery table points into institutional tables, so truncation
  order is unaffected.
- **Readiness coupling.** Any consolidation that renumbers/renames migrations must move the readiness
  constant and the sync spec together. Conversely, if another branch adds a migration above `0402`,
  that branch must advance the constant — expect a one-line conflict every time.
- **Notification registry coupling.** `customer.credentials.recovery_otp` was added to
  `SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES` and `NOTIFICATION_SECURITY_DEFAULTS_V1`.
  Registry/migration-chain tests derive their expected counts from those constants, so they stay
  self-consistent — **but** environments that already ran `1785753600098` will not have the new
  `notification_event_configurations`/`notification_templates` rows, because that migration seeds
  from the constant at run time only. This is functionally harmless (the recovery OTP is delivered
  directly through `NOTIFICATION_PROVIDER_TOKEN` and never through the dispatcher/outbox, precisely
  so no OTP is persisted); if consolidators want the registry rows present in existing databases,
  they must re-seed or add a follow-up migration. This branch deliberately adds no such migration.

## 6. Anticipated integration conflicts with Arena 1 and Arena 2

| #   | File / area                                                                                                      | Conflict                                                                                                                                                                                              | Resolution                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/production/production-readiness.service.ts`                                                                 | Single migration-head constant; every branch that adds a migration edits the same two lines                                                                                                           | Keep `1785753600402` unless a newer migration exists; never "take theirs" blindly                                                                                             |
| 2   | `src/authorization/route-policy-registry.ts`                                                                     | 4 new entries at the top of `PUBLIC_ROUTES` (lines 51–54); Arena 2 owns the later `CUSTOMER_LOGIN` block                                                                                              | Keep the recovery routes **public/unauthenticated** (pre-session by definition). Do not move them into `CUSTOMER_LOGIN` — that would require a session the caller cannot have |
| 3   | `src/kyc-verification/kyc-tier.module.ts`                                                                        | `exports` now include `KycTierEvidenceReader` (it is injected across module boundaries)                                                                                                               | Merge additively; export providers that are injected across modules, not just services (Nest DI fails otherwise)                                                              |
| 4   | `src/customer/customer-transaction-pin.service.ts`                                                               | `setTransactionPinInManager(manager, customerId, command)` added; Arena 1 authorizes transfers against the same PIN store                                                                             | Additive only — one PIN store, both callers use it; do not fork                                                                                                               |
| 5   | `src/kyc-verification/customer-financial-eligibility.service.ts`                                                 | Arena 1's `{lockMode}` lock semantics vs Arena 2's rewrite                                                                                                                                            | Arena 1's locking wins; `git apply` of Arena 2 hunks only succeeds after that signature exists                                                                                |
| 6   | `test/support/trusted-tier-fixture.ts`                                                                           | Deleted by `9466cc2`; required by `a23` and the journey spec                                                                                                                                          | **Keep ours** (with the `seedPolicy` singleton-head fix). Restoring Arena 2's version reintroduces the 13 `a23` failures                                                      |
| 7   | `test/a23-customer-app.integration.spec.ts`                                                                      | Arena 2 rewrote parts of it                                                                                                                                                                           | Keep the version at `c0d7161` (15/15)                                                                                                                                         |
| 8   | `src/app.module.ts`                                                                                              | One import + one `imports` entry for `CustomerCredentialRecoveryModule` (next to `CustomerAppModule`)                                                                                                 | Additive; watch import-order lint                                                                                                                                             |
| 9   | `src/notification/notification-security.constants.ts`, `notification-defaults-v1.ts`                             | One new event type in each                                                                                                                                                                            | Additive; see §5 registry note                                                                                                                                                |
| 10  | `apps/customer-mobile/src/store/auth-store.ts`                                                                   | `9466cc2` also edited it; ours adds `rotationCustomerId`, `acceptSession()`, `rotateTemporaryCredential()`, `clearRotation()`                                                                         | Take ours — it keeps "never fabricate a session" and adds the real rotation path                                                                                              |
| 11  | `apps/customer-mobile/src/screens/unauthenticated/RegistrationScreen.tsx`                                        | Touched by `9466cc2`; ours had a dead `else if` branch removed and Prettier applied                                                                                                                   | Behaviour is unchanged for onboarding; prefer the branch version, re-verify `registration.test.tsx`                                                                           |
| 12  | `apps/customer-mobile/package.json` + `package-lock.json`                                                        | New devDependency block (ESLint toolchain: `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `globals`, `eslint-plugin-react-hooks`, `prettier`) + `lint`/`format:check` scripts | Merge the manifest; regenerate the lockfile with `npm install` rather than hand-merging                                                                                       |
| 13  | Whole customer app                                                                                               | App-wide Prettier reformat in `99d00bf` (mechanical, root config: singleQuote, trailingComma all, printWidth 100, semi)                                                                               | Accept the reformat or re-run `npm run format` after the merge to avoid whitespace conflicts                                                                                  |
| 14  | `apps/customer-mobile/src/navigation/{types.ts,AppNavigator.tsx}`, `LoginScreen.tsx`, `TransactionPinScreen.tsx` | New screens/param list/entry points                                                                                                                                                                   | Additive; the unlocked-stack registration of the two auth screens is required for `navigation.test.tsx`                                                                       |

Arena 1's financial execution, ledger, limit catalog and eligibility gate are **untouched** by this
branch; the only Arena-1-facing edges are items 4 and 5.

## 7. Exact acceptance commands and controlled fixture requirements

### 7.1 Backend (no PostgreSQL)

```bash
npx tsc --noEmit          # clean
npm run lint              # 0 errors, 0 warnings
npm run format:check      # clean
npm test                  # 241 suites / 2863 tests pass
npm run build             # nest build, clean
```

### 7.2 Backend integration (real PostgreSQL; disposable cluster)

The exact invocation used for every reported result:

```bash
cd /home/user/monienaija
NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija \
DB_USER=monienaija DB_PASSWORD=monienaija-pw \
PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=<unique-id> \
npx jest --config jest.integration.config.js --runTestsByPath \
  test/a23-customer-app.integration.spec.ts \
  test/arena4-customer-journey.integration.spec.ts \
  test/arena4-customer-kyc-view.integration.spec.ts \
  --runInBand
```

Reported results: `a23` **15/15**, journey **8/8**, KYC projection **5/5** (run individually for the
counts above; the trio runs green together as 3 suites). Broader regression used in this mission:
`notification-registry` + `migration-chain` + the three specs above = **5 suites / 54 tests**, and the
auth/session unit set (`authentication-session.service.spec.ts`,
`customer-authentication{,-runtime,-rate-limit}.spec.ts`) = **4 suites / 36 tests**.

`PG_TEST_RUN_ID` is mandatory (the harness namespaces each run by it and refuses to run without it);
`PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes` is the guard that allows truncation. Each suite gets its own
database; `test/support/pg-harness.ts` builds a per-process migration template. The whole suite can
also be driven with `npm run test:pg` (batched, memory-bounded); it was **not** run end-to-end here —
only the suites relevant to this mission were.

### 7.3 Controlled fixtures (required, not optional)

| Fixture                                | Requirement                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/support/trusted-tier-fixture.ts` | Override `KycTierEvidenceReader`; call `seedPolicy(dataSource)` in **`beforeEach`** — it must INSERT the singleton `kyc_tier_policy_head` row (`INSERT … ON CONFLICT (singleton) DO UPDATE SET version = GREATEST(...)`), because `truncateAllTables` wipes it and an `UPDATE` silently affects 0 rows                                                                                             |
| Phone contact                          | Primary `customer_contact_methods` row **must** have `verified_at` set, with `normalized_value` = 10-digit canonical form (the login resolver normalizes `080…`/`+234…`/`234…` to that)                                                                                                                                                                                                            |
| KYC assessment                         | An `APPROVED`, unexpired `customer_kyc_assessments` row (`approveLevelOne`) before any financial login                                                                                                                                                                                                                                                                                             |
| SMS capture                            | Override `NOTIFICATION_PROVIDER_TOKEN` with a capturing provider; registration/recovery OTPs are delivered as plain SMS containing the six-digit code (never through the dispatcher)                                                                                                                                                                                                               |
| Recovery flag                          | `process.env.CUSTOMER_CREDENTIAL_RECOVERY_ENABLED = 'true'` for the enabled cases and `'false'` for the fail-closed case (the service is fail-closed: absent/unparseable = disabled)                                                                                                                                                                                                               |
| Manual hold / evidence withdrawal      | `kyc_tier_manual_holds(customer_id, actor, reason)` and `evidence.withdraw(customerId)` for the eligibility-loss and `SUPPORT_REQUIRED` cases                                                                                                                                                                                                                                                      |
| Synthetic onboarding                   | **Not used.** `simulationAvailable()` requires `NODE_ENV === 'test'` _and_ the `TestNotificationProvider`, and synthetic completion is additionally fenced to an isolated pg socket path, user `kyc_synthetic` and db `kyc_batch2_<32 hex>`. The journey spec therefore enrols customers with SQL and documents it as controlled evidence — it does not claim a real synthetic-provider completion |

### 7.4 Customer app

```bash
cd apps/customer-mobile
npm ci
npx tsc --noEmit            # clean ("npm run ts:check")
npm test                    # 21 suites / 175 tests pass
npm run lint                # 0 errors, 24 warnings (§10)
npm run format:check        # clean
```

## 8. Outstanding production dependencies and deferred capabilities

**External dependencies — cannot be closed inside this repository:**

| ID  | Dependency                                                                        | Effect today                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-5 | No production identity-evidence adapter (`KycTierEvidenceReader.read()` → `null`) | Upgrades are never assessed; recovery fails closed with `TRUSTED_EVIDENCE_UNAVAILABLE` → `SUPPORT_REQUIRED`                                                                                          |
| C-7 | No approved financial-eligibility evidence source in this environment             | `POST /customers/sessions` answers 409/503 for every customer. This is correct fail-closed behaviour and was **not** weakened; acceptance used the established authoritative PostgreSQL KYC fixtures |
| —   | No live SMS provider                                                              | OTPs were delivered through a capturing test provider                                                                                                                                                |
| —   | Visual acceptance                                                                 | Not performed; §9.3 gives the reproduction steps                                                                                                                                                     |

**Deferred product capabilities (explicitly not implemented, states remain "unavailable"):**
C-1 customer-readable NUBAN/account number; C-2 tier↔limit linkage; C-3 receipts beyond wallet
transfers; C-4 customer-initiated funding; live BVN/NIN verification and new identity providers;
virtual account/NUBAN provisioning; new bank-transfer rails; generalized receipt infrastructure; new
financial products; historical financial attribution cut-over; new regulatory thresholds; mandatory
biometrics or paid identity checks. No client-side eligibility and no hardcoded tier↔limit mapping
exists.

## 9. Reproducing the customer journey and visual acceptance outside this sandbox

### 9.1 Backend

```bash
npm ci
# PostgreSQL 16+ (validated on 18.4); create db/user matching DB_*
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija \
       DB_USER=monienaija DB_PASSWORD=… NODE_ENV=development
npm run migration:run            # must end at 1785753600402
CUSTOMER_CREDENTIAL_RECOVERY_ENABLED=true npm run start:dev   # API under /api/v1
```

A **real** customer journey outside the test harness additionally needs the evidence the product does
not yet have: an approved `customer_kyc_assessments` row, a verified primary phone, a seeded KYC tier
policy head, and an evidence source for `KycTierEvidenceReader` (or the test fixture). Without them a
correct 409/503 is returned by design — this is the C-5/C-7 dependency, not a defect.

### 9.2 Customer journey (API level, no mobile build)

Replay the accepted sequence against the running backend with any HTTP client, using the contracts in
`docs/ARENA4-CUSTOMER-EXPERIENCE-IMPLEMENTATION-20261113.md` §5 and
`src/customer-recovery/customer-credential-recovery.controller.ts`:

1. `POST /customers/registration-sessions/*` (start → otp → verify) — or seed the customer directly.
2. Enrol credentials: six-digit login passcode + **separate** six-digit transaction PIN.
3. `POST /customers/sessions` before eligibility → expect **409/503** (never a session).
4. Grant controlled evidence (approved assessment + verified phone) → `POST /customers/sessions` →
   `200` with `accessToken`; `GET /customers/me/dashboard`, `/me/kyc`, `/me/limits`,
   `/me/transactions`, `/me/transactions/:id`.
5. `POST /customers/sessions/logout` → `{revoked: true}`; reuse the old token → `401`; sign in again.
6. Recovery: `GET /customers/credential-recovery/policy`; `POST …/challenges` (`202`, holds a
   `challengeId`); `POST …/challenges/verify` (`200` + `recoveryToken`, or `409 SUPPORT_REQUIRED`);
   `POST …/complete` (`200`, `sessionsRevoked ≥ 1`); old credential refused, new one accepted, replay
   refused, every open session dead.
7. Insert a manual hold → next request refused and the session permanently revoked.

### 9.3 Visual acceptance (the outstanding item)

The app bundles for web (verified here), but **no browser could run in this sandbox**: the Chromium
binary needs `libnspr4.so`, `libnss3.so`, `libnssutil3.so`, which are absent, and there is no root or
archive network access. To complete visual acceptance on a normal workstation:

```bash
cd apps/customer-mobile
npm ci
npx expo install react-native-web @expo/metro-runtime      # web target deps (not in the manifest)
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000 npx expo start --web
# or, for a static build + headless capture:
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000 npx expo export --platform web --output-dir /tmp/a4web
```

Capture at least, at a 390×844 viewport: Welcome; Login (both recovery entry points, rotation
"Change my temporary password" button); recovery phone step; recovery OTP step; recovery
`SUPPORT_REQUIRED` state; rotation screen; Transaction PIN locked state; dashboard; KYC & limits;
transaction receipt. Assert the visual design is unchanged elsewhere (the dashboard was **not**
rebuilt). Any screenshot set produced this way is genuine visual acceptance; the current branch
claims none.

## 10. The 24 documented mobile lint warnings

`cd apps/customer-mobile && npm run lint` → **0 errors, 24 warnings** (flat config
`apps/customer-mobile/eslint.config.mjs`; type-aware root rules are deliberately deferred — see
C-8 in the implementation doc).

| #   | Location                                                         | Rule                                 | Message                                                                                     |
| --- | ---------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1   | `__tests__/api-client.test.ts:30:16`                             | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 2   | `__tests__/navigation.test.tsx:11:40`                            | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 3   | `__tests__/navigation.test.tsx:12:33`                            | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 4   | `__tests__/navigation.test.tsx:12:39`                            | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 5   | `__tests__/navigation.test.tsx:13:23`                            | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 6   | `__tests__/navigation.test.tsx:14:52`                            | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 7   | `__tests__/navigation.test.tsx:26:55`                            | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 8   | `__tests__/transfer.test.tsx:117:27`                             | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 9   | `__tests__/transfer.test.tsx:118:16`                             | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 10  | `src/components/Input.tsx:23:27`                                 | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 11  | `src/components/Input.tsx:30:26`                                 | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 12  | `src/screens/authenticated/CreateSupportTicketScreen.tsx:73:5`   | _(directive)_                        | Unused `eslint-disable` directive — no problems reported from `react-hooks/exhaustive-deps` |
| 13  | `src/screens/authenticated/CreateSupportTicketScreen.tsx:106:19` | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 14  | `src/screens/authenticated/FundWalletScreen.tsx:52:21`           | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 15  | `src/screens/authenticated/FundWalletScreen.tsx:97:19`           | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 16  | `src/screens/authenticated/ProfileScreen.tsx:145:21`             | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 17  | `src/screens/authenticated/SendMoneyScreen.tsx:109:21`           | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 18  | `src/screens/authenticated/SendMoneyScreen.tsx:205:19`           | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 19  | `src/screens/authenticated/SupportScreen.tsx:54:19`              | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 20  | `src/screens/authenticated/SupportTicketDetailScreen.tsx:91:19`  | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 21  | `src/screens/authenticated/SupportTicketDetailScreen.tsx:135:19` | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 22  | `src/screens/authenticated/WithdrawScreen.tsx:52:21`             | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 23  | `src/screens/authenticated/WithdrawScreen.tsx:105:19`            | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |
| 24  | `src/services/api-client.ts:148:15`                              | `@typescript-eslint/no-explicit-any` | Unexpected any                                                                              |

All 24 are pre-existing (untyped JSON boundaries in shipped screens, test doubles and one stale
directive). Every module introduced by this mission (`src/customer-recovery/*`,
`src/services/credential-recovery.ts`, `CredentialRecoveryScreen`, `CredentialRotationScreen`,
`credential-recovery.test.tsx`) is fully typed and produces **no** warnings.

---

## Freeze statement

Branch `arena/5ee539a0-monienaija` is frozen at application commit `7167fe9`. No further application
changes are intended by this branch; this handoff is the only remaining addition. No `main` merge, no
deployment, no live provider integration and no deferred financial product was started. Awaiting
consolidation.
