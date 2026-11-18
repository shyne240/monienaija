# Platform journeys A–J

Group 35. Scope: the ten paths a real participant actually takes, executed against real PostgreSQL — and the
defect that running them exposed.

## The result

```
journeys: 10/10 passed, 0 failed, 0 not run, 263 tests
  PASS  A  A customer registers and becomes usable — 22 tests
  PASS  B  A customer funds their wallet through an agent — 59 tests
  PASS  C  A customer transfers to another customer — 15 tests
  PASS  D  A customer withdraws cash through an agent — 33 tests
  PASS  E  An agent is funded and its float is classified — 14 tests
  PASS  F  A financial commitment needs two people — 48 tests
  PASS  G  Provider settlement is reconciled, not assumed — 15 tests
  PASS  H  KYC tiering decides what a customer may do — 8 tests
  PASS  I  Risk signals become cases, and cases get decisions — 22 tests
  PASS  J  A customer's data is erased without erasing the ledger — 27 tests
```

Thirteen integration suites, executed — not a configuration report. Evidence:
`docs/integration/evidence/journeys/journey-results.json`.

## Why journeys, and why these

A journey is a path a participant takes, written as the steps they take **and the things that must not happen**.
The refusals are the interesting half: a cash-in that is not a loan, an approval that cannot approve itself, a
reconciliation that cannot post an adjustment, an erasure that cannot delete financial evidence.

The ten are ordered by participant — customer first (A–D, H), then the agent network (E), then the controls that
constrain both (F, G, I, J).

| Journey | Participant           | What it proves                                                                                        | Tests |
| ------- | --------------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| A       | Customer              | registration → channel verification → PIN → a session that can act only for that customer             | 22    |
| B       | Customer + agent      | an agent cash-in credits the wallet once; a retry does not credit twice; an agent cannot overspend    | 59    |
| C       | Customer              | a transfer respects limits and balance, moves value exactly once, and shows each side only its own    | 15    |
| D       | Customer + agent      | a withdrawal is refused when funds are short, and the refusal moves nothing                           | 33    |
| E       | Agent + operator      | float is funded and attributed to a pool; institution-attributed funds never come from the platform   | 14    |
| F       | Preparer → approver   | two people are required; the preparer cannot approve their own commitment; execution happens once     | 48    |
| G       | Operations            | statement ingestion, mismatch reporting, and a resolution that is attributable — never an auto-adjust | 15    |
| H       | Customer + compliance | a pending submission grants no limit; a tier rise needs a recorded decision                           | 8     |
| I       | Risk analyst          | signals are recorded with their basis, a case references them, and a decision cannot delete them      | 22    |
| J       | Customer + privacy    | erasure anonymises personal data, retains financial records, and appears in the audit trail           | 27    |

## No new end-to-end scripts were written

Each step is proved by an **existing** integration suite, executed against the real schema. Writing ten new
end-to-end scripts would have produced ten new fixtures asserting whatever they were written to assert, while the
suites that already exist encode years of decisions about refusals, authorization and ledger balance. Re-running
those, grouped by the participant whose path they prove, is worth more than a tenth copy of the same fixture.

The registry (`src/acceptance/platform-journeys.ts`) is the map; `scripts/run-journey-acceptance.js` is the runner.
The runner refuses to invent a cluster: `PG_TEST_RUN_ID`, `PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes` and the `DB_*`
variables must be supplied by the caller.

## The defect the run found

Journey E's suite reported **failed** while all fourteen of its assertions passed:

```
● Test suite failed to run
  CannotExecuteNotConnectedError: Cannot execute operation on "default" connection
  because connection is not yet established.
    at DataSource.destroy
    at Object.<anonymous> (test/a3d-agent-float-funding.integration.spec.ts)
```

`afterAll` did:

```ts
await app?.close();
await db?.destroy();
```

The suite overrides the `DataSource` provider with its own instance, so `app.close()` has **already** destroyed it.
The second `destroy()` throws, and Jest marks the whole file failed — after the tests have passed.

Two things follow, and both matter more than the one-line fix:

1. **A presence-based CI gate cannot see this.** Group 29's gate asserts the `backend-postgres` job exists and
   invokes the right script — which is true. A configured job is not a passing job, and nothing in this repository
   was checking that the suites it runs actually pass on the current commit. Executing them is the only thing that
   surfaces it.
2. **A verdict derived from failing-assertion counts would have called it green.** The runner now uses Jest's own
   per-file status, and the evaluator fails a journey when a suite reports `FAIL` with zero red assertions. That
   case is pinned by its own test.

Fixed with the guard the other suites already use (`if (db?.isInitialized) await db.destroy().catch(...)`), and
pinned in `test/platform-journeys.spec.ts`.

## How to run

```bash
PG_TEST_RUN_ID=g35 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
DB_HOST=127.0.0.1 DB_PORT=5461 DB_USER=... DB_PASSWORD=... \
npm run acceptance:journeys -- --batch-size 3      # --only A,F for a subset
```

Batches run in separate Jest processes for the memory reason recorded in `run-pg-integration-tests.js`, not for
isolation: every suite already owns a dedicated database. A full run takes about six minutes here.

## What this does NOT certify

- **No provider was contacted.** Every provider interaction is a controlled fixture. A journey passing means the
  platform handles the _contract_, not that any bank, KYC provider or SMS gateway agrees.
- **No real money moved.** Every amount is a fixture inside a disposable database that is dropped afterwards.
- **No browser, mobile app or device.** These are API and service-layer journeys; Group 33 covered one browser, and
  the mobile apps remain unbuilt.
- **No deployment.** There is no environment behind these journeys.
- **Not exhaustive.** Ten paths out of a product with many; a passing journey is evidence for its own steps, not a
  claim that the platform has no defect elsewhere. Group 35's own defect was found by _running_, which is the
  argument for running more.
- **Not a performance statement.** No timing thresholds are asserted; durations are recorded, not judged.

## Honest summary

Ten participant journeys run end-to-end against real PostgreSQL, 263 assertions, all green — with one long-standing
red suite found and fixed on the way. The platform's happy paths work, and so do the refusals that make them safe.
What remains unproven is everything outside this sandbox: providers, devices, deployment and the eight financial
dependencies the release gate still refuses.
