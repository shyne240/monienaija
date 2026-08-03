import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { ProductGovernanceRecord } from './product-governance-record.entity';
import {
  LaunchReadinessStatus,
  ProductGovernanceKind,
  ProductGovernanceStatus,
} from './product-governance.enums';
import type {
  CreateProductGovernanceCommand,
  LaunchReadinessCheck,
  LaunchReadinessReport,
  ProductGovernanceReport,
  ProductGovernanceView,
  UpdateProductGovernanceCommand,
} from './product-governance.types';

const READINESS_REQUIREMENTS: Array<{ name: string; kinds: ProductGovernanceKind[] }> = [
  {
    name: 'product_definition',
    kinds: [
      ProductGovernanceKind.PRODUCT_PROFILE,
      ProductGovernanceKind.PRODUCT_REQUIREMENT,
      ProductGovernanceKind.PRODUCT_SCOPE,
    ],
  },
  {
    name: 'market_definition',
    kinds: [
      ProductGovernanceKind.SUPPORTED_COUNTRY,
      ProductGovernanceKind.SUPPORTED_CURRENCY,
      ProductGovernanceKind.PILOT_COHORT,
      ProductGovernanceKind.CUSTOMER_SEGMENT,
    ],
  },
  {
    name: 'capability_catalogue',
    kinds: [
      ProductGovernanceKind.BUSINESS_CAPABILITY,
      ProductGovernanceKind.FEATURE,
      ProductGovernanceKind.FEATURE_FLAG,
    ],
  },
  {
    name: 'risk_management',
    kinds: [ProductGovernanceKind.PRODUCT_RISK],
  },
  {
    name: 'launch_control',
    kinds: [
      ProductGovernanceKind.LAUNCH_ENVELOPE,
      ProductGovernanceKind.LAUNCH_GATE,
      ProductGovernanceKind.GONO_GO_CRITERION,
      ProductGovernanceKind.LAUNCH_CHECKLIST,
    ],
  },
  {
    name: 'regulatory_definition',
    kinds: [
      ProductGovernanceKind.REGULATORY_JURISDICTION,
      ProductGovernanceKind.REGULATORY_REQUIREMENT,
    ],
  },
  {
    name: 'operating_model',
    kinds: [
      ProductGovernanceKind.OPERATIONAL_OWNER,
      ProductGovernanceKind.PARTNER,
      ProductGovernanceKind.PARTNER_EVALUATION,
      ProductGovernanceKind.ROLLBACK_STRATEGY,
    ],
  },
  {
    name: 'service_measurement',
    kinds: [
      ProductGovernanceKind.SERVICE_LEVEL_OBJECTIVE,
      ProductGovernanceKind.SERVICE_LEVEL_INDICATOR,
      ProductGovernanceKind.SUCCESS_METRIC,
    ],
  },
  {
    name: 'product_configuration',
    kinds: [
      ProductGovernanceKind.PRODUCT_CONFIGURATION,
      ProductGovernanceKind.PRODUCT_VERSION_METADATA,
    ],
  },
];

@Injectable()
export class ProductGovernanceService {
  constructor(
    @InjectRepository(ProductGovernanceRecord)
    private readonly repository: Repository<ProductGovernanceRecord>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async create(command: CreateProductGovernanceCommand): Promise<ProductGovernanceView> {
    const normalized = this.normalizeCreate(command);
    try {
      const record = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ProductGovernanceRecord);
        const existing = await repository.findOne({
          where: {
            kind: normalized.kind,
            recordKey: normalized.recordKey,
            version: normalized.version,
          },
        });
        if (existing) {
          throw new ConflictException(
            'A governance record with this kind, key, and version already exists',
          );
        }
        const saved = await repository.save(
          repository.create({
            id: randomUUID(),
            kind: normalized.kind,
            recordKey: normalized.recordKey,
            name: normalized.name,
            status: normalized.status,
            version: normalized.version,
            parentId: normalized.parentId ?? null,
            payload: normalized.payload,
            immutableRecord: normalized.immutableRecord,
            createdBy: normalized.actor,
            updatedBy: normalized.actor,
          }),
        );
        await this.auditService.record(manager, {
          entityType: 'PRODUCT_GOVERNANCE_RECORD',
          entityId: saved.id,
          action: 'CREATED',
          actor: normalized.actor,
          newValues: this.auditValues(saved),
        });
        return saved;
      });
      return this.toView(record);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'A governance record with this kind, key, and version already exists',
        );
      }
      throw error;
    }
  }

  async get(id: string): Promise<ProductGovernanceView> {
    this.assertUuid(id);
    const record = await this.repository.findOne({ where: { id } });
    if (!record) {
      throw new NotFoundException(`Product governance record ${id} was not found`);
    }
    return this.toView(record);
  }

  async list(
    kind?: ProductGovernanceKind,
    status?: ProductGovernanceStatus,
    limit = 500,
  ): Promise<ProductGovernanceView[]> {
    const records = await this.repository.find({
      where: { ...(kind ? { kind } : {}), ...(status ? { status } : {}) },
      order: { kind: 'ASC', recordKey: 'ASC', version: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return records.map((record) => this.toView(record));
  }

  async update(
    id: string,
    command: UpdateProductGovernanceCommand,
  ): Promise<ProductGovernanceView> {
    this.assertUuid(id);
    const normalizedActor = this.normalizeActor(command.actor);
    const record = await this.repository.findOne({ where: { id } });
    if (!record) {
      throw new NotFoundException(`Product governance record ${id} was not found`);
    }
    if (record.immutableRecord) {
      throw new ConflictException(
        'This governance record is immutable; create a new version instead',
      );
    }
    const previous = this.auditValues(record);
    const updated = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ProductGovernanceRecord);
      if (command.name !== undefined) {
        record.name = this.normalizeName(command.name);
      }
      if (command.status !== undefined) {
        record.status = command.status;
      }
      if (command.payload !== undefined) {
        record.payload = command.payload;
      }
      record.updatedBy = normalizedActor;
      const saved = await repository.save(record);
      await this.auditService.record(manager, {
        entityType: 'PRODUCT_GOVERNANCE_RECORD',
        entityId: saved.id,
        action: 'UPDATED',
        actor: normalizedActor,
        previousValues: previous,
        newValues: this.auditValues(saved),
      });
      return saved;
    });
    return this.toView(updated);
  }

  async report(): Promise<ProductGovernanceReport> {
    const records = await this.repository.find();
    const recordCounts: Record<string, number> = {};
    for (const record of records) {
      recordCounts[record.kind] = (recordCounts[record.kind] ?? 0) + 1;
    }
    return {
      generatedAt: new Date().toISOString(),
      recordCounts,
      blockedRecords: records.filter((record) => record.status === ProductGovernanceStatus.BLOCKED)
        .length,
      immutableRecords: records.filter((record) => record.immutableRecord).length,
      totalRecords: records.length,
    };
  }

  async launchReadiness(): Promise<LaunchReadinessReport> {
    const records = await this.repository.find();
    const checks: LaunchReadinessCheck[] = READINESS_REQUIREMENTS.map((requirement) => {
      const matching = records.filter((record) => requirement.kinds.includes(record.kind));
      const blocking = matching.filter(
        (record) => record.status === ProductGovernanceStatus.BLOCKED,
      );
      const approved = matching.filter((record) =>
        [
          ProductGovernanceStatus.ACTIVE,
          ProductGovernanceStatus.APPROVED,
          ProductGovernanceStatus.COMPLETE,
        ].includes(record.status),
      );
      const status =
        blocking.length > 0
          ? LaunchReadinessStatus.FAIL
          : approved.length === 0
            ? LaunchReadinessStatus.WARNING
            : LaunchReadinessStatus.PASS;
      return {
        name: requirement.name,
        status,
        message:
          blocking.length > 0
            ? `${blocking.length} blocking governance record(s)`
            : approved.length > 0
              ? 'Governance evidence is present'
              : 'Governance evidence is not yet approved',
        recordCount: matching.length,
      };
    });
    const status = checks.some(
      (check) => String(check.status) === String(LaunchReadinessStatus.FAIL),
    )
      ? LaunchReadinessStatus.FAIL
      : checks.some((check) => String(check.status) === String(LaunchReadinessStatus.WARNING))
        ? LaunchReadinessStatus.WARNING
        : LaunchReadinessStatus.PASS;
    return { status, generatedAt: new Date().toISOString(), checks };
  }

  private normalizeCreate(command: CreateProductGovernanceCommand): CreateProductGovernanceCommand {
    const recordKey = command.recordKey.trim();
    if (!recordKey || recordKey.length > 160) {
      throw new BadRequestException('recordKey must contain 1 to 160 characters');
    }
    return {
      ...command,
      recordKey,
      name: this.normalizeName(command.name),
      actor: this.normalizeActor(command.actor),
      version: command.version < 1 ? 1 : command.version,
      payload: command.payload ?? {},
    };
  }

  private normalizeName(name: string): string {
    const normalized = name.trim();
    if (!normalized || normalized.length > 200) {
      throw new BadRequestException('name must contain 1 to 200 characters');
    }
    return normalized;
  }

  private normalizeActor(actor: string): string {
    const normalized = actor.trim();
    if (!normalized || normalized.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
    }
    return normalized;
  }

  private assertUuid(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('recordId must be a UUID');
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    const driverError =
      error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    return driverError === '23505';
  }

  private auditValues(record: ProductGovernanceRecord): Record<string, unknown> {
    return {
      kind: record.kind,
      recordKey: record.recordKey,
      name: record.name,
      status: record.status,
      version: record.version,
      parentId: record.parentId,
      payload: record.payload,
      immutableRecord: record.immutableRecord,
      updatedBy: record.updatedBy,
    };
  }

  private toView(record: ProductGovernanceRecord): ProductGovernanceView {
    return {
      id: record.id,
      kind: record.kind,
      recordKey: record.recordKey,
      name: record.name,
      status: record.status,
      version: record.version,
      parentId: record.parentId,
      payload: record.payload,
      immutableRecord: record.immutableRecord,
      createdBy: record.createdBy,
      updatedBy: record.updatedBy,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
