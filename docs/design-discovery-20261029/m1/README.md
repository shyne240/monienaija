# M1 — Admin Web foundations and Customer Directory pilot

**Status:** implemented on `arena/d4ef0b81-monienaija`, pending Product/Design visual review, Accessibility manual-sign-off and authorization-owner parity sign-off. Not merged, not deployed, M2 not started.

**Baseline commit:** `57368852f20a2cad0845545bd945273fc6ca594a` — "docs: add M0 design validation and owner decision pack"
**Implementation commit:** see [Permalink](#permalink-and-commit-record) (this document is committed with the implementation).

---

## 1. Executive summary

M1 delivers the first controlled slice of the approved **Option 2 — Modern Minimal** direction with treasury-green branding:

- a scoped, light-only **semantic token layer** (`tokens.css`) whose contrast pairings were recomputed from relative luminance, not copied on trust;
- small **presentation primitives** (button, field, status badge, alert, scroll region, page header) with no domain, data-fetching or authorization logic;
- a redesigned **Admin shell**: compact treasury-green rail at ≥1024 CSS px, a labelled **modal navigation drawer** below it with focus entry/containment/restoration, Escape and backdrop dismissal, background scroll lock, a skip link and a single focus target after navigation;
- a redesigned **Customer Directory** pilot: page header, toolbar, dense semantic table inside a named, keyboard-focusable local scroll region, sticky row identity, text + shape + colour status cues, and **distinct loading / empty / failed / restricted / stale presentation states**;
- **42 new regression tests** in the three authorized suites plus the unchanged 187-test baseline.

Every behavioural invariant is preserved: 28 canonical views, 7 navigation groups, 9 legacy aliases, every scope/role/context guard, the `handleNav` guard and context clearing, contextual Customer 360° routing, logout, the `GET /internal/customers` contract, the 250 ms debounce, page size 20, filter keys, pagination, retry, masking, restricted-vs-not-recorded semantics, `customer.create` gating and the embedded registration wizard / Customer 360° workflows.

**Two truthful-state corrections were made inside the authorized directory file** (both required by M0 acceptance): a failed fetch no longer renders `0 customers` (it renders "Customer count unavailable"), and previously loaded rows retained after a failed refresh are labelled "previously loaded results — not yet confirmed" instead of asserting freshness.

**Not delivered, and not claimed:** pixel screenshots from a real browser, real keyboard/zoom/reflow runs, and NVDA/VoiceOver sessions. The M1 sandbox has **no browser engine and no way to install one** (see [§8](#8-accessibility-findings-and-limitations)). Per the M0 scope, that means **M1 cannot be marked accepted** yet.

---

## 2. Phase 0 — verification performed before any edit

| Check | Result |
|---|---|
| Branch | `arena/d4ef0b81-monienaija` — **not** the literal `arena/monienaija-frontend-m1`. This session is pinned to an Arena-named branch and cannot create, switch to or rename another. Rewriting history to satisfy the name was explicitly forbidden by the assignment, so the work was done here. **Owner decision required if the literal branch name matters for their tracking.** |
| Working tree at start | clean (`git status --porcelain` empty) |
| HEAD SHA at start | `57368852f20a2cad0845545bd945273fc6ca594a` — exactly the expected starting commit |
| M0 documentation commit | HEAD **is** the M0 commit; `git rev-parse HEAD:apps` = `77099e5a06167041ba3e178cf73157599093f537`, byte-identical to the application tree M0 reviewed. M0 changed documentation only. |
| Clone fidelity | the clone was shallow (depth 1), which initially made `origin/main` look unrelated. `git fetch --deepen=50` established the real merge base `3d05aae`; no reset/rebase/merge was performed. |
| Baseline vs `origin/main` | `origin/main` (`39a9e50`) is **84 commits ahead** of the merge base, including `apps/admin-web` changes (API config, build config, jest config, several tests). The assignment named `5736885` as the expected start and forbade merging/rebaselining, so it was used. See [§10](#10-remaining-issues-and-recommendations). |
| Other agents | only `main` and this branch exist locally; no worktree or remote branch from Arena 1/2/3/4 touches the ten allowlisted files. `navigation-access.ts` is untouched (verified in the diff). |
| Baseline gates | `tsc` exit 0; `vite build` OK (272 modules, 19.43 kB CSS); `jest` 27 suites / 187 tests green — matching M0's recorded 27/187. |

---

## 3. Authorized file scope — exact list changed

The only application files touched are the ten paths in `docs/design-discovery-20261029/m0/04-m1-scope.md`. Everything else is new documentation under `docs/design-discovery-20261029/m1/`.

| Path | Status | Role |
|---|---|---|
| `apps/admin-web/src/design-system/tokens.css` | **new** | Light semantic custom properties on three explicit scope selectors only (`.mn-shell`, `.mn-dir-header`, `.mn-dir-panel`), plus a reduced-motion block limited to pilot subtrees |
| `apps/admin-web/src/design-system/primitives.tsx` | **new** | `Button`, `Field`, `StatusBadge`, `Alert`, `ScrollRegion`, `PageHeader` — presentation only |
| `apps/admin-web/src/design-system/primitives.css` | **new** | Class-scoped styles for those primitives + `.mn-visually-hidden` |
| `apps/admin-web/src/screens/authenticated/admin-shell.css` | **new** | Shell structure, navigation, compact top bar, modal drawer, breakpoints, route-denied notice |
| `apps/admin-web/src/screens/authenticated/customer-directory-pilot.css` | **new** | Directory-only elements (`mn-dir-*`), container queries for toolbar/scroll cue |
| `apps/admin-web/src/screens/authenticated/Layout.tsx` | modified | Shell markup, scoped styles, drawer/focus logic; sections, guards, aliases, context, route switch, logout unchanged |
| `apps/admin-web/src/screens/authenticated/CustomerDirectoryScreen.tsx` | modified | Directory presentation states and markup; request/query/handler/permission/selection logic unchanged |
| `apps/admin-web/__tests__/m1-shell.test.tsx` | **new** | 14 tests: landmarks, disclosure, drawer keyboard/focus, route/guard/alias/context parity, logout |
| `apps/admin-web/__tests__/m1-customer-directory.test.tsx` | **new** | 16 tests: contract, debounce, pagination, four presentation states + stale, privacy, actions, semantics |
| `apps/admin-web/__tests__/m1-style-isolation.test.tsx` | **new** | 12 tests: selector discipline, `!important` policy, token scoping, shared-stylesheet integrity, embedded-workflow isolation |

**Not modified** (explicitly checked in `git diff --name-only`): `navigation-access.ts`, `customer-management.css`, `Customer360Workspace.tsx`, `CustomerRegistrationWizard.tsx`, every other screen, `customer-masking.ts`, `api-client.ts`, `auth-store.ts`, all manifests/lockfiles, backend, mobile apps, CI and deployment files. No dependency was added.

Deliberate non-obvious choices, recorded for review:

- **The shell no longer injects a `<style>` tag into `document.head`.** The baseline `Layout.tsx` appended a global `#layout-responsive-style` element at module scope; responsive behaviour now lives in the scoped `admin-shell.css`. This removes a global side effect rather than adding one.
- **Navigation labels are unchanged, including their leading pictographs.** Moving the emoji into a separate element broke exact-text regression assertions (`getByText` reads only direct text children), so the label stays one text node. An icon-set replacement is a Product/Design decision for M2 ([§10](#10-remaining-issues-and-recommendations)).
- **Logout copy changed** from `🚪 Log Out Session` to `Log out session` (shell) and `Log out` (drawer). Behaviour is identical; no test referenced the old string.

---

## 4. What was built

### 4.1 Tokens (`tokens.css`)

Light only. No `:root`, `html`, `body`, universal reset or global element selector. Declaring the custom properties is inert, so excluded screens cannot change appearance through inheritance; only pilot-owned classes consume them.

### 4.2 Primitives (`primitives.tsx` / `primitives.css`)

Semantic HTML with explicit `mn-` class contracts: variants `primary | secondary | quiet | danger`, sizes `sm | md`, disabled state never signalled by opacity alone, persistent field labels, status badges whose marker shape varies in addition to colour, and an alert whose live-region politeness is explicit.

### 4.3 Shell

| Requirement | Implementation |
|---|---|
| Compact desktop rail | 264 px (280 px at ≥1440) treasury-green rail, 34 px item rows, grouped disclosures, sticky 100 vh with its own scroll |
| Selected state | `aria-current="page"` + selected surface + weight + 3 px gold inset indicator (4.51:1 on the selected surface) — never colour alone |
| Compact breakpoint | < 1024 px replaces the rail with a 56 px sticky top bar and a modal drawer |
| Drawer contract | toggle has an accessible name, `aria-expanded`, `aria-controls`; drawer is `role="dialog"`, `aria-modal="true"`, labelled, containing a named `navigation` landmark |
| Focus management | focus enters the drawer (close button), Tab/Shift+Tab wrap inside it, focus escaping is pulled back, `Escape`/backdrop/close dismiss it, focus returns to the toggle, `body` scroll is locked while open |
| Route focus | a successful navigation closes the drawer and moves focus to the destination `h1` (or the workspace container), not back to the toggle; a **denied** navigation still returns early from the guard, implying no route change |
| Breakpoint change | a guarded `matchMedia('(min-width: 1024px)')` listener closes the drawer so focus is never stranded in a hidden overlay |
| Landmarks | skip link → `#mn-main-workspace` (focusable target), `nav[aria-label="Main navigation"]`, `nav[aria-label="Mobile navigation"]`; the shell deliberately adds **no** second `main` landmark around rendered screens |

### 4.4 Customer Directory pilot

- Page header (eyebrow, 32/28 px title, description, single primary "New Customer" action gated by `customer.create`, `aria-expanded` + `aria-controls` on the expanded wizard wrapper).
- Toolbar: labelled search (`type="search"`, 250 ms debounce preserved) and the four existing filters, laid out by **container query** so the grid responds to the width the panel actually has; a visible active-filter count, "Clear filters" (only when something is active) and "Refresh". Both controls only mutate existing local state (`reloadVersion`, the four filter states, `page`) — no new request shape, no write, no new endpoint.
- Result meta: truthful count, stale/unconfirmed flag, page position. **A failed fetch never prints a zero total.**
- Table: `<caption>`, `scope="col"` headers, tabular numerals, status badge (text + shape + tone), KYC level chip + raw KYC status, masked reference, permission-dependent contact cell (`Restricted` vs `Not recorded`), server-returned verification label, per-row action with the existing accessible name `Open Customer 360° for {name}`.
- Scroll: `role="region"` + accessible name + `tabIndex={0}` + `overflow-x: auto` on the viewport, sticky first column for row context, and a visible "Scroll horizontally…" cue driven by a container query.
- Pagination: `nav[aria-label="Customer directory pages"]` with the original `Previous` / `Next` accessible names, a truthful range summary and disabled states while loading.

---

## 5. Invariants preserved — evidence

| Invariant | How it is protected | Evidence |
|---|---|---|
| 28 canonical views, 7 groups, 9 aliases, guards, context clearing, route switch, logout | `Layout.tsx` edits are confined to markup/styles/drawer state; `navigation-access.ts` untouched | `git diff` shows no change to that file; `menu-visibility-11-roles.test.tsx` (11 roles × desktop + mobile × route rendering) still passes; `m1-shell` asserts alias canonicalisation, contextual-history access, approval/role-governance gating and that rendered nav items match `canAccessAdminView` |
| No authorization policy change | no backend, catalogue or guard edit | 229/229 tests, including `authorization` parity suites in the untouched set |
| Directory contract | `GET /internal/customers?page=&limit=` unchanged; 250 ms debounce; page size 20; filter keys `search/status/type/kycLevel/kycStatus`; pagination; retry; selection fetch `/internal/customers/:id` | `m1-customer-directory` asserts the exact URL, the debounce boundary (no request at 200 ms, request after 250 ms), the keys, page reset, and that every call stays on the same read endpoint |
| Masking / restricted vs not-recorded / server verification | presentation mapping only | `batch-01` and `customer-servicing` assertions unchanged; `m1-customer-directory` covers masked reference, `Verified`/`Not verified`, `Restricted` vs `Not recorded` |
| New Customer + Customer 360° untouched | the wizard and the workspace files are unmodified and still render with their own `cm-` classes | `m1-customer-directory` opens/closes the wizard and opens/returns from Customer 360°; `m1-style-isolation` proves no `mn-` class enters either subtree |
| No financial/security behaviour change | no file outside the allowlist touched | `git diff --name-only` |

---

## 6. Test, type and build results

All commands run in `apps/admin-web`.

| Gate | Baseline `5736885` | After M1 |
|---|---|---|
| `npx tsc` (`npm run ts:check`) | exit 0, no output | **exit 0, no output** |
| `npx vite build` (`npm run build`) | OK, 272 modules, CSS 19.43 kB, JS 1,055.63 kB | **OK, 272 modules, CSS 45.68 kB (gzip 9.01), JS 1,059.80 kB (gzip 284.88)**; pre-existing chunk-size warning unchanged |
| `npx jest --watchAll=false --runInBand` | 27 suites / 187 tests | **30 suites / 229 tests, all passing** (187 pre-existing + 42 new) |

No existing assertion was deleted, skipped or weakened. The three new suites are additive.

Baseline framework warnings that remain unchanged and are **pre-existing, not introduced here**: React `act(...)` notices from `DashboardScreen`'s widget loader, and a zustand snapshot notice. They appear identically at the baseline commit.

---

## 7. Visual evidence

**Method.** No browser engine was installable in the M1 sandbox (see §8), so instead of screenshots each artifact is a **self-contained static render**: the real React DOM serialised by React Testing Library after the real effects ran, with the real stylesheets inlined in the same order the production bundle uses. Responsive evidence is presented as fixed-width **iframes**, so the viewer's browser evaluates the CSS media and container queries at 1440 / 1024 / 768 / 390 / 320 CSS px.

**Synthetic data only.** The fixture is six invented records with masked references and masked contacts. No real customer, credential or transfer data appears.

| Artifact | Contents |
|---|---|
| [`evidence/after-responsive-gallery.html`](evidence/after-responsive-gallery.html) | **After** — shell + directory at 1440, 1024, 768, 390, 320 CSS px |
| [`evidence/after-drawer-gallery.html`](evidence/after-drawer-gallery.html) | **After** — modal drawer open at 390 and 768 |
| [`evidence/after-states-gallery.html`](evidence/after-states-gallery.html) | **After** — loading, successful empty, failed load, restricted contact, stale-after-failed-refresh (1024 and 390) |
| [`evidence/before-responsive-gallery.html`](evidence/before-responsive-gallery.html) | **Before** — baseline shell + directory at 1440, 768, 390, 320 + drawer open, rendered from an unmodified worktree at `5736885` |
| `evidence/after-shell-directory-loaded.html`, `after-shell-drawer-open.html`, `state-*.html` | Individual full-page renders referenced by the galleries |
| [`evidence/tools/generate-static-render.test.tsx`](evidence/tools/generate-static-render.test.tsx) | The generator (documentation tool, not part of the app suite); rerunning it reproduced the committed files byte-for-byte |

### 7.1 Before → after, at a glance

| Aspect | Baseline `5736885` | M1 |
|---|---|---|
| Shell palette | inline `#032B14` / `#FFB703` per-element style objects | tokenised treasury green (`#0B3D2E` rail, `#125C46` selected) with recomputed contrast |
| Sidebar width / rows | 280 px, 13 px rows, emoji-prefixed labels, uppercase gold group headers | 264 px (280 px ≥1440), 34 px rows, gold selected indicator, disclosure chevrons, nested group panels |
| Responsive rule | global `<style>` injected into `document.head` at module scope (`max-width: 768px`) | scoped `admin-shell.css`; rail ≥1024, compact bar + drawer below |
| Drawer | overlay `div`, no dialog role, no Escape handling, focus could move behind it | labelled modal dialog, focus entry/containment/restoration, Escape + backdrop, scroll lock |
| Focus after nav | none | destination heading focused |
| Skip link | none | present, first focusable, jumps to a focusable workspace target |
| Directory header | `.cm-page-header` with `.cm-eyebrow` | `PageHeader` primitive with 32 px (28 px narrow) title and one primary action |
| Filters | 5-column fixed grid, breaks below 1050/680 px | container-query grid: 1 → 2 → 5 columns by available width |
| Failure state | printed `0 customers` and an empty-looking table | "Customer count unavailable" + alert + Retry; retained rows labelled unconfirmed |
| Empty vs error | not distinguished | distinct `.mn-dir-state` empty panel vs `.mn-alert` failure |
| Table | `.cm-customer-table` inside an unfocusable `overflow: auto` div, no cue | semantic table in a named focusable region, sticky identity column, visible cue, `aria-busy` while loading |
| Status | colour-only `.cm-status-*` pills (below 4.5:1 for several states, per M0 UX04) | text + shape + tone; success/warning/danger/neutral pairings all ≥ 5.4:1 |
| Pagination | two buttons + inline text | same buttons/names, plus a truthful range summary and disabled states |

### 7.2 Evidence limitations (stated plainly)

- These are **DOM/CSS renders, not pixel screenshots**. Font rasterisation, scrollbar presence, sub-pixel layout and sticky behaviour are the viewer's browser's, not a captured reference.
- If a gallery frame is blank, the viewer is blocking local iframes; open the referenced HTML file directly.
- Nothing here is evidence of WCAG conformance.

---

## 8. Accessibility findings and limitations

### 8.1 Contrast — recomputed, not assumed

Computed with the M0 method (linearise, `L = .2126R + .7152G + .0722B`, `(L₁+.05)/(L₂+.05)`). Normal text ≥ 4.5:1, meaningful non-text boundaries and focus indicators ≥ 3:1.

| Pair | Ratio | Use |
|---|---:|---|
| `#132B25` on `#FFFFFF` | 15.00 | primary text on raised |
| `#132B25` on `#F5F8F6` | 14.03 | primary text on canvas |
| `#52655F` on `#FFFFFF` / on `#F5F8F6` | 6.20 / 5.80 | secondary text |
| `#5B6B66` on `#FFFFFF` / on `#F5F8F6` | 5.62 / 5.25 | muted text |
| `#FFFFFF` on `#0B624A` | 7.34 | primary button |
| `#0B624A` on `#E7F2EC` | 6.40 | secondary button hover |
| `#0B624A` on `#FFFFFF` / on `#F5F8F6` | 7.34 / 6.87 | focus ring |
| `#6D817A` on `#FFFFFF` / on `#F5F8F6` | 4.14 / 3.87 | control boundary |
| `#D3E4DA` on `#0B3D2E` | 9.23 | nav label |
| `#D3E4DA` on `#14493A` | 7.77 | nav label, hover |
| `#FFFFFF` on `#125C46` | 7.94 | nav label, current |
| `#D3E4DA` on `#125C46` | 6.00 | nav label, current (secondary) |
| `#E9BD63` on `#0B3D2E` / on `#125C46` | 6.93 / 4.51 | gold indicator + dark-surface focus ring |
| `#A9C3B7` on `#0B3D2E` | 6.49 | nav muted (brand subtitle) |
| `#FFD9D5` on `#0B3D2E` | 9.38 | logout label |
| `#7FA89B` on `#0B3D2E` | 4.63 | meaningful control border on dark |
| `#FFFFFF` on `#B3261E` | 6.54 | destructive button |
| `#146348` on `#E4F4EC` | 6.34 | success badge |
| `#8C5600` on `#FFF3D9` | 5.53 | warning badge |
| `#B3261E` on `#FDEBE9` | 5.68 | danger badge |
| `#2057A4` on `#EAF1FC` | 6.24 | info badge |
| `#52655F` on `#EEF2F0` / `#EEF3F0` | 5.49 / 5.53 | neutral badge / table header + chip |
| `#8C5600` on `#FFFFFF` | 6.09 | stale-result flag |
| `#132B25` on `#F6FAF8` | 14.25 | row text on hover |

Recomputation differs from the M0 table by ≤0.01 on three pairs (e.g. success 6.34 vs 6.35) — downstream rounding, not a conformance difference. Every rendered text, boundary and focus state I introduced clears its target **on the exact pairings used**; that is a calculation, not a rendered measurement.

### 8.2 Structure, keyboard and focus

Verified in jsdom (real listeners, real focus):

- skip link is the first focusable element and targets a real element; the drawer toggle exposes `aria-expanded`/`aria-controls`; sections expose `aria-expanded` + `aria-controls`; exactly one `aria-current="page"` at all times;
- focus enters the drawer, wraps at both ends, is recovered when it escapes, returns to the toggle on Escape/backdrop/close, and moves to the destination heading after a successful route change;
- `body` scroll is locked while the drawer is open and restored on close; `Escape` works even when focus has drifted;
- a denied navigation does not change the view and does not imply success;
- the status marker changes shape as well as colour (dot / square / hollow) and the textual label is always present;
- reduced-motion is honoured through a `prefers-reduced-motion` block confined to pilot subtrees.

### 8.3 Limitations — what has **not** been done

1. **No browser engine.** `npx playwright install chromium` fails (Playwright CDN is not reachable from this sandbox); no Chromium/Firefox/WebKit binary exists and no system packages can be installed. Consequently there are **no real-browser keyboard runs, no 200 %/400 % zoom or reflow measurement, no rendered computed-style or contrast sampling, and no pixel screenshots.**
2. **No assistive-technology session.** NVDA + Windows and VoiceOver + Safari were not run. Chromium accessibility-tree inspection was not possible either.
3. **No automated axe/Lighthouse scan** — colour-contrast and layout-dependent rules are meaningless without a rendering engine, and a jsdom-only run would be misleading evidence.
4. **jsdom cannot evaluate CSS**, so responsive behaviour is enforced by construction (container queries + media queries + class discipline) and by the selector-discipline test, not by measurement.
5. **Container queries** need a 2023+ browser. Older engines fall back to the viewport media queries, which keep the toolbar and table usable but show the scroll cue at ≤900 px viewport rather than ≤900 px panel.
6. Sticky first column, sticky top bar and drawer animation have not been observed in a real browser.

Because of 1–3, the M0 rule applies unchanged: **M1 is not accepted** until desktop keyboard, zoom and real screen-reader runs are recorded with browser and AT versions.

---

## 9. CSS isolation strategy

- Every pilot rule is a class selector rooted in `mn-`; the isolation suite parses all four pilot stylesheets and fails on `:root`, `html`, `body`, a bare `*`, any `.cm-` selector, or any selector that is not tied to `.mn-`.
- `!important` appears only inside the reduced-motion block of `tokens.css`, and that block only reaches pilot-owned subtrees.
- Tokens are declared on exactly three scope selectors and are inert unless consumed.
- The directory's `<main>` keeps **only** its pre-existing `customer-management` class: no pilot typography or colour is inherited by the embedded registration wizard or Customer 360°, which keep their `cm-` contract. The wizard is wrapped in a plain `.mn-dir-registration` element used solely as an `aria-controls` target and it carries no declarations.
- Pilot class names are proven disjoint from the 200+ shared `cm-` classes.
- `customer-management.css` is untouched and still contains its `cm-` rules for the embedded workflows.
- The shell's content container adds no `overflow: hidden`, no `display: none` and no fixed height, so excluded screens keep scroll access (including the existing transfer screen's horizontal overflow, which M1 neither fixes nor worsens).

---

## 10. Remaining issues and recommendations

| # | Item | Owner / action |
|---|---|---|
| 1 | **Browser, zoom and screen-reader acceptance is outstanding** (see §8.3). | Accessibility/QA before M1 acceptance |
| 2 | **Baseline choice.** Work started from `5736885` as instructed. `origin/main` (`39a9e50`) is 84 commits ahead and already changes `apps/admin-web` config, jest setup and several tests. The diff must be re-validated against that baseline before integration; a rebase/merge was explicitly out of scope here. | Platform owner + Admin lead |
| 3 | **Branch name** is Arena-pinned (`arena/d4ef0b81-monienaija`), not `arena/monienaija-frontend-m1`. | Product/platform owner to confirm acceptance |
| 4 | Nav labels still carry emoji pictographs because removing them breaks existing exact-text assertions and changes accessible names. Replacing them with a designed icon set needs Product/Design sign-off **and** test updates. | Design + Admin lead, M2 |
| 5 | The directory page canvas comes from the shared `customer-management.css` (`#f4f8f6`) and differs by 1–2 levels from the shell canvas (`#f5f8f6`). Not "fixed" from the pilot because that class is shared and outside the allowlist. | M2, alongside the shared-stylesheet migration |
| 6 | The pilot adds two read-only toolbar controls (Refresh, Clear filters) that only mutate existing local state. Flagged for reviewer confirmation that this is presentation, not new function. | Product/Admin lead review |
| 7 | The `New Customer` label still toggles to `Close registration` (baseline behaviour, unchanged). A one-way "New Customer" + wizard close button would be a behaviour change and was not made. | M2 decision |
| 8 | Loading uses a pulsing dot rather than skeleton rows; with several hundred rows a skeleton would raise the density question again. | Design, M2 |
| 9 | Dark mode intentionally not implemented. | Separate owner decision |
| 10 | Arena 4's independent security acceptance is untouched by this work; M1 does not close or overlap it. | Arena 4 |

**Not started, as instructed:** M2, Customer Mobile, Agent Mobile, any backend, contract, schema, provider, financial, ledger or authorization change, and any merge or deployment.

---

## 11. Reviewer checklist

1. `git diff --name-only` against the ten-path allowlist — no manifest, lockfile or unrelated file.
2. Confirm `apps/admin-web/src/screens/authenticated/navigation-access.ts` and `customer-management.css` are untouched.
3. Review the drawer/focus effect and the `handleNav` diff in `Layout.tsx` for guard and context parity.
4. Review the request spies in `m1-customer-directory.test.tsx` (exact URL, debounce boundary, no writes).
5. Open the evidence galleries; compare `before-responsive-gallery` with `after-responsive-gallery`.
6. Run the three new suites plus the 11-role suite.
7. Record Product/Design visual approval, Accessibility manual results and authorization-owner parity sign-off — none of which this document can supply.

## 12. Reproduction

```bash
cd apps/admin-web
npm ci
npx tsc                                  # type check
npx vite build                           # production build
npx jest --watchAll=false --runInBand    # 30 suites / 229 tests

# regenerate the visual evidence (documentation tool, not an app test)
cp ../../docs/design-discovery-20261029/m1/evidence/tools/generate-static-render.test.tsx __tests__/zz-evidence-generator.test.tsx
MN_EVIDENCE_OUT=$PWD/../../docs/design-discovery-20261029/m1/evidence \
  npx jest __tests__/zz-evidence-generator.test.tsx --runInBand
rm __tests__/zz-evidence-generator.test.tsx
```

The baseline renders in `evidence/` were produced by the same serialisation method from an unmodified `git worktree` at `5736885`.

---

## Permalink and commit record

| Record | Value |
|---|---|
| Baseline | `57368852f20a2cad0845545bd945273fc6ca594a` |
| Branch | `arena/d4ef0b81-monienaija` |
| Report permalink | `https://github.com/shyne240/monienaija/blob/M1_IMPLEMENTATION_SHA/docs/design-discovery-20261029/m1/README.md` |

The `M1_IMPLEMENTATION_SHA` placeholder above is replaced by the final commit SHA in the commit that follows this document; the SHA is also stated in the hand-over message and in the commit log on the branch.
