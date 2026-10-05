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

import { FeeRuleDefinition } from './fee-rule.entity';

/**
 * V1-COMMERCIAL-03 — Fee Rule registry service (schema + administration foundation).
 *
 * SCHEMA ONLY:
 *  - This service never calculates, charges or posts anything. It manages fee rule DEFINITIONS.
 *  - ZERO production rules exist: nothing is seeded; rates are product/accounting decisions.
 *  - No wiring into any financial flow; V1 stays fee-free.
 *
 * Identity & versioning:
 *  - Identity = (product_code, currency, effective_from); unique among live rows. Identity
 *    fields cannot change on update — a different identity is a different rule.
 *  - Updates are version-checked (@VersionColumn optimistic locking) and audited with
 *    previous/new values, so historical administrative changes are explainable.
 *
 * Eligibility/precedence note: rules target products only. Subject-targeting (KYC levels,
 * agent classes, segments) is deliberately NOT modelled here — that is the resolver/assignment
 * concern and mirrors how limit_assignments keeps targeting separate from limit_rules.
 */

export interface FeeRuleCreateInput {
  productCode: string;
  currency?: string;
  flatFeeMinor?: string | number | null;
  percentageBps?: number | null;
  minimumFeeMinor?: string | number | null;
  maximumFeeMinor?: string | number | null;
  vatBps?: number | null;
  effectiveFrom?: string | Date;
  effectiveTo?: string | Date | null;
  priority?: number;
  isActive?: boolean;
}

export interface FeeRuleUpdateInput {
  flatFeeMinor?: string | number | null;
  percentageBps?: number | null;
  minimumFeeMinor?: string | number | null;
  maximumFeeMinor?: string | number | null;
  vatBps?: number | null;
  effectiveTo?: string | Date | null;
  priority?: number;
  isActive?: boolean;
  version: number;
}

export interface FeeRuleSafeProjection {
  id: string;
  productCode: string;
  currency: string;
  flatFeeMinor: string | null;
  percentageBps: number | null;
  minimumFeeMinor: string | null;
  maximumFeeMinor: string | null;
  vatBps: number | null;
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

const MAX_BPS = 10000; // FeeEngine BASIS_POINTS convention — 10000 bps = 100%
const MAX_MINOR_UNITS = 9223372036854775807n; // PostgreSQL BIGINT ceiling (src/common/money)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class FeeRuleRegistryService {
  constructor(
    @InjectRepository(FeeRuleDefinition) private readonly repo: Repository<FeeRuleDefinition>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async createRule(input: FeeRuleCreateInput, actor: string): Promise<FeeRuleSafeProjection> {
    const productCode = this.normalizeProductCode(input.productCode);
    await this.assertProductExists(productCode);

    const currency = this.normalizeCurrency(input.currency ?? 'NGN');
    const flatFeeMinor = this.parseOptionalMinor(input.flatFeeMinor, 'flatFeeMinor');
    const percentageBps = this.parseOptionalBps(input.percentageBps, 'percentageBps');
    const minimumFeeMinor = this.parseOptionalMinor(input.minimumFeeMinor, 'minimumFeeMinor');
    const maximumFeeMinor = this.parseOptionalMinor(input.maximumFeeMinor, 'maximumFeeMinor');
    const vatBps = this.parseOptionalBps(input.vatBps, 'vatBps');
    if (flatFeeMinor === null && percentageBps === null) {
      throw new BadRequestException('at least one pricing parameter is required (flatFeeMinor or percentageBps); use flatFeeMinor=0 for explicit ZERO/FREE rules');
    }
    if (minimumFeeMinor !== null && maximumFeeMinor !== null && BigInt(minimumFeeMinor) > BigInt(maximumFeeMinor)) {
      throw new BadRequestException('minimumFeeMinor cannot exceed maximumFeeMinor');
    }
    const effectiveFrom = this.parseDate(input.effectiveFrom ?? new Date(), 'effectiveFrom');
    const effectiveTo = input.effectiveTo === undefined ? null : this.parseDate(input.effectiveTo, 'effectiveTo');
    if (effectiveTo !== null && effectiveTo.getTime() <= effectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }
    const priority = this.parsePriority(input.priority);
    const isActive = input.isActive === undefined ? true : this.parseBoolean(input.isActive, 'isActive');

    const entity = this.repo.create({
      productCode,
      currency,
      flatFeeMinor,
      percentageBps,
      minimumFeeMinor,
      maximumFeeMinor,
      vatBps,
      effectiveFrom,
      effectiveTo,
      priority,
      isActive,
      createdBy: actor,
      updatedBy: actor,
      version: 1,
    } as never);

    let saved: FeeRuleDefinition;
    try {
      saved = (await this.repo.save(entity as never)) as unknown as FeeRuleDefinition;
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException(`A fee rule for ${productCode}/${currency} effective ${effectiveFrom.toISOString()} already exists`);
      }
      throw e;
    }
    await this.audit(saved.id, 'CREATED', actor, undefined, this.ruleValues(saved));
    return this.toSafe(saved);
  }

  async updateRule(id: string, input: FeeRuleUpdateInput, actor: string): Promise<FeeRuleSafeProjection> {
    const ruleId = this.normalizeId(id);

    // V1-TEST-01: a plain `this.repo.findOne()` followed later by `this.repo.save()` does NOT
    // give @VersionColumn any actual compare-and-swap protection in TypeORM —
    // OptimisticLockVersionMismatchError (see isVersionConflict below) is only ever raised by
    // a SelectQueryBuilder configured with `.setLock('optimistic', expectedVersion)`, which
    // this method never used. Two genuinely concurrent callers that both read the same
    // starting version could therefore both have their writes applied (a real lost update),
    // with whichever commits second silently discarding the other's change — proven by
    // V1-TEST-01's reproduction of test 08 ("concurrent updates: exactly one writer wins per
    // version"), which intermittently observed BOTH concurrent updateRule calls resolve
    // instead of exactly one. This is closed with the same pattern already used everywhere
    // else in this codebase for row-level contention (OTP challenges, idempotency records, A2
    // rate-limit buckets): a `SELECT ... FOR UPDATE` pessimistic lock inside an explicit
    // transaction, so a second concurrent caller blocks until the first commits, then reads
    // the POST-update version and correctly hits the existing assertVersion conflict path.
    const { saved, previous } = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(FeeRuleDefinition);
      const rule = await repository
        .createQueryBuilder('rule')
        .where('rule.id = :id', { id: ruleId })
        .setLock('pessimistic_write')
        .getOne();
      if (!rule) throw new NotFoundException(`Fee rule ${ruleId} not found`);
      this.assertVersion(rule.version, input.version);

      const previousValues = this.ruleValues(rule);
      if (input.flatFeeMinor !== undefined) rule.flatFeeMinor = this.parseOptionalMinor(input.flatFeeMinor, 'flatFeeMinor');
      if (input.percentageBps !== undefined) rule.percentageBps = this.parseOptionalBps(input.percentageBps, 'percentageBps');
      if (input.minimumFeeMinor !== undefined) rule.minimumFeeMinor = this.parseOptionalMinor(input.minimumFeeMinor, 'minimumFeeMinor');
      if (input.maximumFeeMinor !== undefined) rule.maximumFeeMinor = this.parseOptionalMinor(input.maximumFeeMinor, 'maximumFeeMinor');
      if (input.vatBps !== undefined) rule.vatBps = this.parseOptionalBps(input.vatBps, 'vatBps');
      if (rule.flatFeeMinor === null && rule.percentageBps === null) {
        throw new BadRequestException('at least one pricing parameter must remain (flatFeeMinor or percentageBps)');
      }
      if (rule.minimumFeeMinor !== null && rule.maximumFeeMinor !== null && BigInt(rule.minimumFeeMinor) > BigInt(rule.maximumFeeMinor)) {
        throw new BadRequestException('minimumFeeMinor cannot exceed maximumFeeMinor');
      }
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
        const savedRule = (await repository.save(rule as never)) as unknown as FeeRuleDefinition;
        return { saved: savedRule, previous: previousValues };
      } catch (e) {
        if (this.isVersionConflict(e) || this.isUniqueViolation(e)) {
          throw new ConflictException('Fee rule version conflict — stale version');
        }
        throw e;
      }
    });

    await this.audit(saved.id, 'UPDATED', actor, previous, this.ruleValues(saved));
    return this.toSafe(saved);
  }

  async getRule(id: string): Promise<FeeRuleSafeProjection> {
    const ruleId = this.normalizeId(id);
    const rule = await this.repo.findOne({ where: { id: ruleId } as never });
    if (!rule) throw new NotFoundException(`Fee rule ${ruleId} not found`);
    return this.toSafe(rule);
  }

  async listRules(params: {
    productCode?: string;
    currency?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ data: FeeRuleSafeProjection[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean }> {
    const page = this.normalizePage(params.page);
    const limit = this.normalizeLimit(params.limit);
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (params.productCode) where['productCode'] = this.normalizeProductCode(params.productCode);
    if (params.currency) where['currency'] = this.normalizeCurrency(params.currency);
    if (params.isActive !== undefined) where['isActive'] = params.isActive;
    const [rows, total] = await this.repo.findAndCount({
      where: where as never,
      order: { productCode: 'ASC', effectiveFrom: 'ASC', id: 'ASC' } as never,
      skip,
      take: limit,
      withDeleted: false,
    });
    const data = (rows as unknown as FeeRuleDefinition[]).map((r) => this.toSafe(r));
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async countRules(): Promise<number> {
    return this.repo.count();
  }

  // ── internals ──

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

  private async assertProductExists(productCode: string): Promise<void> {
    const rows: Array<{ code: string }> = await this.dataSource.query(`SELECT code FROM products WHERE code = $1 AND deleted_at IS NULL`, [productCode]);
    if (rows.length === 0) {
      throw new NotFoundException(`Product ${productCode} does not exist in the product catalogue`);
    }
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
      throw new BadRequestException(`${field} must be a non-negative integer`);
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
          entityType: 'FEE_RULE',
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

  private ruleValues(r: FeeRuleDefinition): Record<string, unknown> {
    return {
      id: r.id,
      productCode: r.productCode,
      currency: r.currency,
      flatFeeMinor: r.flatFeeMinor,
      percentageBps: r.percentageBps,
      minimumFeeMinor: r.minimumFeeMinor,
      maximumFeeMinor: r.maximumFeeMinor,
      vatBps: r.vatBps,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      priority: r.priority,
      isActive: r.isActive,
      version: r.version,
    };
  }

  /** Safe projection: rule definition facts only. The schema carries no secrets or credentials. */
  private toSafe(row: FeeRuleDefinition): FeeRuleSafeProjection {
    return {
      id: row.id,
      productCode: row.productCode,
      currency: row.currency,
      flatFeeMinor: row.flatFeeMinor,
      percentageBps: row.percentageBps,
      minimumFeeMinor: row.minimumFeeMinor,
      maximumFeeMinor: row.maximumFeeMinor,
      vatBps: row.vatBps,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      priority: row.priority,
      isActive: row.isActive,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy ?? null,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
