# MISSION 23 — Fast-uri Security Remediation Integration and Verification

**Arena 3 · final security remediation integration for Ordinary Agent V1**
Date: 2026-10-31
Branch: `integration/mission-23-fast-uri-security`
Base: `a392653a176e414477d97213a0fadeb15560b09a` (accepted Mission 20 candidate)
Integrated correction: Arena 1 `arena/92fd33dd-monienaija` @ `b3ced309855f94178d040c752406e1d20567ae28`
Integration merge commit: `42b0baf` (`merge: Arena 1 Mission 22A fast-uri remediation (b3ced30)`, `--no-ff`)

**Verdict: PASS — the Mission 21 high-severity production dependency finding is resolved. Recommend Arena 4 final security acceptance, with the three remaining moderate findings accepted as recorded residual risk (LOW exposure) and one follow-up dependency-upgrade mission.**

---

## 1. What this mission had to establish

Mission 21 raised a **high-severity** production dependency finding: production builds resolved **`fast-uri@3.1.6`** and **`fast-uri@4.1.3`**, both vulnerable (GHSA-qw65-cvwx-89v3, GHSA-58mr-gqgx-xq4g among others). Mission 22A proposed the override correction. This mission had to integrate that correction onto the **already accepted** Ordinary Agent V1 candidate, prove the high finding is gone with an audit I ran myself, and prove nothing regressed.

The mission was deliberately narrow: **one dependency correction, nothing else.**

---

## 2. Integration — what was inspected and what came in

I did not merge on trust. Before integrating:

- **Ancestry**: Arena 1's tip `b3ced30` descends from the same `a392653a` base — three commits:
  | Commit | Content |
  |---|---|
  | `e07bb23` | `fix: update vulnerable fast-uri production overrides` — the actual correction |
  | `954b5cf` | `docs: record Fastify dependency audit evidence` |
  | `b3ced30` | `docs: hand off Fastify dependency remediation` |
- **Diff review** (`a392653a..b3ced30`): 13 files, +1,654 / −71. Of those, only three files touch the build:
  - `package.json` — the **only** functional change is the two override values:
    `fast-uri@3: 3.1.6 → 3.1.9`, `fast-uri@4: 4.1.3 → 4.2.3`.
  - `package-lock.json` — 88 changed lines confined to **five** lock paths, all `fast-uri`: the four nested `3.1.6` copies (`@angular-devkit/core`, `@fastify/ajv-compiler`, `@nestjs/schematics`, `ajv`) collapse into one hoisted `node_modules/fast-uri@3.1.9`, and `fast-json-stringify`'s copy moves `4.1.3 → 4.2.3`. I verified this by parsing both lockfiles and diffing every path: **no other package was added, removed or re-versioned.**
  - `test/mission-22a-fastify-dependency.spec.ts` — new guard (111 lines, 18 tests).
  - The remaining ten files are the Mission 22A report and its eight evidence files.
- **No unrelated changes**: no dependency was added, removed or bumped; no application source, route, guard, DTO, migration or configuration file was touched.

Merged with `--no-ff` so the correction is a single reviewable unit on top of the accepted candidate.

**Integrated change set vs `a392653a`:** 13 files, +1,654 / −71 (above), plus this mission's `docs/integration/mission-23/` report and evidence.

---

## 3. fast-uri — every production path now resolves to a patched version

Required: **3.1.9** instead of 3.1.6, and **4.2.3** instead of 4.1.3, on **all** production paths.

| Consumer | Resolves |
|---|---|
| `fastify@5.12.7 → @fastify/ajv-compiler@4.0.5 → ajv@8.20.0` | **fast-uri@3.1.9** (deduped) |
| `@fastify/ajv-compiler@4.0.5` (direct) | **fast-uri@3.1.9** |
| `fast-json-stringify@7.0.1` | **fast-uri@4.2.3** |

- **`npm ls fast-uri --omit=dev --all`**: only 3.1.9 and 4.2.3 appear.
- **Filesystem scan** of production `node_modules`: exactly two installs — `3.1.9` and `4.2.3`.
- **`package-lock.json`**: two lock paths, both patched; **zero** paths still on 3.1.6 / 4.1.3.
- **Inside the booted compiled process** (`node dist/main.js`), the resolved graph is 3.1.9 / 4.2.3 — not just the lockfile on disk.

Full detail: `evidence/fast-uri-resolution.txt`.

---

## 4. Independent production audit — reproduced by me

Command (both states): `npm audit --omit=dev --json`, on a clean `npm ci` of each state.

| State | Critical | **High** | Moderate | Low | Total |
|---|---|---|---|---|---|
| **Before** — `a392653a` | 0 | **1** | 3 | 0 | 4 |
| **After** — this branch | 0 | **0** | 3 | 0 | 3 |

- **Removed:** `fast-uri` (the high finding).
- **Newly introduced:** none.
- **GHSA-qw65-cvwx-89v3**: 2 occurrences → **0**.
- **GHSA-58mr-gqgx-xq4g**: 2 occurrences → **0**.
- In fact *all eight* advisories the before-run attached to `fast-uri` are gone; the package no longer appears in the audit at all: GHSA-hrr3-gc8f-f4qj, GHSA-jvvf-x445-j334, GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp.

`npm audit --omit=dev` exits **1** in both states because the three moderates remain; that exit code reflects "findings exist", not a failed remediation. Raw JSON for both runs is attached.

---

## 5. Remaining production findings — recorded, not dismissed

All three remaining findings are **moderate** and all three are the **same single chain**:

```
typeorm@0.3.31 → glob@10.5.0 → minimatch@9.0.9
```

| Package | Advisory | Affected range | Available fix |
|---|---|---|---|
| `glob@10.5.0` | **GHSA-3g3m-2fjr-6pw4** — AbortSignal cancellation bypass allows post-timeout filesystem traversal | `3.0.0 - 14.0.1` | `typeorm@1.1.2` (**semver-major**) |
| `minimatch@9.0.9` | **GHSA-g3hv-75wg-m249** — potential DoS via globparts amplification | `<11.0.1` | `typeorm@1.1.2` (**semver-major**) |
| `typeorm@0.3.31` | no advisory of its own; affected only through `glob` | `0.3.18-dev.022d2b5 - 0.3.31` | `typeorm@1.1.2` (**semver-major**) |

**Potential production exposure — assessed, not assumed:**

1. **Nothing in this codebase imports either package.**
   `grep -rnE "from '(glob|minimatch)'|require\('(glob|minimatch)'\)" src/ test/ --include=*.ts` → **0 matches**.
   (A loose search for the string `glob` does hit 22 lines, but every one is the word *global* in a comment or an unrelated identifier. I am stating the import-specific result, not the loose one.)
2. **The only production consumer is TypeORM's file discovery.** Its patterns are compile-time constants that cannot carry request data:
   ```ts
   // src/config/database.config.ts
   43:    entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
   44:    migrations: [`${__dirname}/../migrations/*{.ts,.js}`],
   ```
3. **Neither advisory is reachable from an HTTP request here.** Both require an attacker-influenced pattern — and the glob advisory additionally requires an abort signal on a caller-controlled traversal. In this application `glob`/`minimatch` only ever walk paths derived from the deployed file layout.
4. **Residual risk: LOW.**

**Why it was not fixed here:** the only remediation npm offers is `typeorm 0.3.31 → 1.1.2`, a semver-major ORM upgrade. That would touch entity mapping, migrations and the financial read/write paths — exactly the "unrelated dependency upgrade" Mission 23 forbids. **Follow-up: a dedicated dependency-upgrade mission** (typeorm major + validation of the entity/migration surface). This is a recorded open item, not a silent dismissal.

Detail: `evidence/remaining-findings.txt`.

---

## 6. Gates — full test counts and exit codes

Backend under test for the HTTP/browser gates was the **compiled** build (`node dist/main.js`), not a dev server.

| Gate | Result | Exit |
|---|---|---|
| Backend unit (`jest --runInBand`) | **226 suites / 2,650 tests, 0 failed** | 0 |
| PostgreSQL integration matrix (9 batches, serial) | **131 suites / 2,427 tests, 0 failed** | 0 |
| Backend `tsc --noEmit` | clean | 0 |
| Backend `npm run build` (nest) | `dist/main.js` produced | 0 |
| **Compiled startup verification** | see §6.1 | 0 |
| Admin Web `tsc --noEmit` | clean | 0 |
| Admin Web `npm test` | **37 suites / 276 tests, 0 failed** | 0 |
| Admin Web `npm run build` (vite) | 380 modules transformed | 0 |
| K-01 real HTTP | **6/6** | 0 |
| API matrix | **68/68** | 0 |
| E2E (real Chromium) | **15/15** | 0 |
| N-01 pointer suite | **188/188** | 0 |

Delta vs Mission 20: unit **+1 suite / +18 tests**, which is exactly the new Mission 22A guard; PG, admin-web and E2E are unchanged. No test was skipped, weakened or edited.

### 6.1 Compiled application startup verification

`node dist/main.js` on port 3000 against the migrated disposable database:

- `GET /api/v1/health` → **200** `{"status":"ok"}`
- `GET /api/v1/health/ready` → **200**
- `POST …/local-admin-sessions` (SUPER_ADMIN) → **201**, `roles=[SUPER_ADMIN]`, 66 scopes
- `GET …/dashboard/my-dashboard` → **200**, template `EXECUTIVE_GOVERNANCE`
- fast-uri inside the booted graph: 3.1.9 / 4.2.3 (§3)

Two facts worth recording so they are not misread later:

- **Bare `GET /health` is 404** — health is mounted under `/api/v1`. That is the application's design, not a startup failure.
- Fastify logs `LegacyRouteConverter: Unsupported route path "/api/v1/*"` at boot. It is auto-converted to `/api/v1/{*path}`; **benign, pre-existing, unrelated** to this integration.

---

## 7. K-01, N-01, D-01…D-04 and AW-01 re-verified

| Item | Verification | Result |
|---|---|---|
| **K-01** read-only principal's own logout | `m23-k01.cjs`, real HTTP on the compiled build | **6/6** — own session revocable, forged/foreign denied, path form denied, SUPPORT fallback cannot claim the exemption, other unsafe methods still denied, race cannot resurrect a revoked session, other ten roles keep logout |
| **N-01** sidebar / logout-panel pointer interception | `m23-n01.cjs`, real Chromium, **pointer input only**, 11 roles × 4 viewports | **188/188** |
| N-01 **negative control** | identical script, only `admin-shell.css` swapped | Mission 17 CSS → **BLOCKED ×3** (`locator.click: Timeout`); corrected CSS → **OK ×3** |
| **D-01** agent read 401/403 contract | `a22-admin-foundation`, `mission-16a-agent-read-authorization` in the full PG run | **PASS** |
| **D-02** outlet / terminal save | E2E-07, E2E-08 | **200 / 200** |
| **D-03** revocation count + nested worker shape | E2E-09, E2E-10 | **200 with true count**; `expiry-status 200` with worker state |
| **D-04** approved-Agent activation | E2E-05 / E2E-05b | review → approve → **activate**; row `ACTIVE` |
| **AW-01** Admin Web without the env var | Vite with `env -u ADMIN_WEB_API_BASE_URL` | login through Vite proxy **201**; all 15 E2E + all 188 N-01 checks ran through it; production bundle still fail-closed (0 × `api/v1`, 0 × `localhost`) |

**The negative control matters here.** 188 green pointer clicks mean nothing unless the harness can go red. With the Mission 17 stylesheet the same script produced three `locator.click: Timeout 6000ms exceeded.` failures — the exact original defect — and with the corrected stylesheet, three successes. Working tree restored afterwards (`git status` clean).

### 7.1 Authentication, authorization, session revocation, the 11-role system

- All **11 original roles** authenticate with the unmodified fixture (`local-dev-11-roles-credentials.json`) — no credentials were changed.
- Role-specific dashboards render (SUPER_ADMIN → `EXECUTIVE_GOVERNANCE`).
- **Session revocation** exercised over real HTTP (K-01: own-session revoke, immediate 401, race cannot resurrect) and in the browser (E2E-09).
- **Authorization denial**: CUSTOMER_SERVICE (E2E-12) — nav hidden, **0** agent reads attempted, 0 × 403, 0 × 200 (no forbidden fetch is even made).
- **No false success messaging**: E2E-13 observed a non-2xx and rendered no success banner.

---

## 8. Policy-disabled functionality remains disabled

Verified on the compiled integrated build; **no product policy was changed**.

| Probe | Observed |
|---|---|
| `GET …/cash-to-cash/expiry-status` | 200, `worker: { configuredEnabled: false, schedulerRunning: false }` |
| Three policy-gated write endpoints | **404** (not wired), not 200/500 |
| Security notification template | **400** "Security notifications cannot use editable templates" |

No provider activated, no credential changed, no policy flag flipped.

---

## 9. Boundaries honoured

- No merge into `main`, no deployment.
- No production database touched — a **fresh disposable** database (`monienaija_e2e`) was created and migrated; nothing existing was reset.
- No credential changes; the original 11-role fixture was used as-is.
- No product-policy modification; no provider activation.
- **No unrelated dependency upgrades or new features** — the only functional change in the whole integration is the two `fast-uri` override values.
- No push to any Arena branch.

---

## 10. Blockers, regressions, and things I want on the record

- **Regressions: none.** Every gate is green and equal to Mission 20 except the intentional +18 unit tests.
- **The three moderate findings are open** (§5) with a documented reason and a named follow-up mission. If Arena 4's acceptance bar requires a zero-finding production audit, this branch does not meet it — no branch can, short of the typeorm major upgrade.
- **A residual-risk judgement, stated as judgement:** I am calling glob/minimatch exposure LOW because no source imports them and the only consumer uses compile-time path patterns. That is a reachability argument, not a demonstration under adversarial input — no exploit attempt was made, and I did not treat "audit shows moderate" as automatically acceptable.
- **Non-blocking carryovers from Mission 20**: GOV-01 (governance record) and observations N-02…N-04 remain untouched, out of scope here.

---

## 11. Reproduce

```bash
git worktree add -b integration/mission-23-fast-uri-security <dir> a392653a
cd <dir> && npm ci
npm audit --omit=dev --json                                   # before: 1 high + 3 moderate
git merge --no-ff origin/arena/92fd33dd-monienaija            # -> 42b0baf
npm ci
npm audit --omit=dev --json                                   # after: 0 high, 3 moderate
npm ls fast-uri --omit=dev --all                              # 3.1.9 + 4.2.3 only

npx jest --runInBand                                          # 226 / 2,650
PG_TEST_CONCURRENCY=1 NODE_ENV=test npm run test:pg           # 131 / 2,427
npx tsc --noEmit && npm run build && node dist/main.js        # compiled startup
(cd apps/admin-web && npm ci && npx tsc --noEmit && npm test && npm run build)

# disposable database, then the HTTP/browser gates
node scripts/embedded-pg.js
node scripts/prepare-pg-test-env.js --force
node /tmp/mkdb.cjs monienaija_e2e && DB_NAME=monienaija_e2e npm run migration:run
DB_NAME=monienaija_e2e NODE_ENV=development node scripts/local-dev-seed-11-roles.js
env -u ADMIN_WEB_API_BASE_URL npm run dev --prefix apps/admin-web -- --host 0.0.0.0

node harness/m23-k01.cjs      # 6/6
node harness/m23-api.cjs      # 68/68
node harness/m23-e2e.cjs      # 15/15
node harness/m23-n01.cjs      # 188/188
node harness/m23-n01-negative-control.cjs baseline-m17-css   # 3x BLOCKED
```

**Evidence:** `evidence/` — `audit-before-after.txt`, `production-audit-before.json`, `production-audit-after.json`, `fast-uri-resolution.txt`, `remaining-findings.txt`, `unit-test-summary.txt`, `pg-matrix-summary.txt`, `build-toolchain-summary.txt`, `recheck-summary.txt`, `policy-disabled.txt`, `lockfile-delta.txt`, both negative-control JSONs, raw `*-results.json`, and **28 screenshots** (15 E2E steps + 12 N-01 viewport captures + final states).

---

## 12. Recommendation

**Accept the Mission 22A fast-uri remediation and proceed to Arena 4 final security acceptance.**

The Mission 21 high-severity production dependency finding is **closed**: every production path resolves to `fast-uri@3.1.9` / `4.2.3`, reproduced independently on the integrated lockfile, with both named advisories at zero and six more retired alongside them. Nothing else in the dependency tree moved. The accepted Ordinary Agent V1 candidate is otherwise unchanged and fully green — unit, PostgreSQL, admin-web, type checks, builds, compiled startup, K-01, N-01 (with a negative control proving the harness detects the original defect), D-01 through D-04, AW-01, and the 11-role system.

The three remaining moderate findings are **one typeorm→glob→minimatch chain with no request-reachable path**, fixable only by a semver-major ORM upgrade that this mission's boundaries exclude. I am recommending acceptance **with those three findings explicitly carried as recorded residual risk (LOW)** and a follow-up dependency-upgrade mission opened for them — not on the basis that the audit is clean, because it is not.
