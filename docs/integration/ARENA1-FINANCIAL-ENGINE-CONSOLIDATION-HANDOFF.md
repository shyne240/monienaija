# Arena 1 financial-engine consolidation — handoff

Branch `arena/ca576774-monienaija` (base `5acc9c8`, replay base `780ec76`).
Frozen sources, integrated but never modified: Arena 1 `arena/44f00580-*` (`8e4da1a`),
Arena 2 `arena/ea070127-*` (`0472687`), Arena 4 `arena/5ee539a0-*` (`7167fe9`).
All acceptance evidence in this document is controlled and synthetic: no production credentials, no
live provider call, no real financial transaction, no deployment, no merge to `main`.

## 1. Checkpoint register

Every checkpoint below is committed and pushed to `origin/arena/ca576774-monienaija`.

| Checkpoint                                       | Commit                          | Contents                                                                                       | State  |
| ------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| Stage 1 — Arena 2 idempotency contention         | `3d6024e` group (Stage 1 close) | `TransferService` attempt-3 `break` so `recoverCommittedResult()` runs; exactly-once preserved | pushed |
| Replay 1/33 — wallet creation authority          | `1e636c8`                       | first Arena 1 commit replayed (clean)                                                          | pushed |
| Replay 6/33 — atomic governed ledger reversal    | `cb7350e`                       | migration `1785753600117`, atomic approval consumption + posting + evidence + audit (Stage 3)  | pushed |
| Replay 15/33 — authorized withdrawal reservation | `54a7c43`                       | migrations `0140`, `0141`; commitment service; atomic reservation (Stage 4)                    | pushed |
| Replay 33/33 — A6/A7 reversal + receipt coverage | `85f05b6`                       | last Arena 1 commit; A7 lifecycle link `0146` (Stage 5)                                        | pushed |
| Fixture alignment                                | `89ac2ff`                       | A6/A7 fixtures aligned to the accepted eligibility, readiness and inventory contracts          | pushed |
| Stage 6 — funding pool classification            | `76a4dc9`                       | fail-closed pool classification guard, 4-case regression, decision record                      | pushed |
| Legacy fixture reconciliation                    | `af1dbc4`                       | the four fixtures the integrated engine refuses earlier                                        | pushed |
| Stage 8 — migration acceptance                   | `04f73a5`                       | 17-check consolidated migration/upgrade acceptance                                             | pushed |
| Stage 7/9/10 evidence                            | `89ce499`                       | shared authorization matrix, formatting and lint hygiene                                       | pushed |
| Stage 12 — handoff                               | this commit                     | integration map, evidence records, this document                                               | pushed |

## 2. Implementation record

### 2.1 Integration method (Stage 2)

Arena 1 was replayed, not merged: 33 commits via `git cherry-pick -x`, one at a time, in dependency
order, onto the accepted Arena 2 / Arena 3B head. Conflicts occurred only where Arena 1 assumed its
own branch state (readiness migration constants, migration-inventory lists, session audience and
savepoint handling, A6/A7 fixtures) and were resolved towards the accepted contract. Nothing was
dropped or reordered. Full mapping, including the fifteen required items with their exact source and
local commits: `docs/integration/ARENA1-STAGE-2-INTEGRATION-MAP.md`.

### 2.2 What the consolidated engine now does

| Area                                   | Behaviour                                                                                                                                                                                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet creation authority              | CUSTOMER wallets require governed eligibility; AGENT wallets require an ACTIVE, non-deleted Agent; anything else requires review.                                                                                                                                                      |
| Withdrawal obligations                 | An A6 external operation must match the persisted withdrawal (wallet, amount, currency, status) before it can settle or be compensated.                                                                                                                                                |
| Governed ledger reversal (`0117`)      | Approval consumption, posting, execution evidence and audit commit in one atomic boundary; exact replay returns the original execution; changed payload, forged approval, cross-institution attempt, held/incompatible account and consumed approval without evidence all fail closed. |
| Financial commitments (`0140`, `0141`) | Authorized initiation only, server-resolved destination, atomic reservation, settlement/rejection/compensation, verified-provider-only settlement, unverified outcomes stay in suspense.                                                                                               |
| A7 inbound (`0142`-`0146`)             | Only genuinely verified inbound receipts post; an inbound effect is never mapped onto an outbound withdrawal debit; non-financial command/lifecycle evidence persists with replay semantics; execution is bound to the lifecycle.                                                      |
| Agent funding pool                     | Platform-level `CUSTOMER_FUNDS` counterparty liability; refuses institution attribution, wrong currency/accounting unit, inactive pool, and refuses to fund institution-attributed Agent wallets from platform float.                                                                  |
| Readiness                              | Fails closed while financial dependencies are unverified (`financial_dependencies_not_ready`); detects a missing EARLIER migration, not only a wrong head.                                                                                                                             |

### 2.3 Scope discipline

- No migration was renumbered, edited, squashed or reordered. Head stays
  `1785753600503-CashOutInstitutionalScope`; the financial-engine range `0117`, `0140`-`0146` ships
  with its published identifiers (142 migration files).
- No approval, commitment, receipt, settlement, funding, institutional attribution or financial
  evidence was fabricated; several migrations are deliberately forward-only and refuse to remove
  evidence.
- No protected-authority trigger, RLS policy, grant, ownership guard, eligibility rule or ledger
  isolation rule was weakened, disabled or bypassed — including to make a suite green. Four fixtures
  were corrected because the accepted behaviour refused them earlier, not because the guard was wrong.
- No production accounting, funding, suspense, return or refund policy was invented. Where policy is
  missing the flow fails closed and the decision is named (see §4).

## 3. Acceptance record

Full detail: `docs/integration/arena1-financial-engine-evidence/`.

| Group                                                             | Result                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Backend PostgreSQL integration matrix (`npm run test:pg:bounded`) | **150/150 suites, 2,722/2,722 tests**, 25/25 batches, exit 0, 0 memory failures, 0 timeouts, ~55 min |
| Backend unit suite (`npm test`)                                   | **250/250 suites, 2,923/2,923 tests**, exit 0                                                        |
| Isolated KYC PostgreSQL group                                     | **10/10 suites, 114/114 tests**, exit 0                                                              |
| `apps/admin-web`                                                  | **85 suites / 868 tests**, exit 0                                                                    |
| `apps/agent-mobile`                                               | **20 suites / 310 tests**, exit 0                                                                    |
| `apps/customer-mobile`                                            | **14 suites / 125 tests**, exit 0                                                                    |
| `npx tsc --noEmit`                                                | 0 errors                                                                                             |
| `npm run build`                                                   | exit 0                                                                                               |
| `npm run lint`                                                    | 0 errors, 7 warnings (unused eslint-disable directives)                                              |
| `npm run format:check`                                            | fails on exactly the 30 pre-existing files (§5), none touched here                                   |

Stage-specific evidence:

- **Stage 3** governed reversal: `v1-ledger-reversal-governance` + `a5-ledger-reversal` +
  `protected-authority-boundary` 36/36; `ledger-reversal-governance.service.spec` 6/6; isolated
  reversal suite green inside the isolated group.
- **Stage 4** commitments/outbound: `a6-settlement-lifecycle` 20/20; commitment
  initiation + A7 admission 41/41; commitment schema in the 34-test migration-readiness group.
- **Stage 5** A7 inbound: `a7-authoritative-persistence` 37/37; product financial effect +
  lifecycle 14/14; A7 persistence obligations + admin P1 authorization 16/16.
- **Stage 6** pool: `agent-funding-pool-classification` 4/4 plus 108 surrounding agent-rail tests.
- **Stage 7** seven-flow reconciliation: `docs/integration/STAGE-7-SHARED-AUTHORIZATION-ISOLATION-MATRIX.md`.
- **Stage 8** migrations: 17/17 (`stage8-financial-engine-migration`), including upgrade from the
  Arena 2 baseline, no backfill, and readiness detection/restoration of a missing earlier migration.
- **Stage 9** protected authority: 5 suites / 88 tests; the four original reproductions still rejected.

**This is controlled synthetic acceptance. It is not, and must not be read as, production readiness.**
No group is claimed as accepted that was not executed; no failed group was softened into a pass.

## 4. Outstanding production dependencies (all fail closed today)

1. **Trusted KYC evidence reader** — the production reader returns `null`; no provider account,
   contract, authenticated provenance or key source is confirmed. Every financial gate therefore
   refuses in production.
2. **Identity key versions / effective KYC policy** — unverified; readiness lists both as blockers.
3. **Provider governance and routing**, **wallet ownership governance**, **financial authorization
   dependencies** — unverified.
4. **Withdrawal execution authority** — registered default is unavailable; requires authoritative
   institutional entitlement plus independent destination-ownership evidence.
5. **Inbound funding verifier, institutional authority and suspense policy** — defaults are
   unavailable; a test-only policy cannot establish approved handling of arrived-but-uncreditable funds.
6. **`AGENT_FUNDING_POOL-NGN` economic classification** — decision outstanding with the product owner
   and a licensed institution (counterparty, external funding source, settlement/reimbursement of a
   negative pool balance, whether the institution-bound rail replaces it). See
   `docs/integration/AGENT-FUNDING-POOL-CLASSIFICATION.md`.
7. **Institution-bound Agent float rail** — no institution funding authority exists, so
   institution-attributed Agent funding is refused rather than funded from platform float.
8. **Commitment recovery for settled-but-returned payments** — rejected by design until an
   authenticated, operation- and amount-bound return outcome and an approved accounting policy exist.
9. **Release-remediation tooling exceptions** — repo-wide Prettier on 30 untouched files, the
   `apps/customer-mobile` `npm ci` lockfile drift (EUSAGE), 7 lint warnings.

## 5. Pre-existing tooling exceptions (unchanged, tracked)

| Item                            | Status                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run format:check`          | fails on 30 files, all pre-existing and untouched by this consolidation             |
| `apps/customer-mobile` `npm ci` | fails with EUSAGE lockfile drift; the workspace's test suite still runs (125 tests) |
| `npm run lint` warnings         | 7 unused eslint-disable directives                                                  |

## 6. Arena 4 integration instructions

Arena 4's HTTP API is already present and integrated. The **customer application must not be
integrated yet**. When it is, observe the following:

1. **Never** re-interpret an A7 virtual-account _assignment_ as a payment, a debit or an outbound
   commitment. Assignment is account lifecycle metadata.
2. Supply, from Arena 4, transaction-fresh authoritative **institution entitlement** and
   **destination institution/product authorization**, plus a decision on how unknown destinations are
   attributed. No aggregator-as-institution and no default institution.
3. Supply an independently authenticated **receipt verification** bound to destination, amount,
   currency and reference, and an approved **suspense policy** with case ownership and a resolution
   lifecycle. Until then the inbound boundary aborts rather than posting.
4. Bind any inbound receipt to an A7 command/lifecycle atomically (migrations `0144`-`0146` are the
   contract). Do not attach receipts to lifecycles outside that transaction.
5. Do not backfill authorizations, PIN audit events, destination bindings, reservations or
   attributions for historical operations, and do not settle or release pending pre-`0141`
   operations by automation. They need controlled reconciliation and an approved recovery procedure.
6. Keep every shared guard: customer eligibility, wallet/obligation boundary, session/credential
   binding, institutional attribution, ledger isolation, protected authority. Adding a caller,
   an internal operation id or a new endpoint is not a reason to bypass any of them.
7. Preserve the regression suite: any new financial path must add cases to the matrices in
   `docs/integration/arena1-financial-engine-evidence/` and must be included in the consolidated run
   (backend PostgreSQL, unit, isolated KYC **and all three application workspaces**).

## 7. Final state

- Local `HEAD` equals the remote checkpoint on `origin/arena/ca576774-monienaija`; the working tree is
  clean.
- Migration head unchanged: `1785753600503-CashOutInstitutionalScope` (142 files).
- Frozen Arena 1, Arena 2 and Arena 4 branches untouched; no merge to `main`; no deployment.
