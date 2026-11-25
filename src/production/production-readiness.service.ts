import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ReconciliationService } from '../reconciliation/reconciliation.service';
import {
  ProtectedAuthorityInspection,
  ProtectedAuthorityService,
} from '../authorization/protected-authority.service';

// V1-RELEASE-01: this marker must always equal the newest file in src/migrations/*.ts.
// See test/v1-release-01-production-readiness-migration-sync.integration.spec.ts, which runs the
// full migration chain against real PostgreSQL and fails the build if this constant and the
// actual latest migration file ever diverge.
// The schema head this build requires. A deployment whose database has not reached this migration
// refuses to serve traffic, which is the intended behaviour — advancing this constant is part of shipping
// a migration, not an afterthought.
const EXPECTED_MIGRATION_TIMESTAMP = '1785753600807';
const EXPECTED_MIGRATION_NAME = 'CaptureCustomerFundingScope1785753600807';

type Row = Record<string, unknown>;

// No production evidence adapter is configured, and no end-to-end health probes yet
// establish the remaining governance dependencies. Do not turn environment flags or
// test evidence into a readiness override. Replace these blockers only alongside real,
// independently verified integrations and their readiness checks.
// Exported so the release gate (Group 34) reads this exact list rather than keeping a copy of it.
// Verifying a dependency means editing this list, which is a reviewable change, and the release
// gate's verdict moves with it in the same commit.
export const FINANCIAL_DEPENDENCY_BLOCKERS: readonly string[] = [
  'trusted_kyc_provider_activation_unverified',
  'customer_kyc_consent_notice_and_policy_unverified',
  'identity_key_versions_unverified',
  'effective_kyc_policy_unverified',
  'provider_governance_and_routing_unverified',
  'wallet_ownership_governance_unverified',
  'institution_kyc_tier_limit_governance_unverified',
  'financial_authorization_dependencies_unverified',
];

@Injectable()
export class ProductionReadinessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reconciliationService: ReconciliationService,
    @Optional() private readonly protectedAuthority?: ProtectedAuthorityService,
  ) {}

  async verifyStartup(): Promise<void> {
    const readiness = await this.getReadiness();
    if (readiness.status !== 'ok') {
      throw new Error(`Production readiness failed: ${readiness.reason}`);
    }
  }

  async getReadiness() {
    const database = await this.checkDatabase();
    const migrations =
      database.status === 'ok'
        ? await this.checkMigrations()
        : {
            status: 'error' as const,
            compatible: false,
            appliedCount: 0,
            expectedCount: 0,
            missing: [] as string[],
            unexpected: [] as string[],
            latestTimestamp: null,
            latestName: null,
          };
    let reconciliation: 'PASS' | 'WARNING' | 'ERROR' = 'ERROR';
    if (migrations.compatible) {
      try {
        reconciliation = (await this.reconciliationService.runReconciliation()).status;
      } catch {
        reconciliation = 'ERROR';
      }
    }
    const pendingOutbox = await this.pendingOutboxCount();
    // Verify the real implemented boundary instead of asserting availability. In production the
    // authority inspection must prove a distinct, non-privileged credential that owns protected
    // checker evidence while the runtime role cannot write it. Any missing/unsafe result keeps
    // production unavailable: there is deliberately no environment override.
    const inspection =
      process.env.NODE_ENV === 'production' && database.status === 'ok'
        ? await this.checkProtectedAuthority()
        : ({ status: 'not_evaluated' } as const);
    const protectedCheckerAuthority = inspection.status;
    const runtimeDatabaseRole =
      process.env.NODE_ENV === 'production' && database.status === 'ok'
        ? await this.checkRuntimeDatabaseRole()
        : { status: 'not_evaluated' as const };
    const status =
      database.status === 'ok' &&
      migrations.compatible &&
      reconciliation !== 'ERROR' &&
      pendingOutbox >= 0 &&
      protectedCheckerAuthority !== 'unavailable' &&
      protectedCheckerAuthority !== 'not_configured' &&
      protectedCheckerAuthority !== 'unsafe' &&
      runtimeDatabaseRole.status !== 'unsafe' &&
      runtimeDatabaseRole.status !== 'unavailable' &&
      FINANCIAL_DEPENDENCY_BLOCKERS.length === 0
        ? 'ok'
        : 'error';
    const reason =
      status === 'ok'
        ? null
        : database.status !== 'ok'
          ? 'database_unavailable'
          : !migrations.compatible
            ? 'schema_incompatible'
            : reconciliation === 'ERROR'
              ? 'reconciliation_not_ready'
              : pendingOutbox < 0
                ? 'outbox_unavailable'
                : runtimeDatabaseRole.status === 'unsafe' ||
                    runtimeDatabaseRole.status === 'unavailable'
                  ? 'runtime_database_role_unsafe'
                  : protectedCheckerAuthority === 'not_configured'
                    ? 'protected_checker_authority_not_configured'
                    : protectedCheckerAuthority === 'unsafe'
                      ? 'protected_checker_authority_unsafe'
                      : protectedCheckerAuthority === 'unavailable'
                        ? 'protected_checker_authority_unavailable'
                        : 'financial_dependencies_not_ready';
    return {
      status,
      reason,
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
      apiVersion: process.env.API_VERSION ?? 'v1',
      database,
      migrations,
      reconciliation: { status: reconciliation },
      protectedCheckerAuthority: inspection,
      runtimeDatabaseRole,
      financialDependencies: {
        status: 'error' as const,
        blockers: [...FINANCIAL_DEPENDENCY_BLOCKERS],
      },
      pendingOutbox,
      checkedAt: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<{ status: 'ok' | 'error' }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return { status: 'error' };
    }
  }

  private async checkProtectedAuthority(): Promise<
    ProtectedAuthorityInspection | { status: 'not_configured' }
  > {
    if (!this.protectedAuthority) return { status: 'not_configured' };
    const inspection = await this.protectedAuthority.inspect();
    return inspection;
  }

  /** A preliminary negative check only; a safe result is not proof of authority isolation. */
  private async checkRuntimeDatabaseRole(): Promise<{
    status: 'no_obvious_escalation' | 'unsafe' | 'unavailable';
  }> {
    try {
      const result: unknown = await this.dataSource.query(`
        SELECT (active_role.rolsuper OR active_role.rolcreaterole OR active_role.rolcreatedb
          OR active_role.rolreplication OR active_role.rolbypassrls
          OR login_role.rolsuper OR login_role.rolcreaterole OR login_role.rolcreatedb
          OR login_role.rolreplication OR login_role.rolbypassrls
          OR pg_has_role(session_user, db.datdba, 'MEMBER')
          OR pg_has_role(session_user, ns.nspowner, 'MEMBER')
          OR has_schema_privilege(session_user, ns.oid, 'CREATE')
          OR EXISTS (SELECT 1 FROM pg_class c
            WHERE c.relnamespace=ns.oid AND c.relkind IN ('r','p','v','m','S')
              AND c.relname IN ('privileged_action_approvals', 'a2_workforce_sessions',
                'a2_finance_role_assignments', 'financial_institutions',
                'institution_agent_affiliations', 'governed_institution_affiliations',
                'governed_institution_lifecycle_executions', 'institution_affiliation_transition_evidence',
                'governed_institution_affiliation_replay_results', 'governed_wallet_ownership_resolutions')
              AND pg_has_role(session_user, c.relowner, 'MEMBER'))
        ) AS unsafe
        FROM pg_roles active_role JOIN pg_roles login_role ON login_role.rolname=session_user
        JOIN pg_database db ON db.datname=current_database()
        JOIN pg_namespace ns ON ns.nspname='public'
        WHERE active_role.rolname=current_user
      `);
      const value = rowsOf(result)[0]?.unsafe;
      return {
        status:
          value === false ? 'no_obvious_escalation' : value === true ? 'unsafe' : 'unavailable',
      };
    } catch {
      return { status: 'unavailable' };
    }
  }

  /**
   * The complete migration inventory, not only the head.
   *
   * The deployed repository's loaded migration classes are the source of truth. Every loaded
   * migration must be recorded as applied and no unknown migration may be applied. That detects a
   * skipped EARLIER id (for example a database that somehow applied 0401 but not 0400, or missed a
   * whole range), instead of a head-only check silently accepting it. The consolidated financial
   * engine's published ids (0117 reversal executions, 0140-0146 commitments/inbound/A7) are part of
   * the loaded inventory like any other migration: they are required as published and are never
   * renumbered or fabricated. See `test/migration-inventory.spec.ts`.
   */
  private async checkMigrations() {
    try {
      const result: unknown = await this.dataSource.query(
        `SELECT timestamp::text AS timestamp, name
           FROM typeorm_migrations
          ORDER BY timestamp ASC`,
      );
      const applied = rowsOf(result).map((row) => ({
        timestamp: stringValue(row.timestamp),
        name: stringValue(row.name),
      }));
      const latest = applied[applied.length - 1] ?? { timestamp: '', name: '' };
      const expected = this.expectedMigrations();
      // Compare full identities, not just names. An empty or malformed loaded inventory must
      // never degrade into a head-only check, nor may duplicate rows hide a missing migration.
      const identity = (row: { timestamp: string; name: string }) => `${row.timestamp}:${row.name}`;
      const appliedIdentities = new Set(applied.map(identity));
      const expectedIdentities = new Set(expected.map(identity));
      const missing = expected
        .filter((row) => !appliedIdentities.has(identity(row)))
        .map((row) => row.name);
      const unexpected = applied
        .filter((row) => !expectedIdentities.has(identity(row)))
        .map((row) => row.name);
      const loaded = this.dataSource.migrations;
      const compatible =
        Array.isArray(loaded) &&
        expected.length > 0 &&
        expected.length === loaded.length &&
        expectedIdentities.size === expected.length &&
        new Set(expected.map((row) => row.timestamp)).size === expected.length &&
        appliedIdentities.size === applied.length &&
        applied.length === expected.length &&
        expectedIdentities.has(`${EXPECTED_MIGRATION_TIMESTAMP}:${EXPECTED_MIGRATION_NAME}`) &&
        latest.timestamp === EXPECTED_MIGRATION_TIMESTAMP &&
        latest.name === EXPECTED_MIGRATION_NAME &&
        missing.length === 0 &&
        unexpected.length === 0;
      return {
        status: compatible ? ('ok' as const) : ('error' as const),
        compatible,
        appliedCount: applied.length,
        expectedCount: expected.length,
        missing,
        unexpected,
        latestTimestamp: latest.timestamp || null,
        latestName: latest.name || null,
      };
    } catch {
      return {
        status: 'error' as const,
        compatible: false,
        appliedCount: 0,
        expectedCount: 0,
        missing: [] as string[],
        unexpected: [] as string[],
        latestTimestamp: null,
        latestName: null,
      };
    }
  }

  /** Migration classes this application actually ships, derived from the loaded DataSource. */
  private expectedMigrations(): Array<{ timestamp: string; name: string }> {
    const migrations = this.dataSource.migrations;
    if (!Array.isArray(migrations)) return [];
    return migrations
      .map((migration) => {
        const name = typeof migration.name === 'string' ? migration.name : '';
        return { timestamp: name.slice(-13), name };
      })
      .filter((entry) => /^\d{13}$/.test(entry.timestamp));
  }

  private async pendingOutboxCount(): Promise<number> {
    try {
      const result: unknown = await this.dataSource.query(
        `SELECT COUNT(*)::text AS pending_count
           FROM outbox_events
          WHERE status IN ('PENDING', 'FAILED')`,
      );
      const row = rowsOf(result)[0] ?? {};
      return Number(row.pending_count ?? 0);
    } catch {
      return -1;
    }
  }
}

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
