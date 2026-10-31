# Mission 22A — Fastify production dependency security remediation

- **Date:** 2026-10-31
- **Baseline:** pinned Mission 20 commit `a392653a176e414477d97213a0fadeb15560b09a`
- **Working branch:** `arena/92fd33dd-monienaija` (the session's fixed branch)
- **Dependency/test commit:** `e07bb23c19adab731df2e4ec28115497ee91f2c6`, pushed on the assigned branch
- **Release action:** no integration/main merge, deployment, production migration, provider activation, or real financial operation

## Root cause and dependency paths

The baseline `package.json` forced `fast-uri@3` to `3.1.6` and `fast-uri@4` to `4.1.3`, both within high-severity advisory ranges. The overrides prevented their Fastify consumers from selecting patched versions. The current production dependency tree was independently reproduced from a clean baseline install:

```text
fastify@5.12.7
├─ @fastify/ajv-compiler@4.0.5 → fast-uri@3.1.6
│  └─ ajv@8.20.0 → fast-uri@3.1.6
└─ fast-json-stringify@7.0.1 → fast-uri@4.1.3
```

The historical [`V1-SYSTEM-01` audit](../../V1/V1-SYSTEM-01-CROSS-DOMAIN-SECURITY-FINANCIAL-INTEGRITY-AUDIT.md) described four high-severity production entries for its then-current tree. On the current npm advisory feed, the pinned baseline instead reports **one high package entry** (`fast-uri`, with two distinct high-severity GHSAs and newer additional advisories) plus three separate moderate package entries for TypeORM's `glob`/`minimatch` chain. Audit package-entry counts are not counts of individual advisory IDs; the exact results at the time of this run are below.

### Fast-uri advisories reported for the baseline

Ranges below are the affected 3.x and 4.x ranges reported by npm/GitHub. A dash means that advisory does not list the corresponding major line. The listed fixed versions are the **first patched versions in those lines**, not necessarily sufficient against the other advisories.

| Advisory / CVE | Severity | Affected 3.x → first fixed | Affected 4.x → first fixed |
|---|---|---|---|
| [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) / CVE-2026-84292: port authority injection | High | `>=3.0.0 <3.1.7` → `3.1.7` | `>=4.0.0 <4.1.4` → `4.1.4` |
| [GHSA-58mr-gqgx-xq4g](https://github.com/advisories/GHSA-58mr-gqgx-xq4g) / CVE-2026-84394: malformed bracket host confusion | High | `=3.1.6` → `3.1.7` | `=4.1.3` → `4.1.4` |
| [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) / CVE-2026-86472: host case normalization | Moderate | `>=3.0.0 <3.1.8` → `3.1.8` | `>=4.0.0 <4.1.5` → `4.1.5` |
| [GHSA-jvvf-x445-j334](https://github.com/advisories/GHSA-jvvf-x445-j334) / CVE-2026-86818: mailto header injection | Moderate | — | `>=4.1.3 <4.1.5` → `4.1.5` |
| [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) / CVE-2026-110306: encoded scheme spoofing | Moderate | `>=3.0.0 <3.1.9` → `3.1.9` | `>=4.0.0 <4.2.3` → `4.2.3` |
| [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h) / CVE-2026-110095: relative path equivalence | Low | `>=3.0.0 <3.1.9` → `3.1.9` | `>=4.0.0 <4.2.3` → `4.2.3` |
| [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr) / CVE-2026-110180: unchecked host canonicalization | Moderate | `>=3.1.3 <3.1.9` → `3.1.9` | `>=4.0.1 <4.2.3` → `4.2.3` |
| [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) / CVE-2026-110725: suffix scheme injection | Low | `>=3.0.0 <3.1.9` → `3.1.9` | `>=4.0.0 <4.2.3` → `4.2.3` |

## Exact change and compatibility

Only the `fast-uri` pins changed: **3.1.6 → 3.1.9** and **4.1.3 → 4.2.3**. These are the smallest versions in their respective major lines that also address all of the subsequently reported advisories above. `@fastify/ajv-compiler` requires `^3.0.0`, `ajv` requires `^3.0.1`, and `fast-json-stringify` requires `^4.0.0`; the selected versions satisfy each existing range. No Fastify, NestJS, TypeORM, role, credential, migration, provider, or business-policy version/configuration was changed.

`package-lock.json` changed only six `fast-uri` package entries: four nested 3.1.6 entries (two production, two development) were deduplicated into root `node_modules/fast-uri@3.1.9`, and the nested `fast-json-stringify` entry changed from 4.1.3 to 4.2.3. Clean `npm ci --omit=dev` installs (both with lifecycle scripts enabled and with `--ignore-scripts`) and `npm ls fast-uri --omit=dev --all` independently confirmed the production resolutions: ajv-compiler **3.1.9**, ajv **3.1.9**, and fast-json-stringify **4.2.3**. All are outside the current reported affected ranges.

The fixes intentionally reject malformed ports and ambiguous hosts and do not turn encoded schemes into active schemes. A consumer that depended on the old permissive handling of invalid URIs may observe stricter behavior; valid HTTPS/IPv6 handling, Fastify schema `$ref` request validation and response serialization are covered by the new regression.

In a controlled string-only check of both original published versions and each updated consumer resolution:

| Example | Baseline 3.1.6 and 4.1.3 | Corrected versions |
|---|---|---|
| Serialize `scheme: 'http', host: 'trusted.example', port: '@127.0.0.1:8124', path: '/app'` | `http://trusted.example:@127.0.0.1:8124/app` | throws `URI port is malformed.` |
| Parse `http://user@[@127.0.0.1:8123/admin` | returned no error | reports `URI host is malformed.` |
| Normalize `%6Aavascript:alert(1)` | `javascript:alert(1)` | preserves the input; parsing reports a malformed scheme |

No network request was made to the example addresses.

## Audit results and remaining findings

| Command | Baseline `a392653` | After dependency correction |
|---|---|---|
| `npm audit --omit=dev` | exit **1**: 1 high + 3 moderate package entries | exit **1**: **0 high**, 3 moderate entries |
| `npm audit --omit=dev --audit-level=high` | not run at baseline | exit **0**, with the same 3 moderate findings still displayed |
| `npm ls fast-uri --omit=dev --all` | exit **0**: 3.1.6, 4.1.3 | exit **0**: 3.1.9, 4.2.3 |

The raw [baseline production audit](evidence/production-audit-before.json), [remediated production audit](evidence/production-audit-after.json), [full-tree audit](evidence/full-audit-after.json), [before/after production trees](evidence/fast-uri-production-trees.txt), and [GitHub advisory metadata](evidence/github-advisory-metadata.jsonl) are committed snapshots of the results, not substitutes for a fresh registry audit.

No `fast-uri` advisory remains in the post-fix production audit. The unfiltered audit is **not clean**, and its exit 1 must not be hidden:

- `typeorm@0.3.31 → glob@10.5.0`: [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), CVE-2026-118773, moderate; affected `>=9.0.0 <=14.0.1`, first fixed `14.0.2`.
- `glob@10.5.0 → minimatch@9.0.9`: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), CVE-2026-118764, moderate; affected `<11.0.1`, first fixed `11.0.1`.
- `typeorm` is the third moderate **propagated package entry**, not a third distinct direct advisory. npm offers `typeorm@1.1.2` as a major-version fix; a framework/ORM upgrade or incompatible override is outside this narrowly authorized mission and requires independent compatibility and migration review.

For completeness, a separate **full tree including development dependencies** audit exited **1** with 35 package entries: 34 moderate and 1 low (including the three production entries above), and 0 high/critical. Its additional direct advisories are dev-only `superagent → qs@6.16.0` ([GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw), CVE-2026-110816, affected `>=6.7.0 <=6.16.0`, fixed `6.16.1`) and `deepmerge@4.3.1` ([GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), CVE-2026-93753, affected `>=4.2.0 <=4.3.1`, no first patched version listed). The remaining entries are primarily propagated through the existing Jest/ESLint/Nest CLI tooling; no unrelated dependency was changed.

## Verification

Checks ran with Node `22.22.3` and npm `10.9.8`, matching the repository's Node 22 CI/container major. The integration runner uses a private local embedded PostgreSQL instance, run-scoped disposable databases, batch size 10 and concurrency 1. `npm run build` was executed; no container image was built or deployed.

| Check | Result / exit |
|---|---|
| Clean baseline and remediated installs (`npm ci --ignore-scripts --no-audit --no-fund`) | passed / **0** each |
| Clean production-only install (`npm ci --omit=dev`, lifecycle scripts enabled) and `npm ls fast-uri --omit=dev --all` | passed / **0** each |
| Fastify TCP startup, validation, serialization and advisory regression (`test/mission-22a-fastify-dependency.spec.ts`) | **18/18 tests**, exit **0** |
| Targeted guard, authorization, DTO and Fastify unit tests | **5 suites / 277 tests**, exit **0** |
| Complete backend unit suite (`npx jest --runInBand`) | **226 suites / 2,650 tests**, exit **0** ([summary](evidence/unit-summary.txt)) |
| Complete PostgreSQL integration matrix (`PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=10 npm run test:pg`) | **131 suites / 2,427 tests** across 14/14 batches, exit **0** ([summary](evidence/pg-matrix-summary.txt)) |
| Focused real-PostgreSQL workforce logout, Agent sessions, Agent App, cash-in/out and cash-to-cash workflows | **8 suites / 241 tests**, exit **0** ([summary and status-only TCP evidence](evidence/focused-auth-agent-pg-summary.txt)) |
| Backend production build (`npm run build`) | passed / **0** |
| Backend typecheck (`npx tsc --noEmit`) | passed / **0** |
| Selected new-test ESLint | passed / **0** |
| Compiled application from the production-only install, isolated-PostgreSQL startup smoke | **7/7 real-TCP checks**, exit **0** ([summary](evidence/compiled-startup-summary.txt)) |

The compiled Nest/Fastify app started with `NODE_ENV=test` against a freshly migrated, disposable local database using only production-installed dependencies. Health/readiness returned 200, missing or malformed credentials returned 401, and an invalid Agent session DTO and malformed JSON returned 400; outbound fetch and background workers were disabled for the smoke. This verifies the compiled binary and dependency tree, not production infrastructure or provider configuration.

The committed Mission 19A session-revocation guard and stale-validation correction remain byte-for-byte unchanged. Real-TCP evidence after this fix was: auditor read/self-revoke/replay **200/200/401**, local login/read/self-revoke/replay **201/200/200/401**, 11 catalogue roles **200/200/401**, and concurrent self-revoke/delayed-read/replay **200/401/401** with the session `REVOKED`. The real PostgreSQL matrix and focused rerun include workforce/Agent authentication and authorization, and Ordinary Agent cash-in, cash-out, cash-to-cash creation, claim and expiry tests. Deliberate concurrency and timeout tests produced expected PostgreSQL conflict/timeout log messages while their assertions passed. All PostgreSQL operations were confined to the isolated local test instance and its disposable databases; no production database or real external provider was contacted.

## Recommendation

The targeted Fastify dependency fix is suitable for integration review with the checks above completed. It removes the identified production high-severity `fast-uri` issues without a framework upgrade. **Do not describe the overall audit as clean or grant unconditional production security acceptance** while the separately identified TypeORM/glob/minimatch moderate findings remain unresolved. Review those and the development-only audit findings in a separately scoped dependency/security task.
