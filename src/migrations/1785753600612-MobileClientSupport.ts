import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D Group 25 — customer and agent mobile client support.
 *
 * ## What already exists
 *
 * Both clients are served: `CustomerAppController` and the `agent-app` / agent cash-in / cash-out /
 * cash-to-cash controllers expose the mobile surface, and `ApiVersionService` reports an API version,
 * the supported list and a `deprecated: []` array.
 *
 * ## The gap
 *
 * `ApiVersionService` is a **report**. Nothing reads the `X-API-Version` header it advertises, `deprecated` is
 * a hard-coded empty array, and `APP_VERSION` describes the *server*. There is therefore no answer to the
 * only question a mobile release actually turns on:
 *
 * > "A customer is running a build from eight months ago. Is that acceptable, and if not, what should happen?"
 *
 * Concretely, none of the following existed:
 *
 * 1. **No client version registry.** Nothing records which builds of the customer app or agent app exist, or
 *    which are supported.
 * 2. **No minimum-supported version.** A build that predates a security fix keeps working forever, because
 *    nothing can say it is no longer permitted.
 * 3. **No degradation policy.** "Force update" and "works but warn" are different decisions, and a single
 *    boolean cannot express the range in between — a build that is *old* is usable, a build that is
 *    *unsafe* is not.
 * 4. **No visibility.** An operator cannot see how much of the installed base is on an unsupported build, so
 *    a force-update cannot be timed against real adoption.
 *
 * ## Version ordering is numeric, not lexical
 *
 * `9.10.0` must sort above `9.9.0`. Storing semver as text and comparing with `<` gets this wrong, and the
 * failure is silent and only shows up on the release that crosses a double-digit component. Versions are
 * therefore stored as three integers with a text label, and compared numerically.
 *
 * ## What is deliberately not decided here
 *
 * - **No minimum is seeded.** Which build must be considered unsupported is a release-management decision
 *   made after the build has shipped and adoption has been measured. Seeding a minimum would block real users
 *   of a real app on the strength of an invented number.
 * - **No update URL, store identifier or deep link.** Those belong to the client applications and app-store
 *   configuration, not to this server.
 * - **No platform detection heuristics.** The client reports its own platform; guessing from a user agent is
 *   unreliable and would mis-classify exactly the old builds that matter.
 */

/** Support posture a client build can be in. */
export const CLIENT_SUPPORT_STATES = ['SUPPORTED', 'DEPRECATED', 'BLOCKED'] as const;
export type ClientSupportState = (typeof CLIENT_SUPPORT_STATES)[number];

export class MobileClientSupport1785753600612 implements MigrationInterface {
  name = 'MobileClientSupport1785753600612';

  async up(q: QueryRunner): Promise<void> {
    /*
     * ---------------------------------------------------------------------------------------------
     * 1. Registered client builds.
     * ---------------------------------------------------------------------------------------------
     * A row per (client, platform, version). Not per device: this is a release register, not device
     * telemetry, and storing a device identity here would be a privacy liability with no operational
     * benefit.
     */
    await q.query(`CREATE TABLE mobile_client_builds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Which app. Bounded because these are the clients that actually exist in this repository.
      client varchar(20) NOT NULL CHECK (client IN ('CUSTOMER_APP', 'AGENT_APP')),
      platform varchar(10) NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
      -- Semantic version, stored as components so ordering is numeric. Comparing '9.10.0' < '9.9.0' as text
      -- is the bug this avoids; it is silent until a component crosses into two digits.
      version_major integer NOT NULL CHECK (version_major >= 0),
      version_minor integer NOT NULL CHECK (version_minor >= 0),
      version_patch integer NOT NULL CHECK (version_patch >= 0),
      -- The human-facing label, e.g. '1.4.2'. Must match the components or the register and the store listing
      -- disagree about what shipped.
      version_label varchar(40) NOT NULL,
      /*
       * The lowest build that is still permitted to transact. Null means "no floor has been set for this
       * build", which is reported honestly rather than treated as zero. Setting it to a build's own version
       * makes that build the floor; setting it above a build's version blocks that build.
       */
      minimum_supported_major integer NOT NULL CHECK (minimum_supported_major >= 0),
      minimum_supported_minor integer NOT NULL CHECK (minimum_supported_minor >= 0),
      minimum_supported_patch integer NOT NULL CHECK (minimum_supported_patch >= 0),
      -- Free-form note explaining why the floor exists. Required when the floor is above this build's own
      -- version, because "why can I not use my app" is a support question with a specific answer.
      floor_rationale varchar(500),
      released_at timestamptz,
      registered_by varchar(160) NOT NULL,
      registered_at timestamptz NOT NULL DEFAULT now(),
      CHECK (length(btrim(version_label)) > 0),
      -- A floor above this build's version means this build is blocked; it must then say why.
      CHECK (
        (minimum_supported_major, minimum_supported_minor, minimum_supported_patch)
          <= (version_major, version_minor, version_patch)
        OR (floor_rationale IS NOT NULL AND length(btrim(floor_rationale)) > 0)
      )
    )`);

    /*
     * One row per client/platform/version. Re-registering the same build must update it, not create a second
     * row that could disagree about whether it is supported.
     */
    await q.query(`CREATE UNIQUE INDEX uq_mobile_client_builds_version
      ON mobile_client_builds (client, platform, version_major, version_minor, version_patch)`);

    /*
     * The lookup a request makes: "what is the latest and the floor for this client's platform". Note there is
     * deliberately no index on version_label: nothing should ever compare labels, only components.
     */
    await q.query(`CREATE INDEX idx_mobile_client_builds_lookup
      ON mobile_client_builds (client, platform, version_major DESC, version_minor DESC, version_patch DESC)`);

    /*
     * The register is a release fact and must not be rewritten. A build that shipped did ship; changing the
     * record later would make "we never supported that build" possible.
     */
    await q.query(`CREATE OR REPLACE FUNCTION reject_mobile_build_delete() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'mobile_client_builds cannot be deleted; a shipped build is a release fact';
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER mobile_client_builds_no_delete
      BEFORE DELETE ON mobile_client_builds
      FOR EACH ROW EXECUTE FUNCTION reject_mobile_build_delete()`);

    await q.query(`CREATE OR REPLACE FUNCTION enforce_mobile_build_identity_immutable() RETURNS trigger AS $$
      BEGIN
        IF NEW.client IS DISTINCT FROM OLD.client
          OR NEW.platform IS DISTINCT FROM OLD.platform
          OR (NEW.version_major, NEW.version_minor, NEW.version_patch)
             IS DISTINCT FROM (OLD.version_major, OLD.version_minor, OLD.version_patch)
          OR NEW.version_label IS DISTINCT FROM OLD.version_label
        THEN
          RAISE EXCEPTION 'a mobile build identity is immutable; register a new build instead';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER mobile_client_builds_identity_immutable
      BEFORE UPDATE ON mobile_client_builds
      FOR EACH ROW EXECUTE FUNCTION enforce_mobile_build_identity_immutable()`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 2. Version observations.
     * ---------------------------------------------------------------------------------------------
     * A coarse, non-identifying count of what is actually in the field: how many requests came from each
     * (client, platform, version) per day. Deliberately not per-device and not per-customer — an operator
     * needs adoption percentages to time a force-update, not a list of who is running an old app.
     *
     * `day` is a date rather than a timestamp so the row count stays bounded and no request-time fingerprint
     * can be reconstructed from it.
     */
    await q.query(`CREATE TABLE mobile_client_observations (
      client varchar(20) NOT NULL CHECK (client IN ('CUSTOMER_APP', 'AGENT_APP')),
      platform varchar(10) NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
      version_major integer NOT NULL CHECK (version_major >= 0),
      version_minor integer NOT NULL CHECK (version_minor >= 0),
      version_patch integer NOT NULL CHECK (version_patch >= 0),
      day date NOT NULL,
      -- Number of distinct *sessions* seen, incremented at most once per session per day. Counting requests
      -- would make a single retry-heavy client look like a large part of the installed base.
      session_count bigint NOT NULL DEFAULT 0 CHECK (session_count >= 0),
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (client, platform, version_major, version_minor, version_patch, day)
    )`);

    await q.query(`CREATE INDEX idx_mobile_client_observations_day
      ON mobile_client_observations (day DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    /*
     * Refuses while any build is registered.
     *
     * Not because the data is financial, but because the register is the only record of which builds were
     * ever supported and when the floor moved. Dropping it would make a past force-update unexplainable to a
     * customer who complained about it.
     */
    const rows = (await q.query(`SELECT count(*)::int AS n FROM mobile_client_builds`)) as Array<{
      n: number;
    }>;
    const builds = rows[0]?.n ?? 0;
    if (builds > 0) {
      throw new Error(
        `Refusing to roll back MobileClientSupport1785753600612: ${builds} client build(s) are registered. ` +
          'Dropping this table would make a past force-update unexplainable.',
      );
    }

    await q.query(
      `DROP TRIGGER IF EXISTS mobile_client_builds_identity_immutable ON mobile_client_builds`,
    );
    await q.query(`DROP TRIGGER IF EXISTS mobile_client_builds_no_delete ON mobile_client_builds`);
    await q.query(`DROP FUNCTION IF EXISTS enforce_mobile_build_identity_immutable()`);
    await q.query(`DROP FUNCTION IF EXISTS reject_mobile_build_delete()`);
    await q.query(`DROP TABLE IF EXISTS mobile_client_observations`);
    await q.query(`DROP TABLE IF EXISTS mobile_client_builds`);
  }
}
