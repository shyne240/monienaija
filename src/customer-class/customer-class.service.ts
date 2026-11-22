import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { isUsableCustomerClass } from './customer-class-assignment.service';
import { CustomerClass } from './customer-class.entity';
import {
  CUSTOMER_CLASS_CODE_PATTERN,
  CustomerClassConfigurationStatus,
  CustomerClassStatus,
} from './customer-class.enums';

export interface CreateCustomerClassCommand {
  reference?: string;
  code: string;
  name: string;
  description?: string | null;
  status?: CustomerClassStatus;
  enabled?: boolean;
  configurationStatus?: CustomerClassConfigurationStatus;
  isDefault?: boolean;
  actor: string;
}

export interface UpdateCustomerClassCommand {
  name?: string;
  description?: string | null;
  status?: CustomerClassStatus;
  enabled?: boolean;
  configurationStatus?: CustomerClassConfigurationStatus;
  isDefault?: boolean;
  actor: string;
  expectedVersion: number;
}

const STATUS_VALUES = Object.values(CustomerClassStatus) as string[];
const CONFIGURATION_VALUES = Object.values(CustomerClassConfigurationStatus) as string[];

@Injectable()
export class CustomerClassService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async create(command: CreateCustomerClassCommand): Promise<CustomerClass> {
    const actor = this.normalizeActor(command.actor);
    const code = this.normalizeCode(command.code);
    const name = this.normalizeText(command.name, 'name', 160);
    const description = this.normalizeOptionalText(command.description ?? null, 'description', 500);
    const generatedReference = `CUSTOMER-CLASS-${code}`;
    const reference = this.normalizeReference(
      command.reference ??
        (generatedReference.length <= 80
          ? generatedReference
          : `CUSTOMER-CLASS-${code.slice(0, 48)}-${createHash('sha256').update(code).digest('hex').slice(0, 16).toUpperCase()}`),
    );
    const status = command.status ?? CustomerClassStatus.ACTIVE;
    if (!STATUS_VALUES.includes(status)) {
      throw new BadRequestException('status must be one of ACTIVE, DISABLED, DEPRECATED');
    }
    const configurationStatus =
      command.configurationStatus ?? CustomerClassConfigurationStatus.NOT_CONFIGURED;
    if (!CONFIGURATION_VALUES.includes(configurationStatus)) {
      throw new BadRequestException(
        'configurationStatus must be one of CONFIGURED, NOT_CONFIGURED, DISABLED',
      );
    }
    const enabled = command.enabled ?? false;
    const isDefault = command.isDefault ?? false;

    return this.dataSource.transaction(async (manager) => {
      // Serialize catalogue governance before row locks; concurrent default changes otherwise
      // lock their target and previous default in opposite orders.
      await this.lockCatalogue(manager);
      await this.assertCodeAvailable(manager, code, reference);
      if (isDefault) await this.clearOtherDefaults(manager, actor);
      const id = randomUUID();
      await manager.query(
        `INSERT INTO customer_classes
          (id, reference, code, name, description, kind, status, enabled, configuration_status, is_default, created_by, updated_by, version)
         VALUES ($1, $2, $3, $4, $5, 'CUSTOMER', $6, $7, $8, $9, $10, NULL, 1)`,
        [
          id,
          reference,
          code,
          name,
          description,
          status,
          enabled,
          configurationStatus,
          isDefault,
          actor,
        ],
      );
      const created = await this.getByIdInManager(manager, id);
      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_CLASS',
        entityId: id,
        action: 'CREATED',
        actor,
        newValues: this.values(created),
      });
      return created;
    });
  }

  async getById(id: string): Promise<CustomerClass> {
    this.assertUuid(id);
    const entity = await this.dataSource.transaction((manager) =>
      this.getByIdInManager(manager, id),
    );
    if (!entity || entity.deletedAt !== null) {
      throw new NotFoundException(`Customer class ${id} not found`);
    }
    return entity;
  }

  async getByCode(code: string): Promise<CustomerClass> {
    const normalized = this.normalizeCode(code);
    const rows = await this.dataSource.query<CustomerClass[]>(
      `SELECT * FROM customer_classes WHERE code = $1 AND deleted_at IS NULL`,
      [normalized],
    );
    const row = rows[0];
    const normalizedRow = row ? this.fromRaw(row) : null;
    if (!normalizedRow || normalizedRow.deletedAt !== null) {
      throw new NotFoundException(`Customer class ${normalized} not found`);
    }
    return normalizedRow;
  }

  async list(): Promise<CustomerClass[]> {
    const rows = await this.dataSource.query<CustomerClass[]>(
      `SELECT * FROM customer_classes WHERE deleted_at IS NULL ORDER BY created_at ASC, code ASC`,
    );
    return rows.map((row) => this.fromRaw(row));
  }

  async update(id: string, command: UpdateCustomerClassCommand): Promise<CustomerClass> {
    this.assertUuid(id);
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      await this.lockCatalogue(manager);
      const rows = await manager.query<CustomerClass[]>(
        `SELECT * FROM customer_classes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      const current = rows[0] ? this.fromRaw(rows[0]) : null;
      if (!current) throw new NotFoundException(`Customer class ${id} not found`);
      if (command.expectedVersion !== Number(current.version)) {
        throw new ConflictException('Customer class version is stale');
      }
      const next = {
        name:
          command.name !== undefined ? this.normalizeText(command.name, 'name', 160) : current.name,
        description:
          command.description !== undefined
            ? this.normalizeOptionalText(command.description, 'description', 500)
            : current.description,
        status: command.status ?? current.status,
        enabled: command.enabled ?? current.enabled,
        configurationStatus: command.configurationStatus ?? current.configurationStatus,
        isDefault: command.isDefault ?? current.isDefault,
      };
      if (!STATUS_VALUES.includes(next.status)) {
        throw new BadRequestException('status must be one of ACTIVE, DISABLED, DEPRECATED');
      }
      if (!CONFIGURATION_VALUES.includes(next.configurationStatus)) {
        throw new BadRequestException(
          'configurationStatus must be one of CONFIGURED, NOT_CONFIGURED, DISABLED',
        );
      }
      if (
        (command.enabled !== undefined ||
          command.status !== undefined ||
          command.configurationStatus !== undefined) &&
        !isUsableCustomerClass({ ...next, deletedAt: null })
      ) {
        await this.assertNoActiveFeeRules(manager, current.code);
      }
      if (command.isDefault === true && !current.isDefault) {
        await this.clearOtherDefaults(manager, actor);
      }
      // `code` is immutable canonical commercial identity and is deliberately never updated.
      await manager.query(
        `UPDATE customer_classes
            SET name = $2, description = $3, status = $4, enabled = $5,
                configuration_status = $6, is_default = $7,
                updated_by = $8, version = version + 1, updated_at = NOW()
          WHERE id = $1`,
        [
          id,
          next.name,
          next.description,
          next.status,
          next.enabled,
          next.configurationStatus,
          next.isDefault,
          actor,
        ],
      );
      const saved = await this.getByIdInManager(manager, id);
      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_CLASS',
        entityId: id,
        action: 'UPDATED',
        actor,
        previousValues: this.values(current),
        newValues: this.values(saved),
      });
      return saved;
    });
  }

  private async assertNoActiveFeeRules(manager: EntityManager, classCode: string): Promise<void> {
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id
         FROM fee_rules
        WHERE customer_class_code = $1
          AND is_active = TRUE
          AND deleted_at IS NULL
        LIMIT 1`,
      [classCode],
    );
    if (rows.length > 0) {
      throw new ConflictException(
        `Customer class ${classCode} is referenced by active fee rules and cannot be disabled or deprecated`,
      );
    }
  }

  private async lockCatalogue(manager: EntityManager): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('customer-class-catalogue-v1', 0))`,
    );
  }

  private async clearOtherDefaults(manager: EntityManager, actor: string): Promise<void> {
    const previousRows = await manager.query<CustomerClass[]>(
      `SELECT * FROM customer_classes WHERE is_default = TRUE AND deleted_at IS NULL FOR UPDATE`,
    );
    for (const row of previousRows) {
      const previous = this.fromRaw(row);
      await manager.query(
        `UPDATE customer_classes
            SET is_default = FALSE, updated_by = $2, version = version + 1, updated_at = NOW()
          WHERE id = $1`,
        [previous.id, actor],
      );
      const saved = await this.getByIdInManager(manager, previous.id);
      await this.auditService.record(manager, {
        entityType: 'CUSTOMER_CLASS',
        entityId: previous.id,
        action: 'UPDATED',
        actor,
        previousValues: this.values(previous),
        newValues: this.values(saved),
      });
    }
  }

  private async assertCodeAvailable(
    manager: EntityManager,
    code: string,
    reference: string,
  ): Promise<void> {
    const rows = await manager.query<Array<{ code: string; reference: string }>>(
      `SELECT code, reference FROM customer_classes WHERE (code = $1 OR reference = $2) AND deleted_at IS NULL FOR SHARE`,
      [code, reference],
    );
    for (const row of rows) {
      if (row.code === code) {
        throw new ConflictException(`Customer class code ${code} already exists`);
      }
      if (row.reference === reference) {
        throw new ConflictException(`Customer class reference ${reference} already exists`);
      }
    }
  }

  private async getByIdInManager(manager: EntityManager, id: string): Promise<CustomerClass> {
    const rows = await manager.query<CustomerClass[]>(
      `SELECT * FROM customer_classes WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException(`Customer class ${id} not found`);
    return this.fromRaw(row);
  }

  /** Raw rows come back snake_case; normalize to the entity's camelCase shape. */
  private fromRaw(row: CustomerClass): CustomerClass {
    const raw = row as unknown as Record<string, unknown>;
    return {
      ...row,
      configurationStatus: (raw.configuration_status ?? row.configurationStatus) as string,
      isDefault: Boolean(raw.is_default ?? row.isDefault),
      createdBy: (raw.created_by ?? row.createdBy) as string,
      updatedBy: (raw.updated_by ?? row.updatedBy ?? null) as string | null,
      createdAt: raw.created_at as Date,
      updatedAt: raw.updated_at as Date,
      deletedAt: ((raw.deleted_at ?? null) as Date | null) ?? null,
      version: Number(row.version),
    } as CustomerClass;
  }

  private values(entity: CustomerClass): Record<string, unknown> {
    return {
      reference: entity.reference,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      status: entity.status,
      enabled: entity.enabled,
      configurationStatus: entity.configurationStatus,
      isDefault: entity.isDefault,
      version: Number(entity.version),
    };
  }

  private normalizeActor(actor: string): string {
    const v = actor?.trim();
    if (!v || v.length > 160) throw new BadRequestException('actor must be 1-160 chars');
    return v;
  }

  private normalizeText(value: string, field: string, max: number): string {
    const v = value?.trim();
    if (!v || v.length > max) throw new BadRequestException(`${field} must be 1-${max} chars`);
    return v;
  }

  private normalizeOptionalText(
    value: string | null | undefined,
    field: string,
    max: number,
  ): string | null {
    if (value === null || value === undefined) return null;
    const v = value.trim();
    if (v.length === 0) return null;
    if (v.length > max) throw new BadRequestException(`${field} must be at most ${max} chars`);
    return v;
  }

  private normalizeCode(code: string): string {
    const v = code?.trim().toUpperCase() ?? '';
    if (!CUSTOMER_CLASS_CODE_PATTERN.test(v)) {
      throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    }
    return v;
  }

  private normalizeReference(reference: string): string {
    const v = reference.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{3,80}$/.test(v)) {
      throw new BadRequestException('reference must match ^[A-Z0-9._-]{3,80}$');
    }
    return v;
  }

  private assertUuid(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('id must be a UUID');
    }
  }
}
