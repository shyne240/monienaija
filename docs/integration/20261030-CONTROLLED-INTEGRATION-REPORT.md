# Controlled integration — backend/security lineage + frontend M1 onto `main`

**Status:** integration **prepared and verified on a temporary branch**. **Nothing merged into `main`. Nothing deployed. No production
migration was run. No payment provider was activated. The Report 30 compliance-assignment architecture was NOT implemented.**
Final merge into `main` requires separate approval.

| Item | Value |
|---|---|
| Integration branch | `integration/main-backend-frontend-20261030` |
| Base | `origin/main` = `39a9e504e3881911c94438321e7c60f771469d21` |
| Merge 1 — backend/security | `arena/8e59e188-monienaija` = `06dc30b3cd2ad80f6c50b566575fe6ea2581ec85` → commit `ca7bf1c` |
| Merge 2 — frontend M1 | `arena/d4ef0b81-monienaija` = `4dd4e3ec1a1eb420dc252b8154fb110eaf053826` → commit `442c195` |
| Merge base (both) | `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` |
| Backend lineage fork point from M1 | `d212c667c431b05b7b1771c27212e9dc7f360d17` |
| Conflicts found / resolved by hand / remaining | **27 / 27 / 0** (merge 2: **0** conflicts) |
| Net change vs `main` | 1,421 files, +364,414 / −3,829 |

---

## 1. How the integration was performed

1. `git worktree` was used so the two source branches were never checked out, reset or written to. `main`, `arena/8e59e188-monienaija`
   and `arena/d4ef0b81-monienaija` are untouched by this work.
2. Merge 1 (`main` ← backend/security lineage) was a real `--no-ff` merge producing the 27 conflicted paths predicted by the M1
   integration plan. All 27 were resolved by hand in the order that plan prescribes (manifests → metadata → tests → authorization →
   config/financial → Admin Web → mobile).
3. Merge 2 (`integration` ← frontend M1) applied **automatically with zero conflicts**: the 62 files that branch changed relative to
   `d212c66` (ten Admin Web M1 files plus 52 design-discovery/acceptance documents) do not intersect the 84 files `main` changed or the
   69 files the backend lineage changed after that fork point. **No frontend or mobile conflict was resolved by guessing.**
4. Conflict-resolution rules were taken from the Admin Web lead's own reviewed documents on `arena/d4ef0b81-monienaija`
   (`docs/design-discovery-20261029/m1/acceptance/integration-plan.md` §2–§3 and `integration-prep.md` §1), which map all 26
   backend-lineage conflicts to owners and state the resolution rule per file. The four Admin Web files were reconstructed exactly as
   that report specifies; the inputs it resolved were verified byte-identical to what the integration tree contains
   (`src/config/index.ts`, `src/services/api-client.ts`, `vite.config.ts`, `src/store/auth-store.ts` at `d212c66` ≡ `06dc30b3` ≡ `4dd4e3ec`).

## 2. What was preserved — and where it is

### 2.1 Customer proof of address (instruction 4)

Complete and untouched, because it exists only on the backend lineage and `main` never modified that tree:

| Artefact | Location |
|---|---|
| Module (19 files) | `src/customer-proof-of-address/` |
| Validation shared by 14 consumers | `src/customer/customer-validation.ts`, `customer-validation.constraints.ts` |
| Migrations | `src/migrations/1785753600093-CreateCustomerProofOfAddressWorkflows.ts`, `…094-AddSecureCustomerProofOfAddressUploads.ts` |
| Catalogue function codes (5) | `authorization-catalogue.seed.ts` — `view_proof_of_address_metadata`, `upload`, `download`, `withdraw`, `archive` |
| Route policy | `src/authorization/route-policy-registry.ts` (PoA branch, `customerAccess: 'SELF'`) |
| Configuration | `POA_*` variables in `src/config/environment.ts` and `.env.example` |
| Admin Web panel | `apps/admin-web/src/**/CustomerProofOfAddressPanel.tsx` (compiles and passes against the integrated backend) |

Verified by 11 dedicated suites — **11 files / 58 tests PASS** (`customer-proof-of-address.*`, `proof-of-address-*`, `customer-validation`).

### 2.2 Authorization catalogue and migration history (instruction 4)

* The catalogue (`src/authorization-catalogue/**`: roles, function codes, seeds, runtime service) is the backend lineage's and is
  merged unchanged; `main` has no catalogue.
* Migration history: `main` changed **zero** migrations after the merge base. The integrated chain is the backend lineage's linear
  102-migration chain (`…101-NotificationReliability`), including the two proof-of-address migrations.
  **`test/migration-chain.integration.spec.ts` PASSES** against real PostgreSQL, including its entity-metadata consistency check.

### 2.3 Newer security protections from `main` (instruction 5)

| `main` protection | State in the integrated tree |
|---|---|
| `src/production/http-security.ts` (security headers, explicit-origin CORS allowlist) and `fastifyAdapterOptions` | **Wired** in `src/main.ts` — `applyHttpSecurity(app, environment)` is called. The backend lineage had no equivalent. |
| Retirement of the `mock-sandbox-token-*` string bypass | **Adopted** — `A2WorkforceOidcService.validate()` no longer honours it; `test/a2-workforce-oidc.service.spec.ts` passes. |
| Retirement of the `mock-sandbox-subject` blanket role grant | **Adopted** — removed from `A2WorkforceSessionService.resolve()`. |
| `A2_WORKFORCE_DEV_MOCK_ENABLED` rejection | **Present** in `src/config/environment.ts`. |
| Customer-authentication rate limiting (`customer-session.controller.ts`, `…rate-limit.config.ts`) **plus** the registry entry that makes it reachable | **Kept** — without the registry entry the login route is unreachable under the backend lineage's route model (it would fall into the `/customers/:id` policy, which demands a bearer token). |
| The seven `src/authorization/dto/*` request validators | **Kept**; `approve()` uses `DecidePrivilegedApprovalDto` (adds trim) instead of the lineage's untrimmed DTO — strictly tighter input handling. |
| `src/authorization/current-principal.ts`, wallet-ownership binding | **Kept**, and the binding is now **enforced** (see §3.2). |
| Production secret rule (placeholder / ≥16 chars / no repetition), DB pool and timeout controls | **Kept**; several test fixtures updated so both sides' production hardening is exercised (§4.2). |
| Adaptive migration-head derivation in `test/production-readiness.spec.ts` | **Kept** (main's mechanism), with its stale hardcoded head name replaced (§4.2). |
| Customer-mobile fail-closed API base URL | **Kept**, unioned with the lineage's `EXPO_PUBLIC_API_URL` (§3.6). |

### 2.4 The complete M1 Admin Console (instruction 6)

All ten M1 files are **byte-identical** to `4dd4e3ec`: `Layout.tsx`, `CustomerDirectoryScreen.tsx`, `tokens.css`, `primitives.tsx`,
`primitives.css`, `admin-shell.css`, `customer-directory-pilot.css`, `m1-shell.test.tsx`, `m1-customer-directory.test.tsx`,
`m1-style-isolation.test.tsx`. The backend lineage's three later Admin Web additions
(`ProviderConfigurationWorkspace.tsx`, `services/notification-domain.ts`, `__tests__/provider-configuration.test.tsx`) are also present,
so the console is the union of both lines.

The blocking dependency that the M1 report raised — `main` lacking `src/customer/customer-validation.ts` and
`src/customer-proof-of-address/`, which made 18 of 33 Admin Web suites fail to load — **is satisfied** by this integration.

## 3. Conflicts resolved — and the security-sensitive decisions

### 3.1 Manifests and repository metadata

* `package.json` — union: `main`'s `migration:*:compiled` scripts **and** the lineage's `bootstrap:statement`,
  `recovery:statement`, `test:e2e:batch-2a`; dependencies were already auto-merged (the lineage's `@aws-sdk/client-s3`,
  `@fastify/multipart`, `i18n-iso-countries`, `libphonenumber-js`, `postcode-validator`, `embedded-postgres`, `playwright`,
  `@sparticuz/chromium` plus `main`'s `overrides` block). `test` keeps the lineage's `--maxWorkers=2`, `test:pg` its batched runner.
* `package-lock.json` — regenerated with `npm install --package-lock-only`. Verified that all six of `main`'s `overrides` are
  honoured in the resulting lock (fast-uri 3.1.6/4.1.3, js-yaml 3.15.2/4.3.2, qs 6.16.0, fastify 5.12.7).
* `.env.example` — union, verified key-by-key: **106 active keys = 60 (`main`) ∪ 103 (lineage)**, zero omissions, zero commented
  keys lost.
* `.gitignore` — union (main's key material / dump / report exclusions + the lineage's `data/` and `data/private-poa/`).
* `README.md` — the lineage's V1 README (the authoritative product document, superseding main's milestone-1 wallet/ledger README),
  with `main`'s health-endpoint security note folded in ("`GET /health` and `/health/ready` are the only public endpoints and report
  state only; operational detail is available only to an authenticated workforce session holding `internal:access`"). The lineage's
  stale `80-migration chain, head 1785753600079` sentence was de-hardcoded to point at `src/migrations/` and `npm run migration:show`.

### 3.2 Authorization — the highest-risk group (Arena 3 / backend ownership)

| File | Resolution | Why |
|---|---|---|
| `src/authorization/runtime-access.guard.ts` | **Lineage A's version wholesale** (all three regions). | It is a superset: it resolves Agent, Customer, A2-workforce **and** SUPPORT sessions (V1-OPS-01 fallback, V1-ADMIN-FULL-SURFACE-AUDIT-01 default branch), denies unsafe methods for read-only principals, enforces declared catalogue gates, and calls the full `authorizationService.authorize(principal, route.policy, …)` on the default path. `main`'s `enforceDeclaredPolicy` is a strict subset of that call and would have duplicated the authorization decision. |
| `src/authorization/route-policy-registry.ts` | Lineage A's registry + **`main`'s customer credential-exchange entry only** (`POST /customers/:uuid/authenticate` → public). Two of `main`'s four registry additions are documented as deliberately **not** carried over (see §5). | Without `main`'s entry the login route is unreachable: the registry would resolve it to the generic `/customers/:id` policy, whose `customerAccess: 'SELF'` demands a bearer token the caller cannot yet have. Main's entry is matched by an exact UUID shape and the handler performs credential verification, generic failure responses, account lockout and the bounded per-address/per-account rate limits. Excluding it would have silently broken a login surface `main` ships and tests. |
| `src/authorization/workforce-oidc.service.ts` | **`main`'s side** — the `mock-sandbox-token-*` string bypass is retired. | `main`'s retirement is newer than the merge base and is pinned by its own specs. Nothing in the merged tree depends on the bypass: the only functional references are the two retirement tests and `main`'s own assertion that the Admin Web autofill control is absent. |
| `src/authorization/workforce-session.service.ts` | Lineage A's superset (`revokeAllForPrincipal`, catalogue-based `resolve()` with `administrativeCapability` / `readOnlyPrincipal`, fail-closed "No valid workforce roles"), **minus** its `mock-sandbox-subject` blanket grant. | The grant is unreachable once the OIDC bypass is retired, and `main`'s regression test pins its removal. Every principal — including one whose subject resembles the retired mock subject — now resolves roles only from real ACTIVE assignments joined with the catalogue. |
| `src/authorization/workforce-administration.controller.ts` | Union: `main`'s seven DTO imports **and** Lineage A's `ADMINISTRATOR_OPERATIONAL_ROLE_KEYS` import; `approve()` takes `main`'s trimming DTO. | No policy change; both sides' input validation retained. The now-unused `ApprovalDecisionDto` import was dropped. |

### 3.3 Configuration and platform

* `src/config/environment.ts` — union of `main`'s DB pool/timeout controls and the lineage's SMS-V1-01, email, worker and retry
  configuration. Verified that all of `main`'s security keys survive, including the `A2_WORKFORCE_DEV_MOCK_ENABLED` rejection.
* `src/main.ts` — true union: `main`'s `applyHttpSecurity(app, environment)` **and** Lineage A's extracted
  `registerRequestContextHooks(...)`. `main`'s inline copy of those same hooks was dropped because keeping both would register the
  request-context hooks twice; the extracted module is byte-equivalent in behaviour (same tracker, same `X-Request-Id`,
  `X-Correlation-Id`, `X-Trace-Id`, `X-API-Version`, `SERVICE_DRAINING` 503 and completion logging) and is covered by tests.
* `test/production-readiness.spec.ts` — `main`'s repository-derived mechanism kept, but its hardcoded expectation
  (`CreateA2WorkforceAuthenticationTables1785753600052`) is stale on the integrated chain and would be the exact rot that mechanism
  exists to prevent. Replaced with derived assertions: chain non-empty, unique and strictly ordered, derived head really is the newest
  migration, and the two proof-of-address migrations are present. The incompatible-schema case is untouched.
* `test/external-reconciliation.service.spec.ts` — `main`'s `futureExpiry()` helper, keeping both sides' rationale (both had
  independently fixed the same date-rot bug).

### 3.4 Financial controllers — zero financial change (instruction 8)

The five financial controllers (`deposit`, `withdrawal`, `transfer`, `transfer/wallet-transaction`, `wallet`) are **byte-identical to
the backend lineage's versions**. The lineage disables the generic command endpoints outright (`POST /deposits`,
`POST /withdrawals`, `POST /transfers` → 403) and gates reads behind catalogue function codes; `main` had made the same routes
customer-reachable through its registry + `customerSelfId()`-scoped controllers. Making them reachable without `main`'s controller
changes would have exposed unscoped collection reads to customer principals, so both halves of `main`'s design are left dormant
together (see §5, OI-01).

**No amount, fee, commission, VAT, balance, ledger posting, limit or reconciliation logic was changed by any resolution.** `main`'s
service-layer ownership assertions, which arrived by clean auto-merge, are preserved and are now satisfied by every caller:

* `src/customer-app/customer-app.controller.ts` — the authenticated customer transfer endpoint
  (`POST /customers/me/transfers`) now passes `ownership: { kind: 'CUSTOMER_SELF', customerId: principal.customerId }`, so a
  caller-supplied `sourceWalletId` can no longer debit another customer's wallet (reported as "Wallet was not found" to prevent
  enumeration). The unrestricted destination-wallet product rule is untouched. **Security-sensitive: flagged for Arena 4.**
* Eight lineage integration suites (nine call sites) that drive the movement services directly now pass an `INTERNAL` binding, which
  `assertWalletOwnership` deliberately does not restrict — behaviour identical to before the integration.

### 3.5 Backend tests owned by this workstream

* `test/authorization-http-matrix.spec.ts` (main's suite, 53 cases) — the guard gained two constructor dependencies on the lineage
  side (Agent session, SUPPORT session), so the suite's testing module could not compile the guard at all (53/53 failed on DI).
  Both are now supplied as **non-throwing negatives**, which reproduces exactly the "this token is not an Agent/SUPPORT credential"
  fall-through the suite's customer and workforce tokens rely on. **39 of 53 now pass**; the remaining 14 are the §5 policy deadlock.
* `test/a2-workforce-session.integration.spec.ts` — `main`'s three new cases assumed a zero-role session is issuable. The integrated
  service is the lineage's, which refuses one (its own helper already documents "roleless sessions are rejected"). Two cases now
  assert the strictly stronger outcome (session establishment rejected) and the third creates its assignment before establishing.
  **18/18 PASS.** Each edit is marked in-file as requiring Arena 4 ratification — **security-sensitive**.
* `test/runtime-access.guard.spec.ts` — 3 registry expectations fail for the §5 reason; the rest pass.

### 3.6 Frontend and mobile (owners' documented rules only)

* **Admin Web (4 files)** — reconstructed exactly per the Admin Web lead's `integration-prep.md` §1: main's build-injected config
  with a development-only fallback; the branch's `api-client.ts` plus `main`'s guard **called only from `request()`** (+19 lines
  total, `postForm`/`requestBlob` untouched so the PoA upload/download call sites keep working); `vite.config.ts` union (branch
  plugins, `host: 0.0.0.0`, `allowedHosts`, `/api` proxy + main's `define` block + a development-only `/api/v1` fallback);
  `auth-store.ts` unchanged (already byte-identical).
* **Customer mobile (4 files)** — the mobile app belongs to the backend lineage, and its auto-merged specs pin the real backend
  contract, which exists in the integrated tree (`POST /customers/sessions`, `POST /customers/sessions/logout` in
  `customer-app.controller.ts`). `auth-store.ts` and `LoginScreen.tsx` are therefore the lineage's versions byte-for-byte.
  `config/index.ts` is a union that accepts **both** `EXPO_PUBLIC_API_BASE_URL` (main) and `EXPO_PUBLIC_API_URL` (lineage) while
  keeping main's fail-closed production posture — required, because the merged `api-client.ts` is main's and throws when the base
  URL is empty. `__tests__/transfer.test.tsx` takes the lineage's larger suite plus main's `beforeAll` warm-up; main's
  `jest.resetAllMocks()` was rejected because the lineage documents that it also resets jest-expo's native-module mocks and breaks
  rendering. These four are the only files where a *mobile* owner's ratification is still advisable (§6).

## 4. Test results

Commands are reproducible from the repository root; PostgreSQL suites need `node scripts/embedded-pg.js` running and a
`PG_TEST_RUN_ID` matching `/^[a-z][a-z0-9]{3,15}$/`.

### 4.1 Compilation

| Check | Result |
|---|---|
| Backend `tsc --noEmit -p tsconfig.json` | **0 errors** |
| Admin Web `npm run ts:check` | **0 errors** |

### 4.2 Backend unit / component suite (`npm test`, 222 suites)

| Result | Detail |
|---|---|
| **220 suites / 2,407 tests pass** | Includes all of `main`'s own suites apart from the two below |
| 2 suites / 56 tests fail | `authorization-http-matrix.spec.ts` (14) and `runtime-access.guard.spec.ts` (3) are the §5 deadlock; the other 39 were the guard-DI and ownership-binding gaps, now fixed — see the final counts in §4.5 |

Four environment/config suites needed fixture updates so that **both** sides' production hardening is exercised rather than one side's
fixtures being rejected by the other side's stricter rule. **No assertion was relaxed:**

| Fixture | Cause | Fix |
|---|---|---|
| `test/production-config.spec.ts` | `main`'s fixture predates the lineage's SMS-V1-01 rule (production must not use the `console` SMS provider) | fixture selects `robase` with a synthetic, prefix-valid key |
| `test/http-security.spec.ts` | same, for its HSTS case that promotes the fixture to production; and its password tripped `main`'s production secret rule | fixture password + SMS provider/key updated |
| `test/resend-email-provider.unit.spec.ts` | production fixture used the `postgres` placeholder that `main`'s rule rejects | conforming fixture password |
| `test/environment.spec.ts` | lineage's base fixture password failed `main`'s production secret rule in the cases that promote it to production | conforming base password; placeholder-rejection cases still override explicitly |

### 4.3 PostgreSQL integration suites (targeted)

| Suite group | Result |
|---|---|
| `migration-chain.integration.spec.ts` | **PASS** (102 migrations incl. PoA `…093`/`…094`) |
| `a2-workforce-session.integration.spec.ts` | **18/18 PASS** |
| `customer-compliance-authorization.integration.spec.ts` | **PASS** |
| `v1-admin-authorization-foundation-01`, `…-hardening-01`, `…-read-surface-01` | **PASS** (74 tests with the next row) |
| `s-fix-01-customer-lifecycle-authorization.integration.spec.ts` | **PASS** |
| `a11-agent-transaction-authorization`, `a5-ledger-reversal`, `v1-system-01-suspended-customer-financial-boundary` | **PASS** (50 tests) |
| `a5-payment-lifecycle`, `a5-transfer-lifecycle`, `v1-001-customer-funding`, `v1-ledger-reversal-governance` | **PASS** (88 tests) |
| `a13`–`a17` agent cash-in / cash-out / cash-to-cash / claim / expiry | **PASS** (204 tests) |
| Full `npm run test:pg` battery (126 integration files) | see §4.5 |

### 4.4 Applications

| Check | Result |
|---|---|
| Admin Web `jest` | **33/33 suites, 243/243 tests pass**, including `main`'s `api-client-config`, `api-client-request`, `production-auth-safety` and all three M1 suites |
| Customer mobile `tsc` / `jest` | see §4.5 |

### 4.5 Final consolidated counts

| Surface | Command | Result |
|---|---|---|
| Backend compile | `tsc --noEmit -p tsconfig.json` | **0 errors** |
| Backend unit/component | `npm test` (222 suites) | **220 suites / 2,446 of 2,463 tests pass** — the **17** failures are exactly D-01 (`authorization-http-matrix.spec.ts` 14, `runtime-access.guard.spec.ts` 3) |
| Backend PostgreSQL | `npm run test:pg` (126 integration files, 9 batches) | **126 / 126 suites pass** after the nine `ownership` call sites in eight lineage suites were supplied with an `INTERNAL` binding (batch 1 and batch 5 ran before that patch and are the only reason the raw run showed 6 failures; re-run of exactly those six: **6/6 pass, 307 tests**) |
| Migration chain | `migration-chain.integration.spec.ts` | **PASS** — 102 migrations, entity metadata consistent |
| Admin Web | `npm run ts:check` + `jest` | **0 errors**, **33/33 suites, 243/243 tests** |
| Customer mobile | `npx tsc --noEmit` + `jest` | **0 errors**, **14/14 suites, 114/114 tests** |

Totals across the four applications/suites exercised here: **3,401 backend tests** (2,463 unit + ~1,900 PostgreSQL assertions across
126 files), **243 Admin Web tests**, **114 mobile tests**.

**Everything that fails is D-01 — one product decision, seventeen named cases, no defect.** Nothing else in the tree fails: no
financial lane, no migration, no proof-of-address suite, no authorization suite that belongs to the backend lineage, and no Admin Web or
mobile suite.

### 4.6 One integration-caused compile break, fixed

`main` ships `FundWalletScreen.tsx` and `WithdrawScreen.tsx` plus their `FundWallet` / `Withdraw` route keys; the backend lineage's
navigator never registers those screens and its own `navigation/types.ts` has no such keys. When the lineage's `types.ts` won the
merge, the two `main` screens became unregistered orphans and `tsc` reported two errors. `main`'s two route keys were restored so the
app compiles and nothing from `main` is deleted, but the screens remain **unregistered** on purpose: registering them would surface a
customer funding/withdrawal UI whose generic routes (`/wallets`, `/deposits`, `/withdrawals`) are workforce-gated under D-01.
Registration is the mobile owner's call once D-01 is settled. The in-file comment says exactly this.

## 5. Blockers and open items — **required before this can be called ready**

### D-01 — Financial surface: the authorization test matrix cannot be satisfied without a product decision

The integration plan names `test/authorization-http-matrix.spec.ts` as the arbiter for authorization conflicts. Running it is what
surfaced this: **the two lines hold two complete, internally consistent, mutually exclusive authorization designs for the same
financial routes**, and the integrated tree must pick one.

| Route | `main` (39a9e504) | Backend lineage (06dc30b3) |
|---|---|---|
| `POST /api/v1/customers` | public, anonymous registration | workforce-only (`customer.create` function); registration is `POST /customers/registration/otp{,/verify}` + `/customers/registration` |
| `GET /api/v1/deposits`, `/withdrawals`, `/wallets`, `/wallets/:id{,/balance,/transactions}`, `/transfers/:id` | customer-reachable, `customerAccess: 'SELF'`, scoped in the controller by `customerSelfId()` | workforce observability only (function-code gated); customers use `/customers/me/*` |
| `POST /api/v1/deposits`, `/withdrawals`, `/transfers` | customer-reachable and functional, with ownership binding | **deliberately disabled** (403, "Generic … commands are disabled") |
| `GET /api/v1/internal/{readiness,deployment,configuration,diagnostics,metrics,audit,outbox}` | workforce route requiring `internal:access` | same principals via the generic internal branch; `internal:access` is granted to no role (the lineage's documented "internal:access reachability gap"), so `main`'s `requiredScopes` form would make them unreachable |
| `GET /api/v1/internal/version` | workforce, `internal:access` | public |

**Resolution taken (conservative, reversible, zero financial change):** the registry keeps the backend lineage's model and does not
carry `main`'s `CUSTOMER_SELF_SERVICE_ROUTES`, `OPERATIONAL_ROUTES` or the anonymous `POST /api/v1/customers`; the financial
controllers stay byte-identical to the lineage's. This is recorded in-file at each site.

**Consequences, stated plainly:**

* 14 of `main`'s 53 authorization-matrix cases and 3 of its registry cases in `runtime-access.guard.spec.ts` fail. They are not
  test defects — they assert the alternative design.
* `main`'s controller/service capability for customer self-service financial reads (`customerSelfId()`, `*ForCustomer()` methods,
  `wallet-ownership.ts`) is present in the tree but **dormant**: nothing routes to it.
* The integrated customer-mobile app's `FundWalletScreen` (`GET /wallets`, `POST /deposits`) and `WithdrawScreen`
  (`GET /wallets`, `POST /withdrawals`) call the generic routes directly. Under this resolution they are **not functional** — this
  is the backend lineage's pre-existing V1 state, not a regression introduced here. The wallet/transfer screens that use
  `/customers/me/*` are unaffected. The mobile owner should re-point those two screens at `/customers/me/*`.

**Decision required:** does V1 expose customer self-service on the generic financial routes (adopt `main`'s design, which re-enables
`POST /deposits|/withdrawals|/transfers` for customers and needs `main`'s controllers restored — a **financial behaviour change** and
therefore outside this authorisation), or keep the lineage's `/customers/me/*`-only model (this integration, with those 17 test cases
adapted by the owner)? This is exactly the "unapproved financial or security behaviour change" the authorisation told this work to
stop on, so it was **not** decided here.

### D-02 — Security-sensitive decisions requiring independent Arena 4 review

| # | Decision | Risk if wrong |
|---|---|---|
| S-1 | `main`'s mock-sandbox bypasses are fully retired (no dev/test escape hatch anywhere) | Local development relies on `LocalAdminAuthenticationService` + real role assignments; a developer expecting the old bypass gets a closed door |
| S-2 | Customer transfer endpoint now enforces `CUSTOMER_SELF` source-wallet ownership | Closes a cross-customer debit path; could reject a legitimate flow if any client relies on moving funds out of another customer's wallet (it did not exist before as a *permitted* flow, so none should) |
| S-3 | `main`'s credential-exchange route is the only `main` registry construct carried over | If omitted, `POST /customers/:id/authenticate` is unreachable; carried, it adds a public endpoint that `main` rate-limits and that the lineage does not otherwise expose |
| S-4 | Three of `main`'s workforce-session assertions were rewritten to expect a rejected session instead of a zero-role session | The rewritten form is strictly stronger, but it is still an edit to a security regression test |
| S-5 | `main`'s `OPERATIONAL_ROUTES` `internal:access` form was not adopted | Keeps the lineage's reachability model; `main`'s operational routes remain reachable through the generic branch, not the declared-scope branch |

### D-03 — Owner ratifications outstanding

* **Mobile owner** — the four customer-mobile resolutions in §3.6 (two files are the lineage's byte-for-byte; one is a new union;
  one is a test-suite merge). No mobile conflict was guessed, but this owner has not signed the outcome.
* **Admin Web lead** — the four files were reconstructed from their written resolution, not from a committed artefact; they should
  confirm the reconstruction matches their throwaway-tree result (`tsc` 0 errors and 33/33 suites here are consistent with it).
* **Arena 4** — independent security re-acceptance at the integration SHA (Report 28-style Gates A/B), plus the D-02 items.

### N-1 — Not changed here, but noticed

* `.env.example` and the docs still describe `mock-sandbox-token-*` as an available local convenience in some V1 walkthroughs
  (`docs/V1/V1-ADMIN-LOCAL-LOGIN-01.md`, `docs/deployment/config/v1-workforce-bootstrap.env.template`); the code no longer honours it.
  Documentation-only follow-up.
* `README.md`'s migration-head sentence was de-hardcoded, but other docs cite specific heads; they will drift as the chain grows.

## 6. Is this ready for independent Arena 4 security review?

**Yes, as an integration artefact — with D-01 open.** The branch is self-consistent, compiles, and passes the substantive security,
financial, authorization, migration and production-readiness suites. The one thing Arena 4 cannot accept as-is is the financial-surface
choice in D-01: they can review it, but only the Product Owner can decide it, and either decision changes behaviour that this
authorisation forbade changing.

Concretely, the branch is ready for review with these known, named exceptions: 17 authorization/registry cases in two of `main`'s own
suites (D-01), the five D-02 decisions, and the outstanding ratifications in D-03. **Nothing here constitutes a production-readiness
statement, a WCAG statement, or sign-off on the Report 30 architecture (not implemented).**

## 7. Reproduction

```bash
# geometry (read-only)
git merge-base origin/main 06dc30b3        # 3d05aaec
git diff --name-only 3d05aaec 4dd4e3ec    # 62 files frontend-own

# integration branch (local worktree used here; main never checked out)
git worktree add <dir> -b integration/main-backend-frontend-20261030 origin/main
git -C <dir> merge --no-ff 06dc30b3        # 27 conflicts
git -C <dir> merge --no-ff 4dd4e3ec        # 0 conflicts

# verification
./node_modules/.bin/tsc --noEmit -p tsconfig.json
npm test
(cd apps/admin-web && npm ci && npm run ts:check && npx jest --watchAll=false)
node scripts/embedded-pg.js &              # embedded PostgreSQL 18
PG_TEST_RUN_ID=intg30octa PG_TEST_CONCURRENCY=1 \
  ./node_modules/.bin/jest --config jest.integration.config.js --runInBand \
  test/migration-chain.integration.spec.ts test/a2-workforce-session.integration.spec.ts
npm run test:pg                            # full battery
```

## 8. Scope confirmation

No merge into `main`; no push to `main`; no deployment; no production migration; no payment provider activated; the
`COMPLIANCE_ASSIGNMENT_AUTHZ_ENABLED` flag and the Report 30 architecture were not implemented; no force-push; no other agent's branch
overwritten. The two source branches and `main` are unchanged by this work (verified: `main` still at `39a9e504`, backend lineage
still at `06dc30b3`, frontend branch still at `4dd4e3ec`).
