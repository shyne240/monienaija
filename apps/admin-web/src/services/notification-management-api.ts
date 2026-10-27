import { ApiClient } from './api-client';
import {
  ManagedNotificationChannel,
  NotificationChangeRequestRecord,
  NotificationDeliveryPage,
  NotificationDeliveryRecord,
  NotificationEventCatalogueItem,
  NotificationProviderStatus,
  NotificationTemplateVersion,
  SafePreviewResult,
  sanitizeProviderStatusForDisplay,
} from './notification-domain';

export type DependencyOwner = 'ARENA_1' | 'ARENA_3';

export type IntegrationResult<T> =
  | {
      status: 'LIVE';
      data: T;
    }
  | {
      status: 'BLOCKED';
      owner: DependencyOwner;
      method: 'GET' | 'POST' | 'PATCH';
      endpoint: string;
      httpStatus: number;
      message: string;
    };

export interface UpdateEventConfigurationPayload {
  smsEnabled: boolean;
  emailEnabled: boolean;
  reason: string;
  approvalIds?: string[];
}

export interface NotificationMutationOutcome {
  status: 'PENDING_APPROVAL' | 'APPLIED';
  approvalId?: string | null;
  changeRequestId?: string | null;
  requestedBy?: string | null;
  updatedAt?: string;
  message?: string;
  template?: NotificationTemplateVersion;
}

export interface CreateTemplateVersionPayload {
  eventType: string;
  channel: ManagedNotificationChannel;
  locale: string;
  subject: string | null;
  body: string;
  changeSummary: string;
}

export interface PreviewTemplatePayload {
  eventType: string;
  channel: ManagedNotificationChannel;
  locale: string;
  subject: string | null;
  body: string;
  sampleVariables: Record<string, string>;
}

export interface ControlledTestSendPayload {
  channel: ManagedNotificationChannel;
  eventType: string;
  destination: string;
  reason: string;
  workforceDestinationConfirmed: true;
  approvalId?: string;
}

export interface ControlledTestSendOutcome {
  status: 'SENT' | 'PENDING_APPROVAL' | 'FAILED';
  deliveryId?: string | null;
  approvalId?: string | null;
  providerRef?: string | null;
  correlationId?: string | null;
  renderedSubject?: string | null;
  renderedMessage?: string | null;
  lastError?: string | null;
  rateLimitRemaining?: number | null;
}

export interface DeliveryQueryFilters {
  page?: number;
  limit?: number;
  status?: string;
  channel?: string;
  recipientType?: string;
  eventType?: string;
  recipientId?: string;
}

export interface SafeRuntimeConfiguration {
  environment?: string;
  version?: string;
  apiVersion?: string;
  outboxRetryDelaySeconds?: number;
  outboxRetentionSeconds?: number;
  auditRetentionSeconds?: number;
  idempotencyRetentionSeconds?: number;
}

export interface LiveDiagnosticsSummary {
  status?: string;
  version?: string;
  pendingOutbox?: number;
  database?: { status?: string };
  migrations?: { status?: string; appliedCount?: number };
  reconciliation?: { status?: string };
  timestamp?: string;
}

export function generateNotificationIdempotencyKey(): string {
  const globalCrypto = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function getHttpStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const candidate = Number((error as { status?: unknown }).status);
    if (Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return (error as { message: string }).message;
  }
  return fallback;
}

async function callTypedBoundary<T>(params: {
  owner: DependencyOwner;
  method: 'GET' | 'POST' | 'PATCH';
  endpoint: string;
  blockedExplanation: string;
  run: () => Promise<T>;
}): Promise<IntegrationResult<T>> {
  try {
    const data = await params.run();
    return { status: 'LIVE', data };
  } catch (error) {
    const httpStatus = getHttpStatus(error);
    if (httpStatus === 404 || httpStatus === 501) {
      return {
        status: 'BLOCKED',
        owner: params.owner,
        method: params.method,
        endpoint: params.endpoint,
        httpStatus,
        message: params.blockedExplanation,
      };
    }
    throw error;
  }
}

function extractArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.events)) return obj.events as T[];
    if (Array.isArray(obj.templates)) return obj.templates as T[];
  }
  return [];
}

export const NotificationManagementApi = {
  /**
   * ARENA 1 — Event catalogue & trigger configuration read boundary.
   */
  async listEvents(): Promise<IntegrationResult<NotificationEventCatalogueItem[]>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'GET',
      endpoint: '/internal/notifications/events',
      blockedExplanation:
        'BLOCKED on ARENA 1: DB-backed notification event catalogue endpoint (GET /internal/notifications/events) is not yet integrated.',
      run: async () => {
        const res = await ApiClient.get<unknown>('/internal/notifications/events');
        return extractArray<NotificationEventCatalogueItem>(res);
      },
    });
  },

  /**
   * ARENA 1 — Submit administrative trigger enable/disable configuration change.
   */
  async submitEventConfigurationChange(
    eventType: string,
    payload: UpdateEventConfigurationPayload,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    const endpoint = `/internal/notifications/events/${encodeURIComponent(eventType)}/configuration`;
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'PATCH',
      endpoint,
      blockedExplanation:
        `BLOCKED on ARENA 1: Trigger configuration persistence (${endpoint}) is not yet integrated. No trigger change was saved.`,
      run: () =>
        ApiClient.patch<NotificationMutationOutcome>(endpoint, payload, { idempotencyKey }),
    });
  },

  /**
   * ARENA 1 — SMS & EMAIL template registry + version history read boundary.
   */
  async listTemplates(params?: {
    eventType?: string;
    channel?: ManagedNotificationChannel;
    includeHistory?: boolean;
  }): Promise<IntegrationResult<NotificationTemplateVersion[]>> {
    const query = new URLSearchParams();
    if (params?.eventType) query.set('eventType', params.eventType);
    if (params?.channel) query.set('channel', params.channel);
    if (params?.includeHistory !== undefined) {
      query.set('includeHistory', String(params.includeHistory));
    }
    const qs = query.toString();
    const endpoint = qs
      ? `/internal/notifications/templates?${qs}`
      : '/internal/notifications/templates';
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'GET',
      endpoint: '/internal/notifications/templates',
      blockedExplanation:
        'BLOCKED on ARENA 1: DB-backed notification_templates registry endpoint (GET /internal/notifications/templates) is not yet integrated.',
      run: async () => {
        const res = await ApiClient.get<unknown>(endpoint);
        return extractArray<NotificationTemplateVersion>(res);
      },
    });
  },

  /**
   * ARENA 1 — Create/submit new SMS or EMAIL template version under maker-checker governance.
   */
  async submitTemplateVersion(
    payload: CreateTemplateVersionPayload,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'POST',
      endpoint: '/internal/notifications/templates',
      blockedExplanation:
        'BLOCKED on ARENA 1: Template creation & versioning endpoint (POST /internal/notifications/templates) is not yet integrated. Draft was validated locally only and was NOT persisted.',
      run: () =>
        ApiClient.post<NotificationMutationOutcome>('/internal/notifications/templates', payload, {
          idempotencyKey,
        }),
    });
  },

  /**
   * ARENA 1 / ARENA 3 — Maker-checker activation of a template version.
   */
  async activateTemplateVersion(
    templateId: string,
    body: { comment?: string; approvalIds?: string[] },
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    const endpoint = `/internal/notifications/templates/${encodeURIComponent(templateId)}/activate`;
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'POST',
      endpoint,
      blockedExplanation:
        `BLOCKED on ARENA 1: Template version activation endpoint (${endpoint}) is not yet integrated. Active production template was NOT changed.`,
      run: () =>
        ApiClient.post<NotificationMutationOutcome>(endpoint, body, { idempotencyKey }),
    });
  },

  /**
   * ARENA 1 — Server-side safe template preview (never sends, never persists).
   */
  async previewTemplate(
    payload: PreviewTemplatePayload,
  ): Promise<IntegrationResult<SafePreviewResult>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'POST',
      endpoint: '/internal/notifications/templates/preview',
      blockedExplanation:
        'BLOCKED on ARENA 1: Server-side template preview endpoint (POST /internal/notifications/templates/preview) is not yet integrated. Displaying deterministic client-side safe whitelist preview only.',
      run: () =>
        ApiClient.post<SafePreviewResult>('/internal/notifications/templates/preview', payload),
    });
  },

  /**
   * ARENA 3 — Non-secret SMS & Email provider configuration and readiness status.
   */
  async getProviderStatus(): Promise<IntegrationResult<NotificationProviderStatus>> {
    return callTypedBoundary({
      owner: 'ARENA_3',
      method: 'GET',
      endpoint: '/internal/notifications/provider-status',
      blockedExplanation:
        'BLOCKED on ARENA 3: Provider status endpoint (GET /internal/notifications/provider-status) is not yet integrated.',
      run: async () => {
        const raw = await ApiClient.get<NotificationProviderStatus>(
          '/internal/notifications/provider-status',
        );
        return sanitizeProviderStatusForDisplay(raw);
      },
    });
  },

  /**
   * ARENA 3 — Governed controlled test-send to workforce-owned destination.
   */
  async submitTestSend(
    payload: ControlledTestSendPayload,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<IntegrationResult<ControlledTestSendOutcome>> {
    return callTypedBoundary({
      owner: 'ARENA_3',
      method: 'POST',
      endpoint: '/internal/notifications/test-send',
      blockedExplanation:
        'BLOCKED on ARENA 3: Controlled test-send endpoint (POST /internal/notifications/test-send) is not yet integrated. No SMS or Email was transmitted.',
      run: () =>
        ApiClient.post<ControlledTestSendOutcome>('/internal/notifications/test-send', payload, {
          idempotencyKey,
        }),
    });
  },

  /**
   * ARENA 3 — Notification maker-checker change requests discovery queue.
   */
  async listChangeRequests(
    statusFilter?: string,
  ): Promise<IntegrationResult<NotificationChangeRequestRecord[]>> {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return callTypedBoundary({
      owner: 'ARENA_3',
      method: 'GET',
      endpoint: '/internal/notifications/change-requests',
      blockedExplanation:
        'BLOCKED on ARENA 3: Dedicated notification change-request listing endpoint (GET /internal/notifications/change-requests) is not yet integrated.',
      run: async () => {
        const res = await ApiClient.get<unknown>(`/internal/notifications/change-requests${qs}`);
        return extractArray<NotificationChangeRequestRecord>(res);
      },
    });
  },

  /**
   * ARENA 3 — Checker decision on a notification change request.
   */
  async decideNotificationChangeRequest(
    requestId: string,
    decision: 'approve' | 'reject',
    comment: string,
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    const endpoint = `/internal/notifications/change-requests/${encodeURIComponent(requestId)}/${decision}`;
    return callTypedBoundary({
      owner: 'ARENA_3',
      method: 'POST',
      endpoint,
      blockedExplanation:
        `BLOCKED on ARENA 3: Notification change-request ${decision} endpoint (${endpoint}) is not yet integrated.`,
      run: () =>
        ApiClient.post<NotificationMutationOutcome>(
          endpoint,
          decision === 'reject'
            ? { reason: comment, comment }
            : { comment: comment || undefined },
        ),
    });
  },

  /**
   * LIVE TODAY — Shared workforce maker-checker approval decision (`A2WorkforceAdministrationController`).
   */
  async decideWorkforceApproval(
    approvalId: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ): Promise<unknown> {
    const trimmedComment = comment?.trim() || undefined;
    return ApiClient.post(`/internal/a2/workforce/approvals/${encodeURIComponent(approvalId.trim())}/${decision}`, {
      comment: trimmedComment,
      ...(decision === 'reject' && trimmedComment ? { reason: trimmedComment } : {}),
    });
  },

  /**
   * LIVE TODAY (SMS & PUSH; EMAIL pending ARENA 3 VALID_CHANNELS widening) —
   * `GET /internal/notifications/deliveries` (`AdminNotificationController`).
   */
  async listDeliveries(
    filters: DeliveryQueryFilters = {},
  ): Promise<IntegrationResult<NotificationDeliveryPage>> {
    const query = new URLSearchParams({
      page: String(filters.page ?? 1),
      limit: String(filters.limit ?? 20),
    });
    if (filters.status) query.set('status', filters.status);
    if (filters.channel) query.set('channel', filters.channel);
    if (filters.recipientType) query.set('recipientType', filters.recipientType);
    if (filters.eventType) query.set('eventType', filters.eventType);
    if (filters.recipientId) query.set('recipientId', filters.recipientId);

    const endpoint = `/internal/notifications/deliveries?${query.toString()}`;
    try {
      const response = await ApiClient.get<Partial<NotificationDeliveryPage>>(endpoint);
      const data = Array.isArray(response?.data)
        ? (response.data as NotificationDeliveryRecord[])
        : extractArray<NotificationDeliveryRecord>(response);
      return {
        status: 'LIVE',
        data: {
          data,
          total: Number(response?.total ?? data.length),
          page: Number(response?.page ?? filters.page ?? 1),
          limit: Number(response?.limit ?? filters.limit ?? 20),
          totalPages: Number(response?.totalPages ?? (data.length > 0 ? 1 : 0)),
          hasNextPage: Boolean(response?.hasNextPage),
        },
      };
    } catch (error) {
      const httpStatus = getHttpStatus(error);
      const message = getErrorMessage(error, '');
      if (
        httpStatus === 400 &&
        filters.channel?.toUpperCase() === 'EMAIL' &&
        /channel must be one of/i.test(message)
      ) {
        return {
          status: 'BLOCKED',
          owner: 'ARENA_3',
          method: 'GET',
          endpoint: '/internal/notifications/deliveries?channel=EMAIL',
          httpStatus: 400,
          message:
            'BLOCKED on ARENA 3: EMAIL delivery channel filter requires widening notification_deliveries.channel CHECK constraint and AdminNotificationController VALID_CHANNELS (currently SMS, PUSH only).',
        };
      }
      throw error;
    }
  },

  /**
   * ARENA 3 — Optional manual delivery retry trigger boundary (automatic bounded retry runs in NotificationWorkerService).
   */
  async requestManualDeliveryRetry(
    deliveryId: string,
    reason: string,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    const endpoint = `/internal/notifications/deliveries/${encodeURIComponent(deliveryId)}/retry`;
    return callTypedBoundary({
      owner: 'ARENA_3',
      method: 'POST',
      endpoint,
      blockedExplanation:
        `BLOCKED on ARENA 3: Manual delivery retry endpoint (${endpoint}) is not integrated; failed SMS deliveries are retried automatically by NotificationWorkerService exponential backoff.`,
      run: () =>
        ApiClient.post<NotificationMutationOutcome>(endpoint, { reason }, { idempotencyKey }),
    });
  },

  /**
   * LIVE TODAY — Shared outbox inspection (`OperationsController.getOutbox`, requires `outbox.view`).
   */
  async getOutboxEvents(limit = 25): Promise<Array<Record<string, unknown>>> {
    const res = await ApiClient.get<unknown>(`/internal/outbox?limit=${limit}`);
    return extractArray<Record<string, unknown>>(res);
  },

  /**
   * LIVE TODAY — Operational diagnostics (`OperationsController.getDiagnostics`, requires `diagnostics.view`).
   */
  async getDiagnostics(): Promise<LiveDiagnosticsSummary> {
    return ApiClient.get<LiveDiagnosticsSummary>('/internal/diagnostics');
  },

  /**
   * LIVE TODAY — Safe non-secret runtime configuration (`ProductionController.getConfiguration`).
   */
  async getSafeRuntimeConfig(): Promise<SafeRuntimeConfiguration> {
    const raw = await ApiClient.get<SafeRuntimeConfiguration>('/internal/configuration');
    return sanitizeProviderStatusForDisplay(raw);
  },

  /**
   * LIVE TODAY — Audit trail lookup (`OperationsController.getAudit`).
   */
  async listAuditEvents(entityType: string, limit = 15): Promise<Array<Record<string, unknown>>> {
    const res = await ApiClient.get<unknown>(
      `/internal/audit?entityType=${encodeURIComponent(entityType)}&limit=${limit}`,
    );
    return extractArray<Record<string, unknown>>(res);
  },
};
