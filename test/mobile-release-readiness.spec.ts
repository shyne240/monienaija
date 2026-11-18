import { join } from 'node:path';

import {
  ESTABLISHED_IDENTIFIERS,
  evaluateManifests,
  evaluateRepositoryMobileRelease,
  parseSemver,
  readManifest,
  type MobileAppManifest,
} from '../src/mobile/mobile-release-readiness.service';

/**
 * ARENA 3D Group 32 — mobile release readiness.
 *
 * The property under test: the artefacts that ship are consistent with each other and with the server's build
 * register, so a release cannot be blocked at submission or made ungovernable by a version string.
 */
describe('Group 32 — mobile release readiness', () => {
  const repoRoot = join(__dirname, '..');
  const report = evaluateRepositoryMobileRelease(repoRoot);
  const finding = (app: string, check: string) =>
    report.findings.find((entry) => entry.app === app && entry.check === check);

  describe('the shipped manifests are internally consistent', () => {
    it('reads both apps', () => {
      expect(report.apps.map((manifest) => manifest.app).sort()).toEqual([
        'agent-mobile',
        'customer-mobile',
      ]);
    });

    it('declares a registerable version in both, matching package.json', () => {
      /*
       * The server register only accepts major.minor.patch. A version it rejects leaves the build permanently
       * UNKNOWN — served, never governed — which is the failure Group 25 exists to prevent.
       */
      for (const manifest of report.apps) {
        expect(parseSemver(manifest.version)).not.toBeNull();
        expect(manifest.version).toBe(manifest.packageVersion);
      }
    });

    it('declares a positive build number on both platforms', () => {
      for (const manifest of report.apps) {
        expect(Number(manifest.iosBuildNumber)).toBeGreaterThanOrEqual(1);
        expect(manifest.androidVersionCode).toBeGreaterThanOrEqual(1);
      }
    });

    it('keeps each app on its established identifier', () => {
      // A changed identifier does not rename an installed app; it orphans it.
      for (const manifest of report.apps) {
        expect(manifest.iosBundleIdentifier).toBe(ESTABLISHED_IDENTIFIERS[manifest.app].ios);
        expect(manifest.androidPackage).toBe(ESTABLISHED_IDENTIFIERS[manifest.app].android);
        expect(finding(manifest.app, 'identifier-stability')?.verdict).toBe('PASS');
      }
    });

    it('uses a distinct identifier per app', () => {
      const packages = report.apps.map((manifest) => manifest.androidPackage);
      expect(new Set(packages).size).toBe(packages.length);
    });
  });

  describe('the gaps this group records', () => {
    it('records that both apps ship the same version', () => {
      /*
       * Separate products with separate release cadences, both at 1.0.0. The register resolves
       * (client, platform, version), so a support agent told "I am on 1.0.0" cannot tell which app was meant.
       * Surfaced as a warning rather than silently accepted.
       */
      const versions = new Set(report.apps.map((manifest) => manifest.version));
      expect(versions.size).toBe(1);
      for (const manifest of report.apps) {
        expect(finding(manifest.app, 'cross-app-version-collision')?.verdict).toBe('WARNING');
      }
    });

    it('records that no runtime version is declared', () => {
      /*
       * Without it there is no way to scope an over-the-air update to a compatible native build. Shipping an OTA
       * bundle to a binary whose native modules have moved bricks the installed base, and the guard is a field
       * that must be decided before updates are ever enabled.
       */
      for (const manifest of report.apps) {
        expect(manifest.runtimeVersion).toBeNull();
        expect(finding(manifest.app, 'runtime-version')?.verdict).toBe('WARNING');
      }
    });

    it('reports an aggregate verdict that is not PASS', () => {
      // Two open warnings must not read as ready.
      expect(report.verdict).toBe('WARNING');
      expect(report.findings.filter((entry) => entry.verdict === 'ERROR')).toEqual([]);
    });
  });

  describe('the checks can fail', () => {
    const base = (overrides: Partial<MobileAppManifest> = {}): MobileAppManifest => ({
      app: 'customer-mobile',
      name: 'MonieNaija',
      slug: 'moneynaija-customer',
      version: '2.3.1',
      iosBundleIdentifier: 'ng.monienaija.customer',
      androidPackage: 'ng.monienaija.customer',
      iosBuildNumber: '17',
      androidVersionCode: 17,
      runtimeVersion: '2.3.0',
      packageVersion: '2.3.1',
      ...overrides,
    });

    it('rejects a version the register cannot parse', () => {
      const result = evaluateManifests([
        base({ version: '1.0.0-beta.1', packageVersion: '1.0.0-beta.1' }),
      ]);
      const entry = result.findings.find((item) => item.check === 'version-format');
      expect(entry?.verdict).toBe('ERROR');
      expect(entry?.detail).toMatch(/permanently UNKNOWN/);
      expect(result.verdict).toBe('ERROR');
    });

    it('rejects two versions for one artefact', () => {
      const result = evaluateManifests([base({ version: '2.3.1', packageVersion: '2.3.0' })]);
      expect(result.findings.find((item) => item.check === 'version-consistency')?.verdict).toBe(
        'ERROR',
      );
    });

    it('rejects a changed bundle identifier', () => {
      const result = evaluateManifests([base({ iosBundleIdentifier: 'ng.example.renamed' })]);
      const entry = result.findings.find((item) => item.check === 'identifier-stability');
      expect(entry?.verdict).toBe('ERROR');
      expect(entry?.detail).toMatch(/orphans/);
    });

    it('rejects two apps sharing one identifier', () => {
      // A store rejects the second submission, and two apps cannot be installed side by side.
      const result = evaluateManifests([
        base({ app: 'customer-mobile' }),
        base({ app: 'agent-mobile', androidPackage: 'ng.monienaija.customer' }),
      ]);
      expect(
        result.findings.some(
          (item) => item.check === 'identifier-uniqueness' && item.verdict === 'ERROR',
        ),
      ).toBe(true);
    });

    it('rejects a build number the store would refuse', () => {
      const result = evaluateManifests([base({ iosBuildNumber: '0', androidVersionCode: 0 })]);
      expect(result.findings.find((item) => item.check === 'ios-build-number')?.verdict).toBe(
        'ERROR',
      );
      expect(result.findings.find((item) => item.check === 'android-version-code')?.verdict).toBe(
        'ERROR',
      );
    });

    it('warns when the platforms drift apart on build number', () => {
      // Not an error — the platforms genuinely diverge — but support cannot map a user to a build otherwise.
      const result = evaluateManifests([base({ iosBuildNumber: '17', androidVersionCode: 18 })]);
      expect(result.findings.find((item) => item.check === 'build-number-alignment')?.verdict).toBe(
        'WARNING',
      );
    });

    it('passes a genuinely consistent release', () => {
      const result = evaluateManifests([
        base({ app: 'customer-mobile', version: '2.3.1', runtimeVersion: '2.3.0' }),
        base({
          app: 'agent-mobile',
          version: '4.1.0',
          packageVersion: '4.1.0',
          iosBundleIdentifier: 'ng.monienaija.agent',
          androidPackage: 'ng.monienaija.agent',
          runtimeVersion: '4.1.0',
        }),
      ]);
      expect(result.verdict).toBe('PASS');
      expect(result.findings.filter((entry) => entry.verdict !== 'PASS')).toEqual([]);
    });
  });

  describe('version parsing is strict', () => {
    it('accepts three numeric components', () => {
      expect(parseSemver('1.4.2')).toEqual({ major: 1, minor: 4, patch: 2 });
      expect(parseSemver('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
    });

    it('rejects everything the register would reject', () => {
      for (const version of ['1.0', '1.0.0.0', 'v1.0.0', '1.0.0-rc.1', '', 'latest']) {
        expect(parseSemver(version)).toBeNull();
      }
    });
  });

  describe('manifests are read from disk, not assumed', () => {
    it('reads the real files', () => {
      const manifest = readManifest(repoRoot, 'customer-mobile');
      expect(manifest.name.length).toBeGreaterThan(0);
      expect(manifest.slug).toBe('moneynaija-customer');
      expect(manifest.packageVersion).toBe(manifest.version);
    });
  });

  describe('what this does not claim', () => {
    it('performs no build, signing, submission or installation', () => {
      /*
       * There is no Xcode, no Android SDK, no signing identity, no store account and no device in this
       * environment. Each of those is a release step, and the report lists them as not performed rather than
       * leaving their absence to be inferred.
       */
      expect(report.notPerformed.length).toBe(6);
      for (const entry of report.notPerformed) expect(entry.length).toBeGreaterThan(20);
      expect(report.notPerformed.join(' ')).toMatch(/no binary was signed/);
      expect(report.notPerformed.join(' ')).toMatch(/no submission/);
    });

    it('reports no device or store evidence', () => {
      const serialized = JSON.stringify(report);
      expect(serialized).not.toMatch(/"deviceInstalled"|"storeApproved"|"signed"|"uploaded"/);
    });

    it('does not claim the register is seeded', () => {
      // Group 25 deliberately left `mobile_client_builds` empty; release management decides the floor. A static
      // manifest check must not imply a build has been registered.
      const serialized = JSON.stringify(report);
      expect(serialized).not.toMatch(/registered in|is supported by the server/);
    });
  });
});
