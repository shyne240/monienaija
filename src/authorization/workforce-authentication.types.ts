import type { AuthorizationPrincipal } from './authorization.types';

export interface A2TrustedJwkV1 {
  readonly kid: string;
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
  readonly alg?: 'RS256';
  readonly use?: 'sig';
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
  readonly revoked?: boolean;
  readonly environment?: string;
}
export interface A2FinanceRoleDefinitionV1 {
  readonly roleKey: string;
  readonly displayName: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly scopes: readonly string[];
  readonly applicableActions: readonly string[];
  readonly mfaRequired: boolean;
  readonly approvalCapability: boolean;
  readonly makerEligible: boolean;
  readonly checkerEligible: boolean;
  readonly administrativeCapability: boolean;
}
export interface A2MakerCheckerRuleV1 {
  readonly action: string;
  readonly initiatingRoles: readonly string[];
  readonly approvingRoles: readonly string[];
  readonly minimumApprovals: number;
  readonly separationRequired: boolean;
  readonly selfApprovalProhibited: boolean;
  readonly mfaRequired: boolean;
  readonly minimumAssurance: 'PASSWORD' | 'MFA';
  readonly materialityRequired: boolean;
}
export interface A2WorkforceConfigurationV1 {
  readonly enabled: boolean;
  readonly environment: string;
  readonly oidcIssuer: string;
  readonly oidcJwksUri: string;
  readonly oidcAudience: string;
  readonly oidcClientId: string;
  readonly internalAudience: string;
  readonly sessionTtlSeconds: number;
  readonly mfaFreshnessSeconds: number;
  readonly oidcJwksCacheSeconds: number;
  readonly oidcJwksMaxStalenessSeconds: number;
  readonly bootstrapEnabled: boolean;
  readonly bootstrapIssuer: string;
  readonly bootstrapAudience: string;
  readonly bootstrapKeys: readonly A2TrustedJwkV1[];
  readonly bootstrapFinanceAdminScopes: readonly string[];
  /**
   * V1-SECURITY-SUPER-ADMIN-RECOVERY-01: a structurally separate trust configuration from the
   * bootstrap settings above. `recoveryKeys` is sourced from its OWN env var
   * (`A2_RECOVERY_JWKS_JSON`), never the bootstrap JWKS set, so the two ceremonies never share a
   * signing-key custody chain even though both verify RS256 statements with the same generic
   * crypto code (workforce-crypto.ts).
   */
  readonly recoveryEnabled: boolean;
  readonly recoveryAudience: string;
  readonly recoveryKeys: readonly A2TrustedJwkV1[];
  readonly roles: readonly A2FinanceRoleDefinitionV1[];
  readonly makerCheckerRules: readonly A2MakerCheckerRuleV1[];
  readonly rateLimits: readonly A2RateLimitRuleV1[];
  readonly trustedProxyAddresses: readonly string[];
}
export interface A2WorkforceAssertionEvidenceV1 {
  readonly issuer: string;
  readonly subject: string;
  readonly principalId: string;
  readonly audience: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authenticatedAt: string;
  readonly assuranceLevel: 'PASSWORD' | 'MFA';
  readonly amr: readonly string[];
  readonly acr: string | null;
  readonly signingKeyId: string;
}
export interface A2WorkforceSessionTokenV1 {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly principal: AuthorizationPrincipal;
}
export interface A2BootstrapStatementV1 {
  readonly schemaVersion: 1;
  readonly environment: string;
  readonly issuer: string;
  readonly workforceSubject: string;
  readonly principalId: string;
  readonly initialRoleKey: 'SUPER_ADMIN';
  readonly scopes: readonly string[];
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly audience: string;
  readonly approvalChangeReference: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signingKeyReference: string;
}
/**
 * V1-SECURITY-SUPER-ADMIN-RECOVERY-01 — the signed, externally-produced statement authorizing
 * consumption of the protected SUPER_ADMIN recovery ceremony (see
 * docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-DECISIONS-01.md §3 and
 * docs/deployment/V1-SUPER-ADMIN-RECOVERY-RUNBOOK-01.md for the full format/process). Unlike
 * `A2BootstrapStatementV1`, this never grants a new role window — it only ever names an
 * EXISTING active SUPER_ADMIN assignment for revocation, so it carries no `scopes`/
 * `effectiveFrom`/`effectiveTo`. `operation` is a closed, versioned vocabulary — today exactly
 * one value is supported; the field exists so adding a future distinct recovery operation never
 * requires a new statement schema or a new signing-key configuration surface.
 */
export interface A2RecoveryStatementV1 {
  readonly schemaVersion: 1;
  readonly operation: 'REVOKE_SUPER_ADMIN';
  readonly environment: string;
  readonly audience: string;
  readonly targetAssignmentReference: string;
  readonly targetPrincipalId: string;
  readonly reason: string;
  readonly approvalChangeReference: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signingKeyReference: string;
}
export interface A2SuperAdminRecoveryViewV1 {
  readonly recoveryReference: string;
  readonly operation: 'REVOKE_SUPER_ADMIN';
  readonly targetAssignmentReference: string;
  readonly targetPrincipalId: string;
  readonly reason: string;
  readonly revokedSessionCount: number;
  readonly consumedBy: string;
  readonly consumedAt: string;
  readonly auditReference: string;
}
export interface A2FinanceRoleAssignmentViewV1 {
  readonly assignmentReference: string;
  readonly assignmentVersion: number;
  readonly principalId: string;
  readonly roleKey: string;
  readonly scopes: readonly string[];
  readonly status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  readonly interim: true;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly assignedBy: string;
  readonly assignedAt: string;
  readonly revokedBy: string | null;
  readonly revokedAt: string | null;
  readonly bootstrapReference: string | null;
  readonly approvalIds: readonly string[];
  readonly auditReferences: readonly string[];
}
export interface A2RoleAssignmentCommandV1 {
  readonly targetPrincipalId: string;
  readonly roleKey: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly approvalIds?: readonly string[];
  readonly expectedVersion?: number;
  readonly principal: AuthorizationPrincipal;
  readonly correlationId: string;
  readonly now?: Date;
}
export interface A2RateLimitRuleV1 {
  readonly category: string;
  readonly capacity: number;
  readonly refillRatePerSecond: number;
  readonly enabled: boolean;
}
