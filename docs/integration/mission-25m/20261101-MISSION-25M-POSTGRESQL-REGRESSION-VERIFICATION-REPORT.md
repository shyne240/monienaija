# MISSION 25M — POSTGRESQL REGRESSION VERIFICATION AND ACCEPTANCE EVIDENCE

**Arena 3 · verification-only mission · 2026-11-01 (Africa/Lagos)**

Resolves the verification limitation Arena 4 recorded in Mission 25L: its full PostgreSQL
integration run did not complete, so a sprint-3 history/workforce timeout remained unverified.

- **Verdict: PASS — FULL POSTGRESQL REGRESSION VERIFIED** (§1)
- Evidence branch: `evidence/mission-25m-postgresql-regression`
- All 132 PostgreSQL integration suites / 2,452 tests completed, 0 failed, 0 skipped, overall exit 0.
- The sprint-3 timeout was investigated and **not reproduced**; measured cause is harness
  resource-sensitivity, **not an application defect** (§7).
- **No application code was modified** (§9).

---

## 1. Verdict

**PASS — FULL POSTGRESQL REGRESSION VERIFIED**

All required PostgreSQL tests completed successfully (132/132 suites, 2,452/2,452 tests, nine of
nine batch processes exit 0, overall exit 0), the sprint-3 issue was satisfactorily investigated
with measurement rather than assertion, and **no application defect or regression was identified**.

I do not claim Arena 4 acceptance. Two facts that bound this verdict honestly are stated in §11:
the 120 s failure itself was not reproduced on this host, and the sprint-3 suite — while passing —
is not the load-bearing evidence for customer-preference security or audit history, which is
carried by other suites (§7.4).

---

## 2. Exact pinned candidate SHA

| Item | SHA |
| --- | --- |
| Mission 25K integration branch | `integration/mission-25k-frontend-security-alignment` |
| **Pinned code candidate** | **`587c3763944368b9260c9299d18bce1189ca5919`** |
| Evidence-only branch tip at mission start | `21b1827fee1139e8ed49f237fd5b230f7712546f` |
| **Mission 25M evidence commit** | the commit that ADDED this report — `git log --diff-filter=A --format=%H -- docs/integration/mission-25m/*REPORT.md`; earlier commits on the same path cannot change that answer |
| Evidence branch tip | read fresh with `git ls-remote origin refs/heads/evidence/mission-25m-postgresql-regression` (each later docs commit advances it; every one is documentation-only) |

**Code identity verified**: `git diff --name-only 587c376 21b1827 -- src apps test scripts` → **0
files**. The trees differ only because `21b1827` carries committed documentation/evidence under
`docs/integration/mission-25k/`. The application under test is byte-identical to the pinned
candidate.

One transcription note: the assignment quoted the tip as
`21b1827fee113e8ed49f237fd5b230f7712546f` (39 characters). The remote resolves unambiguously to the
40-character `21b1827fee1139e8ed49f237fd5b230f7712546f` — a one-digit slip in the brief, not a
branch discrepancy. Both the pinned code candidate and the 25K branch tip are otherwise exactly as
declared.

Evidence: `evidence/01-candidate-verification.txt`.

---

## 3. Environment details

| | |
| --- | --- |
| Host | Linux 6.1.158+, **2 vCPU, 3,939 MB RAM** |
| Node | v22.22.3 |
| Jest | 30.1.3 |
| TypeScript | 5.9.3 |
| PostgreSQL | **embedded 18.4** (`@embedded-postgres/linux-x64`), disposable data directory |
| Database lifecycle | initialised per mission, destroyed afterwards; no persistent or shared instance |
| Application data | synthetic fixtures only; no production data, credential or endpoint touched |
| Notification transport | local/fake only; **no external provider activated, no live SMS/email** |

The host is the same constrained 2 vCPU / ~3.9 GB class documented in earlier missions, which is
why `PG_TEST_CONCURRENCY=1` was used.

---

## 4. PostgreSQL version and configuration

    server_version                  18.4
    shared_buffers                  16384 (8kB) = 128 MB
    work_mem                        4096 kB
    max_connections                 100
    max_worker_processes            8
    fsync                           on
    synchronous_commit              on
    default_transaction_isolation   read committed

Isolation model per run: every database name is namespaced by `PG_TEST_RUN_ID`; each batch process
builds its own `mn_it_tpl_<runId>_<pid>` template database by executing the full **102-migration
chain** once, then clones it per suite. Cleanup is namespace-scoped and cannot touch a foreign
database.

---

## 5. Test orchestration commands

Discovery and execution exactly as the repository intends:

```bash
# discovery — the count this mission must account for
npx jest --config jest.integration.config.js --listTests | wc -l     # -> 132

# the matrix, as specified
PG_TEST_CONCURRENCY=1 node scripts/run-pg-integration-tests.js

# Phase C focused integration batch
PG_TEST_RUN_ID=phasec node scripts/run-pg-integration-tests.js <15 focused files>

# Phase C focused unit batch
npx jest --config jest.config.js test/mission-25g-customer-preference-policy.spec.ts \
  test/notification-provider-config.unit.spec.ts \
  test/notification-reliability.unit.spec.ts test/customer-preference.service.spec.ts

# Phase C verbose re-run of the two load-bearing suites
npx jest --config jest.integration.config.js --runInBand --verbose \
  test/mission-25g-customer-preference-authorization.integration.spec.ts \
  test/v1-sprint3-agent-history-workforce.integration.spec.ts
```

Effective Jest settings: `testTimeout: 120000`, `maxWorkers: 1`, `--runInBand` per batch,
`PG_TEST_BATCH_SIZE=15` → 9 batches, each a fresh node process.

---

## 6. Final suite and test counts

| Metric | Value |
| --- | --- |
| Suites discovered | **132** |
| Suites executed | **132** |
| Suites passed | **132** |
| Suites failed | **0** |
| Tests passed | **2,452** |
| Tests failed | **0** |
| Tests skipped | **0** |
| Retries | none |
| Isolated reruns forced by the matrix | none (no failure occurred) |
| Resource interruptions | none — no `Exceeded timeout`, no heap OOM, no interrupted run |
| Duration | **43 m 35 s** (2026-11-01T20:38:54Z → 21:22:29Z) |
| **Overall exit status** | **0** |

### Exit code of every batch

| Batch | Files | Suites | Tests | Exit |
| --- | --- | --- | --- | --- |
| 1/9 | 15 | 15/15 | 646 | **0** |
| 2/9 | 15 | 15/15 | 282 | **0** |
| 3/9 | 15 | 15/15 | 314 | **0** |
| 4/9 | 15 | 15/15 | 279 | **0** |
| 5/9 | 15 | 15/15 | 267 | **0** |
| 6/9 | 15 | 15/15 | 178 | **0** |
| 7/9 | 15 | 15/15 | 225 | **0** |
| 8/9 | 15 | 15/15 | 149 | **0** |
| 9/9 | 12 | 12/12 | 112 | **0** |
| **Σ** | **132** | **132/132** | **2,452** | **0** |

The aggregate (132 suites / 2,452 tests) is **identical to the count Mission 25K reported**; only
the per-batch distribution shifts, because `--listTests` ordering is not a stable contract. The
sum is invariant, which is the property that matters for comparison.

No partial output was accepted as a pass: the run was taken to process exit, and the overall exit
code (`PG_MATRIX_EXIT=0`) plus nine per-batch exit codes were all read from the orchestration's own
output.

---

## 7. Sprint-3 timeout investigation (Phase A)

### 7.1 Exact file and case
`test/v1-sprint3-agent-history-workforce.integration.spec.ts` — 13 test cases in two blocks:
`GET /api/v1/internal/agents/:id/transactions` (V1-SPRINT3-AGENT-HISTORY-API-01, 7 cases) and
`V1-SPRINT3-GUARD-01` declared-gate enforcement (6 cases). The relevant ceiling is
`testTimeout: 120000` from `jest.integration.config.js`.

### 7.2 Reproducible? **No.**

| Condition | Runs | Outcome | Suite time |
| --- | --- | --- | --- |
| In isolation | 3 | 13/13 pass, exit 0 | 8.80 / 7.75 / 8.41 s |
| 3 concurrent instances | 3 | 13/13 pass, exit 0 | ~32 s each |
| Orchestrated concurrency 2, 6 files | 1 | 3/3 batches exit 0, 105 tests, 0 timeouts | — |
| 2.6 GB memory pressure | 2 | 13/13 pass, exit 0, **0 timeouts** | 300.5 s, 432.9 s |
| **Full matrix, concurrency 1** | 1 | **PASS, batch 9/9** | — |

Individual assertions in isolation: median ~40 ms, max 198 ms — three orders of magnitude below the
120 s ceiling.

### 7.3 Cause: harness setup, not product code

Jest's JSON reporter decomposes the suite exactly:

| Condition | Suite wall | `beforeAll` | Assertions |
| --- | --- | --- | --- |
| Normal | 8.8 s | ~7.9 s (90%) | **0.908 s** |
| 2.6 GB memory pressure | 432.9 s | **431.5 s (99.7%)** | **0.870 s** |

Application-code execution time is **invariant** (0.908 s → 0.870 s). Every second of the 49×
slowdown sits in `beforeAll`, which calls `createIntegrationDataSource()` →
`ensureMigrationTemplateDatabase()`: build `mn_it_tpl_<runId>_<pid>` by running the **full
102-migration chain**, then clone it per suite.

**The decisive control.** A trivial suite whose `beforeAll` does the same template build and whose
single test takes 925 ms — `test/v1-harden-01-support-provision-race.integration.spec.ts` — under
identical memory pressure:

    beforeAll 747,313 ms    assertions 925 ms    suite wall 748,791 ms    exit 0

It was **slower than the sprint-3 suite** (747 s vs 431 s). The blow-up is therefore a property of
the shared harness setup under resource starvation, entirely independent of the sprint-3 file.

Supporting measurement: per-process fixed cost (Jest start + ts-jest compile + template build) is
**~13.6 s**, derived from three runs of two small suites (15.15 s alone, 18.18 s alone, 19.69 s
together ⇒ marginal 1.5 s + 4.5 s). Running the 102-migration chain once through
`typeorm-ts-node-commonjs` took 39.1 s (upper bound — includes TypeScript compilation).

Classification: **test-harness / resource-exhaustion sensitivity** — not a product defect, not
suite-specific logic, and not database contention in itself (isolation and 3× concurrency both pass
cleanly). Because `120 s` is exactly `testTimeout`, any host on which this shared setup crosses
120 s fails the whole suite at once, before a single assertion executes — which matches the
reported symptom precisely.

### 7.4 Blast radius had it timed out

- **Customer-preference security — not affected at all.** The suite contains no preference
  assertion. That surface is covered by `mission-25g-customer-preference-authorization`
  (19 assertions) and `mission-25g-customer-preference-policy`.
- **Audit history — not affected.** Covered by the 25G authorization suite
  ("keeps preference audit/history out of workforce audit projections while preserving the records
  and unrelated audit") and `v1-admin-full-surface-audit-01-auth-propagation`.
- **Workforce authorization — partially.** V1-SPRINT3-GUARD-01 exercises declared-gate enforcement,
  which is independently covered by 8+ other integration suites.
- **Ordinary Agent V1 — partially.** The agent history read is also covered by
  `v1-agent-history-01`, `mission-16a-agent-read-authorization`,
  `v1-agent-receiving-number-authorization`, `v1-hardening-07-admin-agent-financial-position`.

`ledger`/`wallet` appear in the suite only as fixture construction (creating a c2c journal to read
back), not as financial-control assertions.

### 7.5 In isolation and in the matrix

**Both.** 3/3 isolated runs pass 13/13; and `PASS test/v1-sprint3-agent-history-workforce.integration.spec.ts`
inside batch 9/9 of the full matrix, whose batch and overall exit codes were 0.

**No defect found ⇒ nothing escalated for implementation.**

---

## 8. Phase C — focused security and regression checks

All executed independently in this mission, against the pinned candidate, on disposable databases.

| Requirement | Covering suite | Result |
| --- | --- | --- |
| Customer-preference authorization | `mission-25g-customer-preference-authorization.integration.spec.ts` (19), `mission-25g-customer-preference-policy.spec.ts` (12), `customer-preference.service.spec.ts` | pass |
| Cross-customer access denial | "denies cross-customer and anonymous reads/history and writes without changing preference data" | pass |
| **All 11 workforce roles** | Each role named explicitly: SUPER_ADMIN, FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR, ADMINISTRATOR, OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY — each denied on reads, history, HEAD, POST and PATCH without business mutation | 11/11 pass |
| Audit-actor spoofing | "attributes spoofed and omitted actors to the real session"; "preserves legacy history and audit rows without rewriting their historical actor" | pass |
| Generic audit disclosure restrictions | "keeps preference audit/history out of workforce audit projections…"; "keeps approved workforce customer profile access distinct from preferences" | pass |
| Sprint-3 history/workforce | `v1-sprint3-agent-history-workforce.integration.spec.ts` | 13/13 pass (also in matrix) |
| Agent authentication / authorization | `mission-15a-agent-sessions`, `mission-16a-agent-read-authorization`, `phase1-agent-security`, `v1-agent-history-01` | pass |
| Financial ledger / settlement controls | `a5-ledger-reversal`, `a6-settlement-lifecycle`, `v1-ledger-reversal-governance` | pass |
| Notification fail-closed behaviour | `notification-provider-config.unit`, `notification-reliability.unit` + `.integration`, `notification-registry.integration`, `v1-005-notification-delivery` | pass |
| Support-message recipient binding | `v1-007-support-ticket`, `v1-customer-09-support-workforce-boundary`, `v1-harden-01-support-adversarial` | pass |

Focused batches: **15 suites / 257 tests, exit 0** (integration, 254 s) and **4 suites / 38 tests,
exit 0** (unit). Verbose re-run of the two load-bearing suites: **2 suites / 32 tests, exit 0**
(19 preference assertions + 13 sprint-3 assertions).

Additionally, the 25G suite's non-role assertions confirm the security behaviours the mission asked
about directly: AGENT and SUPPORT sessions denied on the full preference surface, the boundary
applied to encoded routes/descendants/the unimplemented `me` alias, and preference data verified
unchanged after every denial.

No policy or implementation was altered to obtain any of these results.

---

## 9. Operational restrictions — confirmation

| Restriction | Confirmation |
| --- | --- |
| Application-code changes | **None.** `git diff 587c376 <evidence head> -- src apps test scripts` = **0 files**. |
| Migrations | **None added or altered.** The 102 existing migrations were executed by the harness as designed. |
| Production deployment | **None.** |
| External notification provider | **Not activated.** |
| Live SMS / email | **None.** Local/fake transport only. |
| Workforce permission changes | **None.** |
| Policy changes | **None.** H-04 / H-06 / H-07 and the workforce-preference denial remain as documented, untouched. |
| Merge into `main` | **None.** `main` untouched. |
| Force-push / history rewriting | **None.** |
| Ordinary Agent V1 baseline `019de996950b07e9312af455ce0d9b840e6e14f1` | **Preserved, untouched.** |
| Mission 25K integration branch `integration/mission-25k-frontend-security-alignment` | **Not modified or rewritten.** Mission 25M works on a separate evidence branch created *from* it. |
| Databases | Disposable, namespace-scoped, destroyed with the mission. |

---

## 10. Independent execution vs prior Mission 25K evidence

This distinction is material, because re-running the PostgreSQL matrix was the entire point of 25M.

**Independently executed in Mission 25M (this report):**
- The complete PostgreSQL matrix — 132 suites / 2,452 tests, 9 batches, all exit codes read from
  this mission's own run on a freshly initialised PostgreSQL 18.4 cluster.
- All Phase C focused integration and unit batches (§8).
- The entire sprint-3 investigation, including all six reproduction attempts and the control
  experiment.
- Candidate identity and ancestry verification.

**Carried from Mission 25K and NOT re-executed here:**
- Backend unit suite (229 suites / 2,713 tests), backend `tsc`/build, Admin Web `tsc`/`vite build`/
  Jest (37 suites / 284 tests), backend authorization HTTP regression (105/105), notification
  regression (15/15), support binding (5/5), and the 11-role real-browser matrix (75/75).

Justification for not repeating them: **no non-documentation file differs** between the 25K
candidate and the head verified here (`git diff … -- src apps test scripts` = 0 files), so those
gates cover byte-identical code. This mission was scoped to the PostgreSQL matrix, which was the
specific gap Arena 4 recorded. Re-running the full unit and browser matrices would add runtime
without adding evidence about the candidate.

---

## 11. Remaining verification limitations

1. **The 120 s failure was not reproduced.** I could not observe the exact failure Arena 4 saw.
   What is established is the mechanism by measurement: 99.7% of the suite's cost is one shared
   harness step, application code is fast and invariant, and that step is unbounded under memory
   pressure. I therefore classify the timeout as harness/resource sensitivity rather than asserting
   a definitive root cause for their specific host. Anyone with access to Arena 4's environment
   should confirm free memory and whether another batch process was resident at the time.
2. **The sprint-3 suite is not the load-bearing evidence for the security properties.** It covers
   agent history and workforce declared-gate enforcement only. Customer-preference security, audit
   disclosure and cross-customer denial rest on the 25G suites, which pass independently.
3. **Single host, single topology.** 132/132 is demonstrated on this 2 vCPU / 3.9 GB host at
   concurrency 1. Results at concurrency 2 were spot-checked (6 files, exit 0) but a full matrix at
   concurrency 2 was **not** run and is not claimed.
4. **Synthetic fixtures and fake transports.** No production data, no live provider, no external
   network dependency.
5. **Non-PostgreSQL gates were not re-executed** in this mission (§10), by design.
6. H-04 / H-06 / H-07 and the workforce-preference policy decision remain open
   product/security-arena items. They are outside this mission's scope and were not touched.

---

## 12. Artefacts committed

Branch `evidence/mission-25m-postgresql-regression`, path `docs/integration/mission-25m/`:

| Path | Contents |
| --- | --- |
| `…-REPORT.md` | this report |
| `evidence/01-candidate-verification.txt` | pinned SHAs, code-identity proof, tree explanation, ancestry |
| `evidence/02-environment.txt` | host, toolchain, PostgreSQL settings, orchestration parameters |
| `evidence/03-sprint3-timeout-investigation.md` | full Phase A analysis |
| `evidence/04-sprint3-measurements.json` | every experiment as machine-readable measurements |
| `evidence/05-pg-matrix-summary.txt` | per-batch suites/tests/exit codes, totals, integrity checks |
| `evidence/06-pg-matrix-full.log.gz` | complete, unedited matrix log (3.1 MB, gzipped) |
|  `evidence/07-phase-c-focused.txt` | requirement → assertion mapping |
| `evidence/07b-phase-c-integration.log.gz`, `07c-phase-c-unit.log.gz` | Phase C logs |
| `evidence/08-phase-c-verbose-assertions.txt` | all 32 assertions by name |
| `evidence/09-final-counts.json` | machine-readable gate summary |

No credential, token, password or personal data is committed. The `.env` generated for the test
battery is local-only and untracked.

---

## 13. Statement on readiness

The pinned candidate `587c3763944368b9260c9299d18bce1189ca5919` — verified byte-identical in its
application code to the 25K head — has now been shown to complete the **full PostgreSQL integration
matrix**: 132/132 suites, 2,452/2,452 tests, 0 failures, 0 skips, nine of nine batch processes
exiting 0, overall exit 0, with no timeouts and no resource interruptions. The sprint-3
history/workforce issue is investigated, not reproduced, and explained by measurement as a harness
resource-sensitivity artefact rather than a product defect.

The verification limitation Arena 4 recorded in Mission 25L is therefore **resolved on this host**,
with the honest caveat that the original 120 s failure was not itself reproduced (§11.1).

This is a verification statement only. It is **not** production readiness and **not** an acceptance
determination, and H-04 / H-06 / H-07 and the workforce-preference policy decision remain open for
their owners.
