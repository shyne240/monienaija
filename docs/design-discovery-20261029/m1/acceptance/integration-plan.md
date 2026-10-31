# M1 integration plan — branch → `main`

**Status:** proposal for Product Owner approval. **No code was changed, no branch was merged, nothing deployed, M2 not started.**
**Branch:** `arena/d4ef0b81-monienaija` · **Plan commit:** see [Permalink](#permalink)
**Basis:** the acceptance review at [`../acceptance/README.md`](../acceptance/README.md) (evidence in `../acceptance/evidence/`).

---

## 1. The one decision that unblocks everything

**Integrate `arena/d4ef0b81-monienaija` → `main` as a whole. Do not try to move M1 alone.**

`main` contains a 30-file Admin Web skeleton; this branch contains the 99-file application (28 views, 7 groups, 9 aliases, all guards). M1 builds on that application. Attempting to move M1's ten files onto `main` produced 23 compile errors because 14 of the 21 screens `Layout.tsx` imports, plus `navigation-access.ts`, do not exist there.

Everything below assumes that route. If the Product Owner instead wants M1 alone on `main`, that is not technically possible without also merging the 110 commits that carry the Admin Web application — which is the same merge, described once.

---

## 2. Conflict ownership — all 26, mapped

Grouped by who changed the file and who can judge it. "Branch" = `arena/d4ef0b81-monienaija`; "main" = `39a9e50`.

### 2.1 Frontend — Admin Web (4 files) · owner: **Admin Web lead**

| File | What each side has | Resolution rule |
|---|---|---|
| `src/config/index.ts` | main: build-time injected `__ADMIN_API_BASE_URL__` / `__ADMIN_DEV_AUTH_MOCK__`, empty by default → **fails closed**. Branch: `process.env` read + `/api/v1` fallback; mock auto-on outside production. | **Take main's stricter mechanism** + keep the branch's `API_BASE_URL` shape so existing imports still work. |
| `src/services/api-client.ts` | main: adds the fail-closed guard `if (!API_BASE_URL) throw new NetworkError(...)` (5 lines) but **removed** `getBlob`, `postForm`, `onWorkforceSessionExpired`. Branch: full client (3 real call sites in `CustomerProofOfAddressPanel.tsx`, plus `auth-store.ts`) **without** the guard. | **Branch file + main's guard.** Neither side may win outright. |
| `src/store/auth-store.ts` | main: `ApiError` typing + `DEV_AUTH_MOCK`-gated dev fallback; **removed** `loginWithPassword` and the session-expired listener. Branch: keeps `loginWithPassword` (the normal operator login, 6 references) and the listener. | **Branch file + main's `DEV_AUTH_MOCK`/`ApiError` pattern.** |
| `vite.config.ts` | main: `define` via `resolveAdminBuildConfig`, drops the shared-deps plugin, no dev proxy. Branch: shared-deps plugin, `allowedHosts`, `/api` dev proxy. | **Branch server block + main's `define` + `build-config.ts`.** |

**These four are the only frontend conflicts, and none of them is a redesigned screen.** They are login/session/API plumbing.

### 2.2 Frontend — Customer Mobile (4 files) · owner: **Mobile owner**

| File | Note |
|---|---|
| `__tests__/transfer.test.tsx` | main stabilised these tests (`ee02196`, `94cd28c`); branch has a much larger suite. Keep branch + main's stabilisation. |
| `src/config/index.ts` | Same env/config pattern question as Admin Web. |
| `src/screens/unauthenticated/LoginScreen.tsx` | main hardened the login path; branch has a different screen. |
| `src/store/auth-store.ts` | Session handling on both sides. Mobile owner decides; the branch's wallet/transfer behaviour must not regress. |

### 2.3 Backend — authorization (5 files) · owner: **Authorization/Security owner (Arena 3)**

`route-policy-registry.ts` (branch +935/−92), `runtime-access.guard.ts` (+307/−53), `workforce-administration.controller.ts` (+173/−24), `workforce-oidc.service.ts` (+42/−0), `workforce-session.service.ts` (+133/−19).

The branch is the larger superset, but main carries **92 lines of route-policy entries the branch does not have** and its own guard hardening. Resolve by **union with the authorization test matrix as the arbiter** (`test/authorization-http-matrix.spec.ts`, `test/runtime-access.guard.spec.ts`). No policy change may be introduced by a conflict resolution.

### 2.4 Backend — config & financial controllers (6 files) · owners: **Platform config** + **Financial backend**

`config/environment.ts` (+395/−126), and `deposit`, `transfer`, `wallet-transaction`, `wallet`, `withdrawal` controllers (each ±20–55 lines).

main has production-configuration hardening and response-shape changes; the branch has the A5–A7 lifecycle work. Resolve per file with `test/payment.service.spec.ts`, `test/transfer.service.spec.ts`, `test/health.e2e.spec.ts`, `test/production-config.spec.ts` green. **No financial logic may be altered by a merge resolution.**

### 2.5 Manifests (2 files) · owner: **Platform owner**

`package.json` (branch +14/−11), `package-lock.json` (+969/−54). Union of dependencies, then regenerate the lockfile with `npm install` and prove `npm ci` from a clean tree. **Resolve this first — nothing can be built until it is.**

### 2.6 Repo metadata (3 files) · owner: **Docs/Platform**

`.gitignore` (union: main added 19 lines, branch added 2), `.env.example` (**union is mandatory** — branch is missing 30 of main's keys, and a missing key is a deployment misconfiguration), `README.md` (both rewrote; take the branch's and fold in main's 7 line change).

### 2.7 Backend tests (2 files) · owners: **Platform (readiness)** + **Reconciliation owner**

`test/production-readiness.spec.ts` — main rewrote it to **derive the migration head from the repository** instead of hardcoding it. **Take main's version**; the branch's hardcoded head will rot on the next migration.
`test/external-reconciliation.service.spec.ts` — take the branch's, then re-run.

### 2.8 Summary by owner

| Owner | Files | Weight |
|---|---:|---|
| Admin Web lead | 4 | **The only files that decide whether the Admin Web survives** |
| Mobile owner | 4 | Independent |
| Authorization/Security (Arena 3) | 5 | Highest risk — policy-adjacent |
| Financial backend + platform config | 6 | Highest risk — money paths |
| Platform owner | 2 | Blocking for everything else |
| Docs/platform | 3 | Low risk, one trap (`.env.example`) |
| Test owners | 2 | Low risk |

**Arena 1** (notifications) and **Arena 2** (provider F-01/F-05) have **no conflicts** here; **Arena 4**'s independent acceptance is not touched and is not closed by this merge.

---

## 3. How the Admin Web survives without losing main's security work

The rule is one sentence: **for Admin Web, the branch supplies the application and `main` supplies the hardening — never choose between them.**

Concretely, four files are resolved as "branch file plus main's additions", and four things from `main` must be visibly present afterwards:

| # | Must be preserved from `main` | Verification |
|---|---|---|
| 1 | Fail-closed guard in `api-client.request()` when no API base URL is configured | `api-client-config.test.ts` passes |
| 2 | Build-time `define` of `__ADMIN_API_BASE_URL__` / `__ADMIN_DEV_AUTH_MOCK__` via `build-config.ts` | `production-auth-safety.test.ts` passes |
| 3 | `DEV_AUTH_MOCK` off unless explicitly opted in | `production-auth-safety.test.ts` passes |
| 4 | Request-shape assertions (`Accept`, `Content-Type`, bearer, idempotency-key) | `api-client-request.test.ts` passes |

And **four things from the branch** must still exist: `loginWithPassword`, `onWorkforceSessionExpired` (session-expiry logout), `getBlob`/`postForm` (document upload/preview), and the dev-server `allowedHosts` + `/api` proxy.

**Definition of done for this slice:** `tsc` 0 errors; **33 suites / 242 tests green**, including all three `main`-only suites; the ten M1 files byte-identical to `d7a8af4`.

I already modelled this exact combination in a disposable copy: **32/33 suites and 241/242 tests pass**, with the single failure being precisely item 1 above (`api-client-config.test.ts`). That is the only known work item in the whole merge that is a code change rather than a decision.

---

## 4. Safest sequence

Everything happens on a throwaway **integration branch** created from `main`. `main` is never touched until the final approved PR, so any mistake is discarded by deleting one branch.

| Step | Action | Owner | Gate before moving on |
|---|---|---|---|
| **0** | Freeze the feature branch; tag `m1-approved-53d87f9` for traceability | Platform | Tag exists; no new commits on the feature branch |
| **1** | Create `integration/arena-d4ef0b81` from `origin/main`; merge `arena/d4ef0b81-monienaija` into it **once** | Platform | 26 conflicts present, nothing else |
| **2** | Resolve **manifests** (`package.json`, `package-lock.json`), regenerate lockfile | Platform | `npm ci` clean at root + both apps |
| **3** | Resolve **repo metadata** (union, `.env.example` diffed key-by-key) | Docs/Platform | Every key in main's file present in the result |
| **4** | Resolve **backend tests** (`production-readiness.spec.ts` ← main; reconciliation spec ← branch) | Platform + Reconciliation | Both specs run |
| **5** | Resolve **authorization** (5 files) | Arena 3 / Security | `authorization-http-matrix`, `runtime-access.guard` suites green; reviewer confirms no policy change |
| **6** | Resolve **financial/config** (6 files) | Financial + Platform config | Payment, transfer, wallet, withdrawal, deposit, health, production-config suites green |
| **7** | Resolve **Admin Web** (4 files) per §3 | Admin Web lead | `tsc` 0 errors; **33 suites / 242 tests**; M1 files unchanged |
| **8** | Resolve **Customer Mobile** (4 files) | Mobile owner | Mobile `tsc` + suite green |
| **9** | Full-stack verification on the integration branch | Platform + QA | Root `npm test`, admin-web and mobile suites all green in one run |
| **10** | Security read-through: the four §3 items present, no secrets added, no policy edited | Security owner | Signed note on the PR |
| **11** | PR `integration/…` → `main`, reviewed by Admin lead + Security; **merge decision is a separate approval** | Product | Approved PR |
| **12** | Deployment — **out of scope for this plan** | Product | Separate go/no-go |

**Why this order:** manifests must land first or nothing can install; metadata and tests are cheap and reveal surprises early; backend goes before frontend because the frontend consumes its API; Admin Web goes after backend so its suites run against settled endpoints; mobile goes last because it depends on the least. Rollback at any point = delete the integration branch.

---

## 5. What can run in parallel

| Track | Who | Depends on the merge? |
|---|---|---|
| **P1 — Browser + screen-reader acceptance** (1440/1024/768/390/320, zoom 200/400 %, NVDA/VoiceOver) on a workstation | Accessibility/QA | **No** — the outstanding acceptance blocker; start now |
| **P2 — Customer Mobile conflicts** on their own worktree | Mobile owner | No (own slice of the same merge) |
| **P3 — Backend authorization conflicts** | Arena 3 / Security | No |
| **P4 — Backend financial/config conflicts** | Financial + Platform config | No |
| **P5 — `.env.example` union draft + README fold-in** | Docs | No — can be prepared as a patch today |
| **P6 — Admin Web 4-file resolution** prepared as a reviewable patch | Admin Web lead | No, but it can only be **applied** on the integration branch (needs authorization — it edits files outside the M1 allowlist) |
| **P7 — Arena 4 independent acceptance** | Arena 4 | Unaffected, stays independent |
| **Not parallel** | — | Step 9 full-stack verification, step 11 merge, step 12 deployment |

P2–P6 all touch different files, so they can run simultaneously on separate worktrees and be applied to the integration branch as they land.

---

## 6. Top risks and how this plan contains them

| Risk | Impact | Containment |
|---|---|---|
| Resolving Admin Web in favour of `main`'s four files | Deletes 80+ files of UI; app disappears | Compile gate at step 7; impossible to miss |
| Forgetting main's fail-closed API guard | Production build sends requests with no configured host | Explicit must-keep list (§3) + `api-client-config.test.ts` as the gate |
| `.env.example` union dropping main's keys | Deployed service misconfigured despite green tests | Step 3 gate is a key-by-key diff |
| Taking the branch's `production-readiness.spec.ts` | Test breaks on the next migration, blocking later releases | Explicitly take main's adaptive version |
| Losing Arena 3's route-policy entries | Authorization surface silently narrows | Union + authorization matrix suite |
| Race between owners on the same branch | Conflicting resolutions | Integration branch is single-writer per step; each owner works on their own worktree |

---

## 7. Executive summary for the Product Owner

**In plain terms**

The finished MonieNaija admin console is not on `main`. `main` holds an old, partial copy. The full application — the 28 screens, the login, the customer directory, the new M1 design — lives on the development branch. So "merging M1" is really "moving the whole admin console onto `main`", and that is a normal, well-understood operation.

**What the 26 conflicts actually are**

When the two copies are combined, 26 files disagree. Only **4** of them are frontend files, and those 4 are **not screens** — they are the plumbing that decides where the app sends requests and how it logs people in. The other 22 belong to other teams' work: backend security, payments, the mobile apps, and packaging files. **Nothing about the new design is in dispute.**

**The one thing that genuinely matters**

Someone added an important safety switch on `main`: if the admin console is deployed without being told where its server is, it must refuse to send anything rather than guess. That switch is missing from the development copy. If the merge is done carelessly, that safety is lost. The plan keeps it and adds a test to prove it — that test is the only known piece of real code work in the whole merge.

**What I recommend**

1. **Approve moving the whole development branch onto `main`** (not M1 alone — M1 alone cannot compile there).
2. **Do the merge on a separate "integration" copy first**, in a fixed order, with each team resolving only its own files. If anything goes wrong, delete that copy — `main` was never touched.
3. **Do not deploy.** Approval to merge and approval to deploy should be two separate decisions.

**Cost and timing:** roughly one to two working days of effort across the owners — most of it waiting on test runs. No new features, no redesign, no database changes.

**Still outstanding, separately:** the browser and screen-reader checks from the acceptance review could not be run in this environment. They can start in parallel and do not block the merge work — but they do block final sign-off, and they need a normal computer with a browser.

**What I need from you**

- Say yes to *branch → main* as the route.
- Confirm the owners for each slice (Admin Web lead, Mobile, Security/Authorization, Payments, Platform).
- Confirm that acceptance evidence (P1) continues in parallel.
- Confirm no deployment until a separate decision.

---

## 8. Appendix — evidence and reproduction

| Claim | Evidence |
|---|---|
| `main` has 30 Admin Web files, branch has 99 | `../acceptance/evidence/integration-merge-tree.txt` |
| M1 alone cannot compile on `main` (23 errors) | `../acceptance/evidence/counterfactual-m1-onto-main.txt` |
| 26 conflicts, none of them M1 files | `../acceptance/evidence/integration-merge-tree.txt` |
| Combined tree: 32/33 suites, 241/242 tests, one failure named | `../acceptance/evidence/test-run-modelled-integration.txt` |
| M1 files land byte-identical in the merged tree | merged-tree inspection, same file |
| Branch gates: 30 suites / 229 tests green | `../acceptance/evidence/test-run-branch.txt` |

Reproduce the merge geometry without writing anything:

```bash
git fetch --prune origin
git merge-base HEAD origin/main
git merge-tree --write-tree HEAD origin/main | head -1     # hypothetical merged tree
git merge-tree --write-tree HEAD origin/main | tail -n +2  # the 26 conflicted paths
git diff --numstat origin/main HEAD -- <file>              # what each side holds
```

---

## Permalink

| Record | Value |
|---|---|
| Plan commit | `842662672316ec8bb5edec6d9ed84f2d5cb18af5` |
| Plan permalink | https://github.com/shyne240/monienaija/blob/842662672316ec8bb5edec6d9ed84f2d5cb18af5/docs/design-discovery-20261029/m1/acceptance/integration-plan.md |
| Branch | `arena/d4ef0b81-monienaija` |
| `main` reviewed | `39a9e504e3881911c94438321e7c60f771469d21` |
| Feature branch head at plan time | `6394c3d093bcb759c03b5ee6bf38130ec7180907` |
| M1 implementation | `d7a8af4eb2d049691cb6e5da9868eb32189e9bf9` |
| Acceptance review | `0e5475fc25185fe7ae5c334b2f3269a8a300a178` |

The commit after `8426626` is documentation-only and pins these permalinks to an immutable SHA.
