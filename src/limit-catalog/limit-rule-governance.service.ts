import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  CommercialRuleGovernanceService,
  governedChangeConsumptionError,
} from '../authorization/commercial-rule-governance.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  governedAction,
  governedChangeFingerprint,
} from '../authorization/governed-action.registry';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { CreateLimitRuleDto } from './dto/create-limit-rule.dto';
import { UpdateLimitRuleDto } from './dto/update-limit-rule.dto';
import { LimitCatalogService } from './limit-catalog.service';
import type { LimitRuleCreateInput, LimitRuleUpdateInput } from './limit-catalog.types';

const CREATE_ACTION = 'LIMIT_RULE_CREATE';
const UPDATE_ACTION = 'LIMIT_RULE_UPDATE';

/**
 * Limit-rule maker/checker adapter. Requests use the shared commercial governance API; the
 * approved rule write and approval consumption share one database transaction via
 * PrivilegedActionApprovalService.consumeInTransaction().
 */
@Injectable()
export class LimitRuleGovernanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly commercialGovernance: CommercialRuleGovernanceService,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly catalog: LimitCatalogService,
  ) {}

  async requestCreate(
    principal: AuthorizationPrincipal,
    profileCode: string,
    dto: CreateLimitRuleDto,
  ) {
    this.definition(CREATE_ACTION);
    const payload = this.createPayload(profileCode, dto);
    return this.commercialGovernance.requestChange({
      principal,
      action: CREATE_ACTION,
      payload,
      reason: String(payload.reason),
    });
  }

  async requestUpdate(principal: AuthorizationPrincipal, id: string, dto: UpdateLimitRuleDto) {
    this.definition(UPDATE_ACTION);
    const payload = this.updatePayload(dto);
    return this.commercialGovernance.requestChange({
      principal,
      action: UPDATE_ACTION,
      resourceId: id,
      payload,
      reason: String(payload.reason),
    });
  }

  async executeCreate(
    principal: AuthorizationPrincipal,
    approvalId: string,
    profileCode: string,
    dto: CreateLimitRuleDto,
  ) {
    const definition = this.definition(CREATE_ACTION);
    const payload = this.createPayload(profileCode, dto);
    const approval = await this.approvals.getApproval(approvalId);
    if (
      !approval ||
      approval.actionType !== CREATE_ACTION ||
      approval.resourceType !== definition.resourceType ||
      approval.resourceId !== null
    ) {
      throw new ForbiddenException('Approval does not govern this limit-rule creation');
    }
    const actionFingerprint = governedChangeFingerprint(
      CREATE_ACTION,
      definition.resourceType,
      null,
      payload,
    );
    return this.dataSource.transaction(async (manager) => {
      await this.consume(
        manager,
        principal,
        approvalId,
        CREATE_ACTION,
        definition.resourceType,
        null,
        actionFingerprint,
      );
      const input: LimitRuleCreateInput = {
        limitProfileCode: String(payload.limitProfileCode),
        product: String(payload.product),
        direction: payload.direction as string | null,
        channel: payload.channel as string | null,
        currency: String(payload.currency),
        dimension: String(payload.dimension),
        limitValueMinor: payload.limitValueMinor as string | null,
        limitValueCount: payload.limitValueCount as number | null,
        effectiveFrom: payload.effectiveFrom as string,
        effectiveTo: payload.effectiveTo as string | null,
        isActive: payload.isActive as boolean,
        priority: payload.priority as number,
        createdBy: principal.principalId,
      };
      return this.catalog.createRuleInTransaction(manager, input, principal.principalId);
    });
  }

  async executeUpdate(
    principal: AuthorizationPrincipal,
    approvalId: string,
    id: string,
    dto: UpdateLimitRuleDto,
  ) {
    const definition = this.definition(UPDATE_ACTION);
    const payload = this.updatePayload(dto);
    const approval = await this.approvals.getApproval(approvalId);
    if (
      !approval ||
      approval.actionType !== UPDATE_ACTION ||
      approval.resourceType !== definition.resourceType ||
      approval.resourceId !== id
    ) {
      throw new ForbiddenException('Approval does not govern this limit-rule update');
    }
    const actionFingerprint = governedChangeFingerprint(
      UPDATE_ACTION,
      definition.resourceType,
      id,
      payload,
    );
    return this.dataSource.transaction(async (manager) => {
      await this.consume(
        manager,
        principal,
        approvalId,
        UPDATE_ACTION,
        definition.resourceType,
        id,
        actionFingerprint,
      );
      const input: LimitRuleUpdateInput = {
        ...(payload.product !== undefined ? { product: payload.product as string } : {}),
        ...(payload.direction !== undefined
          ? { direction: payload.direction as string | null }
          : {}),
        ...(payload.channel !== undefined ? { channel: payload.channel as string | null } : {}),
        ...(payload.currency !== undefined ? { currency: payload.currency as string } : {}),
        ...(payload.dimension !== undefined ? { dimension: payload.dimension as string } : {}),
        ...(payload.limitValueMinor !== undefined
          ? { limitValueMinor: payload.limitValueMinor as string | null }
          : {}),
        ...(payload.limitValueCount !== undefined
          ? { limitValueCount: payload.limitValueCount as number | null }
          : {}),
        ...(payload.effectiveFrom !== undefined
          ? { effectiveFrom: payload.effectiveFrom as string | null }
          : {}),
        ...(payload.effectiveTo !== undefined
          ? { effectiveTo: payload.effectiveTo as string | null }
          : {}),
        ...(payload.isActive !== undefined ? { isActive: payload.isActive as boolean } : {}),
        ...(payload.priority !== undefined ? { priority: payload.priority as number } : {}),
        version: Number(payload.version),
        updatedBy: principal.principalId,
      };
      return this.catalog.updateRuleInTransaction(manager, id, input, principal.principalId);
    });
  }

  /** Test seam for contract validation; action definitions remain owned by authorization. */
  protected definition(action: string) {
    const result = governedAction(action);
    if (!result) {
      throw new ServiceUnavailableException(
        `Limit-rule approval action ${action} is not registered; merge Arena 4 PR #6 before enabling these routes`,
      );
    }
    return result;
  }

  private async consume(
    manager: EntityManager,
    principal: AuthorizationPrincipal,
    approvalId: string,
    action: string,
    resourceType: string,
    resourceId: string | null,
    actionFingerprint: string,
  ): Promise<void> {
    const decision = await this.approvals.consumeInTransaction(manager, {
      principal,
      approvalId,
      actionType: action,
      resource: { type: resourceType, ...(resourceId ? { id: resourceId } : {}) },
      actionFingerprint,
    });
    if (!decision.approved) {
      if (
        [
          'ROLE_MISSING',
          'FUNCTION_MISSING',
          'PRINCIPAL_TYPE_DENIED',
          'MFA_REQUIRED',
          'SUPER_ADMIN_NOT_ALLOWED',
        ].includes(decision.reason ?? '')
      ) {
        throw new ForbiddenException(`Limit-rule approval execution denied: ${decision.reason}`);
      }
      throw governedChangeConsumptionError(decision.reason, decision.approval?.status);
    }
  }

  private createPayload(profileCode: string, dto: CreateLimitRuleDto): Record<string, unknown> {
    const reason = this.reason(dto.reason);
    if (!dto.effectiveFrom) {
      throw new BadRequestException('effectiveFrom is required for a governed limit-rule creation');
    }
    return {
      limitProfileCode: profileCode.trim().toUpperCase(),
      product: dto.product.trim().toUpperCase(),
      direction: dto.direction ?? null,
      channel: dto.channel?.trim() || null,
      currency: dto.currency.trim().toUpperCase(),
      dimension: dto.dimension,
      limitValueMinor: dto.limitValueMinor ?? null,
      limitValueCount: dto.limitValueCount ?? null,
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo ?? null,
      isActive: dto.isActive ?? true,
      priority: dto.priority ?? 0,
      reason,
    };
  }

  private updatePayload(dto: UpdateLimitRuleDto): Record<string, unknown> {
    const reason = this.reason(dto.reason);
    const fields: Record<string, unknown> = {
      product: dto.product?.trim().toUpperCase(),
      direction: dto.direction,
      channel: dto.channel === undefined ? undefined : dto.channel?.trim() || null,
      currency: dto.currency?.trim().toUpperCase(),
      dimension: dto.dimension,
      limitValueMinor: dto.limitValueMinor,
      limitValueCount: dto.limitValueCount,
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo,
      isActive: dto.isActive,
      priority: dto.priority,
      version: dto.version,
      reason,
    };
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  }

  private reason(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) {
      throw new BadRequestException('reason must contain 1 to 500 characters');
    }
    return value.trim();
  }
}
