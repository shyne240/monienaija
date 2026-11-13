import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from '../operations/audit.service';
import { FinancialInstitutionStatus } from './institution.enums';
import type { WorkforceInstitutionAssignmentView } from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Institution-scoped workforce authority.
 *
 * Assignments are authoritative rows, read on every request — never cached in the bearer token or
 * in the login-time session snapshot — so a revocation takes effect immediately for an existing
 * session. No workforce principal is granted institution scope implicitly: a principal with no
 * ACTIVE assignment (and no explicit platform-level function) sees nothing.
 */
@Injectable()
export class InstitutionWorkforceScopeService {
  /** Function code that distinguishes explicitly authorized platform-level staff. */
  static readonly PLATFORM_FUNCTION = 'institution.attribution.view';

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async grant(input: {
    institutionId: string;
    principalId: string;
    principal: AuthorizationPrincipal;
  }): Promise<WorkforceInstitutionAssignmentView> {
    const institutionId = this.uuid(input.institutionId, 'institutionId');
    const principalId = this.requiredText(input.principalId, 'principalId', 160);
    const actor = input.principal.principalId;
    return this.dataSource.transaction(async (manager) => {
      const institutions: Array<{ status: FinancialInstitutionStatus }> = await manager.query(
        `SELECT status FROM financial_institutions WHERE id=$1 AND deleted_at IS NULL`,
        [institutionId],
      );
      if (institutions.length === 0) throw new NotFoundException('Institution not found');
      if (institutions[0]!.status === FinancialInstitutionStatus.CLOSED) {
        throw new ConflictException('A closed institution cannot gain workforce assignments');
      }
      const existing: Array<{ id: string }> = await manager.query(
        `SELECT id FROM workforce_institution_assignments
          WHERE principal_id=$1 AND institution_id=$2 AND status='ACTIVE' LIMIT 1`,
        [principalId, institutionId],
      );
      if (existing.length > 0) {
        throw new ConflictException(
          'Principal already has an ACTIVE assignment to this institution',
        );
      }
      const rows: Array<{
        id: string;
        principal_id: string;
        institution_id: string;
        status: string;
        granted_by: string;
        granted_at: Date;
        revoked_by: string | null;
        revoked_at: Date | null;
      }> = await manager.query(
        `INSERT INTO workforce_institution_assignments (principal_id, institution_id, status, granted_by)
         VALUES ($1,$2,'ACTIVE',$3)
         RETURNING id, principal_id, institution_id, status, granted_by, granted_at, revoked_by, revoked_at`,
        [principalId, institutionId, actor],
      );
      const row = rows[0]!;
      await this.auditService.record(manager, {
        entityType: 'WORKFORCE_INSTITUTION_ASSIGNMENT',
        entityId: row.id,
        action: 'WORKFORCE_INSTITUTION_ASSIGNED',
        actor,
        newValues: { principalId, institutionId, status: 'ACTIVE' },
      });
      return this.toView(row);
    });
  }

  async revoke(input: {
    institutionId: string;
    principalId: string;
    principal: AuthorizationPrincipal;
  }): Promise<WorkforceInstitutionAssignmentView> {
    const institutionId = this.uuid(input.institutionId, 'institutionId');
    const principalId = this.requiredText(input.principalId, 'principalId', 160);
    const actor = input.principal.principalId;
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{
        id: string;
        principal_id: string;
        institution_id: string;
        status: string;
        granted_by: string;
        granted_at: Date;
        revoked_by: string | null;
        revoked_at: Date;
      }> = await manager.query(
        `WITH changed AS (
           UPDATE workforce_institution_assignments
              SET status='REVOKED', revoked_by=$3, revoked_at=clock_timestamp(),
                  updated_at=clock_timestamp(), version=version+1
            WHERE principal_id=$1 AND institution_id=$2 AND status='ACTIVE'
            RETURNING id, principal_id, institution_id, status, granted_by, granted_at, revoked_by, revoked_at
         ) SELECT * FROM changed`,
        [principalId, institutionId, actor],
      );
      if (rows.length !== 1) {
        throw new ConflictException('No ACTIVE assignment to revoke');
      }
      const row = rows[0]!;
      await this.auditService.record(manager, {
        entityType: 'WORKFORCE_INSTITUTION_ASSIGNMENT',
        entityId: row.id,
        action: 'WORKFORCE_INSTITUTION_REVOKED',
        actor,
        previousValues: { status: 'ACTIVE' },
        newValues: { principalId, institutionId, status: 'REVOKED' },
      });
      return this.toView(row);
    });
  }

  async listForInstitution(institutionId: string): Promise<WorkforceInstitutionAssignmentView[]> {
    const rows: Array<{
      id: string;
      principal_id: string;
      institution_id: string;
      status: string;
      granted_by: string;
      granted_at: Date;
      revoked_by: string | null;
      revoked_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT id, principal_id, institution_id, status, granted_by, granted_at, revoked_by, revoked_at
         FROM workforce_institution_assignments
        WHERE institution_id = $1
        ORDER BY granted_at ASC`,
      [this.uuid(institutionId, 'institutionId')],
    );
    return rows.map((row) => this.toView(row));
  }

  /**
   * Request-time authority check. Platform-level staff are recognized only by the explicit
   * `institution.attribution.view` catalogue function; everyone else needs an ACTIVE assignment to
   * the exact institution. Denial is a 404 so an unauthorized principal cannot probe which
   * institutions exist.
   */
  async assertCanAccessInstitution(
    principal: AuthorizationPrincipal | undefined,
    institutionId: string,
  ): Promise<void> {
    if (!principal) throw new ForbiddenException('Authentication required');
    if (principal.scopes.includes(InstitutionWorkforceScopeService.PLATFORM_FUNCTION)) return;
    const normalized = this.uuid(institutionId, 'institutionId');
    const rows: Array<{ active: boolean }> = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM workforce_institution_assignments
          WHERE principal_id=$1 AND institution_id=$2 AND status='ACTIVE'
       ) AS active`,
      [principal.principalId, normalized],
    );
    if (!rows[0]?.active) {
      throw new NotFoundException('Institution not found');
    }
  }

  /** Platform-level authority, by explicit catalogue function only. */
  hasPlatformAuthority(principal: AuthorizationPrincipal | undefined): boolean {
    return Boolean(principal?.scopes.includes(InstitutionWorkforceScopeService.PLATFORM_FUNCTION));
  }

  async institutionIdsForPrincipal(principalId: string): Promise<string[]> {
    const rows: Array<{ institution_id: string }> = await this.dataSource.query(
      `SELECT institution_id FROM workforce_institution_assignments
        WHERE principal_id=$1 AND status='ACTIVE'`,
      [principalId],
    );
    return rows.map((row) => row.institution_id);
  }

  private toView(row: {
    id: string;
    principal_id: string;
    institution_id: string;
    status: string;
    granted_by: string;
    granted_at: Date;
    revoked_by: string | null;
    revoked_at: Date | null;
  }): WorkforceInstitutionAssignmentView {
    return {
      id: row.id,
      principalId: row.principal_id,
      institutionId: row.institution_id,
      status: row.status as 'ACTIVE' | 'REVOKED',
      grantedBy: row.granted_by,
      grantedAt: row.granted_at.toISOString(),
      revokedBy: row.revoked_by,
      revokedAt: row.revoked_at?.toISOString() ?? null,
    };
  }

  private uuid(value: string, field: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }

  private requiredText(value: string | undefined | null, field: string, max: number): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed.length < 3 || trimmed.length > max) {
      throw new BadRequestException(`${field} must be between 3 and ${max} characters`);
    }
    return trimmed;
  }
}
