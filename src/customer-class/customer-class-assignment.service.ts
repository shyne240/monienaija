import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { CustomerClass } from './customer-class.entity';
import {
  CUSTOMER_CLASS_CODE_PATTERN,
  CustomerClassAssignmentSource,
  CustomerClassConfigurationStatus,
  CustomerClassStatus,
} from './customer-class.enums';
import type { CustomerClassAssignmentView, EffectiveCustomerClass } from './customer-class.types';

export interface AssignCustomerClassCommand {
  customerId: string;
  classId?: string;
  classCode?: string;
  reason?: string | null;
  source: CustomerClassAssignmentSource;
  actor: string;
  /** Must not be in the future; defaults to now. */
  effectiveFrom?: Date;
  /** Optimistic concurrency against the live assignment row. */
  expectedAssignmentVersion?: number;
}

export interface AssignCustomerClassResult {
  assignment: CustomerClassAssignmentView;
  previousClassCode: string | null;
  /** True when the customer already held exactly this class (no state change written). */
  replayed: boolean;
}

interface LiveAssignmentRow {
  id: string;
  customer_id: string;
  class_id: string;
  effective_from: Date;
  effective_to: Date | null;
  is_active: boolean;
  precedence: number;
  source: string;
  reason: string | null;
  created_by: string;
  created_at: Date;
  version: number;
  class_code: string;
  class_name: string;
  class_version: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deterministic usability rule, shared by assignment, resolution and the default-class hook. */
export function isUsableCustomerClass(cls: {
  enabled: boolean;
  status: string;
  configurationStatus: string;
  deletedAt: Date | null;
}): boolean {
  return (
    cls.deletedAt === null &&
    cls.enabled &&
    cls.status === (CustomerClassStatus.ACTIVE as string) &&
    cls.configurationStatus === (CustomerClassConfigurationStatus.CONFIGURED as string)
  );
}

@Injectable()
export class CustomerClassAssignmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Assign or switch the customer's class inside the caller's transaction. The live assignment
   * row is locked; the previous row is closed (effective_to=now) and a fresh row is inserted —
   * the table is the assignment history. Re-assigning the exact current class is a no-op replay.
   */
  async assignInManager(
    manager: EntityManager,
    command: AssignCustomerClassCommand,
  ): Promise<AssignCustomerClassResult> {
    const actor = this.normalizeActor(command.actor);
    const customerId = this.normalizeUuid(command.customerId, 'customerId');
    const reason = this.normalizeReason(command.reason, command.source);
    const effectiveFrom = command.effectiveFrom ?? new Date();
    if (!(effectiveFrom instanceof Date) || !Number.isFinite(effectiveFrom.getTime())) {
      throw new BadRequestException('effectiveFrom must be a valid date');
    }
    if (effectiveFrom.getTime() > Date.now()) {
      throw new BadRequestException('effective_from cannot be in the future');
    }

    const customer = await this.lockCustomer(manager, customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.isSynthetic) {
      throw new ConflictException('Synthetic customers cannot carry a customer class');
    }
    if (customer.status === 'CLOSED') {
      throw new ConflictException('Closed customers cannot be assigned a class');
    }

    const target = await this.lockTargetClass(manager, command);
    if (!target) throw new NotFoundException('Customer class not found');
    if (!isUsableCustomerClass(target)) {
      throw new ConflictException('Customer class is not available for assignment');
    }

    const current = await this.lockLiveAssignment(manager, customerId);
    if (current && command.expectedAssignmentVersion === undefined) {
      throw new ConflictException('Expected assignment version is required; refresh and retry');
    }
    if (command.expectedAssignmentVersion !== undefined) {
      if (!current) {
        throw new ConflictException(
          'Expected a live class assignment, but none exists; refresh and retry',
        );
      }
      if (current.version !== command.expectedAssignmentVersion) {
        throw new ConflictException('Class assignment is stale; refresh and retry');
      }
    }

    const previousClassCode = current?.class_code ?? null;
    if (current && current.class_id === target.id) {
      return {
        assignment: this.toView(current),
        previousClassCode,
        replayed: true,
      };
    }

    if (current && effectiveFrom.getTime() <= current.effective_from.getTime()) {
      throw new ConflictException('effective_from cannot precede the current assignment');
    }
    if (current) {
      await manager.query(
        `UPDATE customer_class_assignments
            SET is_active = FALSE,
                effective_to = $2,
                updated_by = $3,
                version = version + 1,
                updated_at = NOW()
          WHERE id = $1`,
        [current.id, effectiveFrom, actor],
      );
    }

    const assignmentId = randomUUID();
    await manager.query(
      `INSERT INTO customer_class_assignments
        (id, customer_id, class_id, effective_from, effective_to, is_active, precedence, source, reason, created_by, updated_by, version)
       VALUES ($1, $2, $3, $4, NULL, TRUE, 0, $5, $6, $7, NULL, $8)`,
      [
        assignmentId,
        customerId,
        target.id,
        effectiveFrom,
        command.source,
        reason,
        actor,
        current ? Number(current.version) + 1 : 1,
      ],
    );

    const created = await this.getAssignmentViewInManager(manager, assignmentId);
    if (!created) throw new Error('Customer class assignment could not be read after insert');

    await this.auditService.record(manager, {
      entityType: 'CUSTOMER_CLASS_ASSIGNMENT',
      entityId: assignmentId,
      action: current ? 'CLASS_SWITCHED' : 'CLASS_ASSIGNED',
      actor,
      previousValues: current
        ? { classCode: current.class_code, assignmentId: current.id }
        : undefined,
      newValues: {
        classCode: target.code,
        assignmentId,
        source: command.source,
        effectiveFrom: effectiveFrom.toISOString(),
      },
    });

    return { assignment: created, previousClassCode, replayed: false };
  }

  /**
   * Registration hook: assign the configured default class (at most one `is_default` row exists).
   * A missing or unusable default resolves to an explicit unresolved-class state. Database and
   * audit failures still abort the caller transaction.
   */
  async assignDefaultOnRegistrationInManager(
    manager: EntityManager,
    customerId: string,
    actor: string,
  ): Promise<EffectiveCustomerClass | null> {
    const rows = await manager.query<CustomerClass[]>(
      `SELECT * FROM customer_classes WHERE is_default = TRUE AND deleted_at IS NULL FOR UPDATE`,
    );
    const target = rows[0];
    if (!target || !isUsableCustomerClass(this.fromClassRow(target))) {
      return null;
    }
    const result = await this.assignInManager(manager, {
      customerId,
      classId: target.id,
      reason: 'Default class assigned on registration',
      source: CustomerClassAssignmentSource.REGISTRATION_DEFAULT,
      actor,
    });
    return result.assignment;
  }

  /** Standalone assignment (own transaction) for governed HTTP paths. */
  async assignOuter(command: AssignCustomerClassCommand): Promise<AssignCustomerClassResult> {
    return this.dataSource.transaction((manager) => this.assignInManager(manager, command));
  }

  async effectiveOuter(customerId: string): Promise<CustomerClassAssignmentView | null> {
    const id = this.normalizeUuid(customerId, 'customerId');
    return this.dataSource.transaction(async (manager) => {
      const current = await this.lockLiveAssignment(manager, id, false);
      return current ? this.toView(current) : null;
    });
  }

  async history(customerId: string, limit = 25): Promise<CustomerClassAssignmentView[]> {
    const id = this.normalizeUuid(customerId, 'customerId');
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.dataSource.transaction((manager) =>
      this.queryAssignmentViews(
        manager,
        `WHERE a.customer_id = $1 AND a.deleted_at IS NULL ORDER BY a.effective_from DESC, a.created_at DESC LIMIT $2`,
        [id, take],
      ),
    );
    return rows.map((row) => this.toView(row));
  }

  // ------------------------------------------------------------ internals

  private async lockCustomer(
    manager: EntityManager,
    customerId: string,
  ): Promise<{ id: string; status: string; isSynthetic: boolean } | null> {
    const rows = await manager.query<Array<{ id: string; status: string; is_synthetic: boolean }>>(
      `SELECT id, status, is_synthetic FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [customerId],
    );
    const row = rows[0];
    return row ? { id: row.id, status: row.status, isSynthetic: row.is_synthetic } : null;
  }

  private async lockTargetClass(
    manager: EntityManager,
    command: AssignCustomerClassCommand,
  ): Promise<CustomerClass | null> {
    if (command.classId) {
      const id = this.normalizeUuid(command.classId, 'classId');
      const rows = await manager.query<CustomerClass[]>(
        `SELECT * FROM customer_classes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      return rows[0] ? this.fromClassRow(rows[0]) : null;
    }
    if (command.classCode) {
      const code = this.normalizeClassCode(command.classCode);
      const rows = await manager.query<CustomerClass[]>(
        `SELECT * FROM customer_classes WHERE code = $1 AND deleted_at IS NULL FOR UPDATE`,
        [code],
      );
      return rows[0] ? this.fromClassRow(rows[0]) : null;
    }
    throw new BadRequestException('classId or classCode is required');
  }

  private async lockLiveAssignment(
    manager: EntityManager,
    customerId: string,
    forUpdate = true,
  ): Promise<LiveAssignmentRow | null> {
    const rows = await manager.query<LiveAssignmentRow[]>(
      `SELECT a.id, a.customer_id, a.class_id, a.effective_from, a.effective_to, a.is_active,
              a.precedence, a.source, a.reason, a.created_by, a.created_at, a.version,
              c.code AS class_code, c.name AS class_name, c.version AS class_version
         FROM customer_class_assignments a
         JOIN customer_classes c ON c.id = a.class_id
        WHERE a.customer_id = $1 AND a.is_active = TRUE AND a.deleted_at IS NULL
        ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
      [customerId],
    );
    return rows[0] ?? null;
  }

  private async getAssignmentViewInManager(
    manager: EntityManager,
    assignmentId: string,
  ): Promise<CustomerClassAssignmentView | null> {
    const rows = await this.queryAssignmentViews(manager, `WHERE a.id = $1`, [assignmentId]);
    return rows[0] ? this.toView(rows[0]) : null;
  }

  private queryAssignmentViews(
    manager: EntityManager,
    where: string,
    params: unknown[],
  ): Promise<LiveAssignmentRow[]> {
    return manager.query<LiveAssignmentRow[]>(
      `SELECT a.id, a.customer_id, a.class_id, a.effective_from, a.effective_to, a.is_active,
              a.precedence, a.source, a.reason, a.created_by, a.created_at, a.version,
              c.code AS class_code, c.name AS class_name, c.version AS class_version
         FROM customer_class_assignments a
         JOIN customer_classes c ON c.id = a.class_id
        ${where}`,
      params,
    );
  }

  private toView(row: LiveAssignmentRow): CustomerClassAssignmentView {
    return {
      customerId: row.customer_id,
      assignmentId: row.id,
      classId: row.class_id,
      classCode: row.class_code,
      className: row.class_name,
      assignmentVersion: Number(row.version),
      classVersion: Number(row.class_version),
      source: row.source,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      isActive: row.is_active,
      precedence: Number(row.precedence),
      reason: row.reason,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  private fromClassRow(row: CustomerClass): CustomerClass {
    // Raw SELECT * returns snake_case columns; normalize the fields the usability rule reads.
    const raw = row as unknown as Record<string, unknown>;
    if (typeof raw.configuration_status === 'string') {
      row.configurationStatus = raw.configuration_status;
    }
    if (typeof raw.is_default === 'boolean') row.isDefault = raw.is_default;
    if (raw.created_at instanceof Date) row.createdAt = raw.created_at;
    if (raw.updated_at instanceof Date) row.updatedAt = raw.updated_at;
    if (raw.deleted_at !== undefined) {
      row.deletedAt = (raw.deleted_at as Date | null) ?? null;
    }
    return row;
  }

  private normalizeActor(actor: string): string {
    const value = actor?.trim();
    if (!value || value.length > 160) throw new BadRequestException('actor must be 1-160 chars');
    return value;
  }

  private normalizeUuid(value: string, field: string): string {
    const v = value?.trim() ?? '';
    if (!UUID_PATTERN.test(v)) throw new BadRequestException(`${field} must be a UUID`);
    return v.toLowerCase();
  }

  private normalizeClassCode(code: string): string {
    const v = code?.trim().toUpperCase() ?? '';
    if (!CUSTOMER_CLASS_CODE_PATTERN.test(v)) {
      throw new BadRequestException('classCode must match ^[A-Z0-9_]{3,80}$');
    }
    return v;
  }

  private normalizeReason(
    reason: string | null | undefined,
    source: CustomerClassAssignmentSource,
  ): string | null {
    const requires =
      source === CustomerClassAssignmentSource.MANUAL ||
      source === CustomerClassAssignmentSource.SWITCH;
    const v = reason?.trim() ?? '';
    if (!v) {
      if (requires) throw new BadRequestException('A reason is required for manual assignment');
      return null;
    }
    if (v.length < 3) throw new BadRequestException('reason must be at least 3 chars');
    if (v.length > 500) throw new BadRequestException('reason must be at most 500 chars');
    return v;
  }
}
