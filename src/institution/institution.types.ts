import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type {
  CustomerInstitutionEnrolmentStatus,
  FinancialInstitutionStatus,
  FinancialInstitutionType,
  InstitutionAffiliationChangeKind,
  InstitutionAffiliationEvidenceType,
  InstitutionAffiliationStatus,
  InstitutionAttributionEvidenceType,
  InstitutionFinancialEligibility,
  LedgerInstitutionalPurpose,
  LedgerInstitutionalScope,
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

// --------------------------------------------------------------------------- Phase 2 additions

export interface CustomerInstitutionEnrolmentView {
  id: string;
  reference: string;
  customerId: string;
  institutionId: string;
  status: CustomerInstitutionEnrolmentStatus;
  statusReason: string | null;
  financialEligibility: InstitutionFinancialEligibility;
  kycReuseAuthorized: boolean;
  consentReference: string | null;
  policyReference: string | null;
  approvalId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
}

export interface RequestEnrolmentCommand {
  customerId: string;
  institutionId: string;
  reference: string;
  targetStatus: CustomerInstitutionEnrolmentStatus;
  financialEligibility?: InstitutionFinancialEligibility;
  statusReason: string;
  /** KYC reuse is opt-in and requires consent + policy + evidence references together. */
  kycReuse?: {
    evidenceReference: string;
    consentReference: string;
    policyReference: string;
  } | null;
  principal: AuthorizationPrincipal;
  expiresInSeconds?: number;
  now?: Date;
}

export interface ExecuteEnrolmentCommand extends RequestEnrolmentCommand {
  approvalId: string;
}

export interface WalletInstitutionAttributionView {
  attributionId: string;
  approvalId: string;
  walletId: string;
  ledgerAccountId: string;
  institutionId: string;
  ownerClass: string;
  ownerReference: string;
  evidenceType: InstitutionAttributionEvidenceType;
  evidenceReference: string;
  executedBy: string;
  executedAt: string;
}

export interface RequestWalletAttributionCommand {
  walletId: string;
  institutionId: string;
  evidenceType: InstitutionAttributionEvidenceType;
  evidenceReference: string;
  reason: string;
  principal: AuthorizationPrincipal;
  expiresInSeconds?: number;
  now?: Date;
}

export interface ExecuteWalletAttributionCommand extends RequestWalletAttributionCommand {
  approvalId: string;
  /** TEST-ONLY: forces a failure after the rows are written, proving atomic rollback. */
  _simulateFailureAfterAttribution?: boolean;
}

export interface InstitutionLedgerAccountView {
  id: string;
  code: string;
  name: string;
  accountType: string;
  normalBalance: string;
  currency: string;
  institutionalScope: LedgerInstitutionalScope;
  institutionId: string | null;
  institutionalPurpose: LedgerInstitutionalPurpose | null;
  isActive: boolean;
}

export interface OpenInstitutionLedgerAccountCommand {
  institutionId: string;
  code: string;
  name: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  normalBalance: 'DEBIT' | 'CREDIT';
  currency: string;
  purpose:
    | LedgerInstitutionalPurpose.SETTLEMENT
    | LedgerInstitutionalPurpose.SUSPENSE
    | LedgerInstitutionalPurpose.CLEARING;
  allowNegativeBalance?: boolean;
  principal: AuthorizationPrincipal;
}

export interface DesignatePlatformLedgerAccountCommand {
  ledgerAccountId: string;
  principal: AuthorizationPrincipal;
}

/** One resolved financial party (wallet, ledger account, institution, enrolment). */
export interface FinancialContextParty {
  kind: 'WALLET' | 'LEDGER_ACCOUNT';
  id: string;
  ledgerAccountId: string | null;
  ownerClass: string | null;
  ownerReference: string | null;
  institutionId: string | null;
  institutionalScope: LedgerInstitutionalScope | null;
  institutionalPurpose: LedgerInstitutionalPurpose | null;
}

export type FinancialContextOutcome =
  | 'RESOLVED'
  | 'UNRESOLVED'
  | 'NOT_CONFIGURED'
  | 'INSTITUTION_INACTIVE'
  | 'INCOMPATIBLE';

export type FinancialContextReason =
  | 'NO_INSTITUTION_CONTEXT'
  | 'UNATTRIBUTED_WALLET'
  | 'UNATTRIBUTED_LEDGER_ACCOUNT'
  | 'CROSS_INSTITUTION'
  | 'INSTITUTION_SUSPENDED'
  | 'INSTITUTION_NOT_APPROVED'
  | 'AGENT_AFFILIATION_UNAVAILABLE'
  | 'CUSTOMER_NOT_ENROLLED'
  | 'CUSTOMER_NOT_ELIGIBLE'
  | 'ENROLMENT_SUSPENDED'
  | 'PLATFORM_ACCOUNT_IN_INSTITUTIONAL_CONTEXT'
  | 'SCHEMA_NOT_CONFIGURED';

/**
 * Reusable financial context contract (ARENA 4 Phase 2 §5). Financial products use it to establish
 * and validate the institutional context of a prospective operation *inside their own transaction*.
 * It never returns a bare institution id: absence, non-configuration, inactivity and incompatibility
 * are distinct outcomes with explicit reasons.
 */
export interface FinancialContext {
  outcome: FinancialContextOutcome;
  reasons: FinancialContextReason[];
  institutionId: string | null;
  institutionStatus: FinancialInstitutionStatus | null;
  agentAffiliation: InstitutionResolution | null;
  customerEnrolment: CustomerInstitutionEnrolmentView | null;
  parties: FinancialContextParty[];
  resolvedAt: string;
  evidenceFingerprint: string;
}

export interface FinancialContextRequest {
  institutionId?: string;
  agentId?: string;
  customerId?: string;
  walletIds?: string[];
  ledgerAccountIds?: string[];
  /** Financial authorization paths must hold SHARE locks for the whole transaction. */
  lock?: 'SHARE' | 'NONE';
}

export interface UnattributedFinancialAccountView {
  entity: 'WALLET' | 'LEDGER_ACCOUNT';
  entityId: string;
  ownerClass: string | null;
  ownerReference: string | null;
  currency: string;
  status: string;
  ledgerAccountId: string;
  ledgerLineCount: number;
  balanceMinor: string;
}

// --------------------------------------------------- ARENA 4 Phase 3: console read models

/**
 * A governed-action request related to one institution, as shown in the console.
 *
 * Only metadata is exposed: the frozen approval payload stays server-side, and the console never
 * re-derives a decision from it. `awaitingChecker` mirrors the approval status, so a maker can see
 * that an independent checker has not yet decided and a checker can see what still needs execution.
 */
export interface InstitutionPendingApprovalView {
  approvalId: string;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  requesterPrincipalId: string;
  approvedBy: string | null;
  status: 'REQUESTED' | 'APPROVED';
  reason: string;
  requestedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  awaitingChecker: boolean;
}

/**
 * One agent's institutional relationship, for the affiliation directory.
 *
 * `relationship` is deliberately a three-way classification so the console can state plainly that
 * an aggregator link is not an institutional affiliation:
 *  - `INSTITUTION_AFFILIATED` — an authoritative ACTIVE affiliation row exists;
 *  - `AGGREGATOR_LINKED` — only an aggregator assignment exists (never treated as affiliation);
 *  - `INDEPENDENT` — neither exists.
 */
export interface AgentAffiliationDirectoryRow {
  agentId: string;
  agentReference: string;
  agentStatus: string;
  affiliationId: string | null;
  affiliationInstitutionId: string | null;
  affiliationStatus: 'ACTIVE' | null;
  affiliationEffectiveFrom: string | null;
  aggregatorId: string | null;
  aggregatorReference: string | null;
  relationship: 'INSTITUTION_AFFILIATED' | 'AGGREGATOR_LINKED' | 'INDEPENDENT';
}
