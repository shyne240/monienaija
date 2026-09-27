import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

export interface ResolvedProfile {
  limitProfileCode: string;
  assignmentId: string;
  subjectType: string;
  subjectId: string | null;
  segmentCode: string | null;
  precedence: number;
}

@Injectable()
export class LimitProfileResolverService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Resolve applicable Limit Profile for a principal using V1-LIMIT-02 assignments.
   * Supports GLOBAL, CUSTOMER, AGENT, AGENT_CLASS, SEGMENT (segmentCodes optional).
   * Uses stored precedence/effective dates. If multiple match, highest precedence wins, tie broken by effectiveFrom DESC, createdAt DESC.
   * If no assignment matches, returns null (treated as unlimited — see V1-LIMIT-04 spec "no applicable limit").
   * If assignment points to disabled/missing profile, returns null (no limit) and logs warning — treated as configuration missing, not block.
   * Never hardcodes tier/KYC.
   */
  async resolve(
    manager: EntityManager,
    input: {
      principalType: string; // CUSTOMER | AGENT
      principalId: string; // uuid
      agentClassId?: string | null; // for AGENT principals
      segmentCodes?: string[]; // optional segment memberships, uppercased
      now?: Date;
    },
  ): Promise<ResolvedProfile | null> {
    const now = input.now ?? new Date();
    const principalType = input.principalType.trim().toUpperCase();
    const principalId = input.principalId.trim();
    const agentClassId = input.agentClassId?.trim() ?? null;
    const segmentCodes = (input.segmentCodes ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);

    // Build candidate condition
    // We query all active assignments effective now, then filter in SQL for matches
    // Candidates:
    // - GLOBAL always candidate
    // - CUSTOMER where principalType=CUSTOMER and subjectId=principalId
    // - AGENT where principalType=AGENT and subjectId=principalId
    // - AGENT_CLASS where agentClassId provided and subjectId=agentClassId
    // - SEGMENT where segmentCode in segmentCodes
    const k = segmentCodes.length;
    const queryParams: unknown[] = [now, now];
    if (k > 0) queryParams.push(...segmentCodes);
    queryParams.push(principalId, principalType, agentClassId ?? '00000000-0000-0000-0000-000000000000');
    const pPrincipalId = 3 + k;
    const pPrincipalType = 4 + k;
    const pAgentClassId = 5 + k;
    let segmentInClause = '';
    if (k > 0) {
      segmentInClause = segmentCodes.map((_, i) => `$${3 + i}`).join(',');
    }

    const sql = `
      SELECT id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, created_at
      FROM limit_assignments
      WHERE is_active = true
        AND deleted_at IS NULL
        AND effective_from <= $1
        AND (effective_to IS NULL OR $2 < effective_to)
        AND (
          subject_type = 'GLOBAL'
          OR (subject_type = 'CUSTOMER' AND subject_id = $${pPrincipalId} AND $${pPrincipalType} = 'CUSTOMER')
          OR (subject_type = 'AGENT' AND subject_id = $${pPrincipalId} AND $${pPrincipalType} = 'AGENT')
          OR (subject_type = 'AGENT_CLASS' AND subject_id = $${pAgentClassId} AND $${pPrincipalType} = 'AGENT')
          ${k > 0 ? `OR (subject_type = 'SEGMENT' AND segment_code IN (${segmentInClause}))` : ''}
        )
      ORDER BY precedence DESC, effective_from DESC, created_at DESC
      LIMIT 1
    `;

    const rows: Array<{
      id: string;
      limit_profile_code: string;
      subject_type: string;
      subject_id: string | null;
      segment_code: string | null;
      precedence: number;
      effective_from: string;
      created_at: string;
    }> = await manager.query(sql, queryParams);

    const row = rows[0];
    if (!row) return null;

    // Verify profile exists and is enabled/active
    const profileRows: Array<{ code: string; enabled: boolean; status: string; deleted_at: string | null }> = await manager.query(
      `SELECT code, enabled, status, deleted_at FROM limit_profiles WHERE code = $1 LIMIT 1`,
      [row.limit_profile_code],
    );
    const profile = profileRows[0];
    if (!profile || profile.deleted_at !== null || !profile.enabled || profile.status !== 'ACTIVE') {
      // Treat disabled/missing profile as no limit (permissive) — but for diagnostics we could log.
      // Spec test "Profile disabled" expects within limit (allow), not block.
      return null;
    }

    return {
      limitProfileCode: row.limit_profile_code,
      assignmentId: row.id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      segmentCode: row.segment_code,
      precedence: row.precedence,
    };
  }

  /**
   * Resolve without manager (uses dataSource)
   */
  async resolveOuter(input: {
    principalType: string;
    principalId: string;
    agentClassId?: string | null;
    segmentCodes?: string[];
    now?: Date;
  }): Promise<ResolvedProfile | null> {
    // Use dataSource.createQueryRunner or transaction?
    // For outer call outside manager, use dataSource.query directly (no transaction)
    // Create a temporary manager via queryRunner
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      const manager = queryRunner.manager;
      return this.resolve(manager, input);
    } finally {
      await queryRunner.release();
    }
  }
}
