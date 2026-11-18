# Mobile release readiness

Group 32. Scope: whether the two shipping mobile manifests can enter the build register, be submitted to a store,
and be identified in support — checked statically, because nothing here can build, sign or submit anything.

## The finding that matters

Both apps ship the same version string.

```
apps/agent-mobile/app.json     version: "1.0.0"   ios.buildNumber: "1"   android.versionCode: 1
apps/customer-mobile/app.json  version: "1.0.0"   ios.buildNumber: "1"   android.versionCode: 1
```

They are separate products with separate release cadences and separate stores listings. Group 25 built a build
register keyed on `(client, platform, version)`. With both apps on `1.0.0`, the question "is 1.0.0 supported?"
has two different answers depending on which app the user opened, and a support agent reading a screenshot has no
way to tell which was meant. The register itself is correct; the artefacts collide.

The second finding is that **neither app declares a `runtimeVersion`.** Over-the-air updates are scoped by runtime
version: a JS bundle may only be delivered to a native binary whose native modules it matches. Without the field
there is no way to make that decision, so OTA must stay disabled until it is decided — shipping an OTA update
against an unscoped binary is the classic way to brick an installed base.

Both are recorded as `WARNING`, not `ERROR`: neither is a broken manifest, and neither is a decision this mission
is authorised to make. Inventing a version split or a runtime version would be answering a release-management
question by guessing.

## The report, as it stands

`evaluateRepositoryMobileRelease(repoRoot)` over the real files:

| Verdict   | App               | Check                         |
| --------- | ----------------- | ----------------------------- |
| `PASS`    | `agent-mobile`    | `version-format`              |
| `PASS`    | `customer-mobile` | `version-format`              |
| `WARNING` | `agent-mobile`    | `cross-app-version-collision` |
| `WARNING` | `customer-mobile` | `cross-app-version-collision` |
| `PASS`    | `agent-mobile`    | `identifier-stability`        |
| `WARNING` | `agent-mobile`    | `runtime-version`             |
| `PASS`    | `customer-mobile` | `identifier-stability`        |
| `WARNING` | `customer-mobile` | `runtime-version`             |

Aggregate verdict: **`WARNING`** — 4 pass, 4 warn, 0 error.

## What is actually checked

| Check                         | Severity when it fails | Why it exists                                                                                                                                            |
| ----------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version-format`              | `ERROR`                | the server register accepts only `major.minor.patch`; a version it cannot parse leaves the build permanently `UNKNOWN` — served, never governed          |
| `version-consistency`         | `ERROR`                | a manifest disagreeing with its own `package.json` gives two versions for one artefact and makes "what is in production?" unanswerable                   |
| `ios-build-number`            | `ERROR`                | a store rejects a re-upload of an existing build number; it must be a positive integer that advances every submission                                    |
| `android-version-code`        | `ERROR`                | same, on the Play Store's side                                                                                                                           |
| `build-number-alignment`      | `WARNING`              | the platforms may legitimately diverge, but support cannot map a user to a build without knowing the platform                                            |
| `identifier-uniqueness`       | `ERROR`                | two apps sharing a bundle or package identifier cannot both be installed; a store rejects the second submission, and it is unrecoverable after the first |
| `identifier-stability`        | `ERROR`                | changing an identifier does not rename installed apps, it orphans them — a new listing with no upgrade path                                              |
| `cross-app-version-collision` | `WARNING`              | the `(client, platform, version)` register key becomes ambiguous across products                                                                         |
| `runtime-version`             | `WARNING`              | OTA updates cannot be scoped to a compatible native build, so they must not be enabled                                                                   |

`ESTABLISHED_IDENTIFIERS` pins `ng.monienaija.agent` and `ng.monienaija.customer`. Recording them in code makes a
change a reviewed act rather than a quiet rename in a manifest.

## Verification

`test/mobile-release-readiness.spec.ts` — 21 cases, all passing. Because the interesting cases cannot be created by
editing the real manifests, every rule is exercised against **synthetic releases** (`evaluateManifests` is a pure
function over already-read manifests): a register-unparseable version, two versions for one artefact, a changed
bundle identifier, two apps sharing an identifier, a build number a store would refuse, and platform drift on the
build number. A genuinely consistent release is asserted to come back `PASS`, so the suite cannot pass by warning
about everything.

Mutation-verified: setting the agent's iOS bundle identifier to `ng.monienaija.customer` in the real manifest turned
the run into **2 failures, 19 passes** — `keeps each app on its established identifier` and the aggregate-verdict
case. Restored and re-read from disk (`ng.monienaija.agent`) before continuing.

A parsing hazard was found and fixed while writing the service: `String(value)` on an `unknown` produces
`"[object Object]"`, which passes a non-empty check and then matches nothing. Fields are read through a `text()`
helper that returns the empty string for anything that is not a string or a finite number, so a malformed field is
treated as **missing** rather than as present. The linter's `no-base-to-string` caught four of these.

## The six things not performed

The report states them rather than letting silence imply coverage:

1. no native build (no Xcode or Android SDK here);
2. no signing (no signing identity or keystore);
3. no submission to any store (no developer account, no credentials);
4. no installation on a device or emulator (no device, no simulator);
5. no OTA update published or delivered;
6. no store review performed, and no review outcome claimed.

## What this does NOT certify

- **Not a build.** Nothing was compiled. `tsc` type-checks TypeScript, not a native binary.
- **Not signed, not submitted, not approved.** No store was contacted and no review exists.
- **Not device or emulator acceptance.** No screen was rendered. That is Group 33 and it is blocked here (no
  Chromium, no simulator).
- **Not the register seeded.** Group 25 deliberately seeds nothing — the support floor is a product decision. A
  `PASS` on `version-format` means the version is _registerable_, not _registered_.
- **Not a fix for the two warnings.** This group records the collision and the missing `runtimeVersion`; it does
  not resolve them.

## Required decisions

| Decision                    | Options                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Version scheme per app      | independent semver per product, or a shared monorepo version with a client suffix                    |
| `runtimeVersion` policy     | pin to the native version, or use an explicit OTA channel policy — and whether OTA is enabled at all |
| First shipped build numbers | whether either app has already been submitted; if so the next build number is fixed and cannot be 1  |

## Honest summary

The manifests are internally consistent and structurally ready: versions parse, build numbers are positive
integers, identifiers are the established ones and are unique. They are **not yet releasable as two distinct
products**, because they share a version number with no scoping field and declare no runtime version. A release
manager must decide both before the first submission — neither is answerable from this repository.
