# Release readiness gate

Group 34. Scope: one derived answer to "may this be deployed?", and the exact reasons it says no.

## Why a gate and not a summary document

Thirty-three groups produced thirty-three verdicts, each argued in its own document. None of them answers the
release question, and reading all of them before a deployment is not a control — a document cannot be invalidated.
The paragraph that says "not certified" is still there after the next commit, and nobody re-reads thirty-three of
them at midnight.

So the verdict is code. It reads the evidence the other groups recorded, applies fixed rules, and prints:

```
$ npm run gate:release

RELEASE GATE: NOT_READY
16 blocker(s), 4 condition(s)

Input gates
  PASS     ci-deployment — 15 CI and deployment gates intact
  WARNING  mobile-release — mobile manifests are registerable; 4 warning(s)
  PASS     browser-acceptance — 27 browser checks passed; the API was stubbed
...
$ echo $?
1
```

## The rules

| Rule                                 | Consequence                              |
| ------------------------------------ | ---------------------------------------- |
| a financial dependency is unverified | **blocker** (`financial-dependency`)     |
| a standing obligation is unproven    | **blocker** (category per obligation)    |
| an input gate reports `ERROR`        | **blocker**, naming the gate             |
| an input gate reports `WARNING`      | **condition** — recorded, does not block |
| no blockers at all                   | `READY`                                  |

An `ERROR` is never demoted to a note. That is the failure mode this rule exists to prevent: a red pipeline that
arrives at the release board as "a comment" is how releases ship on broken gates. A `WARNING` is not silently
dropped either — "ready" must not mean "quiet".

## What it reads

| Input                   | Source                                                                          | Today                  |
| ----------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| financial dependencies  | `FINANCIAL_DEPENDENCY_BLOCKERS`, now exported from `ProductionReadinessService` | 8 unverified           |
| CI and deployment gates | `evaluateRepositoryCiGates()` over `.github/workflows/ci.yml`                   | 15 intact              |
| mobile release          | `evaluateRepositoryMobileRelease()` over both `app.json` files                  | 4 warnings             |
| browser acceptance      | `docs/integration/evidence/browser-acceptance/browser-acceptance.json`          | 27 passed, API stubbed |
| standing obligations    | `OUTSTANDING_REQUIREMENTS`, hand-maintained                                     | 8 unproven             |

The financial list is **imported, not copied**. Verifying a dependency means editing that one constant, and the
release verdict moves in the same commit. A second copy would drift, and a drifted copy is how a gate starts
disagreeing with the code it is meant to describe.

## The 16 blockers, as they stand

**Financial dependencies (8)** — each of these is a reason the application refuses to start
(`ProductionReadiness failed: financial_dependencies_not_ready`):

`trusted_kyc_provider_activation_unverified`, `customer_kyc_consent_notice_and_policy_unverified`,
`identity_key_versions_unverified`, `effective_kyc_policy_unverified`, `provider_governance_and_routing_unverified`,
`wallet_ownership_governance_unverified`, `institution_kyc_tier_limit_governance_unverified`,
`financial_authorization_dependencies_unverified`.

**Standing obligations (8)** — no artefact in this repository can discharge these, and no flag may waive them:

| Blocker                                     | What is missing                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `worker_automated_execution_unproven`       | no deployable, tested mechanism guarantees essential workers are invoked; supervision observes only |
| `alert_delivery_unproven`                   | no alert has reached a real channel; delivery is dark by default                                    |
| `disaster_recovery_not_measured`            | RPO/RTO are declared, never measured; no restore at production volume                               |
| `container_build_unverified`                | no container runtime here, so the image has never been built                                        |
| `deployment_not_performed`                  | nothing deployed anywhere; no orchestrator has run the configuration                                |
| `provider_sandbox_acceptance_not_performed` | no authorized provider credential; no provider contacted                                            |
| `browser_acceptance_single_engine`          | Blink only, API stubbed, no assistive technology announced a page                                   |
| `mobile_not_built_or_submitted`             | neither app built, signed, submitted or installed; no runtime-version policy                        |

**Conditions (4)** — accepted in writing, not blocking: both apps shipping `1.0.0`, and neither declaring a
`runtimeVersion`.

## It can say yes

A gate that can only refuse is a wall, and the first release board annoyed by it will route around it. So the rules
are a pure function, and `test/release-gate.spec.ts` (19 cases) proves the gate answers `READY` on a clean input.

Verified by mutation:

| Mutation                                               | Result                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| delete the recorded browser run                        | 1 failure — the gate stops reporting its own gates as healthy      |
| make the verdict unconditionally `READY`               | **5 failures** — every rule that must refuse it                    |
| an `ERROR` gate whose detail says "everything is fine" | still `NOT_READY`: the verdict comes from the field, not the prose |

The distinction the gate keeps is the one that matters: **our own gates are healthy and the repository is still not
releasable**. A gate that conflated those would either block on finished work or release on unverified work.

## How a blocker leaves this report

There is one route: the thing it names is verified, and `OUTSTANDING_REQUIREMENTS` or
`FINANCIAL_DEPENDENCY_BLOCKERS` is edited in review. There is no environment variable, no CLI flag and no test
double that removes one — a flag that did would eventually be set. The suite asserts that the module contains no
`process.env` and no bypass-named identifier.

## What this gate does NOT do

- It performs **no deployment, promotion or rollout**.
- It contacts **no provider** and executes **no financial action**.
- It does **not re-run** the evidence it reads; it reads what the other groups recorded. Re-running the browser
  suite needs a Chromium binary, and re-running the PostgreSQL matrix needs a cluster; when those are available the
  evidence is regenerated and this gate picks it up.
- It does **not** decide whether the mission is finished. It decides whether a deployment would be honest, and
  today it would not be.

## Honest summary

The gate says **NOT_READY**, for 16 named reasons and 4 accepted conditions, with exit code 1. Every one of those
reasons is a thing this mission was instructed not to invent, not to skip and not to simulate: verified providers,
a deployed orchestrator, a built image, a measured recovery, a delivered alert, an executing worker, a signed
binary, a second browser engine.

That is the correct output. A release gate that returned `READY` here would be the single most dishonest artefact
this mission could produce.
