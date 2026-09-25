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
import { AgentClass } from './agent-class.entity';

export interface CreateAgentClassCommand {
  reference?: string;
  code?: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  requirements?: Record<string, unknown> | null;
  requiredInformation?: unknown | null;
  requiredDocumentCategories?: unknown | null;
  applicableServices?: unknown | null;
  applicableLimits?: unknown | null;
  actor: string;
}

export interface UpdateAgentClassCommand {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  requirements?: Record<string, unknown> | null;
  requiredInformation?: unknown | null;
  requiredDocumentCategories?: unknown | null;
  applicableServices?: unknown | null;
  applicableLimits?: unknown | null;
  actor: string;
  expectedVersion?: number;
}

@Injectable()
export class AgentClassService {
  constructor(
    @InjectRepository(AgentClass)
    private readonly classRepository: Repository<AgentClass>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async create(command: CreateAgentClassCommand): Promise<AgentClass> {
    const actor = this.normalizeActor(command.actor);
    const name = this.normalizeText(command.name, 'name', 160);
    const reference = this.normalizeReference(
      command.reference ?? `AGENT-CLASS-${randomUUID().slice(0, 8).toUpperCase()}`,
      'reference',
    );
    const code = this.normalizeReference(
      command.code ?? reference,
      'code',
    );
    const description = this.normalizeOptionalText(command.description ?? null, 'description', 500);
    const isActive = command.isActive ?? true;

    // Fail-closed: requirements/services/limits are configurable but have no business default.
    // If values are provided, they are stored as-is; if missing, they remain null and
    // downstream policy must treat missing limits as "no permission" rather than defaulting to an arbitrary limit.
    // Regulatory document sets, KYC thresholds, capital requirements, etc. are not hardcoded here.
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentClass);
      const existingRef = await repo.findOne({ where: { reference } });
      if (existingRef && existingRef.deletedAt === null) {
        throw new ConflictException(`AgentClass reference ${reference} already exists`);
      }
      const existingCode = await repo.findOne({ where: { code } });
      if (existingCode && existingCode.deletedAt === null) {
        throw new ConflictException(`AgentClass code ${code} already exists`);
      }
      const entity = await repo.save(
        repo.create({
          id: randomUUID(),
          reference,
          code,
          name,
          description,
          isActive,
          requirements: command.requirements ?? null,
          requiredInformation: command.requiredInformation ?? null,
          requiredDocumentCategories: command.requiredDocumentCategories ?? null,
          applicableServices: command.applicableServices ?? null,
          applicableLimits: command.applicableLimits ?? null,
          version: 1,
        }),
      );
      await this.audit(manager, 'AGENT_CLASS', entity.id, 'CREATED', actor, undefined, this.values(entity));
      return entity;
    });
  }

  async getById(id: string): Promise<AgentClass> {
    this.assertUuid(id, 'id');
    const entity = await this.classRepository.findOne({ where: { id } });
    if (!entity || entity.deletedAt !== null) throw new NotFoundException(`AgentClass ${id} not found`);
    return entity;
  }

  async getByReference(reference: string): Promise<AgentClass> {
    const ref = this.normalizeReference(reference, 'reference');
    const entity = await this.classRepository.findOne({ where: { reference: ref } });
    if (!entity || entity.deletedAt !== null) throw new NotFoundException(`AgentClass ${ref} not found`);
    return entity;
  }

  async list(): Promise<AgentClass[]> {
    return this.classRepository.find({ order: { createdAt: 'ASC' } });
  }

  async update(id: string, command: UpdateAgentClassCommand): Promise<AgentClass> {
    this.assertUuid(id, 'id');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentClass);
      const entity = await repo.findOne({ where: { id } });
      if (!entity || entity.deletedAt !== null) throw new NotFoundException(`AgentClass ${id} not found`);
      if (command.expectedVersion !== undefined && command.expectedVersion !== entity.version) {
        throw new ConflictException('AgentClass version is stale');
      }
      const previous = this.values(entity);
      if (command.name !== undefined) entity.name = this.normalizeText(command.name, 'name', 160);
      if (command.description !== undefined) entity.description = this.normalizeOptionalText(command.description, 'description', 500);
      if (command.isActive !== undefined) entity.isActive = command.isActive;
      if (command.requirements !== undefined) entity.requirements = command.requirements;
      if (command.requiredInformation !== undefined) entity.requiredInformation = command.requiredInformation;
      if (command.requiredDocumentCategories !== undefined) entity.requiredDocumentCategories = command.requiredDocumentCategories;
      if (command.applicableServices !== undefined) entity.applicableServices = command.applicableServices;
      if (command.applicableLimits !== undefined) entity.applicableLimits = command.applicableLimits;
      const saved = await repo.save(entity);
      await this.audit(manager, 'AGENT_CLASS', saved.id, 'UPDATED', actor, previous, this.values(saved));
      return saved;
    });
  }

  async deactivate(id: string, actor: string): Promise<AgentClass> {
    return this.update(id, { isActive: false, actor });
  }

  private values(entity: AgentClass): Record<string, unknown> {
    return {
      reference: entity.reference,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      isActive: entity.isActive,
      requirements: entity.requirements,
      requiredInformation: entity.requiredInformation,
      requiredDocumentCategories: entity.requiredDocumentCategories,
      applicableServices: entity.applicableServices,
      applicableLimits: entity.applicableLimits,
      version: entity.version,
    };
  }

  private async audit(
    manager: import('typeorm').EntityManager,
    entityType: string,
    entityId: string,
    action: string,
    actor: string,
    previous: Record<string, unknown> | undefined,
    next: Record<string, unknown> | undefined,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType,
      entityId,
      action,
      actor,
      previousValues: previous,
      newValues: next,
    });
  }

  private normalizeActor(actor: string): string {
    const v = actor?.trim();
    if (!v || v.length < 1 || v.length > 160) throw new BadRequestException('actor must be 1-160 chars');
    return v;
  }

  private normalizeText(value: string, field: string, max: number): string {
    const v = value?.trim();
    if (!v || v.length < 1 || v.length > max) throw new BadRequestException(`${field} must be 1-${max} chars`);
    return v;
  }

  private normalizeOptionalText(value: string | null | undefined, field: string, max: number): string | null {
    if (value === null || value === undefined) return null;
    const v = value.trim();
    if (v.length === 0) return null;
    if (v.length > max) throw new BadRequestException(`${field} must be at most ${max} chars`);
    return v;
  }

  private normalizeReference(value: string, field: string): string {
    const v = value.trim();
    if (!v || v.length < 1 || v.length > 80) throw new BadRequestException(`${field} must be 1-80 chars`);
    if (!/^[A-Za-z0-9._-]+$/.test(v)) throw new BadRequestException(`${field} must be alphanumeric with .-_`);
    return v;
  }

  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }
}
