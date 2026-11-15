# Customer visual acceptance (mission Stage 9) — status, evidence and exact blocker

Reference requirement: customer app reviewed at **390 × 844** through Expo web, screenshots persisted,
missing libraries reported precisely, and **no** claim of physical-device acceptance.

## Verdict

**NOT EXECUTED in this environment.** No pixel screenshot exists in this repository, and none is
claimed. What was executed is recorded below, together with the exact reasons the visual gate could
not run here and the one-command procedure that reproduces it on a browser-capable host.

| Item | Result |
| --- | --- |
| Expo web bundle builds from the consolidated app | **PASS** — 498 modules, `AppEntry-2e7a6efdb9ee69c3f2dc532be0a2a2d2.js`, 887,605 bytes |
| App mounts from the exported bundle and navigates | **PASS (DOM)** — see evidence below, 0 console/page errors |
| Screenshot capture at 390 × 844 | **BLOCKED** |
| Physical-device acceptance | **NOT PERFORMED and not claimed** |

## Why the visual gate is blocked here

1. **No browser binary.** Playwright 1.63.0 is present in `node_modules`, but no Chromium/WebKit build
   is installed and the download host is unreachable from the sandbox:

   ```
   $ npx playwright install chromium
   Error: Failed to download Chrome for Testing 153.0.8010.12 (playwright chromium v1243)
   Error: Download failure, code=1
   ```

   (`cdn.playwright.dev` is not in this environment's outbound allowlist; `~/.cache/ms-playwright` is
   empty and no system `chromium`, `chrome`, `firefox` or `wkhtmltoimage` exists.)

2. **Two web libraries are not part of the app manifest.** `react-native-web` and
   `@expo/metro-runtime` are what Expo web needs, and the customer app ships without them because a
   real web target is out of scope for the customer mission (the same scope decision Arena 4
   recorded). For this sandbox they were installed **without touching `package.json` or
   `package-lock.json`**:

   ```bash
   cd apps/customer-mobile
   npm install --no-save react-native-web@~0.19.13 @expo/metro-runtime@~4.0.1
   ```

   With them the export succeeds. `git status` confirms the manifest and lockfile are unmodified, so
   `npm ci` reproducibility for the shipped app is unaffected. Anyone who wants a permanent web
   target must add them deliberately and re-run the export gate.

## Evidence that was captured

`node scripts/customer-web-render-smoke.js` exports the real web bundle, loads it into a DOM
(`jsdom`), lets the app mount, presses the two entry actions and persists the **rendered text** of
each screen plus every console/page error:

- `docs/integration/arena3b-visual-evidence/render-smoke.json` — manifest (bundle identity, byte size,
  interactions, screens, errors)
- `docs/integration/arena3b-visual-evidence/*.render.txt` — one normalised text capture per screen

Observed on 2026-11-15 (UTC) — 0 console errors, 0 page errors, all captures non-blank:

| Capture | Observed |
| --- | --- |
| Entry screen | “👋 Welcome to MonieNaija … Fund wallets, send money, and withdraw easily in Nigeria. Log In to Account / Create New Wallet” |
| After “Log In to Account” | “Continue with your phone / Registration is temporarily unavailable. Identity verification must be available before a new account can be activated. Please try again later. / Back to Sign In / Create Wallet” |
| After “Create New Wallet” | same fail-closed registration entry (see note) |

The second and third captures are identical because the consolidated app routes both entry actions to
the same registration/login front door, and that door **fails closed** when no identity-verification
provider is configured — which is the correct production behaviour for a dependency this repository
does not have (register D-3 in the unified handoff). The label in the evidence files says only
"screen after pressing …", so the capture is not overstated as a login-screen verification.

What this evidence is: proof the customer bundle builds, mounts, renders real copy and reacts to
input without crashing. What it is **not**: a layout, contrast, typography or safe-area review, and
not device acceptance.

## Procedure for the owner of a browser-capable host

```bash
# 1. build the web target (already verified here)
cd apps/customer-mobile
npx expo export --platform web --output-dir ../../dist/customer-web

# 2. serve it
npx serve ../../dist/customer-web -l 8081

# 3. capture the acceptance screens at 390 x 844 (needs a browser binary)
cd ../.. && npx playwright install chromium
node scripts/customer-visual-acceptance.js --base-url http://127.0.0.1:8081 \
  --out docs/integration/arena3b-visual-evidence/screens
```

`scripts/customer-visual-acceptance.js` captures the nine acceptance screens (entry, login, rotation,
recovery, registration, dashboard, KYC/tier, add-money, transaction detail) at `390 × 844` with DPR 2,
writes a `manifest.json` and fails loudly if a browser binary is absent — it never silently "passes".

## Consequence for the acceptance record

Stage 9 remains **OPEN** as an environment limitation, recorded as such in
`docs/integration/MONIENAIJA-UNIFIED-APPLICATION-ACCEPTANCE-AND-HANDOFF.md` §C and §D. It must not be
listed as passed, and the mobile layout must not be described as visually accepted.
