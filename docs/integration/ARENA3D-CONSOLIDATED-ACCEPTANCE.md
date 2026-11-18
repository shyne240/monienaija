# ARENA 3D — consolidated acceptance

Group 39. The mission-level verdict: what was commissioned, what was proven, what was found and fixed, what remains
unproven, and why the answer is a conditional engineering acceptance rather than a release.

Companion documents: `ARENA3D-PRODUCTION-READINESS-CONTINUATION-RECORD.md` (the per-group record),
`CONSOLIDATED-ACCEPTANCE-MATRIX.md` (the requirement-by-requirement table) and
`evidence/consolidated/consolidated-run.json` (the artefact it is built from).

## The verdict

> **Conditional engineering acceptance. Not releasable.**
>
> The platform assembles, refuses to start when its financial dependencies are unverified, enforces its financial
> and institutional boundaries, runs ten participant journeys against real PostgreSQL, runs one real browser
> engine, and carries an executable gate that answers **`NOT_READY` — 16 blockers, 4 conditions** — with exit code
>
> 1.

"Conditional" is load-bearing. The conditions are the eight unverified financial dependencies, the eight
capabilities this environment cannot prove, and the four mobile settings that are a release-management decision.
None of them is a code defect; every one of them is a thing this mission was instructed not to invent.

## What was proven, and how strongly

| Area                  | Evidence                                               | Strength                 |
| --------------------- | ------------------------------------------------------ | ------------------------ |
| Type safety           | `tsc --noEmit` on the strict configuration             | executed here            |
| Lint and formatting   | `eslint src` + `eslint test`, `prettier --check`       | executed here            |
| Unit suite            | **3343 tests, 282 suites**                             | executed here            |
| Configuration         | 152/152 environment keys inventoried and classified    | recorded (Group 8)       |
| Database              | 179 integration suites, dedicated DBs, matrix runner   | recorded (Group 30)      |
| Journeys A–J          | **263 assertions across 13 suites, 10/10 journeys**    | recorded (Group 35)      |
| Browser               | **27 checks in Chromium/Blink 153, production bundle** | recorded (Group 33)      |
| Mobile manifests      | 8 checks, 0 error, 4 warnings                          | executed here            |
| CI and deployment     | 15 required jobs and scripts intact                    | executed here            |
| Release gate          | **`NOT_READY`: 16 blockers, 4 conditions**             | executed here            |
| Startup gate          | refuses to start; 8 blockers named individually        | recorded (Group 31)      |
| Privacy and retention | erasure anonymises, financial records retained         | recorded (Groups 27, 35) |
| Worker execution      | `PROCESS_ROLE` mechanism, 15 assertions                | executed here (Group 37) |
| Alert delivery        | signed webhook, 12 assertions over a real socket       | executed here (Group 38) |

## What was found, and fixed, during acceptance

An acceptance report that lists only passes is a press release. Five real defects were found by **executing**
things, and all five are fixed with a test that would catch them again:

| Defect                                                                                         | Found by    | Fix                                      |
| ---------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------- |
| `App.tsx` gated the whole screen on `isLoading`, so a rejected login discarded the typed email | browser run | first-paint-only gate + jsdom regression |
| `a3d-agent-float-funding` failed its own teardown after all 14 assertions passed               | journey run | `isInitialized` guard on destroy         |
| The CI-gate patterns matched by substring, so one script could claim another's suites          | Group 30    | whole-`run:`-line matching               |
| The matrix runner reported `? tests` because Jest writes its summary to stderr                 | Group 36    | read both streams                        |
| `String(unknown)` on a manifest field yielded `"[object Object]"`, passing non-empty checks    | Group 32    | `text()` helper                          |

Two of these — the login form and the teardown — were invisible to every existing check: one needed a real browser,
the other needed the suite to actually run in this environment rather than be _configured_ to run in CI.

## Standing requirements, and where each now stands

| Requirement                     | Status                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated worker execution      | **Mechanism delivered** (Group 37): `PROCESS_ROLE=worker`, readiness-gated, bounded shutdown, no new authority. **Open:** no deployment has been observed running it. |
| Actual alert-delivery readiness | **Channel delivered** (Group 38): signed HTTPS webhook proven over a real socket. **Open:** nothing reached a paging provider or a human.                             |
| Measured disaster recovery      | **Open.** RPO/RTO remain declared; no restore was attempted at production volume.                                                                                     |
| Eight financial dependencies    | **Open, by design.** Each is named in the release gate; none may be marked verified without independent evidence.                                                     |

## What is explicitly not claimed

Container build · `docker compose` validation · any deployment or rollout · provider sandbox acceptance ·
entitlements · exactly-once external submission · invented fees or thresholds · production authorization ·
isolated-PostgreSQL suite results in this environment · mobile build, signing or submission · store approval ·
restore at production volume · measured RPO/RTO · a delivered alert · automated worker execution **observed in a
deployment** · second- and third-engine browser acceptance · screen-reader acceptance.

## The numbers, in one place

```
3343 unit tests / 282 suites            pass
15 CI and deployment gates              intact
12 PostgreSQL acceptance assertions     pass
11 sandbox readiness assertions         pass
263 journey assertions, 10/10 journeys  pass
27 browser checks, Blink 153            pass
15 worker-execution assertions          pass
12 alert-delivery assertions            pass
19 release-gate assertions              pass

release gate: NOT_READY — 16 blockers, 4 conditions, exit 1
```

## Why "not releasable" is the correct output

The release gate refuses because eight financial dependencies have never been independently verified and eight
capabilities cannot be proven here. A gate that returned `READY` under those conditions would be the single most
dishonest artefact this mission could produce, and the first release board to be inconvenienced by a gate would be
the last one to read it.

What the mission can say is narrower and true: **the engineering is complete, tested and gated; the readiness is
not.** Everything between those two sentences is enumerated above, in the gate, and in the handoff.
