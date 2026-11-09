import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, QueryFailedError, Repository, type EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { LimitAssignment } from './limit-assignment.entity';
import { LimitProfile } from './limit-profile.entity';
import { LimitAssignmentSubjectType } from './limit-catalog.enums';
import type {
  LimitAssignmentCreateInput,
  LimitAssignmentSafeProjection,
  LimitAssignmentUpdateInput,
} from './limit-catalog.types';

const PROFILE_CODE_PATTERN = /^[A-Z0-9_]{3,80}$/;
const SEGMENT_PATTERN = /^[A-Z0-9_]{3,80}$/;

@Injectable()
export class LimitAssignmentService {
  constructor(
    @InjectRepository(LimitAssignment)
    private readonly assignmentRepo: Repository<LimitAssignment>,
    @InjectRepository(LimitProfile)
    private readonly profileRepo: Repository<LimitProfile>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createAssignment(
    input: LimitAssignmentCreateInput,
    actor: string,
  ): Promise<LimitAssignmentSafeProjection> {
    this.validateCreate(input);
    const limitProfileCode = input.limitProfileCode.trim().toUpperCase();
    const profile = await this.profileRepo.findOne({ where: { code: limitProfileCode } as never });
    if (!profile) throw new NotFoundException(`Limit profile ${limitProfileCode} not found`);

    const subjectType = input.subjectType.trim().toUpperCase();
    const subjectId = input.subjectId ? input.subjectId.trim() : null;
    const segmentCode = input.segmentCode ? input.segmentCode.trim().toUpperCase() : null;

    await this.validateSubjectExistence(subjectType, subjectId);
    this.validateSubjectConsistency(subjectType, subjectId, segmentCode);

    const effectiveFrom = input.effectiveFrom
      ? new Date(input.effectiveFrom as string)
      : new Date();
    if (isNaN(effectiveFrom.getTime()))
      throw new BadRequestException('effectiveFrom must be valid ISO date');
    let effectiveTo: Date | null = null;
    if (input.effectiveTo) {
      effectiveTo = new Date(input.effectiveTo as string);
      if (isNaN(effectiveTo.getTime()))
        throw new BadRequestException('effectiveTo must be valid ISO date');
      if (effectiveTo <= effectiveFrom)
        throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }

    const entity = this.assignmentRepo.create({
      limitProfileCode,
      subjectType,
      subjectId: subjectId ?? null,
      segmentCode: segmentCode ?? null,
      precedence: input.precedence ?? 0,
      effectiveFrom,
      effectiveTo,
      isActive: input.isActive ?? true,
      createdBy: actor,
      updatedBy: actor,
      version: 1,
    } as never) as unknown as LimitAssignment;

    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const persisted = await manager.getRepository(LimitAssignment).save(entity);
        await this.auditService.record(manager, {
          entityType: 'LIMIT_ASSIGNMENT',
          entityId: persisted.id,
          action: 'CREATED',
          actor,
          newValues: this.assignmentValues(persisted),
        });
        return persisted;
      });
      return this.toSafe(saved);
    } catch (e) {
      if (this.isUniqueViolation(e))
        throw new ConflictException(
          'Limit assignment with same subject/profile/effectiveFrom already exists',
        );
      throw e;
    }
  }

  async updateAssignment(
    id: string,
    input: LimitAssignmentUpdateInput,
    actor: string,
    access: { excludeAgent?: boolean; onlyAgent?: boolean } = {},
  ): Promise<LimitAssignmentSafeProjection> {
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(LimitAssignment);
        const where: Record<string, unknown> = { id };
        if (access.excludeAgent) where.subjectType = Not(LimitAssignmentSubjectType.AGENT);
        if (access.onlyAgent) where.subjectType = LimitAssignmentSubjectType.AGENT;
        const assignment = await repo.findOne({
          where: where as never,
          lock: { mode: 'pessimistic_write' },
        });
        // Keep the same response for an unknown ID and a filtered-out Agent assignment.
        if (!assignment) throw new NotFoundException('Limit assignment not found');
        const row = assignment as unknown as LimitAssignment;
        this.assertVersion(row.version, input.version);

        const previous = this.assignmentValues(row);

        if (input.limitProfileCode !== undefined) {
          const code = input.limitProfileCode.trim().toUpperCase();
          if (!PROFILE_CODE_PATTERN.test(code))
            throw new BadRequestException('limitProfileCode must match ^[A-Z0-9_]{3,80}$');
          const profile = await manager
            .getRepository(LimitProfile)
            .findOne({ where: { code } as never });
          if (!profile) throw new NotFoundException(`Limit profile ${code} not found`);
          row.limitProfileCode = code;
        }
        if (input.subjectType !== undefined) {
          this.assertEnum(input.subjectType, LimitAssignmentSubjectType, 'subjectType');
          const subjectType = input.subjectType.trim().toUpperCase() as LimitAssignmentSubjectType;
          if (
            (access.excludeAgent && subjectType === LimitAssignmentSubjectType.AGENT) ||
            (access.onlyAgent && subjectType !== LimitAssignmentSubjectType.AGENT)
          ) {
            throw new NotFoundException('Limit assignment not found');
          }
          row.subjectType = subjectType;
        }
        if (input.subjectId !== undefined) {
          row.subjectId = input.subjectId ? input.subjectId.trim() : null;
        }
        if (input.segmentCode !== undefined) {
          row.segmentCode = input.segmentCode ? input.segmentCode.trim().toUpperCase() : null;
        }
        // validate consistency after potential subject change
        this.validateSubjectConsistency(row.subjectType, row.subjectId, row.segmentCode);
        await this.validateSubjectExistence(row.subjectType, row.subjectId, manager);

        if (input.precedence !== undefined) {
          if (!Number.isSafeInteger(input.precedence))
            throw new BadRequestException('precedence must be integer');
          row.precedence = input.precedence;
        }
        if (input.effectiveFrom !== undefined) {
          const d = input.effectiveFrom ? new Date(input.effectiveFrom as string) : null;
          if (input.effectiveFrom && d && isNaN(d.getTime()))
            throw new BadRequestException('effectiveFrom must be valid ISO date');
          if (d) row.effectiveFrom = d;
        }
        if (input.effectiveTo !== undefined) {
          const d = input.effectiveTo ? new Date(input.effectiveTo as string) : null;
          if (input.effectiveTo && d && isNaN(d.getTime()))
            throw new BadRequestException('effectiveTo must be valid ISO date');
          row.effectiveTo = d;
        }
        if (row.effectiveTo && row.effectiveTo <= row.effectiveFrom)
          throw new BadRequestException('effectiveTo must be after effectiveFrom');
        if (input.isActive !== undefined) row.isActive = input.isActive;

        row.updatedBy = actor;
        // Consume the version even for an otherwise identical update. Under the row lock,
        // a concurrent request using the same version must observe this increment and fail.
        row.version += 1;

        const persisted = await repo.save(row);
        await this.auditService.record(manager, {
          entityType: 'LIMIT_ASSIGNMENT',
          entityId: persisted.id,
          action: 'UPDATED',
          actor,
          previousValues: previous,
          newValues: this.assignmentValues(persisted),
        });
        return persisted;
      });
      return this.toSafe(saved);
    } catch (e) {
      if (this.isUniqueViolation(e))
        throw new ConflictException('Limit assignment unique constraint violation');
      throw e;
    }
  }

  async getAssignment(id: string): Promise<LimitAssignmentSafeProjection> {
    const row = await this.assignmentRepo.findOne({ where: { id } as never });
    if (!row) throw new NotFoundException(`Limit assignment ${id} not found`);
    return this.toSafe(row as unknown as LimitAssignment);
  }

  async listAssignments(params: {
    subjectType?: string;
    subjectId?: string;
    segmentCode?: string;
    limitProfileCode?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    data: LimitAssignmentSafeProjection[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
  }> {
    const page = this.normalizePage(params.page);
    const limit = this.normalizeLimit(params.limit);
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (params.subjectType) where['subjectType'] = params.subjectType.trim().toUpperCase();
    if (params.subjectId) where['subjectId'] = params.subjectId.trim();
    if (params.segmentCode) where['segmentCode'] = params.segmentCode.trim().toUpperCase();
    if (params.limitProfileCode)
      where['limitProfileCode'] = params.limitProfileCode.trim().toUpperCase();
    if (params.isActive !== undefined) where['isActive'] = params.isActive;
    const [rows, total] = await this.assignmentRepo.findAndCount({
      where: where as never,
      order: { createdAt: 'ASC', id: 'ASC' } as never,
      skip,
      take: limit,
      withDeleted: false,
    });
    const data = (rows as unknown as LimitAssignment[]).map((r) => this.toSafe(r));
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async listByProfile(
    profileCode: string,
    params: { page?: number; limit?: number },
  ): Promise<{
    data: LimitAssignmentSafeProjection[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
  }> {
    return this.listAssignments({
      limitProfileCode: profileCode,
      page: params.page,
      limit: params.limit,
    });
  }

  async listByCustomer(
    customerId: string,
    params: { page?: number; limit?: number },
  ): Promise<{
    data: LimitAssignmentSafeProjection[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
  }> {
    return this.listAssignments({
      subjectType: 'CUSTOMER',
      subjectId: customerId,
      page: params.page,
      limit: params.limit,
    });
  }

  async listByAgent(
    agentId: string,
    params: { page?: number; limit?: number },
  ): Promise<{
    data: LimitAssignmentSafeProjection[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
  }> {
    return this.listAssignments({
      subjectType: 'AGENT',
      subjectId: agentId,
      page: params.page,
      limit: params.limit,
    });
  }

  async listByAgentClass(
    agentClassId: string,
    params: { page?: number; limit?: number },
  ): Promise<{
    data: LimitAssignmentSafeProjection[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
  }> {
    return this.listAssignments({
      subjectType: 'AGENT_CLASS',
      subjectId: agentClassId,
      page: params.page,
      limit: params.limit,
    });
  }

  async countAssignments(): Promise<number> {
    return this.assignmentRepo.count();
  }

  private validateCreate(input: LimitAssignmentCreateInput): void {
    if (!PROFILE_CODE_PATTERN.test(input.limitProfileCode.trim().toUpperCase()))
      throw new BadRequestException('limitProfileCode must match ^[A-Z0-9_]{3,80}$');
    this.assertEnum(input.subjectType, LimitAssignmentSubjectType, 'subjectType');
    if (input.subjectType.toUpperCase() === 'SEGMENT') {
      if (!input.segmentCode || !SEGMENT_PATTERN.test(input.segmentCode.trim().toUpperCase()))
        throw new BadRequestException('segmentCode must match ^[A-Z0-9_]{3,80}$ for SEGMENT');
      if (input.subjectId) throw new BadRequestException('subjectId must be null for SEGMENT');
    } else if (input.subjectType.toUpperCase() === 'GLOBAL') {
      if (input.subjectId) throw new BadRequestException('subjectId must be null for GLOBAL');
      if (input.segmentCode) throw new BadRequestException('segmentCode must be null for GLOBAL');
    } else {
      // CUSTOMER, AGENT, AGENT_CLASS require subjectId
      if (!input.subjectId)
        throw new BadRequestException(`subjectId is required for ${input.subjectType}`);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.subjectId.trim(),
        )
      )
        throw new BadRequestException('subjectId must be UUID');
      if (input.segmentCode)
        throw new BadRequestException('segmentCode must be null for non-SEGMENT');
    }
    if (input.precedence !== undefined && !Number.isSafeInteger(input.precedence))
      throw new BadRequestException('precedence must be integer');
    if (input.effectiveFrom && isNaN(new Date(input.effectiveFrom as string).getTime()))
      throw new BadRequestException('effectiveFrom must be valid ISO date');
    if (input.effectiveTo && isNaN(new Date(input.effectiveTo as string).getTime()))
      throw new BadRequestException('effectiveTo must be valid ISO date');
    if (input.effectiveFrom && input.effectiveTo) {
      const from = new Date(input.effectiveFrom as string);
      const to = new Date(input.effectiveTo as string);
      if (to <= from) throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }
  }

  private validateSubjectConsistency(
    subjectType: string,
    subjectId: string | null,
    segmentCode: string | null,
  ): void {
    const t = subjectType.trim().toUpperCase();
    if (['CUSTOMER', 'AGENT', 'AGENT_CLASS'].includes(t)) {
      if (!subjectId) throw new BadRequestException(`subjectId required for ${t}`);
      if (segmentCode) throw new BadRequestException(`segmentCode must be null for ${t}`);
    } else if (t === 'SEGMENT') {
      if (!segmentCode) throw new BadRequestException('segmentCode required for SEGMENT');
      if (subjectId) throw new BadRequestException('subjectId must be null for SEGMENT');
      if (!SEGMENT_PATTERN.test(segmentCode.trim().toUpperCase()))
        throw new BadRequestException('segmentCode must match ^[A-Z0-9_]{3,80}$');
    } else if (t === 'GLOBAL') {
      if (subjectId) throw new BadRequestException('subjectId must be null for GLOBAL');
      if (segmentCode) throw new BadRequestException('segmentCode must be null for GLOBAL');
    } else {
      throw new BadRequestException(`unknown subjectType ${t}`);
    }
  }

  private async validateSubjectExistence(
    subjectType: string,
    subjectId: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const query = manager
      ? manager.query.bind(manager)
      : this.dataSource.query.bind(this.dataSource);
    const t = subjectType.trim().toUpperCase();
    if (t === 'CUSTOMER' && subjectId) {
      const row: Array<{ id: string }> = await query(
        `SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [subjectId],
      );
      if (row.length === 0) throw new NotFoundException(`Customer ${subjectId} not found`);
    } else if (t === 'AGENT' && subjectId) {
      const row: Array<{ id: string }> = await query(
        `SELECT id FROM agents WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [subjectId],
      );
      if (row.length === 0) throw new NotFoundException(`Agent ${subjectId} not found`);
    } else if (t === 'AGENT_CLASS' && subjectId) {
      const row: Array<{ id: string }> = await query(
        `SELECT id FROM agent_classes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [subjectId],
      );
      if (row.length === 0) throw new NotFoundException(`Agent Class ${subjectId} not found`);
    }
    // SEGMENT and GLOBAL require no existence check beyond pattern
  }

  private assertEnum(value: string, enumObj: Record<string, string>, field: string): void {
    if (!Object.values(enumObj).includes(value as never)) {
      throw new BadRequestException(`${field} must be one of ${Object.values(enumObj).join(', ')}`);
    }
  }

  private assertVersion(current: number, incoming: number): void {
    if (incoming !== current) throw new ConflictException('Version conflict — stale version');
  }

  private normalizePage(page?: number): number {
    const p = page ?? 1;
    if (!Number.isSafeInteger(p) || p < 1)
      throw new BadRequestException('page must be a positive integer');
    return p;
  }

  private normalizeLimit(limit?: number): number {
    const l = limit ?? 20;
    if (!Number.isSafeInteger(l) || l < 1 || l > 100)
      throw new BadRequestException('limit must be between 1 and 100');
    return l;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as unknown as { code?: string; constraint?: string }).code === '23505' &&
      (error as unknown as { constraint?: string }).constraint === 'uq_limit_assignments_active_key'
    );
  }

  private assignmentValues(a: LimitAssignment): Record<string, unknown> {
    return {
      id: a.id,
      limitProfileCode: a.limitProfileCode,
      subjectType: a.subjectType,
      subjectId: a.subjectId,
      segmentCode: a.segmentCode,
      precedence: a.precedence,
      version: a.version,
      effectiveFrom: a.effectiveFrom,
      effectiveTo: a.effectiveTo,
      isActive: a.isActive,
    };
  }

  private toSafe(row: LimitAssignment): LimitAssignmentSafeProjection {
    return {
      id: row.id,
      limitProfileCode: row.limitProfileCode,
      subjectType: row.subjectType,
      subjectId: row.subjectId ?? null,
      segmentCode: row.segmentCode ?? null,
      precedence: row.precedence,
      version: row.version,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo ?? null,
      isActive: row.isActive,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
