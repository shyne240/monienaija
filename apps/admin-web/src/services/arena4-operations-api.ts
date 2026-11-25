import { ApiClient } from './api-client';
import type { ApprovalRecord, ApprovalRecordPage } from '../utils/approval-evaluation';

/**
 * ARENA 4 — administrative operations API adapters.
 *
 * Read-only. Every endpoint behind these helpers is a GET; there is deliberately no
 * retry/grant/revoke helper here. Notification delivery retry is out of the approved V1 scope, and
 * workforce grants remain on the existing maker/checker routes in the Workforce and Role
 * Governance workspaces.
 */

export interface NotificationOperationsSummary {
  window: { hours: number; from: string };
  totals: { deliveries: number; byStatus: Array<{ status: string; count: number }> };
  retryBacklog: {
    pending: number;
    failedAwaitingRetry: number;
    dead: number;
    unknown: number;
    oldestPendingAt: string | null;
    nextScheduledRetryAt: string | null;
  };
  failureDiagnostics: Array<{ errorCode: string; count: number; lastSeenAt: string | null }>;
  provider: {
    projectionScope: 'FULL' | 'MINIMAL';
    channels: Array<{ channel: string; available: boolean; provider?: string }>;
  };
  retryPolicy: {
    manualRetrySupported: false;
    manualRetryPolicyReference: string;
    automaticRetry: {
      maxAttempts: number | null;
      baseDelaySeconds: number | null;
      visibility: 'FULL' | 'MINIMAL';
    };
  };
}

export interface NotificationDeliveryPage {
  data: Array<Record<string, unknown>>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface NotificationDeliveryDetail {
  delivery: Record<string, unknown> & {
    id: string;
    status: string;
    channel: string;
    attempts: number;
    errorCode: string | null;
  };
  attempts: Array<{
    attemptNumber: number;
    status: string;
    reason: string | null;
    claimedAt: string | null;
    finishedAt: string | null;
  }>;
  idempotency: {
    eventKey: string;
    uniqueOn: string;
    materialization: string;
  };
  retry: {
    manualRetrySupported: false;
    manualRetryPolicyReference: string;
    automaticRetryState: string;
    automaticRetry: {
      maxAttempts: number | null;
      baseDelaySeconds: number | null;
      visibility: 'FULL' | 'MINIMAL';
    };
  };
  provider: { projectionScope: string; channel: string; available: boolean; provider?: string };
}

export interface WorkforceDirectoryPage {
  data: Array<{
    principalId: string;
    principalType: string;
    accountStatus: string;
    roles: Array<{ roleKey: string; status: string; readOnly: boolean }>;
    readOnlyPrincipal: boolean;
    institutionScope: {
      mode: string;
      platformFunctionGranted: boolean;
      active: Array<{
        institutionId: string;
        institutionName: string | null;
        code?: string | null;
      }>;
      revokedCount: number;
    };
    activeSessionCount: number;
    lastSeenAt: string | null;
    permissionCount: number;
    privilegedPermissionCount: number;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  accessMode: 'READ_ONLY';
}

export interface WorkforcePrincipalDetail {
  principalId: string;
  principalType: string;
  accountStatus: string;
  roles: Array<{
    roleKey: string;
    status: string;
    readOnly: boolean;
    effectiveFrom?: string;
    effectiveTo?: string;
    assignedBy?: string;
    assignedAt?: string;
    revokedAt?: string | null;
  }>;
  /** True when every held role is revoked or read-only — the projection never widens this. */
  readOnlyPrincipal?: boolean;
  institutionScope: {
    mode: string;
    platformFunctionGranted: boolean;
    active: Array<{ institutionId: string; institutionName: string | null; code?: string | null }>;
    revokedCount: number;
  };
  sessions: Array<{
    id: string;
    status: string;
    assuranceLevel: string | null;
    audience: string;
    lastSeenAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
  }>;
  effectivePermissions: Array<{
    functionCode: string;
    accessType: string;
    domain: string;
    name: string;
    sensitivity: string;
  }>;
  administrativeAuthorizations: Array<{ functionCode: string; domain: string; name: string }>;
  boundaries: { readOnly: true; note: string };
}

/**
 * Governed-change approvals (B9). Both reads go through the existing
 * `A2WorkforceAdministrationController` approval routes: the collection is already scoped to the
 * caller's approval scope, MFA assurance and approving roles by
 * `PrivilegedActionApprovalService.listApprovals`, and the single read re-uses that exact
 * predicate with an id filter. There is no unscoped read helper here, by design.
 */
export type ApprovalInboxPage = ApprovalRecordPage;

export interface AuditInspectionPage {
  data: Array<{
    id: string;
    actor: string;
    action: string;
    entityType: string;
    entityId: string;
    outcome: string;
    institutionId: string | null;
    occurredAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  accessMode: 'READ_ONLY';
  excludedCategories: string[];
}

export interface AuditInspectionDetail {
  event: Record<string, unknown> & {
    id: string;
    actor: string;
    action: string;
    entityType: string;
  };
  approvalHistory: Array<{
    id: string;
    actionType: string;
    status: string;
    requesterPrincipalId: string;
    approvedBy: string | null;
    requestedAt: string;
    approvedAt: string | null;
    rejectedAt: string | null;
  }>;
  relatedEvents: Array<{
    id: string;
    actor: string;
    action: string;
    outcome: string;
    occurredAt: string;
  }>;
  accessMode: 'READ_ONLY';
  excludedCategories: string[];
}

export function describeHttpError(error: unknown, fallback: string): string {
  const status = (error as { status?: number })?.status;
  if (status === 401) return 'Your session is not authorized for this operational surface.';
  if (status === 403)
    return 'Forbidden: your role does not hold the required authorization function.';
  if (status === 404) return 'Record not found or excluded from this read surface.';
  if (status === 400) return 'The request filters were rejected as invalid.';
  return fallback;
}

const queryString = (params: Record<string, string | number | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.toString();
};

/** ARENA B9 — configurable workforce roles (governed role definitions). */
export interface RoleDefinitionFunctionOption {
  functionCode: string;
  name: string;
  domain: string;
  sensitivity: string;
  v1Status: string;
  financeClassRestricted: boolean;
}

export interface RoleDefinitionProposal {
  id: string;
  proposalType: 'CREATE' | 'MODIFY';
  targetRoleKey: string;
  proposedDisplayName: string;
  proposedDescription: string;
  proposedReadOnly: boolean;
  proposedFunctionGrants: Array<{ functionCode: string; accessType: string }>;
  deactivate: boolean;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'EXPIRED' | 'FAILED';
  approvalId: string | null;
  appliedRoleId: string | null;
  reason: string;
  decisionReason: string | null;
  requestedAt: string;
  expiresAt: string;
}

export interface RoleChangeApproval {
  approvalId: string;
  action: 'FINANCE_ROLE_ASSIGN' | 'FINANCE_ROLE_REVOKE';
  status: string;
  actionFingerprint: string;
  resourceType: string;
  resourceId: string;
  expiresAt: string;
}

export const Arena4OperationsApi = {
  notificationSummary(hours = 24): Promise<NotificationOperationsSummary> {
    return ApiClient.get<NotificationOperationsSummary>(
      `/internal/notifications/operations/summary?${queryString({ hours })}`,
    );
  },

  notificationDeliveries(filters: {
    status?: string;
    channel?: string;
    search?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<NotificationDeliveryPage> {
    return ApiClient.get<NotificationDeliveryPage>(
      `/internal/notifications/deliveries?${queryString({ ...filters, page: filters.page ?? 1, limit: filters.limit ?? 20 })}`,
    );
  },

  notificationDelivery(id: string): Promise<NotificationDeliveryDetail> {
    return ApiClient.get<NotificationDeliveryDetail>(
      `/internal/notifications/deliveries/${encodeURIComponent(id)}`,
    );
  },

  // ---------------------------------------------------------------------------------------
  // ARENA B9 — configurable workforce roles.
  //
  // `roleDefinitionFunctions` returns exactly the catalogue functions the apply path accepts, so
  // the editor cannot offer a grant the server will refuse. `prepareRoleChangeApproval` asks the
  // server for the approval a governed role change consumes — the fingerprint is computed there,
  // so an operator never types an approval id they could not have derived.
  // ---------------------------------------------------------------------------------------
  roleDefinitionFunctions(): Promise<RoleDefinitionFunctionOption[]> {
    return ApiClient.get<RoleDefinitionFunctionOption[]>(
      '/internal/a2/workforce/role-definitions/functions',
    );
  },

  roleDefinitionProposals(
    filters: { status?: string; roleKey?: string } = {},
  ): Promise<RoleDefinitionProposal[]> {
    return ApiClient.get<RoleDefinitionProposal[]>(
      `/internal/a2/workforce/role-definitions/proposals?${queryString(filters)}`,
    );
  },

  submitRoleDefinition(body: {
    proposalType: 'CREATE' | 'MODIFY';
    roleKey: string;
    displayName: string;
    description: string;
    readOnly?: boolean;
    functionGrants: Array<{ functionCode: string; accessType: string }>;
    expectedDefinitionVersion?: number;
    reason: string;
  }): Promise<{ success: boolean; proposal: RoleDefinitionProposal; reason?: string }> {
    return ApiClient.post('/internal/a2/workforce/role-definitions/proposals', body);
  },

  decideRoleDefinition(
    id: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ): Promise<{ success: boolean; proposal: RoleDefinitionProposal; reason?: string }> {
    return ApiClient.post(
      `/internal/a2/workforce/role-definitions/proposals/${encodeURIComponent(id)}/${decision}`,
      comment ? { comment } : {},
    );
  },

  applyRoleDefinition(
    id: string,
  ): Promise<{ success: boolean; proposal: RoleDefinitionProposal; reason?: string }> {
    return ApiClient.post(
      `/internal/a2/workforce/role-definitions/proposals/${encodeURIComponent(id)}/apply`,
    );
  },

  prepareRoleChangeApproval(body: {
    operation: 'ASSIGN' | 'REVOKE';
    targetPrincipalId: string;
    roleKey: string;
    effectiveFrom: string;
    effectiveTo: string;
    expectedVersion?: number;
    reason: string;
  }): Promise<RoleChangeApproval> {
    return ApiClient.post<RoleChangeApproval>(
      '/internal/a2/workforce/roles/approval-requests',
      body,
    );
  },

  workforceDirectory(filters: {
    search?: string;
    roleKey?: string;
    status?: string;
    principalType?: string;
    page?: number;
    limit?: number;
  }): Promise<WorkforceDirectoryPage> {
    return ApiClient.get<WorkforceDirectoryPage>(
      `/internal/workforce/directory?${queryString({ ...filters, page: filters.page ?? 1, limit: filters.limit ?? 20 })}`,
    );
  },

  workforcePrincipal(principalId: string): Promise<WorkforcePrincipalDetail> {
    return ApiClient.get<WorkforcePrincipalDetail>(
      `/internal/workforce/directory/${encodeURIComponent(principalId)}`,
    );
  },

  /**
   * Approval inbox, as visible to the signed-in checker. `status`, `actionType` and
   * `resourceType` are the server's own filters; nothing is filtered only in the browser.
   */
  approvals(filters: {
    status?: string;
    actionType?: string;
    resourceType?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApprovalInboxPage> {
    return ApiClient.get<ApprovalInboxPage>(
      `/internal/a2/workforce/approvals?${queryString({
        ...filters,
        limit: filters.limit ?? 25,
        offset: filters.offset ?? 0,
      })}`,
    );
  },

  /** Authoritative re-read of ONE approval (404 when it is outside the caller's visibility). */
  approval(id: string): Promise<ApprovalRecord> {
    return ApiClient.get<ApprovalRecord>(
      `/internal/a2/workforce/approvals/${encodeURIComponent(id)}`,
    );
  },

  auditInspection(filters: {
    actor?: string;
    action?: string;
    entityType?: string;
    outcome?: string;
    institutionId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<AuditInspectionPage> {
    return ApiClient.get<AuditInspectionPage>(
      `/internal/audit/inspection?${queryString({ ...filters, page: filters.page ?? 1, limit: filters.limit ?? 25 })}`,
    );
  },

  auditInspectionDetail(id: string): Promise<AuditInspectionDetail> {
    return ApiClient.get<AuditInspectionDetail>(
      `/internal/audit/inspection/${encodeURIComponent(id)}`,
    );
  },
};
