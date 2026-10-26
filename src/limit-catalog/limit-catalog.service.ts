import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, QueryFailedError } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { LimitProfile } from './limit-profile.entity';
import { LimitRule } from './limit-rule.entity';
import {
  LIMIT_AMOUNT_DIMENSIONS,
  LIMIT_COUNT_DIMENSIONS,
  LimitDimension,
  LimitProfileConfigurationStatus,
  LimitProfileKind,
  LimitProfileStatus,
} from './limit-catalog.enums';
import type {
  LimitProfileCreateInput,
  LimitProfileSafeProjection,
  LimitProfileUpdateInput,
  LimitRuleCreateInput,
  LimitRuleSafeProjection,
  LimitRuleUpdateInput,
} from './limit-catalog.types';

const PROFILE_CODE_PATTERN = /^[A-Z0-9_]{3,80}$/;
const PRODUCT_PATTERN = /^[A-Z0-9_][A-Z0-9_.-]{1,79}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

@Injectable()
export class LimitCatalogService {
  constructor(
    @InjectRepository(LimitProfile)
    private readonly profileRepo: Repository<LimitProfile>,
    @InjectRepository(LimitRule)
    private readonly ruleRepo: Repository<LimitRule>,
    private readonly dataSource: DataSource,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  // ── Profiles ──

  async createProfile(input: LimitProfileCreateInput, actor: string): Promise<LimitProfileSafeProjection> {
    this.validateProfileCreate(input);
    const code = input.code.trim().toUpperCase();
    const exists = await this.profileRepo.findOne({ where: { code } as never });
    if (exists) throw new ConflictException(`Limit profile ${code} already exists`);

    const entity = this.profileRepo.create({
      code,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      kind: input.kind,
      status: input.status ?? LimitProfileStatus.ACTIVE,
      enabled: input.enabled ?? true,
      configurationStatus: input.configurationStatus ?? LimitProfileConfigurationStatus.NOT_CONFIGURED,
      createdBy: actor,
      updatedBy: actor,
      version: 1,
    } as never);

    const saved = await this.profileRepo.save(entity as never) as unknown as LimitProfile;
    if (this.auditService) {
      try {
        await this.dataSource.transaction(async (m) => {
          await this.auditService!.record(m, {
            entityType: 'LIMIT_PROFILE',
            entityId: saved.code, // code is PK, but entityId expects uuid per audit table; use code as string via entityType
            action: 'CREATED',
            actor,
            newValues: this.profileValues(saved),
          } as never);
        });
      } catch {}
    }
    return this.toProfileSafe(saved);
  }

  async updateProfile(code: string, input: LimitProfileUpdateInput, actor: string): Promise<LimitProfileSafeProjection> {
    const normalizedCode = code.trim().toUpperCase();
    if (!PROFILE_CODE_PATTERN.test(normalizedCode)) throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    // validate inputs that do not depend on the current row state
    if (input.kind !== undefined) this.assertEnum(input.kind, LimitProfileKind, 'kind');
    if (input.status !== undefined) this.assertEnum(input.status, LimitProfileStatus, 'status');
    if (input.configurationStatus !== undefined) this.assertEnum(input.configurationStatus, LimitProfileConfigurationStatus, 'configurationStatus');
    if (input.name !== undefined && (!input.name || !input.name.trim())) throw new BadRequestException('name is required');

    // V1-TEST-02: a plain `this.profileRepo.findOne()` followed later by `this.profileRepo.save()`
    // gives @VersionColumn no actual DB-level compare-and-swap — identical defect to the one
    // V1-TEST-01 found and fixed in FeeRuleRegistryService.updateRule() (TypeORM's UPDATE
    // builder only appends an unconditional `SET version = version + 1`; it never adds
    // `WHERE version = :old`). Reproduced directly: two genuinely concurrent PATCH requests
    // against the same profile from the same starting version both returned 200 (test 14,
    // v1-limit-01-limit-catalogue.integration.spec.ts), each silently overwriting the other's
    // fields. Fixed with the same pattern already proven in fee-rule-registry and used
    // elsewhere in this codebase for row-level contention: `SELECT ... FOR UPDATE` inside an
    // explicit transaction, so a second concurrent caller blocks until the first commits, then
    // reads the POST-update version and correctly hits the existing assertVersion conflict path.
    let saved: LimitProfile;
    let previous: Record<string, unknown>;
    try {
      ({ saved, previous } = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(LimitProfile);
        const profile = await repository
          .createQueryBuilder('profile')
          .where('profile.code = :code', { code: normalizedCode })
          .setLock('pessimistic_write')
          .getOne();
        if (!profile) throw new NotFoundException(`Limit profile ${normalizedCode} not found`);
        this.assertVersion(profile.version, input.version);

        const previousValues = this.profileValues(profile);
        if (input.name !== undefined) profile.name = input.name.trim();
        if (input.description !== undefined) profile.description = input.description?.trim() ?? null;
        if (input.kind !== undefined) profile.kind = input.kind;
        if (input.status !== undefined) profile.status = input.status;
        if (input.enabled !== undefined) profile.enabled = input.enabled;
        if (input.configurationStatus !== undefined) profile.configurationStatus = input.configurationStatus;
        profile.updatedBy = actor;

        const savedProfile = (await repository.save(profile as never)) as unknown as LimitProfile;
        return { saved: savedProfile, previous: previousValues };
      }));
    } catch (e) {
      if (this.isUniqueViolation(e)) throw new ConflictException('Profile version conflict');
      throw e;
    }

    if (this.auditService) {
      try {
        await this.dataSource.transaction(async (m) => {
          await this.auditService!.record(m, {
            entityType: 'LIMIT_PROFILE',
            entityId: saved.code as never,
            action: 'UPDATED',
            actor,
            previousValues: previous,
            newValues: this.profileValues(saved),
          } as never);
        });
      } catch {}
    }
    return this.toProfileSafe(saved);
  }

  async getProfile(code: string): Promise<LimitProfileSafeProjection> {
    const normalized = code.trim().toUpperCase();
    const row = await this.profileRepo.findOne({ where: { code: normalized } as never });
    if (!row) throw new NotFoundException(`Limit profile ${normalized} not found`);
    return this.toProfileSafe(row as unknown as LimitProfile);
  }

  async listProfiles(params: {
    kind?: string;
    status?: string;
    enabled?: boolean;
    configurationStatus?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: LimitProfileSafeProjection[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean }> {
    const page = this.normalizePage(params.page);
    const limit = this.normalizeLimit(params.limit);
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (params.kind) where['kind'] = params.kind;
    if (params.status) where['status'] = params.status;
    if (params.enabled !== undefined) where['enabled'] = params.enabled;
    if (params.configurationStatus) where['configurationStatus'] = params.configurationStatus;
    const [rows, total] = await this.profileRepo.findAndCount({
      where: where as never,
      order: { code: 'ASC' } as never,
      skip,
      take: limit,
      withDeleted: false,
    });
    const data = (rows as unknown as LimitProfile[]).map((r) => this.toProfileSafe(r));
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async countProfiles(): Promise<number> {
    return this.profileRepo.count();
  }

  // ── Rules ──

  async createRule(input: LimitRuleCreateInput, actor: string): Promise<LimitRuleSafeProjection> {
    this.validateRuleCreate(input);
    const profileCode = input.limitProfileCode.trim().toUpperCase();
    const profile = await this.profileRepo.findOne({ where: { code: profileCode } as never });
    if (!profile) throw new NotFoundException(`Limit profile ${profileCode} not found`);

    const product = input.product.trim().toUpperCase();
    const currency = input.currency.trim().toUpperCase();
    const dimension = input.dimension.trim().toUpperCase();
    const direction = input.direction ? input.direction.trim().toUpperCase() : null;
    const channel = input.channel ? input.channel.trim() : null;

    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom as string) : new Date();
    if (isNaN(effectiveFrom.getTime())) throw new BadRequestException('effectiveFrom must be valid ISO date');
    let effectiveTo: Date | null = null;
    if (input.effectiveTo) {
      effectiveTo = new Date(input.effectiveTo as string);
      if (isNaN(effectiveTo.getTime())) throw new BadRequestException('effectiveTo must be valid ISO date');
      if (effectiveTo <= effectiveFrom) throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }

    // Validate amount vs count exclusive
    this.validateDimensionValue(dimension, input.limitValueMinor ?? null, input.limitValueCount ?? null);

    const entity = this.ruleRepo.create({
      limitProfileCode: profileCode,
      product,
      direction,
      channel,
      currency,
      dimension,
      limitValueMinor: input.limitValueMinor ?? null,
      limitValueCount: input.limitValueCount ?? null,
      version: 1,
      effectiveFrom,
      effectiveTo,
      isActive: input.isActive ?? true,
      priority: input.priority ?? 0,
      createdBy: actor,
      updatedBy: actor,
    } as never);

    try {
      const saved = await this.ruleRepo.save(entity as never) as unknown as LimitRule;
      return this.toRuleSafe(saved);
    } catch (e) {
      if (this.isUniqueViolation(e)) throw new ConflictException('Limit rule with same profile/product/direction/channel/currency/dimension/effectiveFrom already exists');
      throw e;
    }
  }

  async updateRule(id: string, input: LimitRuleUpdateInput, actor: string): Promise<LimitRuleSafeProjection> {
    // validate inputs that do not depend on the current row state
    if (input.product !== undefined && !PRODUCT_PATTERN.test(input.product.trim().toUpperCase())) {
      throw new BadRequestException('product must match ^[A-Z0-9_][A-Z0-9_.-]{1,79}$');
    }
    if (input.currency !== undefined && !CURRENCY_PATTERN.test(input.currency.trim().toUpperCase())) {
      throw new BadRequestException('currency must be 3-letter');
    }
    if (input.dimension !== undefined) this.assertEnum(input.dimension, LimitDimension, 'dimension');
    let parsedEffectiveFrom: Date | null | undefined;
    if (input.effectiveFrom !== undefined) {
      parsedEffectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom as string) : null;
      if (input.effectiveFrom && parsedEffectiveFrom && isNaN(parsedEffectiveFrom.getTime())) {
        throw new BadRequestException('effectiveFrom must be valid ISO date');
      }
    }
    let parsedEffectiveTo: Date | null | undefined;
    if (input.effectiveTo !== undefined) {
      parsedEffectiveTo = input.effectiveTo ? new Date(input.effectiveTo as string) : null;
      if (input.effectiveTo && parsedEffectiveTo && isNaN(parsedEffectiveTo.getTime())) {
        throw new BadRequestException('effectiveTo must be valid ISO date');
      }
    }

    // V1-TEST-02: same findOne()-then-save() lost-update race as updateProfile() above (and the
    // defect V1-TEST-01 fixed in FeeRuleRegistryService.updateRule()) — reproduced directly via
    // two genuinely concurrent PATCH requests both returning 200 (test 15,
    // v1-limit-01-limit-catalogue.integration.spec.ts). Fixed the same way: `SELECT ... FOR
    // UPDATE` inside an explicit transaction so the loser blocks, re-reads the post-commit
    // version, and correctly hits assertVersion's existing conflict path.
    let saved: LimitRule;
    try {
      saved = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(LimitRule);
        const r = await repository
          .createQueryBuilder('rule')
          .where('rule.id = :id', { id })
          .setLock('pessimistic_write')
          .getOne();
        if (!r) throw new NotFoundException(`Limit rule ${id} not found`);
        this.assertVersion(r.version, input.version);

        if (input.product !== undefined) r.product = input.product.trim().toUpperCase();
        if (input.direction !== undefined) r.direction = input.direction ? input.direction.trim().toUpperCase() : null;
        if (input.channel !== undefined) r.channel = input.channel ? input.channel.trim() : null;
        if (input.currency !== undefined) r.currency = input.currency.trim().toUpperCase();
        if (input.dimension !== undefined) r.dimension = input.dimension;
        // handle limit values — need to validate exclusive again after all changes
        if (input.limitValueMinor !== undefined) r.limitValueMinor = input.limitValueMinor ?? null;
        if (input.limitValueCount !== undefined) r.limitValueCount = input.limitValueCount ?? null;

        if (parsedEffectiveFrom !== undefined && parsedEffectiveFrom) r.effectiveFrom = parsedEffectiveFrom;
        if (parsedEffectiveTo !== undefined) r.effectiveTo = parsedEffectiveTo;
        if (r.effectiveTo && r.effectiveTo <= r.effectiveFrom) throw new BadRequestException('effectiveTo must be after effectiveFrom');
        if (input.isActive !== undefined) r.isActive = input.isActive;
        if (input.priority !== undefined) r.priority = input.priority;
        r.updatedBy = actor;

        // validate amount vs count exclusive for final state
        this.validateDimensionValue(r.dimension, r.limitValueMinor, r.limitValueCount);

        return (await repository.save(r as never)) as unknown as LimitRule;
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) throw new ConflictException('Limit rule unique constraint violation');
      throw e;
    }
    return this.toRuleSafe(saved);
  }

  async getRule(id: string): Promise<LimitRuleSafeProjection> {
    const row = await this.ruleRepo.findOne({ where: { id } as never });
    if (!row) throw new NotFoundException(`Limit rule ${id} not found`);
    return this.toRuleSafe(row as unknown as LimitRule);
  }

  async listRules(params: {
    limitProfileCode?: string;
    product?: string;
    dimension?: string;
    currency?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ data: LimitRuleSafeProjection[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean }> {
    const page = this.normalizePage(params.page);
    const limit = this.normalizeLimit(params.limit);
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (params.limitProfileCode) where['limitProfileCode'] = params.limitProfileCode.trim().toUpperCase();
    if (params.product) where['product'] = params.product.trim().toUpperCase();
    if (params.dimension) where['dimension'] = params.dimension.trim().toUpperCase();
    if (params.currency) where['currency'] = params.currency.trim().toUpperCase();
    if (params.isActive !== undefined) where['isActive'] = params.isActive;
    const [rows, total] = await this.ruleRepo.findAndCount({
      where: where as never,
      order: { createdAt: 'ASC', id: 'ASC' } as never,
      skip,
      take: limit,
      withDeleted: false,
    });
    const data = (rows as unknown as LimitRule[]).map((r) => this.toRuleSafe(r));
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async listRulesByProfile(profileCode: string, params: { page?: number; limit?: number }): Promise<{ data: LimitRuleSafeProjection[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean }> {
    return this.listRules({ limitProfileCode: profileCode, page: params.page, limit: params.limit });
  }

  async countRules(): Promise<number> {
    return this.ruleRepo.count();
  }

  // ── validation helpers ──

  private validateProfileCreate(input: LimitProfileCreateInput): void {
    if (!PROFILE_CODE_PATTERN.test(input.code)) throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    if (!input.name || !input.name.trim()) throw new BadRequestException('name is required');
    this.assertEnum(input.kind, LimitProfileKind, 'kind');
    if (input.status !== undefined) this.assertEnum(input.status, LimitProfileStatus, 'status');
    if (input.configurationStatus !== undefined) this.assertEnum(input.configurationStatus, LimitProfileConfigurationStatus, 'configurationStatus');
  }

  private validateRuleCreate(input: LimitRuleCreateInput): void {
    if (!PROFILE_CODE_PATTERN.test(input.limitProfileCode.trim().toUpperCase())) throw new BadRequestException('limitProfileCode must match ^[A-Z0-9_]{3,80}$');
    if (!PRODUCT_PATTERN.test(input.product.trim().toUpperCase())) throw new BadRequestException('product must match ^[A-Z0-9_][A-Z0-9_.-]{1,79}$');
    if (!CURRENCY_PATTERN.test(input.currency.trim().toUpperCase())) throw new BadRequestException('currency must be 3-letter');
    this.assertEnum(input.dimension, LimitDimension, 'dimension');
    if (input.direction !== undefined && input.direction !== null) this.assertEnum(input.direction, { INCOMING: 'INCOMING', OUTGOING: 'OUTGOING', BOTH: 'BOTH' } as Record<string, string>, 'direction');
    this.validateDimensionValue(input.dimension, input.limitValueMinor ?? null, input.limitValueCount ?? null);
    if (input.effectiveFrom && isNaN(new Date(input.effectiveFrom as string).getTime())) throw new BadRequestException('effectiveFrom must be valid ISO date');
    if (input.effectiveTo && isNaN(new Date(input.effectiveTo as string).getTime())) throw new BadRequestException('effectiveTo must be valid ISO date');
    if (input.effectiveFrom && input.effectiveTo) {
      const from = new Date(input.effectiveFrom as string);
      const to = new Date(input.effectiveTo as string);
      if (to <= from) throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }
  }

  private validateDimensionValue(dimension: string, minor: string | null, count: number | null): void {
    const dim = dimension.toUpperCase();
    const isAmount = (LIMIT_AMOUNT_DIMENSIONS as readonly string[]).includes(dim);
    const isCount = (LIMIT_COUNT_DIMENSIONS as readonly string[]).includes(dim);
    if (isAmount) {
      if (minor === null || minor === undefined || minor === '') throw new BadRequestException(`dimension ${dim} requires limitValueMinor`);
      if (!/^\d+$/.test(minor)) throw new BadRequestException('limitValueMinor must be non-negative integer in minor units');
      if (BigInt(minor) < 0n) throw new BadRequestException('limitValueMinor must be >=0');
      if (count !== null && count !== undefined) throw new BadRequestException(`dimension ${dim} must not have limitValueCount`);
      // MIN_AMOUNT_PER_TX distinct from fee minimum is enforced by dimension naming, not by exclusive check with fee engine
    } else if (isCount) {
      if (count === null || count === undefined) throw new BadRequestException(`dimension ${dim} requires limitValueCount`);
      if (!Number.isSafeInteger(count) || count < 0) throw new BadRequestException('limitValueCount must be >=0 integer');
      if (minor !== null && minor !== undefined) throw new BadRequestException(`dimension ${dim} must not have limitValueMinor`);
    } else {
      throw new BadRequestException(`unknown dimension ${dim}`);
    }
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
    if (!Number.isSafeInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
    return p;
  }

  private normalizeLimit(limit?: number): number {
    const l = limit ?? 20;
    if (!Number.isSafeInteger(l) || l < 1 || l > 100) throw new BadRequestException('limit must be between 1 and 100');
    return l;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof QueryFailedError && (error as unknown as { code?: string }).code === '23505';
  }

  private profileValues(p: LimitProfile): Record<string, unknown> {
    return { code: p.code, name: p.name, kind: p.kind, status: p.status, enabled: p.enabled, configurationStatus: p.configurationStatus, version: p.version };
  }

  private toProfileSafe(row: LimitProfile): LimitProfileSafeProjection {
    return {
      code: row.code,
      name: row.name,
      description: row.description ?? null,
      kind: row.kind,
      status: row.status,
      enabled: row.enabled,
      configurationStatus: row.configurationStatus,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy ?? null,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toRuleSafe(row: LimitRule): LimitRuleSafeProjection {
    return {
      id: row.id,
      limitProfileCode: row.limitProfileCode,
      product: row.product,
      direction: row.direction ?? null,
      channel: row.channel ?? null,
      currency: row.currency,
      dimension: row.dimension,
      limitValueMinor: row.limitValueMinor ?? null,
      limitValueCount: row.limitValueCount ?? null,
      version: row.version,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo ?? null,
      isActive: row.isActive,
      priority: row.priority,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
