import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type {
  FinancialInstitutionStatus,
  FinancialInstitutionType,
  InstitutionAffiliationChangeKind,
  InstitutionAffiliationEvidenceType,
  InstitutionAffiliationStatus,
} from './institution.enums';

/**
 * Authoritative institutional resolution contract.
 *
 * The resolver NEVER returns a bare nullable identifier: absence, non-configuration, inactive
 * institution and conflicting affiliation are distinct, explicit outcomes that a consumer must
 * handle. `undefined`/`null` is not a valid result.
 */
export type InstitutionResolutionOutcome =
  | 'RESOLVED'
  | 'UNRESOLVED'
  | 'NOT_CONFIGURED'
  | 'INSTITUTION_INACTIVE'
  | 'INVALID_AFFILIATION';

export type InstitutionUnresolvedReason =
  | 'NO_AFFILIATION'
  | 'AFFILIATION_SUSPENDED'
  | 'CONFLICTING_AFFILIATION'
  | 'INSTITUTION_MISSING'
  | 'INSTITUTION_REGISTERED'
  | 'INSTITUTION_EVIDENCE_SUBMITTED'
  | 'INSTITUTION_SUSPENDED'
  | 'INSTITUTION_CLOSED'
  | 'SCHEMA_NOT_CONFIGURED';

export interface ResolvedInstitution {
  readonly outcome: 'RESOLVED';
  readonly agentId: string;
  readonly institutionId: string;
  readonly affiliationId: string;
  /** Always `APPROVED` when resolved; present for evidence/audit symmetry. */
  readonly institutionStatus: FinancialInstitutionStatus;
  readonly resolvedAt: string;
  /** Deterministic digest of this exact resolution, safe to bind into an evidence fingerprint. */
  readonly evidenceFingerprint: string;
}

export interface UnresolvedInstitution {
  readonly outcome: Exclude<InstitutionResolutionOutcome, 'RESOLVED'>;
  readonly agentId: string;
  readonly institutionId: string | null;
  readonly affiliationId: string | null;
  readonly reason: InstitutionUnresolvedReason;
  readonly resolvedAt: string;
  readonly evidenceFingerprint: string;
}

export type InstitutionResolution = ResolvedInstitution | UnresolvedInstitution;

export interface ResolveInstitutionOptions {
  /**
   * `SHARE` (default) takes row-share locks on the current affiliation row and on the institution
   * row for the remainder of the caller's transaction, so a concurrent affiliation or lifecycle
   * change cannot commit underneath an in-flight financial authorization. `NONE` is read-only and
   * MUST NOT be used by a financial authorization path.
   */
  readonly lock?: 'SHARE' | 'NONE';
}

/** Financial authority decision for one operation. */
export type InstitutionEnforcementMode = 'ADVISORY' | 'ENFORCED';

export interface FinancialInstitutionView {
  id: string;
  reference: string;
  code: string;
  legalName: string;
  displayName: string | null;
  institutionType: FinancialInstitutionType;
  regulatorName: string | null;
  licenceReference: string | null;
  evidenceReference: string | null;
  evidenceDigest: string | null;
  status: FinancialInstitutionStatus;
  statusReason: string | null;
  /** True only for `APPROVED`: the single condition that authorizes financial services. */
  operationalAuthority: boolean;
  operationalApprovedAt: string | null;
  suspendedAt: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InstitutionAffiliationView {
  affiliationId: string;
  agentId: string;
  institutionId: string;
  status: InstitutionAffiliationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  evidenceType: InstitutionAffiliationEvidenceType;
  evidenceReference: string;
  approvalId: string;
  changeKind: InstitutionAffiliationChangeKind;
  executedAt: string;
}

export interface RegisterInstitutionCommand {
  reference: string;
  code: string;
  legalName: string;
  displayName?: string | null;
  institutionType: FinancialInstitutionType;
  regulatorName?: string | null;
  licenceReference?: string | null;
  principal: AuthorizationPrincipal;
}

export interface RecordRegulatoryEvidenceCommand {
  institutionId: string;
  evidenceReference: string;
  evidenceDigest?: string | null;
  regulatorName?: string | null;
  licenceReference?: string | null;
  principal: AuthorizationPrincipal;
}

export interface RequestInstitutionLifecycleCommand {
  institutionId: string;
  targetStatus:
    | FinancialInstitutionStatus.APPROVED
    | FinancialInstitutionStatus.SUSPENDED
    | FinancialInstitutionStatus.CLOSED;
  reason: string;
  principal: AuthorizationPrincipal;
  expiresInSeconds?: number;
  now?: Date;
}

export interface ExecuteInstitutionLifecycleCommand extends RequestInstitutionLifecycleCommand {
  approvalId: string;
}

export interface RequestInstitutionAffiliationCommand {
  agentId: string;
  institutionId: string;
  changeKind: InstitutionAffiliationChangeKind;
  evidenceType: InstitutionAffiliationEvidenceType;
  evidenceReference: string;
  reason: string;
  principal: AuthorizationPrincipal;
  expiresInSeconds?: number;
  now?: Date;
}

export interface ExecuteInstitutionAffiliationCommand extends RequestInstitutionAffiliationCommand {
  approvalId: string;
}

export interface InstitutionAttributionGapView {
  entity: 'AGENT';
  entityId: string;
  entityReference: string;
  gapReason: string;
  institutionId: string | null;
  affiliationStatus: InstitutionAffiliationStatus | null;
  institutionStatus: FinancialInstitutionStatus | null;
}

export interface WorkforceInstitutionAssignmentView {
  id: string;
  principalId: string;
  institutionId: string;
  status: 'ACTIVE' | 'REVOKED';
  grantedBy: string;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
}
