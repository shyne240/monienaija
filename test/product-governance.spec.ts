import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { ProductGovernanceRecord } from '../src/product-governance/product-governance-record.entity';
import { ProductGovernanceService } from '../src/product-governance/product-governance.service';
import {
  ProductGovernanceKind,
  ProductGovernanceStatus,
} from '../src/product-governance/product-governance.enums';
import type { AuditService } from '../src/operations/audit.service';

class GovernanceRepository {
  readonly records = new Map<string, ProductGovernanceRecord>();
  private sequence = 0;

  create(input: Partial<ProductGovernanceRecord>): ProductGovernanceRecord {
    return input as ProductGovernanceRecord;
  }

  save(record: ProductGovernanceRecord): Promise<ProductGovernanceRecord> {
    if (!record.id) {
      this.sequence += 1;
      record.id = `00000000-0000-4000-8000-000000000${String(this.sequence).padStart(3, '0')}`;
    }
    record.createdAt ??= new Date(1_000 + this.sequence);
    record.updatedAt = new Date(2_000 + this.sequence);
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  findOne(options: {
    where?: Partial<ProductGovernanceRecord>;
  }): Promise<ProductGovernanceRecord | null> {
    const conditions = options.where ?? {};
    return Promise.resolve(
      [...this.records.values()].find((record) =>
        Object.entries(conditions).every(
          ([key, value]) => (record as unknown as Record<string, unknown>)[key] === value,
        ),
      ) ?? null,
    );
  }

  find(options?: { where?: Partial<ProductGovernanceRecord> }): Promise<ProductGovernanceRecord[]> {
    const conditions = options?.where ?? {};
    return Promise.resolve(
      [...this.records.values()].filter((record) =>
        Object.entries(conditions).every(
          ([key, value]) => (record as unknown as Record<string, unknown>)[key] === value,
        ),
      ),
    );
  }
}

class GovernanceManager {
  constructor(private readonly repository: GovernanceRepository) {}

  getRepository(): Repository<ProductGovernanceRecord> {
    return this.repository as unknown as Repository<ProductGovernanceRecord>;
  }
}

class GovernanceDataSource {
  constructor(private readonly manager: GovernanceManager) {}

  transaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return callback(this.manager as unknown as EntityManager);
  }
}

describe('ProductGovernanceService', () => {
  function fixture() {
    const repository = new GovernanceRepository();
    const manager = new GovernanceManager(repository);
    const dataSource = new GovernanceDataSource(manager);
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new ProductGovernanceService(
      repository as unknown as Repository<ProductGovernanceRecord>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return { repository, service, audit };
  }

  it('persists and audits product governance records', async () => {
    const { service, repository, audit } = fixture();
    const record = await service.create({
      kind: ProductGovernanceKind.PRODUCT_PROFILE,
      recordKey: 'monienaija-core',
      name: 'MonieNaija Core Product',
      status: ProductGovernanceStatus.DRAFT,
      version: 1,
      payload: { country: 'NG', currency: 'NGN' },
      immutableRecord: true,
      actor: 'product-owner',
    });

    expect(record.id).toBeDefined();
    expect(repository.records.size).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'CREATED', entityType: 'PRODUCT_GOVERNANCE_RECORD' }),
    );
  });

  it('rejects duplicate versions and immutable updates', async () => {
    const { service } = fixture();
    const command = {
      kind: ProductGovernanceKind.PRODUCT_SCOPE,
      recordKey: 'internal-only',
      name: 'Internal Product Scope',
      status: ProductGovernanceStatus.DRAFT,
      version: 1,
      payload: {},
      immutableRecord: true,
      actor: 'owner',
    };
    const first = await service.create(command);
    await expect(service.create(command)).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.update(first.id, { name: 'Changed', actor: 'owner' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows mutable configuration updates and reports launch readiness evidence', async () => {
    const { service } = fixture();
    const mutable = await service.create({
      kind: ProductGovernanceKind.PRODUCT_CONFIGURATION,
      recordKey: 'pilot-defaults',
      name: 'Pilot Configuration',
      status: ProductGovernanceStatus.DRAFT,
      version: 1,
      payload: { cohort: 'pilot' },
      immutableRecord: false,
      actor: 'operations',
    });
    const updated = await service.update(mutable.id, {
      status: ProductGovernanceStatus.ACTIVE,
      payload: { cohort: 'pilot', enabled: true },
      actor: 'operations',
    });
    expect(updated.status).toBe(ProductGovernanceStatus.ACTIVE);

    const report = await service.report();
    expect(report.totalRecords).toBe(1);
    expect(report.recordCounts[ProductGovernanceKind.PRODUCT_CONFIGURATION]).toBe(1);
    const readiness = await service.launchReadiness();
    expect(readiness.status).toBe('WARNING');
  });
});
