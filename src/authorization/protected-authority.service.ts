import { Inject, Injectable, OnApplicationShutdown, Optional } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { PROTECTED_AUTHORITY_DATA_SOURCE } from './protected-authority.config';

export interface ProtectedAuthorityCheck {
  ok: boolean;
  detail?: string;
}

export interface ProtectedAuthorityInspection {
  status: 'verified' | 'unsafe' | 'unavailable' | 'not_configured';
  checks: Record<string, ProtectedAuthorityCheck>;
  observed: {
    runtimeLoginRole: string | null;
    authorityLoginRole: string | null;
    authorityActiveRole: string | null;
  };
}

interface RoleFacts {
  active_role: string;
  login_role: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  db_owner_member: boolean;
  public_schema_owner_member: boolean;
  public_schema_create: boolean;
  authority_member: boolean;
  protected_schema_usage: boolean;
}

interface RuntimePrivileges {
  session_write: boolean;
  approval_write: boolean;
  approval_truncate: boolean;
  approval_policies: boolean;
  role_assignment_write: boolean;
  catalogue_write: boolean;
  evidence_write: boolean;
  protected_function_execute: boolean;
  protected_objects_present: boolean;
  approval_rls: boolean;
  guard_trigger: boolean;
}

interface AuthorityPrivileges {
  decision_write: boolean;
  consumption_write: boolean;
  authority_member: boolean;
  db_owner_member: boolean;
  public_schema_owner_member: boolean;
  protected_objects_present: boolean;
}

/**
 * Protected checker authority boundary.
 *
 * The authority connection is a second PostgreSQL login that ordinary runtime credentials cannot
 * assume. It owns `protected_authority` and is the only writer of checker decisions, approval
 * consumptions and the workforce session/role evidence those decisions rely on.
 *
 * The protection addresses compromised ORDINARY DATABASE CREDENTIALS. If the authority credential
 * is available inside the same application process (as it is for the in-process approval service),
 * arbitrary application-process compromise is outside this boundary too — see
 * docs/integration/institutional-consolidation/PROTECTED-AUTHORITY-WIP.md.
 */
@Injectable()
export class ProtectedAuthorityService implements OnApplicationShutdown {
  constructor(
    private readonly runtime: DataSource,
    @Optional()
    @Inject(PROTECTED_AUTHORITY_DATA_SOURCE)
    private readonly authorityDataSource?: DataSource,
  ) {}

  /** True when a separate protected-authority credential is configured. */
  get configured(): boolean {
    return Boolean(this.authorityDataSource && this.authorityDataSource !== this.runtime);
  }

  /** Connection that is allowed to write protected authority evidence. */
  get dataSource(): DataSource {
    return this.authorityDataSource ?? this.runtime;
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.configured && this.authorityDataSource?.isInitialized) {
      await this.authorityDataSource.destroy().catch(() => undefined);
    }
  }

  /**
   * Verifies the boundary using real database identities and privileges. A `verified` result is
   * evidence about the connected roles, not a claim that arbitrary infrastructure compromise is
   * prevented: a superuser can always disable triggers or take over a role.
   */
  async inspect(): Promise<ProtectedAuthorityInspection> {
    const observed: ProtectedAuthorityInspection['observed'] = {
      runtimeLoginRole: null,
      authorityLoginRole: null,
      authorityActiveRole: null,
    };
    if (!this.configured) {
      return {
        status: 'not_configured',
        checks: {
          separateCredential: { ok: false, detail: 'authority credential not configured' },
        },
        observed,
      };
    }
    try {
      const [runtimeRows, runtimePrivilegeRows, authorityRows, authorityPrivilegeRows] =
        await Promise.all([
          this.runtime.query<RoleFacts[]>(roleFactsSql),
          this.runtime.query<RuntimePrivileges[]>(runtimePrivilegesSql),
          this.authorityDataSource!.query<RoleFacts[]>(roleFactsSql),
          this.authorityDataSource!.query<AuthorityPrivileges[]>(authorityPrivilegesSql),
        ]);
      const runtimeRole = runtimeRows[0];
      const runtimePrivileges = runtimePrivilegeRows[0];
      const authorityRole = authorityRows[0];
      const authorityPrivileges = authorityPrivilegeRows[0];
      if (!runtimeRole || !runtimePrivileges || !authorityRole || !authorityPrivileges) {
        return {
          status: 'unavailable',
          checks: { inspection: { ok: false, detail: 'role facts unavailable' } },
          observed,
        };
      }
      observed.runtimeLoginRole = runtimeRole.login_role;
      observed.authorityLoginRole = authorityRole.login_role;
      observed.authorityActiveRole = authorityRole.active_role;

      const checks: Record<string, ProtectedAuthorityCheck> = {
        separateCredential: {
          ok: runtimeRole.login_role !== authorityRole.login_role,
          detail:
            runtimeRole.login_role === authorityRole.login_role
              ? 'authority credential resolves to the ordinary runtime login'
              : undefined,
        },
        authorityRoleNotPrivileged: check(
          !authorityRole.rolsuper &&
            !authorityRole.rolcreaterole &&
            !authorityRole.rolcreatedb &&
            !authorityRole.rolreplication &&
            !authorityRole.rolbypassrls,
          'authority role has superuser/DDL attributes',
        ),
        authorityNotDatabaseOwner: check(
          !authorityRole.db_owner_member && !authorityRole.public_schema_owner_member,
          'authority role belongs to the database/public-schema owner',
        ),
        authorityHoldsProtectedAuthority: check(
          authorityRole.authority_member &&
            authorityPrivileges.authority_member &&
            authorityPrivileges.decision_write &&
            authorityPrivileges.consumption_write,
          'authority role cannot write protected checker evidence',
        ),
        protectedObjectsPresent: check(
          authorityPrivileges.protected_objects_present &&
            runtimePrivileges.protected_objects_present,
          'protected schema, tables, row security or guard trigger missing',
        ),
        runtimeNotPrivileged: check(
          !runtimeRole.rolsuper &&
            !runtimeRole.rolcreaterole &&
            !runtimeRole.rolcreatedb &&
            !runtimeRole.rolreplication &&
            !runtimeRole.rolbypassrls,
          'runtime role has superuser/DDL attributes',
        ),
        runtimeNotDatabaseOrSchemaOwner: check(
          !runtimeRole.db_owner_member &&
            !runtimeRole.public_schema_owner_member &&
            !runtimeRole.public_schema_create,
          'runtime role owns or can recreate the schema',
        ),
        runtimeNotAuthorityMember: check(
          !runtimeRole.authority_member &&
            !runtimePrivileges.protected_function_execute &&
            !runtimeRole.protected_schema_usage,
          'runtime role can enter the protected authority schema',
        ),
        runtimeCannotWriteSessions: check(
          !runtimePrivileges.session_write,
          'runtime role can write workforce session evidence',
        ),
        runtimeCannotWriteApprovals: check(
          !runtimePrivileges.approval_truncate &&
            runtimePrivileges.approval_rls &&
            runtimePrivileges.approval_policies,
          'runtime role can truncate protected approvals, row security is absent or a policy is missing',
        ),
        runtimeCannotWriteRoleAssignments: check(
          !runtimePrivileges.role_assignment_write,
          'runtime role can write workforce role assignments',
        ),
        runtimeCannotWriteCatalogue: check(
          !runtimePrivileges.catalogue_write,
          'runtime role can write the authorization catalogue',
        ),
        runtimeCannotWriteExecutionEvidence: check(
          !runtimePrivileges.evidence_write,
          'runtime role can write trigger-generated execution evidence',
        ),
        guardTriggerInstalled: check(
          runtimePrivileges.guard_trigger,
          'protected approval guard trigger missing',
        ),
      };
      const failed = Object.entries(checks).filter(([, value]) => !value.ok);
      return {
        status: failed.length === 0 ? 'verified' : 'unsafe',
        checks,
        observed,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        checks: {
          inspection: { ok: false, detail: (error as Error).message.slice(0, 300) },
        },
        observed,
      };
    }
  }
}

function check(ok: boolean, detail: string): ProtectedAuthorityCheck {
  return ok ? { ok: true } : { ok: false, detail };
}

const roleFactsSql = `
  SELECT current_user AS active_role, session_user AS login_role,
    r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
    pg_has_role(session_user,
      (SELECT datdba FROM pg_database WHERE datname=current_database()), 'MEMBER')
      AS db_owner_member,
    pg_has_role(session_user,
      (SELECT nspowner FROM pg_namespace WHERE nspname='public'), 'MEMBER')
      AS public_schema_owner_member,
    has_schema_privilege(session_user, 'public', 'CREATE') AS public_schema_create,
    EXISTS (SELECT 1 FROM pg_roles a WHERE a.rolname='monienaija_authority_core'
      AND pg_has_role(session_user, a.oid, 'MEMBER')) AS authority_member,
    COALESCE((SELECT has_schema_privilege(session_user, n.oid, 'USAGE')
      FROM pg_namespace n WHERE n.nspname='protected_authority'), false)
      AS protected_schema_usage
  FROM pg_roles r WHERE r.rolname = current_user`;

const runtimePrivilegesSql = `
  SELECT
    (has_table_privilege(session_user, 'public.a2_workforce_sessions', 'SELECT')
      OR has_table_privilege(session_user, 'public.a2_workforce_sessions', 'INSERT')
      OR has_table_privilege(session_user, 'public.a2_workforce_sessions', 'UPDATE')
      OR has_table_privilege(session_user, 'public.a2_workforce_sessions', 'DELETE'))
      AS session_write,
    (has_table_privilege(session_user, 'public.privileged_action_approvals', 'INSERT')
      OR has_table_privilege(session_user, 'public.privileged_action_approvals', 'UPDATE')
      OR has_table_privilege(session_user, 'public.privileged_action_approvals', 'DELETE'))
      AS approval_write,
    has_table_privilege(session_user, 'public.privileged_action_approvals', 'TRUNCATE')
      AS approval_truncate,
    (SELECT count(*)=5 FROM pg_policies
      WHERE schemaname='public' AND tablename='privileged_action_approvals'
        AND policyname IN ('approval_authority_full','approval_runtime_read',
          'approval_runtime_insert','approval_runtime_update','approval_runtime_delete'))
      AS approval_policies,
    (has_table_privilege(session_user, 'public.a2_finance_role_assignments', 'INSERT')
      OR has_table_privilege(session_user, 'public.a2_finance_role_assignments', 'UPDATE')
      OR has_table_privilege(session_user, 'public.a2_finance_role_assignments', 'DELETE'))
      AS role_assignment_write,
    (has_table_privilege(session_user, 'public.authorization_roles', 'INSERT')
      OR has_table_privilege(session_user, 'public.authorization_roles', 'UPDATE')
      OR has_table_privilege(session_user, 'public.authorization_roles', 'DELETE')
      OR has_table_privilege(session_user, 'public.authorization_role_functions', 'INSERT')
      OR has_table_privilege(session_user, 'public.authorization_role_functions', 'UPDATE')
      OR has_table_privilege(session_user, 'public.authorization_role_functions', 'DELETE'))
      AS catalogue_write,
    (has_table_privilege(session_user, 'public.governed_institution_lifecycle_executions', 'INSERT')
      OR has_table_privilege(session_user, 'public.institution_affiliation_transition_evidence', 'INSERT')
      OR has_table_privilege(session_user, 'public.governed_institution_affiliation_replay_results', 'INSERT')
      OR has_table_privilege(session_user, 'public.governed_wallet_institution_attributions', 'INSERT'))
      AS evidence_write,
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='protected_authority'
        AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
          WHERE a.privilege_type='EXECUTE'
            AND (a.grantee=0 OR a.grantee=(SELECT oid FROM pg_roles WHERE rolname=session_user)))))
      AS protected_function_execute,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='protected_authority'
        AND c.relname IN ('checker_decisions','approval_consumptions'))
      AS protected_objects_present,
    COALESCE((SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c
      WHERE c.oid = to_regclass('public.privileged_action_approvals')), false) AS approval_rls,
    EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname='privileged_action_approval_authority_guard'
      AND NOT t.tgisinternal) AS guard_trigger`;

const authorityPrivilegesSql = `
  SELECT
    (SELECT has_table_privilege(session_user, c.oid, 'INSERT') FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='protected_authority' AND c.relname='checker_decisions') AS decision_write,
    (SELECT has_table_privilege(session_user, c.oid, 'INSERT') FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='protected_authority' AND c.relname='approval_consumptions') AS consumption_write,
    EXISTS (SELECT 1 FROM pg_roles a WHERE a.rolname='monienaija_authority_core'
      AND pg_has_role(session_user, a.oid, 'MEMBER')) AS authority_member,
    pg_has_role(session_user,
      (SELECT datdba FROM pg_database WHERE datname=current_database()), 'MEMBER') AS db_owner_member,
    pg_has_role(session_user,
      (SELECT nspowner FROM pg_namespace WHERE nspname='public'), 'MEMBER') AS public_schema_owner_member,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='protected_authority' AND c.relname='checker_decisions')
      AS protected_objects_present`;
