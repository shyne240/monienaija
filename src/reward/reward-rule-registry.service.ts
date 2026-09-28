import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';

import {
  REWARD_BENEFICIARY_TYPES,
  REWARD_CALCULATION_BASES,
  REWARD_CALCULATION_MODELS,
  REWARD_CUSTOMER_KYC_LEVELS,
  REWARD_GRANT_TYPES,
  RewardRuleDefinition,
  type RewardBeneficiaryType,
  type RewardCalculationBasis,
  type RewardCalculationModel,
  type RewardCustomerKycLevel,
  type RewardGrantType,
  type RewardTier,
} from './reward-rule.entity';
import { RewardCalculator } from './reward.calculator';

/**
 * V1-REWARD-01 — Reward Rule registry service (schema + administration).
 *
 * SCHEMA FOUNDATION ONLY:
 *  - This service never calculates, credits, resolves (for flows) or posts anything. It
 *    manages reward rule DEFINITIONS for the resolver.
 *  - ZERO production rules exist: nothing is seeded; rates/bases/beneficiaries/
 *    eligibility/precedence/campaigns are product/accounting decisions and stay
 *    unconfigured until explicitly decided.
 *  - No wiring into any financial flow; V1 stays reward-free (reward = NONE).
 *
 * Identity & versioning (mirrors V1-COMMISSION-01 commission discipline):
 *  - Identity = (product_code, currency, beneficiary_type, customer?,
 *    customer_kyc_level?, agent_class?, agent?, campaign_code?, effective_from);
 *    unique among live rows. Identity fields cannot change on update — a different
 *    identity is a different rule.
 *  - Updates are version-checked (deterministic conditional UPDATE on version) and
 *    audited with previous/new values; deactivation (isActive=false) or ending
 *    (effectiveTo) replaces DELETE entirely.
 */

export interface RewardRuleCreateInput {
  productCode: string;
  currency?: string;
  beneficiaryType: RewardBeneficiaryType;
  rewardType: RewardGrantType;
  calculationModel: RewardCalculationModel;
  calculationBasis: RewardCalculationBasis;
  flatRewardMinor?: string | number | null;
  percentageBps?: number | null;
  minimumRewardMinor?: string | number | null;
  maximumRewardMinor?: string | number | null;
  tiers?: RewardTier[] | null;
  customerId?: string | null;
  customerKycLevel?: RewardCustomerKycLevel | null;
  agentClassId?: string | null;
  agentId?: string | null;
  campaignCode?: string | null;
  effectiveFrom?: string | Date;
  effectiveTo?: string | Date | null;
  priority?: number;
  isActive?: boolean;
}

export interface RewardRuleUpdateInput {
  calculationBasis?: RewardCalculationBasis;
  flatRewardMinor?: string | number | null;
  percentageBps?: number | null;
  minimumRewardMinor?: string | number | null;
  maximumRewardMinor?: string | number | null;
  tiers?: RewardTier[] | null;
  effectiveTo?: string | Date | null;
  priority?: number;
  isActive?: boolean;
  version: number;
}

export interface RewardRuleSafeProjection {
  id: string;
  productCode: string;
  currency: string;
  beneficiaryType: RewardBeneficiaryType;
  rewardType: RewardGrantType;
  calculationModel: RewardCalculationModel;
  calculationBasis: RewardCalculationBasis;
  flatRewardMinor: string | null;
  percentageBps: number | null;
  minimumRewardMinor: string | null;
  maximumRewardMinor: string | null;
  tiers: RewardTier[] | null;
  customerId: string | null;
  customerKycLevel: RewardCustomerKycLevel | null;
  agentClassId: string | null;
  agentId: string | null;
  campaignCode: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  priority: number;
  isActive: boolean;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const MAX_BPS = 10000; // BASIS_POINTS convention — 10000 bps = 100%
const MAX_MINOR_UNITS = 9223372036854775807n; // PostgreSQL BIGINT ceiling
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPAIGN_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,79}$/;

@Injectable()
export class RewardRuleRegistryService {
  constructor(
    @InjectRepository(RewardRuleDefinition) private readonly repo: Repository<RewardRuleDefinition>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly calculator: RewardCalculator,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async createRule(input: RewardRuleCreateInput, actor: string): Promise<RewardRuleSafeProjection> {
    const productCode = this.normalizeProductCode(input.productCode);
    await this.assertProductExists(productCode);
    const currency = this.normalizeCurrency(input.currency ?? 'NGN');
    const beneficiaryType = this.normalizeEnum(input.beneficiaryType, REWARD_BENEFICIARY_TYPES, 'beneficiaryType');
    const rewardType = this.normalizeEnum(input.rewardType, REWARD_GRANT_TYPES, 'rewardType');
    const calculationModel = this.normalizeEnum(input.calculationModel, REWARD_CALCULATION_MODELS, 'calculationModel');
    const calculationBasis = this.normalizeEnum(input.calculationBasis, REWARD_CALCULATION_BASES, 'calculationBasis');

    const flatRewardMinor = this.parseOptionalMinor(input.flatRewardMinor, 'flatRewardMinor');
    const percentageBps = this.parseOptionalBps(input.percentageBps, 'percentageBps');
    const minimumRewardMinor = this.parseOptionalMinor(input.minimumRewardMinor, 'minimumRewardMinor');
    const maximumRewardMinor = this.parseOptionalMinor(input.maximumRewardMinor, 'maximumRewardMinor');
    const tiers = this.normalizeTiers(calculationModel, input.tiers ?? null);

    this.assertModelParamCoherence(calculationModel, {
      flatRewardMinor,
      percentageBps,
      minimumRewardMinor,
      maximumRewardMinor,
      tiers,
    });

    const targeting = this.normalizeTargeting({
      customerId: input.customerId,
      customerKycLevel: input.customerKycLevel,
      agentClassId: input.agentClassId,
      agentId: input.agentId,
      campaignCode: input.campaignCode,
    });
    if (targeting.customerId) await this.assertExists('customers', targeting.customerId, 'Customer');
    if (targeting.agentClassId) await this.assertExists('agent_classes', targeting.agentClassId, 'AgentClass');
    if (targeting.agentId) await this.assertExists('agents', targeting.agentId, 'Agent');

    const effectiveFrom = this.parseDate(input.effectiveFrom ?? new Date(), 'effectiveFrom');
    const effectiveTo = input.effectiveTo === undefined || input.effectiveTo === null ? null : this.parseDate(input.effectiveTo, 'effectiveTo');
    if (effectiveTo !== null && effectiveTo.getTime() <= effectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }
    const priority = this.parsePriority(input.priority);
    const isActive = input.isActive === undefined ? true : this.parseBoolean(input.isActive, 'isActive');

    const entity = this.repo.create({
      productCode,
      currency,
      beneficiaryType,
      rewardType,
      calculationModel,
      calculationBasis,
      flatRewardMinor,
      percentageBps,
      minimumRewardMinor,
      maximumRewardMinor,
      tiers,
      ...targeting,
      effectiveFrom,
      effectiveTo,
      priority,
      isActive,
      createdBy: actor,
      updatedBy: actor,
      version: 1,
    } as never);

    let saved: RewardRuleDefinition;
    try {
      saved = (await this.repo.save(entity as never)) as unknown as RewardRuleDefinition;
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException(
          `A reward rule for ${productCode}/${currency}/${beneficiaryType} with this targeting effective ${effectiveFrom.toISOString()} already exists`,
        );
      }
      if (this.isCheckViolation(e)) {
        throw new BadRequestException(`reward rule violates schema coherence constraints: ${(e as Error).message}`);
      }
      throw e;
    }
    await this.audit(saved.id, 'CREATED', actor, undefined, this.ruleValues(saved));
    return this.toSafe(saved);
  }

  async updateRule(id: string, input: RewardRuleUpdateInput, actor: string): Promise<RewardRuleSafeProjection> {
    const ruleId = this.normalizeId(id);
    const rule = await this.repo.findOne({ where: { id: ruleId } as never });
    if (!rule) throw new NotFoundException(`Reward rule ${ruleId} not found`);
    this.assertVersion(rule.version, input.version);

    const previous = this.ruleValues(rule);
    if (input.calculationBasis !== undefined) rule.calculationBasis = this.normalizeEnum(input.calculationBasis, REWARD_CALCULATION_BASES, 'calculationBasis');
    if (input.flatRewardMinor !== undefined) rule.flatRewardMinor = this.parseOptionalMinor(input.flatRewardMinor, 'flatRewardMinor');
    if (input.percentageBps !== undefined) rule.percentageBps = this.parseOptionalBps(input.percentageBps, 'percentageBps');
    if (input.minimumRewardMinor !== undefined) rule.minimumRewardMinor = this.parseOptionalMinor(input.minimumRewardMinor, 'minimumRewardMinor');
    if (input.maximumRewardMinor !== undefined) rule.maximumRewardMinor = this.parseOptionalMinor(input.maximumRewardMinor, 'maximumRewardMinor');
    if (input.tiers !== undefined) rule.tiers = this.normalizeTiers(rule.calculationModel, input.tiers);
    if (rule.minimumRewardMinor !== null && rule.maximumRewardMinor !== null && BigInt(rule.minimumRewardMinor) > BigInt(rule.maximumRewardMinor)) {
      throw new BadRequestException('minimumRewardMinor cannot exceed maximumRewardMinor');
    }
    this.assertModelParamCoherence(rule.calculationModel, {
      flatRewardMinor: rule.flatRewardMinor,
      percentageBps: rule.percentageBps,
      minimumRewardMinor: rule.minimumRewardMinor,
      maximumRewardMinor: rule.maximumRewardMinor,
      tiers: rule.tiers,
    });
    if (input.effectiveTo !== undefined) {
      const effectiveTo = input.effectiveTo === null ? null : this.parseDate(input.effectiveTo, 'effectiveTo');
      if (effectiveTo !== null && effectiveTo.getTime() <= rule.effectiveFrom.getTime()) {
        throw new BadRequestException('effectiveTo must be after effectiveFrom');
      }
      rule.effectiveTo = effectiveTo;
    }
    if (input.priority !== undefined) rule.priority = this.parsePriority(input.priority);
    if (input.isActive !== undefined) rule.isActive = this.parseBoolean(input.isActive, 'isActive');
    rule.updatedBy = actor;

    try {
      // Deterministic optimistic concurrency (same discipline proven in V1-COMMISSION-01
      // §11): the UPDATE itself carries  WHERE id = … AND version = <caller version>  so a
      // concurrent winner makes it affect 0 rows → 409. Version/updated_at are set
      // explicitly because repository.update() bypasses TypeORM's column hooks; the whole
      // state's write set is enumerated so nothing silently reverts.
      const result = await this.repo.update(
        { id: ruleId, version: input.version } as never,
        {
          calculationBasis: rule.calculationBasis,
          flatRewardMinor: rule.flatRewardMinor,
          percentageBps: rule.percentageBps,
          minimumRewardMinor: rule.minimumRewardMinor,
          maximumRewardMinor: rule.maximumRewardMinor,
          tiers: rule.tiers,
          effectiveTo: rule.effectiveTo,
          priority: rule.priority,
          isActive: rule.isActive,
          updatedBy: actor,
          version: input.version + 1,
          updatedAt: new Date(),
        } as never,
      );
      if (result.affected !== 1) throw new ConflictException('Reward rule version conflict — stale version');
      const saved = await this.repo.findOne({ where: { id: ruleId } as never });
      if (!saved) throw new NotFoundException(`Reward rule ${ruleId} not found`);
      await this.audit(saved.id, 'UPDATED', actor, previous, this.ruleValues(saved));
      return this.toSafe(saved);
    } catch (e) {
      if (this.isVersionConflict(e) || this.isUniqueViolation(e)) {
        throw new ConflictException('Reward rule version conflict — stale version');
      }
      if (this.isCheckViolation(e)) {
        throw new BadRequestException(`reward rule violates schema coherence constraints: ${(e as Error).message}`);
      }
      throw e;
    }
  }

  async getRule(id: string): Promise<RewardRuleSafeProjection> {
    const ruleId = this.normalizeId(id);
    const rule = await this.repo.findOne({ where: { id: ruleId } as never });
    if (!rule) throw new NotFoundException(`Reward rule ${ruleId} not found`);
    return this.toSafe(rule);
  }

  async listRules(params: {
    productCode?: string;
    currency?: string;
    beneficiaryType?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ data: RewardRuleSafeProjection[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean }> {
    const page = this.normalizePage(params.page);
    const limit = this.normalizeLimit(params.limit);
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (params.productCode) where['productCode'] = this.normalizeProductCode(params.productCode);
    if (params.currency) where['currency'] = this.normalizeCurrency(params.currency);
    if (params.beneficiaryType) where['beneficiaryType'] = this.normalizeEnum(params.beneficiaryType, REWARD_BENEFICIARY_TYPES, 'beneficiaryType');
    if (params.isActive !== undefined) where['isActive'] = params.isActive;
    const [rows, total] = await this.repo.findAndCount({
      where: where as never,
      order: { productCode: 'ASC', effectiveFrom: 'ASC', id: 'ASC' } as never,
      skip,
      take: limit,
      withDeleted: false,
    });
    const data = (rows as unknown as RewardRuleDefinition[]).map((r) => this.toSafe(r));
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async countRules(): Promise<number> {
    return this.repo.count();
  }

  // ── internals ──

  /** Validate model⇆parameter coherence up-front (the DB CHECK is the final authority). */
  private assertModelParamCoherence(
    model: RewardCalculationModel,
    p: {
      flatRewardMinor: string | null;
      percentageBps: number | null;
      minimumRewardMinor: string | null;
      maximumRewardMinor: string | null;
      tiers: RewardTier[] | null;
    },
  ): void {
    const req = (ok: boolean, msg: string): void => {
      if (!ok) throw new BadRequestException(msg);
    };
    switch (model) {
      case 'FIXED':
        req(p.flatRewardMinor !== null && p.percentageBps === null && p.minimumRewardMinor === null && p.maximumRewardMinor === null && p.tiers === null,
          'FIXED requires flatRewardMinor only (use 0 for explicit ZERO)');
        break;
      case 'PERCENTAGE':
        req(p.percentageBps !== null && p.flatRewardMinor === null && p.minimumRewardMinor === null && p.maximumRewardMinor === null && p.tiers === null,
          'PERCENTAGE requires percentageBps only');
        break;
      case 'PERCENTAGE_MIN':
        req(p.percentageBps !== null && p.minimumRewardMinor !== null && p.flatRewardMinor === null && p.maximumRewardMinor === null && p.tiers === null,
          'PERCENTAGE_MIN requires percentageBps + minimumRewardMinor only');
        break;
      case 'PERCENTAGE_MAX':
        req(p.percentageBps !== null && p.maximumRewardMinor !== null && p.flatRewardMinor === null && p.minimumRewardMinor === null && p.tiers === null,
          'PERCENTAGE_MAX requires percentageBps + maximumRewardMinor only — the per-transaction cap mechanism');
        break;
      case 'PERCENTAGE_MIN_MAX':
        req(p.percentageBps !== null && p.minimumRewardMinor !== null && p.maximumRewardMinor !== null && p.flatRewardMinor === null && p.tiers === null,
          'PERCENTAGE_MIN_MAX requires percentageBps + minimumRewardMinor + maximumRewardMinor only');
        break;
      case 'FLAT_PLUS_PERCENTAGE':
        req(p.flatRewardMinor !== null && p.percentageBps !== null && p.minimumRewardMinor === null && p.maximumRewardMinor === null && p.tiers === null,
          'FLAT_PLUS_PERCENTAGE requires flatRewardMinor + percentageBps only');
        break;
      case 'TIERED':
        req(p.tiers !== null && p.tiers.length > 0 && p.flatRewardMinor === null && p.percentageBps === null && p.minimumRewardMinor === null && p.maximumRewardMinor === null,
          'TIERED requires a non-empty tiers array only');
        break;
    }
  }

  /** Structural tier validation: the calculator's fail-closed checker is the authority. */
  private normalizeTiers(model: RewardCalculationModel, tiers: RewardTier[] | null): RewardTier[] | null {
    if (tiers === null) return null;
    if (!Array.isArray(tiers)) throw new BadRequestException('tiers must be an array of marginal brackets');
    const normalized = tiers.map((tier, index): RewardTier => {
      if (tier === null || typeof tier !== 'object') throw new BadRequestException(`tiers[${index}] must be an object`);
      const upToMinor = tier.upToMinor === undefined || tier.upToMinor === null ? null : this.parseRequiredMinor(tier.upToMinor, `tiers[${index}].upToMinor`);
      const flatMinor = tier.flatMinor === undefined || tier.flatMinor === null ? null : this.parseRequiredMinor(tier.flatMinor, `tiers[${index}].flatMinor`);
      const bps = tier.bps === undefined || tier.bps === null ? null : this.parseOptionalBps(tier.bps, `tiers[${index}].bps`);
      if (flatMinor === null && bps === null) throw new BadRequestException(`tiers[${index}] requires bps and/or flatMinor`);
      return { upToMinor, bps, flatMinor };
    });
    // Reuse the calculator's authoritative fail-closed structural validation with a base
    // that enters every bracket (MAX safe) so adjacency is verified.
    this.calculator.calculateTiered(MAX_MINOR_UNITS, normalized);
    return normalized;
  }

  private normalizeTargeting(input: {
    customerId?: string | null;
    customerKycLevel?: RewardCustomerKycLevel | null;
    agentClassId?: string | null;
    agentId?: string | null;
    campaignCode?: string | null;
  }): {
    customerId: string | null;
    customerKycLevel: RewardCustomerKycLevel | null;
    agentClassId: string | null;
    agentId: string | null;
    campaignCode: string | null;
  } {
    const cleanUuid = (value: string | null | undefined, field: string): string | null => {
      if (value === null || value === undefined) return null;
      if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw new BadRequestException(`${field} must be a UUID`);
      return value.trim().toLowerCase();
    };
    let kycLevel: RewardCustomerKycLevel | null = null;
    if (input.customerKycLevel !== null && input.customerKycLevel !== undefined) {
      if (!REWARD_CUSTOMER_KYC_LEVELS.includes(input.customerKycLevel)) {
        throw new BadRequestException(`customerKycLevel must be one of: ${REWARD_CUSTOMER_KYC_LEVELS.join(', ')} (the existing CustomerKycLevel vocabulary)`);
      }
      kycLevel = input.customerKycLevel;
    }
    let campaignCode: string | null = null;
    if (input.campaignCode !== null && input.campaignCode !== undefined) {
      const trimmed = String(input.campaignCode).trim().toUpperCase();
      if (!CAMPAIGN_CODE_PATTERN.test(trimmed)) {
        throw new BadRequestException('campaignCode must match ^[A-Z0-9][A-Z0-9_\\-]{0,79}$ (configuration-only promotion identity; no campaign registry exists)');
      }
      campaignCode = trimmed;
    }
    const targeting = {
      customerId: cleanUuid(input.customerId ?? null, 'customerId'),
      customerKycLevel: kycLevel,
      agentClassId: cleanUuid(input.agentClassId ?? null, 'agentClassId'),
      agentId: cleanUuid(input.agentId ?? null, 'agentId'),
      campaignCode,
    };
    const count =
      Number(targeting.customerId !== null) +
      Number(targeting.customerKycLevel !== null) +
      Number(targeting.agentClassId !== null) +
      Number(targeting.agentId !== null) +
      Number(targeting.campaignCode !== null);
    if (count > 1) throw new BadRequestException('targeting is single-dimensional: set at most one of customerId/customerKycLevel/agentClassId/agentId/campaignCode');
    return targeting;
  }

  private async assertProductExists(productCode: string): Promise<void> {
    const rows: Array<{ code: string }> = await this.dataSource.query(`SELECT code FROM products WHERE code = $1 AND deleted_at IS NULL`, [productCode]);
    if (rows.length === 0) throw new NotFoundException(`Product ${productCode} does not exist in the product catalogue`);
  }

  private async assertExists(table: 'customers' | 'agent_classes' | 'agents', id: string, label: string): Promise<void> {
    const rows: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (rows.length === 0) throw new NotFoundException(`${label} ${id} does not exist`);
  }

  private normalizeId(id: unknown): string {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id.trim())) throw new BadRequestException('id must be a UUID');
    return id.trim().toLowerCase();
  }

  private normalizeProductCode(code: unknown): string {
    if (typeof code !== 'string' || !code.trim()) throw new BadRequestException('productCode is required');
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{3,80}$/.test(normalized)) throw new BadRequestException('productCode must match ^[A-Z0-9_]{3,80}$');
    return normalized;
  }

  private normalizeCurrency(currency: unknown): string {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency.trim().toUpperCase())) {
      throw new BadRequestException('currency must be a 3-letter uppercase ISO code');
    }
    return currency.trim().toUpperCase();
  }

  private normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      throw new BadRequestException(`${field} must be one of: ${allowed.join(', ')}`);
    }
    return value as T;
  }

  private parseRequiredMinor(value: unknown, field: string): string {
    const parsed = this.parseOptionalMinor(value, field);
    if (parsed === null) throw new BadRequestException(`${field} is required`);
    return parsed;
  }

  private parseOptionalMinor(value: unknown, field: string): string | null {
    if (value === undefined || value === null) return null;
    let big: bigint;
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw new BadRequestException(`${field} must be an integer`);
      big = BigInt(value);
    } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      big = BigInt(value.trim());
    } else {
      throw new BadRequestException(`${field} must be a non-negative integer in minor units`);
    }
    if (big < 0n) throw new BadRequestException(`${field} cannot be negative`);
    if (big > MAX_MINOR_UNITS) throw new BadRequestException(`${field} must fit in a PostgreSQL BIGINT`);
    return big.toString();
  }

  private parseOptionalBps(value: unknown, field: string): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new BadRequestException(`${field} must be an integer number of basis points`);
    }
    if (value < 0) throw new BadRequestException(`${field} cannot be negative`);
    if (value > MAX_BPS) throw new BadRequestException(`${field} cannot exceed ${MAX_BPS} basis points (100%)`);
    return value;
  }

  private parsePriority(value: unknown): number {
    if (value === undefined) return 0;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1000000) {
      throw new BadRequestException('priority must be an integer between 0 and 1000000');
    }
    return value;
  }

  private parseBoolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') throw new BadRequestException(`${field} must be a boolean`);
    return value;
  }

  private parseDate(value: unknown, field: string): Date {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
    return date;
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

  private isCheckViolation(error: unknown): boolean {
    return error instanceof QueryFailedError && (error as unknown as { code?: string }).code === '23514';
  }

  private isVersionConflict(error: unknown): boolean {
    return (error as { name?: string } | null)?.name === 'OptimisticLockVersionMismatchError';
  }

  private async audit(
    entityId: string,
    action: 'CREATED' | 'UPDATED',
    actor: string,
    previousValues: Record<string, unknown> | undefined,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditService) return;
    try {
      await this.dataSource.transaction(async (manager: EntityManager) => {
        await this.auditService!.record(manager, {
          entityType: 'REWARD_RULE',
          entityId,
          action,
          actor,
          previousValues,
          newValues,
        } as never);
      });
    } catch {
      // best-effort audit, consistent with limit-catalog/product-catalog/commission convention
    }
  }

  private ruleValues(r: RewardRuleDefinition): Record<string, unknown> {
    return {
      id: r.id,
      productCode: r.productCode,
      currency: r.currency,
      beneficiaryType: r.beneficiaryType,
      rewardType: r.rewardType,
      calculationModel: r.calculationModel,
      calculationBasis: r.calculationBasis,
      flatRewardMinor: r.flatRewardMinor,
      percentageBps: r.percentageBps,
      minimumRewardMinor: r.minimumRewardMinor,
      maximumRewardMinor: r.maximumRewardMinor,
      tiers: r.tiers,
      customerId: r.customerId,
      customerKycLevel: r.customerKycLevel,
      agentClassId: r.agentClassId,
      agentId: r.agentId,
      campaignCode: r.campaignCode,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      priority: r.priority,
      isActive: r.isActive,
      version: r.version,
    };
  }

  private toSafe(r: RewardRuleDefinition): RewardRuleSafeProjection {
    return {
      id: r.id,
      productCode: r.productCode,
      currency: r.currency,
      beneficiaryType: r.beneficiaryType,
      rewardType: r.rewardType,
      calculationModel: r.calculationModel,
      calculationBasis: r.calculationBasis,
      flatRewardMinor: r.flatRewardMinor,
      percentageBps: r.percentageBps,
      minimumRewardMinor: r.minimumRewardMinor,
      maximumRewardMinor: r.maximumRewardMinor,
      tiers: r.tiers,
      customerId: r.customerId,
      customerKycLevel: r.customerKycLevel,
      agentClassId: r.agentClassId,
      agentId: r.agentId,
      campaignCode: r.campaignCode,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      priority: r.priority,
      isActive: r.isActive,
      createdBy: r.createdBy,
      updatedBy: r.updatedBy,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
