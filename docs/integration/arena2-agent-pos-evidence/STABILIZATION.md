# PR #5 stabilization and acceptance

Acceptance baseline: `arena/5-main-web-integration` at `f8d5105af83bc64db4e8308df5944b116f5488bc`. The baseline adds two documentation changes since the common parent `380fbcdf98425f19d5d9dabd27184d30bdc06098`; `git merge-tree --write-tree FETCH_HEAD HEAD` verified compatibility without merging. The baseline and PR CI runs below refer to the exact compared revisions, not to a subsequent re-run.

## Pre-existing CI failures

| Check | Integration baseline | PR #5 delivery | Reproduction / result |
| --- | --- | --- | --- |
| Backend lint | [Job](https://github.com/shyne240/monienaija/actions/runs/44822888911/job/136588140236) | [Job](https://github.com/shyne240/monienaija/actions/runs/44825338691/job/136596516343) | `npm ci && npm run lint` from the repository root. Both local runs exited 1 with the same 16 errors in `src/banking/bank-beneficiary.controller.ts` and `src/banking/bank-beneficiary-creation.service.ts` after normalizing checkout paths. CI annotations match. CI stops at lint; this job does not establish format, build or unit-test status. |
| Agent Mobile types | [Job](https://github.com/shyne240/monienaija/actions/runs/44822888911/job/136588139910) | [Job](https://github.com/shyne240/monienaija/actions/runs/44825338691/job/136596516615) | In `apps/agent-mobile`, `npm ci && npm run ts:check -- --noEmit`. Both local runs exited 2 with identical TS1323 (`BankWithdrawalScreen.tsx:56`) and TS2367 (`HomeScreen.tsx:288`). CI annotations match. |
| Backend container | [Job](https://github.com/shyne240/monienaija/actions/runs/44822888911/job/136588139932) | [Job](https://github.com/shyne240/monienaija/actions/runs/44825338691/job/136596516266) | `docker buildx build -f Dockerfile -t monienaija-backend:ci .` with an available Docker/Buildx environment. In CI, Buildx cannot resolve `docker.io/library/node:22.22.3-alpine3.20`. Same resolver message and unchanged Dockerfile/workflow; Docker was not available locally. |

For a local comparison without changing branches, use `git archive <revision> | tar -x -C <empty-directory>` for each revision and run the commands above with the same Node and lockfiles. The PR has no changes under `src/banking`, `apps/agent-mobile`, `.github/workflows` or the Dockerfile. Leave remediation to the owners of those surfaces.

## Focused acceptance changes

- The drawer ignores late receiving-number responses after Agent selection or lifecycle changes and rejects a response bearing a different Agent ID.
- Estate loading rejects terminals whose parent is missing from the selected Agent's outlet list. Refreshing after a selected parent becomes ineligible no longer silently points an in-progress terminal draft at another outlet.
- PostgreSQL integration tests assert that a workforce principal without `agent.view` cannot list or open an Agent, an authorized reader sees the same safe projection off-page but cannot suspend the Agent, and a mismatched terminal URL/body parent cannot create a terminal under either Agent. The positive test verifies the persisted assignment through the read endpoints.
- The existing financial capability, maker/checker, class/limit catalogue and aggregator contracts were not changed. See the [scope and ownership handoff](README.md).

## Fresh local acceptance evidence

- **Admin Web:** `npm run ts:check -- --noEmit`, `npm test -- --runInBand --testTimeout=20000` and `npm run build` from `apps/admin-web`. Typecheck and build passed; **88 suites / 893 tests passed**. The Vite build emitted a chunk-size warning only.
- **Backend on disposable PostgreSQL 18.7:** **4 suites / 85 tests passed**, including authorization and ownership checks, Agent lifecycle, real cash-in class denial and bank-commitment history. From the root, with `NODE_ENV=test`, a unique `PG_TEST_RUN_ID`, `PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes`, loopback disposable `DB_*` and the existing test environment, run:

  ```sh
  A2_WORKFORCE_ENABLED=true \
  NODE_OPTIONS="--require=$PWD/test/support/mission-25c-network-guard.cjs" \
  npx jest --config jest.integration.config.js --runInBand \
    test/a22-admin-foundation.integration.spec.ts \
    test/a20-outlets-terminals.integration.spec.ts \
    test/a13-agent-cash-in.integration.spec.ts \
    test/agent-bank-transfer-commitment.integration.spec.ts
  ```

  The A22 API tests deliberately use a test workforce session provider with permissions from the real role catalogue; they are authorization coverage, not login coverage.
- **Real-backend browser run:** A disposable run connected Playwright/Chromium → Vite `/api/v1` proxy → Nest `AppModule`/Fastify → migrated PostgreSQL. A temporary administrator was seeded using the existing local-development seeder, then signed in from the browser through normal local-workforce authentication. No API interception, session stub, forced browser auth state, or production identity provider. The test substituted the disposable data source and a test notification provider; its Agent class and all input values were fixtures. It verified submission → review → approval → activation, status and exact-ID directory search, direct opening from the application queue with the Agent excluded from the directory, outlet creation, terminal creation with explicit outlet assignment, outlet inspection, both transfer history filters (valid empty responses), and Agent suspension/reactivation. A PostgreSQL query separately confirmed the terminal's persisted Agent ID and outlet ID. No browser exceptions. The run did not exercise production SSO, nonempty history in the browser, hardware, or money movement. Independent API suites cover history records and the estate's remaining lifecycle transitions. The original screenshots in [README.md](README.md) remain **synthetic API** evidence, not screenshots from this run.

## Arena 5 integration checklist

- [x] Reconcile the PR diff against the approved Agent Network / POS administration scope; no frozen, shell, mobile, or production settings changes.
- [x] Compare failures with the latest inspected integration baseline and verify a conflict-free prospective merge.
- [x] Confirm the operator journey on a disposable real backend and keep fixture-based evidence separate.
- [ ] Establish green required checks, or have Arena 5 explicitly accept the documented baseline failures under its merge policy. Confirm the full PostgreSQL CI result on the review SHA.
- [ ] Keep the Arena 3 handoff explicit: persisted class UUID and `AGENT` limits are the existing contracts; directory/estate aggregator relationships do not authorize commissions.
- [ ] Arena 5 owns the merge decision. Vendor provisioning, heartbeat and POS payments are not part of acceptance.

**Recommendation: NOT READY to merge under normal CI gates.** Arena 2 acceptance passed locally and no PR-specific CI cause was found in the compared failures. Resolve or explicitly disposition the baseline failures and review the full PostgreSQL CI result before merging.
