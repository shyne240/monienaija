import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ReconciliationService } from '../reconciliation/reconciliation.service';
import {
  ProtectedAuthorityInspection,
  ProtectedAuthorityService,
} from '../authorization/protected-authority.service';

// V1-RELEASE-01: this marker must always equal the newest file in src/migrations/*.ts.
// It previously drifted twice (stayed at 1785753600079 while migrations 080 and 081 were
// added), which made a freshly and fully migrated production database fail this service's
// own compatibility check and refuse to start (schema_incompatible). See
// test/v1-release-01-production-readiness-migration-sync.integration.spec.ts, which runs the
// full migration chain against real PostgreSQL and fails the build if this constant and the
// actual latest migration file ever diverge again.
const EXPECTED_MIGRATION_TIMESTAMP = '1785753600501';
const EXPECTED_MIGRATION_NAME = 'ProtectedAuthorityBoundary1785753600501';

type Row = Record<string, unknown>;

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
      runtimeDatabaseRole.status !== 'unavailable'
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
                      : 'protected_checker_authority_unavailable';
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

  private async checkMigrations() {
    try {
      const result: unknown = await this.dataSource.query(
        `SELECT timestamp::text AS timestamp, name
           FROM typeorm_migrations
          ORDER BY timestamp DESC
          LIMIT 1`,
      );
      const latest = rowsOf(result)[0] ?? {};
      const latestTimestamp = stringValue(latest.timestamp);
      const latestName = stringValue(latest.name);
      const compatible =
        latestTimestamp === EXPECTED_MIGRATION_TIMESTAMP && latestName === EXPECTED_MIGRATION_NAME;
      const countResult: unknown = await this.dataSource.query(
        `SELECT COUNT(*)::text AS applied_count FROM typeorm_migrations`,
      );
      const countRow = rowsOf(countResult)[0] ?? {};
      return {
        status: compatible ? ('ok' as const) : ('error' as const),
        compatible,
        appliedCount: Number(countRow.applied_count ?? 0),
        latestTimestamp: latestTimestamp || null,
        latestName: latestName || null,
      };
    } catch {
      return {
        status: 'error' as const,
        compatible: false,
        appliedCount: 0,
        latestTimestamp: null,
        latestName: null,
      };
    }
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
