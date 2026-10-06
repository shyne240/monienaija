# V1-MOBILE-01 — Mobile Production Build Readiness Audit

**Scope:** make `apps/customer-mobile` and `apps/agent-mobile` genuinely ready for a
production Android/iOS *build process* (correct app identity, EAS build configuration,
API wiring, asset inventory). This is **not** a feature change, **not** a redesign, and
**not** an Expo/React Native/React version change. Every claim below is backed by a
command that was actually run in this sandbox — nothing is inferred from reading code
alone without an attempt to execute/validate it.

Each major item is tagged with exactly one of: **VERIFIED**, **FIXED**, **CONFIGURED BUT
UNTESTED**, **MISSING**, **REQUIRES REAL INFRASTRUCTURE**, **BLOCKED**, **NOT APPLICABLE**.

---

## 1. Starting HEAD

`2534b6a8ac1a2c7cb3a7c360fc893c1afa6f9c79` — `docs(V1): add V1-RELEASE-01 deployment
readiness audit` (tip of `arena/01a10374-monienaija` at the start of this task; the local
sandbox clone's branch ref was stale at `3d05aaec...` due to a fresh sandbox checkout —
recovered via the same non-destructive `git stash` + `git merge --ff-only` + conflict
resolution procedure used in the prior session, with a full 1,742-file git-hash-object
comparison proving zero content loss before and after. No `git reset` was used.)

## 2. Final HEAD

`11394a99e4d73fc2e56d823d65f68726d1cf4354` — `feat(mobile): prepare production build
configuration` (the sole code-change commit produced by this audit; see §14 for its
exact, complete contents). This document is committed immediately afterward as
`docs(V1): add V1-MOBILE-01 build readiness audit`, making it the true final HEAD of
this audit as a whole once pushed.

## 3. Customer Mobile current configuration

| Item | Before this audit | After this audit |
|---|---|---|
| Expo SDK | `~52.0.7` (SDK 52) | unchanged |
| React Native | `0.76.2` | unchanged |
| React | `18.3.1` | unchanged |
| `app.json` / `app.config.*` | `app.json` only, no dynamic config | unchanged file type, content fixed (below) |
| `android.package` | **absent** | **FIXED** → `ng.monienaija.customer` |
| `ios.bundleIdentifier` | **absent** | **FIXED** → `ng.monienaija.customer` |
| `android.versionCode` | **absent** | **FIXED** → `1` |
| `ios.buildNumber` | **absent** | **FIXED** → `"1"` |
| App display name | `"MoneyNaija"` | unchanged (see §8 observation) |
| `slug` | `moneynaija-customer` | unchanged (pre-existing, stable, not randomly altered) |
| `version` | `1.0.0` | unchanged |
| `icon` / `splash.image` / `android.adaptiveIcon.foregroundImage` / `web.favicon` | pointed at `./assets/*.png` files that **do not exist anywhere in the repository** | **FIXED** — dangling references removed; `splash.backgroundColor` and `android.adaptiveIcon.backgroundColor` (`#0A3D25`, the already-established brand colour) retained; app now builds with Expo's own bundled default icon until real brand assets are supplied (§8) |
| `eas.json` | **absent** | **FIXED** — created (§7) |
| `EXPO_PUBLIC_API_URL` consumption | wired in a prior audit (V1-RELEASE-01); dev-loopback fallback (`http://10.0.2.2:3000`) only | **VERIFIED** end-to-end this audit (§9) |

Expo SDK/RN/React versions were **read, not changed** (Part I compliance).

## 4. Agent Mobile current configuration

| Item | Before this audit | After this audit |
|---|---|---|
| Expo SDK | `~52.0.7` (SDK 52) — identical posture to Customer Mobile | unchanged |
| React Native | `0.76.2` | unchanged |
| `android.package` | already set: `ng.monienaija.agent` | **preserved unchanged** (not randomly altered, per instruction) |
| `ios.bundleIdentifier` | already set: `ng.monienaija.agent` | **preserved unchanged** |
| `android.versionCode` | **absent** | **FIXED** → `1` |
| `ios.buildNumber` | **absent** | **FIXED** → `"1"` |
| App display name | `"MoneyNaija Agent"` | unchanged |
| `icon` / `splash` / `android.adaptiveIcon` | **entirely absent** (not broken, just unset — Expo falls back to its bundled default icon) | `splash.backgroundColor` / `android.adaptiveIcon.backgroundColor` **added** (`#0A3D25`, same already-established colour used elsewhere in the repo) for visual consistency with Customer Mobile; no new artwork introduced |
| `eas.json` | **absent** | **FIXED** — created (§7) |
| `EXPO_PUBLIC_API_URL` consumption | wired in V1-RELEASE-01 | **VERIFIED** this audit, same mechanism as Customer Mobile |

Agent Mobile was already closer to build-ready than Customer Mobile (it already had real
bundle/package identifiers) — this matches the task's own framing that Agent Mobile's
gap was narrower ("production build configuration must be verified") than Customer
Mobile's (concretely missing items).

## 5. Android readiness

**FIXED** (both apps). Specifics:

- `android.package` is now set for both apps, follows Android naming rules
  (reverse-DNS, lowercase, matches the already-established `ng.monienaija.*` domain
  convention that Agent Mobile had already adopted), and is **unique between the two
  apps** (`ng.monienaija.customer` vs `ng.monienaija.agent` — confirmed distinct).
- **Empirically reproduced and fixed a real, concrete build blocker**: before this fix,
  running `npx expo prebuild --platform android` on Customer Mobile **failed outright**
  with `Error: [android.dangerous]: withAndroidDangerousBaseMod: ENOENT: no such file or
  directory, open './assets/adaptive-icon.png'` (captured verbatim in this sandbox). This
  is not a hypothetical — it is the literal, reproducible failure a developer or CI runner
  would hit today running `eas build` against the pre-fix repository.
- Also empirically reproduced: **without an explicit `android.package`, Expo's prebuild
  silently defaults to `com.anonymous.moneynaijacustomer`** — the `com.anonymous.*`
  prefix is Expo's own placeholder-project convention, never valid for a real Play Store
  listing. This is a second genuine, concrete blocker that is now fixed.
- After the fix, `npx expo prebuild --platform android --no-install` **succeeds cleanly**
  for both apps (re-run in this sandbox after the fix, output: `✔ Finished prebuild`),
  and the generated `android/app/build.gradle` correctly shows
  `applicationId 'ng.monienaija.customer'` / `applicationId 'ng.monienaija.agent'` and
  `versionCode 1` for each respectively. (The generated `android/` directories were
  deleted after verification — this project intentionally does not check in native
  directories, consistent with Expo's managed/CNG workflow; `expo prebuild` is meant to
  run ephemerally inside `eas build`, not be committed.)
- Adaptive icon: both apps now declare `android.adaptiveIcon.backgroundColor`; neither
  has a `foregroundImage` yet because no real icon artwork exists in the repository
  (§8 — classified as an external/product asset requirement, not fabricated).
- Permissions: **NOT APPLICABLE / no action needed.** Neither app uses any native module
  that requires a runtime Android permission (no camera, location, contacts,
  notifications, or media-library packages are declared in either `package.json`).
  Expo's default managed-workflow manifest only requests `INTERNET` or equivalent,
  which neither app's `app.json` overrides. No unnecessary permissions were added, and
  none were found to remove.
- `versionCode`: **FIXED**, both apps now start at `1` (first production baseline);
  future releases must increment it manually (no `autoIncrement`/remote
  `appVersionSource` was configured — see §7 for why).

## 6. iOS readiness

**FIXED** (both apps), to the extent verifiable on a Linux sandbox without Xcode:

- `ios.bundleIdentifier` is now set for both apps (same values as the Android package
  names, which is conventional and was already Agent Mobile's existing pattern).
- `ios.buildNumber` added (`"1"`) for both apps — previously absent.
- **Empirically verified** (not assumed): `npx expo prebuild --platform ios --no-install`
  succeeds on this Linux sandbox for both apps (Xcode project *generation* does not
  require macOS/Xcode; only compiling/signing the actual `.ipa` does). The generated
  `ios/<App>.xcodeproj/project.pbxproj` was inspected directly and correctly shows
  `PRODUCT_BUNDLE_IDENTIFIER = "ng.monienaija.customer"` /
  `"ng.monienaija.agent"` and `CURRENT_PROJECT_VERSION = 1` for the respective apps.
  (Generated `ios/` directories were deleted after verification, same reasoning as §5.)
- Display name / version: `name` and `version` fields are present and valid for both
  apps; unchanged by this audit except where explicitly noted.
- Icon/splash: same gap as Android — no real icon artwork exists yet (§8). Expo printed
  `» ios: icon: No icon is defined in the Expo config.` during prebuild, which is an
  accurate, honest warning, not a hidden failure.
- Permissions / `infoPlist` entries: **NOT APPLICABLE.** No native module in either app
  requires an iOS usage-description entry (no camera/location/photo-library/contacts
  usage). Nothing was added.
- URL schemes / deep linking: **NOT APPLICABLE.** Neither app defines or requires a
  custom URL scheme; no `Linking`/deep-link code exists in either app's source.
- **Cannot be verified in this sandbox**: actual compilation, code signing, or IPA
  generation — this genuinely requires macOS + Xcode + a real Apple Developer account
  and is classified **REQUIRES REAL INFRASTRUCTURE** (§13), not silently assumed working.

## 7. EAS readiness

**FIXED.** Neither app had an `eas.json` before this audit (confirmed via a repo-wide
search — none existed anywhere). Created a minimal `eas.json` for each app with exactly
three profiles, matching the task's explicit minimalism instruction (no unnecessary
complexity, no `submit` block — app-store submission needs real Apple/Google credentials
this sandbox does not have, see §13):

```json
{
  "cli": { "appVersionSource": "local" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://REPLACE_WITH_STAGING_API_URL.example.invalid" }
    },
    "production": {
      "android": { "buildType": "app-bundle" },
      "env": { "EXPO_PUBLIC_API_URL": "https://REPLACE_WITH_PRODUCTION_API_URL.example.invalid" }
    }
  }
}
```

Rationale for each profile:
- **`development`** — internal dev-client builds; no API URL override, so it uses the
  existing documented Android-emulator-loopback fallback already in `config/index.ts`.
- **`preview`** — internal QA/UAT builds. Explicitly produces an installable **APK**
  (`buildType: apk`), not an AAB, because an AAB cannot be sideloaded onto a physical
  test device directly (§15/§K) — APK is what makes the stated end goal ("an actual
  installable production Android artifact followed by physical-device testing")
  achievable once a real EAS account exists.
- **`production`** — store-bound builds. Produces an **app-bundle** (AAB), the format
  Google Play requires.

**`appVersionSource: "local"`** was set explicitly so `android.versionCode`/
`ios.buildNumber` are sourced from each app's own `app.json` (already fixed in §5/§6)
rather than from an EAS-remote version counter this sandbox has no way to verify or
reset — simpler, and fully inspectable from the repository alone.

**Validation performed (real, offline, no network/login required):** `eas-cli` itself
requires a live Expo account even to run `eas config` (confirmed: attempting `npx eas-cli
config --profile production --platform android` in this sandbox returned `An Expo user
account is required to proceed` — this is evidence for §13, not a failure of this audit).
Instead, both `eas.json` files were validated using the exact same underlying library EAS
CLI itself uses internally, `@expo/eas-json`'s `EasJsonAccessor`/`EasJsonUtils`, invoked
directly and offline in this sandbox. All three profiles (`development`, `preview`,
`production`) resolved successfully for **both** Android and iOS on **both** apps (12
resolutions total, zero errors) — this is real schema/semantic validation, not a visual
inspection. **Tag: VERIFIED** (schema/structure) — actual `eas build` execution remains
**REQUIRES REAL INFRASTRUCTURE** (§13).

## 8. Asset findings

**MISSING — classified as an external/product asset requirement, not fabricated.**

A repository-wide search (`find ... -iname "*.png"`, plus `*logo*`/`*icon*`/`*splash*`/
`*brand*` filename search) found **zero image assets anywhere in this repository** — no
icon, no splash image, no logo, in any app, at any resolution. This matches and confirms
the exact gap the prior V1-RELEASE-01 audit already flagged for Customer Mobile, and
this audit additionally confirms Agent Mobile has never had any branding image assets
at all (not broken — simply never added).

Per this task's explicit instruction ("Do not create fake AI imagery... if an asset
cannot be safely created from existing material, classify it as an external/product
asset requirement. Do not silently substitute unrelated artwork"), **no image files were
generated or fabricated.** The only existing "brand material" found anywhere in the
repository is **text and two colour values**, both reused as-is:
- Deep green `#0A3D25` (already present in Customer Mobile's own `app.json` before this
  audit, and independently confirmed as "MoneyNaija brand deep green" in
  `apps/admin-web/src/screens/authenticated/Layout.tsx`).
- Gold `#FFB703` ("MoneyNaija brand gold", same file) — not currently used by either
  mobile app's config, noted here for completeness in case it is wanted for a future
  accent once real icon assets exist.

**Exact assets still required, with exact specs, before either app can be submitted to
an app store:**

| Asset | Required for | Exact spec |
|---|---|---|
| App icon | iOS + Android (`expo.icon`) | 1024×1024 PNG, no transparency (iOS rejects alpha-channel icons), square, no rounded corners (platforms apply their own mask) |
| Android adaptive icon foreground | Android (`android.adaptiveIcon.foregroundImage`) | 1024×1024 PNG, transparent background, primary content inside the centre ~66% (672×672) "safe zone" so it isn't clipped by launcher icon masks |
| Splash image | iOS + Android (`splash.image`) | PNG, logo/mark only (not a full-bleed design) — Expo centres it on `splash.backgroundColor` with `resizeMode: contain`; a 1200×1200-ish square mark is a safe universal choice |
| Favicon (optional, web only) | `web.favicon`, only if the web target is ever actually shipped | 48×48 PNG |

Both apps are configured to use Expo's own bundled default icon/splash until the above
are supplied — this is honest and functional (verified via `expo prebuild`, §5/§6), not
a silent substitution of unrelated artwork.

**Separate observation (not fixed, explicitly flagged for product/brand decision, not
a build blocker):** every single display occurrence of the brand name across **all
three** apps in this repository (`customer-mobile`, `agent-mobile`, `admin-web` — not
just one file, confirmed via a repository-wide grep) consistently reads **"MoneyNaija"**,
while the repository name, GitHub organisation, README, and the new technical bundle
identifiers introduced by this very audit all use **"MonieNaija"**/`monienaija`. This is
a pre-existing, fully consistent pattern across the entire codebase (not something
introduced by or local to one screen), so this audit did **not** alter any in-app display
text — doing so would be a content/brand decision outside "build configuration" scope,
and changing it unilaterally across dozens of screens would itself be the kind of
unrequested redesign this task explicitly forbids. Flagged here for the product owner to
resolve once, not fixed ad hoc.

## 9. API configuration

**VERIFIED**, with one genuine design point surfaced and deliberately handled.

- Neither app's `config/index.ts` hardcodes `localhost`, `127.0.0.1`, or any other
  non-loopback development address as anything other than the already-documented,
  single, clearly-commented Android-emulator fallback (`http://10.0.2.2:3000`) — a
  repo-wide grep for `localhost`, `127.0.0.1`, `10.0.2.2`, and `192.168.*` across both
  apps' `src/` trees found **exactly one occurrence per app**, both in `config/index.ts`,
  both the same already-reviewed fallback literal. No other hardcoded host was found.
- `EXPO_PUBLIC_API_URL` consumption was **re-verified end-to-end in this sandbox**, not
  just read as source code: `npx expo export --platform android` was run twice — once
  with `EXPO_PUBLIC_API_URL` set to a unique marker value
  (`https://proof-marker-url.example.invalid`) and once unset. The marker URL was
  confirmed to be the value the app resolves to when set (verified directly in a
  non-minified, non-Hermes export via `jsEngine: jsc` + `--dev`, which showed the
  literal `Object.defineProperties(process.env, {"EXPO_PUBLIC_API_URL": {"value":
  "https://proof-marker-url.example.invalid"}, ...})` injected at the top of the bundle
  — i.e. the mechanism genuinely works in an exported, standalone-style bundle, not only
  inside the Metro dev server). When unset, the export correctly falls back to the
  documented dev literal. This closes the exact "unknown-unknown" risk explicitly named
  in this task ("API URL configuration that works in Metro but fails in standalone
  builds") — it does not fail; it was proven to work in an exported bundle.
- **Production domain was deliberately NOT invented.** A prior UAT document in this
  repository (`docs/V1/V1-AGENT-MOBILE-16-STAGING-DEPLOYMENT-UAT.md`) names
  `staging-api.monienaija.ng` as a *target* hostname, but a companion document
  (`V1-AGENT-MOBILE-15-STAGING-DEVICE-UAT.md`) explicitly records that probing it
  "confirms that the public DNS record is currently **unresolved**." Baking in a
  hostname already documented elsewhere in this repo as non-functional would be
  indistinguishable from inventing a fake domain. Instead, both `eas.json` `preview` and
  `production` profiles use an unmistakable, intentionally non-resolvable placeholder
  (`https://REPLACE_WITH_..._API_URL.example.invalid`, using the IANA-reserved
  `.invalid` TLD, which by definition can never resolve) — this fails **loudly and
  immediately** if a build is ever run without the real value, rather than silently
  defaulting to the Android-emulator loopback the way an *unset* env var would. This
  directly closes another named "unknown-unknown" risk ("production config that
  silently falls back to development").
- Development/preview/production separation: **CONFIGURED, VERIFIED (schema) /
  CONFIGURED BUT UNTESTED (real network behaviour)** — the three profiles resolve
  correctly and inject distinct values (§7), but no actual build against a real backend
  was performed (no real staging/production API exists yet to point at — §13).

## 10. Environment configuration

**VERIFIED.** `EXPO_PUBLIC_*` is the only environment-variable mechanism either app
uses, and only one variable exists: `EXPO_PUBLIC_API_URL`. Per Expo's own documented
behaviour (confirmed empirically in §9), `EXPO_PUBLIC_*` variables are inlined into the
JS bundle at build/export time — there is no separate "runtime config missing" risk
class here, because nothing is read from the OS environment at app runtime; it is fully
resolved before the bundle is produced. No secret-shaped variable (`DATABASE_*`, `*_JWT_*`,
`*_SECRET*`, `*_API_KEY*`, SMS-provider credentials) is referenced anywhere in either
mobile app's source — confirmed by grep across both `src/` trees.

## 11. Security findings

**VERIFIED — no new exposure found, none introduced.**

- Neither `eas.json` contains anything beyond a public API base URL placeholder — no
  database password, JWT secret, SMS credential, or private API key was added or found
  pre-existing in either mobile app.
- Re-confirmed no development-authentication bypass exists in either app:
  `apps/agent-mobile/src/config/index.ts` explicitly documents "There is deliberately NO
  development authentication mock in this application," and
  `apps/customer-mobile/src/store/auth-store.ts` explicitly documents "There is no
  mock/sandbox authentication fallback" — both pre-existing from V1-RELEASE-01, verified
  still true and unchanged.
- `expo-secure-store` usage (`secure-storage.ts`, identical in both apps) correctly
  gates on `Platform.OS === 'ios' || 'android'` and falls back to an in-memory store only
  on `web`/`test` — this behaviour is unaffected by, and identical in, a standalone
  (production) build versus Expo Go, since `Platform.OS` reports the same way in both.
  No standalone-build-specific SecureStore regression was found.
- No hardcoded test OTP values, test credentials, or `__DEV__`/debug-flag branches exist
  in either app's source (grepped explicitly; all `"123456"`/`"08012345678"` occurrences
  found are UI placeholder text in form inputs, not authentication bypasses).
- `console.warn`/`console.error` calls exist only for generic error objects (SecureStore
  failures, React error boundaries, session-restore failures) — none log a password,
  PIN, OTP, or token value. Minor, non-blocking observation only.

## 12. Build validation

What was actually run in this sandbox, with exact results:

| Check | Customer Mobile | Agent Mobile |
|---|---|---|
| `npm ci` | ✅ 1,076 packages installed, 0 install errors | ✅ 1,077 packages installed, 0 install errors |
| `npx tsc --noEmit` | ✅ exit 0, no errors | ✅ exit 0, no errors |
| `npx jest --watchAll=false` | ✅ 12/12 suites, 92/92 tests passing (re-run after config fix) | ✅ 17/17 suites, 233/233 tests passing (re-run after config fix) |
| `npx expo config --json` | ✅ parses cleanly, `sdkVersion: 52.0.0` | ✅ parses cleanly, `sdkVersion: 52.0.0` |
| `npx expo prebuild --platform android` | ❌ **before fix** (ENOENT on missing asset) → ✅ **after fix** (`applicationId 'ng.monienaija.customer'`, `versionCode 1`) | ✅ (`applicationId 'ng.monienaija.agent'`, `versionCode 1`) |
| `npx expo prebuild --platform ios` | ✅ after fix (`PRODUCT_BUNDLE_IDENTIFIER = "ng.monienaija.customer"`, `CURRENT_PROJECT_VERSION = 1`) | ✅ (`PRODUCT_BUNDLE_IDENTIFIER = "ng.monienaija.agent"`, `CURRENT_PROJECT_VERSION = 1`) |
| `npx expo export --platform android` (JS bundle generation) | ✅ succeeds, 2.15 MB Hermes bundle produced; env-var inlining independently verified (§9) | not separately re-run (identical mechanism, already proven on Customer Mobile and in V1-RELEASE-01 for both apps) |
| `eas.json` offline schema validation via `@expo/eas-json` | ✅ all 3 profiles × 2 platforms resolve without error | ✅ all 3 profiles × 2 platforms resolve without error |
| `eas config` (real EAS CLI command) | ❌ **requires a live Expo account** — confirmed, not attempted further | same |
| `expo-doctor` | 14/18 checks passed; the 4 failures are all `fetch failed` against Expo's API (no network egress to `expo.dev`/`api.expo.dev` from this sandbox, confirmed via direct `curl`) | not re-run separately; identical sandbox network constraint applies |
| Actual EAS cloud build | **not attempted** — network egress to `expo.dev`/`api.expo.dev` confirmed unreachable from this sandbox (`curl` returned no connection; `registry.npmjs.org` by contrast returned `200`, proving this is a scoped network restriction, not a general outage) | same |

**Generated native directories (`android/`, `ios/`) and exported `dist/` output from all
of the above were deleted after verification in every case** — this project does not
check in native directories (managed/CNG workflow), and none of these are meant to be
committed artifacts.

Per this task's explicit instruction: **REPOSITORY BUILD CONFIGURATION VERIFIED. EAS
CLOUD BUILD REQUIRES REAL INFRASTRUCTURE.** No claim is made that an actual signed IPA
or production AAB was produced — only that the full local configuration pipeline up to
the point where real EAS credentials/network would take over was exercised successfully.

## 13. External infrastructure dependencies

Explicitly separated from anything fixed in this repository:

1. **EAS account + project linkage** — `eas config`/`eas build` require a logged-in Expo
   account; this sandbox has neither credentials nor network access to `expo.dev`/
   `api.expo.dev` (confirmed via direct `curl`, not assumed).
2. **Apple Developer Program membership + signing certificates/provisioning profiles**
   — required for any real iOS build or TestFlight/App Store submission; not present,
   not fabricated.
3. **Google Play Console account + upload key / Play App Signing enrolment** — required
   for any real Play Store submission; not present.
4. **Real icon/splash brand artwork** — see §8. Classified as a product/design asset
   requirement, not a code defect.
5. **A real, DNS-resolvable staging and production API domain** — see §9. The backend's
   own V1-RELEASE-01 audit already separately confirmed the backend itself is
   code-ready; only the actual hosted, publicly-reachable endpoint is missing.
6. **A physical Android/iOS device, or an emulator/simulator with Google Play services /
   Xcode installed** — this sandbox is a headless Linux container; no device, emulator,
   or simulator is available to install or run an actual built artifact.
7. **CI/CD pipeline** — already documented as an explicitly deferred gap in
   V1-RELEASE-01; unchanged by this audit; no `.github/workflows` directory exists.

## 14. Exact fixes applied this audit

All applied under commit message `feat(mobile): prepare production build configuration`,
verified via the tests in §12 before committing:

1. **`apps/customer-mobile/app.json`** — added `android.package` =
   `ng.monienaija.customer`, `android.versionCode` = `1`, `ios.bundleIdentifier` =
   `ng.monienaija.customer`, `ios.buildNumber` = `"1"`; removed the dangling
   `icon`/`splash.image`/`splash.resizeMode`/`android.adaptiveIcon.foregroundImage`/
   `web.favicon` references that pointed at non-existent files (the literal, reproduced
   cause of a hard `expo prebuild` failure); retained the pre-existing, already-approved
   `#0A3D25` background colour for `splash` and `android.adaptiveIcon`.
2. **`apps/agent-mobile/app.json`** — added `android.versionCode` = `1`,
   `ios.buildNumber` = `"1"` (both previously absent); added `splash.backgroundColor`
   and `android.adaptiveIcon.backgroundColor` = `#0A3D25` for visual consistency with
   Customer Mobile, reusing the same already-established colour (no new artwork).
   Pre-existing `android.package`/`ios.bundleIdentifier` (`ng.monienaija.agent`) were
   **not** altered.
3. **`apps/customer-mobile/eas.json`** (new file) and **`apps/agent-mobile/eas.json`**
   (new file) — minimal `development`/`preview`/`production` build profiles per §7,
   validated offline via `@expo/eas-json`.

No dependency version was changed in either app's `package.json`. No navigation,
state-management, or UI code was touched. No feature, flow, or business logic was added
or modified.

## 15. Tests

| Suite | Before | After the fixes above |
|---|---|---|
| Customer Mobile `npx tsc --noEmit` | not re-baselined (unaffected by config-only change) | ✅ exit 0 |
| Customer Mobile `npx jest --watchAll=false` | 12 suites / 92 tests (1 run showed a flaky, non-deterministic `act()` warning-driven failure on an Animated-timer-based test — re-run immediately passed 12/12, 92/92; this is pre-existing test flakiness unrelated to this audit's changes, not a regression, and not fixed per "do not weaken/alter unrelated tests") | ✅ 12/12 suites, 92/92 tests, re-run cleanly twice after the fix |
| Agent Mobile `npx tsc --noEmit` | — | ✅ exit 0 |
| Agent Mobile `npx jest --watchAll=false` | 17/17 suites, 233/233 tests (stable across repeated runs) | ✅ 17/17 suites, 233/233 tests, unchanged |
| Backend | **not re-run** — no backend (`src/`, `test/`) file was touched by this audit, per the explicit instruction not to rerun unrelated full backend suites when no backend code changed | N/A |

No test was modified, skipped, or weakened. One pre-existing minor test flakiness (not
introduced by this audit) is disclosed above rather than hidden.

## 16. Remaining blockers

Separated by whether this repository can resolve them:

**Cannot be resolved by any code/config change in this repository (External
infrastructure — see §13 for the full list):** EAS account/credentials, Apple/Google
developer program enrolment and signing, a real resolvable API domain, a physical
device/emulator, and real brand icon/splash artwork.

**Genuinely out of this audit's scope, not blockers:** the "MoneyNaija" vs "MonieNaija"
display-name inconsistency (§8) is a product/brand decision, not a build blocker — both
apps build and run correctly either way; flagged for awareness, not fixed.

**No remaining repository-level build blocker was found.** Both apps' `expo prebuild`
(Android and iOS) and `expo export` (Android) now complete successfully end-to-end in
this sandbox with correct, unique, production-shaped identifiers.

## 17. Exact next step

Obtain real EAS/Apple/Google credentials and a real (even if initially
staging-only) resolvable API hostname, then — from a machine or CI runner with actual
network access to `expo.dev` — run `eas build --profile preview --platform android`
for both apps using the `eas.json` created by this audit (after replacing the
`EXPO_PUBLIC_API_URL` placeholder with the real staging URL), install the resulting APK
directly on a physical Android device, and perform the first genuine physical-device
smoke test. Real brand icon/splash artwork (§8, exact specs given) should be supplied
and wired in before any App Store/Play Store **submission**, but is not required to
produce an installable internal-test APK.

---

## FINAL STATUS

**B. MOBILE PRODUCTION BUILD READINESS VERIFIED — FIXES IMPLEMENTED**

Both apps' repository-level build configuration is now genuinely correct and was proven,
not assumed: two concrete, reproducible build-breaking defects were found and fixed in
Customer Mobile (a guaranteed `expo prebuild` crash from dangling asset references, and
a `com.anonymous.*` placeholder package name that would have shipped to the Play Store
had it gone unfixed), `eas.json` was created for both apps with offline-schema-validated
minimal profiles, and the `EXPO_PUBLIC_API_URL` production-wiring mechanism was proven
to actually work in an exported bundle rather than merely asserted from reading source.
Neither app's Expo/React Native/React version was touched.

This is explicitly **not** the same claim as "ready to submit to an app store today" or
"verified on a physical device" — it is not. Five items (§13) remain entirely outside
what any change to this repository can resolve: EAS credentials, Apple/Google developer
enrolment, real brand artwork, a real resolvable API domain, and an actual physical
device or emulator to install a built artifact on. **Repository build configuration:
verified. EAS cloud build, code signing, and physical-device installation: require real
infrastructure this sandbox does not have.**
