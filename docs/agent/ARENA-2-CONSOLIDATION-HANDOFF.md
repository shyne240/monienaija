# Arena 2 consolidation handoff

## Checkpoints and scope

- Branch: `arena/ea070127-monienaija`; final application checkpoint: `0472687e04448ab073dd1063185d45dd1e2db8fb`.
- This document is a separate documentation checkpoint, not a request to merge or deploy. Arena 3 owns consolidation; do not blindly merge Arena 1 or Arena 4.
- Cash-Out accepted baseline: `c492c4b1d6a78d7a01a4912176d3a703271e2603`. Cash-to-Cash controlled lifecycle checkpoint: `ac7677a7cd363d89e53cb73c982a3436581d8e07`; cancellation `3bdddbeefe13eafe93640beedec13b1551742a3c`; reconciliation `b9c86c68db1459ca8a97fba1c9e0cc3812ccdc7f`; funding recovery `e8526c291e359f1b34776c8092eff7d7a5947477`; operation handoff `6fd69575ff5c702d96df813eb7af8c9175b7f441`; scoped-lookup containment `8ca013fe103306cdc770d28ad42eb605e0575edb`.
- First-parent source commits in dependency order from the shared pre-work baseline (these are not instructions to cherry-pick blindly):

  `9466cc2`, `f1af1c4`, `44e9198`, `92c071f`, `7ef8305`, `48fa6c5`, `65e2224`, `418116d`, `0fd23a2`, `e2d9c52`, `fbc9b62`, `627f826`, `c492c4b`, `d6ba3c5`, `509f208`, `9e7fe9a`, `8c990d0`, `774e76e`, `bf14362`, `b83996a`, `175d451`, `b1d049f`, `a191933`, `ac7677a`, `3bdddbe`, `b9c86c6`, `be16a35`, `e8526c2`, `6fd6957`, `8f68e2c`, `8ca013f`, `0472687`.

## Migration and integration ordering

Preserve existing migration identities and apply in order: `0120` challenge attempts; `0130` execution evidence; `0131` OTP budgets; `0132` cash-out intents; `0200` cash-out handoffs; `0201` claim challenge bindings; `0202` cash-to-cash funding evidence; `0203` cancellation evidence; `0204` transfer handoffs; `0205` operation-key handoffs. Existing locator migration `0096`, KYC/authentication migrations through `0116`, and preceding schema are prerequisites. `0201`–`0205` are forward-only evidence migrations; their down methods intentionally refuse to discard evidence. Do not fabricate authorization or backfill historical funding evidence.

The local readiness head and registry are `CashToCashOperationHandoffs1785753600205`. Arena 4 commit `684271e9d972edc629d629b73e66cd719d759117` contains institution migrations `0400` and `0401` plus other migrations `0117`/`0118`; a consolidated migration registry and readiness marker must reflect the **actual final combined chain**, not retain `0205` by assumption. Rescan all current remote inventories and resolve collisions/dependencies before integration. Arena 4's institutional objects must exist before binding its production services. Do not create a parallel institution schema.

## Contracts and expected integration conflicts

- `CashToCashFundingAuthority.require` and `CashToCashClaimFinancialContext.resolve` are intentionally unavailable in production until trusted policy, identity, KYC, institutional affiliation and wallet isolation are wired. `CashToCashWorkforceScope.assertCanAccessInstitution` intentionally returns 503. Arena 4's `InstitutionWorkforceScopeService` checks a current active assignment or the explicit `institution.attribution.view` function; integrate its authoritative service and catalogue grant, while retaining `reconciliation.view` and fail-closed absence. The test's explicit platform function and institution assignment are controlled fixture configuration, **not** a deployed grant.
- Institutional context must come from manager-bound authoritative records, not client institution IDs, default institutions, aggregator identity or a fallback. Account for transaction/row-lock semantics, lifecycle/status changes and concurrent revocation. Coordinate with Arena 1 on eligibility and financial commitments: its A6 commitment addresses customer outbound withdrawal, not agent-funded cash-to-cash. Funding here debits agent float and credits unclaimed liability; customer-wallet claim is a separate existing redemption mode.
- Expect conflicts in shared `agent.module`, MFA challenge/desk OTP controller and DTO, authorization route policy and role catalogue, institution resolver, ledger and KYC gates, mobile auth/storage/navigation, migration registry/readiness and PG fixtures. Preserve existing Cash-Out evidence, replay/budget/intent and authorization semantics. The locator MFA request now accepts `{senderPhone, transferNumber, redemptionMethod}` and resolves the transfer using the existing protected locator budget before binding the challenge; it does not trust a caller-provided institution. UUID-mode requests retain the existing transfer-ID path.
- Mobile claim recovery saves the agent-scoped non-secret locator, beneficiary/customer identity, payout method and original idempotency key before submission. It does not save OTP, PIN or raw transfer code. Recovery is read-only, retains an unresolved outcome on 404 or unavailable authority, and retains the pending identity until the receipt is acknowledged. The six-digit transfer number is the locator, not the separate raw transfer code. Older volatile or invalid-key native records may already be lost and cannot be reconstructed. Scope remains bound to the original authenticated agent; a different agent does not get the receipt.
- Transfer-ID and operation-key handoffs are evidence-only and immutable/deduplicated. An operation-key handoff can remain UNKNOWN with no transfer ID. Historical transfers lacking funding evidence remain unscoped/review-only, not assigned an invented institution. Cancellation and expiry preserve the funded obligation and do not automatically release it. Claim recovery uses immutable claim/audit evidence and does not submit another claim or consume another OTP.

## Final controlled acceptance at `0472687`

All commands below were run sequentially and exited 0; no forced worker exit was reported. The PG server was stopped with `pg_ctl -m fast stop` (exit 0). Logs were temporary workspace artifacts, not committed.

| Check | Result |
| --- | --- |
| Backend `npm test` | 243 suites, 2,852 tests passed |
| Isolated PostgreSQL/Fastify suite | 1 suite, 15 tests passed; includes Cash-Out financial/OTP regression, wallet and agent-cash claim, authenticated HTTP, workforce scope, mobile client recovery and staged upgrade |
| Agent mobile `npm test` | 20 suites, 310 tests passed |
| `npm run build`, `npm run lint`, `git diff --check` | passed |
| Agent mobile `npx tsc --noEmit` | passed |

Root ESLint covers `{src,test}/**/*.ts`; the agent mobile package has no lint script. Backend build performs TypeScript compilation. The historical test starts at `0201`, seeds synthetic balanced journal lines, outstanding and claimed transfers, claim audit and Cash-Out handoff, applies each migration `0202`–`0205` separately, introduces cancellation evidence after `0203` and transfer handoff after `0204`, and compares the preserved records at later steps. It verifies no invented funding evidence, `showMigrations() === false`, and the `0205` readiness marker. Reconciliation status in that readiness test is a controlled stub, not a production reconciliation certification.

The mobile real-client fixture bridges `fetch` to the real Fastify app and real disposable PostgreSQL. It issues one bound challenge, commits one claim, drops the successful HTTP response, reconstructs the mobile pending-operation module against a shared mock native secure store, logs out, reauthenticates, rejects another agent's lookup, and recovers the original journal and idempotency key without a second redemption or OTP. This simulates a JavaScript restart and native adapter, **not** an actual emulator/device process kill or native keychain test. UI tests separately exercise recovery/UNKNOWN blocking and acknowledgement. No live provider or real customer data was used; SMS was the in-memory test provider.

The workforce fixture uses persisted workforce sessions and real route-function checks. It controls institution assignment and injects the explicitly named platform function into fixture configuration; it does not establish production Arena 4 integration. Both transfer and operation lookups are tested for same-institution/platform access, cross-institution denial, missing reconciliation function and unavailable authority, and an operation without transfer ID remains UNKNOWN. The production default remains unavailable.

## Reproduction (disposable synthetic PG only)

Install pinned dependencies with `npm ci` at root and in `apps/agent-mobile`. The isolated suite refuses any PostgreSQL server unless it is PG 16, has no TCP listener, uses port 55461 and matches the disposable datadir/socket names below. In a clean sandbox, one way to provision it is:

```sh
mkdir -p /tmp/pg16 && cd /tmp/pg16
npm pack @embedded-postgres/linux-x64@16.14.0-beta.17 --silent
tar -xzf embedded-postgres-linux-x64-16.14.0-beta.17.tgz
cd package && node scripts/hydrate-symlinks.js
mkdir -p /home/user/kyc-batch1-pg-bound /home/user/m25c-isolated-pgsocket/kyc-batch1-bound
export LD_LIBRARY_PATH=/tmp/pg16/package/native/lib
/tmp/pg16/package/native/bin/initdb -D /home/user/kyc-batch1-pg-bound -U kyc_synthetic -A trust
/tmp/pg16/package/native/bin/pg_ctl -D /home/user/kyc-batch1-pg-bound -l /home/user/finish-pg.log -o "-k /home/user/m25c-isolated-pgsocket/kyc-batch1-bound -p 55461 -c listen_addresses=''" start
cd /home/user/monienaija
KYC_ISOLATED_TEST_SOCKET=/home/user/m25c-isolated-pgsocket/kyc-batch1-bound DB_HOST=/home/user/m25c-isolated-pgsocket/kyc-batch1-bound DB_PORT=55461 DB_NAME=postgres DB_USER=kyc_synthetic DB_PASSWORD=synthetic node -r ./test/support/mission-25c-network-guard.cjs ./node_modules/jest/bin/jest.js --testRegex='\.isolated-pg\.test\.ts$' --runInBand --runTestsByPath test/batch2c-eligibility.isolated-pg.test.ts
npm test
npm run build
npm run lint
(cd apps/agent-mobile && npx tsc --noEmit && npm test)
git diff --check
/tmp/pg16/package/native/bin/pg_ctl -D /home/user/kyc-batch1-pg-bound -m fast stop
```

Use a fresh disposable directory for `initdb`; never point this fixture at a shared or real database. The example password is synthetic and the socket is local-only.

## Outstanding policy and operational dependencies

Production institutional funding, claim, recovery and workforce authorization remain fail-closed pending genuinely approved authority and Arena 3 integration. Lost-code replacement and cancellation permissions require independent approved policy; no replacement code is generated here. Financial disposition of cancelled/expired obligations requires independent policy and accounting design; no automatic refund, balance restoration, release or adjudication is implemented. Provider activation, approved messaging, real operational procedures, device accessibility/visual acceptance and native process-restart testing are outside this controlled evidence. No main merge, deployment, live provider call or real financial transaction was performed.

The restored pre-checkpoint workspace was preserved in a Git stash named `Preserve restored workspace before finish and freeze` (large unrelated modifications); do not blindly apply it over the accepted branch. Consolidation should inspect and selectively reconcile any genuinely relevant changes.
