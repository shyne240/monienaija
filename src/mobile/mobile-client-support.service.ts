import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * ARENA 3D Group 25 — customer and agent mobile client support.
 *
 * ## The question this answers
 *
 * A customer is running a build from eight months ago. Is that acceptable, and if not, what should happen?
 * Before this service the system could not answer: `ApiVersionService` advertises an `X-API-Version` header
 * nobody reads, and `APP_VERSION` describes the server, so every client build was equally supported forever.
 *
 * ## Three states, not a boolean
 *
 * A "force update" flag is too coarse, because the range between "works fine" and "must not be used" is where
 * every real mobile decision happens:
 *
 * - `SUPPORTED` — at or above the floor. Nothing to say.
 * - `DEPRECATED` — usable, but a newer build is available. The client is told an update is recommended, and
 *   transactions are **not** refused: an old app that still works is not a security event, and refusing money
 *   to a customer because they have not updated is a worse outcome than a stale UI.
 * - `BLOCKED` — below the floor. The client is told to update before transacting.
 *
 * `BLOCKED` is a genuine refusal and therefore needs a stated reason in the register
 * (`floor_rationale`), enforced by a constraint: "why can't I use my app" is a support question with a
 * specific answer, and an unexplained block is the kind of thing that becomes a complaint.
 *
 * ## Version comparison is numeric
 *
 * `9.10.0` sorts above `9.9.0`. Comparing the text labels gets this wrong, silently, and only on the release
 * that crosses a double-digit component. This service only ever compares integer triples.
 *
 * ## Unknown builds are not blocked
 *
 * A client that reports a version the register has never seen is treated as `UNKNOWN`, and served. Blocking
 * on an unregistered version would take the platform down for every user of a build shipped before the
 * register was populated — and a register that starts empty is the normal case. `UNKNOWN` is reported as
 * such, so the gap is visible rather than invisible.
 */

export type ClientKind = 'CUSTOMER_APP' | 'AGENT_APP';
export type ClientPlatform = 'ANDROID' | 'IOS';

export interface ClientSupportDecision {
  /** `SUPPORTED`, `DEPRECATED`, `BLOCKED`, or `UNKNOWN` when the build is not registered. */
  readonly state: 'SUPPORTED' | 'DEPRECATED' | 'BLOCKED' | 'UNKNOWN';
  /** Whether the request may proceed. False only for BLOCKED. */
  readonly allowed: boolean;
  /** Machine-readable code the client can branch on. */
  readonly code:
    | 'CLIENT_SUPPORTED'
    | 'CLIENT_UPDATE_RECOMMENDED'
    | 'CLIENT_UPDATE_REQUIRED'
    | 'CLIENT_VERSION_UNKNOWN';
  /** Human-facing message. Bounded and safe to display. */
  readonly message: string;
  readonly minimumVersion: string | null;
  readonly latestVersion: string | null;
  /** The reported version, echoed numerically so the client can display it correctly. */
  readonly reportedVersion: string;
}

interface BuildRow {
  readonly version_major: number;
  readonly version_minor: number;
  readonly version_patch: number;
  readonly version_label: string;
  readonly minimum_supported_major: number;
  readonly minimum_supported_minor: number;
  readonly minimum_supported_patch: number;
}

/** Numeric triple used for every comparison in this file. */
interface VersionTriple {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const COMPONENT_PATTERN = /^\d{1,6}$/;

@Injectable()
export class MobileClientSupportService {
  private readonly logger = new Logger(MobileClientSupportService.name);

  /* No AuditService: registering a build is release management, not a privileged action on customer data,
   * and the register itself is append-only with an immutable build identity. */
  constructor(private readonly dataSource: DataSource) {}

  /** Parses `1.4.2` into components. Rejects anything that is not three bounded integers. */
  parseVersion(label: string): VersionTriple {
    const parts = (label ?? '').trim().split('.');
    if (parts.length !== 3 || !parts.every((part) => COMPONENT_PATTERN.test(part))) {
      throw new BadRequestException(
        'A client version must be three numeric components, e.g. 1.4.2',
      );
    }
    const [major, minor, patch] = parts.map((part) => Number(part)) as [number, number, number];
    return { major, minor, patch };
  }

  /**
   * Registers or updates a build.
   *
   * Upsert rather than insert: registering the same build twice must not create two rows that could disagree
   * about whether it is supported. The build identity columns are immutable by trigger, so the update path can
   * only move the floor, never rewrite what shipped.
   */
  async registerBuild(command: {
    client: ClientKind;
    platform: ClientPlatform;
    version: string;
    minimumSupportedVersion: string;
    floorRationale?: string;
    releasedAt?: Date;
    registeredBy: string;
  }): Promise<void> {
    const version = this.parseVersion(command.version);
    const minimum = this.parseVersion(command.minimumSupportedVersion);
    const registeredBy = (command.registeredBy ?? '').trim();
    if (registeredBy.length === 0) {
      throw new BadRequestException(
        'A build registration must be attributable to a named principal',
      );
    }

    /*
     * Refuse a floor above the build's own version without a reason. The constraint enforces this too; doing
     * it here produces a clear message instead of a database error, which is the difference between a usable
     * API and one that leaks constraint names to a release engineer.
     */
    if (this.compare(minimum, version) > 0) {
      const rationale = (command.floorRationale ?? '').trim();
      if (rationale.length === 0) {
        throw new BadRequestException(
          'A support floor above this build blocks it, so it must state why',
        );
      }
    }

    await this.dataSource.query(
      `INSERT INTO mobile_client_builds (
         client, platform, version_major, version_minor, version_patch, version_label,
         minimum_supported_major, minimum_supported_minor, minimum_supported_patch,
         floor_rationale, released_at, registered_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (client, platform, version_major, version_minor, version_patch) DO UPDATE
         SET minimum_supported_major = EXCLUDED.minimum_supported_major,
             minimum_supported_minor = EXCLUDED.minimum_supported_minor,
             minimum_supported_patch = EXCLUDED.minimum_supported_patch,
             floor_rationale = EXCLUDED.floor_rationale,
             released_at = COALESCE(EXCLUDED.released_at, mobile_client_builds.released_at),
             registered_by = EXCLUDED.registered_by,
             registered_at = now()`,
      [
        command.client,
        command.platform,
        version.major,
        version.minor,
        version.patch,
        command.version.trim(),
        minimum.major,
        minimum.minor,
        minimum.patch,
        command.floorRationale?.trim().slice(0, 500) ?? null,
        command.releasedAt ?? null,
        registeredBy.slice(0, 160),
      ],
    );
  }

  /**
   * Decides whether a reported build may proceed.
   *
   * The only function a request path needs. It never throws on an unknown or malformed version — a client
   * that cannot report its version properly must still be served, or a bug in the client becomes an outage
   * for every one of its users.
   */
  async evaluate(request: {
    client: ClientKind;
    platform: ClientPlatform;
    version: string;
  }): Promise<ClientSupportDecision> {
    const reported = this.safeParse(request.version);

    if (!reported) {
      /*
       * A malformed version is treated as unknown rather than rejected. Rejecting it would mean a client
       * parsing bug locks every user out, turning a cosmetic defect into an outage.
       */
      return {
        state: 'UNKNOWN',
        allowed: true,
        code: 'CLIENT_VERSION_UNKNOWN',
        message: 'Your app version could not be read. Please update to the latest version.',
        minimumVersion: null,
        latestVersion: null,
        reportedVersion: (request.version ?? '').slice(0, 40),
      };
    }

    const rows: unknown = await this.dataSource.query(
      `SELECT version_major, version_minor, version_patch, version_label,
              minimum_supported_major, minimum_supported_minor, minimum_supported_patch
         FROM mobile_client_builds
        WHERE client = $1 AND platform = $2`,
      [request.client, request.platform],
    );
    const builds = this.rowsOf<BuildRow>(rows);

    if (builds.length === 0) {
      return {
        state: 'UNKNOWN',
        allowed: true,
        code: 'CLIENT_VERSION_UNKNOWN',
        message: 'This app version is not registered. Continuing.',
        minimumVersion: null,
        latestVersion: null,
        reportedVersion: this.format(reported),
      };
    }

    /*
     * Is this exact build on the register?
     *
     * A version above every registered build is not "unknown" in the dangerous sense — it is a build newer than
     * the register knows about, which happens legitimately when a release would out ahead of the register update.
     * But a version that is neither registered nor above the newest is genuinely unaccounted for, and reporting
     * it as SUPPORTED would be the register silently vouching for a build nobody ever approved.
     */
    const isRegistered = builds.some(
      (build) =>
        Number(build.version_major) === reported.major &&
        Number(build.version_minor) === reported.minor &&
        Number(build.version_patch) === reported.patch,
    );

    /*
     * The floor is the highest minimum across all registered builds, not the minimum of one row.
     *
     * A release engineer raises the floor on the newest build; an older build still carries the old, lower
     * floor. Reading the floor from the row matching the *reported* version would let an old client keep its
     * old floor forever — the exact failure a force-update is meant to prevent.
     */
    let floor: VersionTriple | null = null;
    let latest: VersionTriple | null = null;
    for (const build of builds) {
      const buildVersion: VersionTriple = {
        major: Number(build.version_major),
        minor: Number(build.version_minor),
        patch: Number(build.version_patch),
      };
      const buildFloor: VersionTriple = {
        major: Number(build.minimum_supported_major),
        minor: Number(build.minimum_supported_minor),
        patch: Number(build.minimum_supported_patch),
      };
      if (!floor || this.compare(buildFloor, floor) > 0) floor = buildFloor;
      if (!latest || this.compare(buildVersion, latest) > 0) latest = buildVersion;
    }

    const minimumVersion = floor ? this.format(floor) : null;
    const latestVersion = latest ? this.format(latest) : null;

    if (floor && this.compare(reported, floor) < 0) {
      return {
        state: 'BLOCKED',
        allowed: false,
        code: 'CLIENT_UPDATE_REQUIRED',
        message: `This version of the app is no longer supported. Please update to ${minimumVersion} or later.`,
        minimumVersion,
        latestVersion,
        reportedVersion: this.format(reported),
      };
    }

    /*
     * Above every registered build: not blocked, but not vouched for either.
     *
     * Treated as UNKNOWN rather than SUPPORTED. A client running ahead of the register is the normal transient
     * state during a rollout, so it must be allowed; calling it SUPPORTED would mean the register claims
     * knowledge of a build it has never seen.
     */
    if (!isRegistered && latest && this.compare(reported, latest) > 0) {
      return {
        state: 'UNKNOWN',
        allowed: true,
        code: 'CLIENT_VERSION_UNKNOWN',
        message: 'This app version is newer than the platform records. Continuing.',
        minimumVersion,
        latestVersion,
        reportedVersion: this.format(reported),
      };
    }

    // Deprecated means "behind the latest", which is advisory. Equal or ahead is simply supported.
    if (latest && this.compare(reported, latest) < 0) {
      return {
        state: 'DEPRECATED',
        allowed: true,
        code: 'CLIENT_UPDATE_RECOMMENDED',
        message: 'A newer version of the app is available. Updating is recommended.',
        minimumVersion,
        latestVersion,
        reportedVersion: this.format(reported),
      };
    }

    return {
      state: 'SUPPORTED',
      allowed: true,
      code: 'CLIENT_SUPPORTED',
      message: 'Supported.',
      minimumVersion,
      latestVersion,
      reportedVersion: this.format(reported),
    };
  }

  /**
   * Records one session against a build for adoption visibility.
   *
   * Called at most once per session per day by the caller. Deliberately stores no device, customer or request
   * identifier: an operator needs the percentage of the installed base on an old build in order to time a
   * force-update, and nothing about who. Failure is swallowed — a metrics write must never fail a request.
   */
  async recordSession(request: {
    client: ClientKind;
    platform: ClientPlatform;
    version: string;
    now?: Date;
  }): Promise<void> {
    const parsed = this.safeParse(request.version);
    if (!parsed) return;
    const day = (request.now ?? new Date()).toISOString().slice(0, 10);
    try {
      await this.dataSource.query(
        `INSERT INTO mobile_client_observations (
           client, platform, version_major, version_minor, version_patch, day, session_count
         ) VALUES ($1,$2,$3,$4,$5,$6,1)
         ON CONFLICT (client, platform, version_major, version_minor, version_patch, day)
         DO UPDATE SET session_count = mobile_client_observations.session_count + 1,
                       last_seen_at = now()`,
        [request.client, request.platform, parsed.major, parsed.minor, parsed.patch, day],
      );
    } catch (error) {
      // Adoption telemetry is not worth failing a customer request over.
      this.logger.warn(
        `mobile client observation could not be recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Adoption posture over a window, so a force-update can be timed against reality.
   *
   * Reports the share of sessions on a blocked build separately from the share on a deprecated one, because
   * those call for opposite decisions: a large deprecated share means announce the update, a large blocked
   * share means the floor was raised too early.
   */
  async adoptionPosture(options: {
    client: ClientKind;
    platform: ClientPlatform;
    days?: number;
    now?: Date;
  }): Promise<{
    totalSessions: number;
    blockedSessions: number;
    deprecatedSessions: number;
    unregisteredSessions: number;
    byVersion: Array<{ version: string; sessions: number; state: string }>;
  }> {
    const days = Math.min(Math.max(options.days ?? 7, 1), 90);
    const now = options.now ?? new Date();
    const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

    const rows: unknown = await this.dataSource.query(
      `SELECT version_major, version_minor, version_patch, sum(session_count)::bigint AS sessions
         FROM mobile_client_observations
        WHERE client = $1 AND platform = $2 AND day >= $3
        GROUP BY version_major, version_minor, version_patch
        ORDER BY sessions DESC`,
      [options.client, options.platform, since],
    );
    const observations = this.rowsOf<{
      version_major: number;
      version_minor: number;
      version_patch: number;
      sessions: string | number;
    }>(rows);

    let totalSessions = 0;
    let blockedSessions = 0;
    let deprecatedSessions = 0;
    let unregisteredSessions = 0;
    const byVersion: Array<{ version: string; sessions: number; state: string }> = [];

    for (const observation of observations) {
      const version = this.format({
        major: Number(observation.version_major),
        minor: Number(observation.version_minor),
        patch: Number(observation.version_patch),
      });
      const sessions = Number(observation.sessions);
      totalSessions += sessions;

      const decision = await this.evaluate({
        client: options.client,
        platform: options.platform,
        version,
      });
      if (decision.state === 'BLOCKED') blockedSessions += sessions;
      else if (decision.state === 'DEPRECATED') deprecatedSessions += sessions;
      else if (decision.state === 'UNKNOWN') unregisteredSessions += sessions;

      byVersion.push({ version, sessions, state: decision.state });
    }

    return { totalSessions, blockedSessions, deprecatedSessions, unregisteredSessions, byVersion };
  }

  /** Every registered build for a client, newest first. */
  async listBuilds(
    client: ClientKind,
    platform: ClientPlatform,
  ): Promise<
    Array<{
      version: string;
      minimumVersion: string;
      floorRationale: string | null;
      releasedAt: string | null;
    }>
  > {
    const rows: unknown = await this.dataSource.query(
      `SELECT version_major, version_minor, version_patch, version_label,
              minimum_supported_major, minimum_supported_minor, minimum_supported_patch,
              floor_rationale, released_at
         FROM mobile_client_builds
        WHERE client = $1 AND platform = $2
        ORDER BY version_major DESC, version_minor DESC, version_patch DESC`,
      [client, platform],
    );
    return this.rowsOf<{
      version_major: number;
      version_minor: number;
      version_patch: number;
      minimum_supported_major: number;
      minimum_supported_minor: number;
      minimum_supported_patch: number;
      floor_rationale: string | null;
      released_at: Date | string | null;
    }>(rows).map((row) => ({
      version: this.format({
        major: Number(row.version_major),
        minor: Number(row.version_minor),
        patch: Number(row.version_patch),
      }),
      minimumVersion: this.format({
        major: Number(row.minimum_supported_major),
        minor: Number(row.minimum_supported_minor),
        patch: Number(row.minimum_supported_patch),
      }),
      floorRationale: row.floor_rationale,
      releasedAt: row.released_at ? new Date(row.released_at).toISOString() : null,
    }));
  }

  // ---------------------------------------------------------------------------------------------

  private safeParse(label: string): VersionTriple | null {
    try {
      return this.parseVersion(label);
    } catch {
      return null;
    }
  }

  /** Numeric comparison. The whole reason versions are not compared as strings. */
  private compare(left: VersionTriple, right: VersionTriple): number {
    if (left.major !== right.major) return left.major - right.major;
    if (left.minor !== right.minor) return left.minor - right.minor;
    return left.patch - right.patch;
  }

  private format(version: VersionTriple): string {
    return `${version.major}.${version.minor}.${version.patch}`;
  }

  private rowsOf<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    const first: unknown = result[0];
    const second: unknown = result[1];
    if (result.length === 2 && Array.isArray(first) && !Array.isArray(second)) return first as T[];
    return result as T[];
  }
}
