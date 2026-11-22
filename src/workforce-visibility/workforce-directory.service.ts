import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * ARENA 4 — Workforce Administration visibility.
 *
 * Read-only. This service reads the authoritative grants that already exist
 * (`a2_finance_role_assignments`, `a2_workforce_sessions`,
 * `workforce_institution_assignments`, `support_workforce_users`) and joins them to the
 * authorization catalogue (`authorization_roles`/`authorization_role_functions`/
 * `authorization_functions`). It never creates, amends, revokes or caches a grant, never returns a
 * token hash, password hash, OIDC subject or assertion evidence, and has no write path at all.
 * Privilege changes stay on the established maker/checker and ADMINISTRATOR direct-execute
 * surfaces in `A2WorkforceAdministrationController`; this controller cannot substitute for them.
 */

export type WorkforceAccountStatus =
  | 'ACTIVE'
  | 'DISABLED'
  | 'NO_CURRENT_GRANT'
  | 'NO_CATALOGUE_GRANT';

export interface WorkforceDirectoryQuery {
  search?: string;
  roleKey?: string;
  institutionId?: string;
  principalType?: 'WORKFORCE' | 'SUPPORT';
  status?: WorkforceAccountStatus;
  page: number;
  limit: number;
}

export interface WorkforceRoleView {
  roleKey: string;
  status: 'ACTIVE' | 'REVOKED';
  effectiveFrom: Date | string;
  effectiveTo: Date | string;
  assignedBy: string;
  assignedAt: Date | string;
  revokedAt: Date | string | null;
  readOnly: boolean;
}

export interface WorkforceInstitutionScopeView {
  /**
   * `INSTITUTIONS` = at least one ACTIVE institution assignment; `NONE` = no ACTIVE assignment.
   * Absence of an assignment is never reported as platform-wide reach.
   */
  mode: 'INSTITUTIONS' | 'NONE';
  /** True only when the principal's effective catalogue grants include the platform function. */
  platformFunctionGranted: boolean;
  active: Array<{
    institutionId: string;
    institutionName: string | null;
    institutionCode: string | null;
    grantedBy: string;
    grantedAt: Date | string;
  }>;
  /** Count of revoked assignments in the principal's history (not currently effective). */
  revokedCount: number;
}

export interface WorkforceDirectoryEntry {
  principalId: string;
  principalType: 'WORKFORCE' | 'SUPPORT';
  accountStatus: WorkforceAccountStatus;
  roles: WorkforceRoleView[];
  readOnlyPrincipal: boolean;
  institutionScope: WorkforceInstitutionScopeView;
  activeSessionCount: number;
  lastSeenAt: Date | string | null;
  permissionCount: number;
  privilegedPermissionCount: number;
}

export interface WorkforceDirectoryPage {
  data: WorkforceDirectoryEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  /** Stated so the caller cannot mistake this projection for a grant. */
  accessMode: 'READ_ONLY';
}

export interface WorkforcePrincipalDetail extends WorkforceDirectoryEntry {
  supportAccount: {
    username: string;
    status: 'ACTIVE' | 'DISABLED';
    createdAt: Date | string;
  } | null;
  sessions: Array<{
    id: string;
    status: string;
    assuranceLevel: string | null;
    audience: string;
    authenticatedAt: Date | string | null;
    issuedAt: Date | string | null;
    expiresAt: Date | string | null;
    lastSeenAt: Date | string | null;
    revokedAt: Date | string | null;
  }>;
  effectivePermissions: Array<{
    functionCode: string;
    accessType: string;
    domain: string;
    name: string;
    sensitivity: string;
    v1Status: string;
  }>;
  /** Privileged/sensitive subset of the same catalogue grants. */
  administrativeAuthorizations: Array<{
    functionCode: string;
    accessType: string;
    domain: string;
    name: string;
    sensitivity: string;
  }>;
  boundaries: {
    readOnly: true;
    note: string;
    roleGrantRoute: string;
    roleRevokeRoute: string;
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_KEY_PATTERN = /^[A-Z0-9_]{2,100}$/;
const VALID_STATUSES: readonly WorkforceAccountStatus[] = [
  'ACTIVE',
  'DISABLED',
  'NO_CURRENT_GRANT',
  'NO_CATALOGUE_GRANT',
];
export const WORKFORCE_VISIBILITY_BOUNDARY_NOTE =
  'Read-only projection of effective catalogue grants and institution assignments. It cannot grant, revoke or elevate any role or function.';

interface AssignmentRow {
  principal_id: string;
  role_key: string;
  status: 'ACTIVE' | 'REVOKED';
  effective_from: Date;
  effective_to: Date;
  assigned_by: string;
  assigned_at: Date;
  revoked_at: Date | null;
  read_only: boolean;
}

interface SessionRow {
  principal_id: string;
  id?: string;
  status: string;
  assurance_level?: string | null;
  audience?: string;
  authenticated_at?: Date | null;
  issued_at?: Date | null;
  expires_at?: Date | null;
  last_seen_at?: Date | null;
  revoked_at?: Date | null;
}

@Injectable()
export class WorkforceDirectoryService {
  constructor(private readonly dataSource: DataSource) {}

  async list(query: WorkforceDirectoryQuery): Promise<WorkforceDirectoryPage> {
    if (query.roleKey && !ROLE_KEY_PATTERN.test(query.roleKey)) {
      throw new BadRequestException('roleKey must be an upper-case role key');
    }
    if (query.institutionId && !UUID_PATTERN.test(query.institutionId)) {
      throw new BadRequestException('institutionId must be a UUID');
    }
    if (query.status && !VALID_STATUSES.includes(query.status)) {
      throw new BadRequestException(`status must be one of ${VALID_STATUSES.join(', ')}`);
    }
    if (query.principalType && !['WORKFORCE', 'SUPPORT'].includes(query.principalType)) {
      throw new BadRequestException('principalType must be WORKFORCE or SUPPORT');
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.search) {
      params.push(`%${query.search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
      conditions.push(`(p.principal_id ILIKE $${params.length} ESCAPE '\\')`);
    }
    if (query.roleKey) {
      params.push(query.roleKey);
      conditions.push(`EXISTS (
        SELECT 1 FROM a2_finance_role_assignments a
         WHERE a.principal_id = p.principal_id AND a.role_key = $${params.length}
      )`);
    }
    if (query.institutionId) {
      params.push(query.institutionId);
      conditions.push(`EXISTS (
        SELECT 1 FROM workforce_institution_assignments w
         WHERE w.principal_id = p.principal_id AND w.institution_id = $${params.length}
      )`);
    }
    if (query.principalType === 'SUPPORT') {
      conditions.push(
        'EXISTS (SELECT 1 FROM support_workforce_users s WHERE s.id::text = p.principal_id)',
      );
    }
    if (query.principalType === 'WORKFORCE') {
      conditions.push(
        'NOT EXISTS (SELECT 1 FROM support_workforce_users s WHERE s.id::text = p.principal_id)',
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Math.trunc(query.limit) || 20, 1), 50);
    const page = Math.max(Math.trunc(query.page) || 1, 1);

    // Account-status filtering is derived from the joined evidence, so it is evaluated over the
    // bounded candidate set below rather than duplicated in SQL (where the derivation could drift).
    const baseParams = [...params];
    const candidates = await this.dataSource.query<Array<{ principal_id: string }>>(
      `SELECT p.principal_id FROM (
         SELECT principal_id FROM a2_finance_role_assignments
         UNION
         SELECT principal_id FROM a2_workforce_sessions
         UNION
         SELECT principal_id FROM workforce_institution_assignments
         UNION
         SELECT id::text AS principal_id FROM support_workforce_users WHERE deleted_at IS NULL
       ) p
       ${where}
       ORDER BY p.principal_id
       LIMIT 500`,
      baseParams,
    );

    const entries = await this.hydrate(candidates.map((row) => row.principal_id));
    const filtered = query.status
      ? entries.filter((entry) => entry.accountStatus === query.status)
      : entries;
    const total = filtered.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      data: filtered.slice((page - 1) * limit, (page - 1) * limit + limit),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      accessMode: 'READ_ONLY',
    };
  }

  async detail(principalId: string): Promise<WorkforcePrincipalDetail> {
    if (!principalId || principalId.length > 160) {
      throw new BadRequestException('principalId is invalid');
    }
    const entries = await this.hydrate([principalId]);
    const entry = entries[0];
    if (!entry) throw new NotFoundException('Workforce principal not found');

    const [supportRows, sessionRows, permissionRows] = await Promise.all([
      this.dataSource.query<
        Array<{ username: string; status: 'ACTIVE' | 'DISABLED'; created_at: Date }>
      >(
        `SELECT username, status, created_at FROM support_workforce_users
          WHERE id::text=$1 AND deleted_at IS NULL LIMIT 1`,
        [principalId],
      ),
      this.dataSource.query<
        Array<{
          id: string;
          status: string;
          assurance_level: string | null;
          audience: string;
          authenticated_at: Date | null;
          issued_at: Date | null;
          expires_at: Date | null;
          last_seen_at: Date | null;
          revoked_at: Date | null;
        }>
      >(
        `SELECT id, status, assurance_level, audience, authenticated_at, issued_at, expires_at,
                last_seen_at, revoked_at
           FROM a2_workforce_sessions
          WHERE principal_id=$1
          ORDER BY last_seen_at DESC, id
          LIMIT 25`,
        [principalId],
      ),
      this.dataSource.query<
        Array<{
          function_code: string;
          access_type: string;
          domain: string;
          name: string;
          sensitivity: string;
          v1_status: string;
        }>
      >(
        `SELECT DISTINCT f.function_code, rf.access_type, f.domain, f.name, f.sensitivity, f.v1_status
           FROM a2_finance_role_assignments a
           JOIN authorization_roles r ON r.role_key = a.role_key
           JOIN authorization_role_functions rf ON rf.role_id = r.id AND rf.is_active = TRUE
           JOIN authorization_functions f ON f.function_code = rf.function_code
          WHERE a.principal_id = $1
            AND a.status = 'ACTIVE'
            AND a.effective_from <= NOW()
            AND a.effective_to > NOW()
          ORDER BY f.function_code`,
        [principalId],
      ),
    ]);

    const effectivePermissions = permissionRows.map((row) => ({
      functionCode: row.function_code,
      accessType: row.access_type,
      domain: row.domain,
      name: row.name,
      sensitivity: row.sensitivity,
      v1Status: row.v1_status,
    }));
    const support = supportRows[0];

    return {
      ...entry,
      supportAccount: support
        ? { username: support.username, status: support.status, createdAt: support.created_at }
        : null,
      sessions: sessionRows.map((row) => ({
        id: row.id,
        status: row.status,
        assuranceLevel: row.assurance_level,
        audience: row.audience,
        authenticatedAt: row.authenticated_at,
        issuedAt: row.issued_at,
        expiresAt: row.expires_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at,
      })),
      effectivePermissions,
      administrativeAuthorizations: effectivePermissions
        .filter(
          (permission) =>
            ['PRIVILEGED', 'CRITICAL_FINANCIAL', 'SENSITIVE'].includes(permission.sensitivity) ||
            ['WORKFORCE', 'AUDIT'].includes(permission.domain),
        )
        .map((permission) => ({
          functionCode: permission.functionCode,
          accessType: permission.accessType,
          domain: permission.domain,
          name: permission.name,
          sensitivity: permission.sensitivity,
        })),
      boundaries: {
        readOnly: true,
        note: WORKFORCE_VISIBILITY_BOUNDARY_NOTE,
        roleGrantRoute: 'POST /api/v1/internal/a2/workforce/roles',
        roleRevokeRoute: 'DELETE /api/v1/internal/a2/workforce/roles/:principalId/:roleKey',
      },
    };
  }

  /** Bounded hydration for one page of principals; no per-principal query fan-out. */
  private async hydrate(principalIds: string[]): Promise<WorkforceDirectoryEntry[]> {
    if (principalIds.length === 0) return [];
    const assignments = await this.dataSource.query<AssignmentRow[]>(
      `SELECT a.principal_id, a.role_key, a.status, a.effective_from, a.effective_to,
              a.assigned_by, a.assigned_at, a.revoked_at, COALESCE(r.read_only, FALSE) AS read_only
         FROM a2_finance_role_assignments a
         LEFT JOIN authorization_roles r ON r.role_key = a.role_key
        WHERE a.principal_id = ANY($1::text[])
        ORDER BY a.principal_id, a.assigned_at DESC`,
      [principalIds],
    );
    const sessions = await this.dataSource.query<SessionRow[]>(
      `SELECT principal_id, status, last_seen_at
         FROM a2_workforce_sessions
        WHERE principal_id = ANY($1::text[])`,
      [principalIds],
    );
    const institutionAssignments = await this.dataSource.query<
      Array<{
        principal_id: string;
        institution_id: string;
        status: 'ACTIVE' | 'REVOKED';
        granted_by: string;
        granted_at: Date;
        legal_name: string | null;
        code: string | null;
      }>
    >(
      `SELECT w.principal_id, w.institution_id, w.status, w.granted_by, w.granted_at,
              i.legal_name, i.code
         FROM workforce_institution_assignments w
         LEFT JOIN financial_institutions i ON i.id = w.institution_id
        WHERE w.principal_id = ANY($1::text[])
        ORDER BY w.principal_id, w.granted_at DESC`,
      [principalIds],
    );
    const supportUsers = await this.dataSource.query<
      Array<{ id: string; status: 'ACTIVE' | 'DISABLED' }>
    >(
      `SELECT id::text AS id, status FROM support_workforce_users
        WHERE id::text = ANY($1::text[]) AND deleted_at IS NULL`,
      [principalIds],
    );
    const permissionCounts = await this.dataSource.query<
      Array<{
        principal_id: string;
        permission_count: number;
        privileged_count: number;
        platform_scope: boolean;
      }>
    >(
      `SELECT a.principal_id,
              count(DISTINCT f.function_code)::int AS permission_count,
              count(DISTINCT f.function_code) FILTER (
                WHERE f.sensitivity IN ('PRIVILEGED','CRITICAL_FINANCIAL','SENSITIVE')
              )::int AS privileged_count,
              bool_or(f.function_code = 'institution.attribution.view') AS platform_scope
         FROM a2_finance_role_assignments a
         JOIN authorization_roles r ON r.role_key = a.role_key
         JOIN authorization_role_functions rf ON rf.role_id = r.id AND rf.is_active = TRUE
         JOIN authorization_functions f ON f.function_code = rf.function_code
        WHERE a.principal_id = ANY($1::text[])
          AND a.status = 'ACTIVE'
          AND a.effective_from <= NOW()
          AND a.effective_to > NOW()
        GROUP BY a.principal_id`,
      [principalIds],
    );

    const supportById = new Map(supportUsers.map((row) => [row.id, row.status]));
    const countsById = new Map(
      permissionCounts.map((row) => [
        row.principal_id,
        {
          permissionCount: row.permission_count,
          privileged: row.privileged_count,
          platformScope: row.platform_scope,
        },
      ]),
    );

    const hydrated = principalIds.map((principalId): WorkforceDirectoryEntry => {
      const principalAssignments = assignments.filter((row) => row.principal_id === principalId);
      const principalSessions = sessions.filter((row) => row.principal_id === principalId);
      const principalInstitutions = institutionAssignments.filter(
        (row) => row.principal_id === principalId,
      );
      const supportStatus = supportById.get(principalId);
      const now = Date.now();
      const currentAssignments = principalAssignments.filter(
        (row) =>
          row.status === 'ACTIVE' &&
          new Date(row.effective_from).getTime() <= now &&
          new Date(row.effective_to).getTime() > now,
      );
      const accountStatus: WorkforceAccountStatus =
        supportStatus !== undefined
          ? supportStatus === 'ACTIVE'
            ? 'ACTIVE'
            : 'DISABLED'
          : currentAssignments.length > 0
            ? 'ACTIVE'
            : principalAssignments.length > 0
              ? 'NO_CURRENT_GRANT'
              : 'NO_CATALOGUE_GRANT';
      const activeInstitutions = principalInstitutions.filter((row) => row.status === 'ACTIVE');
      const counts = countsById.get(principalId);
      const roles = principalAssignments.map((row) => ({
        roleKey: row.role_key,
        status: row.status,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
        assignedBy: row.assigned_by,
        assignedAt: row.assigned_at,
        revokedAt: row.revoked_at,
        readOnly: row.read_only,
      }));
      return {
        principalId,
        principalType: supportStatus !== undefined ? 'SUPPORT' : 'WORKFORCE',
        accountStatus,
        roles,
        readOnlyPrincipal:
          roles.length > 0 && roles.every((role) => role.status === 'REVOKED' || role.readOnly),
        institutionScope: {
          mode: activeInstitutions.length > 0 ? 'INSTITUTIONS' : 'NONE',
          platformFunctionGranted: counts?.platformScope ?? false,
          active: activeInstitutions.map((row) => ({
            institutionId: row.institution_id,
            institutionName: row.legal_name,
            institutionCode: row.code,
            grantedBy: row.granted_by,
            grantedAt: row.granted_at,
          })),
          revokedCount: principalInstitutions.length - activeInstitutions.length,
        },
        activeSessionCount: principalSessions.filter((row) => row.status === 'ACTIVE').length,
        lastSeenAt:
          principalSessions
            .map((row) => row.last_seen_at)
            .filter((value): value is Date => value instanceof Date)
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
        permissionCount: counts?.permissionCount ?? 0,
        privilegedPermissionCount: counts?.privileged ?? 0,
      };
    });
    // A principal with no assignment, session, institution scope or SUPPORT account has no
    // workforce evidence at all. It is not an entry (and detail lookup reports not-found rather
    // than inventing an empty principal).
    return hydrated.filter(
      (entry) =>
        entry.roles.length > 0 ||
        entry.activeSessionCount > 0 ||
        entry.institutionScope.active.length > 0 ||
        entry.principalType === 'SUPPORT',
    );
  }
}
