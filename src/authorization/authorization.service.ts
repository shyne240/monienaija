import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import type {
  AuthorizationDecision,
  AuthorizationDenialReason,
  AuthorizationPolicy,
  AuthorizationPrincipal,
  AuthorizationPrincipalType,
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

  /**
   * V1-ADMIN-AUTHORIZATION-HARDENING-01: reusable, catalogue-backed replacement for the
   * one-off `principal.type === 'AGENT' || principal.type === 'CUSTOMER' || ...` deny-list
   * checks previously hand-written inside ~24 individual controllers. Each call site supplies
   * the catalogue `authorization_functions` code the operation actually requires (never
   * invented — must already exist in `authorization-catalogue.seed.ts`) plus the resource type
   * for audit attribution.
   *
   * `allowedPrincipalTypes` is accepted and AND-combined with the function check (not a
   * replacement for it) so this call can never be *less* restrictive than the principal-type
   * check it replaces — it can only narrow access further, from "any principal of this type"
   * down to "a principal of this type that also holds the specific catalogue function". This is
   * what closes the FINANCE_AUDITOR/OPERATOR-collapse gap: FINANCE_AUDITOR is principal.type
   * OPERATOR (so it still passes any existing `allowedPrincipalTypes` gate) but holds zero
   * EXECUTE-level catalogue functions, so `requiredFunctions` now denies it where it previously
   * succeeded purely by virtue of its principal type.
   *
   * Records an audit decision via `authorize()` (not the non-auditing `evaluate()`), matching
   * the existing FINANCE_ROLE_ASSIGN/REVOKE pattern in `workforce-administration.controller.ts`.
   */
  async requireFunction(
    principal: AuthorizationPrincipal | undefined,
    functionCode: string,
    resourceType: string,
    allowedPrincipalTypes?: readonly AuthorizationPrincipalType[],
    options?: {
      /**
       * V1-ADMIN-AUTHORIZATION-READ-SURFACE-01 (§6): some pre-existing controllers this method
       * replaces used `UnauthorizedException` (401) rather than `ForbiddenException` (403) for
       * an authenticated-but-wrong-*identity-shape* caller — e.g. a workforce-issued session
       * masquerading as CUSTOMER/SUPPORT/AGGREGATOR on a lifecycle route (`PRINCIPAL_TYPE_DENIED`
       * or `INVALID_PRINCIPAL`). This is a legacy, deliberately-named convention ("S-FIX-01
       * convention" / "UAT-DEFECT-001 boundary") that predates this task and is preserved
       * verbatim — every denial reason OTHER than `FUNCTION_MISSING` keeps exactly its
       * pre-existing status code when this option is set.
       *
       * It deliberately EXCLUDES `FUNCTION_MISSING`: a principal whose type is genuinely
       * permitted on this route (a real OPERATOR/SERVICE/PRIVILEGED workforce session) but which
       * lacks the specific catalogue function is fully authenticated and simply unauthorized for
       * this one action — correct HTTP semantics are 403, never 401. Before this fix,
       * `deniedStatus: 401` forced 401 for every denial reason including `FUNCTION_MISSING`,
       * which incorrectly collapsed a genuine FINANCE_AUDITOR authorization failure
       * (principal.type === 'OPERATOR', entitled on the route, but missing
       * `customer.suspend`/`.activate`/`.close`) into an authentication-shaped response code.
       */
      deniedStatus?: 401 | 403;
    },
  ): Promise<string> {
    if (!principal) {
      throw new UnauthorizedException('Authentication required');
    }
    const decision = await this.authorize(
      principal,
      {
        resourceType,
        action: functionCode,
        ...(allowedPrincipalTypes ? { allowedPrincipalTypes } : {}),
        requiredFunctions: [functionCode],
        customerAccess: 'NONE',
      },
      { type: resourceType },
    );
    if (!decision.allowed) {
      if (decision.reason === 'UNAUTHENTICATED') {
        throw new UnauthorizedException('Authentication required');
      }
      if (options?.deniedStatus === 401 && decision.reason !== 'FUNCTION_MISSING') {
        throw new UnauthorizedException('Privileged access required');
      }
      throw new ForbiddenException(`Authorization denied: ${decision.reason}`);
    }
    return principal.principalId;
  }

  evaluate(
    principal: AuthorizationPrincipal | undefined,
    policy: AuthorizationPolicy | undefined,
    resource: AuthorizationResource,
  ): AuthorizationDecision {
    const evaluatedAt = new Date();
    const requiredScopes = policy?.requiredScopes ?? [];
    const requiredRoles = policy?.requiredRoles ?? [];
    const requiredFunctions = policy?.requiredFunctions ?? [];
    const base = {
      resourceType: resource.type,
      resourceId: resource.id,
      customerId: resource.customerId,
      action: policy?.action ?? 'UNKNOWN',
      evaluatedAt,
      requiredScopes,
      requiredRoles,
      requiredFunctions,
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
    if (!requiredFunctions.every((fn) => principal.scopes.includes(fn))) {
      return {
        ...base,
        allowed: false,
        reason: 'FUNCTION_MISSING',
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

    const agentReason = this.checkAgentScope(principal, policy.agentAccess, resource);
    if (agentReason) {
      return {
        ...base,
        allowed: false,
        reason: agentReason,
        principalType: principal.type,
        principalId: principal.principalId,
      };
    }

    const aggregatorReason = this.checkAggregatorScope(principal, policy.aggregatorAccess, resource);
    if (aggregatorReason) {
      return {
        ...base,
        allowed: false,
        reason: aggregatorReason,
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
      if (principal.type === 'CUSTOMER') {
        return principal.customerId === resource.customerId ? undefined : 'CUSTOMER_SCOPE_MISMATCH';
      }
      // V1-ADMIN-FULL-SURFACE-AUDIT-01: `SELF` expresses "this CUSTOMER may only act on
      // its own customerId" — a concept that only has meaning for the CUSTOMER principal
      // type, which has a customerId of its own to compare against. For any other
      // principal type, `evaluate()` has already independently gated on
      // `policy.allowedPrincipalTypes` earlier in this same decision — if a non-CUSTOMER
      // principal type reached this point, the route already explicitly declared it
      // allowed, and re-applying a customer-self-identity concept it cannot satisfy by
      // definition (it has no customerId) must not be treated as an automatic mismatch.
      // Previously this returned CUSTOMER_SCOPE_MISMATCH unconditionally for every
      // non-CUSTOMER principal, silently overriding `allowedPrincipalTypes` for any
      // resource-ID-scoped route (e.g. the generic `/api/v1/customers/:id` surface, which
      // declares SUPPORT/OPERATOR/SERVICE/PRIVILEGED as allowed but could never actually
      // be reached by them because of this check).
      return undefined;
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

  private checkAgentScope(
    principal: AuthorizationPrincipal,
    policyScope: string | undefined,
    resource: AuthorizationResource,
  ): AuthorizationDenialReason | undefined {
    if (!resource.agentId) {
      return undefined;
    }
    // Agent resources require explicit AGENT principal with matching agentId when SELF is required
    const access = policyScope ?? (principal.type === 'AGENT' ? 'SELF' : undefined);
    if (!access) {
      return 'RESOURCE_SCOPE_MISSING';
    }
    if (access === 'NONE') {
      return 'CUSTOMER_SCOPE_MISMATCH';
    }
    if (access === 'SELF') {
      return principal.type === 'AGENT' && principal.agentId === resource.agentId
        ? undefined
        : 'CUSTOMER_SCOPE_MISMATCH';
    }
    if (access === 'ASSIGNED' || access === 'ANY') {
      // No assigned agent model yet; require explicit match or fail closed
      return 'RESOURCE_SCOPE_MISSING';
    }
    return undefined;
  }

  private checkAggregatorScope(
    principal: AuthorizationPrincipal,
    policyScope: string | undefined,
    resource: AuthorizationResource,
  ): AuthorizationDenialReason | undefined {
    if (!resource.aggregatorId) {
      return undefined;
    }
    const access = policyScope ?? (principal.type === 'AGGREGATOR' ? 'SELF' : undefined);
    if (!access) {
      return 'RESOURCE_SCOPE_MISSING';
    }
    if (access === 'NONE') {
      return 'CUSTOMER_SCOPE_MISMATCH';
    }
    if (access === 'SELF') {
      return principal.type === 'AGGREGATOR' && principal.aggregatorId === resource.aggregatorId
        ? undefined
        : 'CUSTOMER_SCOPE_MISMATCH';
    }
    if (access === 'ASSIGNED' || access === 'ANY') {
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
    if (principal.agentAccess && !['NONE', 'SELF', 'ASSIGNED', 'ANY'].includes(principal.agentAccess)) {
      return false;
    }
    if (principal.aggregatorAccess && !['NONE', 'SELF', 'ASSIGNED', 'ANY'].includes(principal.aggregatorAccess)) {
      return false;
    }
    if (principal.type === 'CUSTOMER') {
      return Boolean(
        principal.customerId &&
          UUID_PATTERN.test(principal.customerId) &&
          !principal.agentId &&
          !principal.aggregatorId,
      );
    }
    if (principal.type === 'AGENT') {
      return Boolean(
        principal.agentId && UUID_PATTERN.test(principal.agentId) && !principal.customerId && !principal.aggregatorId,
      );
    }
    if (principal.type === 'AGGREGATOR') {
      return Boolean(
        principal.aggregatorId && UUID_PATTERN.test(principal.aggregatorId) && !principal.customerId && !principal.agentId,
      );
    }
    if (principal.customerId && !UUID_PATTERN.test(principal.customerId)) {
      return false;
    }
    if (principal.agentId && !UUID_PATTERN.test(principal.agentId)) {
      return false;
    }
    if (principal.aggregatorId && !UUID_PATTERN.test(principal.aggregatorId)) {
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
          requiredFunctions: decision.requiredFunctions ?? [],
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
