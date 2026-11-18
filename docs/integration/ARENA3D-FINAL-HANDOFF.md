# ARENA 3D — final handoff

Group 40. What a successor needs: the state of the tree, where every piece of evidence lives, the decisions nobody
but the product owner can make, and the exact next actions in order.

Read with: `ARENA3D-CONSOLIDATED-ACCEPTANCE.md` (the verdict), `ARENA3D-PRODUCTION-READINESS-CONTINUATION-RECORD.md`
(the per-group record) and `CONSOLIDATED-ACCEPTANCE-MATRIX.md` (the requirement table).

## 1. State of the repository

| Item              | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Branch            | `arena/defdd0fd-monienaija`                                          |
| Working tree      | clean                                                                |
| Unit suite        | **3343 tests, 282 suites, all passing**                              |
| Type check / lint | clean (0 errors; 5 pre-existing warnings in `test/`)                 |
| Formatting        | clean                                                                |
| Journeys          | 10/10, 263 assertions, real PostgreSQL                               |
| Browser           | 27/27, Chromium/Blink 153, production bundle                         |
| Release gate      | **`NOT_READY` — 16 blockers, 4 conditions, exit code 1**             |
| Release blockers  | 8 unverified financial dependencies + 8 unprovable-here capabilities |

There is no upstream. Push with `git push origin arena/defdd0fd-monienaija`.

## 2. Evidence index

**Runbooks and reports** (`docs/integration/`):

| Document                                                                              | Covers                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `ARENA3D-PRODUCTION-READINESS-CONTINUATION-RECORD.md`                                 | the per-group record, the primary document                    |
| `ARENA3D-CONSOLIDATED-ACCEPTANCE.md`                                                  | the mission verdict, the five defects acceptance found        |
| `CONSOLIDATED-ACCEPTANCE-MATRIX.md`                                                   | executed / recorded / unavailable, requirement by requirement |
| `CI-AND-DEPLOYMENT-GATES.md`                                                          | the seven CI jobs and why each exists                         |
| `POSTGRESQL-ACCEPTANCE.md`                                                            | the integration matrix and the eleven unclaimed suites        |
| `SANDBOX-INTEGRATION-READINESS.md`                                                    | what a real boot proves, and why it refuses                   |
| `BROWSER-ACCEPTANCE.md`                                                               | the admin console in a real engine                            |
| `MOBILE-RELEASE-READINESS.md`                                                         | the two manifests and the two release decisions               |
| `RELEASE-READINESS-GATE.md`                                                           | the gate's rules and the 16 blockers                          |
| `PLATFORM-JOURNEYS.md`                                                                | journeys A–J and what each one refuses to allow               |
| `WORKER-EXECUTION.md`                                                                 | `PROCESS_ROLE` and the mechanism's limits                     |
| `ALERTING.md`                                                                         | evaluation, suppression, and the signed webhook               |
| `PRIVACY-AND-RETENTION.md`, `PERFORMANCE-ACCEPTANCE.md`, `OPERATIONAL-SECURITY.md`, … | the earlier operational areas                                 |

**Machine-readable evidence**:

| Artefact                                                            | Produced by                                   |
| ------------------------------------------------------------------- | --------------------------------------------- |
| `evidence/consolidated/consolidated-run.json`                       | `node scripts/run-consolidated-acceptance.js` |
| `evidence/journeys/journey-results.json`                            | `npm run acceptance:journeys`                 |
| `evidence/browser-acceptance/browser-acceptance.json` + screenshots | `npm run acceptance:browser:admin`            |

**The two executable gates** — both fail loudly rather than reporting green:

```bash
npm run gate:release          # NOT_READY, 16 blockers, exit 1
node scripts/run-consolidated-acceptance.js   # 21 requirements, 0 failing, on a clean tree
```

## 3. Decisions only the product owner can make

None of these may be answered by invention, and each is why a corresponding blocker exists.

| #   | Decision                                                                                     | Options / shape                                                                        | Blocks                |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------- |
| 1   | Which KYC provider is trusted, and its activation evidence                                   | provider selection + activation record + consent notice text and version               | 3 financial blockers  |
| 2   | Identity key versions and the effective KYC policy                                           | key store of record; policy document and version                                       | 2 financial blockers  |
| 3   | Provider governance and routing; wallet ownership governance; institution tier limits        | who may be routed to which provider, which entity owns which wallet, which tiers apply | 3 financial blockers  |
| 4   | Version scheme for the two mobile apps, and their `runtimeVersion` / OTA policy              | independent semver per app vs shared version; OTA on/off and its scoping               | 2 of the 4 conditions |
| 5   | Whether either app has already been submitted (this fixes the next build number)             | submission history                                                                     | mobile submission     |
| 6   | Alert channel, escalation policy, on-call rotation and evaluation cadence                    | paging provider, severity → channel mapping, who is on call, how often alerts run      | alert delivery        |
| 7   | Worker topology: replica count, and the liveness probe for a process with no HTTP listener   | sidecar probe, process supervisor, or orchestrator job                                 | worker execution      |
| 8   | Recovery objectives: RPO/RTO targets, off-site storage, encryption at rest, retention, PITR  | numbers, not adjectives                                                                | measured DR           |
| 9   | Secret-manager backend of record (the contract exists; the environment backend satisfies it) | vendor or platform store                                                               | operations            |
| 10  | Support floor for the build register, and whether an anonymous metrics scrape path may exist | release policy; security posture                                                       | support, monitoring   |

## 4. Exact next actions

In order. Each is small and verifiable; none requires re-reading the mission.

1. **Verify the eight financial dependencies.** Each is a named constant in
   `src/production/production-readiness.service.ts`. Verifying one is a reviewed edit to that list, and the release
   gate moves with it in the same commit. Until then the application refuses to start — correctly.
2. **Decide #4 and #5**, then edit `apps/*/app.json` (version, `runtimeVersion`, next build number). The mobile
   check already fails on an unregisterable value and warns on the two current gaps.
3. **Configure a real alert destination** (`ALERT_WEBHOOK_URL` + `ALERT_WEBHOOK_SECRET`), then deliver one synthetic
   alert to it and record the receipt. A half-configured webhook throws at startup by design.
4. **Choose the worker topology (#7)** and, once an orchestrator exists, run `PROCESS_ROLE=worker` and observe it
   executing for longer than one poll interval. That observation is what removes the blocker — not the code.
5. **Build the container once** and record the digest. The build job exists and is unexecuted here.
6. **Deploy to staging**, then re-run the consolidated matrix from inside that deployment.
7. **Attempt a restore at production volume** and record measured RPO/RTO.
8. **Re-run `npm run gate:release`.** It should still say `NOT_READY` until steps 1–7 are done; when it says
   `READY`, that sentence will have been earned.

## 5. What a successor must not do

- **Do not weaken the startup gate.** A flag that skips readiness in development skips it in production. The eight
  blockers are the list of things nobody has verified, not a nuisance.
- **Do not make the release gate return `READY` by editing the gate.** The only route is verifying the thing, in
  review. The suite asserts the module reads no `process.env` and contains no bypass-named identifier.
- **Do not mark `unavailable` as `PASS` in the matrix.** That row exists because the alternative was a claim.
- **Do not "fix" a failing journey by deleting its suite.** A missing or unrun suite fails the journey by design.
- **Do not treat a configured CI job as a passing one.** Group 35's teardown defect was red in CI while the CI gate
  correctly reported the job present. Executing is the evidence; configuration is the intent.
- **Do not add a scheduler, leader election or second ownership layer** to make workers "more reliable". The
  database leases, fencing and idempotency are the authority; a role decides whether drivers start, nothing more.
- **Do not re-generate `docs/integration/ENVIRONMENT-CONFIGURATION-INVENTORY.md`** casually — it is asserted by a
  completeness test against the environment schema.

## 6. Re-running the gates

```bash
npx tsc --noEmit -p tsconfig.json          # types
npm run lint                                # lint:src + lint:test (split: a whole-repo run OOMs here)
npm run format:check                        # formatting
npm test                                    # 3343 unit tests
npm run gate:release                        # NOT_READY, 16 blockers

# integration (needs a disposable cluster)
PG_TEST_RUN_ID=<id> PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
DB_HOST=… DB_PORT=… DB_USER=… DB_PASSWORD=… npm run test:pg

# journeys (subset with --only A,F)
PG_TEST_RUN_ID=<id> PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
DB_HOST=… DB_PORT=… DB_USER=… DB_PASSWORD=… npm run acceptance:journeys

# browser (needs a Chromium binary and a production bundle)
cd apps/admin-web && ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build --outDir /tmp/dist && cd -
npm run acceptance:browser:admin -- --dist /tmp/dist --executable <chromium> --lib-path <libs>

# everything that can run here, on a clean tree
node scripts/run-consolidated-acceptance.js
```

## 7. Honest closing statement

The mission's engineering scope is complete and gated. The platform holds boundaries that a financial system must
hold — institution attribution, two-person control, no auto-adjusting reconciliation, erasure that keeps the ledger
— and it proves them by executing, not by describing.

What it does not have is readiness, and the record says so in sixteen named places rather than one apologetic
paragraph. The difference between those two sentences is the work this mission was actually able to do.
