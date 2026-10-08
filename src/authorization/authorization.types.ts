export type AuthorizationPrincipalType =
  | 'CUSTOMER'
  | 'AGENT'
  | 'AGGREGATOR'
  | 'SUPPORT'
  | 'OPERATOR'
  | 'SERVICE'
  | 'PRIVILEGED';

export type CustomerAccessScope = 'NONE' | 'SELF' | 'ASSIGNED' | 'ANY';
export type AgentAccessScope = 'NONE' | 'SELF' | 'ASSIGNED' | 'ANY';
export type AggregatorAccessScope = 'NONE' | 'SELF' | 'ASSIGNED' | 'ANY';
export type AssuranceLevel = 'PASSWORD' | 'MFA';

export interface AuthorizationPrincipal {
  type: AuthorizationPrincipalType;
  principalId: string;
  customerId?: string;
  agentId?: string;
  aggregatorId?: string;
  sessionId?: string;
  audience?: string;
  roles: readonly string[];
  scopes: readonly string[];
  customerAccess: CustomerAccessScope;
  agentAccess?: AgentAccessScope;
  aggregatorAccess?: AggregatorAccessScope;
  assignedCustomerIds?: readonly string[];
  assuranceLevel?: AssuranceLevel;
  /**
   * V1-ADMIN-AUTHORIZATION-RUNTIME-01. Set only by A2WorkforceSessionService: true when every
   * catalogue role actually held by this principal is flagged `read_only` in
   * `authorization_roles` (and at least one catalogue role was recognized). Generalizes the
   * "FINANCE_AUDITOR may never mutate" boundary as a reusable, catalogue-driven flag instead of
   * a role-name check, so RuntimeAccessGuard can deny unsafe HTTP methods for ANY read-only role,
   * not just a hardcoded one. Always false/undefined for non-workforce principal types.
   */
  readOnlyPrincipal?: boolean;
}

export interface AuthorizationResource {
  type: string;
  id?: string;
  customerId?: string;
  agentId?: string;
  aggregatorId?: string;
  scope?: string;
}

export interface AuthorizationPolicy {
  resourceType: string;
  action: string;
  requiredScopes?: readonly string[];
  requiredRoles?: readonly string[];
  /**
   * V1-ADMIN-AUTHORIZATION-RUNTIME-01. Function codes from the `authorization_functions`
   * catalogue (e.g. `workforce.role.assign`) that the principal must hold in `principal.scopes`
   * (populated by A2WorkforceSessionService from `authorization_role_functions`). Evaluated with
   * the same all-of semantics as `requiredScopes`/`requiredRoles`, and in addition to them — this
   * does not replace either, it is a separate, catalogue-sourced authority a route may require.
   */
  requiredFunctions?: readonly string[];
  allowedPrincipalTypes?: readonly AuthorizationPrincipalType[];
  customerAccess?: CustomerAccessScope;
  agentAccess?: AgentAccessScope;
  aggregatorAccess?: AggregatorAccessScope;
  audience?: string;
  minimumAssurance?: AssuranceLevel;
}

export type AuthorizationDenialReason =
  | 'UNAUTHENTICATED'
  | 'INVALID_PRINCIPAL'
  | 'PRINCIPAL_TYPE_DENIED'
  | 'AUDIENCE_MISMATCH'
  | 'SCOPE_MISSING'
  | 'ROLE_MISSING'
  | 'FUNCTION_MISSING'
  | 'CUSTOMER_SCOPE_MISMATCH'
  | 'RESOURCE_SCOPE_MISSING'
  | 'MFA_REQUIRED'
  | 'RESOURCE_TYPE_MISMATCH'
  | 'POLICY_MISSING'
  | 'READ_ONLY_PRINCIPAL';

export interface AuthorizationDecision {
  allowed: boolean;
  reason?: AuthorizationDenialReason;
  principalType?: AuthorizationPrincipalType;
  principalId?: string;
  resourceType: string;
  resourceId?: string;
  customerId?: string;
  action: string;
  evaluatedAt: Date;
  requiredScopes: readonly string[];
  requiredRoles: readonly string[];
  /** Optional (unlike requiredScopes/requiredRoles) so pre-existing call sites that build an AuthorizationDecision-shaped object by hand (outside AuthorizationService.evaluate()) are not forced to add this field. */
  requiredFunctions?: readonly string[];
}

export interface AuthorizationRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
  authorizationDecision?: AuthorizationDecision;
}
