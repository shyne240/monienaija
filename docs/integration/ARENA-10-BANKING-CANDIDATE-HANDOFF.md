# Arena 10 handoff — Banking integration candidate (PR #44)

**Purpose.** Give Arena 10 a single candidate that contains the Banking work and its own
settlement-reconciliation work, with one resolved migration inventory, so the combined upgrade and
the row → History → journal checks can be rerun without re-deriving the chain.

## Candidate

| Field        | Value                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull request | **#44** — `[DRAFT] Banking integration candidate: Monnify Bank→Wallet lifecycle, governed returns + #51 reconciliation`                                                             |
| Base         | `arena/5-main-web-integration`                                                                                                                                                      |
| Head branch  | `arena/74f08c9a-monienaija`                                                                                                                                                         |
| Head SHA     | read it from PR #44 (not pinned here, so the document cannot go stale)                                                                                                              |
| Verified CI  | see the checks on PR #44's head; the run for the merged-tip candidate is reported in the handoff message                                                                            |
| State        | draft, unmerged                                                                                                                                                                     |
| PR #40       | reviewed head `f59a1c87833a892524bc559f9a4a5d8d220bcaba` — **already in this ancestry** (`git merge-base --is-ancestor f59a1c87 <head>` → true). #40 itself stays red and unmerged. |

The candidate also contains the current integration tip (`arena/5-main-web-integration` @
`f982fd39daada817553e2e3dc9d790a7122c5435`, which merged PR #50) and PR #51's head
`8e8f0615aebece9988ea1a8476076d8db10e7cb6`.

## Migration resolution

Six identities extend the integration chain. Three of them (`0810`–`0812`, from PR #50) were
published _below_ the then-current head `0813`; the other three are the Banking and reconciliation
identities. Nothing was renumbered: the chain is ordered by timestamp, and the combined head is the
newest published identity.

| Timestamp       | Class                                                 | Origin                     | Position                           |
| --------------- | ----------------------------------------------------- | -------------------------- | ---------------------------------- |
| `1785753600810` | `CustomerTierDefaultClassMappings1785753600810`       | integration (PR #50)       | published below the then-head 0813 |
| `1785753600811` | `LimitRuleUnlimited1785753600811`                     | integration (PR #50)       | same append                        |
| `1785753600812` | `CustomerRestrictionConfigurationReview1785753600812` | integration (PR #50)       | same append                        |
| `1785753600813` | `CreatePlatformFundsBankComparisons1785753600813`     | integration (PR #33)       | highest integration timestamp      |
| `1785753600900` | `BankToWalletMonnifyJourney1785753600900`             | Banking (PR #40)           | 176th                              |
| `1785753600901` | `BankToWalletReturnRefunds1785753600901`              | Banking (governed returns) | 177th                              |
| `1785753600910` | `SettlementReportReconciliation1785753600910`         | Arena 10 (PR #51)          | 178th — combined head              |

- Combined inventory: **178** identities (integration's 175 + the three Banking/reconciliation ones).
- Upgrade from the current integration schema (175 identities, `0813` head) applies **exactly**
  `0900`, `0901`, `0910`, in that order, preserving all 175 earlier identities.
- Upgrade from the **pre-#50** integration schema (172 identities, `0813` head) applies the
  tier-default identities `0810`–`0812` _and then_ `0900`, `0901`, `0910`, in timestamp order. Those
  tier defaults were published below the existing head, so they are applied out of authoring order
  but in chain order, and nothing already recorded is touched.
- `src/production/production-readiness.service.ts` expects head `1785753600910` /
  `SettlementReportReconciliation1785753600910`.
- Head assertions in the eight PostgreSQL batches (`migration-chain`, `stage8`, `stage10`,
  `arena5-consolidation`, `migration-0804-owner-authority`, `a8`, `a19`, `a20`) and the
  `migration-inventory` unit suite pin the combined head, the ordered tail, and the 178-identity
  inventory.

## How it is proven

`test/banking-reconciliation-migration-upgrade.integration.spec.ts` (new, real PostgreSQL):

1. every appended identity keeps its authored timestamp, the chain stays strictly ordered by
   timestamp, and the three Banking/reconciliation identities are the last three;
2. a **fresh install** applies all 178 once, in order, ending at `0910`, and a replay applies
   nothing;
3. an **upgrade from the current integration schema** applies exactly `0900`, `0901`, `0910`, keeps
   the earlier ledger intact, leaves `bank_to_wallet_return_refunds` and `settlement_report_imports`
   in place, and replays as a no-op;
4. an **upgrade from the pre-#50 integration schema** applies `0810`–`0812` and then `0900`, `0901`,
   `0910` in timestamp order, with every earlier identity still present exactly once.

Run it on a disposable cluster (never against a shared database):

```bash
node scripts/prepare-pg-test-env.js --create-if-missing   # once, git-ignored .env
NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=postgres DB_USER=monienaija \
DB_PASSWORD=monienaija-pw PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=arena10comb \
node -r dotenv/config ./node_modules/jest/bin/jest.js --config jest.integration.config.js --runInBand \
  test/banking-reconciliation-migration-upgrade.integration.spec.ts \
  test/settlement-reconciliation.integration.spec.ts
```

## What Arena 10 should report

After rerunning the combined upgrade:

1. **Row** — the imported settlement row / match state produced by the reconciliation path
   (`settlement_report_rows`, `settlement_transaction_matches`).
2. **History** — the same transaction as the customer sees it (credited list entry and detail), i.e.
   the `BANK-TO-WALLET-MONNIFY-PROVENANCE.md` history-compatibility evidence chain.
3. **Journal** — the credit journal the row corresponds to (`ledger_journals` / `ledger_lines`), and
   that no reconciliation table wrote to it (reconciliation is strictly non-posting).

## Constraints that must hold

- Production transfers and refunds stay disabled (`BANKING_ENABLED`, `BANK_TO_WALLET_ENABLED`,
  `BANK_TO_WALLET_PRODUCTION_ENABLED`, `MONNIFY_VERIFICATION_ENABLED`,
  `BANK_TO_WALLET_RETURN_EXECUTION_ENABLED` all `false`).
- No live Monnify call and no real money: deterministic providers and disposable PostgreSQL only.
- The 11 workforce accounts and passwords are untouched by this candidate.
- Monnify contract and refund-policy decisions remain open for owner review.
