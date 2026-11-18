import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ARENA 3D Group 32 — mobile release readiness.
 *
 * ## What Group 25 built, and what it left open
 *
 * Group 25 built the server-side build register: which client builds exist, which are supported, deprecated or
 * blocked, and what each platform's floor is. It deliberately seeded nothing, because the floor and the support
 * window are release-management decisions.
 *
 * What it could not do is check the **artefacts** against that register. A register is only meaningful if the
 * build that ships actually reports a version the register knows. Nothing verified that, and there are three ways
 * that goes wrong silently:
 *
 * 1. **The two apps ship the same version string.** Both `app.json` files declare `version: "1.0.0"`, and both
 *    declare `versionCode: 1` / `buildNumber: "1"`. They are separate products with separate release cadences;
 *    sharing a version number means "is 1.0.0 supported?" has two different answers.
 * 2. **The store build number never advances.** A store rejects a re-upload of an existing `versionCode`, so a
 *    release is blocked at submission — after the release commit, not before it.
 * 3. **The bundle identifier drifts.** `ng.monienaija.agent` and `ng.monienaija.customer` are effectively
 *    permanent: a store listing is bound to the identifier, and changing it later means a new listing with no
 *    upgrade path for existing users.
 *
 * ## What this file is
 *
 * A static consistency check over the shipping manifests. It reads `app.json` and `package.json` for each app and
 * reports anything that would make a build unregisterable, unsubmittable or unidentifiable.
 *
 * ## What it is NOT
 *
 * It does **not** build, sign, submit or install anything. There is no iOS or Android toolchain here, no signing
 * identity, no store account and no device. Every one of those is a release step that cannot be performed or
 * verified from this environment, and this report says so rather than implying coverage.
 */

export type ReleaseVerdict = 'PASS' | 'WARNING' | 'ERROR';

export type MobileApp = 'agent-mobile' | 'customer-mobile';

export interface ReleaseFinding {
  readonly app: MobileApp;
  readonly check: string;
  readonly verdict: ReleaseVerdict;
  readonly detail: string;
}

export interface MobileAppManifest {
  readonly app: MobileApp;
  readonly name: string;
  readonly slug: string;
  readonly version: string;
  readonly iosBundleIdentifier: string;
  readonly androidPackage: string;
  readonly iosBuildNumber: string;
  readonly androidVersionCode: number;
  readonly runtimeVersion: string | null;
  readonly packageVersion: string;
}

export interface MobileReleaseReport {
  readonly apps: MobileAppManifest[];
  readonly findings: ReleaseFinding[];
  readonly verdict: ReleaseVerdict;
  /** Release steps that were not performed and cannot be performed here. */
  readonly notPerformed: string[];
}

const APP_DIRECTORIES: readonly MobileApp[] = ['agent-mobile', 'customer-mobile'];

/**
 * Identifiers that must never change after the first store submission.
 *
 * Recorded here so a change is a deliberate act with a review, rather than a quiet rename in a manifest that
 * silently orphans every installed app.
 */
export const ESTABLISHED_IDENTIFIERS: Readonly<
  Record<MobileApp, { ios: string; android: string }>
> = {
  'agent-mobile': { ios: 'ng.monienaija.agent', android: 'ng.monienaija.agent' },
  'customer-mobile': { ios: 'ng.monienaija.customer', android: 'ng.monienaija.customer' },
};

interface RawAppJson {
  readonly expo?: {
    readonly name?: unknown;
    readonly slug?: unknown;
    readonly version?: unknown;
    readonly runtimeVersion?: unknown;
    readonly ios?: { readonly bundleIdentifier?: unknown; readonly buildNumber?: unknown };
    readonly android?: { readonly package?: unknown; readonly versionCode?: unknown };
  };
}

/** Reads one app's manifest pair from disk. */
export function readManifest(repoRoot: string, app: MobileApp): MobileAppManifest {
  const appRoot = join(repoRoot, 'apps', app);
  const appJson = JSON.parse(readFileSync(join(appRoot, 'app.json'), 'utf8')) as RawAppJson;
  const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
    version?: unknown;
  };

  const expo = appJson.expo ?? {};
  return {
    app,
    name: text(expo.name),
    slug: text(expo.slug),
    version: text(expo.version),
    iosBundleIdentifier: text(expo.ios?.bundleIdentifier),
    androidPackage: text(expo.android?.package),
    iosBuildNumber: text(expo.ios?.buildNumber),
    androidVersionCode:
      typeof expo.android?.versionCode === 'number' ? expo.android.versionCode : 0,
    runtimeVersion: expo.runtimeVersion === undefined ? null : text(expo.runtimeVersion),
    packageVersion: text(packageJson.version),
  };
}

/**
 * Reads a manifest field as text.
 *
 * `String(value)` on an unknown is a real hazard here: an object would become `"[object Object]"`, which passes
 * an "is it non-empty?" check and then silently fails to match any identifier or version. Anything that is not a
 * string or a number becomes the empty string, which the checks treat as missing rather than as present.
 */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Parses `major.minor.patch` and rejects anything else, including a pre-release suffix. */
export function parseSemver(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Evaluates the manifests.
 *
 * Pure function over already-read manifests so the rules can be tested against synthetic releases without
 * touching the files on disk.
 */
export function evaluateManifests(manifests: readonly MobileAppManifest[]): MobileReleaseReport {
  const findings: ReleaseFinding[] = [];

  const add = (app: MobileApp, check: string, verdict: ReleaseVerdict, detail: string): void => {
    findings.push({ app, check, verdict, detail });
  };

  for (const manifest of manifests) {
    /* --- Version identity ------------------------------------------------- */

    const semver = parseSemver(manifest.version);
    if (!semver) {
      /*
       * The server's register rejects anything that is not three numeric components, so a version the app
       * declares but the register refuses makes the build permanently `UNKNOWN` — served, never governed.
       */
      add(
        manifest.app,
        'version-format',
        'ERROR',
        `version "${manifest.version}" is not major.minor.patch; the server register rejects it and the build ` +
          'would be permanently UNKNOWN',
      );
    } else if (manifest.version !== manifest.packageVersion) {
      /*
       * Two version numbers for one artefact. Whichever the build reports, somebody is reading the other one, and
       * "what is in production?" becomes unanswerable.
       */
      add(
        manifest.app,
        'version-consistency',
        'ERROR',
        `app.json says "${manifest.version}" but package.json says "${manifest.packageVersion}"; two versions ` +
          'for one artefact makes "what is in production?" unanswerable',
      );
    } else {
      add(manifest.app, 'version-format', 'PASS', `version ${manifest.version} is registerable`);
    }

    /* --- Store build numbers ---------------------------------------------- */

    /*
     * A store rejects a re-upload of an existing build number. It has to advance on every submission, and there
     * is no way to test that here — so the check is that the field exists, is a positive integer, and is kept in
     * step across the two platforms.
     */
    const iosBuild = Number(manifest.iosBuildNumber);
    if (!Number.isInteger(iosBuild) || iosBuild < 1) {
      add(
        manifest.app,
        'ios-build-number',
        'ERROR',
        `ios.buildNumber "${manifest.iosBuildNumber}" is not a positive integer`,
      );
    }
    if (!Number.isInteger(manifest.androidVersionCode) || manifest.androidVersionCode < 1) {
      add(
        manifest.app,
        'android-version-code',
        'ERROR',
        `android.versionCode ${manifest.androidVersionCode} is not a positive integer`,
      );
    }
    if (Number.isInteger(iosBuild) && iosBuild !== manifest.androidVersionCode) {
      /*
       * Not an error — the platforms genuinely can diverge — but it makes "which build is the user on?" a
       * question with two answers, so it is surfaced rather than assumed harmless.
       */
      add(
        manifest.app,
        'build-number-alignment',
        'WARNING',
        `iOS buildNumber ${iosBuild} differs from android versionCode ${manifest.androidVersionCode}; ` +
          'support cannot map a user to a build without knowing which platform they are on',
      );
    }
  }

  /* --- Cross-app identity ------------------------------------------------- */

  const versions = new Set(manifests.map((manifest) => manifest.version));
  if (manifests.length > 1 && versions.size === 1) {
    /*
     * The concrete gap this group found. `agent-mobile` and `customer-mobile` are separate products with
     * separate release cadences; shipping both as 1.0.0 means the register's answer to "is 1.0.0 supported?"
     * depends on which app the user opened, and a support agent cannot tell which was meant.
     */
    for (const manifest of manifests) {
      add(
        manifest.app,
        'cross-app-version-collision',
        'WARNING',
        `shares version ${manifest.version} with the other mobile app; the build register resolves (client, ` +
          'platform, version) so identical versions make "is this build supported?" ambiguous in support',
      );
    }
  }

  const packages = manifests.map((manifest) => manifest.androidPackage);
  const bundles = manifests.map((manifest) => manifest.iosBundleIdentifier);
  if (new Set(packages).size !== packages.length || new Set(bundles).size !== bundles.length) {
    /*
     * Two apps sharing a package or bundle identifier cannot both be installed, and a store will reject the
     * second submission. This is unrecoverable after publication.
     */
    for (const manifest of manifests) {
      add(
        manifest.app,
        'identifier-uniqueness',
        'ERROR',
        `duplicate identifier: ios "${manifest.iosBundleIdentifier}", android "${manifest.androidPackage}"; ` +
          'two apps cannot share one, and a store rejects the second submission',
      );
    }
  }

  for (const manifest of manifests) {
    const expected = ESTABLISHED_IDENTIFIERS[manifest.app];
    if (
      manifest.iosBundleIdentifier !== expected.ios ||
      manifest.androidPackage !== expected.android
    ) {
      /*
       * Changing an identifier does not rename an installed app; it creates a new listing with no upgrade path.
       * Treated as an error so the change has to be deliberate.
       */
      add(
        manifest.app,
        'identifier-stability',
        'ERROR',
        `identifier changed from the established "${expected.ios}"; this does not rename installed apps, it ` +
          'orphans them',
      );
    } else {
      add(manifest.app, 'identifier-stability', 'PASS', `identifier ${expected.ios} unchanged`);
    }

    /* --- Over-the-air updates --------------------------------------------- */

    if (manifest.runtimeVersion === null) {
      /*
       * Without a runtime version there is no way to decide which JavaScript bundle may be delivered to which
       * native build. Shipping an OTA update to a binary whose native modules have moved is the classic way to
       * brick an installed base, and the check for it is a field that must exist *before* updates are enabled.
       */
      add(
        manifest.app,
        'runtime-version',
        'WARNING',
        'no runtimeVersion declared; over-the-air updates cannot be scoped to a compatible native build, so they ' +
          'must not be enabled until this is decided',
      );
    } else {
      add(manifest.app, 'runtime-version', 'PASS', `runtimeVersion ${manifest.runtimeVersion}`);
    }
  }

  const verdict: ReleaseVerdict = findings.some((finding) => finding.verdict === 'ERROR')
    ? 'ERROR'
    : findings.some((finding) => finding.verdict === 'WARNING')
      ? 'WARNING'
      : 'PASS';

  return {
    apps: [...manifests],
    findings,
    verdict,
    notPerformed: [
      'no native build was produced (no Xcode or Android SDK in this environment)',
      'no binary was signed (no signing identity or keystore exists here)',
      'no submission was made to any store (no developer account, no credentials)',
      'no build was installed on a device or emulator (no device, no simulator)',
      'no over-the-air update was published or delivered',
      'no store review was performed and no review outcome is claimed',
    ],
  };
}

/** Reads and evaluates the repository's own two mobile apps. */
export function evaluateRepositoryMobileRelease(repoRoot: string): MobileReleaseReport {
  return evaluateManifests(APP_DIRECTORIES.map((app) => readManifest(repoRoot, app)));
}
