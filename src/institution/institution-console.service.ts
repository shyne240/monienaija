import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  AgentAffiliationDirectoryRow,
  InstitutionPendingApprovalView,
} from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Approval statuses that still represent an actionable/in-flight decision. */
const PENDING_APPROVAL_STATUSES = ['REQUESTED', 'APPROVED'];

/**
 * Read-only queries for the Admin Web institutional console (ARENA 4 Phase 3).
 *
 * Both queries expose data that already belongs to the caller's authorized scope; neither writes,
 * neither widens financial authority, and neither is a second approval system:
 *
 *  - `listPendingApprovals` surfaces governed-action requests that name this institution in their
 *    frozen approval payload (`policy.requestDetails.institutionId`), so an institution supervisor
 *    can see what is awaiting an independent checker and what is approved but not yet executed.
 *  - `listAgentAffiliationDirectory` answers the question the console must never answer by
 *    inference: which agents are institutionally affiliated, and which are merely independent or
 *    linked to an aggregator. Aggregator assignment is reported as context only — it is never
 *    promoted to an institutional affiliation.
 */
@Injectable()
export class InstitutionConsoleService {
  constructor(private readonly dataSource: DataSource) {}

  async listPendingApprovals(
    institutionId: string,
    limit = 50,
  ): Promise<InstitutionPendingApprovalView[]> {
    const normalized = this.uuid(institutionId, 'institutionId');
    const bounded = this.limit(limit);
    const rows: Array<{
      id: string;
      action_type: string;
      resource_type: string;
      resource_id: string | null;
      requester_principal_id: string;
      approved_by: string | null;
      status: string;
      reason: string;
      requested_at: Date;
      expires_at: Date;
      approved_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT id, action_type, resource_type, resource_id, requester_principal_id, approved_by,
              status, reason, requested_at, expires_at, approved_at
         FROM privileged_action_approvals
        WHERE status = ANY($2::varchar[])
          AND policy->'requestDetails'->>'institutionId' = $1
        ORDER BY requested_at DESC
        LIMIT $3`,
      [normalized, PENDING_APPROVAL_STATUSES, bounded],
    );
    return rows.map((row) => ({
      approvalId: row.id,
      actionType: row.action_type,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      requesterPrincipalId: row.requester_principal_id,
      approvedBy: row.approved_by,
      status: row.status as 'REQUESTED' | 'APPROVED',
      reason: row.reason,
      requestedAt: row.requested_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      approvedAt: row.approved_at?.toISOString() ?? null,
      /** Independent checker still required before the action can be executed. */
      awaitingChecker: row.status === 'REQUESTED',
    }));
  }

  async listAgentAffiliationDirectory(options: {
    institutionId?: string;
    affiliation?: 'AFFILIATED' | 'UNAFFILIATED';
    search?: string;
    limit?: number;
  }): Promise<AgentAffiliationDirectoryRow[]> {
    const institutionId = options.institutionId
      ? this.uuid(options.institutionId, 'institutionId')
      : null;
    const affiliation = options.affiliation ?? null;
    if (affiliation !== null && !['AFFILIATED', 'UNAFFILIATED'].includes(affiliation)) {
      throw new BadRequestException('affiliation must be AFFILIATED or UNAFFILIATED');
    }
    if (affiliation === 'AFFILIATED' && !institutionId) {
      throw new BadRequestException('institutionId is required when filtering AFFILIATED agents');
    }
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    if (search.length > 80) throw new BadRequestException('search is too long');
    const bounded = this.limit(options.limit ?? 50);

    const rows: Array<{
      agent_id: string;
      agent_reference: string;
      agent_status: string;
      affiliation_id: string | null;
      affiliation_institution_id: string | null;
      affiliation_status: string | null;
      affiliation_effective_from: Date | null;
      aggregator_id: string | null;
      aggregator_reference: string | null;
    }> = await this.dataSource.query(
      `WITH active_affiliation AS (
         SELECT DISTINCT ON (a.agent_id)
                a.id, a.agent_id, a.institution_id, a.status, a.effective_from
           FROM institution_agent_affiliations a
          WHERE a.status = 'ACTIVE'
            AND (a.effective_to IS NULL OR a.effective_to > clock_timestamp())
          ORDER BY a.agent_id, a.effective_from DESC, a.created_at DESC
       ), active_aggregator AS (
         SELECT DISTINCT ON (aaa.agent_id)
                aaa.agent_id, ag.id AS aggregator_id, ag.reference AS aggregator_reference
           FROM aggregator_agent_assignments aaa
           JOIN aggregators ag ON ag.id = aaa.aggregator_id AND ag.deleted_at IS NULL
          WHERE aaa.status = 'ACTIVE'
          ORDER BY aaa.agent_id, aaa.assigned_at DESC
       )
       SELECT ag.id AS agent_id,
              ag.reference AS agent_reference,
              ag.status AS agent_status,
              aa.id AS affiliation_id,
              aa.institution_id AS affiliation_institution_id,
              aa.status AS affiliation_status,
              aa.effective_from AS affiliation_effective_from,
              ac.aggregator_id,
              ac.aggregator_reference
         FROM agents ag
         LEFT JOIN active_affiliation aa ON aa.agent_id = ag.id
         LEFT JOIN active_aggregator ac ON ac.agent_id = ag.id
        WHERE ag.deleted_at IS NULL
          AND ($1::uuid IS NULL OR aa.institution_id = $1::uuid)
          AND (
                $2::text IS NULL
             OR ($2::text = 'AFFILIATED' AND aa.id IS NOT NULL)
             OR ($2::text = 'UNAFFILIATED' AND aa.id IS NULL)
          )
          AND ($3::text = '' OR ag.reference ILIKE '%' || $3::text || '%')
        ORDER BY ag.reference ASC
        LIMIT $4`,
      [institutionId, affiliation, search, bounded],
    );

    return rows.map((row) => ({
      agentId: row.agent_id,
      agentReference: row.agent_reference,
      agentStatus: row.agent_status,
      affiliationId: row.affiliation_id,
      affiliationInstitutionId: row.affiliation_institution_id,
      affiliationStatus: row.affiliation_status as 'ACTIVE' | null,
      affiliationEffectiveFrom: row.affiliation_effective_from?.toISOString() ?? null,
      aggregatorId: row.aggregator_id,
      aggregatorReference: row.aggregator_reference,
      /**
       * Relationship classification used by the console. `AGGREGATOR_LINKED` never implies an
       * institutional affiliation: the affiliation columns are the only authority for that.
       */
      relationship: row.affiliation_id
        ? 'INSTITUTION_AFFILIATED'
        : row.aggregator_id
          ? 'AGGREGATOR_LINKED'
          : 'INDEPENDENT',
    }));
  }

  private limit(value: number | undefined): number {
    if (value === undefined || value === null) return 50;
    if (!Number.isInteger(value) || value < 1 || value > 200) {
      throw new BadRequestException('limit must be an integer between 1 and 200');
    }
    return value;
  }

  private uuid(value: string, field: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }
}
