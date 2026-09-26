import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../operations/audit.service';
import { Aggregator } from './aggregator.entity';
import { AggregatorStatus } from './aggregator.enums';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_AGGREGATOR_TRANSITIONS: Record<AggregatorStatus, AggregatorStatus[]> = {
  [AggregatorStatus.PENDING]: [AggregatorStatus.ACTIVE, AggregatorStatus.TERMINATED],
  [AggregatorStatus.ACTIVE]: [AggregatorStatus.SUSPENDED, AggregatorStatus.TERMINATED],
  [AggregatorStatus.SUSPENDED]: [AggregatorStatus.ACTIVE, AggregatorStatus.TERMINATED],
  [AggregatorStatus.TERMINATED]: [],
};

@Injectable()
export class AggregatorService {
  constructor(
    @InjectRepository(Aggregator)
    private readonly aggregatorRepository: Repository<Aggregator>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async create(input: {
    reference: string;
    code: string;
    corporateName: string;
    displayName?: string;
    contactEmail?: string;
    contactPhone?: string;
    actor: string;
  }): Promise<Aggregator> {
    const reference = input.reference?.trim();
    const code = input.code?.trim().toUpperCase();
    const corporateName = input.corporateName?.trim();
    if (!reference || reference.length < 3 || reference.length > 80) {
      throw new BadRequestException('reference must be 3-80 chars');
    }
    if (!code || code.length < 3 || code.length > 80) {
      throw new BadRequestException('code must be 3-80 chars');
    }
    if (!corporateName || corporateName.length < 2 || corporateName.length > 320) {
      throw new BadRequestException('corporateName must be 2-320 chars');
    }
    const actor = this.normalizeActor(input.actor);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Aggregator);
      const existingRef = await repo.findOne({ where: { reference } });
      if (existingRef && existingRef.deletedAt === null) {
        throw new ConflictException(`Aggregator reference ${reference} already exists`);
      }
      const existingCode = await repo.findOne({ where: { code } });
      if (existingCode && existingCode.deletedAt === null) {
        throw new ConflictException(`Aggregator code ${code} already exists`);
      }

      const aggregator = repo.create({
        id: randomUUID(),
        reference,
        code,
        corporateName,
        displayName: input.displayName?.trim() ?? null,
        contactEmail: input.contactEmail?.trim() ?? null,
        contactPhone: input.contactPhone?.trim() ?? null,
        status: AggregatorStatus.PENDING,
        createdBy: actor,
        updatedBy: actor,
        version: 1,
      });

      const saved = await repo.save(aggregator);

      await this.auditService.record(manager, {
        entityType: 'AGGREGATOR',
        entityId: saved.id,
        action: 'AGGREGATOR_CREATED',
        actor,
        newValues: this.toValues(saved),
      });

      return saved;
    });
  }

  async getById(id: string): Promise<Aggregator> {
    this.assertUuid(id, 'id');
    const agg = await this.aggregatorRepository.findOne({ where: { id } });
    if (!agg || agg.deletedAt !== null) throw new NotFoundException(`Aggregator ${id} not found`);
    return agg;
  }

  async list(): Promise<Aggregator[]> {
    return this.aggregatorRepository.find({ where: {} as any, order: { createdAt: 'ASC' } });
  }

  async activate(id: string, actor: string): Promise<Aggregator> {
    return this.transition(id, AggregatorStatus.ACTIVE, actor, 'AGGREGATOR_ACTIVATED');
  }

  async suspend(id: string, actor: string, reason?: string): Promise<Aggregator> {
    return this.transition(id, AggregatorStatus.SUSPENDED, actor, 'AGGREGATOR_SUSPENDED', reason);
  }

  async reactivate(id: string, actor: string): Promise<Aggregator> {
    return this.transition(id, AggregatorStatus.ACTIVE, actor, 'AGGREGATOR_REACTIVATED');
  }

  async terminate(id: string, actor: string, reason?: string): Promise<Aggregator> {
    return this.transition(id, AggregatorStatus.TERMINATED, actor, 'AGGREGATOR_TERMINATED', reason);
  }

  async assertCanOperate(id: string): Promise<Aggregator> {
    const agg = await this.getById(id);
    if (agg.status !== AggregatorStatus.ACTIVE) {
      throw new ConflictException(`Aggregator ${id} is ${agg.status} and cannot perform restricted operation`);
    }
    return agg;
  }

  private async transition(
    id: string,
    target: AggregatorStatus,
    actor: string,
    action: string,
    reason?: string,
  ): Promise<Aggregator> {
    this.assertUuid(id, 'id');
    const normalizedActor = this.normalizeActor(actor);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Aggregator);
      const agg = await repo.findOne({ where: { id } });
      if (!agg || agg.deletedAt !== null) throw new NotFoundException(`Aggregator ${id} not found`);
      // Validate status enum
      if (!Object.values(AggregatorStatus).includes(target as AggregatorStatus)) {
        throw new BadRequestException(`Invalid status ${target}`);
      }
      const allowed = ALLOWED_AGGREGATOR_TRANSITIONS[agg.status as AggregatorStatus] ?? [];
      if (!allowed.includes(target)) {
        throw new ConflictException(`Transition ${agg.status} → ${target} is not allowed`);
      }
      if (agg.status === AggregatorStatus.TERMINATED) {
        throw new ConflictException('TERMINATED Aggregators cannot be transitioned');
      }
      const previous = this.toValues(agg);
      agg.status = target;
      agg.updatedBy = normalizedActor;
      const saved = await repo.save(agg);
      await this.auditService.record(manager, {
        entityType: 'AGGREGATOR',
        entityId: saved.id,
        action,
        actor: normalizedActor,
        previousValues: previous,
        newValues: { ...this.toValues(saved), reason: reason ?? null },
      });
      return saved;
    });
  }

  private toValues(agg: Aggregator): Record<string, unknown> {
    return {
      id: agg.id,
      reference: agg.reference,
      code: agg.code,
      corporateName: agg.corporateName,
      displayName: agg.displayName,
      contactEmail: agg.contactEmail,
      contactPhone: agg.contactPhone,
      status: agg.status,
      version: agg.version,
      createdBy: agg.createdBy,
      updatedBy: agg.updatedBy,
    };
  }

  private assertUuid(value: string, field: string): void {
    if (!value || !UUID_PATTERN.test(value)) throw new BadRequestException(`${field} must be a UUID`);
  }

  private normalizeActor(actor: string): string {
    const trimmed = actor?.trim();
    if (!trimmed) throw new BadRequestException('actor is required');
    if (trimmed.length > 160) throw new BadRequestException('actor too long');
    return trimmed;
  }
}
