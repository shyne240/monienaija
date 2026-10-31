# Current-state evidence and validation

**These are screenshots of the existing Admin Web, not redesigned mockups.** Each image is visibly labeled “CURRENT UI / SYNTHETIC DATA”; it was taken on 2026-10-29 from the local Vite development build at baseline `d212c667c431b05b7b1771c27212e9dc7f360d17`. The bottom label is an annotation added outside the application after capture.

## Capture conditions

- Headless Chromium and Puppeteer ran locally. All `/api/` requests were intercepted and returned deterministic synthetic responses; **no backend or external provider was contacted**, no financial action was submitted, and no real credential/customer data was used. The synthetic browser-only principal had invented role/scope values solely to expose the navigation; it does **not** model a real person's entitlements or validate any access policy. The dashboard had no synthetic widgets and the directory had zero synthetic customers.
- Desktop viewport: 1440 × 900 CSS pixels; narrow web viewport: 390 × 844. Images use full-page capture, so vertical image dimensions may exceed the viewport. They are not native mobile app captures. Installed sandbox fonts lack some emoji glyphs, so missing/tofu icons may be an environment artifact, not a verified production defect.
- Login examples show source-provided placeholder text and the local-development-only notice; the password field is empty. Do not treat that local-only UI as the production login configuration.
- Captures cover a limited number of states: login, empty synthetic dashboard, empty synthetic customer directory, transaction trace/fee simulator, and narrow navigation. The rest of the inventory and audit are source-based inferences. No populated business data, auth flow, network error, real provider, native device, accessibility tree audit, usability study or production comparison was performed.

| Existing surface | Evidence | Observation within this test only |
|---|---|---|
| Admin sign-in, desktop | [Image](admin-login-desktop.png) | Centered form with associated labels; development notice is present in this build. |
| Admin sign-in, narrow web | [Image](admin-login-mobile.png) | Form fits 390px viewport in the sampled state. |
| Admin dashboard, desktop | [Image](admin-dashboard-desktop.png) | Seven expanded groups and a long raw-scope card dominate an artificially all-scope session; widgets are an empty mock. |
| Admin customer directory, desktop | [Image](admin-customer-directory-desktop.png) | Distinct servicing visual style, visible filter controls and empty-table state. |
| Admin transaction trace, desktop | [Image](admin-transfers-desktop.png) | Trace and simulator are two panels; the UI itself reports a global transaction search gap. |
| Admin transaction trace, narrow web | [Image](admin-transfers-mobile.png) | Viewport and main client width were 390px while main scroll width was 1038px; key fields extend beyond the initial viewport. |
| Admin navigation, narrow web | [Image](admin-navigation-mobile.png) | Overlay menu; all visible groups are expanded in this artificially all-scope session. |

For the narrow customer-directory state, a keyboard probe opened the menu, tabbed through its controls, then focused a background customer input after 37 Tabs; pressing Escape did not close the overlay. The toggle had an accessible name but no `aria-expanded`; the main content was not marked `inert`. This narrow scripted observation is not a full WCAG audit.

### Automated accessibility sample

An isolated `axe-core` 4.10.3 scan ran against the same local synthetic Admin states, with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` rule tags. It does not cover every criterion or dynamic state, and several contrast checks were marked incomplete. It is not a conformance audit.

| State | Automated result |
|---|---|
| Login, desktop | No violations reported in the sampled state; 15 rules passed. This is not a WCAG certification. |
| Dashboard, desktop | `color-contrast`: 2 nodes (including white logout text on red 3.76:1 and muted empty-dashboard text 2.45:1); 7 contrast checks incomplete. |
| Customer directory, desktop | `color-contrast`: 2 nodes (including subtitle 4.40:1); `scrollable-region-focusable`: 1 table wrapper; 7 contrast checks incomplete. Verify keyboard scrolling with populated data. |
| Transaction trace, desktop | `color-contrast`: 2 nodes; `label`: 4 fee inputs; `select-name`: 1 category select. Axe rates the label/name rules critical; our finding severity is a separate triage judgment. |
| Transaction trace, narrow | Same 4 unnamed fee inputs and 1 unnamed select; 1 contrast node. The separately measured 1038px scroll width is not an axe finding. |

Rule findings describe only elements in the synthetic states tested; no actual financial action was executed.

## Verification performed during discovery

| Check | Result at baseline | Boundaries |
|---|---|---|
| Admin Web `npm run ts:check` | Pass | Typecheck only. |
| Admin Web `npm run build` | Pass; Vite warns that a minified JS chunk is 1,055.63 kB (283.27 kB gzip), above the 500 kB warning threshold | Not a network performance benchmark. Output is ignored build material, not committed. |
| Admin Web `npm test -- --runInBand` | 27 suites, 187 tests passed | Tests do not establish usability, WCAG or backend authorization. |
| Agent Mobile `npm run ts:check` | Pass | Native UI not rendered. |
| Agent Mobile `npm test` | 20 suites, 297 tests passed | React test renderer emitted `act(...)` warnings; no native device. |
| Customer Mobile `npm run ts:check` | **Fails:** TS2344 on `FundWalletScreen.tsx:15` and `WithdrawScreen.tsx:15`: route names are absent from `RootStackParamList` | Existing, unregistered sandbox files; no fixes or route activation in discovery. |
| Customer Mobile `npm test` | 14 suites, 103 tests passed | React test renderer emitted `act(...)` warnings; tests include direct rendering of unregistered screens and do not prove their navigability. |
| Customer Mobile dependency install | Default `npm ci` under Node 22.22.3 / npm 10.9.8 failed dependency/lock validation; `npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund` succeeded | Existing manifest/lockfile were not changed; agree on a reproducible toolchain separately. |
| Proposed/current color pairs | Calculated using WCAG relative luminance for opaque sRGB pairs | See [token specification](../03-design-system.md); rendering, alpha, anti-aliasing, every state and every actual device still require verification. |

All installs used the repository's existing lockfiles in ignored `node_modules`; headless-browser tools were installed separately in a temporary external cache. No application source, dependency manifest, lockfile, API, database, financial logic or security control was changed in this discovery. No production-readiness claim is made; the pre-existing Arena 4 independent security acceptance remains open.
