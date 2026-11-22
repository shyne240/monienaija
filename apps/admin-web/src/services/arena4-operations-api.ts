import { ApiClient } from './api-client';

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
  roles: Array<{ roleKey: string; status: string; readOnly: boolean }>;
  institutionScope: {
    mode: string;
    platformFunctionGranted: boolean;
    active: Array<{ institutionId: string; institutionName: string | null }>;
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
