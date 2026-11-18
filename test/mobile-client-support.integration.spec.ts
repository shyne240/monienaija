import type { DataSource } from 'typeorm';

import { MobileClientSupportService } from '../src/mobile/mobile-client-support.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * ARENA 3D Group 25 — customer and agent mobile client support.
 *
 * The properties under test:
 *
 * 1. **Versions compare numerically.** `9.10.0` above `9.9.0`, which text comparison gets wrong.
 * 2. **The floor comes from the register, not from the client's own row** — otherwise an old client keeps
 *    its old floor forever, which is the exact failure a force-update exists to prevent.
 * 3. **Unknown and malformed versions are served, not blocked** — a client bug must not become an outage.
 * 4. **A blocked build must state why**, because "why can't I use my app" is a support question.
 */
describe('Group 25 — mobile client support', () => {
  let db: DataSource;
  let service: MobileClientSupportService;

  beforeAll(async () => {
    db = await createIntegrationDataSource('g25mob');
    service = new MobileClientSupportService(db);
  }, 180_000);

  afterAll(async () => {
    await destroyIntegrationDataSource(db);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  describe('version comparison is numeric', () => {
    it('ranks 9.10.0 above 9.9.0', async () => {
      /*
       * The bug this avoids is silent: string comparison puts '9.10.0' below '9.9.0', and nothing notices
       * until a release crosses a double-digit component — at which point the force-update logic inverts.
       */
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '9.9.0',
        minimumSupportedVersion: '1.0.0',
        registeredBy: 'release',
      });
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '9.10.0',
        minimumSupportedVersion: '1.0.0',
        registeredBy: 'release',
      });

      const decision = await service.evaluate({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '9.9.0',
      });

      // 9.9.0 is behind the latest 9.10.0, so it is deprecated — not the reverse.
      expect(decision.state).toBe('DEPRECATED');
      expect(decision.latestVersion).toBe('9.10.0');
    });

    it('rejects a malformed version at registration', async () => {
      await expect(
        service.registerBuild({
          client: 'CUSTOMER_APP',
          platform: 'ANDROID',
          version: '1.4',
          minimumSupportedVersion: '1.0.0',
          registeredBy: 'release',
        }),
      ).rejects.toThrow(/three numeric components/i);
    });
  });

  describe('three support states', () => {
    beforeEach(async () => {
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.0.0',
        minimumSupportedVersion: '1.0.0',
        registeredBy: 'release',
      });
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.4.0',
        minimumSupportedVersion: '1.2.0',
        registeredBy: 'release',
      });
    });

    it('supports a build at the latest version', async () => {
      const decision = await service.evaluate({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.4.0',
      });
      expect(decision.state).toBe('SUPPORTED');
      expect(decision.allowed).toBe(true);
      expect(decision.minimumVersion).toBe('1.2.0');
    });

    it('deprecates an old but still usable build without refusing it', async () => {
      // An old app that still works is not a security event, and refusing money because someone has not
      // updated is a worse outcome than a stale UI.
      const decision = await service.evaluate({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.2.5',
      });
      expect(decision.state).toBe('DEPRECATED');
      expect(decision.allowed).toBe(true);
      expect(decision.code).toBe('CLIENT_UPDATE_RECOMMENDED');
    });

    it('blocks a build below the floor', async () => {
      const decision = await service.evaluate({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.1.0',
      });
      expect(decision.state).toBe('BLOCKED');
      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe('CLIENT_UPDATE_REQUIRED');
      expect(decision.minimumVersion).toBe('1.2.0');
    });

    it('takes the floor from the register, not from the client own row', async () => {
      /*
       * The critical correctness point. 1.0.0's own row still carries a floor of 1.0.0. If the floor were read
       * from the matching row, an old client would keep its old floor forever and the force-update would
       * never take effect.
       */
      const decision = await service.evaluate({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.0.0',
      });

      expect(decision.state).toBe('BLOCKED');
      expect(decision.minimumVersion).toBe('1.2.0');
    });

    it('is per platform and per client', async () => {
      // Raising Android's floor must not block iOS or the agent app.
      const ios = await service.evaluate({
        client: 'CUSTOMER_APP',
        platform: 'IOS',
        version: '1.0.0',
      });
      const agent = await service.evaluate({
        client: 'AGENT_APP',
        platform: 'ANDROID',
        version: '1.0.0',
      });

      expect(ios.state).toBe('UNKNOWN');
      expect(agent.state).toBe('UNKNOWN');
      expect(ios.allowed).toBe(true);
      expect(agent.allowed).toBe(true);
    });
  });

  describe('unknown clients are served, not blocked', () => {
    it('serves a version the register has never seen', async () => {
      /*
       * A register that starts empty is the normal case. Blocking on an unregistered version would take the
       * platform down for every user of a build shipped before the register was populated.
       */
      const decision = await service.evaluate({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '7.7.7',
      });

      expect(decision.state).toBe('UNKNOWN');
      expect(decision.allowed).toBe(true);
      expect(decision.code).toBe('CLIENT_VERSION_UNKNOWN');
    });

    it('serves a malformed version rather than locking the user out', async () => {
      // A client parsing bug must not become an outage for every user of that build.
      const decision = await service.evaluate({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: 'not-a-version',
      });
      expect(decision.state).toBe('UNKNOWN');
      expect(decision.allowed).toBe(true);
    });

    it('reports an empty register honestly as unknown, not as supported', async () => {
      const decision = await service.evaluate({
        client: 'AGENT_APP',
        platform: 'IOS',
        version: '1.0.0',
      });
      expect(decision.state).toBe('UNKNOWN');
    });
  });

  describe('a blocked build must state why', () => {
    it('refuses a floor above a build with no rationale', async () => {
      await expect(
        service.registerBuild({
          client: 'CUSTOMER_APP',
          platform: 'ANDROID',
          version: '1.0.0',
          minimumSupportedVersion: '2.0.0',
          registeredBy: 'release',
        }),
      ).rejects.toThrow(/must state why/i);
    });

    it('refuses the same thing at the database layer', async () => {
      await expect(
        db.query(
          `INSERT INTO mobile_client_builds (
             client, platform, version_major, version_minor, version_patch, version_label,
             minimum_supported_major, minimum_supported_minor, minimum_supported_patch, registered_by
           ) VALUES ('CUSTOMER_APP','ANDROID',1,0,0,'1.0.0',2,0,0,'release')`,
        ),
      ).rejects.toThrow();
    });

    it('accepts a floor above a build when the reason is given', async () => {
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.0.0',
        minimumSupportedVersion: '2.0.0',
        floorRationale: 'Security fix for token handling in the session refresh path.',
        registeredBy: 'release',
      });

      const builds = await service.listBuilds('CUSTOMER_APP', 'ANDROID');
      expect(builds[0]?.floorRationale).toMatch(/Security fix/);
    });

    it('refuses a registration with no named principal', async () => {
      await expect(
        service.registerBuild({
          client: 'CUSTOMER_APP',
          platform: 'ANDROID',
          version: '1.0.0',
          minimumSupportedVersion: '1.0.0',
          registeredBy: '  ',
        }),
      ).rejects.toThrow(/named principal/i);
    });
  });

  describe('the register is a release fact', () => {
    it('updates the floor rather than duplicating a build', async () => {
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.0.0',
        minimumSupportedVersion: '1.0.0',
        registeredBy: 'release',
      });
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.0.0',
        minimumSupportedVersion: '1.0.0',
        registeredBy: 'release',
      });

      const rows: Array<{ n: number }> = await db.query(
        `SELECT count(*)::int AS n FROM mobile_client_builds`,
      );
      expect(firstRow(rows, 'builds').n).toBe(1);
    });

    it('refuses to delete a shipped build', async () => {
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.0.0',
        minimumSupportedVersion: '1.0.0',
        registeredBy: 'release',
      });
      await expect(db.query(`DELETE FROM mobile_client_builds`)).rejects.toThrow(/release fact/i);
    });

    it('refuses to rewrite what shipped', async () => {
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.0.0',
        minimumSupportedVersion: '1.0.0',
        registeredBy: 'release',
      });
      await expect(db.query(`UPDATE mobile_client_builds SET version_minor = 9`)).rejects.toThrow(
        /immutable/i,
      );
    });

    it('lists builds newest first, by number not by label', async () => {
      for (const version of ['1.9.0', '1.10.0', '1.2.0']) {
        await service.registerBuild({
          client: 'CUSTOMER_APP',
          platform: 'ANDROID',
          version,
          minimumSupportedVersion: '1.0.0',
          registeredBy: 'release',
        });
      }

      const builds = await service.listBuilds('CUSTOMER_APP', 'ANDROID');
      expect(builds.map((build) => build.version)).toEqual(['1.10.0', '1.9.0', '1.2.0']);
    });
  });

  describe('adoption visibility times a force-update against reality', () => {
    beforeEach(async () => {
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.4.0',
        minimumSupportedVersion: '1.2.0',
        registeredBy: 'release',
      });
    });

    it('separates blocked sessions from deprecated ones', async () => {
      // Opposite decisions: a large deprecated share means announce the update; a large blocked share means
      // the floor was raised too early.
      const now = new Date('2026-05-01T12:00:00.000Z');
      for (let index = 0; index < 3; index += 1) {
        await service.recordSession({
          client: 'CUSTOMER_APP',
          platform: 'ANDROID',
          version: '1.4.0',
          now,
        });
      }
      for (let index = 0; index < 2; index += 1) {
        await service.recordSession({
          client: 'CUSTOMER_APP',
          platform: 'ANDROID',
          version: '1.3.0',
          now,
        });
      }
      await service.recordSession({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.0.0',
        now,
      });

      const posture = await service.adoptionPosture({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        days: 7,
        now,
      });

      expect(posture.totalSessions).toBe(6);
      expect(posture.deprecatedSessions).toBe(2);
      expect(posture.blockedSessions).toBe(1);
    });

    it('stores no device, customer or request identifier', async () => {
      // An operator needs the share of the installed base on an old build, not a list of who.
      await service.recordSession({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.4.0',
        now: new Date('2026-05-01T12:00:00.000Z'),
      });

      const columns: Array<{ column_name: string }> = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'mobile_client_observations'`,
      );
      const names = columns.map((column) => column.column_name);
      expect(names).not.toContain('device_id');
      expect(names).not.toContain('customer_id');
      expect(names).not.toContain('request_id');
    });

    it('does not fail a request when telemetry cannot be written', async () => {
      // Adoption metrics are never worth failing a customer request over.
      await expect(
        service.recordSession({
          client: 'CUSTOMER_APP',
          platform: 'ANDROID',
          version: 'garbage',
        }),
      ).resolves.toBeUndefined();
    });

    it('reports unregistered session share so the gap is visible', async () => {
      const now = new Date('2026-05-01T12:00:00.000Z');
      // Above every registered build: legitimately allowed during a rollout, but the register has not seen it,
      // so it must not be reported as SUPPORTED.
      await service.recordSession({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '5.0.0',
        now,
      });

      const posture = await service.adoptionPosture({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        days: 7,
        now,
      });

      expect(posture.unregisteredSessions).toBe(1);
    });
  });

  describe('rollback is refused while builds are registered', () => {
    it('refuses down() rather than making a past force-update unexplainable', async () => {
      await service.registerBuild({
        client: 'CUSTOMER_APP',
        platform: 'ANDROID',
        version: '1.0.0',
        minimumSupportedVersion: '1.0.0',
        registeredBy: 'release',
      });

      const { MobileClientSupport1785753600612 } = await import(
        '../src/migrations/1785753600612-MobileClientSupport'
      );
      const migration = new MobileClientSupport1785753600612();
      const runner = { query: (sql: string) => db.query(sql) };

      await expect(
        migration.down(runner as unknown as Parameters<typeof migration.down>[0]),
      ).rejects.toThrow(/Refusing to roll back/i);
    });
  });
});
