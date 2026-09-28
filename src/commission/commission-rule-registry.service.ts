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
  COMMISSION_CALCULATION_BASES,
  COMMISSION_CALCULATION_MODELS,
  COMMISSION_RECIPIENT_TYPES,
  CommissionRuleDefinition,
  type CommissionCalculationBasis,
  type CommissionCalculationModel,
  type CommissionRecipientType,
  type CommissionTier,
} from './commission-rule.entity';
import { CommissionCalculator } from './commission.calculator';

/**
 * V1-COMMISSION-01 — Commission Rule registry service (schema + administration).
 *
 * SCHEMA FOUNDATION ONLY:
 *  - This service never calculates, charges, resolves or posts anything. It manages
 *    commission rule DEFINITIONS for the resolver.
 *  - ZERO production rules exist: nothing is seeded; rates/bases/recipients/precedence
 *    are product/accounting decisions and stay unconfigured until explicitly decided.
 *  - No wiring into any financial flow; V1 stays commission-free (commission = NONE).
 *
 * Identity & versioning (mirrors V1-COMMERCIAL-03 fee discipline):
 *  - Identity = (product_code, currency, recipient_type, agent_class?, agent?,
 *    aggregator?, effective_from); unique among live rows. Identity fields cannot change
 *    on update — a different identity is a different rule.
 *  - Updates are version-checked (@VersionColumn optimistic locking) and audited with
 *    previous/new values; deactivation (isActive=false) or ending (effectiveTo) replaces
 *    DELETE entirely.
 */

export interface CommissionRuleCreateInput {
  productCode: string;
  currency?: string;
  recipientType: CommissionRecipientType;
  calculationModel: CommissionCalculationModel;
  calculationBasis: CommissionCalculationBasis;
  flatCommissionMinor?: string | number | null;
  percentageBps?: number | null;
  minimumCommissionMinor?: string | number | null;
  maximumCommissionMinor?: string | number | null;
  tiers?: CommissionTier[] | null;
  agentClassId?: string | null;
  agentId?: string | null;
  aggregatorId?: string | null;
  effectiveFrom?: string | Date;
  effectiveTo?: string | Date | null;
  priority?: number;
  isActive?: boolean;
}

export interface CommissionRuleUpdateInput {
  calculationBasis?: CommissionCalculationBasis;
  flatCommissionMinor?: string | number | null;
  percentageBps?: number | null;
  minimumCommissionMinor?: string | number | null;
  maximumCommissionMinor?: string | number | null;
  tiers?: CommissionTier[] | null;
  effectiveTo?: string | Date | null;
  priority?: number;
  isActive?: boolean;
  version: number;
}

export interface CommissionRuleSafeProjection {
  id: string;
  productCode: string;
  currency: string;
  recipientType: CommissionRecipientType;
  calculationModel: CommissionCalculationModel;
  calculationBasis: CommissionCalculationBasis;
  flatCommissionMinor: string | null;
  percentageBps: number | null;
  minimumCommissionMinor: string | null;
  maximumCommissionMinor: string | null;
  tiers: CommissionTier[] | null;
  agentClassId: string | null;
  agentId: string | null;
  aggregatorId: string | null;
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

@Injectable()
export class CommissionRuleRegistryService {
  constructor(
    @InjectRepository(CommissionRuleDefinition) private readonly repo: Repository<CommissionRuleDefinition>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly calculator: CommissionCalculator,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async createRule(input: CommissionRuleCreateInput, actor: string): Promise<CommissionRuleSafeProjection> {
    const productCode = this.normalizeProductCode(input.productCode);
    await this.assertProductExists(productCode);
    const currency = this.normalizeCurrency(input.currency ?? 'NGN');
    const recipientType = this.normalizeEnum(input.recipientType, COMMISSION_RECIPIENT_TYPES, 'recipientType');
    const calculationModel = this.normalizeEnum(input.calculationModel, COMMISSION_CALCULATION_MODELS, 'calculationModel');
    const calculationBasis = this.normalizeEnum(input.calculationBasis, COMMISSION_CALCULATION_BASES, 'calculationBasis');

    const flatCommissionMinor = this.parseOptionalMinor(input.flatCommissionMinor, 'flatCommissionMinor');
    const percentageBps = this.parseOptionalBps(input.percentageBps, 'percentageBps');
    const minimumCommissionMinor = this.parseOptionalMinor(input.minimumCommissionMinor, 'minimumCommissionMinor');
    const maximumCommissionMinor = this.parseOptionalMinor(input.maximumCommissionMinor, 'maximumCommissionMinor');
    const tiers = this.normalizeTiers(calculationModel, input.tiers ?? null);

    this.assertModelParamCoherence(calculationModel, {
      flatCommissionMinor,
      percentageBps,
      minimumCommissionMinor,
      maximumCommissionMinor,
      tiers,
    });

    const targeting = this.normalizeTargeting({
      agentClassId: input.agentClassId,
      agentId: input.agentId,
      aggregatorId: input.aggregatorId,
    });
    if (targeting.agentClassId) await this.assertExists('agent_classes', targeting.agentClassId, 'AgentClass');
    if (targeting.agentId) await this.assertExists('agents', targeting.agentId, 'Agent');
    if (targeting.aggregatorId) await this.assertExists('aggregators', targeting.aggregatorId, 'Aggregator');

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
      recipientType,
      calculationModel,
      calculationBasis,
      flatCommissionMinor,
      percentageBps,
      minimumCommissionMinor,
      maximumCommissionMinor,
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

    let saved: CommissionRuleDefinition;
    try {
      saved = (await this.repo.save(entity as never)) as unknown as CommissionRuleDefinition;
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException(
          `A commission rule for ${productCode}/${currency}/${recipientType} with this targeting effective ${effectiveFrom.toISOString()} already exists`,
        );
      }
      if (this.isCheckViolation(e)) {
        throw new BadRequestException(`commission rule violates schema coherence constraints: ${(e as Error).message}`);
      }
      throw e;
    }
    await this.audit(saved.id, 'CREATED', actor, undefined, this.ruleValues(saved));
    return this.toSafe(saved);
  }

  async updateRule(id: string, input: CommissionRuleUpdateInput, actor: string): Promise<CommissionRuleSafeProjection> {
    const ruleId = this.normalizeId(id);
    const rule = await this.repo.findOne({ where: { id: ruleId } as never });
    if (!rule) throw new NotFoundException(`Commission rule ${ruleId} not found`);
    this.assertVersion(rule.version, input.version);

    const previous = this.ruleValues(rule);
    if (input.calculationBasis !== undefined) rule.calculationBasis = this.normalizeEnum(input.calculationBasis, COMMISSION_CALCULATION_BASES, 'calculationBasis');
    if (input.flatCommissionMinor !== undefined) rule.flatCommissionMinor = this.parseOptionalMinor(input.flatCommissionMinor, 'flatCommissionMinor');
    if (input.percentageBps !== undefined) rule.percentageBps = this.parseOptionalBps(input.percentageBps, 'percentageBps');
    if (input.minimumCommissionMinor !== undefined) rule.minimumCommissionMinor = this.parseOptionalMinor(input.minimumCommissionMinor, 'minimumCommissionMinor');
    if (input.maximumCommissionMinor !== undefined) rule.maximumCommissionMinor = this.parseOptionalMinor(input.maximumCommissionMinor, 'maximumCommissionMinor');
    if (input.tiers !== undefined) rule.tiers = this.normalizeTiers(rule.calculationModel, input.tiers);
    if (rule.minimumCommissionMinor !== null && rule.maximumCommissionMinor !== null && BigInt(rule.minimumCommissionMinor) > BigInt(rule.maximumCommissionMinor)) {
      throw new BadRequestException('minimumCommissionMinor cannot exceed maximumCommissionMinor');
    }
    this.assertModelParamCoherence(rule.calculationModel, {
      flatCommissionMinor: rule.flatCommissionMinor,
      percentageBps: rule.percentageBps,
      minimumCommissionMinor: rule.minimumCommissionMinor,
      maximumCommissionMinor: rule.maximumCommissionMinor,
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
      // Deterministic optimistic concurrency (proven under concurrent writers in
      // v1-commission-01 §11): the UPDATE itself carries  WHERE id = … AND version = <caller
      // version>  so a concurrent winner makes it affect 0 rows → 409. Version/updated_at are
      // set explicitly because repository.update() bypasses TypeORM's column hooks; the whole
      // state's write set is enumerated so nothing silently reverts.
      const result = await this.repo.update(
        { id: ruleId, version: input.version } as never,
        {
          calculationBasis: rule.calculationBasis,
          flatCommissionMinor: rule.flatCommissionMinor,
          percentageBps: rule.percentageBps,
          minimumCommissionMinor: rule.minimumCommissionMinor,
          maximumCommissionMinor: rule.maximumCommissionMinor,
          tiers: rule.tiers,
          effectiveTo: rule.effectiveTo,
          priority: rule.priority,
          isActive: rule.isActive,
          updatedBy: actor,
          version: input.version + 1,
          updatedAt: new Date(),
        } as never,
      );
      if (result.affected !== 1) throw new ConflictException('Commission rule version conflict — stale version');
      const saved = await this.repo.findOne({ where: { id: ruleId } as never });
      if (!saved) throw new NotFoundException(`Commission rule ${ruleId} not found`);
      await this.audit(saved.id, 'UPDATED', actor, previous, this.ruleValues(saved));
      return this.toSafe(saved);
    } catch (e) {
      if (this.isVersionConflict(e) || this.isUniqueViolation(e)) {
        throw new ConflictException('Commission rule version conflict — stale version');
      }
      if (this.isCheckViolation(e)) {
        throw new BadRequestException(`commission rule violates schema coherence constraints: ${(e as Error).message}`);
      }
      throw e;
    }
  }

  async getRule(id: string): Promise<CommissionRuleSafeProjection> {
    const ruleId = this.normalizeId(id);
    const rule = await this.repo.findOne({ where: { id: ruleId } as never });
    if (!rule) throw new NotFoundException(`Commission rule ${ruleId} not found`);
    return this.toSafe(rule);
  }

  async listRules(params: {
    productCode?: string;
    currency?: string;
    recipientType?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ data: CommissionRuleSafeProjection[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean }> {
    const page = this.normalizePage(params.page);
    const limit = this.normalizeLimit(params.limit);
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (params.productCode) where['productCode'] = this.normalizeProductCode(params.productCode);
    if (params.currency) where['currency'] = this.normalizeCurrency(params.currency);
    if (params.recipientType) where['recipientType'] = this.normalizeEnum(params.recipientType, COMMISSION_RECIPIENT_TYPES, 'recipientType');
    if (params.isActive !== undefined) where['isActive'] = params.isActive;
    const [rows, total] = await this.repo.findAndCount({
      where: where as never,
      order: { productCode: 'ASC', effectiveFrom: 'ASC', id: 'ASC' } as never,
      skip,
      take: limit,
      withDeleted: false,
    });
    const data = (rows as unknown as CommissionRuleDefinition[]).map((r) => this.toSafe(r));
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async countRules(): Promise<number> {
    return this.repo.count();
  }

  // ── internals ──

  /** Validate model⇆parameter coherence up-front (the DB CHECK is the final authority). */
  private assertModelParamCoherence(
    model: CommissionCalculationModel,
    p: {
      flatCommissionMinor: string | null;
      percentageBps: number | null;
      minimumCommissionMinor: string | null;
      maximumCommissionMinor: string | null;
      tiers: CommissionTier[] | null;
    },
  ): void {
    const req = (ok: boolean, msg: string): void => {
      if (!ok) throw new BadRequestException(msg);
    };
    switch (model) {
      case 'FIXED':
        req(p.flatCommissionMinor !== null && p.percentageBps === null && p.minimumCommissionMinor === null && p.maximumCommissionMinor === null && p.tiers === null,
          'FIXED requires flatCommissionMinor only (use 0 for explicit ZERO)');
        break;
      case 'PERCENTAGE':
        req(p.percentageBps !== null && p.flatCommissionMinor === null && p.minimumCommissionMinor === null && p.maximumCommissionMinor === null && p.tiers === null,
          'PERCENTAGE requires percentageBps only');
        break;
      case 'PERCENTAGE_MIN':
        req(p.percentageBps !== null && p.minimumCommissionMinor !== null && p.flatCommissionMinor === null && p.maximumCommissionMinor === null && p.tiers === null,
          'PERCENTAGE_MIN requires percentageBps + minimumCommissionMinor only');
        break;
      case 'PERCENTAGE_MAX':
        req(p.percentageBps !== null && p.maximumCommissionMinor !== null && p.flatCommissionMinor === null && p.minimumCommissionMinor === null && p.tiers === null,
          'PERCENTAGE_MAX requires percentageBps + maximumCommissionMinor only');
        break;
      case 'PERCENTAGE_MIN_MAX':
        req(p.percentageBps !== null && p.minimumCommissionMinor !== null && p.maximumCommissionMinor !== null && p.flatCommissionMinor === null && p.tiers === null,
          'PERCENTAGE_MIN_MAX requires percentageBps + minimumCommissionMinor + maximumCommissionMinor only');
        break;
      case 'FLAT_PLUS_PERCENTAGE':
        req(p.flatCommissionMinor !== null && p.percentageBps !== null && p.minimumCommissionMinor === null && p.maximumCommissionMinor === null && p.tiers === null,
          'FLAT_PLUS_PERCENTAGE requires flatCommissionMinor + percentageBps only');
        break;
      case 'TIERED':
        req(p.tiers !== null && p.tiers.length > 0 && p.flatCommissionMinor === null && p.percentageBps === null && p.minimumCommissionMinor === null && p.maximumCommissionMinor === null,
          'TIERED requires a non-empty tiers array only');
        break;
    }
  }

  /** Structural tier validation: the calculator's fail-closed checker is the authority. */
  private normalizeTiers(model: CommissionCalculationModel, tiers: CommissionTier[] | null): CommissionTier[] | null {
    if (tiers === null) return null;
    if (!Array.isArray(tiers)) throw new BadRequestException('tiers must be an array of marginal brackets');
    const normalized = tiers.map((tier, index): CommissionTier => {
      if (tier === null || typeof tier !== 'object') throw new BadRequestException(`tiers[${index}] must be an object`);
      const upToMinor = tier.upToMinor === undefined || tier.upToMinor === null ? null : this.parseRequiredMinor(tier.upToMinor, `tiers[${index}].upToMinor`);
      const flatMinor = tier.flatMinor === undefined || tier.flatMinor === null ? null : this.parseRequiredMinor(tier.flatMinor, `tiers[${index}].flatMinor`);
      const bps = tier.bps === undefined || tier.bps === null ? null : this.parseOptionalBps(tier.bps, `tiers[${index}].bps`);
      if (flatMinor === null && bps === null) throw new BadRequestException(`tiers[${index}] requires bps and/or flatMinor`);
      return { upToMinor, bps, flatMinor };
    });
    // Reuse the calculator's authoritative fail-closed structural validation with a zero base
    // check — pass a base that enters every bracket (MAX safe) so adjacency is verified.
    this.calculator.calculateTiered(MAX_MINOR_UNITS, normalized);
    return normalized;
  }

  private normalizeTargeting(input: { agentClassId?: string | null; agentId?: string | null; aggregatorId?: string | null }): {
    agentClassId: string | null;
    agentId: string | null;
    aggregatorId: string | null;
  } {
    const clean = (value: string | null | undefined, field: string): string | null => {
      if (value === null || value === undefined) return null;
      if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw new BadRequestException(`${field} must be a UUID`);
      return value.trim().toLowerCase();
    };
    const targeting = {
      agentClassId: clean(input.agentClassId ?? null, 'agentClassId'),
      agentId: clean(input.agentId ?? null, 'agentId'),
      aggregatorId: clean(input.aggregatorId ?? null, 'aggregatorId'),
    };
    const count = Number(targeting.agentClassId !== null) + Number(targeting.agentId !== null) + Number(targeting.aggregatorId !== null);
    if (count > 1) throw new BadRequestException('targeting is single-dimensional: set at most one of agentClassId/agentId/aggregatorId');
    return targeting;
  }

  private async assertProductExists(productCode: string): Promise<void> {
    const rows: Array<{ code: string }> = await this.dataSource.query(`SELECT code FROM products WHERE code = $1 AND deleted_at IS NULL`, [productCode]);
    if (rows.length === 0) throw new NotFoundException(`Product ${productCode} does not exist in the product catalogue`);
  }

  private async assertExists(table: 'agent_classes' | 'agents' | 'aggregators', id: string, label: string): Promise<void> {
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
          entityType: 'COMMISSION_RULE',
          entityId,
          action,
          actor,
          previousValues,
          newValues,
        } as never);
      });
    } catch {
      // best-effort audit, consistent with limit-catalog/product-catalog convention
    }
  }

  private ruleValues(r: CommissionRuleDefinition): Record<string, unknown> {
    return {
      id: r.id,
      productCode: r.productCode,
      currency: r.currency,
      recipientType: r.recipientType,
      calculationModel: r.calculationModel,
      calculationBasis: r.calculationBasis,
      flatCommissionMinor: r.flatCommissionMinor,
      percentageBps: r.percentageBps,
      minimumCommissionMinor: r.minimumCommissionMinor,
      maximumCommissionMinor: r.maximumCommissionMinor,
      tiers: r.tiers,
      agentClassId: r.agentClassId,
      agentId: r.agentId,
      aggregatorId: r.aggregatorId,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      priority: r.priority,
      isActive: r.isActive,
      version: r.version,
    };
  }

  private toSafe(r: CommissionRuleDefinition): CommissionRuleSafeProjection {
    return {
      id: r.id,
      productCode: r.productCode,
      currency: r.currency,
      recipientType: r.recipientType,
      calculationModel: r.calculationModel,
      calculationBasis: r.calculationBasis,
      flatCommissionMinor: r.flatCommissionMinor,
      percentageBps: r.percentageBps,
      minimumCommissionMinor: r.minimumCommissionMinor,
      maximumCommissionMinor: r.maximumCommissionMinor,
      tiers: r.tiers,
      agentClassId: r.agentClassId,
      agentId: r.agentId,
      aggregatorId: r.aggregatorId,
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
