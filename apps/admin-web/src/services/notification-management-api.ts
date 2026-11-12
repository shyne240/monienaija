import { ApiClient } from './api-client';
import {
  estimateSmsSegments,
  extractTemplateVariables,
  BASELINE_CODE_EVENT_CATALOGUE,
  ManagedNotificationChannel,
  NotificationConfigurationTarget,
  NotificationChangeRequestRecord,
  NotificationDeliveryPage,
  NotificationDeliveryRecord,
  NotificationEventCatalogueItem,
  NotificationOutboxReceiptPage,
  NotificationOutboxReceiptRecord,
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
  SECURITY_LOCKED_EVENT_TYPES,
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

interface WorkforceDecisionReceipt {
  approved?: boolean;
  reason?: string;
  approval?: { id?: string; status?: string };
}

function validateWorkforceDecisionReceipt(value: unknown, approvalId: string, decision: 'approve' | 'reject'): void {
  const receipt = value as WorkforceDecisionReceipt | null;
  const expectedStatus = decision === 'approve' ? 'APPROVED' : 'REJECTED';
  if (!receipt || receipt.approval?.id !== approvalId || receipt.approval.status !== expectedStatus ||
      receipt.reason !== expectedStatus || receipt.approved !== (decision === 'approve')) {
    throw new Error('Decision outcome not confirmed. Refresh the approval queue and audit record before retrying.');
  }
}

function validateNotificationExecutionReceipt(value: unknown, approvalId: string): void {
  const receipt = value as { approvalId?: string; type?: string } | null;
  if (!receipt || receipt.approvalId !== approvalId || !['TEMPLATE', 'TEMPLATE_ROLLBACK', 'CONFIGURATION'].includes(receipt.type ?? '')) {
    throw new Error('Execution outcome not confirmed. Refresh the approval queue and audit record before retrying.');
  }
}

export interface NotificationGovernanceAuditResult {
  rows: Array<Record<string, unknown>>;
  failedCategories: string[];
}

export interface UpdateEventConfigurationPayload {
  channel: NotificationConfigurationTarget;
  enabled: boolean;
  /** Version from the effective registry snapshot the maker actually edited. */
  expectedVersion: number;
  reason: string;
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
  expectedVersion: number;
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
  destination: string;
  workforceDestinationConfirmed: true;
}

export interface OutboxReceiptQueryFilters {
  page?: number;
  limit?: number;
  status?: string;
}

export interface ControlledTestSendOutcome {
  status: 'SENT' | 'PENDING_APPROVAL' | 'FAILED';
  provider?: string | null;
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
  eventEnabled?: boolean;
  eventLocked?: boolean;
  eventConfigurationVersion?: number;
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

// The creation response identifies the approval but does not echo its frozen target.
// Validate the available receipt fields; operators must still inspect the proposal.
function confirmedRegistryCreation(value: RegistryChangeCreation | null | undefined, action: string): value is RegistryChangeCreation {
  return !!value && typeof value.approvalId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.approvalId)
    && value.status === 'REQUESTED' && value.actionType === action
    && typeof value.actionFingerprint === 'string' && !!value.actionFingerprint.trim()
    && typeof value.requestedAt === 'string' && Number.isFinite(Date.parse(value.requestedAt))
    && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt))
    && Date.parse(value.expiresAt) > Date.parse(value.requestedAt);
}

// Both diagnostic endpoints return explicit pagination. Never manufacture empty
// pages or totals when a malformed or wrong-page response arrives.
function requireDiagnosticPage<T>(value: unknown, page: number, limit: number, isRow: (row: any) => boolean): { data: T[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean } {
  const result = value as { data?: unknown; total?: unknown; page?: unknown; limit?: unknown; totalPages?: unknown; hasNextPage?: unknown } | null;
  if (!result || !Array.isArray(result.data) || result.page !== page || result.limit !== limit ||
      !Number.isSafeInteger(result.total) || (result.total as number) < 0 ||
      !Number.isSafeInteger(result.totalPages) || result.totalPages !== Math.ceil((result.total as number) / limit) ||
      result.hasNextPage !== (page < (result.totalPages as number)) || result.data.length > limit || result.data.length > (result.total as number) || !result.data.every(isRow)) {
    throw new Error('Diagnostic response could not be verified. Refresh before relying on these results.');
  }
  return result as { data: T[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean };
}
const nonEmptyDiagnosticString = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const validDiagnosticTime = (value: unknown): boolean => typeof value === 'string' && Number.isFinite(Date.parse(value));
// These projections deliberately discard unexpected message, destination, payload or secret
// fields even if an older/misconfigured server sends them.
function projectDiagnosticFields<T>(row: T, keys: readonly string[]): T {
  const input = row as Record<string, unknown>;
  return Object.fromEntries(keys.filter(key => Object.prototype.hasOwnProperty.call(input, key)).map(key => [key, input[key]])) as T;
}
const DELIVERY_FIELDS = ['id', 'eventType', 'eventKey', 'aggregateType', 'aggregateId', 'recipientType', 'recipientId', 'channel', 'status', 'attempts', 'providerRef', 'correlationId', 'causationId', 'errorCode', 'createdAt', 'updatedAt', 'sentAt', 'failedAt'] as const;
const RECEIPT_FIELDS = ['outboxEventId', 'status', 'reason', 'attempts', 'nextAttemptAt', 'createdAt', 'updatedAt'] as const;
const optionalStringFields = (row: Record<string, unknown>, keys: readonly string[]) => keys.every(key => row[key] == null || typeof row[key] === 'string');


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

// Mirror the server's masked receipt; the test endpoint does not return the raw destination.
function maskTestDestination(channel: ManagedNotificationChannel, destination: string): string {
  if (channel === 'EMAIL') {
    const [local, domain] = destination.split('@');
    return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
  }
  const digits = destination.replace(/\D/g, '');
  const keep = Math.min(3, digits.length);
  return `${destination.slice(0, destination.length - keep).replace(/\d/g, '*')}${digits.slice(-keep)}`;
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

function mapRegistryEvent(item: RegistryEventItem): NotificationEventCatalogueItem {
  const baseline = BASELINE_CODE_EVENT_CATALOGUE.find((entry) => entry.eventType === item.eventType);
  const sms = item.channels?.SMS;
  const email = item.channels?.EMAIL;
  const registryLocked = Boolean(sms?.locked || email?.locked) || !item.editable;
  // EVENT, SMS and EMAIL have independent locks. A lock on one target must not
  // disable the other targets; SECURITY and non-editable events remain locked.
  const locked =
    !item.editable ||
    item.deliveryClass === 'SECURITY' ||
    SECURITY_LOCKED_EVENT_TYPES.has(item.eventType) ||
    (item.eventLocked === true && sms?.locked === true && email?.locked === true);
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
    eventEnabled: typeof item.eventEnabled === 'boolean' ? item.eventEnabled : undefined,
    eventLocked: typeof item.eventLocked === 'boolean' ? item.eventLocked : undefined,
    eventConfigurationVersion: item.eventConfigurationVersion,
    smsEnabled: typeof sms?.enabled === 'boolean' ? sms.enabled : undefined,
    smsLocked: typeof sms?.locked === 'boolean' ? sms.locked : undefined,
    smsConfigurationVersion: sms?.configurationVersion,
    emailEnabled: typeof email?.enabled === 'boolean' ? email.enabled : undefined,
    emailLocked: typeof email?.locked === 'boolean' ? email.locked : undefined,
    emailConfigurationVersion: email?.configurationVersion,
    toggleLocked: locked,
    lockReason: locked ? (baseline?.lockReason ?? 'This event is locked against configuration changes.') : null,
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
      return 'REJECTED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'CONSUMED':
      return 'APPLIED';
    default:
      return 'UNKNOWN';
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
  if (SECURITY_LOCKED_EVENT_TYPES.has(eventType)) {
    return [];
  }
  const query = new URLSearchParams({ eventType, channel, limit: String(limit) });
  const res = await ApiClient.get<unknown>(`/internal/notifications/templates?${query.toString()}`);
  const validList = Array.isArray(res) || Boolean(res && typeof res === 'object' && ['data', 'items', 'templates'].some(key => Array.isArray((res as Record<string, unknown>)[key])));
  if (!validList) throw new Error('Template registry returned an invalid list.');
  const rows = extractArray<RegistryTemplateRow>(res);
  if (rows.some(row => !row || typeof row.id !== 'string' || row.eventType !== eventType || row.channel !== channel || typeof row.locale !== 'string' || !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.active !== 'boolean' || typeof row.body !== 'string')) throw new Error('Template registry returned invalid or mismatched versions.');
  return rows;
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
   * Create one frozen, versioned CONFIGURATION proposal. The caller supplies the
   * version from the snapshot the maker edited; fetching a newer version here would
   * hide concurrent changes. Each EVENT/SMS/EMAIL target requires its own approval.
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
        'The change request or endpoint was unavailable (404/501). Refresh the registry and check integration; submission was not confirmed.',
      run: async () => {
        if (SECURITY_LOCKED_EVENT_TYPES.has(eventType)) {
          throw new Error('SECURITY events cannot be changed through notification configuration.');
        }
        if (!Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 1) {
          throw new Error('A valid snapshot configuration version is required.');
        }
        const created = await ApiClient.post<RegistryChangeCreation>(
          '/internal/notifications/changes',
          {
            type: 'CONFIGURATION',
            eventType,
            channel: payload.channel,
            enabled: payload.enabled,
            expectedVersion: payload.expectedVersion,
            reason: payload.reason,
          },
          { idempotencyKey },
        );
        if (!confirmedRegistryCreation(created, 'NOTIFICATION_EVENT_CONFIGURATION_CHANGE')) {
          throw new Error('Proposal status could not be confirmed. Check the approval queue before retrying.');
        }
        return {
          status: 'PENDING_APPROVAL',
          approvalId: created.approvalId,
          changeRequestId: created.approvalId,
          requestedBy: null,
          updatedAt: created.requestedAt,
        };
      },
    });
  },

  /**
   * ARENA 1 registry — template version history read boundary.
   * Non-editable SECURITY events (`editable === false` / `SECURITY_LOCKED_EVENT_TYPES`)
   * are strictly excluded before any HTTP request is issued so the console never triggers
   * guaranteed HTTP 400 responses (`N-02`), and concurrency is bounded to reduce fan-out.
   */
  async listTemplates(params?: {
    eventType?: string;
    channel?: ManagedNotificationChannel;
    includeHistory?: boolean;
    editableEventTypes?: string[];
  }): Promise<IntegrationResult<NotificationTemplateVersion[]>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'GET',
      endpoint: '/internal/notifications/templates',
      blockedExplanation:
        'BLOCKED on ARENA 1: DB-backed notification_templates registry endpoint (GET /internal/notifications/templates) is not yet integrated.',
      run: async () => {
        if (params?.eventType && params?.channel) {
          if (SECURITY_LOCKED_EVENT_TYPES.has(params.eventType)) {
            return [];
          }
          const rows = await fetchTemplatePage(params.eventType, params.channel, 100);
          return rows.map(mapRegistryTemplate);
        }
        const editableEventTypes = params?.editableEventTypes
          ? params.editableEventTypes.filter((et) => !SECURITY_LOCKED_EVENT_TYPES.has(et))
          : (await fetchRegistryEvents())
              .filter(
                (event) =>
                  event.editable !== false &&
                  event.deliveryClass !== 'SECURITY' &&
                  !SECURITY_LOCKED_EVENT_TYPES.has(event.eventType),
              )
              .map((event) => event.eventType);

        const channels: ManagedNotificationChannel[] = params?.channel
          ? [params.channel]
          : ['SMS', 'EMAIL'];
        const limit = params?.includeHistory === false ? 1 : 10;
        const pairs = editableEventTypes.flatMap((eventType) =>
          channels.map((channel) => ({ eventType, channel })),
        );
        const collected: RegistryTemplateRow[] = [];
        const batchSize = 6;
        for (let i = 0; i < pairs.length; i += batchSize) {
          const slice = pairs.slice(i, i + batchSize);
          const chunk = await Promise.all(
            slice.map(({ eventType, channel }) => fetchTemplatePage(eventType, channel, limit)),
          );
          for (const rows of chunk) {
            collected.push(...rows);
          }
        }
        return collected.map(mapRegistryTemplate);
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
        'BLOCKED on ARENA 1: Notification change-request endpoint (POST /internal/notifications/changes) is not yet integrated. Submission was not confirmed; check the approval queue before retrying.',
      run: async () => {
        const expectedVersion = payload.expectedVersion;
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('A confirmed active template snapshot is required.');
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
        if (!confirmedRegistryCreation(created, 'NOTIFICATION_TEMPLATE_CHANGE')) throw new Error('Template proposal outcome not confirmed. Check the approval queue before retrying.');
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
    body: { comment?: string; approvalIds?: string[]; expectedVersion: number },
    idempotencyKey = generateNotificationIdempotencyKey(),
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'POST',
      endpoint: '/internal/notifications/changes',
      blockedExplanation:
        'BLOCKED on ARENA 1: Notification change-request endpoint (POST /internal/notifications/changes) is not yet integrated. The proposal outcome was not confirmed; check the approval queue before retrying.',
      run: async () => {
        if (typeof version === 'string') {
          throw new Error(
            'Activation requires the full template version row (eventType, channel, version) — the registry governs activation through frozen TEMPLATE_ROLLBACK proposals, not template IDs.',
          );
        }
        const expectedVersion = body.expectedVersion;
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('A confirmed active template snapshot is required.');
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
        if (!confirmedRegistryCreation(created, 'NOTIFICATION_TEMPLATE_CHANGE')) throw new Error('Template proposal outcome not confirmed. Check the approval queue before retrying.');
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
          projectionScope?: 'MINIMAL' | 'FULL';
          sms: {
            available?: boolean;
            provider?: string;
            baseUrl?: string | null;
            configured?: boolean;
            verified?: boolean;
            enabled?: boolean;
            deliveryTested?: boolean;
            productionReady?: boolean;
            lifecycleState?: ProviderLifecycleState;
            gates?: ProviderReadinessGates;
            senderId?: string | null;
            lastTest?: ProviderChannelSnapshot['lastTest'];
            misconfigurationCode?: string | null;
            keyFingerprint?: string | null;
            timeoutMs?: number | null;
          };
          email: {
            available?: boolean;
            provider?: string;
            baseUrl?: string | null;
            configured?: boolean;
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
            keyFingerprint?: string | null;
            from?: string | null;
            fromName?: string | null;
            replyTo?: string | null;
            timeoutMs?: number | null;
          };
          worker?: {
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
        if (!raw || !Array.isArray(raw.channels) || !raw.channels.every(channel => typeof channel === 'string') ||
          !raw.sms || !raw.email || !['MINIMAL', 'FULL'].includes(raw.projectionScope ?? '')) {
          throw new Error('Provider status response could not be verified.');
        }
        if (raw.projectionScope === 'MINIMAL' && (typeof raw.sms.available !== 'boolean' || typeof raw.email.available !== 'boolean')) {
          throw new Error('Provider availability response could not be verified.');
        }
        if (raw.projectionScope === 'FULL' && (!nonEmptyDiagnosticString(raw.sms.provider) || !nonEmptyDiagnosticString(raw.email.provider) ||
          typeof raw.sms.enabled !== 'boolean' || typeof raw.sms.configured !== 'boolean' ||
          typeof raw.email.enabled !== 'boolean' || typeof raw.email.configured !== 'boolean' ||
          typeof raw.sms.deliveryTested !== 'boolean' || typeof raw.email.deliveryTested !== 'boolean' ||
          !['NOT_CONFIGURED', 'CONSOLE_ONLY', 'MISCONFIGURED', 'CONFIGURED', 'VERIFIED', 'ENABLED', 'DELIVERY_TESTED', 'PRODUCTION_READY'].includes(raw.sms.lifecycleState ?? '') ||
          !['NOT_CONFIGURED', 'CONSOLE_ONLY', 'MISCONFIGURED', 'CONFIGURED', 'VERIFIED', 'ENABLED', 'DELIVERY_TESTED', 'PRODUCTION_READY'].includes(raw.email.lifecycleState ?? '') ||
          (raw.email.domainAuth != null && (typeof raw.email.domainAuth.spfConfigured !== 'boolean' || typeof raw.email.domainAuth.dkimConfigured !== 'boolean' || typeof raw.email.domainAuth.dmarcConfigured !== 'boolean' || raw.email.domainAuth.allConfigured !== (raw.email.domainAuth.spfConfigured && raw.email.domainAuth.dkimConfigured && raw.email.domainAuth.dmarcConfigured))) ||
          !raw.worker || typeof raw.worker.enabled !== 'boolean' ||
          ![raw.worker.batchSize, raw.worker.retryMaxAttempts, raw.worker.retryBaseDelaySeconds].every(value => Number.isSafeInteger(value) && (value as number) >= 0))) {
          throw new Error('Provider status response could not be verified.');
        }

        if (raw.projectionScope === 'MINIMAL') {
          const smsAvail = raw.sms?.available === true;
          const emailAvail = raw.email?.available === true;
          const minimalMapped: NotificationProviderStatus = {
            checkedAt: new Date().toISOString(),
            environment: null,
            projectionScope: 'MINIMAL',
            worker: {
              enabled: null,
              redacted: true,
              batchSize: null,
              smsRetryMaxAttempts: null,
              smsRetryBaseDelaySeconds: null,
              pendingOutboxCount: null,
            },
            sms: {
              provider: 'redacted',
              operationalStatus: smsAvail ? 'READY' : 'DEGRADED',
              senderId: null,
              baseUrl: null,
              apiKeyConfigured: null,
              apiKeyPrefixValid: null,
              apiKeyLast4Fingerprint: null,
              requestTimeoutMs: null,
              productionGuardSatisfied: null,
              senderIdentityMode: 'PROVIDER_WORKSPACE_ACCOUNT',
              senderIdentitySummary:
                'Provider identity and configuration details require notification.provider.view.',
              deliveryReceiptTracking: 'ACCEPTED_BY_PROVIDER_ONLY',
            },
            email: {
              channelEnabledInSchema: (raw.channels ?? []).includes('EMAIL'),
              provider: null,
              operationalStatus: emailAvail ? 'READY' : 'NOT_CONFIGURED',
              credentialsConfigured: null,
              credentialFingerprint: null,
              fromAddress: null,
              fromName: null,
              domainVerificationStatus: 'NOT_APPLICABLE',
              honorsCustomerEmailPreference: null,
            },
          };
          return sanitizeProviderStatusForDisplay(minimalMapped);
        }

        const smsProvider = raw.sms?.provider ?? 'console';
        const emailProvider = raw.email?.provider ?? 'none';

        const smsOperationalStatus: NotificationProviderStatus['sms']['operationalStatus'] =
          raw.sms?.lifecycleState !== undefined
            ? smsProvider === 'console'
              ? 'CONSOLE_ONLY'
              : raw.sms.lifecycleState === 'MISCONFIGURED' || raw.sms.lifecycleState === 'NOT_CONFIGURED'
                ? 'MISCONFIGURED'
                : (raw.sms.deliveryTested ||
                      raw.sms.lifecycleState === 'DELIVERY_TESTED' ||
                      raw.sms.lifecycleState === 'PRODUCTION_READY') &&
                    raw.sms.enabled && raw.sms.configured
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
                : (raw.email.deliveryTested ||
                      raw.email.lifecycleState === 'DELIVERY_TESTED' ||
                      raw.email.lifecycleState === 'PRODUCTION_READY') &&
                    raw.email.enabled && raw.email.configured
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
                ? 'CONFIGURED'
                : 'INCOMPLETE'
              : 'UNKNOWN';

        const mapped: NotificationProviderStatus = {
          checkedAt: new Date().toISOString(),
          environment: null,
          projectionScope: 'FULL',
          worker: {
            enabled: raw.worker?.enabled === true,
            redacted: false,
            batchSize: Number(raw.worker?.batchSize ?? 0),
            smsRetryMaxAttempts: Number(raw.worker?.retryMaxAttempts ?? 0),
            smsRetryBaseDelaySeconds: Number(raw.worker?.retryBaseDelaySeconds ?? 0),
            pendingOutboxCount: null,
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
            apiKeyPrefixValid: null,
            apiKeyLast4Fingerprint: raw.sms?.keyFingerprint ?? null,
            requestTimeoutMs: typeof raw.sms?.timeoutMs === 'number' ? raw.sms.timeoutMs : null,
            productionGuardSatisfied: null,
            senderIdentityMode: 'PROVIDER_WORKSPACE_ACCOUNT',
            senderIdentitySummary:
              smsProvider === 'robase'
                ? raw.sms?.senderId
                  ? `Workspace sender ID "${raw.sms.senderId}" recorded (bound at Robase workspace level).`
                  : 'Sender identity is managed by the Robase workspace/account configuration.'
                : smsProvider === 'console' ? 'Console provider simulates sends; no live sender identity is reported.' : 'Sender identity is not reported for this provider.',
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
            honorsCustomerEmailPreference: null,
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
        'Controlled test-send endpoint was unavailable (404/501); submission outcome is not confirmed.',
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
        if (!res || res.channel !== payload.channel || res.destination !== maskTestDestination(payload.channel, payload.destination) || typeof res.correlationId !== 'string' || !res.correlationId.trim() || !['SENT', 'FAILED'].includes(res.status) || typeof res.provider !== 'string' || !res.provider.trim()) {
          throw new Error('Test-send receipt did not match the requested channel and masked destination, or lacked a correlation reference.');
        }
        return {
          status: res.status,
          provider: res.provider,
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
        if (!Array.isArray(res) && !(res && typeof res === 'object' && (Array.isArray((res as any).items) || Array.isArray((res as any).data)))) throw new Error('Notification queue response could not be verified.');
        const rows = extractArray<RegistryChangeRow>(res);
        if (rows.some(row => !row || typeof row.approvalId !== 'string' || !row.approvalId || !['TEMPLATE', 'TEMPLATE_ROLLBACK', 'CONFIGURATION'].includes(row.type) || typeof row.createdBy !== 'string' || !row.createdBy || typeof row.createdAt !== 'string' || typeof row.status !== 'string')) throw new Error('Notification queue contains an invalid entry.');
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
          const candidate = index < enriched.length ? enriched[index] : null;
          const detail = candidate?.approvalId === row.approvalId && candidate.change?.type === row.type && candidate.change.eventType === row.eventType && candidate.change.channel === row.channel ? candidate : null;
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
            requestedBy: row.createdBy ?? (row as { requestedBy?: string }).requestedBy ?? 'unknown',
            requestedAt: row.createdAt,
            decidedBy: row.approvedBy,
            decidedAt: null,
            decisionComment: null,
            proposedSubject: change?.subject ?? null,
            proposedBody: change?.body ?? null,
            proposedEventEnabled: change?.channel === 'EVENT' ? change?.enabled : undefined,
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
        const receipt = await ApiClient.post<unknown>(
          `/internal/a2/workforce/approvals/${encodeURIComponent(requestId.trim())}/${decision}`,
          decision === 'reject'
            ? { comment: trimmed, ...(trimmed ? { reason: trimmed } : {}) }
            : { comment: trimmed },
        );
        validateWorkforceDecisionReceipt(receipt, requestId.trim(), decision);
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
          validateNotificationExecutionReceipt(executed, requestId.trim());
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
            message: `Approval recorded, but execution could not be confirmed: ${getErrorMessage(error, 'unknown error')}. Refresh the approval queue and registry before retrying.`,
          };
        }
      },
    });
  },

  /**
   * Execute an already-APPROVED notification change proposal idempotently (`F-01`).
   * Used when an approval was signed via Direct Workforce Approval, Privileged Approvals,
   * or when a prior execution attempt encountered a transient network failure.
   */
  async executeApprovedNotificationChange(
    approvalId: string,
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    const cleanId = approvalId.trim();
    return callTypedBoundary({
      owner: 'ARENA_1',
      method: 'POST',
      endpoint: `/internal/notifications/changes/${cleanId}/execute`,
      blockedExplanation:
        'BLOCKED on ARENA 1: Notification change execution endpoint (POST /internal/notifications/changes/:approvalId/execute) is not yet integrated.',
      run: async () => {
        const executed = await ApiClient.post<{ approvalId: string; type: string }>(
          `/internal/notifications/changes/${encodeURIComponent(cleanId)}/execute`,
          {},
          { idempotencyKey: `notif-change-execute:${cleanId}` },
        );
        validateNotificationExecutionReceipt(executed, cleanId);
        return {
          status: 'APPLIED',
          approvalId: cleanId,
          changeRequestId: cleanId,
          updatedAt: new Date().toISOString(),
          message: `Approved change ${executed.approvalId ?? cleanId}${executed.type ? ` (${executed.type})` : ''} executed — the frozen proposal is now applied.`,
        };
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
    const cleanId = approvalId.trim();
    const result = await ApiClient.post<unknown>(`/internal/a2/workforce/approvals/${encodeURIComponent(cleanId)}/${decision}`, {
      comment: trimmedComment,
      ...(decision === 'reject' && trimmedComment ? { reason: trimmedComment } : {}),
    });
    validateWorkforceDecisionReceipt(result, cleanId, decision);
    return result;
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
      const response = await ApiClient.get<unknown>(endpoint);
      const page = requireDiagnosticPage<NotificationDeliveryRecord>(response, filters.page ?? 1, filters.limit ?? 20, row =>
        !!row && nonEmptyDiagnosticString(row.id) && nonEmptyDiagnosticString(row.eventType) && nonEmptyDiagnosticString(row.eventKey) &&
        nonEmptyDiagnosticString(row.channel) && nonEmptyDiagnosticString(row.status) && nonEmptyDiagnosticString(row.recipientType) &&
        nonEmptyDiagnosticString(row.recipientId) && Number.isSafeInteger(row.attempts) && row.attempts >= 0 && validDiagnosticTime(row.createdAt) &&
        optionalStringFields(row, ['aggregateType', 'aggregateId', 'providerRef', 'correlationId', 'causationId', 'errorCode', 'updatedAt', 'sentAt', 'failedAt']) &&
        (!filters.status || row.status === filters.status.toUpperCase()) && (!filters.channel || row.channel === filters.channel.toUpperCase()) &&
        (!filters.recipientType || row.recipientType === filters.recipientType.toUpperCase()) &&
        (!filters.eventType || row.eventType === filters.eventType) &&
        (!filters.recipientId || row.recipientType === 'PHONE' || row.recipientId.toLowerCase() === filters.recipientId.toLowerCase()));
      return { status: 'LIVE', data: { ...page, data: page.data.map(row => projectDiagnosticFields(row, DELIVERY_FIELDS)) } };

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
   * the client returns a local BLOCKED/deferred state without issuing any request.
   */
  async requestManualDeliveryRetry(
    deliveryId: string,
    _reason: string,
    _idempotencyKey?: string,
  ): Promise<IntegrationResult<NotificationMutationOutcome>> {
    const endpoint = `/internal/notifications/deliveries/${encodeURIComponent(deliveryId)}/retry`;
    // V1 has no authorized retry route. Never probe a potentially side-effecting
    // endpoint: no network request was made, so zero is not an HTTP response.
    return { status: 'BLOCKED', owner: 'ARENA_3', method: 'POST', endpoint, httpStatus: 0,
      message: 'Manual retry is outside the approved read-only V1 scope. No request was made; a new requirement and authorization policy are needed.' };

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
   * LIVE TODAY — Notification outbox consumer receipt checkpoints (`AdminNotificationController.listOutboxReceipts`).
   * Surfaces QUARANTINED, FAILED, UNSUPPORTED, SUPPRESSED, and MATERIALIZED outbox receipts (`F-04`).
   */
  async listOutboxReceipts(
    filters: OutboxReceiptQueryFilters = {},
  ): Promise<IntegrationResult<NotificationOutboxReceiptPage>> {
    const query = new URLSearchParams({
      page: String(filters.page ?? 1),
      limit: String(filters.limit ?? 15),
    });
    if (filters.status) {
      query.set('status', filters.status);
    }
    const endpoint = `/internal/notifications/outbox-receipts?${query.toString()}`;
    return callTypedBoundary({
      owner: 'ARENA_3',
      method: 'GET',
      endpoint: '/internal/notifications/outbox-receipts',
      blockedExplanation:
        'BLOCKED on ARENA 3: Notification outbox receipts endpoint (GET /internal/notifications/outbox-receipts) is not yet integrated.',
      run: async () => {
        const response = await ApiClient.get<unknown>(endpoint);
        const page = requireDiagnosticPage<NotificationOutboxReceiptRecord>(response, filters.page ?? 1, filters.limit ?? 15, row =>
          !!row && nonEmptyDiagnosticString(row.outboxEventId) && nonEmptyDiagnosticString(row.status) &&
          Number.isSafeInteger(row.attempts) && row.attempts >= 0 && validDiagnosticTime(row.createdAt) && validDiagnosticTime(row.updatedAt) &&
          optionalStringFields(row, ['reason', 'nextAttemptAt']) &&
          (!filters.status || row.status === filters.status.toUpperCase()));
        return { ...page, data: page.data.map(row => projectDiagnosticFields(row, RECEIPT_FIELDS)) };
      },
    });
  },

  /**
   * LIVE TODAY — Audit trail lookup (`OperationsController.getAudit`).
   * Normalizes backend `actor` (`AuditService.searchAuditLogs`) alongside any legacy `actorId`.
   */
  async listAuditEvents(entityType: string, limit = 15): Promise<Array<Record<string, unknown>>> {
    const res = await ApiClient.get<unknown>(
      `/internal/audit?entityType=${encodeURIComponent(entityType)}&limit=${limit}`,
    );
    if (!Array.isArray(res) && !(res && typeof res === 'object' && (Array.isArray((res as any).items) || Array.isArray((res as any).data)))) throw new Error('Audit response could not be verified.');
    return extractArray<Record<string, unknown>>(res).map((row) => ({
      ...row,
      entityType: row.entityType ?? entityType,
      actor: row.actor ?? row.actorId ?? null,
    }));
  },

  /**
   * LIVE TODAY — Notification governance & test-send audit lookup (`F-02`).
   * Queries existing notification governance entity categories (`NOTIFICATION_TEMPLATE`,
   * `NOTIFICATION_CHANGE`, `NOTIFICATION_EVENT_CONFIGURATION`, `NOTIFICATION_TEST_SEND`).
   * Deliberately excludes `NOTIFICATION_PROVIDER_CONFIG`, which remains strictly restricted
   * to `SUPER_ADMIN` and `FINANCE_AUDITOR` via `/internal/notifications/provider-configs/audit`.
   */
  async listNotificationGovernanceAudit(
    limitPerCategory = 10,
  ): Promise<NotificationGovernanceAuditResult> {
    const categories = [
      'NOTIFICATION_TEMPLATE',
      'NOTIFICATION_CHANGE',
      'NOTIFICATION_EVENT_CONFIGURATION',
      'NOTIFICATION_TEST_SEND',
    ] as const;
    const batches = await Promise.allSettled(
      categories.map((category) => NotificationManagementApi.listAuditEvents(category, limitPerCategory)),
    );
    const failedCategories = categories.filter((_, index) => batches[index].status === 'rejected');
    const seen = new Set<string>();
    const merged: Array<Record<string, unknown>> = [];
    for (const row of batches.flatMap((batch) => batch.status === 'fulfilled' ? batch.value : [])) {
      const key = String(row.id ?? `${row.entityType}-${row.entityId}-${row.action}-${row.createdAt ?? row.occurredAt}`);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
    merged.sort((a, b) => {
      const ta = Date.parse(String(a.occurredAt ?? a.createdAt ?? '')) || 0;
      const tb = Date.parse(String(b.occurredAt ?? b.createdAt ?? '')) || 0;
      return tb - ta;
    });
    return { rows: merged.slice(0, limitPerCategory * 2), failedCategories };
  },

  // Customer preference endpoints (`/customers/:id/preferences*`) are restricted to authenticated
  // customers accessing their own records; workforce preference reads/mutations are not authorized.

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
        const record = res && typeof res === 'object' && !Array.isArray(res) ? res as Record<string, unknown> : null;
        const rows = Array.isArray(res) ? res : Array.isArray(record?.data) ? record.data : Array.isArray(record?.items) ? record.items : null;
        if (!rows || rows.some((value: unknown) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
          const row = value as Partial<ProviderConfigProposal>;
          return typeof row.id !== 'string' || !row.id.trim() || !['SMS', 'EMAIL'].includes(row.channel ?? '') ||
            !['REQUESTED', 'APPROVED', 'REJECTED', 'ACTIVATED'].includes(row.status ?? '') ||
            typeof row.proposerPrincipalId !== 'string' || !row.proposerPrincipalId.trim() ||
            typeof row.proposedProvider !== 'string' || !row.proposedProvider.trim() || typeof row.proposedEnabled !== 'boolean' ||
            !Number.isSafeInteger(row.expectedVersion) || (row.expectedVersion as number) < 0 ||
            typeof row.credentialAction !== 'string' || typeof row.reason !== 'string';
        })) throw new Error('Invalid provider proposals response.');
        return sanitizeProviderStatusForDisplay(rows as ProviderConfigProposal[]);
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
