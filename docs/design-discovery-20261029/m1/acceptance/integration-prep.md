# Admin Web integration preparation — status report

**Authorisation:** Product Owner approved the integration approach and authorised preparation of the
**Admin Web integration work only**, on a temporary branch cut from the latest `main`. Merging into
`main`, deployment and M2 are explicitly **out of scope**.

**Branch:** `arena/d4ef0b81-monienaija`
**Base for integration:** `origin/main` = `39a9e504e3881911c94438321e7c60f771469d21` (unchanged since
the integration plan; verified by `git fetch --prune`).
**Merge base:** `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510`.

---

## 1. What completed

The four Admin Web conflict files are **resolved and verified**. They were built in a throwaway
integration tree (`/tmp/aw-int` = latest `main` + this branch's complete `apps/admin-web`), because this
branch must not be merged and `main` must not be touched.

| # | File | Resolution | Owner rule applied |
|---|------|-----------|--------------------|
| 1 | `apps/admin-web/src/config/index.ts` | Adopted `main`'s build-injected model (`__ADMIN_API_BASE_URL__`, `__ADMIN_DEV_AUTH_MOCK__`). Production values are always injected by `define`, so a shipped bundle never evaluates a fallback. `''` (fail-closed) remains the production default for an unset URL; `DEV_AUTH_MOCK` stays `false` for every production build regardless of environment. The only code that still evaluates a fallback is guarded by `process.env.NODE_ENV !== 'production'`, i.e. jest/ts-node/local dev. Residual risk worth noting: a hypothetical non-Vite bundler that both skips `define` **and** leaves `NODE_ENV` unset would take the `/api/v1` branch — Vite is the only bundler in this repo, so that path does not exist today. | Preserves main's fail-closed config **and** the branch's working local dev/test behaviour. |
| 2 | `apps/admin-web/src/services/api-client.ts` | This branch's file, plus `main`'s `assertApiBaseUrlConfigured()` guard, called **only** from `request()` — exactly the scope `main` ships. Net diff vs branch: **+12 lines**. | Does not touch `postForm`/`requestBlob`, so all three real document upload/download call sites keep working (a wider guard broke 4 of them). |
| 3 | `apps/admin-web/vite.config.ts` | Union: this branch's plugins, `host: 0.0.0.0`, `allowedHosts: true` and `/api` proxy **+** `main`'s `define` block driven by `resolveAdminBuildConfig` **+** a development-only `/api/v1` proxy fallback. | Keeps main's injection path and the branch's live-preview/dev proxy. |
| 4 | `apps/admin-web/src/store/auth-store.ts` | **No code change required.** The branch already carries the `typeof onWorkforceSessionExpired === 'function'` guard plus `loginWithPassword`, `restoreSession` and `logout`. Verified byte-identical to branch HEAD. | Nothing from `main` lost, nothing from the branch lost. |

Preserved from `main`: fail-closed API guard, `build-config.ts` `define` wiring, explicit
`DEV_AUTH_MOCK` opt-in, request-shape assertions, and main's four security test suites.
Preserved from this branch: the complete Admin Web application including the M1 redesign (99 files),
`loginWithPassword`, the session-expiry listener, `getBlob`/`postForm`, and the dev proxy/`allowedHosts`.

Nothing outside `apps/admin-web` was modified: `diff -rq` against a pristine `git archive origin/main`
reports differences only in `apps/admin-web` (plus two temporary, uncommitted backend files — see §3).

## 2. Test results

Measured in the integration tree with the two backend modules of §3 present (they are **not** part of
this branch's commit and were only placed there to measure the Admin Web slice):

| Check | Result |
|-------|--------|
| `tsc --noEmit` | **0 errors** |
| Jest (full Admin Web suite) | **33/33 suites, 242/242 tests pass** |
| `production-auth-safety`, `api-client-config`, `api-client-request` (main's suites) | **PASS** |
| `vite build` (no `ADMIN_WEB_API_BASE_URL`) | **exit 0** — bundle contains **0** occurrences of `/api/v1`, i.e. the non-production fallback is unreachable; fail-closed guard string present |
| `vite build` with `ADMIN_WEB_API_BASE_URL` set | **exit 0** — injected URL present, **0** unresolved `define` placeholders |

The last two rows are the proof that this resolution does not quietly reintroduce a production hazard:
with no URL configured the shipped bundle has no localhost/default endpoint at all.

## 3. What remains — blocking dependency (instruction 8)

`apps/admin-web` imports two backend-owned modules that **do not exist on `main`**:

- `src/customer/customer-validation.ts`
- `src/customer-proof-of-address/` (19 files, incl. `customer-proof-of-address.constants.ts`)

On `main`, `src/customer` holds 19 files against this branch's 29, and `src/customer-proof-of-address`
does not exist at all. Without them the Admin Web slice reports **16 `tsc` errors** and **18 of 33 test
suites** fail to load — every one of those failures traces to these two imports.

Adding them is a **backend/another-owner** change (auth/payment/customer domain files, outside the four
files I was authorised to resolve), so I did **not** copy them into `main`, commit them, or fold them
into this branch. The Admin Web integration cannot be declared complete until their owner lands them on
the integration line; that is the dependency this report raises.

Remaining work therefore: (a) that owner's `src/customer` / `src/customer-proof-of-address` decision;
(b) a re-run of the checks in §2 on a line that contains it; (c) the merge itself — not authorised here,
and not a decision for this branch.

## 4. Open question for Product / test owner

`main`'s rules make `DEV_AUTH_MOCK` false outside a development build. In the jest environment there is
no Vite `define`, and `NODE_ENV` is `test`, so the fallback in §1 row 1 yields the branch's previous
local behaviour — which is why the full suite is green. The behaviour question this leaves open is a
product one, not a merge one:

> With `DEV_AUTH_MOCK=false`, the internal development OIDC/Bootstrap panel is not reachable. Is that the
> intended production posture (in which case the branch's dev-only panel stays dev-only and no shipped
> path regresses), or must that panel remain reachable outside development?

Either answer is implementable, but a change to that expectation belongs to the test/security owner, not
to this merge. I did not weaken `app.test.tsx` or `production-auth-safety.test.ts`, and no assertion was
relaxed to manufacture a pass — the suite passes because the config fallback reproduces development
behaviour that production strips out (verified in §2).

## 5. Scope confirmation

No merge into `main`. No push to `main`. No deployment. No M2. No changes to backend authorisation,
payments, mobile apps, package manifests/lockfiles, DB schemas, or another owner's files. This commit adds
documentation only.

## 6. Limitations

No browser engine is available in this environment (no Chrome/Chromium/Firefox; Playwright's download is
unreachable), so no screenshots, no manual pass and no assistive-technology testing were performed for
this integration step. The `vite build` checks above are build-output inspections, not visual QA. Nothing
here is a WCAG statement.
