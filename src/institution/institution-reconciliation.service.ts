import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  AGENT_INSTITUTION_RESOLVER,
  type AgentInstitutionResolver,
} from './agent-institution-resolver';
import type { InstitutionAttributionGapView, InstitutionResolution } from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GapRow {
  entity: string;
  entity_id: string;
  entity_reference: string;
  gap_reason: string;
  institution_id: string | null;
  affiliation_status: string | null;
  institution_status: string | null;
}

/**
 * Read-only attribution visibility.
 *
 * Reports agents that cannot be authoritatively attributed to an institution without inventing a
 * default, back-filling history or rewriting journals. Existing agents, wallets and transactions
 * remain untouched: this surface never writes.
 */
@Injectable()
export class InstitutionReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(AGENT_INSTITUTION_RESOLVER)
    private readonly resolver: AgentInstitutionResolver,
  ) {}

  async listAttributionGaps(
    options: { entityId?: string; limit?: number } = {},
  ): Promise<InstitutionAttributionGapView[]> {
    const limit = this.limit(options.limit);
    const entityId = options.entityId ? this.uuid(options.entityId) : null;
    const rows: GapRow[] = await this.dataSource.query(
      `SELECT entity, entity_id, entity_reference, gap_reason, institution_id,
              affiliation_status, institution_status
         FROM institution_attribution_gaps
        WHERE ($1::uuid IS NULL OR entity_id = $1::uuid)
        ORDER BY entity_reference ASC
        LIMIT $2`,
      [entityId, limit],
    );
    return rows.map((row) => ({
      entity: 'AGENT',
      entityId: row.entity_id,
      entityReference: row.entity_reference,
      gapReason: row.gap_reason,
      institutionId: row.institution_id,
      affiliationStatus:
        row.affiliation_status as InstitutionAttributionGapView['affiliationStatus'],
      institutionStatus:
        row.institution_status as InstitutionAttributionGapView['institutionStatus'],
    }));
  }

  async attributionGapSummary(): Promise<Array<{ gapReason: string; agentCount: number }>> {
    const rows: Array<{ gap_reason: string; agent_count: string }> = await this.dataSource.query(
      `SELECT gap_reason, count(*)::text AS agent_count
         FROM institution_attribution_gaps
        GROUP BY gap_reason
        ORDER BY gap_reason ASC`,
    );
    return rows.map((row) => ({ gapReason: row.gap_reason, agentCount: Number(row.agent_count) }));
  }

  /** Read-only resolution probe for operators; never substitutes a default institution. */
  async resolutionForAgent(agentId: string): Promise<InstitutionResolution> {
    return this.resolver.resolve(this.dataSource.manager, this.uuid(agentId), {
      lock: 'NONE',
    });
  }

  private limit(value: number | undefined): number {
    if (value === undefined || value === null) return 200;
    if (!Number.isInteger(value) || value < 1 || value > 500) {
      throw new BadRequestException('limit must be an integer between 1 and 500');
    }
    return value;
  }

  private uuid(value: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID_PATTERN.test(normalized)) {
      throw new BadRequestException('entityId must be a UUID');
    }
    return normalized;
  }
}
