export type AuthorizationPrincipalType =
  | 'CUSTOMER'
  /**
   * A6 — Agent is a first-class participant principal, NOT a customer and NOT
   * an internal/administrative principal. Adding it to the union grants
   * nothing by itself: every existing policy names its `allowedPrincipalTypes`
   * explicitly and none of them names AGENT, so agent principals remain denied
   * everywhere until an action opts them in.
   */
  | 'AGENT'
  | 'SUPPORT'
  | 'OPERATOR'
  | 'SERVICE'
  | 'PRIVILEGED';

export type CustomerAccessScope = 'NONE' | 'SELF' | 'ASSIGNED' | 'ANY';

/**
 * A6 — Agent resource access. Deliberately a SEPARATE field from
 * `customerAccess` (ADR-0093 §11): reusing customer SELF for agents would make
 * every existing customer-scoped policy reachable by an agent principal.
 */
export type AgentAccessScope = 'NONE' | 'SELF';
export type AssuranceLevel = 'PASSWORD' | 'MFA';

export interface AuthorizationPrincipal {
  type: AuthorizationPrincipalType;
  principalId: string;
  customerId?: string;
  sessionId?: string;
  audience?: string;
  roles: readonly string[];
  scopes: readonly string[];
  customerAccess: CustomerAccessScope;
  assignedCustomerIds?: readonly string[];
  assuranceLevel?: AssuranceLevel;
  /** A6 — canonical Agent identity when `type` is AGENT. Never a customer id. */
  agentId?: string;
  /** A6 — agent resource access. Defaults to NONE for every non-agent principal. */
  agentAccess?: AgentAccessScope;
}

export interface AuthorizationResource {
  type: string;
  id?: string;
  customerId?: string;
  /** A6 — owning Agent of the resource, when the resource is agent-owned. */
  agentId?: string;
  scope?: string;
}

export interface AuthorizationPolicy {
  resourceType: string;
  action: string;
  requiredScopes?: readonly string[];
  requiredRoles?: readonly string[];
  allowedPrincipalTypes?: readonly AuthorizationPrincipalType[];
  customerAccess?: CustomerAccessScope;
  /** A6 — required agent access for agent-owned resources. */
  agentAccess?: AgentAccessScope;
  audience?: string;
  minimumAssurance?: AssuranceLevel;
}

export type AuthorizationDenialReason =
  | 'UNAUTHENTICATED'
  | 'INVALID_PRINCIPAL'
  | 'PRINCIPAL_TYPE_DENIED'
  | 'AGENT_SCOPE_MISMATCH'
  | 'AUDIENCE_MISMATCH'
  | 'SCOPE_MISSING'
  | 'ROLE_MISSING'
  | 'CUSTOMER_SCOPE_MISMATCH'
  | 'RESOURCE_SCOPE_MISSING'
  | 'MFA_REQUIRED'
  | 'RESOURCE_TYPE_MISMATCH'
  | 'POLICY_MISSING';

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
}

export interface AuthorizationRequest {
  authorizationPrincipal?: AuthorizationPrincipal;
  authorizationDecision?: AuthorizationDecision;
}
