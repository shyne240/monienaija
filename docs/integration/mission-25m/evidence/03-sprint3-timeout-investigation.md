# Mission 25M — Phase A: sprint-3 history/workforce timeout investigation

## 1. Exact test file and test case affected

    test/v1-sprint3-agent-history-workforce.integration.spec.ts

- 13 test cases, 2 describe blocks, 662 lines.
- `GET /api/v1/internal/agents/:id/transactions` (V1-SPRINT3-AGENT-HISTORY-API-01) — 7 cases:
  unified six-type projection, Agent-SELF parity, canonical-type filter + 400, pagination without
  duplicates/loss, agent.view workforce matrix (200 vs 403), Agent-session/anonymous/garbage
  rejection, 404 unknown UUID + 400 malformed id.
- `V1-SPRINT3-GUARD-01` declared-gate enforcement — 6 cases:
  guard-level requiredRoles precedence, legitimate declared-gate flows, canonical
  declared-function denial, read-only principal method gate ordering, V1-SPRINT3-SEC-SWEEP-01
  limit-assignment gating, Sprint-2 receiving-number regression.
- Environment: `jest.integration.config.js` sets `testTimeout: 120000`, `maxWorkers: 1`,
  `--runInBand`. The reported "timeout" is therefore the **120 s Jest ceiling**, not a hang with
  no bound.

**Important scoping fact:** this suite contains **no** customer-preference assertions and **no**
audit-history-projection assertions. `grep` over the file finds `ledger`/`wallet` only as fixture
construction (an account and a c2c journal used to create history rows to read back). It cannot
mask a customer-preference defect, and a timeout in it does not imply one.

## 2. Reproducibility

The 120 s timeout is **NOT reproducible on this host**, under any condition tried:

| Condition | Runs | Result | Suite time |
| --- | --- | --- | --- |
| In isolation, `--runInBand` | 3 | 13/13 pass, exit 0 each | 8.80 s / 7.75 s / 8.41 s |
| 3 concurrent instances (distinct run IDs) | 3 | 13/13 pass, exit 0 each | ~32 s each |
| Orchestrated `PG_TEST_CONCURRENCY=2`, 6 files / 3 batches | 1 | 3/3 batches exit 0, 105 tests, 0 timeouts | — |
| 2.6 GB resident memory pressure | 1 | 13/13 pass, exit 0, **0** timeouts | 300.5 s |
| 2.6 GB pressure, Jest JSON instrumentation | 1 | 13/13 pass, exit 0, **0** timeouts | 432.9 s |
| Full matrix, `PG_TEST_CONCURRENCY=1` | 1 | **PASS inside batch 9/9** | — |

Per-test duration in isolation: min 13 ms, median ~40 ms, **max 198 ms**. Even under memory
pressure the slowest single assertion was 195 ms — three orders of magnitude below the ceiling.

## 3. Cause

Not an application defect. Decomposing the suite with Jest's JSON reporter is decisive:

| Condition | suite wall | spent in `beforeAll` | spent in assertions |
| --- | --- | --- | --- |
| Normal | 8.8 s | ~7.9 s (90%) | 0.908 s |
| 2.6 GB memory pressure | **432.9 s** | **431.5 s (99.7%)** | **0.870 s** |

Application-code execution time is **invariant** (908 ms → 870 ms). Every second of the 49×
slowdown is in `beforeAll`.

What `beforeAll` does is `createIntegrationDataSource('v1s3hist')`, which calls
`ensureMigrationTemplateDatabase()`: it creates `mn_it_tpl_<runId>_<pid>` and executes the **full
102-migration chain** once per batch process, then clones that template per suite. That step is
CPU- and memory-bound and, on a constrained host, scales unboundedly.

**Control experiment (the decisive one).** A trivial suite whose entire `beforeAll` does the same
template build and whose single test takes 925 ms —
`test/v1-harden-01-support-provision-race.integration.spec.ts` — was run under identical memory
pressure:

    beforeAll 747,313 ms     assertions 925 ms     suite wall 748,791 ms     exit 0

It was **slower than the sprint-3 suite** (747 s vs 431 s). The blow-up is therefore a property of
the shared harness setup under resource starvation and is completely independent of the sprint-3
file. Nothing in the sprint-3 suite makes it special or fragile.

A supporting measurement: the per-process fixed cost (Jest start + ts-jest compile + template
build) is ~13.6 s, derived from three runs of two small suites (15.15 s alone, 18.18 s alone,
19.69 s together ⇒ marginal 1.5 s + 4.5 s). Executing the 102-migration chain once through
`typeorm-ts-node-commonjs` took 39.1 s (an upper bound, as it includes TypeScript compilation).

Classification: **test-harness / resource-exhaustion sensitivity**, not a product defect, not
database contention on its own (isolation and 3× concurrency both pass cleanly), and not
suite-specific logic.

**Honest limitation.** I could not reproduce the failure itself, so I cannot state from direct
observation which bound Arena 4's host crossed. What is established by measurement is that
(a) the application code under test is fast and invariant, (b) 99.7% of the suite's cost is one
shared harness step, (c) that step is unbounded under memory pressure, and (d) the suite passes in
isolation, under 3× concurrency, under orchestrated concurrency 2, and inside the complete matrix.
The 120 s value is exactly `testTimeout` from `jest.integration.config.js`, so any host on which
that shared setup crosses 120 s fails the whole suite at once with a timeout, before a single
assertion runs — which matches the reported symptom precisely.

## 4. Blast radius if it does time out

- **Workforce authorization** — partially: the suite's `V1-SPRINT3-GUARD-01` cases exercise
  declared-gate enforcement. The same guard is covered by 8 other integration suites
  (`v1-admin-authorization-*`, `v1-admin-customer-pii-authorization-*`, `a5t11-b2f03-convergence`,
  `mission-25g-customer-preference-authorization`, …), all of which pass.
- **Customer-preference security** — **not at all**. No preference assertion exists in this file.
  Covered by `mission-25g-customer-preference-authorization.integration.spec.ts` (19 assertions,
  all 11 roles named explicitly) and `mission-25g-customer-preference-policy.spec.ts`.
- **Audit history** — **not at all**. Audit/history projection is covered by
  `mission-25g-customer-preference-authorization` ("keeps preference audit/history out of workforce audit projections while preserving the
  records and unrelated audit") and `v1-admin-full-surface-audit-01-auth-propagation`.
- **Ordinary Agent V1** — partially: the unified agent history read (`agent.view`) is also covered
  by `v1-agent-history-01.integration.spec.ts`, `mission-16a-agent-read-authorization`,
  `v1-agent-receiving-number-authorization` and `v1-hardening-07-admin-agent-financial-position`.

## 5. Passes in isolation and in the full matrix

Yes, both:

- isolation: 3/3 runs, 13/13 each, exit 0.
- full matrix: **`PASS test/v1-sprint3-agent-history-workforce.integration.spec.ts`**, batch 9/9,
  batch exit 0, overall matrix exit 0.

No application defect was found, so nothing is escalated for implementation.
