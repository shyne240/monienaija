# Arena 2 — Financial Operations Consolidation (integration status)

Branch `arena/ca576774-monienaija`. Arena 2 frozen source: `arena/ea070127-monienaija`
(never modified, never blindly merged: the whole application range was cherry-picked commit by
commit onto the accepted baseline, resolving every conflict deliberately).

**Status: partial. Cash-Out institutional integration and the canonical governed fixture are
accepted; agent-funded Cash-to-Cash acceptance is green (A15 23/23); the Cash-to-Cash claim,
expiry and legacy commercial regressions are NOT accepted and remain red.** Nothing in this
document is deployment evidence and nothing here claims production authorization.

---

## 1. Checkpoint register

| Item                                                                    | Value                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Working branch                                                          | `arena/ca576774-monienaija`                                                                                         |
| Recovered baseline (ARENA 3B recovery)                                  | `5acc9c80134933306e5e7f4d6733d642674f6942`                                                                          |
| Accepted institutional baseline (Phases 1–5)                            | `a52602d056521fa4e78cd77e1a3735a6a1ccf9ed`                                                                          |
| **Canonical governed fixture checkpoint**                               | **`182eda9`**                                                                                                       |
| **Funding-authority + institutional obligation checkpoint (A15 green)** | **`fd3e4cd`**                                                                                                       |
| **Governed agent-desk OTP fixture checkpoint**                          | **`34ee502`**                                                                                                       |
| **A16 claim-suite migration checkpoint (82/88)**                        | **`c6df0ad`** (evidence: `docs/integration/arena3b-evidence/STAGE-A16-claim-migration.txt`)                         |
| Cash-Out integration checkpoint                                         | `5acc9c8` (recovered; targeted acceptance passed before this mission)                                               |
| Cash-to-Cash integration checkpoint                                     | `fd3e4cd` — funding path accepted (A15 23/23)                                                                       |
| Cash-to-Cash **claim** acceptance                                       | **not accepted** — `c6df0ad` migrates A16 to governed OTP issuance: 82/88 pass, 6 red (see §A16 below)              |
| Cash-to-Cash **expiry** acceptance (A17)                                | **not started** — suite still fabricates challenges and has no claiming agent session                               |
| Cash-Out acceptance (A14 + A14-OTP-hardening)                           | **not started** — ~40 intent-less `execute` calls remain                                                            |
| Final accepted application checkpoint                                   | **not established** — Stage 4 legacy regression is unfinished                                                       |
| Documentation + evidence checkpoint                                     | this commit (`docs/integration/arena2-financial-operations-consolidation.md`, `docs/integration/arena3b-evidence/`) |

Arena 1 and Arena 4 frozen checkpoints were verified present and untouched:
`arena/44f00580` app `8e4da1a5…` docs `8ff51643…`; `arena/ea070127` app `0472687e…` docs
`2b4da607…`; `arena/5ee539a0` app `7167fe95…` docs `2e026349…`.

---

## 2. Implementation record

### 2.1 Integrated Arena 2 source commits

The Arena 2 range `9466cc2..0472687` (31 commits) was integrated by the previous Arena 3
checkpoint `5acc9c8`; this mission did not re-integrate it. Confirmed present: persisted cash-out
intents, transaction-bound OTP, durable attempt budgets, atomic execution, immutable evidence,
supersession/cancellation, lost-response and receipt recovery, reconciliation handoffs,
cash-to-cash operation handoffs and agent-mobile recovery contracts.

### 2.2 Institutional seams (previous checkpoint, preserved)

- `CashOutInstitutionResolver` → `requireCashOutInstitutionScope()`: `503` unless the resolver
  answers `RESOLVED` for _this_ agent with a UUID institution.
- `AgentCashOutService` resolves institution scope inside the financial transaction before any
  receipt/intent query; receipt and intent predicates bind the resolved institution.
- `CashToCashRecoveryService`: unresolvable authority is `503`, never `500`.
- `CashToCashWorkforceScope` / `CashToCashClaimFinancialContext`: fail-closed delegation.

### 2.3 Funding-authority evidence contracts (ARENA 3B Stage 2)

The four persisted fingerprints in `cash_to_cash_funding_evidence` now each bind the evidence of
their own semantic category:

| Fingerprint                         | Binds                                                                                                                                      | Change in this mission                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `sender_identity_fingerprint`       | funding agent id, its own wallet id, its ledger account id, the sender phone _as a lookup input_                                           | institutional ownership fields (`affiliationId`, `institutionId`) removed — identity is no longer derivable from unrelated ownership records |
| `sender_policy_fingerprint`         | **approved funding policy**: policy id, reference, institution, approver, approval instant, effective window, plus the scope it applies to | replaces the previous hash of affiliation/institution status, which was ownership evidence masquerading as policy                            |
| `funding_authorization_fingerprint` | operation id, request hash, agent, wallet, ledger account, amount, currency, institution                                                   | unchanged                                                                                                                                    |
| `institution_evidence_fingerprint`  | `FinancialContextResolver` evidence digest                                                                                                 | unchanged                                                                                                                                    |

`src/agent/cash-to-cash-funding-policy.ts`:

- `CashToCashFundingPolicyAuthority` is a DI contract (`CASH_TO_CASH_FUNDING_POLICY_AUTHORITY`).
- The production binding is `UnavailableCashToCashFundingPolicyAuthority`, which can only answer
  `UNAVAILABLE` → funding fails closed with `503 Cash-to-cash funding policy unavailable`.
  It is not an environment flag and cannot be satisfied by a caller-supplied identifier.
- `evaluateFundingPolicy()` applies institution-match and effective-window rules; a controlled
  acceptance source supplies the _policy record_, never the rules.
- `test/support/controlled-funding-policy.ts` is the controlled source: constructible only under
  `NODE_ENV=test`, and it records the exact declared policy the run relied on.

Preserved unchanged: `RESOLVED`-only institutional admission, transaction-bound context
resolution, `SHARE` locking, revalidation before financial execution, `409` incompatible /
`503` unavailable, no default institution, no aggregator-derived authority.

### 2.4 Financial transaction boundary — the integration finding (ARENA 3B Stage 3)

**Conflict (classification C — genuine architectural conflict).** The pre-institutional
implementation credited one platform-wide obligation account
(`CASH_TO_CASH-UNCLAIMED-NGN`, `institutional_scope = UNATTRIBUTED`). Once a funding wallet is
institution-attributed, `LedgerService.resolveJournalInstitution()` correctly refuses the journal,
because it would mix an institution-scoped account with an unattributed one and would pool one
institution's float in a liability no institution owns. Cash-to-Cash could therefore never post
institutionally, no matter how good the fixture was.

**Resolution (no invented financial policy, no schema change).**

- `src/agent/cash-to-cash-institution-suspense.ts`: the obligation is the **funding institution's
  own suspense liability** (`C2C-UNCLAIMED-*`), opened through the existing governed
  institution-ledger path (`purpose: SUSPENSE`). A missing suspense account is `503`; there is no
  fallback to the legacy platform account.
- The obligation account is resolved **inside** the caller's transaction from the authoritative
  funding evidence, under `FOR SHARE`.
- Historical transfers with no funding evidence keep the legacy account they were actually posted
  to. They are never re-attributed and no institution is inferred for them.
- Claim authorization validates the obligation account derived from the transfer itself, never
  from the caller.
- Reconciliation read models accept both the institution suspense account and the legacy account.
- The funding authority no longer accepts a caller-supplied `unclaimedLedgerAccountId`; the field
  is deprecated and omitted.

### 2.5 Protected-authority compatibility

Unchanged and re-verified. No trigger, RLS policy, ownership guard, role grant or protected
function was weakened, disabled or bypassed by this mission. The institutional suspense accounts
are ordinary ledger accounts opened through the audited administrative path; they are not
protected-authority evidence.

### 2.6 Mobile recovery and reconciliation authorization

Not modified by this mission: the agent-mobile Cash-Out recovery, Cash-to-Cash funding recovery
and receipt recovery suites are unchanged, and the reconciliation authorization model
(institution-scoped workforce access, explicitly authorized platform access, cross-institution
rejection) is unchanged.

---

## 3. Canonical governed financial fixture

| Item                    | Detail                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location                | `test/support/governed-financial-fixture.ts`                                                                                                                                                                               |
| Acceptance suite        | `test/governed-financial-fixture.integration.spec.ts` (12/12)                                                                                                                                                              |
| Constructed with        | `new GovernedFinancialFixture({ app, dataSource, label })`                                                                                                                                                                 |
| Supported configuration | six authenticated MFA workforce principals; N governed institutions; agent affiliation; customer enrolment; wallet attribution; institution settlement and Cash-to-Cash suspense accounts; ledger posting; KYC eligibility |

### Required governance setup order

`GOVERNED_SETUP_ORDER` = institutional authority → agent affiliation → customer enrolment →
wallet and ledger attribution → financial funding.

Never attribute an account after its first ledger line — the attribution service itself refuses it
(`already has posted financial history`), and the fixture proves that refusal in case 4.

### What the fixture never does

It never inserts a checker decision, approval, approval consumption, execution-evidence row,
institutional attribution or ledger line directly; never disables a trigger, RLS policy, ownership
guard or protected check; never writes a protected evidence row of its own.

### Database role provisioning

The fixture runs against the application's connection. The three-login split
(`…_migrator` / `…_runtime` / `…_authority`) is exercised by
`test/protected-authority-boundary.integration.spec.ts`, which boots the real `AppModule` as the
provisioned runtime login against a migrator-owned database with a distinct authority login (7/7).
Role provisioning SQL is `scripts/sql/provision-database-roles-*.sql`, driven by
`scripts/provision-database-roles.js` and `test/support/protected-authority-provisioning.ts`.

### Example usage

```ts
const fixture = new GovernedFinancialFixture({ app, dataSource, label: 'suite' });
const institutionId = await fixture.institution(); // governed activation, cached
await fixture.openInstitutionCashToCashSuspenseAccount(institutionId);
const { wallet } = await fixture.prepareAgentFundingWallet(agentId); // affiliation + attribution
await fixture.fundLedgerAccount(wallet.ledgerAccountId, '10000', { institutionId });
```

### Historical fixture distinction

`test/support/governed-financial-fixture.ts` produces **new** institutional context. Historical
wallets, journals, transfers and obligations that predate institutional attribution are modelled
exactly as they are: `UNATTRIBUTED`, unresolved, and never re-attributed. Any suite needing a
historical shape must say so explicitly and must not use this fixture to attribute a used account.

### Reuse during Arena 1 integration

Arena 1 financial-engine suites should consume this fixture unchanged for institution, affiliation,
enrolment, attribution, funding and suspense-account setup, and reuse
`test/support/controlled-funding-policy.ts` and `test/support/desk-otp-fixture.ts` for the policy
and OTP seams. Ledger reversal must not be redesigned here.

---

## 4. Migration record

| Item                           | Value                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Migration inventory            | **134 files** (unchanged)                                                                                          |
| Migration head                 | **`1785753600503-CashOutInstitutionalScope`** (unchanged)                                                          |
| New migrations in this mission | **none** — the institutional suspense account is data created through the existing administrative path, not schema |
| `0117`                         | remains absent, as required until the Arena 1 integration publishes it                                             |

Published order preserved:
`1785753600400 → 0401 → 0500 → 0501 → 0502 → 0503`. Arena 2 identifiers `0202–0205` are present and
not renumbered. Readiness still enforces the whole shipped inventory, not only the head.

Supported historical upgrade procedures and readiness verification were not modified by this
mission; their acceptance status is recorded in §5.

---

## 5. Acceptance record

Exact commands, counts and exit codes live in `docs/integration/arena3b-evidence/`.

| Group                                                      | Command                                                                                        | Result                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit suite                                         | `npm test`                                                                                     | **247/247 suites, 2,899/2,899 tests, exit 0**                                                                                                                                                                                                                 |
| Backend TypeScript (root, src+test)                        | `npx tsc --noEmit -p tsconfig.json`                                                            | **0 errors** in `src/` and `test/` (the only residual errors are `apps/agent-mobile` files reached transitively, because that workspace's dependencies are installed separately)                                                                              |
| Governed fixture acceptance                                | `jest --config jest.integration.config.js test/governed-financial-fixture.integration.spec.ts` | **12/12, exit 0**                                                                                                                                                                                                                                             |
| Cash-to-Cash funding (A15)                                 | `jest … test/a15-agent-cash-to-cash.integration.spec.ts`                                       | **23/23, exit 0** (7/23 at the recovered checkpoint)                                                                                                                                                                                                          |
| Institutional foundation + financial ownership             | `jest … institution-foundation institution-financial-ownership`                                | **2 suites / 48 tests, exit 0**                                                                                                                                                                                                                               |
| Protected authority boundary + wallet ownership            | `jest … protected-authority-boundary wallet-ownership-resolution`                              | **2 suites / 28 tests, exit 0** — all four original reproductions still rejected                                                                                                                                                                              |
| Cash-to-Cash claim (A16)                                   | `jest … test/a16-agent-cash-to-cash-claim.integration.spec.ts`                                 | **RED — not accepted** (see §6)                                                                                                                                                                                                                               |
| Cash-to-Cash expiry (A17)                                  | `jest … test/a17-agent-cash-to-cash-expiry.integration.spec.ts`                                | **RED — not accepted** (see §6)                                                                                                                                                                                                                               |
| Cash-Out legacy (A14) + commercial/limit/commission legacy | full PostgreSQL regression                                                                     | **RED — not accepted** (see §6)                                                                                                                                                                                                                               |
| Full repository PostgreSQL integration                     | `node scripts/run-pg-integration-tests.js`                                                     | **145 files / 127 passed / 18 failed / 0 without result; 2,616 tests (2,360 passed / 256 failed); 0 memory failures, 0 timeouts, 0 crashes; exit 1 — RED, NOT accepted.** Per-suite detail in `docs/integration/arena3b-evidence/STAGE-8-full-regression.txt` |
| Isolated KYC                                               | `node scripts/run-isolated-kyc-tests.js`                                                       | not re-run in this mission (unchanged files); last accepted 9/107 at `5acc9c8`                                                                                                                                                                                |
| Admin web / agent mobile / customer mobile                 | per-app install + tsc + jest                                                                   | not re-run in this mission (no files in those workspaces changed); last accepted at `5acc9c8`                                                                                                                                                                 |
| Repository-wide Prettier                                   | `npm run format:check`                                                                         | **fails** — pre-existing (≈30 untouched files); all files changed by this mission pass Prettier                                                                                                                                                               |
| `apps/customer-mobile` `npm ci`                            | —                                                                                              | **pre-existing `EUSAGE` lockfile drift**, unchanged and not repaired by this mission                                                                                                                                                                          |

### Security regression (Stage 7)

Re-run against real provisioned roles and unchanged protected-authority code:

1. direct-SQL checker approval forgery — **rejected**;
2. checker forgery with ordinary non-owner DML — **rejected**;
3. MFA checker impersonation by session-hash mutation — **rejected**;
4. forged wallet-ownership approval — **rejected**.

The fixture acceptance suite additionally proves that a direct `UPDATE` of a protected approval and
a `DELETE` of protected evidence both fail under the owning connection, and that no checker
decision exists without its approval row.

---

## 6. Outstanding — NOT VERIFIED / NOT ACCEPTED

1. **Cash-to-Cash claim (A16) — red.** The accepted claim path now requires
   (a) an authenticated **claiming agent session** on the request and
   (b) an MFA challenge bound to the transfer through
   `cash_to_cash_claim_challenge_bindings`, which only the real
   `AgentDeskOtpService.issue({ purpose: 'CASH_TO_CASH_CLAIM' })` produces.
   The legacy suite fabricates `mfa_challenges` rows directly, so it now fails at
   `Claim authorization context unavailable`. Fabricating the binding is prohibited, so the suite
   must be migrated onto `test/support/desk-otp-fixture.ts` (real issuance + recording SMS
   provider) before it can be accepted. The fixture for that migration exists and is committed.
2. **Cash-to-Cash expiry (A17) — red.** Same OTP-binding dependency, plus the expiry worker's
   obligation accounting must be re-verified against the institution suspense account.
3. **Cash-Out legacy (A14) — red and unmigrated.** 40 `execute` calls use intent-less fabricated
   MFA challenges. The accepted lifecycle requires a persisted `cash_out_intents` row, an
   authenticated agent session, institution scope, transaction-bound OTP and a durable attempt
   budget. Migrating these scenarios onto `AgentDeskOtpService.issue({ purpose: 'WALLET_TO_CASH' })`
   plus the governed fixture is the largest remaining item. **No intent-less execution path was
   reintroduced and no mandatory-session check was weakened.**
4. **Legacy commercial/limit/commission suites** (`v1-commission-runtime-wiring`,
   `v1-commercial-accounting-01`, `v1-commercial-scenario-matrix-01`, `v1-limit-05-flow-matrix`)
   were red at the recovered checkpoint for the same reason (commit `1b95ba5` introduced
   `cash_out_intents` and the mandatory agent-session check without updating them). They remain red
   and unfixed.
5. **Full repository PostgreSQL integration is therefore not green and is not claimed.** Exact
   result: 145 files, 127 passed, 18 failed, 0 without a result; 2,616 tests, 2,360 passed, 256
   failed; no memory failures, no timeouts, no crashes; exit 1. The 18 failing suites are listed
   and root-cause classified in `docs/integration/arena3b-evidence/STAGE-8-full-regression.txt`.
   The failure surface is wider than the previously reported eight files: the same two causes
   (intent-less Cash-Out OTP fixtures and missing governed institutional context) also break
   `v1-agent-05`, `v1-agent-history-01`, `v1-agent-mfa-api-01`,
   `v1-agent-mobile-idempotency-persistence-01`, `v1-commercial-decision-03b`,
   `v1-commercial-decision-03c`, `v1-fee-runtime-wiring`, `v1-commission-settlement-01`,
   `v1-limit-02` and `v1-limit-04`.
6. **Production policy dependencies** (unchanged): an approved Cash-to-Cash funding policy per
   institution; genuine sender-identity and KYC evidence providers; an approved financial
   disposition policy; a transfer-code replacement policy.

### Suite-count reconciliation (reported 7 vs named 8)

The recovered documentation lists seven legacy suites but names eight files. The eight named files
are: `a14-agent-cash-out`, `a14-otp-hardening`, `a16-agent-cash-to-cash-claim`,
`a17-agent-cash-to-cash-expiry`, `v1-commission-runtime-wiring`,
`v1-commercial-accounting-01`, `v1-limit-05-flow-matrix`, `v1-commercial-scenario-matrix-01`.
The seventh count predates the split of `a14` into `a14-agent-cash-out` and `a14-otp-hardening`.
**All eight are in scope and none is omitted**; none is skipped or disabled.

---

## 7. Outstanding production dependencies

1. **Production database role provisioning** — the three logins and two group roles must be
   provisioned in the target environment and production readiness must report `verified`. It is
   **NOT VERIFIED**.
2. **Production authority readiness** — the authority credential must stay out of the runtime
   credential's scope and be rotated independently.
3. **Genuine KYC evidence providers** — the production reader returns `null` by design; acceptance
   used a test-only, NODE_ENV-guarded reader.
4. **Sender identity and approved funding-policy sources** — no approved Cash-to-Cash funding
   policy exists, so production funding is fail-closed. Acceptance used an explicitly declared
   controlled policy.
5. **Transfer-code replacement policy** — unchanged; no replacement code is generated and no raw
   code is stored.
6. **Financial disposition policy** for expired/unclaimed obligations — unchanged; expiry moves no
   funds.
7. **Unsupported cross-institution operations** — different funding and claiming institutions are
   rejected, not supported.
8. **Physical-device acceptance** — mobile suites are simulated native storage/transport, not
   physical-device acceptance.
9. **Remaining production integrations** — Arena 1 A6/A7 financial engine (including the published
   `0117` ledger-reversal migration and the reversal/authority reconciliation) and the remaining
   Arena 4 customer application are explicitly out of scope for this mission.

Controlled acceptance in this document **does not** establish production authorization.

---

## 8. Non-goals preserved

No Arena 1 A6/A7 or Arena 4 customer-app integration, no ledger-reversal redesign, no automatic
refunds, no replacement transfer codes, no invented financial policies, no customer-wallet-funded
Cash-to-Cash, no new products, no production credentials, no live provider calls, no real financial
transactions, no deployment, no merge into `main`, and no repository-wide reformatting.

---

## Appendix A16 — Cash-to-Cash claim suite migration (checkpoint `c6df0ad`)

`test/a16-agent-cash-to-cash-claim.integration.spec.ts`: **82 passed / 6 failed / 88 total**,
84.6 s, no timeouts. Baseline at `b43ea30`: 12 of 33 pre-existing scenarios could reach the claim
service at all.

The suite no longer fabricates challenges. `createMfaChallenge()` now drives the real
`AgentDeskOtpService.issue({ purpose: 'CASH_TO_CASH_CLAIM' })` and reads the delivered code from a
recording SMS provider (`test/support/desk-otp-fixture.ts`); the bindings it creates record the
agent, agent session, redemption method, transfer and destination hash that the scenario will
actually redeem. Balance and posting assertions track the receiving institution's
`C2C-UNCLAIMED-*` suspense account instead of the legacy global unclaimed account.

Six scenarios remain red, and none of them was relaxed:

| Scenario                                                                                      | Classification                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `44. Agent and KYC eligibility are rechecked after OTP and before cash settlement`            | **Product gap (pre-existing).** The claim completes when agent/KYC eligibility is revoked during OTP verification. Session, credential and session-expiry revocations _are_ re-checked (those S2 scenarios pass). |
| `S2 rejects pin-rotation committed during OTP verification without settlement`                | **Product gap (pre-existing).** No PIN-state re-read after verification; the claim posts.                                                                                                                         |
| `S2 rejects pin-lock committed during OTP verification without settlement`                    | Same gap.                                                                                                                                                                                                         |
| `S2 rejects pin-deletion committed during OTP verification without settlement`                | Same gap.                                                                                                                                                                                                         |
| `number and UUID claims racing settle exactly once`                                           | **Locator-lifecycle decision.** The number route retires the locator on the first (failed) attempt, so the racing UUID request answers 404 and nothing settles.                                                   |
| `locator settlement failure rolls back and retries with fresh OTP and the same financial key` | Same decision: after an injected settlement failure the locator is refused (404) instead of reusable for the 200 retry.                                                                                           |

`docs/integration/arena3b-evidence/NEXT-PHASE-MIGRATION-RECIPE.txt` records the exact procedure
that produced this result so A17, A14/A14-OTP-hardening and the remaining red suites can follow the
same path. A17 and A14 additionally need a claiming agent session: their claims currently pass no
`claimantPrincipal`, which the accepted claim/redemption contract requires.
