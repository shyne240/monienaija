import { createHash } from 'crypto';
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

import { Product } from './product.entity';
import {
  PRODUCT_CODE_PATTERN,
  ProductConfigurationStatus,
  ProductDomain,
  ProductScope,
  ProductStatus,
} from './product-catalog.enums';

/**
 * V1-COMMERCIAL-02 — Product Catalogue foundation service.
 *
 * The catalogue answers "What product is this?" — never "How much does this product cost?".
 * Fee/commission/reward rates and limit thresholds are separate rule systems; nothing here
 * accepts or stores them.
 *
 * Write surface is deliberately minimal and workforce-internal:
 *  - createProduct / updateProduct (version-checked, audited) to let future products register
 *    without migrations; no DELETE route exists — deprecation happens via status.
 * Updates can never rewrite history elsewhere: commercial decision snapshots are immutable
 * and reference product codes as strings.
 */

export interface ProductCreateInput {
  code: string;
  name: string;
  description?: string | null;
  domain: string;
  currency?: string;
  productScope?: string;
  status?: string;
  enabled?: boolean;
  configurationStatus?: string;
}

export interface ProductUpdateInput {
  name?: string;
  description?: string | null;
  domain?: string;
  status?: string;
  enabled?: boolean;
  configurationStatus?: string;
  version: number;
}

export interface ProductSafeProjection {
  code: string;
  name: string;
  description: string | null;
  domain: string;
  currency: string;
  productScope: string;
  status: string;
  enabled: boolean;
  configurationStatus: string;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProductCatalogService {
  constructor(
    @InjectRepository(Product) private readonly repo: Repository<Product>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async createProduct(input: ProductCreateInput, actor: string): Promise<ProductSafeProjection> {
    const code = this.normalizeCode(input.code);
    const existing = await this.repo.findOne({ where: { code } as never });
    if (existing) throw new ConflictException(`Product ${code} already exists`);

    const name = this.requireName(input.name);
    const domain = this.assertEnum(input.domain, ProductDomain, 'domain');
    const currency = this.normalizeCurrency(input.currency ?? 'NGN');
    const productScope = this.assertEnum(input.productScope ?? ProductScope.V1, ProductScope, 'productScope');
    const status = this.assertEnum(input.status ?? ProductStatus.ACTIVE, ProductStatus, 'status');
    const configurationStatus = this.assertEnum(
      input.configurationStatus ?? ProductConfigurationStatus.NOT_CONFIGURED,
      ProductConfigurationStatus,
      'configurationStatus',
    );

    const entity = this.repo.create({
      code,
      name,
      description: input.description?.trim() || null,
      domain,
      currency,
      productScope,
      status,
      enabled: input.enabled ?? false,
      configurationStatus,
      createdBy: actor,
      updatedBy: actor,
      version: 1,
    } as never);

    let saved: Product;
    try {
      saved = (await this.repo.save(entity as never)) as unknown as Product;
    } catch (e) {
      if (this.isUniqueViolation(e)) throw new ConflictException(`Product ${code} already exists`);
      throw e;
    }
    await this.audit('CREATED', actor, undefined, this.productValues(saved));
    return this.toSafe(saved);
  }

  async updateProduct(code: string, input: ProductUpdateInput, actor: string): Promise<ProductSafeProjection> {
    const normalizedCode = this.normalizeCode(code);
    const product = await this.repo.findOne({ where: { code: normalizedCode } as never });
    if (!product) throw new NotFoundException(`Product ${normalizedCode} not found`);
    this.assertVersion(product.version, input.version);

    if (input.name !== undefined) product.name = this.requireName(input.name);
    if (input.description !== undefined) product.description = input.description?.trim() || null;
    if (input.domain !== undefined) product.domain = this.assertEnum(input.domain, ProductDomain, 'domain');
    if (input.status !== undefined) product.status = this.assertEnum(input.status, ProductStatus, 'status');
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean');
      product.enabled = input.enabled;
    }
    if (input.configurationStatus !== undefined) {
      product.configurationStatus = this.assertEnum(input.configurationStatus, ProductConfigurationStatus, 'configurationStatus');
    }
    product.updatedBy = actor;

    const previous = this.productValues({ ...product, version: input.version } as Product);
    try {
      const saved = (await this.repo.save(product as never)) as unknown as Product;
      await this.audit('UPDATED', actor, previous, this.productValues(saved));
      return this.toSafe(saved);
    } catch (e) {
      // VersionColumn optimistic lock or concurrent unique race
      if (this.isVersionConflict(e) || this.isUniqueViolation(e)) {
        throw new ConflictException('Product version conflict — stale version');
      }
      throw e;
    }
  }

  async getProduct(code: string): Promise<ProductSafeProjection> {
    const normalizedCode = this.normalizeCode(code);
    const product = await this.repo.findOne({ where: { code: normalizedCode } as never });
    if (!product) throw new NotFoundException(`Product ${normalizedCode} not found`);
    return this.toSafe(product);
  }

  async listProducts(params: {
    domain?: string;
    status?: string;
    enabled?: boolean;
    configurationStatus?: string;
    productScope?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: ProductSafeProjection[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean }> {
    const page = this.normalizePage(params.page);
    const limit = this.normalizeLimit(params.limit);
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (params.domain) where['domain'] = this.assertEnum(params.domain, ProductDomain, 'domain');
    if (params.status) where['status'] = this.assertEnum(params.status, ProductStatus, 'status');
    if (params.enabled !== undefined) where['enabled'] = params.enabled;
    if (params.configurationStatus) {
      where['configurationStatus'] = this.assertEnum(params.configurationStatus, ProductConfigurationStatus, 'configurationStatus');
    }
    if (params.productScope) where['productScope'] = this.assertEnum(params.productScope, ProductScope, 'productScope');
    const [rows, total] = await this.repo.findAndCount({
      where: where as never,
      order: { code: 'ASC' } as never,
      skip,
      take: limit,
      withDeleted: false,
    });
    const data = (rows as unknown as Product[]).map((r) => this.toSafe(r));
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async countProducts(): Promise<number> {
    return this.repo.count();
  }

  // ── internals ──

  private normalizeCode(code: unknown): string {
    if (typeof code !== 'string' || !code.trim()) throw new BadRequestException('code is required');
    const normalized = code.trim().toUpperCase();
    if (!PRODUCT_CODE_PATTERN.test(normalized)) {
      throw new BadRequestException('code must match ^[A-Z0-9_]{3,80}$');
    }
    return normalized;
  }

  private requireName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim()) throw new BadRequestException('name is required');
    const trimmed = name.trim();
    if (trimmed.length > 160) throw new BadRequestException('name exceeds 160 characters');
    return trimmed;
  }

  private normalizeCurrency(currency: unknown): string {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency.trim().toUpperCase())) {
      throw new BadRequestException('currency must be a 3-letter uppercase ISO code');
    }
    return currency.trim().toUpperCase();
  }

  private assertEnum(value: unknown, enumObj: Record<string, string>, field: string): string {
    if (typeof value !== 'string' || !Object.values(enumObj).includes(value as never)) {
      throw new BadRequestException(`${field} must be one of ${Object.values(enumObj).join(', ')}`);
    }
    return value;
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
    // TypeORM optimistic lock errors surface as OptimisticLockVersionMismatchError
    return (error as { name?: string } | null)?.name === 'OptimisticLockVersionMismatchError';
  }

  /**
   * audit_events.entity_id is a UUID column while products are keyed by code, so the audit
   * entity id is a deterministic UUID derived from the product code (stable across events).
   * The human-readable code is always present in newValues/previousValues.
   */
  private auditEntityId(code: string): string {
    const digest = createHash('sha256').update(`product-catalogue:${code}`).digest('hex');
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
  }

  private async audit(
    action: 'CREATED' | 'UPDATED',
    actor: string,
    previousValues: Record<string, unknown> | undefined,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditService) return;
    try {
      await this.dataSource.transaction(async (manager: EntityManager) => {
        await this.auditService!.record(manager, {
          entityType: 'PRODUCT',
          entityId: this.auditEntityId(newValues.code as string),
          action,
          actor,
          previousValues,
          newValues,
        } as never);
      });
    } catch {
      // best-effort audit, consistent with limit-catalog convention
    }
  }

  private productValues(p: Product): Record<string, unknown> {
    return {
      code: p.code,
      name: p.name,
      domain: p.domain,
      currency: p.currency,
      productScope: p.productScope,
      status: p.status,
      enabled: p.enabled,
      configurationStatus: p.configurationStatus,
      version: p.version,
    };
  }

  /** Safe projection: catalogue facts only. No secrets exist in the schema. */
  private toSafe(row: Product): ProductSafeProjection {
    return {
      code: row.code,
      name: row.name,
      description: row.description ?? null,
      domain: row.domain,
      currency: row.currency,
      productScope: row.productScope,
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
}
