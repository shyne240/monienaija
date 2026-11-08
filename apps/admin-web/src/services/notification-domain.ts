import type { WorkforcePrincipal } from '../store/auth-store';

export type ManagedNotificationChannel = 'SMS' | 'EMAIL';
export type NotificationConfigurationTarget = 'EVENT' | ManagedNotificationChannel;
export type RuntimeNotificationChannel = 'SMS' | 'EMAIL' | 'PUSH';
export type NotificationDeliveryClass = 'SECURITY' | 'TRANSACTIONAL' | 'INFORMATIONAL';
export type NotificationEventCategory =
  | 'SECURITY'
  | 'FUNDING'
  | 'TRANSFER'
  | 'SUPPORT'
  | 'CASH_TO_CASH'
  | 'AGENT_LIFECYCLE';
export type NotificationRecipientTarget =
  | 'CUSTOMER'
  | 'AGENT'
  | 'CUSTOMER_AND_AGENT'
  | 'BENEFICIARY_PHONE';
export type NotificationRuntimeTriggerState =
  | 'LIVE_OUTBOX'
  | 'DIRECT_PROVIDER_BYPASS'
  | 'UNWIRED_OUTBOX';

export interface ApprovedTemplateVariable {
  name: string;
  description: string;
  sampleValue: string;
  sourceSummary: string;
}

export interface NotificationEventCatalogueItem {
  eventType: string;
  category: NotificationEventCategory;
  description: string;
  deliveryClass: NotificationDeliveryClass;
  recipientTarget: NotificationRecipientTarget;
  runtimeTriggerState: NotificationRuntimeTriggerState;
  /** Governed event-wide master; absent for direct SECURITY and offline reference rows. */
  eventEnabled?: boolean;
  eventLocked?: boolean;
  eventConfigurationVersion?: number;
  smsEnabled?: boolean;
  smsLocked?: boolean;
  smsConfigurationVersion?: number;
  emailEnabled?: boolean;
  emailLocked?: boolean;
  emailConfigurationVersion?: number;
  toggleLocked: boolean;
  lockReason: string | null;
  templateEditable: boolean;
  securityNotes?: string | null;
  approvedVariables: ApprovedTemplateVariable[];
  activeSmsVersion: number | null;
  activeEmailVersion: number | null;
  pendingApprovalId?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export type TemplateApprovalStatus = 'ACTIVE' | 'PENDING_APPROVAL' | 'SUPERSEDED' | 'REJECTED';

export interface NotificationTemplateVersion {
  id: string;
  eventType: string;
  channel: ManagedNotificationChannel;
  locale: string;
  version: number;
  subject: string | null;
  body: string;
  variables: string[];
  isActive: boolean;
  approvalStatus: TemplateApprovalStatus;
  approvalId?: string | null;
  changeSummary?: string | null;
  createdBy: string | null;
  approvedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  sourceOrigin?: 'DATABASE' | 'CODE_BASELINE';
}

export interface NotificationChangeRequestRecord {
  id: string;
  approvalId: string | null;
  changeType: 'TEMPLATE_CREATE' | 'TEMPLATE_ACTIVATE' | 'EVENT_TRIGGER_CONFIG';
  eventType: string;
  channel: NotificationConfigurationTarget | 'MULTI';
  summary: string;
  status:
    | 'PENDING_APPROVAL'
    | 'APPROVED'
    | 'REJECTED'
    | 'APPLIED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'UNKNOWN';
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionComment?: string | null;
  proposedSubject?: string | null;
  proposedBody?: string | null;
  proposedEventEnabled?: boolean;
  proposedSmsEnabled?: boolean;
  proposedEmailEnabled?: boolean;
}

export type NotificationDeliveryStatus =
  | 'PENDING'
  | 'SENT'
  | 'FAILED'
  | 'DEAD'
  | 'UNKNOWN'
  | 'SKIPPED';

export type NotificationRecipientType = 'CUSTOMER' | 'AGENT' | 'PHONE';

export type NotificationOutboxReceiptStatus =
  | 'MATERIALIZED'
  | 'SUPPRESSED'
  | 'UNSUPPORTED'
  | 'QUARANTINED'
  | 'FAILED';

export interface NotificationOutboxReceiptRecord {
  outboxEventId: string;
  status: NotificationOutboxReceiptStatus | string;
  reason: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationOutboxReceiptPage {
  data: NotificationOutboxReceiptRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface NotificationProviderStatus {
  checkedAt: string;
  environment: string | null;
  projectionScope?: 'MINIMAL' | 'FULL';
  worker: {
    enabled: boolean | null;
    redacted?: boolean;
    batchSize: number | null;
    smsRetryMaxAttempts: number | null;
    smsRetryBaseDelaySeconds: number | null;
    pendingOutboxCount: number | null;
  };
  sms: {
    provider: string;
    operationalStatus: 'READY' | 'CONSOLE_ONLY' | 'MISCONFIGURED' | 'DEGRADED';
    lifecycleState?: ProviderLifecycleState;
    gates?: ProviderReadinessGates;
    senderId?: string | null;
    lastTest?: ProviderChannelSnapshot['lastTest'];
    baseUrl: string | null;
    /** Legacy name: reported provider configuration gate, not a key inspection. */
    apiKeyConfigured: boolean | null;
    apiKeyPrefixValid: boolean | null;
    apiKeyLast4Fingerprint: string | null;
    requestTimeoutMs: number | null;
    productionGuardSatisfied: boolean | null;
    senderIdentityMode: 'PROVIDER_WORKSPACE_ACCOUNT' | 'PER_MESSAGE_CONFIGURED';
    senderIdentitySummary: string;
    deliveryReceiptTracking: 'ACCEPTED_BY_PROVIDER_ONLY' | 'WEBHOOK_ENABLED' | 'POLLING_ENABLED';
  };
  email: {
    /** Legacy name: membership in the reported API channel list, not a database schema check. */
    channelEnabledInSchema: boolean;
    provider: string | null;
    operationalStatus: 'READY' | 'CONSOLE_ONLY' | 'NOT_CONFIGURED' | 'DEGRADED';
    lifecycleState?: ProviderLifecycleState;
    gates?: ProviderReadinessGates;
    lastTest?: ProviderChannelSnapshot['lastTest'];
    /** Legacy name: reported provider configuration gate, not a credential inspection. */
    credentialsConfigured: boolean | null;
    credentialFingerprint: string | null;
    fromAddress: string | null;
    fromName: string | null;
    domainVerificationStatus: 'VERIFIED' | 'UNVERIFIED' | 'CONFIGURED' | 'INCOMPLETE' | 'UNKNOWN' | 'NOT_APPLICABLE';
    honorsCustomerEmailPreference: boolean | null;
  };
}

export interface NotificationDeliveryRecord {
  id: string;
  eventType: string;
  eventKey: string;
  aggregateType: string | null;
  aggregateId: string | null;
  recipientType: NotificationRecipientType | string;
  recipientId: string;
  channel: string;
  status: NotificationDeliveryStatus | string;
  attempts: number;
  providerRef: string | null;
  correlationId: string | null;
  causationId: string | null;
  /**
   * SPRINT1-P0-02: the API no longer returns the rendered `message` or the raw provider
   * `lastError`. Failed/skipped rows carry only a fixed allowlisted operational code
   * (e.g. EVENT_DISABLED, SMS_OPT_OUT, PUSH_TOKEN_DEPENDENCY_MISSING) or 'UNCLASSIFIED';
   * null when no error/skip reason is stored.
   */
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  failedAt: string | null;
}

export interface NotificationDeliveryPage {
  data: NotificationDeliveryRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
}

export const NOTIFICATION_MODULE_SCOPES = [
  'notification.view_deliveries',
  'notification.view_events',
  'notification.view_templates',
  'notification.manage_templates',
  'notification.approve_templates',
  'notification.manage_configuration',
  'notification.approve_configuration',
  'notification.view_provider_status',
  'notification.provider.view',
  'notification.provider.configure',
  'notification.test_send',
] as const;

export interface NotificationPermissions {
  canAccessModule: boolean;
  canViewDeliveries: boolean;
  canViewCatalogue: boolean;
  canManageTemplates: boolean;
  canApproveTemplates: boolean;
  canManageConfiguration: boolean;
  canApproveConfiguration: boolean;
  canViewProviderStatus: boolean;
  canViewProviderConfig: boolean;
  canProposeProviderConfig: boolean;
  canApproveProviderConfig: boolean;
  canActivateProviderConfig: boolean;
  canTestSend: boolean;
  canUseWorkforceApprovalEndpoint: boolean;
  canViewOutbox: boolean;
  canViewDiagnostics: boolean;
  canViewAudit: boolean;
  hasMfaAssurance: boolean;
}

export function deriveNotificationPermissions(
  principal: WorkforcePrincipal | null | undefined,
): NotificationPermissions {
  const scopes = new Set(principal?.scopes ?? []);
  const roles = new Set(principal?.roles ?? []);
  const has = (code: string) => scopes.has(code);
  const canWrite = !principal?.readOnlyPrincipal;
  const isFinanceControllerChecker = roles.has('FINANCE_CONTROLLER') && has('privileged:approve');
  // INTERIM governance policy (Arena 1 registry, Phase 6 — pending product-owner
  // ratification of granular notification.* catalogue functions): the maker of template
  // and configuration change requests is SUPER_ADMIN holding notification.view_deliveries
  // with MFA assurance; the checker/executor is FINANCE_CONTROLLER + privileged:approve.
  // The server enforces this independently — the UI derivation only mirrors it.
  const isSuperAdminMaker = roles.has('SUPER_ADMIN') && has('notification.view_deliveries');
  const canAccessModule = NOTIFICATION_MODULE_SCOPES.some(has) || isFinanceControllerChecker;

  return {
    canAccessModule,
    canViewDeliveries: has('notification.view_deliveries'),
    canViewCatalogue:
      has('notification.view_events') ||
      has('notification.view_templates') ||
      has('notification.view_deliveries') ||
      has('notification.manage_templates') ||
      has('notification.approve_templates') ||
      has('notification.manage_configuration') ||
      has('notification.approve_configuration') ||
      isFinanceControllerChecker,
    canManageTemplates: canWrite && (has('notification.manage_templates') || isSuperAdminMaker),
    canApproveTemplates: canWrite && (has('notification.approve_templates') || isFinanceControllerChecker),
    canManageConfiguration: canWrite && (has('notification.manage_configuration') || isSuperAdminMaker),
    canApproveConfiguration: canWrite && (has('notification.approve_configuration') || isFinanceControllerChecker),
    canViewProviderStatus:
      has('notification.view_provider_status') ||
      has('notification.provider.view') ||
      has('notification.view_events') ||
      has('notification.view_deliveries') ||
      has('diagnostics.view'),
    canViewProviderConfig: has('notification.provider.view'),
    canProposeProviderConfig:
      canWrite && has('notification.provider.configure') && roles.has('SUPER_ADMIN'),
    canApproveProviderConfig:
      canWrite && has('notification.provider.configure') && roles.has('FINANCE_CONTROLLER'),
    canActivateProviderConfig:
      canWrite && has('notification.provider.configure') &&
      (roles.has('SUPER_ADMIN') || roles.has('FINANCE_CONTROLLER')),
    canTestSend: canWrite && has('notification.test_send'),
    canUseWorkforceApprovalEndpoint: canWrite && isFinanceControllerChecker,
    canViewOutbox: has('outbox.view'),
    canViewDiagnostics: has('diagnostics.view'),
    canViewAudit: has('audit.view') || has('audit.search'),
    hasMfaAssurance: principal?.assuranceLevel === 'MFA',
  };
}

export const SMS_BODY_MAX_LENGTH = 1000;
export const SMS_STANDARD_SEGMENT_LENGTH = 160;
export const EMAIL_SUBJECT_MAX_LENGTH = 200;
export const EMAIL_BODY_MAX_LENGTH = 4000;

export const SECURITY_LOCKED_EVENT_TYPES = new Set<string>([
  'customer.registration.phone_verification',
  'customer.credentials.temporary_credential',
  'agent.desk.customer_otp',
]);

const FORBIDDEN_VARIABLE_NAMES = new Set<string>([
  'otp',
  'pin',
  'password',
  'passcode',
  'secret',
  'token',
  'api_key',
  'apikey',
  'robase_api_key',
  'transfer_code',
  'transfercode',
  'ledger_account_id',
  'ledgeraccountid',
  'journal_id',
  'journalid',
  'raw_payload',
]);

const C2C_CREATED_FORBIDDEN_VARIABLE_NAMES = new Set<string>([
  'transfer_number',
  'transfernumber',
  'sender_phone',
  'senderphone',
  'transfer_code',
  'transfercode',
]);

const FORBIDDEN_LITERAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brobe_[0-9a-f]{8,}\b/i, label: 'Robase live API key literal (robe_...)' },
  { pattern: /\bjournal:[a-z0-9_-]+/i, label: 'Internal ledger journal identifier (journal:...)' },
  { pattern: /\bledger[_-]?account[_-]?id\b/i, label: 'Internal ledger account identifier' },
  { pattern: /\b(?:transaction\s+)?pin\s*[:=]/i, label: 'Credential/PIN disclosure assignment' },
  { pattern: /\botp\s*[:=]/i, label: 'OTP secret disclosure assignment' },
  { pattern: /\bpassword\s*[:=]/i, label: 'Password secret disclosure assignment' },
  { pattern: /\btransfer\s*code\s*[:=]/i, label: 'Cash-to-Cash secret transfer code assignment' },
];

export function isUuidString(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

/**
 * Extracts all `{{variable}}` tokens from a template string.
 * Captures whitespace/punctuation inside `{{...}}` so malformed or secret tokens cannot bypass checks.
 */
export function extractTemplateVariables(templateText: string): string[] {
  if (!templateText) return [];
  const matches = templateText.matchAll(/\{\{([^{}]*)\}\}/g);
  const orderedUnique: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const token = (match[1] ?? '').trim();
    if (!seen.has(token)) {
      seen.add(token);
      orderedUnique.push(token);
    }
  }
  return orderedUnique;
}

export function estimateSmsSegments(body: string): number {
  const length = body.length;
  if (length === 0) return 0;
  // Non-GSM characters use UCS-2 70/67 character segments; standard GSM-7 uses 160/153.
  // eslint-disable-next-line no-control-regex
  const isAsciiGsmApprox = /^[\x00-\x7F£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ€]+$/.test(body);
  if (isAsciiGsmApprox) {
    return length <= SMS_STANDARD_SEGMENT_LENGTH ? 1 : Math.ceil(length / 153);
  }
  return length <= 70 ? 1 : Math.ceil(length / 67);
}

export interface TemplateDraftValidationInput {
  event: NotificationEventCatalogueItem | null;
  channel: ManagedNotificationChannel;
  subject: string;
  body: string;
  changeSummary: string;
}

export function validateTemplateDraft(input: TemplateDraftValidationInput): string[] {
  const errors: string[] = [];
  const { event, channel, subject, body, changeSummary } = input;

  if (!event) {
    errors.push('Select a notification event from the catalogue.');
    return errors;
  }

  if (
    event.deliveryClass === 'SECURITY' ||
    SECURITY_LOCKED_EVENT_TYPES.has(event.eventType) ||
    !event.templateEditable
  ) {
    errors.push(
      `Event "${event.eventType}" is a mandatory SECURITY direct-send flow. Templates for OTP and credential events are fixed in code so secrets can never be persisted.`,
    );
    return errors;
  }

  const trimmedBody = body.trim();
  const trimmedSubject = subject.trim();
  const trimmedSummary = changeSummary.trim();

  if (channel === 'SMS') {
    if (trimmedSubject.length > 0) {
      errors.push('SMS templates cannot define an email subject line.');
    }
    if (!trimmedBody) {
      errors.push('SMS template body is required.');
    } else if (body.length > SMS_BODY_MAX_LENGTH) {
      errors.push(`SMS template body must not exceed ${SMS_BODY_MAX_LENGTH} characters (currently ${body.length}).`);
    }
  } else {
    if (!trimmedSubject) {
      errors.push('Email subject is required for EMAIL templates.');
    } else if (subject.length > EMAIL_SUBJECT_MAX_LENGTH) {
      errors.push(
        `Email subject must not exceed ${EMAIL_SUBJECT_MAX_LENGTH} characters (currently ${subject.length}).`,
      );
    }
    if (!trimmedBody) {
      errors.push('Email template body is required.');
    } else if (body.length > EMAIL_BODY_MAX_LENGTH) {
      errors.push(
        `Email template body must not exceed ${EMAIL_BODY_MAX_LENGTH} characters (currently ${body.length}).`,
      );
    }
  }

  // Unbalanced mustache braces check
  const combined = channel === 'EMAIL' ? `${subject}\n${body}` : body;
  const openCount = (combined.match(/\{\{/g) ?? []).length;
  const closeCount = (combined.match(/\}\}/g) ?? []).length;
  if (openCount !== closeCount) {
    errors.push('Template contains unbalanced "{{" or "}}" variable delimiters.');
  }

  const allowedNames = new Set(event.approvedVariables.map((item) => item.name));
  const usedTokens = extractTemplateVariables(combined);

  for (const token of usedTokens) {
    if (!token) {
      errors.push('Empty "{{}}" variable placeholder is not permitted.');
      continue;
    }
    const normalized = token.toLowerCase().replace(/[\s-]+/g, '_');
    if (FORBIDDEN_VARIABLE_NAMES.has(normalized)) {
      errors.push(
        `Variable "{{${token}}}" is forbidden: secret codes, OTPs, PINs, passwords, credentials, and internal ledger IDs can never be template variables.`,
      );
      continue;
    }
    if (
      event.eventType === 'cash_to_cash.created' &&
      C2C_CREATED_FORBIDDEN_VARIABLE_NAMES.has(normalized)
    ) {
      errors.push(
        `Variable "{{${token}}}" violates the Cash-to-Cash beneficiary SMS non-disclosure rule: transfer number, sender phone, and secret transfer code must never appear in beneficiary notifications.`,
      );
      continue;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(token)) {
      errors.push(`Variable "{{${token}}}" must use lowercase snake_case variable syntax.`);
      continue;
    }
    if (!allowedNames.has(token)) {
      errors.push(
        `Variable "{{${token}}}" is not in the approved variable whitelist for "${event.eventType}" (${
          allowedNames.size > 0
            ? Array.from(allowedNames)
                .map((v) => `{{${v}}}`)
                .join(', ')
            : 'no variables registered'
        }).`,
      );
    }
  }

  for (const rule of FORBIDDEN_LITERAL_PATTERNS) {
    if (rule.pattern.test(combined)) {
      errors.push(`Template content contains prohibited sensitive pattern: ${rule.label}.`);
    }
  }

  if (trimmedSummary.length < 10) {
    errors.push('Change summary / audit reason must be at least 10 characters.');
  } else if (trimmedSummary.length > 500) {
    errors.push('Change summary / audit reason must not exceed 500 characters.');
  }

  return errors;
}

export interface SafePreviewResult {
  renderedSubject: string | null;
  renderedBody: string;
  characterCount: number;
  estimatedSmsSegments: number | null;
  resolvedVariables: Record<string, string>;
  warnings: string[];
}

/**
 * Deterministic safe whitelist template renderer matching Audit §4.1:
 * substitutes ONLY approved variables for the event using redacted/safe sample values.
 * Unknown or missing variables render empty and emit an explicit warning — never raw tokens or secrets.
 */
export function renderSafeTemplatePreview(
  event: NotificationEventCatalogueItem,
  channel: ManagedNotificationChannel,
  subject: string | null,
  body: string,
  sampleOverrides: Record<string, string> = {},
): SafePreviewResult {
  const warnings: string[] = [];
  const approvedMap = new Map<string, string>();
  for (const variable of event.approvedVariables) {
    const candidate = sampleOverrides[variable.name] ?? variable.sampleValue;
    approvedMap.set(variable.name, scrubSampleValue(candidate));
  }

  const resolvedVariables: Record<string, string> = {};
  const substitute = (source: string): string =>
    source.replace(/\{\{([^{}]*)\}\}/g, (_full, rawName: string) => {
      const name = rawName.trim();
      if (!approvedMap.has(name)) {
        warnings.push(`Unapproved or unknown variable "{{${name}}}" was omitted during safe rendering.`);
        return '';
      }
      const value = approvedMap.get(name) ?? '';
      if (!value) {
        warnings.push(`Approved variable "{{${name}}}" has an empty sample value.`);
      }
      resolvedVariables[name] = value;
      return value;
    });

  const renderedSubject = channel === 'EMAIL' ? substitute(subject ?? '') : null;
  const renderedBody = substitute(body);

  return {
    renderedSubject,
    renderedBody,
    characterCount: renderedBody.length,
    estimatedSmsSegments: channel === 'SMS' ? estimateSmsSegments(renderedBody) : null,
    resolvedVariables,
    warnings,
  };
}

function scrubSampleValue(value: string): string {
  const trimmed = value.slice(0, 200);
  if (/\brobe_[0-9a-f]{4,}\b/i.test(trimmed)) {
    return '[REDACTED_CREDENTIAL]';
  }
  return trimmed;
}

export interface NotificationConfigurationSnapshot {
  enabled: boolean;
  locked: boolean;
  version: number;
}

/** A target is editable only when the live registry supplied its complete versioned state. */
export function getNotificationConfigurationSnapshot(
  event: NotificationEventCatalogueItem,
  target: NotificationConfigurationTarget,
): NotificationConfigurationSnapshot | null {
  const enabled =
    target === 'EVENT' ? event.eventEnabled : target === 'SMS' ? event.smsEnabled : event.emailEnabled;
  const locked =
    target === 'EVENT' ? event.eventLocked : target === 'SMS' ? event.smsLocked : event.emailLocked;
  const version =
    target === 'EVENT'
      ? event.eventConfigurationVersion
      : target === 'SMS'
        ? event.smsConfigurationVersion
        : event.emailConfigurationVersion;
  if (
    typeof enabled !== 'boolean' ||
    typeof locked !== 'boolean' ||
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return null;
  }
  return { enabled, locked, version };
}

/** Configuration gates only; actual delivery also depends on recipients and providers. */
export function effectiveConfiguredChannels(event: NotificationEventCatalogueItem): string {
  if (event.deliveryClass === 'SECURITY') return 'Managed separately';
  if (typeof event.eventEnabled !== 'boolean') return 'Unavailable';
  if (!event.eventEnabled) return 'Event disabled';
  if (typeof event.smsEnabled !== 'boolean' || typeof event.emailEnabled !== 'boolean') {
    return 'Unavailable';
  }
  if (event.smsEnabled && event.emailEnabled) return 'SMS and Email';
  if (event.smsEnabled) return 'SMS only';
  if (event.emailEnabled) return 'Email only';
  return 'Neither channel';
}

export interface TriggerConfigValidationInput {
  event: NotificationEventCatalogueItem | null;
  eventEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  reason: string;
}

export function validateTriggerConfigurationChange(input: TriggerConfigValidationInput): string[] {
  const errors: string[] = [];
  const { event, eventEnabled, smsEnabled, emailEnabled, reason } = input;

  if (!event) {
    errors.push('Select a notification event to configure.');
    return errors;
  }

  if (
    event.deliveryClass === 'SECURITY' ||
    SECURITY_LOCKED_EVENT_TYPES.has(event.eventType) ||
    event.toggleLocked
  ) {
    errors.push(
      event.lockReason ||
        `Event "${event.eventType}" is trigger-locked by security/governance policy and cannot be toggled.`,
    );
    return errors;
  }

  const targets: Array<{ target: NotificationConfigurationTarget; current?: boolean; desired: boolean }> = [
    { target: 'EVENT', current: event.eventEnabled, desired: eventEnabled },
    { target: 'SMS', current: event.smsEnabled, desired: smsEnabled },
    { target: 'EMAIL', current: event.emailEnabled, desired: emailEnabled },
  ];
  const changed = targets.filter(
    ({ current, desired }) => typeof current === 'boolean' && current !== desired,
  );
  if (changed.length === 0) {
    errors.push('Modify at least one Event, SMS or Email control before submitting a change.');
  }
  for (const { target } of changed) {
    const snapshot = getNotificationConfigurationSnapshot(event, target);
    if (!snapshot) {
      errors.push(`${target} configuration or version is unavailable; refresh the registry.`);
    } else if (snapshot.locked) {
      errors.push(`${target} configuration is locked and cannot be changed.`);
    }
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 10) {
    errors.push('Operational audit reason must be at least 10 characters.');
  } else if (trimmedReason.length > 500) {
    errors.push('Operational audit reason must not exceed 500 characters.');
  }

  return errors;
}

export function normalizeWorkforceSmsDestination(raw: string): string | null {
  const compact = raw.trim().replace(/[\s()-]/g, '');
  if (/^\+[1-9][0-9]{7,14}$/.test(compact)) {
    return compact;
  }
  if (/^0[789][01][0-9]{8}$/.test(compact)) {
    return `+234${compact.slice(1)}`;
  }
  if (/^[789][01][0-9]{8}$/.test(compact)) {
    return `+234${compact}`;
  }
  return null;
}

export function isValidEmailAddress(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export interface TestSendValidationInput {
  channel: ManagedNotificationChannel;
  destination: string;
  workforceDestinationConfirmed: boolean;
}

export function validateTestSendRequest(input: TestSendValidationInput): {
  errors: string[];
  normalizedDestination: string | null;
} {
  const errors: string[] = [];
  let normalizedDestination: string | null = null;

  if (input.channel === 'SMS') {
    normalizedDestination = normalizeWorkforceSmsDestination(input.destination);
    if (!normalizedDestination) {
      errors.push('Enter a valid E.164 or Nigerian mobile number (e.g. +2348030000100 or 08030000100).');
    }
  } else {
    if (!isValidEmailAddress(input.destination)) {
      errors.push('Enter a valid workforce email address (e.g. ops.tester@monienaija.internal).');
    } else {
      normalizedDestination = input.destination.trim().toLowerCase();
    }
  }

  if (!input.workforceDestinationConfirmed) {
    errors.push(
      'Confirm that the destination belongs to an authorized workforce operator and never a customer.',
    );
  }

  return { errors, normalizedDestination };
}

const SAFE_CREDENTIAL_METADATA_KEYS = new Set([
  'apiKeyConfigured',
  'apiKeyPrefixValid',
  'apiKeyLast4Fingerprint',
  'credentialsConfigured',
  'credentialFingerprint',
  'idempotencyRetentionSeconds',
  'keyFingerprint',
  'proposedKeyFingerprint',
  'encryptionKeyVersion',
  'proposedEncryptionKeyVersion',
  'encryptionKeyAvailable',
  'credentialSource',
  'credentialAction',
  'hasStoredCredential',
]);

const SECRET_KEY_PATTERN =
  /(api[_-]?key|encrypted[_-]?api[_-]?key|secret|password|private[_-]?key|bearer|smtp[_-]?pass|auth[_-]?token)/i;

const RAW_SECRET_VALUE_PATTERN =
  /\b(robe_[0-9a-zA-Z_-]{4,}|xkeysib-[0-9a-zA-Z_-]{4,}|xsmtpsib-[0-9a-zA-Z_-]{4,}|re_[0-9a-zA-Z_-]{8,}|MNNPS1:[A-Za-z0-9._-]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+)/g;

/**
 * Defensive secret sanitizer for provider configuration/status payloads (Audit Finding F-S5).
 * Strips any unexpected credential/key property and masks any string matching provider key
 * prefixes (`robe_`, `xkeysib-`, `xsmtpsib-`, `re_`) or `MNNPS1:` encrypted envelopes.
 */
export function sanitizeProviderStatusForDisplay<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input.replace(RAW_SECRET_VALUE_PATTERN, '[REDACTED_KEY]') as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeProviderStatusForDisplay(item)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (!SAFE_CREDENTIAL_METADATA_KEYS.has(key) && SECRET_KEY_PATTERN.test(key)) {
        continue;
      }
      if (
        (key === 'apiKeyLast4Fingerprint' || key === 'credentialFingerprint') &&
        typeof value === 'string' &&
        value.length > 8
      ) {
        out[key] = value.slice(-4);
        continue;
      }
      if (
        (key === 'keyFingerprint' || key === 'proposedKeyFingerprint') &&
        typeof value === 'string' &&
        value.length > 8
      ) {
        out[key] = `****${value.slice(-4)}`;
        continue;
      }
      out[key] = sanitizeProviderStatusForDisplay(value);
    }
    return out as T;
  }
  return input;
}

export type ManagedProviderChannel = 'SMS' | 'EMAIL';
export type ProviderLifecycleState =
  | 'NOT_CONFIGURED'
  | 'CONSOLE_ONLY'
  | 'MISCONFIGURED'
  | 'CONFIGURED'
  | 'VERIFIED'
  | 'ENABLED'
  | 'DELIVERY_TESTED'
  | 'PRODUCTION_READY';

export interface ProviderReadinessGates {
  configured: boolean;
  verified: boolean;
  enabled: boolean;
  deliveryTested: boolean;
  productionReady: boolean;
}

export interface ProviderChannelSnapshot {
  channel: ManagedProviderChannel;
  source: 'DATABASE' | 'ENVIRONMENT';
  provider: string;
  enabled: boolean;
  lifecycleState: ProviderLifecycleState;
  gates: ProviderReadinessGates;
  baseUrl: string | null;
  requestTimeoutMs: number;
  senderId: string | null;
  senderIdNote: string | null;
  fromEmail: string | null;
  fromName: string | null;
  replyToEmail: string | null;
  credentialSource: 'NONE' | 'ENCRYPTED_DB' | 'ENV_SECRET';
  hasStoredCredential: boolean;
  keyFingerprint: string | null;
  encryptionKeyVersion: string | null;
  encryptionKeyAvailable: boolean;
  misconfigurationCode: string | null;
  domainAuthentication: {
    spfConfigured: boolean;
    dkimConfigured: boolean;
    dmarcConfigured: boolean;
    allConfigured: boolean;
  } | null;
  verification: {
    verifiedAt: string | null;
    verifiedBy: string | null;
    verificationMethod: string | null;
    lastVerificationError: string | null;
  };
  lastTest: {
    status: 'SENT' | 'FAILED' | 'CONSOLE_SIMULATED' | null;
    destinationMasked: string | null;
    providerRef: string | null;
    errorCode: string | null;
    testedAt: string | null;
    deliveryTestedAt: string | null;
    deliveryTestedBy: string | null;
  };
  version: number;
  updatedBy: string | null;
  approvedBy: string | null;
  updatedAt: string | null;
}

export interface ProviderConfigurationOverview {
  sms: ProviderChannelSnapshot;
  email: ProviderChannelSnapshot;
  encryption: {
    available: boolean;
    mode: 'KEYRING_JSON' | 'SINGLE_KEY' | 'MISSING_KEY' | 'INVALID_KEY';
    activeKeyVersion: string | null;
    keyVersions: string[];
  };
  worker: {
    enabled: boolean;
    pollIntervalMs: number;
    batchSize: number;
    smsRetryMaxAttempts: number;
    smsRetryBaseDelaySeconds: number;
  };
  contracts: {
    robase: {
      verifiedEndpoint: string;
      senderIdBehaviour: string;
      verificationBehaviour: string;
    };
    brevo: {
      verifiedEndpoint: string;
      verifyEndpoints: string[];
      domainAuthRequirements: string[];
    };
  };
}

export type ProviderCredentialAction =
  | 'KEEP_EXISTING'
  | 'SET_ENCRYPTED'
  | 'USE_ENV_SECRET'
  | 'CLEAR';

export interface ProviderConfigProposal {
  id: string;
  channel: ManagedProviderChannel;
  expectedVersion: number;
  proposedProvider: string;
  proposedEnabled: boolean;
  proposedBaseUrl: string | null;
  proposedRequestTimeoutMs: number;
  proposedSenderId: string | null;
  proposedFromEmail: string | null;
  proposedFromName: string | null;
  proposedReplyToEmail: string | null;
  credentialAction: ProviderCredentialAction;
  proposedKeyFingerprint: string | null;
  proposedEncryptionKeyVersion: string | null;
  proposedDomainAuthentication: {
    spfConfigured: boolean;
    dkimConfigured: boolean;
    dmarcConfigured: boolean;
  };
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'ACTIVATED';
  proposerPrincipalId: string;
  approvalId: string;
  actionFingerprint: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  activatedBy: string | null;
  activatedAt: string | null;
  resultingVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProposeProviderConfigPayload {
  channel: ManagedProviderChannel;
  expectedVersion: number;
  provider: string;
  enabled: boolean;
  baseUrl?: string | null;
  requestTimeoutMs?: number;
  senderId?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  replyToEmail?: string | null;
  credentialAction: ProviderCredentialAction;
  apiKey?: string;
  spfConfigured?: boolean;
  dkimConfigured?: boolean;
  dmarcConfigured?: boolean;
  reason: string;
}

export function validateProviderConfigProposalDraft(
  draft: ProposeProviderConfigPayload,
  hasExistingStoredCredential: boolean,
): string[] {
  const errors: string[] = [];
  const provider = draft.provider.trim();
  const isExternal = provider === 'robase' || provider === 'brevo' || provider === 'resend';

  if (draft.channel === 'SMS' && provider !== 'console' && provider !== 'robase') {
    errors.push('SMS provider must be "robase" or "console".');
  }
  if (
    draft.channel === 'EMAIL' &&
    provider !== 'none' &&
    provider !== 'console' &&
    provider !== 'brevo' &&
    provider !== 'resend'
  ) {
    errors.push('Email provider must be "brevo", "resend", "none", or "console".');
  }
  if (provider === 'none' && draft.enabled) {
    errors.push('Provider "none" cannot be enabled.');
  }

  if (isExternal) {
    const rawUrl = (draft.baseUrl ?? '').trim().replace(/\/+$/, '');
    const pinnedOrigin =
      provider === 'robase'
        ? 'https://api.robase.dev'
        : provider === 'brevo'
          ? 'https://api.brevo.com'
          : 'https://api.resend.com';
    if (!rawUrl || !rawUrl.startsWith('https://')) {
      errors.push('External provider Base URL must begin with https://.');
    } else if (rawUrl.toLowerCase() !== pinnedOrigin) {
      errors.push(
        `Untrusted Base URL for ${provider}: must match pinned vendor origin ${pinnedOrigin}.`,
      );
    }
  }

  if (draft.channel === 'SMS' && draft.senderId && draft.senderId.trim().length > 0) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}[A-Za-z0-9]$/.test(draft.senderId.trim())) {
      errors.push('SMS Sender ID must be 3 to 11 alphanumeric characters.');
    }
  }

  if (draft.channel === 'EMAIL' && (provider === 'brevo' || provider === 'resend')) {
    const fromEmail = (draft.fromEmail ?? '').trim();
    if (!fromEmail || !/^[^@\s,;"'<>()\\]+@[^@\s,;"'<>()\\]+\.[^@\s,;"'<>()\\]{2,63}$/.test(fromEmail)) {
      errors.push('Enter a valid verified sender email address (e.g. notifications@monienaija.ng).');
    }
    if (draft.replyToEmail && draft.replyToEmail.trim().length > 0) {
      if (!/^[^@\s,;"'<>()\\]+@[^@\s,;"'<>()\\]+\.[^@\s,;"'<>()\\]{2,63}$/.test(draft.replyToEmail.trim())) {
        errors.push('Reply-To address must be a valid email address when specified.');
      }
    }
  }

  if (draft.channel === 'EMAIL' && provider === 'brevo') {
    for (const field of ['spfConfigured', 'dkimConfigured', 'dmarcConfigured'] as const) {
      if (typeof draft[field] !== 'boolean') {
        errors.push(
          `Brevo configuration proposals must explicitly specify ${field} as a boolean (true or false).`,
        );
      }
    }
  }

  if (draft.credentialAction === 'SET_ENCRYPTED') {
    if (!isExternal) {
      errors.push('Encrypted API keys can only be configured for external providers (Robase, Brevo, Resend).');
    } else {
      const key = (draft.apiKey ?? '').trim();
      if (!key) {
        errors.push('Enter the provider API key to encrypt at rest.');
      } else if (/\s/.test(key)) {
        errors.push('API key must not contain spaces or line breaks.');
      } else if (provider === 'robase' && !/^robe_[A-Za-z0-9_-]{15,500}$/.test(key)) {
        errors.push('Robase API key must use the verified live key format (robe_ prefix, 20+ characters).');
      } else if (provider === 'brevo') {
        if (key.startsWith('xsmtpsib-')) {
          errors.push(
            'SMTP relay keys (xsmtpsib- prefix) are not valid for the Brevo v3 HTTP API. Enter a Brevo v3 REST API key (xkeysib- prefix).',
          );
        } else if (!/^xkeysib-[A-Za-z0-9_-]{15,500}$/.test(key)) {
          errors.push('Brevo API key must use the v3 REST API key format (xkeysib- prefix, 23+ characters).');
        }
      } else if (provider === 'resend' && !/^re_[A-Za-z0-9_-]{12,500}$/.test(key)) {
        errors.push('Resend API key must use the live key format (re_ prefix).');
      }
    }
  } else if (draft.credentialAction === 'KEEP_EXISTING' && isExternal && !hasExistingStoredCredential) {
    errors.push('No stored credential exists yet for this channel; select "Set / Rotate Encrypted API Key" or "Use Server Environment Secret".');
  } else if (draft.credentialAction === 'CLEAR' && isExternal && draft.enabled) {
    errors.push('Cannot clear credentials while the external provider is enabled.');
  }

  const timeout = draft.requestTimeoutMs ?? 10000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 60000) {
    errors.push('Request timeout must be an integer between 1,000 ms and 60,000 ms.');
  }

  const trimmedReason = draft.reason.trim();
  if (trimmedReason.length < 10) {
    errors.push('Governance audit reason must be at least 10 characters.');
  } else if (trimmedReason.length > 500) {
    errors.push('Governance audit reason must not exceed 500 characters.');
  }

  return errors;
}

const AMOUNT_CLAUSE_VAR: ApprovedTemplateVariable = {
  name: 'amount_clause',
  description: 'Formatted NGN amount clause derived safely from committed minor units',
  sampleValue: ' of NGN 1250.00',
  sourceSummary: 'formatNgn(redactedPayload.amountMinor)',
};

const AMOUNT_VAR: ApprovedTemplateVariable = {
  name: 'amount',
  description: 'Formatted NGN major-unit amount derived safely from committed minor units',
  sampleValue: 'NGN 25,000.00',
  sourceSummary: 'formatNgn(redactedPayload.amountMinor)',
};

const REFERENCE_VAR: ApprovedTemplateVariable = {
  name: 'reference',
  description: 'Validated public transaction or ticket reference (never internal ledger/journal ID)',
  sampleValue: 'SAMPLE-1',
  sourceSummary: 'redactedPayload.reference (validated public shape)',
};

const STATUS_VAR: ApprovedTemplateVariable = {
  name: 'status',
  description: 'Customer-visible support ticket lifecycle status (allowlisted enum value)',
  sampleValue: 'IN_PROGRESS',
  sourceSummary: 'redactedPayload.status (allowlisted)',
};

const SENDER_NAME_VAR: ApprovedTemplateVariable = {
  name: 'sender_name',
  description: 'Approved non-secret sender display label (Decision D-N1; never raw senderPhone)',
  sampleValue: 'A MonieNaija sender',
  sourceSummary: 'redactedPayload.senderDisplayName (verified name only)',
};

const LOCATOR_CLAUSE_VAR: ApprovedTemplateVariable = {
  name: 'locator_clause',
  description: 'Optional HTTPS-validated public Cash-to-Cash Agent outlet locator clause (Decision D-N5)',
  sampleValue: ' Find an active outlet: https://monienaija.example/agents',
  sourceSummary: 'redactedPayload.locatorUrl (CASH_TO_CASH_LOCATOR_URL, https-validated)',
};

/**
 * Offline read-only reference snapshot reconciled 1:1 with `NOTIFICATION_DEFAULTS_V1` +
 * `NOTIFICATION_SECURITY_DEFAULTS_V1` (`src/notification/notification-defaults-v1.ts`).
 * Never contains unimplemented or non-existent events; labeled as an offline reference
 * whenever `GET /internal/notifications/events` is unreachable (404/501).
 */
export const BASELINE_CODE_EVENT_CATALOGUE: NotificationEventCatalogueItem[] = [
  // Mandatory Security Direct-Send Flows (Audit §1.1 & F-S6 — permanently locked & non-editable)
  {
    eventType: 'customer.registration.phone_verification',
    category: 'SECURITY',
    description: 'Customer onboarding registration phone verification OTP (direct provider path; bypasses outbox).',
    deliveryClass: 'SECURITY',
    recipientTarget: 'CUSTOMER',
    runtimeTriggerState: 'DIRECT_PROVIDER_BYPASS',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: true,
    lockReason: 'Mandatory SECURITY direct-send OTP: bypasses outbox and customer opt-out; cannot be disabled or edited.',
    templateEditable: false,
    securityNotes: 'Rendered OTP is never persisted in outbox_events or notification_deliveries.',
    approvedVariables: [],
    activeSmsVersion: null,
    activeEmailVersion: null,
  },
  {
    eventType: 'customer.credentials.temporary_credential',
    category: 'SECURITY',
    description: 'Workforce-issued temporary customer login credential SMS (direct provider path; bypasses outbox).',
    deliveryClass: 'SECURITY',
    recipientTarget: 'CUSTOMER',
    runtimeTriggerState: 'DIRECT_PROVIDER_BYPASS',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: true,
    lockReason: 'Mandatory SECURITY direct-send credential: fixed code template; never persisted or toggleable.',
    templateEditable: false,
    securityNotes: 'Temporary credentials must never become configurable template variables.',
    approvedVariables: [],
    activeSmsVersion: null,
    activeEmailVersion: null,
  },
  {
    eventType: 'agent.desk.customer_otp',
    category: 'SECURITY',
    description: 'Customer authorization OTP for Agent-desk Wallet→Cash and Cash→Cash claims (sent to customer phone only).',
    deliveryClass: 'SECURITY',
    recipientTarget: 'CUSTOMER',
    runtimeTriggerState: 'DIRECT_PROVIDER_BYPASS',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: true,
    lockReason: 'Mandatory SECURITY MFA challenge: fixed code template; never persisted or toggleable.',
    templateEditable: false,
    securityNotes: 'Delivered strictly to the customer verified primary phone, never the Agent.',
    approvedVariables: [],
    activeSmsVersion: null,
    activeEmailVersion: null,
  },

  // Customer Funding Events
  {
    eventType: 'customer.funding.approved',
    category: 'FUNDING',
    description: 'Customer wallet funding request approved and credited.',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR, AMOUNT_CLAUSE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'customer.funding.rejected',
    category: 'FUNDING',
    description: 'Customer wallet funding request rejected during review.',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR, AMOUNT_CLAUSE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'customer.funding.requested',
    category: 'FUNDING',
    description: 'Acknowledgement when a customer wallet funding request is submitted for review.',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'CUSTOMER',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR, AMOUNT_CLAUSE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },

  // Transfer Events
  {
    eventType: 'transfer.completed',
    category: 'TRANSFER',
    description: 'Wallet-to-wallet transfer completed (dispatched to source and destination customers).',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR, AMOUNT_CLAUSE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'transfer.failed',
    category: 'TRANSFER',
    description: 'Wallet transfer failed notification to initiating customer.',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR, AMOUNT_CLAUSE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },

  // Support Ticket Events
  {
    eventType: 'support.ticket.created',
    category: 'SUPPORT',
    description: 'Support ticket creation confirmation for bound customer/agent.',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER_AND_AGENT',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'support.ticket.assigned',
    category: 'SUPPORT',
    description: 'Support ticket assigned to workforce operator.',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER_AND_AGENT',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'support.ticket.status_changed',
    category: 'SUPPORT',
    description: 'Support ticket status transition notification.',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER_AND_AGENT',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR, STATUS_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'support.ticket.resolved',
    category: 'SUPPORT',
    description: 'Support ticket resolved notification.',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER_AND_AGENT',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'support.ticket.closed',
    category: 'SUPPORT',
    description: 'Support ticket closed notification.',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER_AND_AGENT',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'support.ticket.message_added',
    category: 'SUPPORT',
    description: 'Customer-visible reply added to support ticket (internal notes strictly filtered out).',
    deliveryClass: 'TRANSACTIONAL',
    recipientTarget: 'CUSTOMER_AND_AGENT',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    securityNotes: 'Internal workforce notes (isInternal=true) never generate notification intents.',
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },

  // Cash-to-Cash Events (Audit §4.7 & F-S2)
  {
    eventType: 'cash_to_cash.created',
    category: 'CASH_TO_CASH',
    description:
      'Beneficiary SMS on Cash-to-Cash initiation (outbox-wired at initiation; registry SMS configuration enabled, EMAIL disabled).',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'BENEFICIARY_PHONE',
    runtimeTriggerState: 'LIVE_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    securityNotes:
      'Audit Finding F-S2 (unified with the Arena 4 registry contract): Must NEVER disclose the transfer number, senderPhone, or secret transferCode. The registry allowlist for this event is {{sender_name}}, {{amount}}, and {{locator_clause}} (https-validated public locator only).',
    approvedVariables: [SENDER_NAME_VAR, AMOUNT_VAR, LOCATOR_CLAUSE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'cash_to_cash.claimed',
    category: 'CASH_TO_CASH',
    description: 'Cash-to-Cash redemption completion notification (no backend trigger wired yet).',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'CUSTOMER_AND_AGENT',
    runtimeTriggerState: 'UNWIRED_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR, AMOUNT_CLAUSE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'cash_to_cash.expired',
    category: 'CASH_TO_CASH',
    description:
      'Cash-to-Cash transfer expiry notification for unclaimed transfers (no backend trigger wired yet).',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'CUSTOMER_AND_AGENT',
    runtimeTriggerState: 'UNWIRED_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR, AMOUNT_CLAUSE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },

  // Agent Lifecycle Events (Audit F-M8: Agent phone model pending D-N6)
  {
    eventType: 'agent.application.approved',
    category: 'AGENT_LIFECYCLE',
    description: 'Ordinary Agent onboarding application approved (pending Agent phone contact model D-N6).',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'AGENT',
    runtimeTriggerState: 'UNWIRED_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'agent.application.rejected',
    category: 'AGENT_LIFECYCLE',
    description: 'Ordinary Agent onboarding application rejected (pending Agent phone contact model D-N6).',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'AGENT',
    runtimeTriggerState: 'UNWIRED_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'agent.activated',
    category: 'AGENT_LIFECYCLE',
    description: 'Agent lifecycle status activated (pending Agent phone contact model D-N6).',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'AGENT',
    runtimeTriggerState: 'UNWIRED_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'agent.suspended',
    category: 'AGENT_LIFECYCLE',
    description: 'Agent lifecycle status suspended (pending Agent phone contact model D-N6).',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'AGENT',
    runtimeTriggerState: 'UNWIRED_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'agent.terminated',
    category: 'AGENT_LIFECYCLE',
    description: 'Agent lifecycle status terminated (pending Agent phone contact model D-N6).',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'AGENT',
    runtimeTriggerState: 'UNWIRED_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
  {
    eventType: 'agent.reactivated',
    category: 'AGENT_LIFECYCLE',
    description: 'Agent lifecycle status reactivated (pending Agent phone contact model D-N6).',
    deliveryClass: 'INFORMATIONAL',
    recipientTarget: 'AGENT',
    runtimeTriggerState: 'UNWIRED_OUTBOX',
    smsEnabled: true,
    emailEnabled: false,
    toggleLocked: false,
    lockReason: null,
    templateEditable: true,
    approvedVariables: [REFERENCE_VAR],
    activeSmsVersion: 1,
    activeEmailVersion: 1,
  },
];

const CODE_BASELINE_TIMESTAMP = '2026-10-27T00:00:00.000Z';

const BASELINE_SEED_BODIES: Record<string, { body: string; variables: string[]; summary: string }> = {
  'customer.funding.approved': {
    body: 'Your funding{{amount_clause}} has been approved. Ref {{reference}}.',
    variables: ['reference', 'amount_clause'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'customer.funding.rejected': {
    body: 'Your funding{{amount_clause}} was not approved. Ref {{reference}}. Contact support.',
    variables: ['reference', 'amount_clause'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'customer.funding.requested': {
    body: 'Funding request{{amount_clause}} received. Ref {{reference}}. Awaiting review.',
    variables: ['reference', 'amount_clause'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'transfer.completed': {
    body: 'Transfer{{amount_clause}} completed. Ref {{reference}}.',
    variables: ['reference', 'amount_clause'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'transfer.failed': {
    body: 'Transfer{{amount_clause}} failed. Ref {{reference}}. Contact support.',
    variables: ['reference', 'amount_clause'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'support.ticket.created': {
    body: "Support ticket {{reference}} created. We'll update you soon.",
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'support.ticket.assigned': {
    body: 'Your support ticket {{reference}} has been assigned.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'support.ticket.status_changed': {
    body: 'Your support ticket {{reference}} status changed to {{status}}.',
    variables: ['reference', 'status'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'support.ticket.resolved': {
    body: 'Your support ticket {{reference}} has been resolved.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'support.ticket.closed': {
    body: 'Your support ticket {{reference}} has been closed.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'support.ticket.message_added': {
    body: 'New update on support ticket {{reference}}. Check your dashboard.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'cash_to_cash.created': {
    body: 'Cash-to-Cash: {{sender_name}} sent you {{amount}}. Visit an active agent outlet to collect.{{locator_clause}}',
    variables: ['sender_name', 'amount', 'locator_clause'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 non-disclosure C2C beneficiary seed baseline',
  },
  'cash_to_cash.claimed': {
    body: 'Cash-to-cash transfer {{reference}} claimed{{amount_clause}}.',
    variables: ['reference', 'amount_clause'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'cash_to_cash.expired': {
    body: 'Cash-to-cash transfer {{reference}} expired{{amount_clause}}. Contact support.',
    variables: ['reference', 'amount_clause'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'agent.application.approved': {
    body: 'Agent application {{reference}} approved.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'agent.application.rejected': {
    body: 'Agent application {{reference}} not approved.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'agent.activated': {
    body: 'Agent {{reference}} activated.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'agent.suspended': {
    body: 'Agent {{reference}} suspended. Contact support.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'agent.terminated': {
    body: 'Agent {{reference}} terminated.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
  'agent.reactivated': {
    body: 'Agent {{reference}} reactivated.',
    variables: ['reference'],
    summary: 'NOTIFICATION_DEFAULTS_V1 migration-0098 seed baseline',
  },
};

export const BASELINE_CODE_TEMPLATES: NotificationTemplateVersion[] = Object.entries(
  BASELINE_SEED_BODIES,
).flatMap(([eventType, spec]) =>
  (['SMS', 'EMAIL'] as const).map((channel) => ({
    id: `code-baseline-${channel.toLowerCase()}-${eventType}`,
    eventType,
    channel,
    locale: 'en-NG',
    version: 1,
    subject: channel === 'EMAIL' ? 'MonieNaija account update' : null,
    body: spec.body,
    variables: spec.variables,
    isActive: true,
    approvalStatus: 'ACTIVE' as const,
    changeSummary: spec.summary,
    createdBy: 'SYSTEM_SEED',
    createdAt: CODE_BASELINE_TIMESTAMP,
    updatedAt: CODE_BASELINE_TIMESTAMP,
    sourceOrigin: 'CODE_BASELINE' as const,
  })),
);
