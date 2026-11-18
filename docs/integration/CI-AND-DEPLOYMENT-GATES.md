# CI and deployment gates

Group 29. Scope: what the pipeline actually enforces, the three gates that were missing or broken, and the
release steps that are deliberately still absent.

## What this group found

A GitHub Actions workflow already existed and was not empty. Three problems were real:

**1. `npm run lint` — the first step of the first job — aborted with an out-of-memory kill.**

```
eslint "{src,test}/**/*.ts"
```

One invocation over ~1,750 files. With `projectService: true` and `recommendedTypeChecked`, ESLint builds a
single TypeScript program covering both trees. On a 3 GB runner that is an OOM kill; the process dies before it
reports a single finding.

The consequence is worse than a slow gate: **the lint gate could never pass**, so it was either ignored or worked
around, and it reported nothing about the code either way. Measured here: `src` alone lints in ~60 s, `test`
alone lints in ~70 s, both together exceed 3 GB and are killed.

Fixed by splitting into `lint:src` and `lint:test`, with `lint` running both. `npm run lint` now completes and
exits 0.

**2. The lint gate was hiding eight genuine errors**, including four that would have failed on their own once the
OOM was fixed — plus, notably, two in migrations written during this programme:

| File                                                               | Error                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| `src/migrations/1785753600607-IntegritySnapshots.ts`               | unsafe `any` from `QueryRunner.query`                  |
| `src/migrations/1785753600608-EmergencyAccessReviewRequirement.ts` | same                                                   |
| `src/kyc-verification/dojah-assurance-kyc.provider.spec.ts`        | 4 × unbound-method on mock assertions                  |
| `src/kyc-verification/kyc-provider-governance.service.ts`          | unused type import                                     |
| `src/identity-verification/dojah-transport.ts`                     | useless escape in a character class                    |
| `test/**` (4 more)                                                 | type-only imports, `require()`, triple-slash reference |

All fixed rather than suppressed, except where suppression is the correct answer (the `require()` is deliberate —
the module validates configuration at import time — and the triple-slash reference needs global scope).

**3. `npm run format:check` was failing on six files** that predate this programme. Now green repo-wide.

**4. `apps/agent-mobile` was not in the workflow at all.** It has 323 passing unit tests and a clean `tsc`. None
of that ran on any push or pull request. A suite CI never executes is not a gate regardless of what it covers.

**5. The Dockerfile was never built.** The repository ships a careful multi-stage production image — non-root,
pinned base, separate liveness and readiness — and no pipeline compiled it. A Dockerfile that nothing builds rots
silently until release day.

## The gates now

| Job                       | What it proves                                                       |
| ------------------------- | -------------------------------------------------------------------- |
| `backend`                 | lint, format, build, unit suite with outbound network blocked        |
| `backend-postgres`        | the integration suite against a real PostgreSQL 16 service container |
| `backend-container-build` | the production image **builds**                                      |
| `admin-web`               | types, tests, build                                                  |
| `agent-mobile`            | types, tests _(new)_                                                 |
| `customer-mobile`         | types, tests                                                         |

## Exactly what the container job claims

The job runs `docker/build-push-action` with `push: false, load: false`. It proves the image **builds**. It does
not run the image, does not start the stack and does not execute `docker compose`. No container runtime exists in
this sandbox, so the build's success is a GitHub-side fact, not one asserted here. That distinction is stated in
the workflow comment rather than left to be inferred.

## Gates as code

A CI workflow is a document, and documents do not defend themselves. `src/deployment/ci-gate.service.ts` reads
`.github/workflows/ci.yml` and asserts each required job exists with its required steps, and that every npm script
those steps call is still defined.

Mutations confirm it is load-bearing:

- Deleting the `agent-mobile` job → 3 failures, including `job:agent-mobile` in `missing`.
- Removing `npm run test:pg` from the PostgreSQL job → `job:backend-postgres` reported missing.
- Deleting the container build job → `job:backend-container-build` reported missing.
- Removing the `test:pg` script → `script:test:pg` reported missing.

The extractor reads job indentation from the file rather than assuming it, so a reformatted workflow does not
produce a wall of false "gate missing" failures.

There is also an assertion that `backend-postgres` does **not** contain `continue-on-error: true`. A gate allowed
to fail is not a gate.

## What is deliberately absent

These are decisions nobody has made, not oversights:

- **No deploy job.** There is no registry configured, no environment protection rules, no release approval
  process and no target environment. A deploy job pointing at nowhere is theatre.
- **No registry push.** `push: true` needs credentials that do not exist here, and inventing a registry would
  bake a fictional endpoint into a workflow.
- **No image digest pin.** The Dockerfile says the base image should be pinned by digest at release time for the
  specific registry. A digest that was never pulled is a guess, and a wrong one fails the build in a way that
  looks like a network problem.
- **No coverage threshold.** No target has been agreed, and a threshold chosen by the author would be a number
  invented to pass.
- **No security scanning, no SBOM, no signed images, no provenance attestation.** Each is a real requirement for
  a production financial service and each needs a decision about which tool, which policy and who acts on the
  findings.
- **No environment-specific configuration.** Which environments exist is a deployment decision.
- **No branch protection rules.** Those live in repository settings, not in a file, and cannot be asserted from
  here.

## Honest summary

This group makes the pipeline **work**: it removes a gate that could only ever fail for an infrastructure reason,
fixes the real errors that gate had been hiding, adds the app that was never tested and adds the build that was
never run. It does not claim the workflow has run, that the image builds successfully, or that anything deploys —
none of which can be established from this environment.
