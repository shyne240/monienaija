export type AuthorizationPrincipalType =
  | 'CUSTOMER'
  | 'SUPPORT'
  | 'OPERATOR'
  | 'SERVICE'
  | 'PRIVILEGED';

export type CustomerAccessScope = 'NONE' | 'SELF' | 'ASSIGNED' | 'ANY';
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
}

export interface AuthorizationResource {
  type: string;
  id?: string;
  customerId?: string;
  scope?: string;
}

export interface AuthorizationPolicy {
  resourceType: string;
  action: string;
  requiredScopes?: readonly string[];
  requiredRoles?: readonly string[];
  allowedPrincipalTypes?: readonly AuthorizationPrincipalType[];
  customerAccess?: CustomerAccessScope;
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
