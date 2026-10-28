import { ApiClient } from './api-client';
import {
  estimateSmsSegments,
  extractTemplateVariables,
  BASELINE_CODE_EVENT_CATALOGUE,
  ManagedNotificationChannel,
  NotificationChangeRequestRecord,
  NotificationDeliveryPage,
  NotificationDeliveryRecord,
  NotificationEventCatalogueItem,
  NotificationProviderStatus,
  NotificationTemplateVersion,
  ManagedProviderChannel,
  ProposeProviderConfigPayload,
  ProviderChannelSnapshot,
  ProviderConfigProposal,
  ProviderConfigurationOverview,
  ProviderLifecycleState,
  ProviderReadinessGates,
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
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'APPLIED' | 'REJECTED';
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

/* ---------------------------------------------------------------------------
 * ARENA 3 INTEGRATION (Phase 5) — this client now targets the REAL merged
 * backend contracts:
 *
 * Arena 1 registry API (NotificationRegistryController, workforce-session only):
 *   GET  /internal/notifications/events
 *        -> { items: [{ eventType, deliveryClass, editable, variables: string[],
 *              channels: { SMS|EMAIL: { enabled, locked, configurationVersion,
 *                                       activeTemplateVersion } } }] }
 *   GET  /internal/notifications/templates?eventType&channel[&locale&limit&beforeVersion]
 *        -> { eventType, channel, locale, items: [templateView], nextBeforeVersion }
 *        (eventType + channel are REQUIRED by the server)
 *   POST /internal/notifications/templates/preview   body { eventType, channel, locale?,
 *        subject?, body? }  -> { eventType, channel, locale, subject, body, variablesUsed }
 *        (server rejects unknown keys — sampleVariables are fixed server-side samples)
 *   POST /internal/notifications/changes             maker = SUPER_ADMIN + MFA +
 *        notification.view_deliveries; body { type: 'TEMPLATE' | 'TEMPLATE_ROLLBACK' |
 *        'CONFIGURATION', eventType, channel, ... , expectedVersion, reason }
 *        -> { approvalId, status, actionType, actionFingerprint, requestedAt, expiresAt }
 *   GET  /internal/notifications/changes[?status&page&limit]
 *        -> { page, limit, hasMore, items: [{ approvalId, type, eventType, channel,
 *             createdBy, createdAt, status, approvedBy, expiresAt }] }
 *        statuses: REQUESTED|APPROVED|REJECTED|CANCELLED|CONSUMED|EXPIRED
 *   GET  /internal/notifications/changes/:approvalId -> full stored proposal
 *   POST /internal/notifications/changes/:approvalId/execute (empty body; executor =
 *        FINANCE_CONTROLLER + privileged:approve + MFA; approval must be APPROVED first
 *        via POST /internal/a2/workforce/approvals/:id/approve)
 *
 * Arena 3 provider API (AdminNotificationProviderController):
 *   GET  /internal/notifications/provider-status (notification.view_deliveries)
 *        -> { channels, sms: { provider, baseUrl, configured, keyFingerprint, timeoutMs },
 *             email: { provider, baseUrl, configured, keyFingerprint, from, replyTo,
 *                      timeoutMs }, worker: { enabled, pollIntervalMs, batchSize,
 *                      retryMaxAttempts, retryBaseDelaySeconds } }
 *   POST /internal/notifications/test-send (notification.test_send)
 *        body { channel: 'SMS'|'EMAIL', destination } (ONLY these keys)
 *        -> { status: 'SENT'|'FAILED', channel, correlationId, destination (masked),
 *             provider, providerRef, errorCode }
 *
 * There is NO PATCH /events/:eventType/configuration, NO POST /templates, NO
 * /templates/:id/activate and NO /change-requests/* endpoint on the real backend;
 * trigger changes, template versions, rollbacks and activations ALL flow through the
 * maker-checker change-request lifecycle above. The BLOCKED wrapper is retained for
 * genuinely absent routes (e.g. manual delivery retry) so the UI never fakes success.
 * --------------------------------------------------------------------------- */

interface RegistryChannelState {
  enabled: boolean;
  locked: boolean;
  configurationVersion: number;
  activeTemplateVersion: number | null;
}

interface RegistryEventItem {
  eventType: string;
  deliveryClass: string;
  editable: boolean;
  variables: string[];
  channels: {
    SMS?: RegistryChannelState;
    EMAIL?: RegistryChannelState;
  };
}

interface RegistryTemplateRow {
  id: string;
  eventType: string;
  channel: string;
  locale: string;
  version: number;
  active: boolean;
  subject: string | null;
  body: string;
  createdBy: string | null;
  createdAt: string;
}

interface RegistryChangeRow {
  approvalId: string;
  type: string;
  eventType: string | null;
  channel: string | null;
  createdBy: string;
  createdAt: string;
  status: string;
  approvedBy: string | null;
  expiresAt: string | null;
}

interface RegistryChangeDetail {
  approvalId: string;
  change: {
    type: string;
    eventType: string;
    channel: string;
    subject?: string | null;
    body?: string;
    enabled?: boolean;
    sourceVersion?: number;
    expectedVersion?: number;
  };
  reason: string;
  createdBy: string;
  createdAt: string;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  expiresAt: string | null;
}

interface RegistryChangeCreation {
  approvalId: string;
  status: string;
  actionType: string;
  actionFingerprint: string;
  requestedAt: string;
  expiresAt: string;
}

/** Metadata for registry-approved variables (live names are authoritative; this only
 *  enriches the UI with descriptions/safe samples for the variable picker). */
const VARIABLE_METADATA: Record<string, { description: string; sampleValue: string; sourceSummary: string }> = {
  reference: {
    description: 'Public-safe request/transfer reference (short display shape only)',
    sampleValue: 'SAMPLE-1',
    sourceSummary: 'redactedPayload.reference (validated public shape)',
  },
  amount_clause: {
    description: 'Formatted amount clause rendered from the committed principal',
    sampleValue: ' of NGN 1250.00',
    sourceSummary: 'formatNgn(redactedPayload.amountMinor)',
  },
  amount: {
    description: 'Formatted amount rendered from the committed transfer principal',
    sampleValue: 'NGN 2500.00',
    sourceSummary: 'formatNgn(redactedPayload.amountMinor)',
  },
  status: {
    description: 'Lifecycle status token (allowlisted enum value)',
    sampleValue: 'IN_PROGRESS',
    sourceSummary: 'redactedPayload.status (allowlisted)',
  },
  sender_name: {
    description: 'Verified sender display name (KYC-approved legal name) or a generic fallback',
    sampleValue: 'Ada Example',
    sourceSummary: 'redactedPayload.senderDisplayName (verified name only)',
  },
  locator_clause: {
    description: 'Optional clause pointing to the configured public agent locator (https only)',
    sampleValue: ' Find an active outlet: https://monienaija.example/agents',
    sourceSummary: 'redactedPayload.locatorUrl (CASH_TO_CASH_LOCATOR_URL, https-validated)',
  },
  agent_locator_url: {
    description: 'Configured public agent locator URL (https only)',
    sampleValue: 'https://monienaija.example/agents',
    sourceSummary: 'CASH_TO_CASH_LOCATOR_URL (https-validated)',
  },
  ticket_status: {
    description: 'Support ticket status token (allowlisted enum value)',
    sampleValue: 'IN_PROGRESS',
    sourceSummary: 'redactedPayload.status (allowlisted)',
  },
};

const GENERIC_VARIABLE_METADATA = {
  description: 'Registry-approved template variable (server-resolved from the redacted payload)',
  sampleValue: 'SAMPLE',
  sourceSummary: 'server-side allowlisted resolver',
};

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

function mapRegistryEvent(item: RegistryEventItem): NotificationEventCatalogueItem {
  const baseline = BASELINE_CODE_EVENT_CATALOGUE.find((entry) => entry.eventType === item.eventType);
  const sms = item.channels.SMS;
  const email = item.channels.EMAIL;
  const registryLocked = Boolean(sms?.locked || email?.locked) || !item.editable;
  // The registry lock (SECURITY class) is authoritative; the static catalogue additionally
  // keeps the stricter product-decision locks (e.g. required V1 transactional outcomes,
  // Decision D-N8) — the union is displayed and enforced in the UI, and the server still
  // governs every accepted change with maker-checker approval.
  const locked = registryLocked || Boolean(baseline?.toggleLocked);
  const approvedVariables = (item.variables ?? []).map((name) => {
    const baselineVariable = baseline?.approvedVariables.find((variable) => variable.name === name);
    const metadata = VARIABLE_METADATA[name] ?? GENERIC_VARIABLE_METADATA;
    return (
      baselineVariable ?? {
        name,
        description: metadata.description,
        sampleValue: metadata.sampleValue,
        sourceSummary: metadata.sourceSummary,
      }
    );
  });
  return {
    eventType: item.eventType,
    category: baseline?.category ?? 'TRANSFER',
    description: baseline?.description ?? `Notification event ${item.eventType}`,
    deliveryClass: (item.deliveryClass as NotificationEventCatalogueItem['deliveryClass']) ?? 'TRANSACTIONAL',
    recipientTarget: baseline?.recipientTarget ?? 'CUSTOMER',
    runtimeTriggerState: baseline?.runtimeTriggerState ?? 'LIVE_OUTBOX',
    smsEnabled: Boolean(sms?.enabled),
    emailEnabled: Boolean(email?.enabled),
    toggleLocked: locked,
    lockReason: locked
      ? (registryLocked
          ? (baseline?.lockReason ?? 'SECURITY-class events are locked against ordinary template administration.')
          : (baseline?.lockReason ?? 'Locked by product decision.'))
      : null,
    templateEditable: item.editable && !registryLocked,
    securityNotes: baseline?.securityNotes ?? null,
    approvedVariables,
    activeSmsVersion: sms?.activeTemplateVersion ?? null,
    activeEmailVersion: email?.activeTemplateVersion ?? null,
    pendingApprovalId: null,
    updatedBy: null,
    updatedAt: null,
  };
}

function mapRegistryTemplate(row: RegistryTemplateRow): NotificationTemplateVersion {
  return {
    id: row.id,
    eventType: row.eventType,
    channel: row.channel as ManagedNotificationChannel,
    locale: row.locale,
    version: row.version,
    subject: row.subject,
    body: row.body,
    variables: extractTemplateVariables(`${row.subject ?? ''} ${row.body}`),
    isActive: row.active,
    approvalStatus: row.active ? 'ACTIVE' : 'SUPERSEDED',
    approvalId: null,
    changeSummary: null,
    createdBy: row.createdBy,
    approvedBy: null,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
    sourceOrigin: 'DATABASE',
  };
}

function mapChangeStatus(status: string): NotificationChangeRequestRecord['status'] {
  switch (status) {
    case 'REQUESTED':
      return 'PENDING_APPROVAL';
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'REJECTED';
    case 'CONSUMED':
      return 'APPLIED';
    default:
      return 'PENDING_APPROVAL';
  }
}

function mapChangeType(type: string): NotificationChangeRequestRecord['changeType'] {
  switch (type) {
    case 'TEMPLATE':
      return 'TEMPLATE_CREATE';
    case 'TEMPLATE_ROLLBACK':
      return 'TEMPLATE_ACTIVATE';
    case 'CONFIGURATION':
      return 'EVENT_TRIGGER_CONFIG';
    default:
      return 'TEMPLATE_CREATE';
  }
}

async function fetchRegistryEvents(): Promise<RegistryEventItem[]> {
  const res = await ApiClient.get<unknown>('/internal/notifications/events');
  return extractArray<RegistryEventItem>(res);
}

async function fetchTemplatePage(
  eventType: string,
  channel: ManagedNotificationChannel,
  limit = 50,
): Promise<RegistryTemplateRow[]> {
  const query = new URLSearchParams({ eventType, channel, limit: String(limit) });
  const res = await ApiClient.get<unknown>(`/internal/notifications/templates?${query.toString()}`);
  return extractArray<RegistryTemplateRow>(res);
}

async function fetchActiveTemplateVersion(
  eventType: string,
  channel: ManagedNotificationChannel,
): Promise<number> {
  const rows = await fetchTemplatePage(eventType, channel, 10);
  const active = rows.find((row) => row.active);
  if (!active) {
    throw new Error(
      `No ACTIVE ${channel} template version exists for ${eventType}; the registry requires an active baseline before governed changes.`,
    );
  }
  return active.version;
}

export const NotificationManagementApi = {
  /**
   * ARENA 1 registry — event catalogue & trigger configuration read boundary.
   * Live DB state (enabled/locked/versions + approved variable allowlists) is merged with
   * the static UI metadata (category/description/recipientTarget samples).
   */
  async listEvents(): Promise<IntegrationResult<NotificationEventCatalogueItem[]>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'GET',
      endpoint: '/internal/notifications/events',
      blockedExplanation:
        'BLOCKED on ARENA 1: DB-backed notification event catalogue endpoint (GET /internal/notifications/events) is not yet integrated.',
      run: async () => {
        const items = await fetchRegistryEvents();
        return items.map(mapRegistryEvent);
      },
    });
  },

  /**
   * ARENA 1 registry — trigger enable/disable via the maker-checker change lifecycle.
   * The real backend has no PATCH configuration route: each channel whose desired state
   * differs from the persisted registry state produces a CONFIGURATION change request
   * (maker = SUPER_ADMIN + MFA) that a FINANCE_CONTROLLER checker must approve and execute.
   * Locked (SECURITY-class) channels are never proposed and are reported explicitly.
   */
  async submitEventConfigurationChange(
    eventType: string,
    payload: UpdateEventConfigurationPayload,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'POST',
      endpoint: '/internal/notifications/changes',
      blockedExplanation:
        'BLOCKED on ARENA 1: Notification change-request endpoint (POST /internal/notifications/changes) is not yet integrated. No trigger change was saved.',
      run: async () => {
        const items = await fetchRegistryEvents();
        const item = items.find((candidate) => candidate.eventType === eventType);
        if (!item) throw new Error(`Event ${eventType} is not present in the notification registry catalogue.`);
        const desired: Array<{ channel: ManagedNotificationChannel; enabled: boolean; state?: RegistryChannelState }> = [
          { channel: 'SMS', enabled: payload.smsEnabled, state: item.channels.SMS },
          { channel: 'EMAIL', enabled: payload.emailEnabled, state: item.channels.EMAIL },
        ];
        const approvals: Array<{ channel: string; approvalId: string }> = [];
        const notes: string[] = [];
        for (const entry of desired) {
          if (!entry.state) continue;
          if (entry.state.locked) {
            if (entry.state.enabled !== entry.enabled) {
              notes.push(`${entry.channel} trigger is locked (SECURITY class) and was NOT changed.`);
            }
            continue;
          }
          if (entry.state.enabled === entry.enabled) {
            notes.push(`${entry.channel} trigger already matches the requested state.`);
            continue;
          }
          const created = await ApiClient.post<RegistryChangeCreation>(
            '/internal/notifications/changes',
            {
              type: 'CONFIGURATION',
              eventType,
              channel: entry.channel,
              enabled: entry.enabled,
              expectedVersion: entry.state.configurationVersion,
              reason: payload.reason,
            },
            { idempotencyKey: `${idempotencyKey}-${entry.channel.toLowerCase()}` },
          );
          approvals.push({ channel: entry.channel, approvalId: created.approvalId });
        }
        if (approvals.length === 0) {
          return {
            status: 'APPLIED',
            approvalId: null,
            changeRequestId: null,
            updatedAt: new Date().toISOString(),
            message:
              notes.length > 0
                ? `No change request created. ${notes.join(' ')}`
                : 'No configuration change was required.',
          };
        }
        return {
          status: 'PENDING_APPROVAL',
          approvalId: approvals[0]!.approvalId,
          changeRequestId: approvals[0]!.approvalId,
          requestedBy: null,
          updatedAt: new Date().toISOString(),
          message: `Change request(s) created: ${approvals
            .map((entry) => `${entry.channel}=${entry.approvalId}`)
            .join(', ')}.${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`,
        };
      },
    });
  },

  /**
   * ARENA 1 registry — template version history read boundary.
   * The server requires eventType+channel; when the console needs the full overview the
   * client fans out over the live registry catalogue (recent versions per event/channel).
   */
  async listTemplates(params?: {
    eventType?: string;
    channel?: ManagedNotificationChannel;
    includeHistory?: boolean;
  }): Promise<IntegrationResult<NotificationTemplateVersion[]>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'GET',
      endpoint: '/internal/notifications/templates',
      blockedExplanation:
        'BLOCKED on ARENA 1: DB-backed notification_templates registry endpoint (GET /internal/notifications/templates) is not yet integrated.',
      run: async () => {
        if (params?.eventType && params?.channel) {
          const rows = await fetchTemplatePage(params.eventType, params.channel, 100);
          return rows.map(mapRegistryTemplate);
        }
        const events = await fetchRegistryEvents();
        const limit = params?.includeHistory === false ? 1 : 10;
        const pages = await Promise.all(
          events.flatMap((event) =>
            (['SMS', 'EMAIL'] as ManagedNotificationChannel[]).map((channel) =>
              fetchTemplatePage(event.eventType, channel, limit).catch(() => [] as RegistryTemplateRow[]),
            ),
          ),
        );
        return pages.flat().map(mapRegistryTemplate);
      },
    });
  },

  /**
   * ARENA 1 registry — propose a new SMS/EMAIL template version (maker step of
   * maker-checker). The proposal is validated server-side (allowlist, maxima, safe
   * expansion) and frozen into a change request; it becomes the ACTIVE version only after
   * a FINANCE_CONTROLLER checker approves and executes it.
   */
  async submitTemplateVersion(
    payload: CreateTemplateVersionPayload,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'POST',
      endpoint: '/internal/notifications/changes',
      blockedExplanation:
        'BLOCKED on ARENA 1: Notification change-request endpoint (POST /internal/notifications/changes) is not yet integrated. Draft was validated locally only and was NOT persisted.',
      run: async () => {
        const expectedVersion = await fetchActiveTemplateVersion(payload.eventType, payload.channel);
        const created = await ApiClient.post<RegistryChangeCreation>(
          '/internal/notifications/changes',
          {
            type: 'TEMPLATE',
            eventType: payload.eventType,
            channel: payload.channel,
            locale: 'en-NG',
            subject: payload.subject,
            body: payload.body,
            expectedVersion,
            reason: payload.changeSummary,
          },
          { idempotencyKey },
        );
        return {
          status: 'PENDING_APPROVAL',
          approvalId: created.approvalId,
          changeRequestId: created.approvalId,
          requestedBy: null,
          updatedAt: created.requestedAt,
          message: `Frozen proposal ${created.approvalId} awaits checker approval and execution.`,
        };
      },
    });
  },

  /**
   * ARENA 1 registry — activate a historical template version. The real contract is a
   * governed TEMPLATE_ROLLBACK change request (maker), approved by a FINANCE_CONTROLLER
   * checker, then executed from the stored frozen proposal. This call creates the
   * proposal; approval+execution happen through the change queue (decideNotificationChangeRequest).
   */
  async activateTemplateVersion(
    version: NotificationTemplateVersion | string,
    body: { comment?: string; approvalIds?: string[] },
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'POST',
      endpoint: '/internal/notifications/changes',
      blockedExplanation:
        'BLOCKED on ARENA 1: Notification change-request endpoint (POST /internal/notifications/changes) is not yet integrated. Active production template was NOT changed.',
      run: async () => {
        if (typeof version === 'string') {
          throw new Error(
            'Activation requires the full template version row (eventType, channel, version) — the registry governs activation through frozen TEMPLATE_ROLLBACK proposals, not template IDs.',
          );
        }
        const expectedVersion = await fetchActiveTemplateVersion(version.eventType, version.channel);
        const created = await ApiClient.post<RegistryChangeCreation>(
          '/internal/notifications/changes',
          {
            type: 'TEMPLATE_ROLLBACK',
            eventType: version.eventType,
            channel: version.channel,
            locale: 'en-NG',
            sourceVersion: version.version,
            expectedVersion,
            reason: body.comment?.trim() && body.comment.trim().length >= 5
              ? body.comment.trim()
              : `Rollback ${version.channel} template to version ${version.version}.`,
          },
          { idempotencyKey },
        );
        return {
          status: 'PENDING_APPROVAL',
          approvalId: created.approvalId,
          changeRequestId: created.approvalId,
          requestedBy: null,
          updatedAt: created.requestedAt,
          message: `Rollback proposal ${created.approvalId} created — a FINANCE_CONTROLLER checker must approve and execute it before version ${version.version} becomes active.`,
        };
      },
    });
  },

  /**
   * ARENA 1 registry — server-side safe template preview (never sends, never persists).
   * The server renders with fixed safe sample bindings; client sampleVariables are used
   * only to enrich the resolved-variable display.
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
      run: async () => {
        const res = await ApiClient.post<{ subject: string | null; body: string; variablesUsed: string[] }>(
          '/internal/notifications/templates/preview',
          {
            eventType: payload.eventType,
            channel: payload.channel,
            locale: payload.locale || 'en-NG',
            subject: payload.subject,
            body: payload.body,
          },
        );
        const resolvedVariables: Record<string, string> = {};
        for (const name of res.variablesUsed ?? []) {
          resolvedVariables[name] = payload.sampleVariables?.[name] ?? VARIABLE_METADATA[name]?.sampleValue ?? 'SAMPLE';
        }
        return {
          renderedSubject: res.subject,
          renderedBody: res.body,
          characterCount: res.body.length,
          estimatedSmsSegments: payload.channel === 'SMS' ? estimateSmsSegments(res.body) : null,
          resolvedVariables,
          warnings: [],
        };
      },
    });
  },

  /**
   * ARENA 3 — non-secret SMS & Email provider configuration and readiness status,
   * mapped from the real flat snapshot into the console view model (never invents fields
   * the backend does not expose; secrets stay server-side, fingerprints only).
   */
  async getProviderStatus(): Promise<IntegrationResult<NotificationProviderStatus>> {
    return callTypedBoundary({
      owner: 'ARENA_3',
      method: 'GET',
      endpoint: '/internal/notifications/provider-status',
      blockedExplanation:
        'BLOCKED on ARENA 3: Provider status endpoint (GET /internal/notifications/provider-status) is not yet integrated.',
      run: async () => {
        const raw = await ApiClient.get<{
          channels: string[];
          sms: {
            provider: string;
            baseUrl: string | null;
            configured: boolean;
            verified?: boolean;
            enabled?: boolean;
            deliveryTested?: boolean;
            productionReady?: boolean;
            lifecycleState?: ProviderLifecycleState;
            gates?: ProviderReadinessGates;
            senderId?: string | null;
            lastTest?: ProviderChannelSnapshot['lastTest'];
            misconfigurationCode?: string | null;
            keyFingerprint: string | null;
            timeoutMs: number | null;
          };
          email: {
            provider: string;
            baseUrl: string | null;
            configured: boolean;
            verified?: boolean;
            enabled?: boolean;
            deliveryTested?: boolean;
            productionReady?: boolean;
            lifecycleState?: ProviderLifecycleState;
            gates?: ProviderReadinessGates;
            lastTest?: ProviderChannelSnapshot['lastTest'];
            misconfigurationCode?: string | null;
            domainAuth?: {
              spfConfigured: boolean;
              dkimConfigured: boolean;
              dmarcConfigured: boolean;
              allConfigured: boolean;
            } | null;
            keyFingerprint: string | null;
            from: string | null;
            fromName?: string | null;
            replyTo: string | null;
            timeoutMs: number | null;
          };
          worker: {
            enabled: boolean;
            pollIntervalMs: number | null;
            batchSize: number | null;
            retryMaxAttempts: number | null;
            retryBaseDelaySeconds: number | null;
          };
        }>('/internal/notifications/provider-status');

        // Scope discipline: environment and outbox health are loaded by the console through
        // their OWN permission-gated endpoints (getSafeRuntimeConfig / getDiagnostics) —
        // this mapping never cross-calls endpoints the current principal may lack scope for.
        const environment: string = 'unknown';
        const pendingOutboxCount = 0;

        const smsProvider = raw.sms?.provider ?? 'console';
        const emailProvider = raw.email?.provider ?? 'none';

        const smsOperationalStatus: NotificationProviderStatus['sms']['operationalStatus'] =
          raw.sms?.lifecycleState !== undefined
            ? smsProvider === 'console'
              ? 'CONSOLE_ONLY'
              : raw.sms.lifecycleState === 'MISCONFIGURED' || raw.sms.lifecycleState === 'NOT_CONFIGURED'
                ? 'MISCONFIGURED'
                : raw.sms.deliveryTested && raw.sms.enabled
                  ? 'READY'
                  : 'DEGRADED'
            : raw.sms?.configured
              ? 'READY'
              : smsProvider === 'console'
                ? 'CONSOLE_ONLY'
                : 'MISCONFIGURED';

        const emailOperationalStatus: NotificationProviderStatus['email']['operationalStatus'] =
          raw.email?.lifecycleState !== undefined
            ? emailProvider === 'none' || raw.email.lifecycleState === 'NOT_CONFIGURED'
              ? 'NOT_CONFIGURED'
              : emailProvider === 'console'
                ? 'CONSOLE_ONLY'
                : raw.email.deliveryTested && raw.email.enabled
                  ? 'READY'
                  : 'DEGRADED'
            : emailProvider === 'none'
              ? 'NOT_CONFIGURED'
              : emailProvider === 'console'
                ? 'CONSOLE_ONLY'
                : raw.email?.configured
                  ? 'READY'
                  : 'DEGRADED';

        const domainVerificationStatus: NotificationProviderStatus['email']['domainVerificationStatus'] =
          emailProvider === 'none' || emailProvider === 'console'
            ? 'NOT_APPLICABLE'
            : raw.email?.domainAuth
              ? raw.email.domainAuth.allConfigured
                ? 'VERIFIED'
                : 'UNVERIFIED'
              : 'NOT_APPLICABLE';

        const mapped: NotificationProviderStatus = {
          checkedAt: new Date().toISOString(),
          environment,
          worker: {
            enabled: raw.worker?.enabled === true,
            batchSize: Number(raw.worker?.batchSize ?? 0),
            smsRetryMaxAttempts: Number(raw.worker?.retryMaxAttempts ?? 0),
            smsRetryBaseDelaySeconds: Number(raw.worker?.retryBaseDelaySeconds ?? 0),
            pendingOutboxCount,
          },
          sms: {
            provider: smsProvider,
            operationalStatus: smsOperationalStatus,
            lifecycleState: raw.sms?.lifecycleState,
            gates: raw.sms?.gates,
            senderId: raw.sms?.senderId ?? null,
            lastTest: raw.sms?.lastTest,
            baseUrl: raw.sms?.baseUrl ?? null,
            apiKeyConfigured: Boolean(raw.sms?.configured),
            apiKeyPrefixValid: Boolean(raw.sms?.keyFingerprint),
            apiKeyLast4Fingerprint: raw.sms?.keyFingerprint ?? null,
            requestTimeoutMs: Number(raw.sms?.timeoutMs ?? 0),
            productionGuardSatisfied:
              smsProvider === 'console'
                ? false
                : raw.sms?.lifecycleState !== undefined
                  ? Boolean(raw.sms?.enabled && raw.sms?.configured)
                  : Boolean(raw.sms?.configured),
            senderIdentityMode: 'PROVIDER_WORKSPACE_ACCOUNT',
            senderIdentitySummary:
              smsProvider === 'robase'
                ? raw.sms?.senderId
                  ? `Workspace sender ID "${raw.sms.senderId}" recorded (bound at Robase workspace level).`
                  : 'Sender identity is managed by the Robase workspace/account configuration.'
                : `No live sender identity — provider '${smsProvider}' does not transmit messages.`,
            deliveryReceiptTracking: 'ACCEPTED_BY_PROVIDER_ONLY',
          },
          email: {
            channelEnabledInSchema: (raw.channels ?? []).includes('EMAIL'),
            provider: emailProvider === 'none' ? null : emailProvider,
            operationalStatus: emailOperationalStatus,
            lifecycleState: raw.email?.lifecycleState,
            gates: raw.email?.gates,
            lastTest: raw.email?.lastTest,
            credentialsConfigured: Boolean(raw.email?.configured),
            credentialFingerprint: raw.email?.keyFingerprint ?? null,
            fromAddress: raw.email?.from ?? null,
            fromName: raw.email?.fromName ?? null,
            domainVerificationStatus,
            honorsCustomerEmailPreference: true,
          },
        };
        return sanitizeProviderStatusForDisplay(mapped);
      },
    });
  },

  /**
   * ARENA 3 — governed controlled test-send to a workforce-owned destination.
   * The real endpoint accepts ONLY { channel, destination } and sends fixed safe content
   * (no template/event selection, no custom reason on the wire); the console-side
   * attestation and reason remain part of the local audit trail shown to the operator.
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
      run: async () => {
        const res = await ApiClient.post<{
          status: 'SENT' | 'FAILED';
          channel: string;
          correlationId: string;
          destination: string;
          provider: string;
          providerRef: string | null;
          errorCode: string | null;
        }>(
          '/internal/notifications/test-send',
          { channel: payload.channel, destination: payload.destination },
          { idempotencyKey },
        );
        return {
          status: res.status,
          deliveryId: null,
          approvalId: null,
          providerRef: res.providerRef ?? null,
          correlationId: res.correlationId ?? null,
          renderedSubject: null,
          renderedMessage: null,
          lastError: res.errorCode ?? null,
          rateLimitRemaining: null,
        };
      },
    });
  },

  /**
   * ARENA 1 registry — maker-checker change queue (GET /internal/notifications/changes).
   * REQUESTED proposals are enriched (bounded) with their frozen payloads so checkers can
   * inspect exactly what will be executed.
   */
  async listChangeRequests(
    statusFilter?: string,
  ): Promise<IntegrationResult<NotificationChangeRequestRecord[]>> {
    const mappedStatus =
      statusFilter === 'PENDING_APPROVAL' ? 'REQUESTED' : statusFilter === 'APPLIED' ? 'CONSUMED' : statusFilter;
    const qs = mappedStatus ? `?status=${encodeURIComponent(mappedStatus)}` : '';
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'GET',
      endpoint: '/internal/notifications/changes',
      blockedExplanation:
        'BLOCKED on ARENA 1: Notification change-request listing endpoint (GET /internal/notifications/changes) is not yet integrated.',
      run: async () => {
        const res = await ApiClient.get<unknown>(`/internal/notifications/changes${qs}`);
        const rows = extractArray<RegistryChangeRow>(res);
        const enriched = await Promise.all(
          rows.slice(0, 10).map(async (row) => {
            try {
              return await ApiClient.get<RegistryChangeDetail>(
                `/internal/notifications/changes/${encodeURIComponent(row.approvalId)}`,
              );
            } catch {
              return null;
            }
          }),
        );
        return rows.map((row, index) => {
          const detail = index < enriched.length ? enriched[index] : null;
          const change = detail?.change;
          const summaryParts = [`${mapChangeType(row.type).replace(/_/g, ' ')}`, row.eventType, row.channel]
            .filter(Boolean)
            .join(' · ');
          return {
            id: row.approvalId,
            approvalId: row.approvalId,
            changeType: mapChangeType(row.type),
            eventType: row.eventType ?? change?.eventType ?? 'unknown',
            channel: (row.channel ?? change?.channel ?? 'MULTI') as NotificationChangeRequestRecord['channel'],
            summary: detail?.reason ? `${summaryParts} — ${detail.reason}` : summaryParts,
            status: mapChangeStatus(row.status),
            requestedBy: row.createdBy,
            requestedAt: row.createdAt,
            decidedBy: row.approvedBy,
            decidedAt: null,
            decisionComment: null,
            proposedSubject: change?.subject ?? null,
            proposedBody: change?.body ?? null,
            proposedSmsEnabled: change?.channel === 'SMS' ? change?.enabled : undefined,
            proposedEmailEnabled: change?.channel === 'EMAIL' ? change?.enabled : undefined,
          };
        });
      },
    });
  },

  /**
   * Checker decision on a notification change request. The real decision route is the
   * shared workforce approval endpoint (FINANCE_CONTROLLER + privileged:approve + MFA,
   * maker ≠ checker); an approval is followed by executing the frozen proposal
   * (POST /internal/notifications/changes/:approvalId/execute) so the governed change is
   * actually applied — approval alone never mutates templates or configuration.
   */
  async decideNotificationChangeRequest(
    requestId: string,
    decision: 'approve' | 'reject',
    comment: string,
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'POST',
      endpoint: `/internal/a2/workforce/approvals/${requestId}/${decision}`,
      blockedExplanation:
        'BLOCKED on ARENA 1: Workforce approval decision endpoint is not yet integrated for notification change requests.',
      run: async () => {
        const trimmed = comment.trim() || undefined;
        await ApiClient.post(
          `/internal/a2/workforce/approvals/${encodeURIComponent(requestId.trim())}/${decision}`,
          decision === 'reject'
            ? { comment: trimmed, ...(trimmed ? { reason: trimmed } : {}) }
            : { comment: trimmed },
        );
        if (decision === 'reject') {
          return {
            status: 'REJECTED',
            approvalId: requestId,
            changeRequestId: requestId,
            updatedAt: new Date().toISOString(),
            message: 'Change request rejected; the frozen proposal was discarded and nothing was applied.',
          };
        }
        try {
          const executed = await ApiClient.post<{ approvalId: string; type: string }>(
            `/internal/notifications/changes/${encodeURIComponent(requestId.trim())}/execute`,
          );
          return {
            status: 'APPLIED',
            approvalId: requestId,
            changeRequestId: requestId,
            updatedAt: new Date().toISOString(),
            message: `Approved change ${executed.approvalId} (${executed.type}) executed — the frozen proposal is now applied.`,
          };
        } catch (error) {
          return {
            status: 'APPROVED',
            approvalId: requestId,
            changeRequestId: requestId,
            updatedAt: new Date().toISOString(),
            message: `Approval recorded, but execution failed: ${getErrorMessage(error, 'unknown error')}. The proposal remains APPROVED and execution can be retried from the queue.`,
          };
        }
      },
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
   * LIVE TODAY — GET /internal/notifications/deliveries (AdminNotificationController).
   * The EMAIL channel filter is live (VALID_CHANNELS = SMS, PUSH, EMAIL since the Arena 3
   * migration + controller widening); the legacy 400-BLOCKED branch is retained only as a
   * defensive fallback for deployments still running the pre-widening schema.
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
   * Manual delivery retry is DEFERRED BY REQUIREMENT, not missing by accident:
   * - Approved V1 scope (docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md, notification
   *   deliveries page) mandates a READ-ONLY surface: "No retry/replay/mutation controls".
   * - The approved retry mechanism is the automatic bounded worker retry
   *   (SMS_RETRY_MAX_ATTEMPTS + exponential backoff, FOR UPDATE SKIP LOCKED, isolated
   *   from all financial services) per docs/V1/V1-AGENT-MOBILE-17-RELEASE-INFRASTRUCTURE-HANDOFF.md.
   * - The Arena 2 contract document itself labelled a manual-retry route "Optional".
   * Adding one would require a new requirement + authorization policy decision; until then
   * the 404 maps to an honest BLOCKED/deferred state and no endpoint is invented.
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
        `DEFERRED (approved V1 scope is read-only — no retry/replay controls): manual delivery retry endpoint (${endpoint}) does not exist by requirement. Failed deliveries are retried automatically by NotificationWorkerService (bounded attempts, exponential backoff); a manual-retry capability needs a new requirement + authorization policy decision.`,
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

  /**
   * Governed Provider Configuration — read non-secret SMS & Email provider configuration,
   * encryption keyring status, 5-gate readiness, and contract notes.
   */
  async getProviderConfiguration(): Promise<IntegrationResult<ProviderConfigurationOverview>> {
    const endpoint = '/internal/notifications/provider-config';
    return callTypedBoundary({
      owner: 'ARENA_3',
      method: 'GET',
      endpoint,
      blockedExplanation:
        'Provider configuration endpoint (GET /internal/notifications/provider-config) is not available on this server.',
      run: async () => {
        const raw = await ApiClient.get<ProviderConfigurationOverview>(endpoint);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.sms || !raw.email) {
          const err = new Error('Provider configuration endpoint not integrated') as Error & {
            status?: number;
          };
          err.status = 404;
          throw err;
        }
        return sanitizeProviderStatusForDisplay(raw);
      },
    });
  },

  /**
   * Governed Provider Configuration — list non-secret maker-checker proposals.
   */
  async listProviderConfigProposals(params?: {
    channel?: ManagedProviderChannel;
    status?: string;
    limit?: number;
  }): Promise<IntegrationResult<ProviderConfigProposal[]>> {
    const query = new URLSearchParams();
    if (params?.channel) query.set('channel', params.channel);
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString() ? `?${query.toString()}` : '';
    const endpoint = `/internal/notifications/provider-config/proposals${qs}`;
    return callTypedBoundary({
      owner: 'ARENA_3',
      method: 'GET',
      endpoint: '/internal/notifications/provider-config/proposals',
      blockedExplanation:
        'Provider configuration proposals endpoint is not available on this server.',
      run: async () => {
        const res = await ApiClient.get<unknown>(endpoint);
        return sanitizeProviderStatusForDisplay(extractArray<ProviderConfigProposal>(res));
      },
    });
  },

  /**
   * Governed Provider Configuration — submit maker proposal (SUPER_ADMIN + MFA).
   */
  async proposeProviderConfig(
    payload: ProposeProviderConfigPayload,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<ProviderConfigProposal> {
    const raw = await ApiClient.post<ProviderConfigProposal>(
      '/internal/notifications/provider-config/proposals',
      payload,
      { idempotencyKey },
    );
    return sanitizeProviderStatusForDisplay(raw);
  },

  /**
   * Governed Provider Configuration — independent checker approval (FINANCE_CONTROLLER + MFA).
   */
  async approveProviderConfigProposal(
    proposalId: string,
    comment?: string,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<ProviderConfigProposal> {
    const raw = await ApiClient.post<ProviderConfigProposal>(
      `/internal/notifications/provider-config/proposals/${encodeURIComponent(proposalId)}/approve`,
      comment ? { comment } : {},
      { idempotencyKey },
    );
    return sanitizeProviderStatusForDisplay(raw);
  },

  /**
   * Governed Provider Configuration — independent checker rejection (FINANCE_CONTROLLER + MFA).
   */
  async rejectProviderConfigProposal(
    proposalId: string,
    comment?: string,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<ProviderConfigProposal> {
    const raw = await ApiClient.post<ProviderConfigProposal>(
      `/internal/notifications/provider-config/proposals/${encodeURIComponent(proposalId)}/reject`,
      comment ? { comment } : {},
      { idempotencyKey },
    );
    return sanitizeProviderStatusForDisplay(raw);
  },

  /**
   * Governed Provider Configuration — activate an approved proposal (MFA required).
   */
  async activateProviderConfigProposal(
    proposalId: string,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<{ proposal: ProviderConfigProposal; configuration: ProviderChannelSnapshot }> {
    const raw = await ApiClient.post<{
      proposal: ProviderConfigProposal;
      configuration: ProviderChannelSnapshot;
    }>(
      `/internal/notifications/provider-config/proposals/${encodeURIComponent(proposalId)}/activate`,
      {},
      { idempotencyKey },
    );
    return sanitizeProviderStatusForDisplay(raw);
  },

  /**
   * Governed Provider Configuration — authorized connection / cryptographic verification.
   */
  async verifyProviderChannel(
    channel: ManagedProviderChannel,
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<{
    verified: boolean;
    channel: ManagedProviderChannel;
    provider: string;
    verificationMethod: string | null;
    errorCode: string | null;
    liveEndpointNote: string | null;
    snapshot: ProviderChannelSnapshot;
  }> {
    const raw = await ApiClient.post<{
      verified: boolean;
      channel: ManagedProviderChannel;
      provider: string;
      verificationMethod: string | null;
      errorCode: string | null;
      liveEndpointNote: string | null;
      snapshot: ProviderChannelSnapshot;
    }>(
      `/internal/notifications/provider-config/${encodeURIComponent(channel)}/verify`,
      {},
      { idempotencyKey },
    );
    return sanitizeProviderStatusForDisplay(raw);
  },
};
