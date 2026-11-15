# Stage 2 — Arena 1 dependency-aware integration map

Branch `arena/ca576774-monienaija` · replay base `780ec76` · frozen Arena 1 source `8e4da1a` (`arena/44f00580-*`, never modified).

Arena 1 was integrated by **dependency-ordered `git cherry-pick -x` replay**, not by merge: 33 Arena 1 commits replayed one at a time onto the accepted Arena 2 / Arena 3B head, with every difference resolved towards the already-accepted contract. No Arena 1 commit was dropped, squashed or reordered. Each mapping below is verifiable from the `(cherry picked from commit …)` annotation on the local commit.

## 1. The fifteen required integration items

| #   | Item                                                                                                                                                                   | Arena 1 source                                                              | Local commit | Integration note                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| 1   | **Wallet creation authority for provisioning** — Ownership/authority for creating wallets: CUSTOMER wallets require eligibility, AGENT wallets require an ACTIVE Agent | `3f611a3` Require wallet creation authority for provisioning                | `1e636c8`    | clean replay                                                                                        |
| 2   | **External operations bound to their withdrawal obligations** — An A6 external operation must match the persisted withdrawal (wallet, amount, currency, status)        | `c331313` Bind external operations to their withdrawal obligations          | `50e3bfb`    | clean replay                                                                                        |
| 3   | **Readiness fails while financial dependencies are unverified** — Fail-closed readiness gate; the reason chain ends `financial_dependencies_not_ready`                 | `ee7c0eb` Fail readiness while financial dependencies are unverified        | `12bd986`    | conflict: readiness service kept the accepted Arena 2 gate shape and the `1785753600503` constant   |
| 4   | **Wallet provisioning normalization and inactive Agent wallet restriction** — No wallet may be created for a non-ACTIVE Agent owner                                    | `1fd9260` Normalize wallet provisioning and restrict inactive agent wallets | `fe88ccd`    | clean replay                                                                                        |
| 5   | **Remaining financial integration blockers recorded** — The dependency blocker list is explicit; no environment flag can override readiness                            | `ead4a83` Record remaining financial integration blockers                   | `ae6603f`    | clean replay                                                                                        |
| 6   | **Atomic governed ledger reversal (migration `0117`)** — Approval consumption + posting + evidence + audit in one atomic boundary (Stage 3)                            | `413055f` Execute governed ledger reversals atomically                      | `cb7350e`    | conflict: migration-inventory lists; head constant kept at `1785753600503`                          |
| 7   | **Settlement evidence bound to its external operation** — Provider settlement evidence cannot be replayed across operations                                            | `fad38fd` Bind settlement evidence to its external operation                | `79c2cef`    | clean replay                                                                                        |
| 8   | **Eligibility dependency outages retryable** — A transient trusted-KYC outage is retryable and never becomes an eligibility decision                                   | `8f7179d` Keep eligibility dependency outages retryable                     | `4c0340f`    | conflict: kept `DEFAULT_SESSION_AUDIENCE` and the released savepoint, re-applied the retry contract |
| 9   | **Product effect reservations roll back on evidence outages** — No orphan reservation is left when evidence is unavailable                                             | `81793dd` Roll back product effect reservations on evidence outages         | `a6a8013`    | clean replay                                                                                        |
| 10  | **Product compensation atomic and requires verified failure** — Compensation requires verified failure evidence, never a caller-supplied status                        | `ef8af88` Make product compensation atomic and require verified failure     | `60c929b`    | clean replay                                                                                        |
| 11  | **Product settlement composed with its execution transaction** — No separate pre-commit boundary                                                                       | `3d6024e` Compose product settlement with its execution transaction         | `c79baa3`    | clean replay                                                                                        |
| 12  | **Unverified settlements kept in suspense** — Unverified outcomes stay unresolved; no automatic release or refund                                                      | `f75c88f` Keep unverified settlements in suspense                           | `c4d0e8d`    | clean replay                                                                                        |
| 13  | **Independently verified provider settlement outcome required** — Caller-supplied success is refused                                                                   | `e12b096` Require independently verified provider settlement outcome        | `acdba74`    | clean replay                                                                                        |
| 14  | **Financial commitment and authorization evidence persisted** — Commitment and authorization records (Stage 4)                                                         | `966f8f9` Persist financial commitment and authorization evidence           | `054ddbd`    | clean replay                                                                                        |
| 15  | **Authorized withdrawal funds reserved atomically** — Reservation, approval consumption and evidence in one transaction (Stage 4)                                      | `2b2a0cf` Reserve authorized withdrawal funds atomically                    | `54a7c43`    | conflict: readiness migration constants kept at `1785753600503` `CashOutInstitutionalScope`         |

## 2. A6/A7 completion commits (items 16-33)

These extend item 15 into the accepted A6 outbound settlement and A7 inbound receipt lifecycles. They were replayed after item 15 because each depends on commitment, receipt or lifecycle evidence created by its predecessors.

| #   | Item                                                                | Arena 1 source | Local commit |
| --- | ------------------------------------------------------------------- | -------------- | ------------ |
| 16  | Checkpoint reserved withdrawal lifecycle integration (not accepted) | `19e7875`      | `3264867`    |
| 17  | Bind reserved withdrawals to customer beneficiary evidence          | `906e26c`      | `abf891a`    |
| 18  | Fail closed on inbound effects mapped to withdrawal debit           | `862fa61`      | `5d82a24`    |
| 19  | Cover identity-conflict holds on committed withdrawals              | `d4c0424`      | `06b31a4`    |
| 20  | Reject unsupported historical financial-effect replays              | `ddce12b`      | `0ba9972`    |
| 21  | Add isolated verified inbound receipt prototype                     | `29f5882`      | `051bac5`    |
| 22  | Migrate A6 PostgreSQL settlement fixtures to real commitments       | `515b52a`      | `14a3941`    |
| 23  | Wire fail-closed customer withdrawal commitment lifecycle           | `e3124a5`      | `7104e17`    |
| 24  | Make inbound receipt boundary transaction composable                | `2626553`      | `a75fb6e`    |
| 25  | Preserve verified inbound evidence for reconciliation               | `8ffc457`      | `69308f0`    |
| 26  | Persist nonfinancial A7 command and lifecycle evidence              | `342489a`      | `51acd4f`    |
| 27  | Harden A7 consumer reads and admission evidence checks              | `5a44937`      | `7ce454b`    |
| 28  | Add fail-closed governed A7 inbound admission contract              | `1abeaf4`      | `b41c09b`    |
| 29  | Expose authenticated A7 inbound admission lifecycle                 | `59abaed`      | `dbdb5fb`    |
| 30  | Bind verified inbound receipt execution to A7 lifecycle             | `cf6d584`      | `da87591`    |
| 31  | Harden inbound execution authorization and regression checks        | `799f884`      | `3321601`    |
| 32  | Migrate A7 financial regressions to authorized fixtures             | `bcb33bf`      | `b38cd4f`    |
| 33  | Complete controlled A6 A7 reversal and receipt regression coverage  | `8e4da1a`      | `85f05b6`    |

## 3. Follow-up corrections made during integration (not Arena 1 commits)

| Local commit | Correction                                                                                                 | Reason                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `93c5007`    | merged the duplicated `MemoryManager.query` into one overload                                              | TS2393: the protected-authority RETURNING emulation and the reversal map describe one method                             |
| `3264867`+   | isolated reversal suite moved to `test/support/kyc-isolated-cluster.ts`                                    | the hardcoded socket path/port made the suite environment-bound                                                          |
| `89ac2ff`    | A6/A7 fixture alignment (`onboarding_password_version`, tier-policy upsert, readiness/inventory contracts) | the accepted Arena 2 gates refuse the older fixtures; assertions were corrected to the accepted contract, never weakened |
| `76a4dc9`    | Stage 6 pool classification guard + decision record                                                        | mission Stage 6; fail-closed, no policy invented                                                                         |
| `af1dbc4`    | four legacy fixtures reconciled                                                                            | wallet creation authority and the fail-closed policy branch are the accepted behaviour                                   |
| `04f73a5`    | Stage 8 17-check migration acceptance                                                                      | mission Stage 8                                                                                                          |
| `89ce499`    | Stage 7 shared authorization/isolation matrix, formatting, lint hygiene                                    | mission Stage 7/9/10                                                                                                     |

## 4. Completeness check

`git cherry HEAD 8e4da1a 780ec76` still lists twelve Arena 1 commits as `+`. Those are exactly the commits whose content had to be resolved against the accepted contract, so their patch ids necessarily differ. Their effects are present and are proven by the consolidated acceptance matrix; no Arena 1 change is missing. The thirty-three `(cherry picked from …)` annotations above are the complete replay chain.

## 5. Ordering constraints any future replay must preserve

1. Wallet creation authority before anything that provisions wallets (items 1, 4).
2. Obligation binding before settlement evidence (items 2, 7).
3. Governed reversal evidence (`0117`) before commitment work, because reversal authority refuses commitment-linked journals (item 6).
4. Commitments and destination evidence (`0140`, `0141`) before A6 settlement and before A7 receipt binding (items 14, 15, 22, 25, 30).
5. A7 command/lifecycle persistence (`0144`) before the inbound execution link (`0145`, `0146`).
6. The institutional chain (`0400`-`0503`) stays last and its published head never moves.
