import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import type { EffectiveCustomerClass } from './customer-class.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolutionRow {
  assignment_id: string;
  customer_id: string;
  class_id: string;
  class_code: string;
  class_name: string;
  assignment_version: number;
  class_version: number;
  source: string;
  effective_from: Date;
  effective_to: Date | null;
}

/**
 * The single class-resolution implementation. Both the HTTP read surface and Arena 3's
 * limit/commercial integration call this — no duplicated class logic anywhere else.
 *
 * Determinism: the live assignment per customer is unique (partial unique index), and the query
 * orders defensively (`precedence DESC, effective_from DESC, created_at DESC, id DESC`) and takes
 * exactly one row. A class is usable for resolution only when it is `enabled`, `status='ACTIVE'`,
 * `configuration_status='CONFIGURED'` and not soft-deleted; anything else resolves to `null`.
 */
@Injectable()
export class CustomerClassResolverService {
  constructor(private readonly dataSource: DataSource) {}

  async resolveInManager(
    manager: EntityManager,
    customerId: string,
    now: Date = new Date(),
  ): Promise<EffectiveCustomerClass | null> {
    const normalizedId = this.normalizeUuid(customerId);
    const rows = await manager.query<ResolutionRow[]>(
      `SELECT a.id AS assignment_id,
              a.customer_id AS customer_id,
              a.class_id AS class_id,
              c.code AS class_code,
              c.name AS class_name,
              a.version AS assignment_version,
              c.version AS class_version,
              a.source AS source,
              a.effective_from AS effective_from,
              a.effective_to AS effective_to
         FROM customer_class_assignments a
         JOIN customer_classes c ON c.id = a.class_id
        WHERE a.customer_id = $1
          AND a.is_active = TRUE
          AND a.deleted_at IS NULL
          AND a.effective_from <= $2
          AND (a.effective_to IS NULL OR $2 < a.effective_to)
          AND c.deleted_at IS NULL
          AND c.enabled = TRUE
          AND c.status = 'ACTIVE'
          AND c.configuration_status = 'CONFIGURED'
        ORDER BY a.precedence DESC, a.effective_from DESC, a.created_at DESC, a.id DESC
        LIMIT 1`,
      [normalizedId, now],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      customerId: row.customer_id,
      assignmentId: row.assignment_id,
      classId: row.class_id,
      classCode: row.class_code,
      className: row.class_name,
      assignmentVersion: Number(row.assignment_version),
      classVersion: Number(row.class_version),
      source: row.source,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    };
  }

  /** Convenience contract for Arena 3 call sites that only need the code (e.g. segmentCodes). */
  async resolveClassCodeInManager(
    manager: EntityManager,
    customerId: string,
    now: Date = new Date(),
  ): Promise<string | null> {
    const effective = await this.resolveInManager(manager, customerId, now);
    return effective?.classCode ?? null;
  }

  /** Read-only resolution outside a transaction (fresh connection, no locks held). */
  async resolveOuter(
    customerId: string,
    now: Date = new Date(),
  ): Promise<EffectiveCustomerClass | null> {
    return this.dataSource.transaction((manager) =>
      this.resolveInManager(manager, customerId, now),
    );
  }

  async resolveClassCodeOuter(customerId: string, now: Date = new Date()): Promise<string | null> {
    const effective = await this.resolveOuter(customerId, now);
    return effective?.classCode ?? null;
  }

  private normalizeUuid(value: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!UUID_PATTERN.test(normalized)) {
      throw new BadRequestException('customerId must be a UUID');
    }
    return normalized.toLowerCase();
  }
}
