# Consolidated acceptance matrix

Group 36. Scope: one table that says, for every requirement of this mission, what kind of proof stands behind it —
and one that cannot blur "we ran it", "we recorded it" and "we could not do it".

## The result

```
commit 75e17690, clean tree

PASS        typescript — tsc --noEmit clean
PASS        lint — eslint src and test clean (0 errors)
PASS        format — prettier clean
PASS        unit-suite — 3343 tests in 282 suites
PASS        ci-gates — 15 required jobs and scripts intact
PASS        mobile-manifests — 8 checks, 4 warning(s), 0 error
NOT_READY   release-gate — 16 blocker(s), 4 condition(s)
PASS        journeys — 10/10 journeys, 263 tests
PASS        browser — 27/27 checks in Blink 153.0.8010.0
PASS        postgres-inventory — inventory is static: wired, not proven
PASS        privacy-retention
PASS        performance
PASS        startup-gate
UNAVAILABLE container-build — no container runtime exists in this environment
UNAVAILABLE deployment — no environment, orchestrator or registry exists here
UNAVAILABLE provider-sandbox — no authorized provider credential was supplied
UNAVAILABLE cross-browser — no WebKit or Gecko engine is available here
UNAVAILABLE mobile-build — no Xcode, no Android SDK, no signing identity, no device
UNAVAILABLE restore-at-volume — no production-scale dataset exists here
UNAVAILABLE worker-execution — the worker role is implemented and tested; no deployment exists here to observe it
UNAVAILABLE alert-delivery — the signed webhook delivers over a real socket under test; no paging provider was contacted

21 requirements: 7 executed, 6 recorded, 8 unavailable, 0 failing
release verdict: NOT_READY
```

Evidence: `docs/integration/evidence/consolidated/consolidated-run.json`.

## The three kinds, and why the distinction is the whole design

| Kind          | Meaning                                                                      | Count |
| ------------- | ---------------------------------------------------------------------------- | ----- |
| `executed`    | the matrix runner ran this command in the same session that wrote the file   | 7     |
| `recorded`    | an artefact from an earlier group exists and was read; it was **not** re-run | 6     |
| `unavailable` | no proof exists, and none can be produced here — with the reason             | 8     |

Thirty-six groups of evidence is enough that "the matrix passes" would be a meaningless sentence without this
column. `UNAVAILABLE` is neither a failure nor a pass: reporting it as either is exactly how a mission ends up
claiming a container build it never ran.

## The eight things this environment cannot prove

Container build · deployment · provider sandbox acceptance · WebKit and Gecko · mobile build, signing and
submission · a restore at production volume · automated worker execution · a delivered alert.

Each is a row with a reason, not a footnote. Six of them are also blockers in the release gate (Group 34); the gate
and this matrix are checked against each other by test, because two documents that disagree about whether the
platform is releasable would be worse than one.

## Contradictions are enforced, not described

`test/consolidated-matrix.spec.ts` (13 cases) fails when:

| Contradiction                                        | Verified by                                            |
| ---------------------------------------------------- | ------------------------------------------------------ |
| an `unavailable` row carries a passing status        | mutation: setting `container-build` to `PASS` fails it |
| a requirement has no row at all                      | `MISSING` counts as a failing row, asserted            |
| the artefact was produced on a dirty tree            | `cleanTree` must be `true`                             |
| the artefact came from a commit outside this history | `git merge-base --is-ancestor` is asserted             |
| a recorded row points at a file that does not exist  | path extraction + `existsSync`                         |
| the release verdict disagrees with Group 34          | both must read `NOT_READY` with a blocker count        |

The clean-tree rule is why the runner refuses to start on a modified working copy: evidence generated alongside
half-written files is evidence of a state that never existed.

## How to run

```bash
git status --porcelain   # must be empty
node scripts/run-consolidated-acceptance.js          # ~4.5 minutes
node scripts/run-consolidated-acceptance.js --skip-suite   # faster, records the suite as MISSING
```

## What this does NOT certify

- **Not a deployment.** Nothing was deployed; there is no environment behind any row.
- **Not provider acceptance.** No provider was contacted; every provider path in this repository is a fixture.
- **Not a container build.** No container runtime exists here, so the image was never built.
- **Not mobile.** No binary was built, signed, submitted or installed.
- **Not cross-browser.** Blink only.
- **Not measured recovery.** RPO and RTO remain declared, never measured.
- **Not a claim that the platform has no defect elsewhere.** Ten journeys and 3303 unit assertions are evidence for
  what they cover and nothing more — Group 35's own defect was found by _running_, which is the argument for
  running more.

## Honest summary

Twenty-one requirements, thirteen proven by an executed or recorded artefact, eight that cannot be proven here and
say so in one sentence each, and a release verdict of **NOT_READY** that agrees with the gate that produced it. The
matrix does not make the mission finished; it makes the mission's actual state legible in one page, which is the
most a consolidation can honestly do.
