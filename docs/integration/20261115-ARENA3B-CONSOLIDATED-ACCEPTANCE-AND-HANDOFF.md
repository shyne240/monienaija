ARENA 3B — CONSOLIDATED ACCEPTANCE AND HANDOFF
=============================================
Branch: arena/ca576774-monienaija   Date: 2026-11-15 (UTC)   Environment: 2 vCPU / 3.8 GiB sandbox,
embedded PostgreSQL 18.4, synthetic data only. Nothing in this report was produced against a real
customer, real money or a production database.

1. What Arena 3B delivered
--------------------------
Arena 3B turns the agent desk from "platform-wide pockets" into institutional money movement with
attributable authority:

  a) Cash-to-Cash funding authority — `CashToCashFundingPolicy` (src/agent/cash-to-cash-funding-policy.ts)
     decides whether an initiation is funded, from which account, and records the decision as
     evidence. There is no default-approve path: an unconfigured authority fails closed.
  b) Institutional obligation attribution — unclaimed Cash-to-Cash liability lands on the funding
     institution's suspense account (src/agent/cash-to-cash-institution-suspense.ts), not on the
     legacy global `CASH_TO_CASH-UNCLAIMED-NGN` row. The institutional-scope CHECK in migration
     1785753600401 makes a half-attributed account impossible at the database level.
  c) Transaction-bound claim authority — a claim re-reads the claimant Agent's session, credential
     and class capability INSIDE the posting transaction (src/agent/agent-cash-to-cash-claim.service.ts),
     so a session revoked mid-flight cannot post, and the claim needs a real
     `CASH_TO_CASH_CLAIM` OTP bound to the transfer it redeems.
  d) Legacy suite migration — every pre-Arena-3B suite that fabricated MFA challenges, attributed
     accounts with raw SQL or mocked A2WorkforceSessionService now runs the governed lifecycle
     through the public API. No test bypasses a guard.

Only two production files carry the behavioural change set for the funding/claim work
(agent-cash-to-cash.service.ts, agent-cash-to-cash-claim.service.ts) plus the new policy/suspense
modules, the claim-authorization helper, the module wiring, and a reconciliation read. The rest of
the mission's diff is tests (36 files) and evidence documents. No migration was edited, reordered
or squashed; head stays 1785753600503-CashOutInstitutionalScope (134 migration files).

2. Acceptance results
---------------------
Backend PostgreSQL integration (full matrix, exclusive run, exit 0)
  145/145 suites, 2,616/2,616 tests, 25/25 batches, 0 memory failures, 0 timeouts,
  0 unexplained crashes, ~61.5 min.  (docs/integration/arena3b-evidence/STAGE-8-full-regression.txt)

Backend unit suite
  247/247 suites, 2,899/2,899 tests, exit 0.

Compilation, build, lint, format
  `npx tsc --noEmit -p tsconfig.json` -> 0 errors in src/ and test/. Two errors remain in
  apps/agent-mobile/src/services/secure-storage.ts because that workspace's dependencies are not
  installed in this sandbox (`Cannot find module 'expo-secure-store' / 'react-native'`).
  `npm run build` (nest build) -> exit 0.
  `npm run lint` -> 0 errors, 5 warnings (unused eslint-disable directives).
  `npm run format:check` -> fails on 30 files, ALL pre-existing and untouched by this mission.

Per-family evidence: docs/integration/arena3b-evidence/STAGE-11-consolidated-matrix.txt
  agent desk (cash-out/OTP/PIN/mobile idempotency) ....... 79 tests PASS
  Cash-to-Cash (initiation/claim/expiry/recovery) ....... 150 tests PASS
  agent history .......................................... 17 tests PASS
  commercial (fees/commissions/accounting/snapshots) .... 127 tests PASS
  limits (assignment/enforcement/runtime/flow matrix) ... 279 tests PASS
  mobile + operational recovery .......................... 23 tests PASS
  migration chain + historical upgrade ................... 34 tests PASS
  protected authority + institutional ownership .......... 76 tests PASS
  shared fixture acceptance ............................. 12 tests PASS

3. The one honest caveat in the numbers
---------------------------------------
The first full run had one flaky failure: five fully simultaneous identical idempotency-key
WALLET_TRANSFERs in v1-limit-04-limit-runtime; four observed the single journal, the fifth consumed
its SERIALIZABLE retry budget (3 attempts) and surfaced a conflict instead of the replay. The suite
was re-run four times afterwards and passed 28/28 every time, including in the final exclusive run.
The assertion was NOT loosened. Root cause is scheduling pressure on a 2-vCPU box, and the same
mechanism is why the governed concurrency tests in this mission pre-issue their OTPs and stagger
requests by i*250 ms.

4. Decisions taken (and why), with their consequences
----------------------------------------------------
- Funding authority: real `CashToCashFundingPolicy` in every suite (`createControlledFundingPolicy`
  + `overrideCashToCashFundingPolicy`), never a permissive double.
- No fabricated evidence, ever: MFA/desk OTPs are issued by `AgentDeskOtpService` with the same
  operation key as the execution, and account attribution goes through the governed endpoints.
  Suites that used raw SQL for either were rewritten, not patched.
- The workforce session double was removed everywhere. A token double cannot carry role-derived
  function scopes, so governed maker-checker cannot be honestly exercised with it; suites now use
  the real workforce service and `workforce()` tokens (networkManager for `agent.view`, auditor for
  read-only oversight).
- AGENT_FUNDING/AGENT_DEFUNDING stay on the platform rail and FAIL CLOSED for an
  institution-attributed agent wallet, because `AGENT_FUNDING_POOL-NGN` has no institution
  classification. This is a real missing-policy boundary (not a test defect); it is asserted as a
  refusal in v1-commission-settlement-01 S06 and documented in STAGE-B2.
- Commercial families (fee revenue, VAT, commission expense/payable) are institutional accounts
  owned by the transacting institution; the settlement asset is resolved through the governed
  ledger path rather than the unattributed migration seed.
- 145 suites are executed as 25 batches of 6 in separate processes (`scripts/run-pg-integration-tests.js`)
  because a single long-lived jest process accumulates heap and dies; batching changes nothing about
  isolation (each suite keeps its own disposable database).

5. Known limitations / open items (not fixed here, deliberately)
---------------------------------------------------------------
1. Agent funding pool is platform-scoped. Either an institution funding pool must be provisioned and
   AgentFundingService made institution-aware, or platform-level agent wallets must be approved as
   the funding rail. Until then: fail-closed, no journal, no commission movement.
2. `SettlementAccountService` resolves the settlement control account by CODE only, so per-currency
   multi-institution settlement needs per-institution settlement identities before a real rollout.
3. `npm run format:check` is red on 30 untouched files (pre-existing).
4. `apps/customer-mobile` cannot be installed in this sandbox (`npm ci` fails EUSAGE on lockfile
   drift), and no app workspace has node_modules here, so admin-web / agent-mobile /
   customer-mobile unit suites and mobile builds could NOT be executed in this environment. They are
   NOT reported as passing. Backend coverage of the mobile-facing contracts lives in
   v1-agent-mobile-idempotency-persistence-01 (4/4), v1-mobile-idempotency-recovery-01 (2/2),
   v1-agent-mfa-api-01 (13/13) and v1-sprint3-cross-surface-payloads.
5. The SERIALIZABLE budget (3 attempts) is tight for fully simultaneous writes; it is a scheduling
   property, documented above, not a correctness gap.

6. How to reproduce / where to look
-----------------------------------
  node scripts/embedded-pg.js                     # EMBEDDED_PG_CONFIRM_DISPOSABLE=yes, :5432
  NODE_ENV=test DB_HOST=127.0.0.1 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
    PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560 \
    node scripts/run-pg-integration-tests.js      # the 145-suite matrix
  npm test                                        # the 247-suite unit matrix

Evidence files (docs/integration/arena3b-evidence/)
  NEXT-PHASE-MIGRATION-RECIPE.txt       recipe v5: how to migrate another legacy suite
  STAGE-1-fixture.txt                   the governed institutional fixture
  STAGE-2-3-funding-authority-and-c2c.txt   funding policy + institutional obligation
  STAGE-7-security-regression.txt       protected authority (historical)
  STAGE-8-full-regression.txt           this acceptance run, with the red history kept
  STAGE-9-migration-and-upgrade.txt     chain, ledger parity, historical-data upgrade
  STAGE-10-protected-authority.txt      authority re-verification after Stage B
  STAGE-11-consolidated-matrix.txt      per-family matrix
  STAGE-A14*, STAGE-A16*, STAGE-A17*    the three accepted hardening stages
  STAGE-B-legacy-suite-migration.txt    every migrated suite, class-A/B corrections
  STAGE-B2-institutional-attribution.txt  account classification decisions (incl. fail-closed pool)

7. Suggested next step
----------------------
Decide the agent-funding rail policy (item 1 above). It is the only remaining place where Arena 3B's
institutional model has no answer, it is currently fail-closed and asserted as such, and it blocks
any flow that funds an institution-attributed agent wallet from the platform pool.
