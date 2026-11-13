import { ApiClient } from './api-client';

/**
 * ARENA 4 Phase 3 — institutional administration console API layer.
 *
 * Thin, typed wrappers over the endpoints that already exist (Phase 1/2 institution module) plus the
 * two read-only console reads added for this console (`pending-approvals`, `institution-agent-directory`).
 *
 * Nothing here fabricates data, introduces a second approval system, or performs a financial action
 * on its own: every write is a governed request/execute pair whose approval is decided by the
 * existing privileged-approval infrastructure.
 */

export type InstitutionStatus =
  | 'REGISTERED'
  | 'EVIDENCE_SUBMITTED'
  | 'APPROVED'
  | 'SUSPENDED'
  | 'CLOSED';

export type InstitutionType =
  | 'MMO'
  | 'COMMERCIAL_BANK'
  | 'MICROFINANCE_BANK'
  | 'PAYMENT_SERVICE_BANK'
  | 'PSP'
  | 'PARTNER';

export type AffiliationStatus = 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
export type AffiliationChangeKind = 'ASSIGN' | 'TRANSFER' | 'SUSPEND' | 'REACTIVATE' | 'TERMINATE';
export type AffiliationEvidenceType =
  | 'INSTITUTION_APPROVAL_LETTER'
  | 'REGULATOR_RECORD'
  | 'OPERATIONAL_DIRECTIVE'
  | 'CONTRACT_REFERENCE'
  | 'AGGREGATOR_RELATIONSHIP';

export type EnrolmentStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type FinancialEligibility = 'PENDING_KYC' | 'ELIGIBLE' | 'RESTRICTED';
export type AttributionEvidenceType =
  | 'INSTITUTION_AGREEMENT'
  | 'CUSTOMER_MANDATE'
  | 'REGULATOR_RECORD'
  | 'OPERATIONAL_DIRECTIVE'
  | 'SETTLEMENT_INSTRUCTION';
export type LedgerPurpose = 'SETTLEMENT' | 'SUSPENSE' | 'CLEARING';

export interface InstitutionSummary {
  id: string;
  reference: string;
  code: string;
  legalName: string;
  displayName: string | null;
  institutionType: InstitutionType;
  regulatorName: string | null;
  licenceReference: string | null;
  evidenceReference: string | null;
  evidenceDigest: string | null;
  status: InstitutionStatus;
  statusReason: string | null;
  operationalAuthority: boolean;
  operationalApprovedAt: string | null;
  suspendedAt: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InstitutionAffiliation {
  affiliationId: string;
  agentId: string;
  institutionId: string;
  status: AffiliationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  evidenceType: AffiliationEvidenceType;
  evidenceReference: string;
  approvalId: string;
  changeKind: AffiliationChangeKind;
  executedAt: string;
}

export interface WorkforceAssignment {
  id: string;
  principalId: string;
  institutionId: string;
  status: 'ACTIVE' | 'REVOKED';
  grantedBy: string;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
}

export interface CustomerEnrolment {
  id: string;
  reference: string;
  customerId: string;
  institutionId: string;
  status: EnrolmentStatus;
  statusReason: string | null;
  financialEligibility: FinancialEligibility;
  kycReuseAuthorized: boolean;
  consentReference: string | null;
  policyReference: string | null;
  approvalId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
}

export interface AttributionRecord {
  attributionId: string;
  approvalId: string;
  walletId: string;
  ledgerAccountId: string;
  institutionId: string;
  ownerClass: string;
  ownerReference: string;
  evidenceType: AttributionEvidenceType;
  evidenceReference: string;
  executedBy: string;
  executedAt: string;
}

export interface InstitutionLedgerAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
  normalBalance: string;
  currency: string;
  institutionalScope: 'UNATTRIBUTED' | 'INSTITUTION' | 'PLATFORM';
  institutionId: string | null;
  institutionalPurpose: LedgerPurpose | 'CUSTOMER_FUNDS' | 'PLATFORM_OPERATIONS' | null;
  isActive: boolean;
}

export interface UnattributedAccount {
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

export interface InstitutionCoverage {
  institutionId: string;
  code: string;
  institutionStatus: string;
  activeEnrolments: number;
  activeAffiliations: number;
  attributedWallets: number;
  institutionalLedgerAccounts: number;
}

export interface AttributionGap {
  entity: 'AGENT';
  entityId: string;
  entityReference: string;
  gapReason: string;
  institutionId: string | null;
  affiliationStatus: AffiliationStatus | null;
  institutionStatus: InstitutionStatus | null;
}

export interface AttributionGapSummaryRow {
  gapReason: string;
  agentCount: number;
}

export interface PendingApproval {
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

export interface AgentDirectoryRow {
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

export interface AuditEventRow {
  id?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  actor?: string;
  occurredAt?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ApprovalDecisionResponse {
  approved?: boolean;
  reason?: string;
  approval?: { id?: string; status?: string };
}

export interface GovernedRequestReceipt {
  approvalId: string;
  status: string;
  actionFingerprint: string;
  expiresAt: string;
}

/** Defensive list normalisation: a list endpoint returning a non-array is a contract breach. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const institutions = '/internal/institutions';

export const InstitutionAdminApi = {
  // ---------------------------------------------------------------- directory + detail
  listInstitutions: () =>
    ApiClient.get<InstitutionSummary[]>(institutions).then((rows) =>
      asArray<InstitutionSummary>(rows),
    ),

  getInstitution: (institutionId: string) =>
    ApiClient.get<InstitutionSummary>(`${institutions}/${encodeURIComponent(institutionId)}`),

  registerInstitution: (body: {
    reference: string;
    code: string;
    legalName: string;
    displayName?: string;
    institutionType: InstitutionType;
    regulatorName?: string;
    licenceReference?: string;
  }) => ApiClient.post<InstitutionSummary>(institutions, body),

  recordEvidence: (
    institutionId: string,
    body: {
      evidenceReference: string;
      regulatorName?: string;
      licenceReference?: string;
    },
  ) =>
    ApiClient.post<InstitutionSummary>(
      `${institutions}/${encodeURIComponent(institutionId)}/evidence`,
      body,
    ),

  // ---------------------------------------------------------------- lifecycle (governed)
  requestLifecycle: (
    institutionId: string,
    body: { targetStatus: 'APPROVED' | 'SUSPENDED' | 'CLOSED'; reason: string },
  ) =>
    ApiClient.post<GovernedRequestReceipt>(
      `${institutions}/${encodeURIComponent(institutionId)}/lifecycle/request`,
      body,
    ),

  executeLifecycle: (
    institutionId: string,
    body: { approvalId: string; targetStatus: 'APPROVED' | 'SUSPENDED' | 'CLOSED'; reason: string },
  ) =>
    ApiClient.post<InstitutionSummary>(
      `${institutions}/${encodeURIComponent(institutionId)}/lifecycle`,
      body,
    ),

  // ---------------------------------------------------------------- workforce assignments
  listWorkforce: (institutionId: string) =>
    ApiClient.get<WorkforceAssignment[]>(
      `${institutions}/${encodeURIComponent(institutionId)}/workforce`,
    ).then((rows) => asArray<WorkforceAssignment>(rows)),

  grantWorkforce: (institutionId: string, principalId: string) =>
    ApiClient.post<WorkforceAssignment>(
      `${institutions}/${encodeURIComponent(institutionId)}/workforce`,
      { principalId },
    ),

  revokeWorkforce: (institutionId: string, principalId: string) =>
    ApiClient.delete<WorkforceAssignment>(
      `${institutions}/${encodeURIComponent(institutionId)}/workforce/${encodeURIComponent(principalId)}`,
    ),

  // ---------------------------------------------------------------- affiliations
  listInstitutionAffiliations: (institutionId: string) =>
    ApiClient.get<InstitutionAffiliation[]>(
      `${institutions}/${encodeURIComponent(institutionId)}/affiliations`,
    ).then((rows) => asArray<InstitutionAffiliation>(rows)),

  agentDirectory: (query: {
    institutionId?: string;
    affiliation?: 'AFFILIATED' | 'UNAFFILIATED';
    search?: string;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (query.institutionId) params.set('institutionId', query.institutionId);
    if (query.affiliation) params.set('affiliation', query.affiliation);
    if (query.search?.trim()) params.set('search', query.search.trim());
    if (query.limit) params.set('limit', String(query.limit));
    const suffix = params.toString();
    return ApiClient.get<AgentDirectoryRow[]>(
      `/internal/institution-agent-directory${suffix ? `?${suffix}` : ''}`,
    ).then((rows) => asArray<AgentDirectoryRow>(rows));
  },

  agentAffiliationHistory: (agentId: string) =>
    ApiClient.get<InstitutionAffiliation[]>(
      `/internal/agent-affiliations/${encodeURIComponent(agentId)}/history`,
    ).then((rows) => asArray<InstitutionAffiliation>(rows)),

  requestAffiliation: (
    agentId: string,
    body: {
      institutionId: string;
      changeKind: AffiliationChangeKind;
      evidenceType: AffiliationEvidenceType;
      evidenceReference: string;
      reason: string;
    },
  ) =>
    ApiClient.post<GovernedRequestReceipt>(
      `/internal/agent-affiliations/${encodeURIComponent(agentId)}/request`,
      body,
    ),

  executeAffiliation: (
    agentId: string,
    body: {
      institutionId: string;
      changeKind: AffiliationChangeKind;
      evidenceType: AffiliationEvidenceType;
      evidenceReference: string;
      reason: string;
      approvalId: string;
    },
  ) =>
    ApiClient.post<InstitutionAffiliation>(
      `/internal/agent-affiliations/${encodeURIComponent(agentId)}/execute`,
      body,
    ),

  // ---------------------------------------------------------------- customer enrolments
  listEnrolments: (institutionId: string) =>
    ApiClient.get<CustomerEnrolment[]>(
      `${institutions}/${encodeURIComponent(institutionId)}/enrolments`,
    ).then((rows) => asArray<CustomerEnrolment>(rows)),

  requestEnrolment: (
    institutionId: string,
    body: {
      customerId: string;
      reference: string;
      targetStatus: EnrolmentStatus;
      financialEligibility?: FinancialEligibility;
      statusReason: string;
      kycReuse?: { evidenceReference: string; consentReference: string; policyReference: string };
    },
  ) =>
    ApiClient.post<GovernedRequestReceipt>(
      `${institutions}/${encodeURIComponent(institutionId)}/enrolments`,
      body,
    ),

  executeEnrolment: (
    institutionId: string,
    body: {
      customerId: string;
      reference: string;
      targetStatus: EnrolmentStatus;
      financialEligibility?: FinancialEligibility;
      statusReason: string;
      kycReuse?: { evidenceReference: string; consentReference: string; policyReference: string };
      approvalId: string;
    },
  ) =>
    ApiClient.post<CustomerEnrolment>(
      `${institutions}/${encodeURIComponent(institutionId)}/enrolments/execute`,
      body,
    ),

  customerEnrolments: (customerId: string) =>
    ApiClient.get<CustomerEnrolment[]>(
      `/internal/institution-enrolments/customers/${encodeURIComponent(customerId)}`,
    ).then((rows) => asArray<CustomerEnrolment>(rows)),

  // ---------------------------------------------------------------- financial accounts
  listLedgerAccounts: (institutionId: string) =>
    ApiClient.get<InstitutionLedgerAccount[]>(
      `${institutions}/${encodeURIComponent(institutionId)}/ledger-accounts`,
    ).then((rows) => asArray<InstitutionLedgerAccount>(rows)),

  openLedgerAccount: (
    institutionId: string,
    body: {
      code: string;
      name: string;
      accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
      normalBalance: 'DEBIT' | 'CREDIT';
      currency: string;
      purpose: LedgerPurpose;
      allowNegativeBalance?: boolean;
    },
  ) =>
    ApiClient.post<InstitutionLedgerAccount>(
      `${institutions}/${encodeURIComponent(institutionId)}/ledger-accounts`,
      body,
    ),

  listAttributions: (institutionId: string) =>
    ApiClient.get<AttributionRecord[]>(
      `${institutions}/${encodeURIComponent(institutionId)}/wallet-attributions`,
    ).then((rows) => asArray<AttributionRecord>(rows)),

  requestAttribution: (
    institutionId: string,
    body: {
      walletId: string;
      evidenceType: AttributionEvidenceType;
      evidenceReference: string;
      reason: string;
    },
  ) =>
    ApiClient.post<GovernedRequestReceipt>(
      `${institutions}/${encodeURIComponent(institutionId)}/wallet-attributions`,
      body,
    ),

  executeAttribution: (
    institutionId: string,
    body: {
      walletId: string;
      evidenceType: AttributionEvidenceType;
      evidenceReference: string;
      reason: string;
      approvalId: string;
    },
  ) =>
    ApiClient.post<AttributionRecord>(
      `${institutions}/${encodeURIComponent(institutionId)}/wallet-attributions/execute`,
      body,
    ),

  walletAttribution: (walletId: string) =>
    ApiClient.get<{
      walletId: string;
      institutionId: string | null;
      attributionId: string | null;
      ownerClass: string;
    }>(`/internal/institution-enrolments/wallets/${encodeURIComponent(walletId)}`),

  // ---------------------------------------------------------------- platform-level reads
  unattributedAccounts: (query: { entity?: 'WALLET' | 'LEDGER_ACCOUNT'; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.entity) params.set('entity', query.entity);
    if (query.limit) params.set('limit', String(query.limit));
    const suffix = params.toString();
    return ApiClient.get<UnattributedAccount[]>(
      `/internal/institution-ledger/unattributed${suffix ? `?${suffix}` : ''}`,
    ).then((rows) => asArray<UnattributedAccount>(rows));
  },

  coverage: () =>
    ApiClient.get<InstitutionCoverage[]>('/internal/institution-ledger/coverage').then((rows) =>
      asArray<InstitutionCoverage>(rows),
    ),

  attributionGaps: (limit = 50) =>
    ApiClient.get<AttributionGap[]>(`${institutions}/attribution-gaps?limit=${limit}`).then((rows) =>
      asArray<AttributionGap>(rows),
    ),

  attributionGapSummary: () =>
    ApiClient.get<AttributionGapSummaryRow[]>(`${institutions}/attribution-gaps/summary`).then(
      (rows) => asArray<AttributionGapSummaryRow>(rows),
    ),

  pendingApprovals: (institutionId: string) =>
    ApiClient.get<PendingApproval[]>(
      `${institutions}/${encodeURIComponent(institutionId)}/pending-approvals`,
    ).then((rows) => asArray<PendingApproval>(rows)),

  // ---------------------------------------------------------------- existing approval infra
  approveApproval: (approvalId: string, comment?: string) =>
    ApiClient.post<ApprovalDecisionResponse>(
      `/internal/a2/workforce/approvals/${encodeURIComponent(approvalId)}/approve`,
      { comment: comment || undefined },
    ),

  auditEvents: (entityType: string, entityId: string, limit = 50) =>
    ApiClient.get<AuditEventRow[]>(
      `/internal/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(
        entityId,
      )}&limit=${limit}`,
    ).then((rows) => asArray<AuditEventRow>(rows)),
};
