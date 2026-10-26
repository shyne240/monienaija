import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Capability } from './capability.entity';
import {
  CapabilityAdminUiStatus,
  CapabilityAgentUiStatus,
  CapabilityApiStatus,
  CapabilityBackendStatus,
  CapabilityBlockerType,
  CapabilityConfigurationStatus,
  CapabilityCustomerUiStatus,
  CapabilityDomain,
  CapabilityLifecycle,
  CapabilityProductScope,
} from './capability.enums';
import type {
  CapabilityCreateInput,
  CapabilitySafeProjection,
  CapabilitySummary,
} from './capability.types';

const CAPABILITY_CODE_PATTERN = /^[A-Z0-9_]{3,80}$/;

@Injectable()
export class CapabilityService {
  constructor(
    @InjectRepository(Capability)
    private readonly repo: Repository<Capability>,
  ) {}

  async create(input: CapabilityCreateInput): Promise<CapabilitySafeProjection> {
    this.validate(input);
    const existing = await this.repo.findOne({ where: { capabilityCode: input.capabilityCode } as never });
    if (existing) throw new ConflictException(`Capability ${input.capabilityCode} already exists`);

    const entity = this.repo.create({
      capabilityCode: input.capabilityCode,
      domain: input.domain,
      name: input.name,
      description: input.description,
      productScope: input.productScope,
      lifecycle: input.lifecycle,
      backendStatus: input.backendStatus,
      apiStatus: input.apiStatus,
      adminUiStatus: input.adminUiStatus,
      customerUiStatus: input.customerUiStatus,
      agentUiStatus: input.agentUiStatus,
      enabled: input.enabled,
      configurationStatus: input.configurationStatus,
      dependencies: input.dependencies ?? null,
      implementationReferences: input.implementationReferences ?? null,
      migrationReferences: input.migrationReferences ?? null,
      testReferences: input.testReferences ?? null,
      documentationReferences: input.documentationReferences ?? null,
      version: input.version ?? 1,
      owner: input.owner ?? null,
      blockerType: input.blockerType ?? CapabilityBlockerType.NONE,
      blockerDescription: input.blockerDescription ?? null,
      notes: input.notes ?? null,
    } as never);
    const saved = await this.repo.save(entity as never) as unknown as Capability;
    return this.toSafe(saved);
  }

  async findByCode(capabilityCode: string): Promise<CapabilitySafeProjection> {
    const row = await this.repo.findOne({ where: { capabilityCode } as never });
    if (!row) throw new NotFoundException(`Capability ${capabilityCode} not found`);
    return this.toSafe(row);
  }

  async list(params: {
    domain?: string;
    lifecycle?: string;
    backendStatus?: string;
    apiStatus?: string;
    adminUiStatus?: string;
    customerUiStatus?: string;
    agentUiStatus?: string;
    enabled?: boolean;
    productScope?: string;
    blockerType?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: CapabilitySafeProjection[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean }> {
    const page = this.normalizePage(params.page);
    const limit = this.normalizeLimit(params.limit);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (params.domain) where['domain'] = params.domain;
    if (params.lifecycle) where['lifecycle'] = params.lifecycle;
    if (params.backendStatus) where['backendStatus'] = params.backendStatus;
    if (params.apiStatus) where['apiStatus'] = params.apiStatus;
    if (params.adminUiStatus) where['adminUiStatus'] = params.adminUiStatus;
    if (params.customerUiStatus) where['customerUiStatus'] = params.customerUiStatus;
    if (params.agentUiStatus) where['agentUiStatus'] = params.agentUiStatus;
    if (params.enabled !== undefined) where['enabled'] = params.enabled;
    if (params.productScope) where['productScope'] = params.productScope;
    if (params.blockerType) where['blockerType'] = params.blockerType;

    const [rows, total] = await this.repo.findAndCount({
      where: where as never,
      order: { capabilityCode: 'ASC' } as never,
      skip,
      take: limit,
    });
    const data = (rows as unknown as Capability[]).map((r) => this.toSafe(r));
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages };
  }

  async summary(): Promise<CapabilitySummary> {
    const all = (await this.repo.find({ order: { capabilityCode: 'ASC' } as never })) as unknown as Capability[];
    const total = all.length;
    const fullyEnabled = all.filter((c) => c.enabled && c.configurationStatus === CapabilityConfigurationStatus.CONFIGURED && c.backendStatus === CapabilityBackendStatus.BACKEND_IMPLEMENTED).length;
    const backendOnly = all.filter((c) => c.backendStatus === CapabilityBackendStatus.BACKEND_IMPLEMENTED && c.apiStatus === CapabilityApiStatus.NOT_EXPOSED && c.adminUiStatus === CapabilityAdminUiStatus.NOT_EXPOSED && c.customerUiStatus === CapabilityCustomerUiStatus.NOT_EXPOSED && c.agentUiStatus === CapabilityAgentUiStatus.NOT_EXPOSED).length;
    const apiReadyButUiMissing = all.filter((c) => c.apiStatus === CapabilityApiStatus.API_READY && c.customerUiStatus === CapabilityCustomerUiStatus.NOT_EXPOSED && c.agentUiStatus === CapabilityAgentUiStatus.NOT_EXPOSED).length;
    const configuredButDisabled = all.filter((c) => c.configurationStatus === CapabilityConfigurationStatus.CONFIGURED && !c.enabled).length;
    const blocked = all.filter((c) => c.blockerType !== CapabilityBlockerType.NONE || c.lifecycle === CapabilityLifecycle.BLOCKED || c.backendStatus === CapabilityBackendStatus.BLOCKED).length;
    const planned = all.filter((c) => c.lifecycle === CapabilityLifecycle.PLANNED || c.backendStatus === CapabilityBackendStatus.PLANNED).length;
    const v1 = all.filter((c) => c.productScope === CapabilityProductScope.V1).length;
    const v2 = all.filter((c) => c.productScope === CapabilityProductScope.V2).length;
    const byDomain: Record<string, number> = {};
    const byBackendStatus: Record<string, number> = {};
    for (const c of all) {
      byDomain[c.domain] = (byDomain[c.domain] ?? 0) + 1;
      byBackendStatus[c.backendStatus] = (byBackendStatus[c.backendStatus] ?? 0) + 1;
    }
    return { total, fullyEnabled, backendOnly, apiReadyButUiMissing, configuredButDisabled, blocked, planned, v1, v2, byDomain, byBackendStatus };
  }

  async count(): Promise<number> {
    return this.repo.count();
  }

  private validate(input: CapabilityCreateInput): void {
    if (!CAPABILITY_CODE_PATTERN.test(input.capabilityCode)) {
      throw new BadRequestException('capabilityCode must be 3-80 chars A-Z0-9_');
    }
    this.assertEnum(input.domain, CapabilityDomain, 'domain');
    this.assertEnum(input.productScope, CapabilityProductScope, 'productScope');
    this.assertEnum(input.lifecycle, CapabilityLifecycle, 'lifecycle');
    this.assertEnum(input.backendStatus, CapabilityBackendStatus, 'backendStatus');
    this.assertEnum(input.apiStatus, CapabilityApiStatus, 'apiStatus');
    this.assertEnum(input.adminUiStatus, CapabilityAdminUiStatus, 'adminUiStatus');
    this.assertEnum(input.customerUiStatus, CapabilityCustomerUiStatus, 'customerUiStatus');
    this.assertEnum(input.agentUiStatus, CapabilityAgentUiStatus, 'agentUiStatus');
    this.assertEnum(input.configurationStatus, CapabilityConfigurationStatus, 'configurationStatus');
    if (input.blockerType) this.assertEnum(input.blockerType, CapabilityBlockerType, 'blockerType');
    if (!input.name || input.name.trim().length === 0) throw new BadRequestException('name is required');
    if (!input.description || input.description.trim().length === 0) throw new BadRequestException('description is required');
    if (input.version !== undefined && (!Number.isSafeInteger(input.version) || input.version < 1)) throw new BadRequestException('version must be >=1');
  }

  private assertEnum(value: string, enumObj: Record<string, string>, field: string): void {
    if (!Object.values(enumObj).includes(value as never)) {
      throw new BadRequestException(`${field} must be one of ${Object.values(enumObj).join(', ')}`);
    }
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

  private toSafe(row: Capability): CapabilitySafeProjection {
    return {
      capabilityCode: row.capabilityCode,
      domain: row.domain,
      name: row.name,
      description: row.description,
      productScope: row.productScope,
      lifecycle: row.lifecycle,
      backendStatus: row.backendStatus,
      apiStatus: row.apiStatus,
      adminUiStatus: row.adminUiStatus,
      customerUiStatus: row.customerUiStatus,
      agentUiStatus: row.agentUiStatus,
      enabled: row.enabled,
      configurationStatus: row.configurationStatus,
      dependencies: row.dependencies,
      implementationReferences: row.implementationReferences,
      migrationReferences: row.migrationReferences,
      testReferences: row.testReferences,
      documentationReferences: row.documentationReferences,
      version: row.version,
      owner: row.owner,
      blockerType: row.blockerType,
      blockerDescription: row.blockerDescription,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
