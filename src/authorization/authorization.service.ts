import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import type {
  AuthorizationDecision,
  AuthorizationDenialReason,
  AuthorizationPolicy,
  AuthorizationPrincipal,
  AuthorizationResource,
  CustomerAccessScope,
} from './authorization.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYSTEM_ENTITY_ID = '00000000-0000-4000-8000-000000000000';
const MAX_TEXT_LENGTH = 160;

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async authorize(
    principal: AuthorizationPrincipal | undefined,
    policy: AuthorizationPolicy | undefined,
    resource: AuthorizationResource,
  ): Promise<AuthorizationDecision> {
    const decision = this.evaluate(principal, policy, resource);
    await this.recordDecision(decision);
    return decision;
  }

  evaluate(
    principal: AuthorizationPrincipal | undefined,
    policy: AuthorizationPolicy | undefined,
    resource: AuthorizationResource,
  ): AuthorizationDecision {
    const evaluatedAt = new Date();
    const requiredScopes = policy?.requiredScopes ?? [];
    const requiredRoles = policy?.requiredRoles ?? [];
    const base = {
      resourceType: resource.type,
      resourceId: resource.id,
      customerId: resource.customerId,
      action: policy?.action ?? 'UNKNOWN',
      evaluatedAt,
      requiredScopes,
      requiredRoles,
    };

    if (!policy) {
      return { ...base, allowed: false, reason: 'POLICY_MISSING' };
    }
    if (resource.type !== policy.resourceType) {
      return { ...base, allowed: false, reason: 'RESOURCE_TYPE_MISMATCH' };
    }
    if (!principal) {
      return { ...base, allowed: false, reason: 'UNAUTHENTICATED' };
    }
    if (!this.validPrincipal(principal)) {
      return {
        ...base,
        allowed: false,
        reason: 'INVALID_PRINCIPAL',
        principalType: principal.type,
        principalId: principal.principalId,
      };
    }
    if (policy.allowedPrincipalTypes && !policy.allowedPrincipalTypes.includes(principal.type)) {
      return {
        ...base,
        allowed: false,
        reason: 'PRINCIPAL_TYPE_DENIED',
        principalType: principal.type,
        principalId: principal.principalId,
      };
    }
    if (policy.audience && principal.audience !== policy.audience) {
      return {
        ...base,
        allowed: false,
        reason: 'AUDIENCE_MISMATCH',
        principalType: principal.type,
        principalId: principal.principalId,
      };
    }
    if (policy.minimumAssurance === 'MFA' && principal.assuranceLevel !== 'MFA') {
      return {
        ...base,
        allowed: false,
        reason: 'MFA_REQUIRED',
        principalType: principal.type,
        principalId: principal.principalId,
      };
    }
    if (!requiredScopes.every((scope) => principal.scopes.includes(scope))) {
      return {
        ...base,
        allowed: false,
        reason: 'SCOPE_MISSING',
        principalType: principal.type,
        principalId: principal.principalId,
      };
    }
    if (!requiredRoles.every((role) => principal.roles.includes(role))) {
      return {
        ...base,
        allowed: false,
        reason: 'ROLE_MISSING',
        principalType: principal.type,
        principalId: principal.principalId,
      };
    }

    const customerReason = this.checkCustomerScope(principal, policy.customerAccess, resource);
    if (customerReason) {
      return {
        ...base,
        allowed: false,
        reason: customerReason,
        principalType: principal.type,
        principalId: principal.principalId,
      };
    }

    return {
      ...base,
      allowed: true,
      principalType: principal.type,
      principalId: principal.principalId,
    };
  }

  private checkCustomerScope(
    principal: AuthorizationPrincipal,
    policyScope: CustomerAccessScope | undefined,
    resource: AuthorizationResource,
  ): AuthorizationDenialReason | undefined {
    if (!resource.customerId) {
      return undefined;
    }
    const access = policyScope ?? (principal.type === 'CUSTOMER' ? 'SELF' : undefined);
    if (!access) {
      return 'RESOURCE_SCOPE_MISSING';
    }
    if (access === 'NONE') {
      return 'CUSTOMER_SCOPE_MISMATCH';
    }
    if (access === 'SELF') {
      return principal.type === 'CUSTOMER' && principal.customerId === resource.customerId
        ? undefined
        : 'CUSTOMER_SCOPE_MISMATCH';
    }
    if (access === 'ASSIGNED') {
      if (principal.customerAccess === 'ANY') {
        return undefined;
      }
      if (
        principal.customerAccess !== 'ASSIGNED' ||
        !principal.assignedCustomerIds?.includes(resource.customerId)
      ) {
        return 'RESOURCE_SCOPE_MISSING';
      }
      return undefined;
    }
    if (access === 'ANY' && principal.customerAccess !== 'ANY') {
      return 'RESOURCE_SCOPE_MISSING';
    }
    return undefined;
  }

  private validPrincipal(principal: AuthorizationPrincipal): boolean {
    if (!principal.principalId || principal.principalId.length > MAX_TEXT_LENGTH) {
      return false;
    }
    if (!Array.isArray(principal.roles) || !Array.isArray(principal.scopes)) {
      return false;
    }
    if (!['NONE', 'SELF', 'ASSIGNED', 'ANY'].includes(principal.customerAccess)) {
      return false;
    }
    if (principal.type === 'CUSTOMER') {
      return Boolean(principal.customerId && UUID_PATTERN.test(principal.customerId));
    }
    if (principal.customerId && !UUID_PATTERN.test(principal.customerId)) {
      return false;
    }
    return true;
  }

  private async recordDecision(decision: AuthorizationDecision): Promise<void> {
    const entityId =
      decision.resourceId && UUID_PATTERN.test(decision.resourceId)
        ? decision.resourceId
        : decision.principalId && UUID_PATTERN.test(decision.principalId)
          ? decision.principalId
          : SYSTEM_ENTITY_ID;
    await this.dataSource.transaction(async (manager: EntityManager) => {
      await this.auditService.record(manager, {
        entityType: 'AUTHORIZATION_DECISION',
        entityId,
        action: decision.allowed ? 'ALLOWED' : 'DENIED',
        actor: decision.principalId ?? 'unauthenticated',
        newValues: {
          allowed: decision.allowed,
          reason: decision.reason ?? null,
          principalType: decision.principalType ?? null,
          resourceType: decision.resourceType,
          resourceId: decision.resourceId ?? null,
          customerId: decision.customerId ?? null,
          action: decision.action,
          requiredScopes: decision.requiredScopes,
          requiredRoles: decision.requiredRoles,
          evaluatedAt: decision.evaluatedAt,
        },
      });
    });
  }
}

export function assertAuthorizationText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TEXT_LENGTH) {
    throw new BadRequestException(`${field} must contain 1 to ${MAX_TEXT_LENGTH} characters`);
  }
  return normalized;
}
