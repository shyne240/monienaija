# M1 independent acceptance readiness and integration review

**Assessment only.** No application code was modified, no dependency added, no merge, rebase, reset, cherry-pick, force-push, deployment or M2 work was performed. Nothing outside `docs/design-discovery-20261029/m1/acceptance/` was written to this branch.

**Date:** 30 October 2026 · **Assessor:** frontend implementation agent (self-assessment, not an independent third party)

---

## 0. Verdict

| Dimension | Verdict |
|---|---|
| **Implementation completion** | **COMPLETE** — all ten allowlisted files delivered; 30 suites / 229 tests pass; `tsc` and production build clean; no divergence from the approved scope. |
| **Integration safety** | **CONDITIONALLY SAFE** — M1 adds **zero** merge conflicts and lands intact, but three pre-existing branch↔`main` incompatibilities must be resolved by their owners first (§3.3). |
| **Acceptance completion** | **NOT READY** — the mandatory real-browser, keyboard, zoom/reflow and assistive-technology evidence **cannot be produced in this environment** (§5). Per the M0 rule "lack of required manual assistive-technology evidence means M1 is not accepted", this milestone cannot be signed off here. |

**Overall: NOT READY for acceptance. Implementation complete; integration conditionally safe.**

Nothing found in this review blocks the *code*: no M1 defect was discovered that requires a code change before integration. What blocks *acceptance* is missing evidence, and what blocks *integration* is unrelated pre-existing divergence between the development branch and `main`.

Criteria that would change the verdict are listed in §9.

---

## 1. Exact SHAs, branch and baseline

| Item | Value |
|---|---|
| Assigned (pinned) branch | `arena/d4ef0b81-monienaija` |
| Current HEAD (docs head at review start) | `53d87f9f523145fb4494c6a10df43d76df4e0270` |
| M1 implementation commit | `d7a8af4eb2d049691cb6e5da9868eb32189e9bf9` |
| M1 starting baseline | `57368852f20a2cad0845545bd945273fc6ca594a` |
| `origin/main` (re-fetched during this review) | `39a9e504e3881911c94438321e7c60f771469d21` |
| Merge base (`HEAD` ⟷ `origin/main`) | `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` |
| Divergence (main ahead / branch ahead) | **55 / 110** commits |
| Working tree at review start | clean |
| Remote branches available | `origin/main`, `origin/arena/d4ef0b81-monienaija` (no other agent branches are visible in this remote) |

`origin/main` was **re-verified, not assumed**: a fresh `git fetch --prune origin` returned `39a9e50` unchanged, so the main SHA reported previously is still current as of this review.

**Correction to the M1 report.** The M1 report stated that `main` is "84 commits ahead" of the merge base. That figure was wrong: 84 was the *file count* from `git diff --stat`, not a commit count. The measured divergence is **55 commits on `main`** and **110 on the branch**. The M0 documentation is unaffected, but the M1 report's §2 and §10 item 2 overstate `main`'s distance and should be read with this correction.

**Branch-name deviation restated:** the assignment names `arena/monienaija-frontend-m1`; this session is pinned to `arena/d4ef0b81-monienaija` and cannot switch or rename. Same base commit, same content.

---

## 2. The decisive finding: `origin/main` is not a viable integration target for M1

This is the most important result of the review and it changes how integration must be planned.

**`origin/main` contains only a 30-file Admin Web skeleton. This branch contains a 99-file Admin Web implementation.** M1 was built on the latter (the assignment's stated baseline), and it depends on files that **do not exist on `main` at all**:

| M1 dependency | On `origin/main`? |
|---|---|
| `screens/authenticated/navigation-access.ts` | **ABSENT** — all 28 views, 7 groups, 9 aliases and every guard live here |
| `screens/authenticated/customer-management.css` | **ABSENT** |
| `screens/authenticated/Customer360Workspace.tsx` | **ABSENT** |
| `screens/authenticated/CustomerRegistrationWizard.tsx` | **ABSENT** |
| `screens/authenticated/customer-masking.ts` | **ABSENT** |
| **14 of the 21 screens** imported by `Layout.tsx` (`AgentNetworkScreen`, `NotificationManagementScreen`, `SupportTicketsScreen`, …) | **ABSENT** (7 are present) |
| `design-system/*` (M1's own new files) | ABSENT (expected — they are new) |

Applying M1's ten files directly onto `main` was tested in a disposable tree: **23 TypeScript errors**, all "Cannot find module" or prop-shape mismatches (`evidence/counterfactual-m1-onto-main.txt`). `main`'s `DashboardScreen` and `TransactionObservabilityScreen` do not even accept the props M1's `Layout` passes.

**Consequence:** M1 cannot be integrated into `main` on its own. Integration must be **branch → `main`** (bringing the whole Admin Web implementation, of which M1 is the latest layer), not **M1 → `main`**. The Product Owner should confirm the intended vehicle; the "merge M1 into main" framing implied by the assignment is not technically possible without also merging 109 other commits.

---

## 3. Integration compatibility

### 3.1 M1 file status matrix

| M1 file | New / modified | Changed on `main` since base? | Merge conflict? | Lands intact? |
|---|---|---|---|---|
| `src/design-system/tokens.css` | new | n/a (new) | no | **yes** |
| `src/design-system/primitives.tsx` | new | n/a (new) | no | **yes** |
| `src/design-system/primitives.css` | new | n/a (new) | no | **yes** |
| `src/screens/authenticated/admin-shell.css` | new | n/a (new) | no | **yes** |
| `src/screens/authenticated/customer-directory-pilot.css` | new | n/a (new) | no | **yes** |
| `src/screens/authenticated/Layout.tsx` | modified | **no** | no | **yes** (merged blob identical to branch: `a5fc94a…`) |
| `src/screens/authenticated/CustomerDirectoryScreen.tsx` | modified | **no** | no | **yes** |
| `__tests__/m1-shell.test.tsx` | new | n/a | no | **yes** |
| `__tests__/m1-customer-directory.test.tsx` | new | n/a | no | **yes** |
| `__tests__/m1-style-isolation.test.tsx` | new | n/a | no | **yes** |

Verified against the hypothetical merged tree `8c93b1d1eef4bec7c72a59024a016100eaac2ad4` produced by `git merge-tree` (which writes nothing): all ten M1 files, the design-system directory and all three M1 suites are present and byte-identical to the branch. `evidence/integration-merge-tree.txt`.

**M1 contributes no merge conflict and no conflict resolution decision.**

### 3.2 What `main` changed inside Admin Web (9 files), and its effect on M1

| `main` change | Effect on M1 |
|---|---|
| `jest.config.js` — `testEnvironment: 'jsdom'` (both sides changed this line to the same value) | **Merges cleanly to the union.** The branch's CSS `moduleNameMapper` + `moduleDirectories` survive; verified in the merged tree. This was a real risk (a lost CSS mapper would silently break all 30 suites) and it does **not** materialise. |
| `src/config/build-config.ts` (new), `src/config/index.ts`, `vite.config.ts`, `src/store/auth-store.ts`, `src/services/api-client.ts` | **Conflicted.** See §3.3 — these are the only functional incompatibilities. |
| `__tests__/api-client-config.test.ts`, `api-client-request.test.ts`, `production-auth-safety.test.ts` (new) | Added by the merge and run against the branch's implementation → 2 pass, **1 fails** (§3.3). |

### 3.3 The 26 conflicted paths — none owned by M1

`git merge-tree` reports exactly **26 conflicted paths**, grouped by owning stream:

| Group | Paths | Owner |
|---|---|---|
| Backend authorization | `src/authorization/{route-policy-registry, runtime-access.guard, workforce-administration.controller, workforce-oidc.service, workforce-session.service}.ts` | Arena 3 / authorization |
| Backend config & financial controllers | `src/config/environment.ts`, `src/{deposit,transfer,wallet,withdrawal}/*.controller.ts` | Platform config / financial streams |
| Root manifests | `package.json`, `package-lock.json` | Platform owner |
| Admin Web (4) | `src/config/index.ts`, `src/services/api-client.ts`, `src/store/auth-store.ts`, `vite.config.ts` | Admin Web lead |
| Customer Mobile (4) | `__tests__/transfer.test.tsx`, `src/config/index.ts`, `src/screens/unauthenticated/LoginScreen.tsx`, `src/store/auth-store.ts` | Mobile owner |
| Backend specs / repo meta | `test/external-reconciliation.service.spec.ts`, `test/production-readiness.spec.ts`, `.env.example`, `.gitignore`, `README.md` | Respective owners |

**None of these is an M1 file.** All 26 predate M1 and represent the development branch's distance from `main`.

### 3.4 Functional incompatibility found (1), and its consequence

Modelled merge — branch tree **+** the four `main`-only Admin Web files, with the four conflicted Admin Web files resolved in favour of the branch (the natural choice, since the branch's versions are the ones the 99-file implementation compiles against):

| Gate | Result |
|---|---|
| `tsc` | **0 errors** |
| `jest` | **32 of 33 suites pass; 241 of 242 tests pass** |
| Failing test | `__tests__/api-client-config.test.ts` › *"refuses to send requests when the build did not configure an API base URL"* |
| Reason | `main` added a fail-closed guard to `request()`: `if (!API_BASE_URL) throw new NetworkError(...)`. **The branch's `api-client.ts` does not have it**, so the client calls `fetch` even when no base URL is configured. `main`'s test asserts `fetch` is never called. |

This is a **production-safety gap on the branch that M1 inherited** (M1 did not touch `api-client.ts`; it was already in this state at `5736885`). It is pre-existing, not introduced by M1, and it is not in the M1 allowlist — but it must be fixed during integration, because a build with no `ADMIN_WEB_API_BASE_URL` currently issues requests against a relative URL instead of failing closed.

The reverse direction also matters: `main`'s `api-client.ts` **removed** `getBlob`, `postForm` and `onWorkforceSessionExpired`. The branch uses them at **3 real call sites** (`CustomerProofOfAddressPanel.tsx`, document upload/preview) plus `auth-store.ts`, which imports `onWorkforceSessionExpired` to clear an expired session. Resolving that conflict in favour of `main` would therefore **not compile**. Likewise `main`'s `auth-store.ts` dropped `loginWithPassword`, referenced at **6** places across the branch's `LoginScreen` and tests.

**Therefore the required resolution is additive:** keep the branch's `api-client.ts` / `auth-store.ts` / `config/index.ts` surfaces and port `main`'s fail-closed base-URL guard plus its `build-config.ts` wiring into them.

### 3.5 Do the Admin APIs and component interfaces M1 relies on stay valid?

| Interface | Status |
|---|---|
| `GET /internal/customers` (page, limit, search, status, type, kycLevel, kycStatus) | **Unchanged.** M1 modified no backend file (`git diff 5736885 HEAD -- src/ test/` is empty). `main` did not modify `src/customer/` since the merge base, so the merge takes the branch's customer module wholesale — no contract drift. |
| `GET /internal/customers/:id` | Unchanged for the same reason. |
| `navigation-access.ts` guard signatures | **Unchanged file** — byte-identical to `5736885`. |
| `Customer360Workspace`, `CustomerRegistrationWizard`, `customer-masking`, `customer-management.css` | **Unchanged files.** |
| `ApiClient` surface used by the directory (`get`) | Present on both sides. |
| `ApiClient` surface used by *other* screens (`getBlob`, `postForm`) | Present only on the branch — see §3.4. |

### 3.6 Exact changes needed for a clean integration

1. **Choose the vehicle:** merge `arena/d4ef0b81-monienaija` → `main` (whole Admin Web implementation), not M1 alone (§2). Owner: Platform owner + Admin lead.
2. **Resolve the 26 conflicts**, of which only 4 are Admin Web: keep the branch's `api-client.ts`/`auth-store.ts`/`config/index.ts` **and add** `main`'s fail-closed base-URL guard; keep the branch's `vite.config.ts` while retaining `main`'s `ADMIN_WEB_API_BASE_URL` define/build-config wiring. Minimum acceptance for this step: `getBlob`/`postForm`/`onWorkforceSessionExpired`/`loginWithPassword` still resolve **and** `api-client-config.test.ts` passes. Owners: Admin Web lead (4 files); Arena 3/authorization (5); financial/config streams (6); Mobile owner (4); Platform owner (manifests); content owners (`.env.example`, `.gitignore`, `README.md`, 2 specs).
3. **Re-run the three gates after resolution** and confirm 33 suites / 242 tests green including `api-client-config.test.ts`.
4. **Re-validate the baseline** recorded in the M1 report: M1's own tests were written against `5736885`; they pass unchanged on the combined tree (verified), so no test change is required.

---

## 4. Test execution results

| Run | Command | Result |
|---|---|---|
| **Assigned branch** (tree clean, `53d87f9`) | `npx tsc` | **0 errors** |
| | `npx vite build` | **OK** — 272 modules, CSS 45.68 kB (gzip 9.01), JS 1,059.80 kB |
| | `npx jest --watchAll=false --runInBand` | **30 suites / 229 tests passed** — 187 pre-existing + 42 M1 |
| **Modelled post-integration** (`/tmp`, branch + 4 `main`-only files) | `npx tsc` | **0 errors** |
| | `npx jest` | **32/33 suites, 241/242 tests** — sole failure is `main`'s `api-client-config.test.ts` (§3.4) |
| **Counterfactual: M1 onto `origin/main`** (`/tmp`) | `npx tsc` | **23 errors** — missing modules (§2) |

Evidence: `evidence/test-run-branch.txt`, `evidence/test-run-modelled-integration.txt`, `evidence/counterfactual-m1-onto-main.txt`.

No test was modified, skipped, weakened or deleted in any run; the disposable trees were copies under `/tmp` and the assigned branch working tree was clean throughout.

### 4.1 Preservation of navigation, permissions and directory contracts

Machine-checked from the compiled `navigation-access.ts` and the rendered DOM (`tools/navigation-audit.sh`, output below):

| Invariant | Expected | Observed |
|---|---:|---:|
| Canonical Admin views | 28 | **28** |
| Navigation groups | 7 | **7** (`home`, `servicing`, `money`, `finance`, `commercial`, `compliance`, `platform`) |
| Legacy aliases | 9 | **9**, all canonicalising (`ledger→ledgerExplorer`, `transactions→transfers`, `commercial→feeRules`, `compliance→kycQueue`, `riskfraud→fraudCases`, `roles→roleGovernance`, `approvals→approvalsInbox`, `workforce→workforceAccess`, `system→systemHealth`) |
| Alias ↔ canonical guard parity under a full-scope principal | identical decisions | **PASS** |
| Contextual customer history (`customer.view_transactions` + `customerId`) | true | **true** |
| Same view without `customerId` (must not grant global access) | false | **false** |
| Role/permission matrix (11 roles × desktop + mobile nav) | unchanged | **unchanged** — `menu-visibility-11-roles.test.tsx` passes |
| Directory read contract, debounce, filters, pagination, retry | unchanged | **unchanged** — `m1-customer-directory`, `batch-01`, `customer-servicing` all pass |
| Masking / restricted-vs-not-recorded / verification label | unchanged | **unchanged** |
| New Customer + Customer 360° workflows | operational | **operational** — open/close/return asserted in `m1-customer-directory` |
| Logout from both surfaces | calls store | **calls store** — `m1-shell` |
| Route context clearing | clears on ordinary nav | **clears** (logic untouched; `Layout.tsx` diff reviewed) |

---

## 5. Real-browser evidence — **NOT AVAILABLE**

**No browser engine exists in this environment and none can be installed.** Full probe in `evidence/browser-availability.txt`:

- `chromium`, `chromium-browser`, `google-chrome`, `chrome`, `firefox`, `firefox-esr`, `wkhtmltoimage`, `webkit2png` — **all missing** from `PATH`;
- Playwright cache (`~/.cache/ms-playwright`) contains only metadata, **no browser binaries**; no Puppeteer cache; a filesystem search found no Chrome/Firefox binary anywhere;
- `npx playwright@1.64.1 install chromium` → **`Download failure, code=1`** — the Playwright/CDN hosts are outside this sandbox's allowed egress (only GitHub, npm, PyPI are reachable);
- **no display server** (`DISPLAY` unset), so no X/Wayland path to a browser either.

Consequently the following Phase 3 items are **NOT DONE** and are **not claimed**:

| Required check | Status |
|---|---|
| Real Chromium rendering; screenshots with synthetic data | **NOT POSSIBLE** — no engine |
| Desktop 1440 / 1024, tablet 768, mobile 390 / 320 layout verification | **NOT DONE** in a browser. The only responsive material remains the static DOM/CSS renders published with M1, which are explicitly **not** browser evidence. |
| 200 % and 400 % zoom / reflow | **NOT DONE** — cannot be measured without a layout engine |
| Horizontal overflow and sticky-column behaviour | **NOT MEASURED**. Statically verified only: `minmax(0,1fr)` content column + `.mn-shell__content{min-width:0}` + `.mn-scroll-region__viewport{overflow-x:auto}` + `min-width:840px` table inside it (§7). |
| Drawer open/close, Escape, backdrop, focus restoration, destination focus | **Verified in jsdom only** (real event listeners and real `document.activeElement`), not with a real browser's sequential focus navigation |
| Keyboard-only traversal across the shell | **NOT DONE** end-to-end in a browser |
| Accessibility scans | **PARTIAL** — axe-core in jsdom, see §6 |

**What is missing, precisely:** a Chromium/WebKit/Firefox build, a display server or headless shell, and NVDA/VoiceOver. Any of the following would unblock it: a sandbox image with a pre-installed Chromium; network access to the Playwright CDN; or running these checks on a developer workstation and attaching results to this report.

---

## 6. Accessibility evidence and limitations

### 6.1 Automated scan (axe-core 4.10.2 in jsdom) — `evidence/axe-jsdom-scan.json`

| Document | Passing rules | Violations | Needs real browser |
|---|---:|---:|---|
| `after-shell-directory-loaded` | 37 | **0** | `landmark-one-main`, `page-has-heading-one` |
| `after-shell-drawer-open` | 40 | **0** | — |
| `state-loading` | 34 | **0** | landmark/heading |
| `state-empty` | 34 | **0** | landmark/heading |
| `state-error` | 33 | **0** | landmark/heading, `th-has-data-cells` |
| `state-restricted-contact` | 34 | **0** | landmark/heading |
| `state-stale-after-failed-refresh` | 34 | **0** | landmark/heading |
| **`before-shell-directory-loaded` (baseline)** | 29 | **1** (`region`, moderate, 2 nodes — sidebar branding + identity blocks outside any landmark) | multiple |
| **`before-shell-drawer-open` (baseline)** | 29 | **1** (same) | multiple |

**Net effect: M1 removes the single automated violation present in the baseline and raises the passing-rule count from 29 to 37–40 per document.** Three rules (`color-contrast`, `target-size`, landmark/heading visibility) could not be decided without a layout engine and are **not** counted as passes.

`color-contrast` was additionally probed with the rule enabled: it returns **incomplete**, not a violation, because jsdom has no layout/canvas — confirming that contrast remains a **calculated** result (§6.2), not a measured one.

### 6.2 Contrast

All pilot pairings were recomputed from relative luminance in the M1 report; the lowest ratios in play are the gold selected-state indicator **4.51:1** and the dark-surface control border **4.63:1** (both meaningful non-text ≥ 3:1), with all normal text ≥ 5.25:1. These remain **calculations against specified pairs**, not rendered measurements — the distinction matters at anti-aliasing and at zoom.

### 6.3 Structural, keyboard and focus behaviour (jsdom, real listeners)

Verified: single `main` landmark (shell adds none), skip link first and targeting a focusable node, drawer `dialog`/`aria-modal`/labelled, focus entry, containment both directions, recovery of escaped focus, Escape/backdrop/close dismissal, restoration to the toggle, destination-heading focus after a successful navigation, background scroll lock and release, one `aria-current="page"`, section `aria-expanded`/`aria-controls`, non-colour status cues, reduced-motion block scoped to pilot subtrees.

**Probe performed during this review (no defect found):** with *every* navigation group collapsed inside the drawer, 8 elements match the focusable selector but only 5 are visible; the focus trap's "last" element is still the visible Log out control, and Tab from it correctly wraps to the close button and stays inside the dialog. Recorded because a hidden-element ordering bug in the trap was plausible; evidence says it does not occur.

### 6.4 Outstanding accessibility limitations

1. No NVDA/VoiceOver/JAWS/Orca session — **not started**, environment has no AT and no display server.
2. No rendered contrast sampling, no target-size (2.5.8) measurement, no focus-obscured (2.4.11) check.
3. No 200 %/400 % reflow verification.
4. jsdom does not implement sequential focus navigation, so "keyboard-only traversal" is asserted, not observed.
5. `state-error` is flagged by axe for `th-has-data-cells` manual review: the table renders headers with a single full-width message cell. This is expected for an empty result set and remains a **manual-review item** for the browser pass.

---

## 7. Visual quality findings (static inspection only — ranked)

These come from reading the shipped CSS/DOM, not from looking at a rendered page. Severity is my assessment.

| # | Severity | Finding | Owner / note |
|---|---|---|---|
| V1 | **High (evidence gap)** | No rendered visual confirmation exists at any width; "premium and polished" cannot be asserted. | Blocked on browser availability (§5) |
| V2 | **Medium** | Navigation labels still carry emoji pictographs (`📊 👥 💸 …`) because removing them changes accessible names and breaks existing exact-text tests. Emoji render inconsistently across OS/font stacks, which works against the premium intent. | Product/Design decision + test update, M2 |
| V3 | **Medium** | Two canvas shades coexist: the shell uses `#F5F8F6`, the directory page inherits `#F4F8F6` from the shared `customer-management.css`. Not visible in the pilot (the white panel covers the area) but it is a latent inconsistency at panel edges and in the embedded workflows. | M2, shared-stylesheet migration |
| V4 | **Low** | At 320 CSS px the top-bar role badge can truncate mid-word (`max-width:45%` + `text-overflow: ellipsis` was added precisely to prevent overflow). Truncation is acceptable but unpolished; a shorter role token would be better. | Design, M2 |
| V5 | **Low** | The directory's empty/error message cell uses `min-width: 260px` inside a table that is `min-width: 840px`; on a 320 px screen the message itself requires horizontal scrolling to read in full. | Design, M2 (consider a non-table empty state) |
| V6 | **Low** | Loading state is a single pulsing dot plus text; no skeleton rows. Consistent, but less "polished" than a shaped skeleton. | Design, M2 |
| V7 | **Info** | Drawer width `min(340px, 86vw)` leaves a narrow backdrop strip at 320 px. | None |
| V8 | **Info** | The shell is `display: block` below 1024 px and a 2-column grid above; the 1023→1024 transition swaps the entire navigation surface (top bar → rail). Visually verified only by construction. | Browser pass |

No visual finding was found that contradicts the approved Option 2 direction or the M0 token specification.

---

## 8. Corrective actions, ownership and dependencies

| # | Action | Owner | Depends on | Blocking |
|---|---|---|---|---|
| C1 | Run the full browser matrix (1440/1024/768/390/320), zoom 200 %/400 %, keyboard traversal, drawer focus cycle; attach screenshots with synthetic data. | Accessibility/QA | A sandbox with Chromium, or a workstation | **Acceptance** |
| C2 | NVDA + Windows and VoiceOver + Safari sessions; record versions and findings. | Accessibility | Windows/macOS hosts | **Acceptance** |
| C3 | Decide the integration vehicle (branch → `main`, not M1 → `main`) and schedule it. | Product + Platform owner | §2 | **Integration** |
| C4 | Resolve the 26 conflicts; specifically port `main`'s fail-closed API base-URL guard into the branch's `api-client.ts` while keeping `getBlob`/`postForm`/`onWorkforceSessionExpired`. | Admin Web lead | C3 | **Integration** |
| C5 | Re-run the three gates on the merged tree and confirm 33 suites / 242 tests. | Admin Web lead | C4 | **Integration** |
| C6 | Decide on emoji → icon set (V2), including the test updates that change accessible names. | Design + Admin lead | Product sign-off | M2 |
| C7 | Migrate or reconcile the shared `customer-management.css` (V3) when the embedded workflows are redesigned. | Admin lead | M2 scope | M2 |
| C8 | Confirm branch-name acceptance (`arena/d4ef0b81-monienaija`). | Product/Platform | — | Governance |
| C9 | Independent security acceptance remains Arena 4's; this review neither duplicates nor closes it. | Arena 4 | — | Separate |

No corrective action requires a change to any M1 file. C4 and C5 touch files outside the M1 allowlist and therefore need separate authorization.

---

## 9. Verdict and what would change it

**Implementation: COMPLETE. Integration: CONDITIONALLY SAFE. Acceptance: NOT READY.**

To move **acceptance** from NOT READY, at minimum:
1. C1 — browser matrix + zoom/reflow + keyboard, with screenshots;
2. C2 — at least one real screen-reader session;
3. resolution of any critical/high defect those runs surface.

To move **integration** from CONDITIONALLY SAFE:
1. C3 — confirm branch → `main`;
2. C4 — the additive `api-client` resolution;
3. C5 — post-merge gates green (33 suites / 242 tests).

I am **not** able to certify WCAG 2.2 AA, visual fidelity, or production readiness from this environment, and I have not claimed any of them.

---

## 10. Reproduction

```bash
# ---- assigned branch gates
cd apps/admin-web
npm ci
npx tsc
npx vite build
npx jest --watchAll=false --runInBand

# ---- read-only integration assessment (writes nothing)
cd ../..
git fetch --prune origin
git rev-parse origin/main
git merge-base HEAD origin/main
git merge-tree --write-tree HEAD origin/main | head -1        # merged tree oid
git merge-tree --write-tree HEAD origin/main | tail -n +2     # conflicts

# ---- counterfactual: M1 onto origin/main (disposable)
mkdir -p /tmp/m1-onto-main
git archive origin/main | tar -x -C /tmp/m1-onto-main
git archive HEAD $(git diff --name-only 5736885 HEAD) | tar -x -C /tmp/m1-onto-main
cd /tmp/m1-onto-main/apps/admin-web && ln -s <repo>/apps/admin-web/node_modules . && npx tsc

# ---- modelled post-integration tree (disposable)
mkdir -p /tmp/m1-merged && git archive HEAD | tar -x -C /tmp/m1-merged
git archive origin/main apps/admin-web/src/config/build-config.ts \
  apps/admin-web/__tests__/production-auth-safety.test.ts \
  apps/admin-web/__tests__/api-client-config.test.ts \
  apps/admin-web/__tests__/api-client-request.test.ts | tar -x -C /tmp/m1-merged
cd /tmp/m1-merged/apps/admin-web && ln -s <repo>/apps/admin-web/node_modules . && npx tsc && npx jest --runInBand

# ---- automated accessibility scan (jsdom)
mkdir -p /tmp/a11y && cd /tmp/a11y && npm init -y && npm i axe-core@4.10.2 jsdom@25
node <repo>/docs/design-discovery-20261029/m1/acceptance/tools/axe-jsdom-scan.js \
  <repo>/docs/design-discovery-20261029/m1/evidence
```

## 11. Evidence index

| File | Contents |
|---|---|
| `evidence/browser-availability.txt` | Browser/AT probe: binaries, caches, download attempt, CDN reachability, display server |
| `evidence/axe-jsdom-scan.json` | axe-core results for 9 documents (7 M1, 2 baseline) |
| `evidence/integration-merge-tree.txt` | Heads, divergence, 26 conflicted paths, main's Admin Web changes, merged-tree inspection |
| `evidence/counterfactual-m1-onto-main.txt` | Proof that `origin/main` cannot host M1 alone (23 errors) |
| `evidence/test-run-branch.txt` | `tsc`, build, 30/229 on the assigned branch |
| `evidence/test-run-modelled-integration.txt` | `tsc` 0 errors, 32/33 suites, 1 failure and its cause |
| `tools/axe-jsdom-scan.js` | Reproducible scanner (documentation tool, not an app test) |
| `tools/navigation-audit.sh` | Reproducible 28 views / 7 groups / 9 aliases / guard-parity audit |

### Navigation audit output (captured)

```
canonical view list length: 28
legacy alias list length  : 9
aliases that canonicalise : 9
alias/canonical guard parity (all scopes): PASS
ctx history w/ customer.view_transactions only: true
ctx history without customerId                : false
section group ids: commercial, compliance, finance, home, money, platform, servicing  (7)
```
