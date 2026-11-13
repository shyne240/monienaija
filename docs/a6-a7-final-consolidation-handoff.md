# A6/A7 controlled regression acceptance and consolidation handoff

## Scope and checkpoint

Application checkpoint: **8e4da1a52f066656563b16275cf480c34a263440**, branch `arena/44f00580-monienaija`, based on `3b0ca4488fb40ac5a64ed4ff6264dc64be2e954e` (`integration/h04-h06-transaction-notification-controls`). This handoff is a subsequent documentation-only commit; use the application checkpoint above for the exact tested code. This is controlled local regression acceptance, **not production readiness**, a main merge, deployment, financial policy approval, live provider verification, or permission for real transactions. No such activity occurred.

The safest consolidation unit is the complete ordered branch ancestry from the base to the application checkpoint, not an isolated cherry-pick. The sequence below identifies the financial-boundary subset from `780ec761` onward, but earlier KYC, authentication, wallet, policy, migrations, and admin/A2 changes in branch ancestry are dependencies too. Inspect `git log --reverse --format='%H %s' 3b0ca4488fb40ac5a64ed4ff6264dc64be2e954e..8e4da1a52f066656563b16275cf480c34a263440` and retain all required preceding changes; do not assume the subset alone applies cleanly to another base. `19e7875` is an intermediate not-accepted checkpoint, superseded by later changes, not a release candidate.

## Four legacy regression classifications

All four old cases in `bcb33bf:test/a7-product-financial-effect.integration.spec.ts` built a virtual-account **inbound** envelope and attempted to settle it as an A6 outbound withdrawal. The direction guard correctly rejected the prerequisite. They are not evidence of a posted inbound receipt or authorized outbound settlement.

| Former case | Original scenario and protected invariant | Boundary error | Correct replacement and limits |
| --- | --- | --- | --- |
| `successfully posts compensating entries reversing original directions` | Recovery must invert every original debit/credit, preserve balances and remain subject to compliance, verified evidence and transactional rollback. Originally purported to compensate an outbound settlement. | Inbound funding was used as the source of the alleged outbound settlement. | `reverses the genuine reservation exactly, only after verified rejection and after a rolled-back outbox failure`: real authenticated/PIN-authorized A6 commitment, exact inverse of reservation journal, compliance hold, UNKNOWN/UNAVAILABLE/mismatched proof and injected outbox failure before verified rejection release. This is **reservation release**, not compensation of settled funds. |
| `concurrent compensation posts once and replays the committed result` | Competing recoveries must create one financial resolution and replay the original persisted result. | Same invalid inbound-to-outbound settlement prerequisite. | `serializes concurrent authorized reservation release and recovers exactly one result` uses a genuine reserved commitment, concurrent release and persisted replay; exactly one resolution journal and restored source balance. Settled commitment recovery remains blocked. |
| `keeps exhausted but uncertain outcomes for review until rejection is confirmed` | Exhaustion or uncertain provider outcome is not proof of failure; verified rejection cannot alone prove settled funds returned. | Same invalid prerequisite; a rejected provider outcome was used as if it established a right to recover an already posted inbound/outbound effect. | Real commitment tests `preserves a settled commitment despite unknown or rejected outcomes without proof of returned funds`, `preserves funds after actual retry exhaustion until independently verified rejection`, and missing/unverified/mismatched evidence coverage distinguish verified pre-settlement release from unsupported post-settlement compensation. No return evidence is invented. |
| `rejects double reversals of the same settlement` | A financial effect must not be reversed twice; same-key replay must identify the original result and competing resolution must not create another journal. | Same invalid inbound-to-outbound settlement prerequisite. | `prevents duplicate reservation reversals and recovers the first authorized release` checks release replay, competing key, one resolution and balance; `does not permit generic maker-checker approval to reverse a genuine committed outbound settlement` creates a real settled A6 commitment and actual maker/checker approval, and proves generic reversal fails, approval remains unconsumed and no reverse journal exists. |

Separately, `does not reverse a genuinely credited inbound receipt even with generic maker-checker approval` creates a real authorized A7 inbound credit and actual distinct workforce maker/checker approval. Both attempts receive explicit conflict; the approval and original lifecycle/receipt remain intact, and the database trigger also rejects direct ledger reversal. Existing generic governed reversal tests still demonstrate successful authorized maker-checker reversal of eligible non-commitment journals. They do **not** authorize receipt returns or settled-commitment compensation. Inbound return/correction and settled-commitment recovery require separately approved policy, authoritative evidence of return/entitlement, and atomic governed execution. Preserve the original obligation and receipt pending that work; do not infer a refund or invent a disposition.

## Supported boundaries and shared contracts

- **A6 outbound**: a real customer session, PIN, beneficiary/destination binding, eligible customer/wallet, authorized execution authority and limit reservation establish a durable commitment and reserve. Provider outcome must be independently verified and bound to the operation/reference. A verified settlement atomically resolves the reserve; independently verified rejection can release a still-reserved commitment. Uncertainty, holds, mismatches and outages do not release money. Rejection alone does not prove returned settled funds. Legacy compensation refuses modern committed settlements; generic reversal cannot bypass reserve protections.
- **A7 inbound**: authenticated create/admit/execute resolve the persisted customer principal, original authorization, account binding, A4 policy decision and current admission/execution authority. A separately verified immutable observation must already be linked to the command at creation. Execution checks customer, route, institution, wallet, amount, currency, reference and obligation, and atomically consumes execution authority, posts balanced receipt/journal, advances lifecycle, writes audit/outbox and supports persisted replay. The observation remains after rollback or conflicting evidence. `allowSuspense: false` for A7. A command initially created without an observation cannot later attach one in this implementation.
- The real eligibility and wallet/ledger boundaries lock and recheck active customer, current KYC policy, trusted KYC evidence, manual holds, identity conflicts, verified contact, assessment and account owner. A2/customer sessions and original authorization are not replaceable by request payloads; A4 persisted decision and authoritative sources must remain bound and current. The institutional/provider/obligation resolvers are independent of client assertions. Test implementations are controlled local dependencies, **not** policy approvals or production adapters.
- Generic reversal relies on existing protected workforce sessions/roles, maker/checker separation, request fingerprint, approved action, transactional approval consumption and immutable execution record. Arena 3 owns the shared protected checker-authority boundary: reconcile the existing contract rather than creating a competing authentication/checker system. The new inbound precheck preserves approval and returns conflict; migration 0142 remains defense in depth.

## Migration chain and consolidation hazards

Run the entire existing chain in order, not just the new files. Relevant prerequisite sequence includes `1785753600104`–`0115` (KYC foundation, identity/session/ownership, reconciliation, synthetic registration and authentication/mobile-claim binding), `1785753600116-WalletOwnerClassification`, and `1785753600117-CreateGovernedLedgerReversalExecutions`. Exact file/class names are authoritative; consult `src/migrations`. Added A6/A7 chain:

1. `1785753600140-CreateFinancialCommitments` — persisted commitment, reserve/authorization and operation binding.
2. `1785753600141-BindWithdrawalDestination` — beneficiary/destination evidence binding.
3. `1785753600142-CreateInboundFundingReceipts` — immutable receipt, accounting guards, generic reversal trigger.
4. `1785753600143-RecordVerifiedInboundObservations` — immutable independently verified observation.
5. `1785753600144-CreateA7AuthoritativePersistence` — persisted A7 command/lifecycle and bindings.
6. `1785753600145-AddA7InboundIntendedAmount` — amount binding.
7. `1785753600146-LinkA7InboundExecution` — unique transaction-bound receipt/lifecycle linkage.

Readiness expects 0146 and does not establish provider or policy readiness. Migration numbers were checked against accessible branches when allocated, not against future changes. Arena 3 must recheck collisions and reconcile overlapping migrations and trigger dependencies, ledger/reversal entry points, transaction manager ownership, A2 role/session/approval schema and consumption, eligibility/wallet locks and shared resolver/provider tokens. Also reconcile customer session/consent and A4 audit/decision bindings, provider operation-reference hashes, external settlement lifecycle and idempotency/outbox semantics. Re-run tests after any conflict resolution; do not blindly choose either branch's guard or bypass a constraint.

## Reproduction and results

At application checkpoint, full backend unit run: **240 suites, 2,846 passed / 0 failed**, `/home/user/a7-final-unit2.log`. The 11-suite guarded real PostgreSQL matrix: **11 suites, 169 passed / 0 failed**, `/home/user/a7-final03.log`: A6 lifecycle, A7 authenticated authoritative persistence and lifecycle, financial-effect regression, commitments/initiation/schema, A5 and A2 maker-checker reversals, suspended-customer financial boundary, full migration chain and readiness synchronization. The suspended-customer suite uses a test-only policy and synthetic trusted KYC reader while retaining the actual eligibility checks. The A7 fixtures use controlled independent provider, institution and transaction-bound authority records, real test customer and workforce sessions, and local test A4 policy. They are not live integrations.

`npm run build`, `npx tsc --noEmit --pretty false`, repository-wide `npm run lint`, and `git diff --check` passed. The first expanded matrix `/home/user/a7-final01.log` had five fixture failures caused by missing required eligibility evidence; the fixture was corrected and all five assertions plus the entire matrix rerun successfully. The earlier branch-wide PG attempt had numerous legacy failures before these fixes; **the entire repository PG suite was not rerun and is not claimed passing**. The selected acceptance matrix is not a substitute for consolidation CI across the whole repository.

Commands (from repository root, with dependencies installed):

```sh
node -r ./test/support/mission-25c-network-guard.cjs ./node_modules/jest/bin/jest.js --runInBand
# Only after independently verifying an isolated, disposable local PostgreSQL cluster;
# this harness creates and drops databases. Adapt the port to the verified cluster.
NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=55478 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=a7final03 \
  node -r ./test/support/mission-25c-network-guard.cjs ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.js --runInBand \
  test/a6-settlement-lifecycle.integration.spec.ts \
  test/a7-authoritative-persistence.integration.spec.ts test/a7-product-lifecycle.integration.spec.ts \
  test/a7-product-financial-effect.integration.spec.ts test/financial-commitment-initiation.integration.spec.ts \
  test/financial-commitment-schema.integration.spec.ts test/a5-ledger-reversal.integration.spec.ts \
  test/v1-ledger-reversal-governance.integration.spec.ts \
  test/v1-release-01-production-readiness-migration-sync.integration.spec.ts \
  test/migration-chain.integration.spec.ts test/v1-system-01-suspended-customer-financial-boundary.integration.spec.ts
npm run build
npx tsc --noEmit --pretty false
npm run lint
git diff --check
```

Never point the PG test harness at shared, production or merely assumed-disposable infrastructure. The initial `npm test -- --runInBand` invocation did not run because the script already specifies `--maxWorkers`; the direct guarded command above is the successful full unit invocation. Local `/home/user` logs are workspace artifacts and are not guaranteed to travel with the branch.

## Remaining dependencies and explicit deferrals

Production trusted KYC reader and current approved regulatory/operator eligibility policies; real A7 admission and execution/obligation authority, institutional agreement and approved limits/compliance/consent; independently verified provider observation ingestion and reconciliation; customer-facing A4 decision generation with truthful target/source binding; and operational provider readiness remain unavailable or unapproved. Default unavailable dependencies fail closed. Inbound return, correction, suspense disposition and settled commitment recovery are explicitly deferred; no automated refund, invented return proof, accounting policy or additional product is provided. Consolidation must validate policy governance and shared checker authority before any deployment decision.

## Ordered financial checkpoint sequence

The following is an exact ordered subset, not a replacement for reviewing complete ancestry as explained above:
- `780ec761245851cd6a1c201663ce0bc3777a5549` Harden ledger recovery and bound PostgreSQL regression runs
- `3f611a38f605a2a63aa39cac0f7478ea7f19ddee` Require wallet creation authority for provisioning
- `c331313622f811108e3fed8e2adfcb8d031c345d` Bind external operations to their withdrawal obligations
- `ee7c0eb4f2fac87b28257fdb481ffe5307297aad` Fail readiness while financial dependencies are unverified
- `1fd9260463c6c10f6907be86f8b430d6a1caeb10` Normalize wallet provisioning and restrict inactive agent wallets
- `ead4a83a675249423c12f4f2d587e0d7e4fc8079` Record remaining financial integration blockers
- `413055f094e6b74c6786b7e6146367d586caa5c9` Execute governed ledger reversals atomically
- `fad38fdba1f09bfb9131b39746b3ef695d9dc2e9` Bind settlement evidence to its external operation
- `8f7179ded442f8b4b97f764a6ca480e7bed5bd8f` Keep eligibility dependency outages retryable
- `81793dd7956963c40e823a4f6b2d2d9186fbce43` Roll back product effect reservations on evidence outages
- `ef8af88bdee2ed7c3d949ed6dfc2ef6ef354d028` Make product compensation atomic and require verified failure
- `3d6024e3e57137080c02cff78619682af45678d5` Compose product settlement with its execution transaction
- `f75c88f492bc49b4e06e57b7ab84d99615f69281` Keep unverified settlements in suspense
- `e12b096ae91d665bfdfa9742222c58b6292fbc96` Require independently verified provider settlement outcome
- `966f8f90698b6091e2f59aacdeb3a1a7d3bc685a` Persist financial commitment and authorization evidence
- `2b2a0cf084754af376b328170609482c26e4005c` Reserve authorized withdrawal funds atomically
- `19e787528b5f4e01b3dcbc729a55ae1c68104b32` Checkpoint reserved withdrawal lifecycle integration (not accepted)
- `906e26c25467a9e35c6e69871f9a24c783b23c72` Bind reserved withdrawals to customer beneficiary evidence
- `862fa6111156820a158fc2c161e6e1ab93a81767` Fail closed on inbound effects mapped to withdrawal debit
- `d4c0424c9836af76b4186d2ed66e42e559cba51e` Cover identity-conflict holds on committed withdrawals
- `ddce12b0ebcf7f161fef68dd2ae13c9294268af6` Reject unsupported historical financial-effect replays
- `29f5882d8bbf20f24576bcda67c08ee746d084fa` Add isolated verified inbound receipt prototype
- `515b52abeb79056f77d73f7fa39490f1fac24f74` Migrate A6 PostgreSQL settlement fixtures to real commitments
- `e3124a53f8490d2a6658704363a932888803d3bc` Wire fail-closed customer withdrawal commitment lifecycle
- `262655384a313e960b35365a1a23d8fc2b912ec6` Make inbound receipt boundary transaction composable
- `8ffc45767ef87da14e496e2f1c843d07b4402a5d` Preserve verified inbound evidence for reconciliation
- `342489a940da0bb326ae09780d1d4646d3c1116f` Persist nonfinancial A7 command and lifecycle evidence
- `5a4493711378226184bcc00fe2d4b20875abd037` Harden A7 consumer reads and admission evidence checks
- `1abeaf4b469eb63e601d072f25f64ac42b4eb68d` Add fail-closed governed A7 inbound admission contract
- `59abaed0f5bb4c6eed138af2350e548b7d0d7ee0` Expose authenticated A7 inbound admission lifecycle
- `cf6d584f3a2fd9632d1b5bcfc03e8ac3dbab9270` Bind verified inbound receipt execution to A7 lifecycle
- `799f8849442d2ddaca0f3e17ac219b0e9a5c5321` Harden inbound execution authorization and regression checks
- `bcb33bf787b3ba5cf5127849468b63c8c8c3b250` Migrate A7 financial regressions to authorized fixtures
- `8e4da1a52f066656563b16275cf480c34a263440` Complete controlled A6 A7 reversal and receipt regression coverage
