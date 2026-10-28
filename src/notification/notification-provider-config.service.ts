import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { Environment } from '../config/environment';
import {
  BrevoEmailProvider,
  type BrevoFetchFn,
  normalizeEmailDestination,
  parseSenderIdentity,
  verifyBrevoConnection,
} from './brevo-email-provider';
import { ConsoleEmailProvider, NoneEmailProvider } from './email-provider.interface';
import { ConsoleNotificationProvider } from './notification-provider.interface';
import {
  computeKeyFingerprint,
  type ManagedNotificationChannel,
  type NotificationEncryptionStatus,
  NotificationSecretEncryptionError,
  NotificationSecretEncryptionService,
} from './notification-secret-encryption.service';
import type {
  NotificationProvider,
  NotificationSendRequest,
  NotificationSendResult,
} from './notification.types';
import { ResendEmailProvider, sanitizeHeader } from './resend-email-provider';
import { RobaseNotificationProvider } from './robase-notification-provider';

export const NOTIFICATION_PROVIDER_HTTP_FETCH_TOKEN = Symbol(
  'NOTIFICATION_PROVIDER_HTTP_FETCH_TOKEN',
);

export type ProviderHttpFetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type SmsProviderChoice = 'console' | 'robase';
export type EmailProviderChoice = 'none' | 'console' | 'brevo' | 'resend';
export type CredentialSource = 'NONE' | 'ENCRYPTED_DB' | 'ENV_SECRET';
export type CredentialAction =
  | 'KEEP_EXISTING'
  | 'SET_ENCRYPTED'
  | 'USE_ENV_SECRET'
  | 'CLEAR';

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
  channel: ManagedNotificationChannel;
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
  credentialSource: CredentialSource;
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
  encryption: NotificationEncryptionStatus;
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

export interface ProviderConfigProposalView {
  id: string;
  channel: ManagedNotificationChannel;
  expectedVersion: number;
  proposedProvider: string;
  proposedEnabled: boolean;
  proposedBaseUrl: string | null;
  proposedRequestTimeoutMs: number;
  proposedSenderId: string | null;
  proposedFromEmail: string | null;
  proposedFromName: string | null;
  proposedReplyToEmail: string | null;
  credentialAction: CredentialAction;
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

export interface ProposeProviderConfigInput {
  channel: ManagedNotificationChannel;
  expectedVersion: number;
  provider: string;
  enabled: boolean;
  baseUrl?: string | null;
  requestTimeoutMs?: number;
  senderId?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  replyToEmail?: string | null;
  credentialAction: CredentialAction;
  apiKey?: string;
  spfConfigured?: boolean;
  dkimConfigured?: boolean;
  dmarcConfigured?: boolean;
  reason: string;
}

interface DbProviderConfigRow {
  channel: ManagedNotificationChannel;
  provider: string;
  enabled: boolean;
  base_url: string | null;
  request_timeout_ms: number;
  sender_id: string | null;
  from_email: string | null;
  from_name: string | null;
  reply_to_email: string | null;
  credential_source: CredentialSource;
  encrypted_api_key: string | null;
  encryption_key_version: string | null;
  key_fingerprint: string | null;
  spf_configured: boolean;
  dkim_configured: boolean;
  dmarc_configured: boolean;
  verified_at: Date | string | null;
  verified_by: string | null;
  verification_method: string | null;
  last_verification_error: string | null;
  delivery_tested_at: Date | string | null;
  delivery_tested_by: string | null;
  last_test_status: 'SENT' | 'FAILED' | 'CONSOLE_SIMULATED' | null;
  last_test_destination_masked: string | null;
  last_test_provider_ref: string | null;
  last_test_error_code: string | null;
  last_test_at: Date | string | null;
  version: number;
  active_proposal_id: string | null;
  updated_by: string;
  approved_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbProposalRow {
  id: string;
  channel: ManagedNotificationChannel;
  expected_version: number;
  proposed_provider: string;
  proposed_enabled: boolean;
  proposed_base_url: string | null;
  proposed_request_timeout_ms: number;
  proposed_sender_id: string | null;
  proposed_from_email: string | null;
  proposed_from_name: string | null;
  proposed_reply_to_email: string | null;
  credential_action: CredentialAction;
  proposed_encrypted_api_key: string | null;
  proposed_encryption_key_version: string | null;
  proposed_key_fingerprint: string | null;
  proposed_spf_configured: boolean;
  proposed_dkim_configured: boolean;
  proposed_dmarc_configured: boolean;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'ACTIVATED';
  proposer_principal_id: string;
  approval_id: string;
  action_fingerprint: string;
  decided_by: string | null;
  decided_at: Date | string | null;
  decision_reason: string | null;
  activated_by: string | null;
  activated_at: Date | string | null;
  resulting_version: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const INITIATOR_ROLE = 'SUPER_ADMIN';
const APPROVER_ROLE = 'FINANCE_CONTROLLER';
const CONFIGURE_FUNCTION = 'notification.provider.configure';
const GOVERNANCE_ACTION_TYPE = 'NOTIFICATION_PROVIDER_CONFIG_CHANGE';
const GOVERNANCE_RESOURCE_TYPE = 'NOTIFICATION_PROVIDER_CONFIG_PROPOSAL';

const SENDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}[A-Za-z0-9]$/;
const ROBASE_KEY_PATTERN = /^robe_[A-Za-z0-9_-]{15,500}$/;
const BREVO_KEY_PATTERN = /^xkeysib-[A-Za-z0-9_-]{15,500}$/;
const RESEND_KEY_PATTERN = /^re_[A-Za-z0-9_-]{12,500}$/;
const VERIFY_HOURLY_CAP = 10;

const ROBASE_SENDER_ID_NOTE =
  'Robase /v1/sms/send binds sender identity at the Robase workspace level; Sender ID is stored here for MonieNaija operational governance and is not sent as an unverified wire field.';

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function validateProviderBaseUrl(rawUrl: string, nodeEnv: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (trimmed.length === 0 || trimmed.length > 2048) {
    throw new BadRequestException('baseUrl must be between 1 and 2048 characters.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException('baseUrl must be a valid HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('baseUrl must use https://.');
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestException('baseUrl must not contain embedded credentials.');
  }
  if (parsed.search || parsed.hash) {
    throw new BadRequestException('baseUrl must not include query strings or URL fragments.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    nodeEnv === 'production' &&
    (host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.local') ||
      host.endsWith('.internal'))
  ) {
    throw new BadRequestException(
      'Loopback or internal baseUrl hosts are forbidden in production.',
    );
  }
  return trimmed;
}

function validateApiKeyForProvider(provider: string, rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    throw new BadRequestException('apiKey must not be empty when credentialAction=SET_ENCRYPTED.');
  }
  if (/\s/.test(trimmed)) {
    throw new BadRequestException('apiKey must not contain whitespace.');
  }
  if (provider === 'robase') {
    if (!ROBASE_KEY_PATTERN.test(trimmed)) {
      throw new BadRequestException(
        'Robase API key must use the verified live key format (robe_ prefix, 20+ characters).',
      );
    }
    return trimmed;
  }
  if (provider === 'brevo') {
    if (trimmed.startsWith('xsmtpsib-')) {
      throw new BadRequestException(
        'SMTP relay passwords (xsmtpsib- prefix) are not valid for the Brevo v3 HTTP API. Enter a Brevo v3 REST API key (xkeysib- prefix).',
      );
    }
    if (!BREVO_KEY_PATTERN.test(trimmed)) {
      throw new BadRequestException(
        'Brevo API key must use the v3 REST API key format (xkeysib- prefix, 23+ characters).',
      );
    }
    return trimmed;
  }
  if (provider === 'resend') {
    if (!RESEND_KEY_PATTERN.test(trimmed)) {
      throw new BadRequestException(
        'Resend API key must use the live key format (re_ prefix).',
      );
    }
    return trimmed;
  }
  throw new BadRequestException(
    `credentialAction=SET_ENCRYPTED is not applicable to provider "${provider}".`,
  );
}

@Injectable()
export class NotificationProviderConfigService {
  private readonly logger = new Logger(NotificationProviderConfigService.name);
  private readonly consoleSms = new ConsoleNotificationProvider();
  private readonly consoleEmail = new ConsoleEmailProvider();
  private readonly noneEmail = new NoneEmailProvider();

  /**
   * Synchronous projection of the active provider names for `NotificationProvider.name`
   * (inspected synchronously by `NotificationDispatcherService` and status callers).
   * Kept current by `refreshRuntimeCache()` before dispatch and on every governed mutation.
   */
  private cachedSmsProviderName: string;
  private cachedEmailProviderName: string;

  constructor(
    private readonly configService: ConfigService<Environment, true>,
    private readonly encryptionService: NotificationSecretEncryptionService,
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly approvals?: PrivilegedActionApprovalService,
    @Optional() private readonly auditService?: AuditService,
    @Optional()
    @Inject(NOTIFICATION_PROVIDER_HTTP_FETCH_TOKEN)
    private readonly fetchImpl?: ProviderHttpFetchFn,
  ) {
    this.cachedSmsProviderName = this.resolveEnvSmsProviderName();
    this.cachedEmailProviderName = this.resolveEnvEmailProviderName();
  }

  getActiveSmsProviderNameSync(): string {
    return this.cachedSmsProviderName;
  }

  getActiveEmailProviderNameSync(): string {
    return this.cachedEmailProviderName;
  }

  async refreshRuntimeCache(): Promise<void> {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      this.cachedSmsProviderName = this.resolveEnvSmsProviderName();
      this.cachedEmailProviderName = this.resolveEnvEmailProviderName();
      return;
    }

    try {
      const rows = await this.loadAllDbRows();
      const smsRow = rows.get('SMS');
      const emailRow = rows.get('EMAIL');

      this.cachedSmsProviderName = smsRow
        ? smsRow.provider
        : this.resolveEnvSmsProviderName();

      if (emailRow) {
        // When EMAIL is set to 'none' or explicitly disabled, advertise 'none' to the
        // business outbox dispatcher so customer events do not enqueue dark EMAIL intents,
        // while direct `sendEmail()` calls still fail closed with EMAIL_PROVIDER_DISABLED.
        this.cachedEmailProviderName =
          emailRow.provider === 'none' || !emailRow.enabled
            ? 'none'
            : emailRow.provider;
      } else {
        this.cachedEmailProviderName = this.resolveEnvEmailProviderName();
      }
    } catch {
      this.cachedSmsProviderName = this.resolveEnvSmsProviderName();
      this.cachedEmailProviderName = this.resolveEnvEmailProviderName();
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime Dispatch Delegation (Fail-Closed)
  // ---------------------------------------------------------------------------

  async sendSms(request: NotificationSendRequest): Promise<NotificationSendResult> {
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });
    const row = await this.loadDbRow('SMS');

    if (!row) {
      const envProvider = this.configService.get('NOTIFICATION_SMS_PROVIDER', { infer: true });
      if (envProvider === 'managed') {
        return { success: false, error: 'SMS_PROVIDER_NOT_CONFIGURED' };
      }
      if (envProvider === 'console') {
        if (nodeEnv === 'production') {
          return { success: false, error: 'CONSOLE_FORBIDDEN_IN_PRODUCTION' };
        }
        return this.consoleSms.send(request);
      }
      const apiKey = this.configService.get('ROBASE_API_KEY', { infer: true });
      if (!apiKey || !apiKey.startsWith('robe_')) {
        return { success: false, error: 'SMS_PROVIDER_NOT_CONFIGURED' };
      }
      const baseUrl =
        this.configService.get('ROBASE_API_BASE_URL', { infer: true }) ??
        'https://api.robase.dev';
      const requestTimeoutMs =
        this.configService.get('ROBASE_REQUEST_TIMEOUT_MS', { infer: true }) ?? 10_000;
      const adapter = new RobaseNotificationProvider(
        { baseUrl, apiKey, requestTimeoutMs },
        this.fetchImpl as ConstructorParameters<typeof RobaseNotificationProvider>[1],
      );
      return adapter.send(request);
    }

    if (row.provider === 'console') {
      if (nodeEnv === 'production') {
        return { success: false, error: 'CONSOLE_FORBIDDEN_IN_PRODUCTION' };
      }
      if (!row.enabled) {
        return { success: false, error: 'SMS_PROVIDER_DISABLED' };
      }
      return this.consoleSms.send(request);
    }

    if (!row.enabled) {
      return { success: false, error: 'SMS_PROVIDER_DISABLED' };
    }

    const secretResolution = this.resolveRowSecret(row);
    if (!secretResolution.ok) {
      return { success: false, error: secretResolution.errorCode };
    }

    if (row.provider === 'robase') {
      const baseUrl = row.base_url ?? 'https://api.robase.dev';
      const adapter = new RobaseNotificationProvider(
        {
          baseUrl,
          apiKey: secretResolution.apiKey,
          requestTimeoutMs: row.request_timeout_ms,
        },
        this.fetchImpl as ConstructorParameters<typeof RobaseNotificationProvider>[1],
      );
      return adapter.send(request);
    }

    return { success: false, error: 'SMS_PROVIDER_NOT_CONFIGURED' };
  }

  async sendEmail(request: NotificationSendRequest): Promise<NotificationSendResult> {
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });
    const row = await this.loadDbRow('EMAIL');

    if (!row) {
      const envProvider = this.configService.get('NOTIFICATION_EMAIL_PROVIDER', { infer: true });
      if (envProvider === 'none' || envProvider === 'managed') {
        return this.noneEmail.send();
      }
      if (envProvider === 'console') {
        if (nodeEnv === 'production') {
          return { success: false, error: 'CONSOLE_FORBIDDEN_IN_PRODUCTION' };
        }
        return this.consoleEmail.send(request);
      }
      const from = this.configService.get('NOTIFICATION_EMAIL_FROM', { infer: true });
      const fromName = this.configService.get('NOTIFICATION_EMAIL_FROM_NAME', { infer: true });
      const replyTo =
        this.configService.get('NOTIFICATION_EMAIL_REPLY_TO', { infer: true }) ?? null;

      if (envProvider === 'brevo') {
        const apiKey = this.configService.get('BREVO_API_KEY', { infer: true });
        if (!apiKey || !from) {
          return { success: false, error: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
        }
        const baseUrl =
          this.configService.get('BREVO_API_BASE_URL', { infer: true }) ??
          'https://api.brevo.com';
        const requestTimeoutMs =
          this.configService.get('BREVO_REQUEST_TIMEOUT_MS', { infer: true }) ?? 10_000;
        const adapter = new BrevoEmailProvider(
          {
            baseUrl,
            apiKey,
            fromEmail: from,
            fromName: fromName ?? null,
            replyTo,
            requestTimeoutMs,
          },
          this.fetchImpl as BrevoFetchFn | undefined,
        );
        return adapter.send(request);
      }

      if (envProvider === 'resend') {
        const apiKey = this.configService.get('RESEND_API_KEY', { infer: true });
        if (!apiKey || !from) {
          return { success: false, error: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
        }
        const baseUrl =
          this.configService.get('RESEND_API_BASE_URL', { infer: true }) ??
          'https://api.resend.com';
        const requestTimeoutMs =
          this.configService.get('RESEND_REQUEST_TIMEOUT_MS', { infer: true }) ?? 10_000;
        const adapter = new ResendEmailProvider(
          { baseUrl, apiKey, from, replyTo, requestTimeoutMs },
          this.fetchImpl as ConstructorParameters<typeof ResendEmailProvider>[1],
        );
        return adapter.send(request);
      }

      return this.noneEmail.send();
    }

    if (row.provider === 'none') {
      return this.noneEmail.send();
    }

    if (row.provider === 'console') {
      if (nodeEnv === 'production') {
        return { success: false, error: 'CONSOLE_FORBIDDEN_IN_PRODUCTION' };
      }
      if (!row.enabled) {
        return { success: false, error: 'EMAIL_PROVIDER_DISABLED' };
      }
      return this.consoleEmail.send(request);
    }

    if (!row.enabled) {
      return { success: false, error: 'EMAIL_PROVIDER_DISABLED' };
    }

    const secretResolution = this.resolveRowSecret(row);
    if (!secretResolution.ok) {
      return { success: false, error: secretResolution.errorCode };
    }

    if (!row.from_email) {
      return { success: false, error: 'EMAIL_SENDER_NOT_CONFIGURED' };
    }

    if (row.provider === 'brevo') {
      const adapter = new BrevoEmailProvider(
        {
          baseUrl: row.base_url ?? 'https://api.brevo.com',
          apiKey: secretResolution.apiKey,
          fromEmail: row.from_email,
          fromName: row.from_name,
          replyTo: row.reply_to_email,
          requestTimeoutMs: row.request_timeout_ms,
        },
        this.fetchImpl as BrevoFetchFn | undefined,
      );
      return adapter.send(request);
    }

    if (row.provider === 'resend') {
      const combinedFrom = row.from_name
        ? `${sanitizeHeader(row.from_name)} <${row.from_email}>`
        : row.from_email;
      const adapter = new ResendEmailProvider(
        {
          baseUrl: row.base_url ?? 'https://api.resend.com',
          apiKey: secretResolution.apiKey,
          from: combinedFrom,
          replyTo: row.reply_to_email,
          requestTimeoutMs: row.request_timeout_ms,
        },
        this.fetchImpl as ConstructorParameters<typeof ResendEmailProvider>[1],
      );
      return adapter.send(request);
    }

    return { success: false, error: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
  }

  // ---------------------------------------------------------------------------
  // Non-Secret Read Projections
  // ---------------------------------------------------------------------------

  async getOverview(): Promise<ProviderConfigurationOverview> {
    await this.refreshRuntimeCache();
    const rows = await this.loadAllDbRows();
    const encryption = this.encryptionService.getStatus();
    const workerEnabled = Boolean(
      this.configService.get('NOTIFICATION_WORKER_ENABLED', { infer: true }),
    );
    const worker = {
      enabled: workerEnabled,
      pollIntervalMs:
        this.configService.get('NOTIFICATION_WORKER_POLL_INTERVAL_MS', { infer: true }) ??
        5_000,
      batchSize:
        this.configService.get('NOTIFICATION_WORKER_BATCH_SIZE', { infer: true }) ?? 10,
      smsRetryMaxAttempts:
        this.configService.get('SMS_RETRY_MAX_ATTEMPTS', { infer: true }) ?? 3,
      smsRetryBaseDelaySeconds:
        this.configService.get('SMS_RETRY_BASE_DELAY_SECONDS', { infer: true }) ?? 60,
    };

    const sms = this.buildSmsSnapshot(rows.get('SMS') ?? null, encryption, workerEnabled);
    const email = this.buildEmailSnapshot(rows.get('EMAIL') ?? null, encryption, workerEnabled);

    return {
      sms,
      email,
      encryption,
      worker,
      contracts: {
        robase: {
          verifiedEndpoint: 'POST {baseUrl}/v1/sms/send',
          senderIdBehaviour: ROBASE_SENDER_ID_NOTE,
          verificationBehaviour:
            'Robase documents POST /v1/sms/send and GET /v1/sms/{id} without a separate read-only ping endpoint. Connection check validates server decryption + contract parameters; Controlled Test-Send confirms live API acceptance.',
        },
        brevo: {
          verifiedEndpoint: 'POST {baseUrl}/v3/smtp/email',
          verifyEndpoints: ['GET {baseUrl}/v3/account', 'GET {baseUrl}/v3/senders'],
          domainAuthRequirements: [
            'SPF: Publish Brevo SPF include mechanisms on your sending domain TXT record so receiving MTAs permit Brevo outbound relays.',
            'DKIM: Publish Brevo DKIM TXT / CNAME selector records in DNS so outbound transactional emails carry a cryptographic domain signature.',
            'DMARC: Publish _dmarc.<domain> TXT policy (e.g. v=DMARC1; p=quarantine or p=reject; rua=mailto:...) aligned with your verified From domain.',
          ],
        },
      },
    };
  }

  async listProposals(
    channel?: ManagedNotificationChannel,
    status?: string,
    limit = 25,
  ): Promise<ProviderConfigProposalView[]> {
    const ds = this.requireDataSource();
    const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 25, 1), 100);
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (channel) {
      params.push(channel);
      conditions.push(`channel = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    params.push(boundedLimit);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows: DbProposalRow[] = await this.safeDbOperation(
      'listProposals',
      () =>
        ds.query(
          `SELECT id, channel, expected_version, proposed_provider, proposed_enabled,
                  proposed_base_url, proposed_request_timeout_ms, proposed_sender_id,
                  proposed_from_email, proposed_from_name, proposed_reply_to_email,
                  credential_action, proposed_encryption_key_version, proposed_key_fingerprint,
                  proposed_spf_configured, proposed_dkim_configured, proposed_dmarc_configured,
                  reason, status, proposer_principal_id, approval_id, action_fingerprint,
                  decided_by, decided_at, decision_reason, activated_by, activated_at,
                  resulting_version, created_at, updated_at
             FROM notification_provider_config_proposals
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${params.length}`,
          params,
        ),
      'Notification provider configuration proposals could not be loaded.',
    );
    return rows.map((r) => this.mapProposalView(r));
  }

  async getProposal(id: string): Promise<ProviderConfigProposalView> {
    const ds = this.requireDataSource();
    const rows: DbProposalRow[] = await this.safeDbOperation(
      'getProposal',
      () =>
        ds.query(
          `SELECT id, channel, expected_version, proposed_provider, proposed_enabled,
                  proposed_base_url, proposed_request_timeout_ms, proposed_sender_id,
                  proposed_from_email, proposed_from_name, proposed_reply_to_email,
                  credential_action, proposed_encryption_key_version, proposed_key_fingerprint,
                  proposed_spf_configured, proposed_dkim_configured, proposed_dmarc_configured,
                  reason, status, proposer_principal_id, approval_id, action_fingerprint,
                  decided_by, decided_at, decision_reason, activated_by, activated_at,
                  resulting_version, created_at, updated_at
             FROM notification_provider_config_proposals
            WHERE id = $1`,
          [id],
        ),
      'Notification provider configuration proposal could not be loaded.',
    );
    if (!rows[0]) {
      throw new NotFoundException('Notification provider configuration proposal not found.');
    }
    return this.mapProposalView(rows[0]);
  }

  // ---------------------------------------------------------------------------
  // Governed Maker-Checker Lifecycle (Propose -> Approve/Reject -> Activate)
  // ---------------------------------------------------------------------------

  async proposeChange(
    principal: AuthorizationPrincipal,
    input: ProposeProviderConfigInput,
    correlationId?: string,
  ): Promise<ProviderConfigProposalView> {
    const ds = this.requireDataSource();
    const approvals = this.requireApprovals();
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });

    if (principal.readOnlyPrincipal) {
      throw new ForbiddenException('Read-only principals cannot propose provider changes.');
    }
    if (!principal.roles.includes(INITIATOR_ROLE)) {
      throw new ForbiddenException(
        `Only ${INITIATOR_ROLE} may initiate notification provider configuration proposals.`,
      );
    }

    const channel = input.channel;
    if (channel !== 'SMS' && channel !== 'EMAIL') {
      throw new BadRequestException('channel must be SMS or EMAIL.');
    }

    if (
      typeof input.expectedVersion !== 'number' ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    ) {
      throw new BadRequestException('expectedVersion must be a non-negative integer.');
    }

    const reason = (input.reason ?? '').trim();
    if (reason.length < 10 || reason.length > 500) {
      throw new BadRequestException('reason must be between 10 and 500 characters.');
    }

    const existing = await this.loadDbRow(channel);
    const currentVersion = existing ? existing.version : 0;
    if (input.expectedVersion !== currentVersion) {
      throw new ConflictException(
        `Provider configuration version mismatch for ${channel}: expected ${input.expectedVersion}, current is ${currentVersion}. Refresh and retry.`,
      );
    }

    const provider = (input.provider ?? '').trim();
    if (channel === 'SMS' && provider !== 'console' && provider !== 'robase') {
      throw new BadRequestException('SMS provider must be "console" or "robase".');
    }
    if (
      channel === 'EMAIL' &&
      provider !== 'none' &&
      provider !== 'console' &&
      provider !== 'brevo' &&
      provider !== 'resend'
    ) {
      throw new BadRequestException(
        'EMAIL provider must be "none", "console", "brevo", or "resend".',
      );
    }
    if (nodeEnv === 'production' && provider === 'console') {
      throw new BadRequestException(
        'Console notification providers are forbidden in production environments.',
      );
    }

    const enabled = Boolean(input.enabled);
    if (provider === 'none' && enabled) {
      throw new BadRequestException('Provider "none" cannot be marked enabled.');
    }

    const requestTimeoutMs = input.requestTimeoutMs ?? (existing?.request_timeout_ms ?? 10_000);
    if (
      typeof requestTimeoutMs !== 'number' ||
      !Number.isInteger(requestTimeoutMs) ||
      requestTimeoutMs < 1_000 ||
      requestTimeoutMs > 60_000
    ) {
      throw new BadRequestException(
        'requestTimeoutMs must be an integer between 1000 and 60000.',
      );
    }

    const isExternalProvider =
      provider === 'robase' || provider === 'brevo' || provider === 'resend';

    let baseUrl: string | null = null;
    if (isExternalProvider) {
      const defaultUrl =
        provider === 'robase'
          ? 'https://api.robase.dev'
          : provider === 'brevo'
            ? 'https://api.brevo.com'
            : 'https://api.resend.com';
      baseUrl = validateProviderBaseUrl(
        input.baseUrl && input.baseUrl.trim() ? input.baseUrl : (existing?.base_url ?? defaultUrl),
        nodeEnv,
      );
    }

    let senderId: string | null = null;
    let fromEmail: string | null = null;
    let fromName: string | null = null;
    let replyToEmail: string | null = null;
    let spfConfigured = false;
    let dkimConfigured = false;
    let dmarcConfigured = false;

    if (channel === 'SMS') {
      if (input.senderId !== undefined && input.senderId !== null && input.senderId.trim() !== '') {
        const trimmedSender = input.senderId.trim();
        if (!SENDER_ID_PATTERN.test(trimmedSender)) {
          throw new BadRequestException(
            'senderId must be 3 to 11 alphanumeric characters (spaces/hyphens allowed internally).',
          );
        }
        senderId = trimmedSender;
      }
    } else {
      spfConfigured = Boolean(input.spfConfigured ?? existing?.spf_configured ?? false);
      dkimConfigured = Boolean(input.dkimConfigured ?? existing?.dkim_configured ?? false);
      dmarcConfigured = Boolean(input.dmarcConfigured ?? existing?.dmarc_configured ?? false);

      if (provider === 'brevo' || provider === 'resend') {
        const rawFrom = (input.fromEmail ?? existing?.from_email ?? '').trim();
        const parsedSender = parseSenderIdentity(rawFrom, input.fromName ?? existing?.from_name);
        if (!parsedSender) {
          throw new BadRequestException(
            'A valid verified sender email address (fromEmail) is required for Brevo/Resend.',
          );
        }
        fromEmail = parsedSender.email;
        fromName = parsedSender.name;

        const rawReplyTo = input.replyToEmail;
        if (rawReplyTo !== undefined && rawReplyTo !== null && rawReplyTo.trim() !== '') {
          const normalizedReply = normalizeEmailDestination(rawReplyTo);
          if (!normalizedReply) {
            throw new BadRequestException('replyToEmail must be a valid email address.');
          }
          replyToEmail = normalizedReply;
        } else if (rawReplyTo === undefined) {
          replyToEmail = existing?.reply_to_email ?? null;
        }
      }
    }

    const credentialAction = input.credentialAction;
    if (
      credentialAction !== 'KEEP_EXISTING' &&
      credentialAction !== 'SET_ENCRYPTED' &&
      credentialAction !== 'USE_ENV_SECRET' &&
      credentialAction !== 'CLEAR'
    ) {
      throw new BadRequestException(
        'credentialAction must be KEEP_EXISTING, SET_ENCRYPTED, USE_ENV_SECRET, or CLEAR.',
      );
    }

    if (credentialAction !== 'SET_ENCRYPTED' && input.apiKey !== undefined && input.apiKey !== '') {
      throw new BadRequestException(
        'apiKey must only be supplied when credentialAction is SET_ENCRYPTED.',
      );
    }

    let encryptedEnvelope: string | null = null;
    let encryptionKeyVersion: string | null = null;
    let keyFingerprint: string | null = null;
    let envelopeHash: string | null = null;

    if (credentialAction === 'SET_ENCRYPTED') {
      if (!isExternalProvider) {
        throw new BadRequestException(
          `Encrypted API credentials cannot be stored for provider "${provider}".`,
        );
      }
      const validatedKey = validateApiKeyForProvider(provider, input.apiKey ?? '');
      try {
        const encrypted = this.encryptionService.encrypt(validatedKey, channel);
        encryptedEnvelope = encrypted.envelope;
        encryptionKeyVersion = encrypted.keyVersion;
        keyFingerprint = encrypted.fingerprint;
        envelopeHash = encrypted.envelopeHash;
      } catch (err) {
        if (err instanceof NotificationSecretEncryptionError) {
          throw new BadRequestException(`${err.code}: ${err.message}`);
        }
        throw new BadRequestException('Failed to encrypt notification provider credential.');
      }
    } else if (credentialAction === 'KEEP_EXISTING') {
      if (isExternalProvider) {
        const hasExistingCred =
          existing &&
          (existing.credential_source === 'ENCRYPTED_DB' ||
            existing.credential_source === 'ENV_SECRET');
        if (!hasExistingCred) {
          throw new BadRequestException(
            `No existing stored credential is present for ${channel}; choose SET_ENCRYPTED or USE_ENV_SECRET.`,
          );
        }
        keyFingerprint = existing?.key_fingerprint ?? null;
      }
    } else if (credentialAction === 'USE_ENV_SECRET') {
      if (!isExternalProvider) {
        throw new BadRequestException(
          `USE_ENV_SECRET is only valid for external providers (robase, brevo, resend).`,
        );
      }
      const envSecret = this.getEnvSecretForProvider(provider);
      if (!envSecret) {
        throw new BadRequestException(
          `Environment variable credential for "${provider}" is not configured on this server.`,
        );
      }
      validateApiKeyForProvider(provider, envSecret);
      keyFingerprint = computeKeyFingerprint(envSecret);
    } else if (credentialAction === 'CLEAR') {
      if (isExternalProvider && enabled) {
        throw new BadRequestException(
          `Cannot clear credentials while ${provider} is enabled.`,
        );
      }
    }

    const proposalId = randomUUID();
    const actionFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          proposalId,
          channel,
          expectedVersion: input.expectedVersion,
          provider,
          enabled,
          baseUrl,
          requestTimeoutMs,
          senderId,
          fromEmail,
          fromName,
          replyToEmail,
          credentialAction,
          envelopeHash,
          keyFingerprint,
          spfConfigured,
          dkimConfigured,
          dmarcConfigured,
        }),
        'utf8',
      )
      .digest('hex');

    const decision = await this.safeDbOperation('proposeChange.requestApproval', () =>
      approvals.request({
        principal,
        policy: {
          resourceType: GOVERNANCE_RESOURCE_TYPE,
          action: GOVERNANCE_ACTION_TYPE,
          allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
          requiredRoles: [INITIATOR_ROLE],
          requiredFunctions: [CONFIGURE_FUNCTION],
          minimumAssurance: 'MFA',
          customerAccess: 'NONE',
        },
        resource: { type: GOVERNANCE_RESOURCE_TYPE, id: proposalId },
        actionFingerprint,
        reason,
        approvalScope: CONFIGURE_FUNCTION,
      }),
    );

    if (!decision.approval) {
      throw new ForbiddenException(
        `Notification provider configuration proposal denied: ${decision.reason}`,
      );
    }

    try {
      await this.safeTransaction('proposeChange.persist', ds, async (manager) => {
        await manager.query(
          `INSERT INTO notification_provider_config_proposals
             (id, channel, expected_version, proposed_provider, proposed_enabled,
              proposed_base_url, proposed_request_timeout_ms, proposed_sender_id,
              proposed_from_email, proposed_from_name, proposed_reply_to_email,
              credential_action, proposed_encrypted_api_key, proposed_encryption_key_version,
              proposed_key_fingerprint, proposed_spf_configured, proposed_dkim_configured,
              proposed_dmarc_configured, reason, status, proposer_principal_id,
              approval_id, action_fingerprint)
           VALUES
             ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'REQUESTED',$20,$21,$22)`,
          [
            proposalId,
            channel,
            input.expectedVersion,
            provider,
            enabled,
            baseUrl,
            requestTimeoutMs,
            senderId,
            fromEmail,
            fromName,
            replyToEmail,
            credentialAction,
            encryptedEnvelope,
            encryptionKeyVersion,
            keyFingerprint,
            spfConfigured,
            dkimConfigured,
            dmarcConfigured,
            reason,
            principal.principalId,
            decision.approval!.id,
            actionFingerprint,
          ],
        );

        if (this.auditService) {
          await this.auditService.record(manager, {
            entityType: 'NOTIFICATION_PROVIDER_CONFIG',
            entityId: proposalId,
            action: 'NOTIFICATION_PROVIDER_CONFIG_PROPOSED',
            actor: principal.principalId,
            correlationId,
            newValues: {
              channel,
              expectedVersion: input.expectedVersion,
              proposedProvider: provider,
              proposedEnabled: enabled,
              proposedBaseUrl: baseUrl,
              proposedSenderId: senderId,
              proposedFromEmail: fromEmail,
              proposedFromName: fromName,
              credentialAction,
              proposedKeyFingerprint: keyFingerprint,
              proposedEncryptionKeyVersion: encryptionKeyVersion,
              spfConfigured,
              dkimConfigured,
              dmarcConfigured,
              approvalId: decision.approval!.id,
            },
          });
        }
      });
    } catch (err) {
      await approvals
        .cancel({ approvalId: decision.approval.id, principal })
        .catch(() => undefined);
      throw err;
    }

    return this.getProposal(proposalId);
  }

  async approveProposal(
    principal: AuthorizationPrincipal,
    proposalId: string,
    comment?: string,
    correlationId?: string,
  ): Promise<ProviderConfigProposalView> {
    return this.decideProposal(principal, proposalId, true, comment, correlationId);
  }

  async rejectProposal(
    principal: AuthorizationPrincipal,
    proposalId: string,
    comment?: string,
    correlationId?: string,
  ): Promise<ProviderConfigProposalView> {
    return this.decideProposal(principal, proposalId, false, comment, correlationId);
  }

  private async decideProposal(
    principal: AuthorizationPrincipal,
    proposalId: string,
    approve: boolean,
    comment?: string,
    correlationId?: string,
  ): Promise<ProviderConfigProposalView> {
    const ds = this.requireDataSource();
    const approvals = this.requireApprovals();

    if (principal.readOnlyPrincipal) {
      throw new ForbiddenException('Read-only principals cannot decide provider proposals.');
    }
    if (!principal.roles.includes(APPROVER_ROLE)) {
      throw new ForbiddenException(
        `Only ${APPROVER_ROLE} may ${approve ? 'approve' : 'reject'} notification provider configuration proposals.`,
      );
    }
    if (!principal.scopes.includes(CONFIGURE_FUNCTION)) {
      throw new ForbiddenException(
        `Principal lacks required ${CONFIGURE_FUNCTION} capability.`,
      );
    }
    if (principal.assuranceLevel !== 'MFA') {
      throw new ForbiddenException(
        'Step-up MFA assurance is required to decide notification provider configuration proposals.',
      );
    }

    const rows: Array<
      Pick<
        DbProposalRow,
        | 'id'
        | 'channel'
        | 'status'
        | 'proposer_principal_id'
        | 'approval_id'
        | 'proposed_provider'
        | 'proposed_enabled'
        | 'proposed_key_fingerprint'
      >
    > = await this.safeDbOperation(
      'decideProposal.load',
      () =>
        ds.query(
          `SELECT id, channel, status, proposer_principal_id, approval_id,
                  proposed_provider, proposed_enabled, proposed_key_fingerprint
             FROM notification_provider_config_proposals
            WHERE id = $1`,
          [proposalId],
        ),
      'Notification provider configuration proposal could not be loaded.',
    );
    const proposal = rows[0];
    if (!proposal) {
      throw new NotFoundException('Notification provider configuration proposal not found.');
    }
    if (proposal.status !== 'REQUESTED') {
      throw new ConflictException(
        `Proposal is already in status ${proposal.status} and cannot be decided again.`,
      );
    }
    if (proposal.proposer_principal_id === principal.principalId) {
      await this.recordDeniedGovernanceAudit(
        proposalId,
        principal.principalId,
        'SELF_APPROVAL_FORBIDDEN',
        correlationId,
      );
      throw new ForbiddenException(
        'SELF_APPROVAL_FORBIDDEN: Initiating administrator cannot approve or decide their own notification provider change.',
      );
    }

    const decision = await this.safeDbOperation('decideProposal.approvalService', () =>
      approve
        ? approvals.approve({
            approvalId: proposal.approval_id,
            principal,
            comment,
          })
        : approvals.reject({
            approvalId: proposal.approval_id,
            principal,
            comment,
          }),
    );

    const expectedReason = approve ? 'APPROVED' : 'REJECTED';
    if (decision.reason !== expectedReason) {
      await this.recordDeniedGovernanceAudit(
        proposalId,
        principal.principalId,
        decision.reason ?? 'DENIED',
        correlationId,
      );
      throw new ForbiddenException(
        `Proposal ${approve ? 'approval' : 'rejection'} denied: ${decision.reason ?? 'DENIED'}`,
      );
    }

    const nextStatus = approve ? 'APPROVED' : 'REJECTED';
    await this.safeTransaction('decideProposal.persist', ds, async (manager) => {
      await manager.query(
        `UPDATE notification_provider_config_proposals
            SET status = $1,
                decided_by = $2,
                decided_at = NOW(),
                decision_reason = $3,
                updated_at = NOW()
          WHERE id = $4`,
        [nextStatus, principal.principalId, comment?.trim().slice(0, 500) ?? null, proposalId],
      );

      if (this.auditService) {
        await this.auditService.record(manager, {
          entityType: 'NOTIFICATION_PROVIDER_CONFIG',
          entityId: proposalId,
          action: approve
            ? 'NOTIFICATION_PROVIDER_CONFIG_APPROVED'
            : 'NOTIFICATION_PROVIDER_CONFIG_REJECTED',
          actor: principal.principalId,
          correlationId,
          newValues: {
            channel: proposal.channel,
            status: nextStatus,
            proposedProvider: proposal.proposed_provider,
            proposedEnabled: proposal.proposed_enabled,
            proposedKeyFingerprint: proposal.proposed_key_fingerprint,
            comment: comment?.trim().slice(0, 500) ?? null,
          },
        });
      }
    });

    return this.getProposal(proposalId);
  }

  async activateProposal(
    principal: AuthorizationPrincipal,
    proposalId: string,
    correlationId?: string,
  ): Promise<{ proposal: ProviderConfigProposalView; configuration: ProviderChannelSnapshot }> {
    const ds = this.requireDataSource();
    const approvals = this.requireApprovals();

    if (principal.readOnlyPrincipal) {
      throw new ForbiddenException('Read-only principals cannot activate provider proposals.');
    }
    const canActivateRole =
      principal.roles.includes(INITIATOR_ROLE) || principal.roles.includes(APPROVER_ROLE);
    if (!canActivateRole || !principal.scopes.includes(CONFIGURE_FUNCTION)) {
      throw new ForbiddenException(
        `Activation requires ${INITIATOR_ROLE} or ${APPROVER_ROLE} with ${CONFIGURE_FUNCTION}.`,
      );
    }
    if (principal.assuranceLevel !== 'MFA') {
      throw new ForbiddenException(
        'Step-up MFA assurance is required to activate notification provider configuration changes.',
      );
    }

    await this.safeTransaction('activateProposal.persist', ds, async (manager) => {
      const propRows: DbProposalRow[] = await manager.query(
        `SELECT * FROM notification_provider_config_proposals WHERE id = $1 FOR UPDATE`,
        [proposalId],
      );
      const proposal = propRows[0];
      if (!proposal) {
        throw new NotFoundException('Notification provider configuration proposal not found.');
      }
      if (proposal.status !== 'APPROVED') {
        throw new ConflictException(
          `Proposal must be APPROVED before activation (current status: ${proposal.status}).`,
        );
      }
      if (!proposal.decided_by || proposal.decided_by === proposal.proposer_principal_id) {
        throw new ForbiddenException(
          'SELF_APPROVAL_FORBIDDEN: Independent checker approval is required before activation.',
        );
      }

      const existingRows: DbProviderConfigRow[] = await manager.query(
        `SELECT * FROM notification_provider_configurations WHERE channel = $1 FOR UPDATE`,
        [proposal.channel],
      );
      const existing = existingRows[0] ?? null;
      const currentVersion = existing ? existing.version : 0;
      if (proposal.expected_version !== currentVersion) {
        throw new ConflictException(
          `Concurrent configuration change detected on ${proposal.channel}: proposal expected version ${proposal.expected_version}, current is ${currentVersion}.`,
        );
      }

      let nextCredSource: CredentialSource = 'NONE';
      let nextEncryptedKey: string | null = null;
      let nextKeyVersion: string | null = null;
      let nextFingerprint: string | null = null;

      if (proposal.credential_action === 'SET_ENCRYPTED') {
        if (!proposal.proposed_encrypted_api_key || !proposal.proposed_key_fingerprint) {
          throw new BadRequestException('Proposal is missing encrypted credential material.');
        }
        // Verify server can decrypt the proposed envelope right now (fail-closed before activation!)
        try {
          this.encryptionService.decrypt(
            proposal.proposed_encrypted_api_key,
            proposal.channel,
            proposal.proposed_encryption_key_version,
          );
        } catch (err) {
          const code =
            err instanceof NotificationSecretEncryptionError
              ? err.code
              : 'PROVIDER_SECRET_DECRYPT_FAILED';
          throw new BadRequestException(
            `Cannot activate proposal: ${code} — ensure server encryption key is configured.`,
          );
        }
        nextCredSource = 'ENCRYPTED_DB';
        nextEncryptedKey = proposal.proposed_encrypted_api_key;
        nextKeyVersion = proposal.proposed_encryption_key_version;
        nextFingerprint = proposal.proposed_key_fingerprint;
      } else if (proposal.credential_action === 'KEEP_EXISTING') {
        if (existing) {
          nextCredSource = existing.credential_source;
          nextEncryptedKey = existing.encrypted_api_key;
          nextKeyVersion = existing.encryption_key_version;
          nextFingerprint = existing.key_fingerprint;
        }
      } else if (proposal.credential_action === 'USE_ENV_SECRET') {
        const envSecret = this.getEnvSecretForProvider(proposal.proposed_provider);
        if (!envSecret) {
          throw new BadRequestException(
            `Environment variable credential for "${proposal.proposed_provider}" is missing.`,
          );
        }
        nextCredSource = 'ENV_SECRET';
        nextFingerprint = computeKeyFingerprint(envSecret);
      } else if (proposal.credential_action === 'CLEAR') {
        nextCredSource = 'NONE';
      }

      const consumeDecision = await approvals.consumeInTransaction(manager, {
        principal,
        approvalId: proposal.approval_id,
        actionType: GOVERNANCE_ACTION_TYPE,
        resource: { type: GOVERNANCE_RESOURCE_TYPE, id: proposal.id },
        actionFingerprint: proposal.action_fingerprint,
      });
      if (!consumeDecision.approved) {
        throw new ForbiddenException(
          `Failed to consume privileged approval for activation: ${consumeDecision.reason}`,
        );
      }

      // Preserve prior verification / test-send readiness ONLY when the underlying provider,
      // endpoint, sender identity, and credential material have NOT changed (e.g. toggling
      // `enabled` or `spf/dkim/dmarc` after verifying/testing). Any credential rotation,
      // provider switch, endpoint change, or sender change resets `verified` and `deliveryTested`!
      const coreIdentityUnchanged =
        Boolean(existing) &&
        existing!.provider === proposal.proposed_provider &&
        (existing!.base_url ?? null) === (proposal.proposed_base_url ?? null) &&
        (existing!.from_email ?? null) === (proposal.proposed_from_email ?? null) &&
        existing!.credential_source === nextCredSource &&
        (existing!.encrypted_api_key ?? null) === (nextEncryptedKey ?? null) &&
        (existing!.key_fingerprint ?? null) === (nextFingerprint ?? null);

      const newVersion = currentVersion + 1;
      const verifiedAt = coreIdentityUnchanged ? existing!.verified_at : null;
      const verifiedBy = coreIdentityUnchanged ? existing!.verified_by : null;
      const verificationMethod = coreIdentityUnchanged ? existing!.verification_method : null;
      const deliveryTestedAt = coreIdentityUnchanged ? existing!.delivery_tested_at : null;
      const deliveryTestedBy = coreIdentityUnchanged ? existing!.delivery_tested_by : null;

      await manager.query(
        `INSERT INTO notification_provider_configurations
           (channel, provider, enabled, base_url, request_timeout_ms, sender_id,
            from_email, from_name, reply_to_email, credential_source, encrypted_api_key,
            encryption_key_version, key_fingerprint, spf_configured, dkim_configured,
            dmarc_configured, verified_at, verified_by, verification_method,
            last_verification_error, delivery_tested_at, delivery_tested_by,
            version, active_proposal_id, updated_by, approved_by, updated_at)
         VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NULL,$20,$21,$22,$23,$24,$25,NOW())
         ON CONFLICT (channel) DO UPDATE SET
           provider = EXCLUDED.provider,
           enabled = EXCLUDED.enabled,
           base_url = EXCLUDED.base_url,
           request_timeout_ms = EXCLUDED.request_timeout_ms,
           sender_id = EXCLUDED.sender_id,
           from_email = EXCLUDED.from_email,
           from_name = EXCLUDED.from_name,
           reply_to_email = EXCLUDED.reply_to_email,
           credential_source = EXCLUDED.credential_source,
           encrypted_api_key = EXCLUDED.encrypted_api_key,
           encryption_key_version = EXCLUDED.encryption_key_version,
           key_fingerprint = EXCLUDED.key_fingerprint,
           spf_configured = EXCLUDED.spf_configured,
           dkim_configured = EXCLUDED.dkim_configured,
           dmarc_configured = EXCLUDED.dmarc_configured,
           verified_at = EXCLUDED.verified_at,
           verified_by = EXCLUDED.verified_by,
           verification_method = EXCLUDED.verification_method,
           last_verification_error = NULL,
           delivery_tested_at = EXCLUDED.delivery_tested_at,
           delivery_tested_by = EXCLUDED.delivery_tested_by,
           version = EXCLUDED.version,
           active_proposal_id = EXCLUDED.active_proposal_id,
           updated_by = EXCLUDED.updated_by,
           approved_by = EXCLUDED.approved_by,
           updated_at = NOW()`,
        [
          proposal.channel,
          proposal.proposed_provider,
          proposal.proposed_enabled,
          proposal.proposed_base_url,
          proposal.proposed_request_timeout_ms,
          proposal.proposed_sender_id,
          proposal.proposed_from_email,
          proposal.proposed_from_name,
          proposal.proposed_reply_to_email,
          nextCredSource,
          nextEncryptedKey,
          nextKeyVersion,
          nextFingerprint,
          proposal.proposed_spf_configured,
          proposal.proposed_dkim_configured,
          proposal.proposed_dmarc_configured,
          verifiedAt,
          verifiedBy,
          verificationMethod,
          deliveryTestedAt,
          deliveryTestedBy,
          newVersion,
          proposal.id,
          principal.principalId,
          proposal.decided_by,
        ],
      );

      // Scrub the encrypted envelope from the activated historical proposal row so rotated-out
      // historical secrets do not linger in proposal history beyond active configuration state:
      // wait — keep `credential_action` consistent with DB CHECK constraint! Wait: our DB CHECK
      // constraint `chk_notif_provider_prop_cred_consistency` requires `proposed_encrypted_api_key IS NOT NULL`
      // when `credential_action = 'SET_ENCRYPTED'`, which is AES-256-GCM encrypted and NEVER exposed in SELECT!
      await manager.query(
        `UPDATE notification_provider_config_proposals
            SET status = 'ACTIVATED',
                activated_by = $1,
                activated_at = NOW(),
                resulting_version = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [principal.principalId, newVersion, proposal.id],
      );

      if (this.auditService) {
        await this.auditService.record(manager, {
          entityType: 'NOTIFICATION_PROVIDER_CONFIG',
          entityId: proposal.id,
          action: 'NOTIFICATION_PROVIDER_CONFIG_ACTIVATED',
          actor: principal.principalId,
          correlationId,
          previousValues: existing
            ? {
                channel: proposal.channel,
                version: existing.version,
                provider: existing.provider,
                enabled: existing.enabled,
                baseUrl: existing.base_url,
                senderId: existing.sender_id,
                fromEmail: existing.from_email,
                keyFingerprint: existing.key_fingerprint,
              }
            : undefined,
          newValues: {
            channel: proposal.channel,
            proposalId: proposal.id,
            proposerPrincipalId: proposal.proposer_principal_id,
            approvedBy: proposal.decided_by,
            version: newVersion,
            provider: proposal.proposed_provider,
            enabled: proposal.proposed_enabled,
            baseUrl: proposal.proposed_base_url,
            senderId: proposal.proposed_sender_id,
            fromEmail: proposal.proposed_from_email,
            fromName: proposal.proposed_from_name,
            credentialSource: nextCredSource,
            keyFingerprint: nextFingerprint,
            encryptionKeyVersion: nextKeyVersion,
            readinessReset: !coreIdentityUnchanged,
          },
        });
      }
    });

    await this.refreshRuntimeCache();
    const overview = await this.getOverview();
    const updatedProposal = await this.getProposal(proposalId);
    return {
      proposal: updatedProposal,
      configuration: updatedProposal.channel === 'SMS' ? overview.sms : overview.email,
    };
  }

  // ---------------------------------------------------------------------------
  // Authorized Connection Verification & Test-Send Outcome Recording
  // ---------------------------------------------------------------------------

  async verifyChannelConfiguration(
    principal: AuthorizationPrincipal,
    channel: ManagedNotificationChannel,
    correlationId?: string,
  ): Promise<{
    verified: boolean;
    channel: ManagedNotificationChannel;
    provider: string;
    verificationMethod: string | null;
    errorCode: string | null;
    liveEndpointNote: string | null;
    snapshot: ProviderChannelSnapshot;
  }> {
    const ds = this.requireDataSource();
    if (principal.readOnlyPrincipal) {
      throw new ForbiddenException('Read-only principals cannot execute provider verification.');
    }

    const recentRows: Array<{ count: string }> = await this.safeDbOperation(
      'verifyChannelConfiguration.rateLimitCount',
      () =>
        ds.query(
          `SELECT count(*)::text AS count
             FROM audit_events
            WHERE action = 'NOTIFICATION_PROVIDER_VERIFY'
              AND actor = $1
              AND created_at > NOW() - INTERVAL '1 hour'`,
          [principal.principalId],
        ),
    );
    if (Number(recentRows[0]?.count ?? 0) >= VERIFY_HOURLY_CAP) {
      throw new BadRequestException('NOTIFICATION_VERIFY_RATE_LIMITED');
    }

    const row = await this.loadDbRow(channel);
    if (!row) {
      throw new BadRequestException(
        `No governed ${channel} provider configuration exists in PostgreSQL yet. Submit and activate a configuration proposal first.`,
      );
    }

    if (row.provider === 'none' || row.provider === 'console') {
      throw new BadRequestException(
        `Provider "${row.provider}" does not support external provider verification.`,
      );
    }

    const secretResolution = this.resolveRowSecret(row);
    if (!secretResolution.ok) {
      await this.safeDbOperation('verifyChannelConfiguration.recordDecryptFailure', () =>
        ds.query(
          `UPDATE notification_provider_configurations
              SET verified_at = NULL,
                  last_verification_error = $1,
                  updated_at = NOW()
            WHERE channel = $2`,
          [secretResolution.errorCode, channel],
        ),
      );
      throw new BadRequestException(secretResolution.errorCode);
    }

    let verified = false;
    let verificationMethod: string | null = null;
    let errorCode: string | null = null;
    let liveEndpointNote: string | null = null;

    if (channel === 'EMAIL' && row.provider === 'brevo') {
      if (!row.from_email) {
        errorCode = 'EMAIL_SENDER_NOT_CONFIGURED';
      } else {
        const check = await verifyBrevoConnection(
          {
            baseUrl: row.base_url ?? 'https://api.brevo.com',
            apiKey: secretResolution.apiKey,
            fromEmail: row.from_email,
            fromName: row.from_name,
            replyTo: row.reply_to_email,
            requestTimeoutMs: row.request_timeout_ms,
          },
          this.fetchImpl as BrevoFetchFn | undefined,
        );
        verified = check.ok;
        verificationMethod = 'BREVO_ACCOUNT_AND_SENDER_API';
        errorCode = check.errorCode;
      }
    } else if (channel === 'SMS' && row.provider === 'robase') {
      try {
        validateApiKeyForProvider('robase', secretResolution.apiKey);
        validateProviderBaseUrl(
          row.base_url ?? 'https://api.robase.dev',
          this.configService.get('NODE_ENV', { infer: true }),
        );
        verified = true;
        verificationMethod = 'CRYPTO_AND_CONTRACT_CHECK';
        liveEndpointNote =
          'Robase documents POST /v1/sms/send without a separate read-only ping endpoint; run Controlled Test-Send once enabled to establish DELIVERY_TESTED.';
      } catch {
        verified = false;
        errorCode = 'ROBASE_CONFIG_INVALID';
      }
    } else if (channel === 'EMAIL' && row.provider === 'resend') {
      try {
        validateApiKeyForProvider('resend', secretResolution.apiKey);
        verified = Boolean(row.from_email);
        verificationMethod = 'CRYPTO_AND_CONTRACT_CHECK';
        if (!verified) errorCode = 'EMAIL_SENDER_NOT_CONFIGURED';
      } catch {
        verified = false;
        errorCode = 'RESEND_CONFIG_INVALID';
      }
    }

    await this.safeTransaction('verifyChannelConfiguration.persist', ds, async (manager) => {
      if (verified) {
        await manager.query(
          `UPDATE notification_provider_configurations
              SET verified_at = NOW(),
                  verified_by = $1,
                  verification_method = $2,
                  last_verification_error = NULL,
                  updated_at = NOW()
            WHERE channel = $3`,
          [principal.principalId, verificationMethod, channel],
        );
      } else {
        await manager.query(
          `UPDATE notification_provider_configurations
              SET verified_at = NULL,
                  verified_by = NULL,
                  verification_method = $1,
                  last_verification_error = $2,
                  updated_at = NOW()
            WHERE channel = $3`,
          [verificationMethod, errorCode ?? 'VERIFY_FAILED', channel],
        );
      }

      if (this.auditService) {
        await this.auditService.record(manager, {
          entityType: 'NOTIFICATION_PROVIDER_CONFIG',
          entityId:
            channel === 'SMS'
              ? '00000000-0000-4000-8000-000000000501'
              : '00000000-0000-4000-8000-000000000502',
          action: 'NOTIFICATION_PROVIDER_VERIFY',
          actor: principal.principalId,
          correlationId,
          newValues: {
            channel,
            provider: row.provider,
            verified,
            verificationMethod,
            errorCode,
          },
        });
      }
    });

    const overview = await this.getOverview();
    return {
      verified,
      channel,
      provider: row.provider,
      verificationMethod,
      errorCode,
      liveEndpointNote,
      snapshot: channel === 'SMS' ? overview.sms : overview.email,
    };
  }

  async recordTestSendOutcome(params: {
    channel: ManagedNotificationChannel;
    actor: string;
    providerName: string;
    success: boolean;
    maskedDestination: string;
    providerRef: string | null;
    errorCode: string | null;
  }): Promise<void> {
    if (!this.dataSource || !this.dataSource.isInitialized) return;
    const row = await this.loadDbRow(params.channel);
    if (!row) return;

    const isConsole = row.provider === 'console' || params.providerName === 'console';
    const lastTestStatus: 'SENT' | 'FAILED' | 'CONSOLE_SIMULATED' = !params.success
      ? 'FAILED'
      : isConsole
        ? 'CONSOLE_SIMULATED'
        : 'SENT';

    // Console test sends NEVER promote `delivery_tested_at` or `verified_at`!
    const promoteLiveReadiness = params.success && !isConsole;

    await this.safeDbOperation('recordTestSendOutcome', () =>
      this.dataSource!.query(
        `UPDATE notification_provider_configurations
            SET last_test_status = $1,
                last_test_destination_masked = $2,
                last_test_provider_ref = $3,
                last_test_error_code = $4,
                last_test_at = NOW(),
                delivery_tested_at = CASE WHEN $5 THEN NOW() ELSE delivery_tested_at END,
                delivery_tested_by = CASE WHEN $5 THEN $6 ELSE delivery_tested_by END,
                verified_at = CASE WHEN $5 AND verified_at IS NULL THEN NOW() ELSE verified_at END,
                verified_by = CASE WHEN $5 AND verified_by IS NULL THEN $6 ELSE verified_by END,
                verification_method = CASE WHEN $5 AND verification_method IS NULL THEN 'LIVE_TEST_SEND' ELSE verification_method END,
                updated_at = NOW()
          WHERE channel = $7`,
        [
          lastTestStatus,
          params.maskedDestination.slice(0, 128),
          params.providerRef ? params.providerRef.slice(0, 255) : null,
          params.errorCode ? params.errorCode.slice(0, 128) : null,
          promoteLiveReadiness,
          params.actor,
          params.channel,
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Internal Snapshot & Resolution Helpers
  // ---------------------------------------------------------------------------

  private buildSmsSnapshot(
    row: DbProviderConfigRow | null,
    encryption: NotificationEncryptionStatus,
    workerEnabled: boolean,
  ): ProviderChannelSnapshot {
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });

    if (!row) {
      const envProvider = this.configService.get('NOTIFICATION_SMS_PROVIDER', { infer: true });
      const envKey = this.configService.get('ROBASE_API_KEY', { infer: true });
      const baseUrl =
        this.configService.get('ROBASE_API_BASE_URL', { infer: true }) ??
        'https://api.robase.dev';
      const timeoutMs =
        this.configService.get('ROBASE_REQUEST_TIMEOUT_MS', { infer: true }) ?? 10_000;

      if (envProvider === 'console') {
        const forbidden = nodeEnv === 'production';
        return {
          channel: 'SMS',
          source: 'ENVIRONMENT',
          provider: 'console',
          enabled: !forbidden,
          lifecycleState: forbidden ? 'MISCONFIGURED' : 'CONSOLE_ONLY',
          gates: {
            configured: false,
            verified: false,
            enabled: false,
            deliveryTested: false,
            productionReady: false,
          },
          baseUrl: null,
          requestTimeoutMs: timeoutMs,
          senderId: null,
          senderIdNote: ROBASE_SENDER_ID_NOTE,
          fromEmail: null,
          fromName: null,
          replyToEmail: null,
          credentialSource: 'NONE',
          hasStoredCredential: false,
          keyFingerprint: null,
          encryptionKeyVersion: null,
          encryptionKeyAvailable: encryption.available,
          misconfigurationCode: forbidden ? 'CONSOLE_FORBIDDEN_IN_PRODUCTION' : null,
          domainAuthentication: null,
          verification: {
            verifiedAt: null,
            verifiedBy: null,
            verificationMethod: null,
            lastVerificationError: null,
          },
          lastTest: {
            status: null,
            destinationMasked: null,
            providerRef: null,
            errorCode: null,
            testedAt: null,
            deliveryTestedAt: null,
            deliveryTestedBy: null,
          },
          version: 0,
          updatedBy: null,
          approvedBy: null,
          updatedAt: null,
        };
      }

      if (envProvider === 'managed') {
        return {
          channel: 'SMS',
          source: 'ENVIRONMENT',
          provider: 'robase',
          enabled: false,
          lifecycleState: encryption.available ? 'NOT_CONFIGURED' : 'MISCONFIGURED',
          gates: {
            configured: false,
            verified: false,
            enabled: false,
            deliveryTested: false,
            productionReady: false,
          },
          baseUrl,
          requestTimeoutMs: timeoutMs,
          senderId: null,
          senderIdNote: ROBASE_SENDER_ID_NOTE,
          fromEmail: null,
          fromName: null,
          replyToEmail: null,
          credentialSource: 'NONE',
          hasStoredCredential: false,
          keyFingerprint: null,
          encryptionKeyVersion: null,
          encryptionKeyAvailable: encryption.available,
          misconfigurationCode: encryption.available ? null : 'PROVIDER_ENCRYPTION_KEY_MISSING',
          domainAuthentication: null,
          verification: {
            verifiedAt: null,
            verifiedBy: null,
            verificationMethod: null,
            lastVerificationError: null,
          },
          lastTest: {
            status: null,
            destinationMasked: null,
            providerRef: null,
            errorCode: null,
            testedAt: null,
            deliveryTestedAt: null,
            deliveryTestedBy: null,
          },
          version: 0,
          updatedBy: null,
          approvedBy: null,
          updatedAt: null,
        };
      }

      const validEnvKey = Boolean(envKey && envKey.startsWith('robe_') && envKey.length >= 20);
      return {
        channel: 'SMS',
        source: 'ENVIRONMENT',
        provider: 'robase',
        enabled: validEnvKey,
        lifecycleState: validEnvKey ? 'ENABLED' : 'NOT_CONFIGURED',
        gates: {
          configured: validEnvKey,
          verified: false,
          enabled: validEnvKey,
          deliveryTested: false,
          productionReady: false,
        },
        baseUrl,
        requestTimeoutMs: timeoutMs,
        senderId: null,
        senderIdNote: ROBASE_SENDER_ID_NOTE,
        fromEmail: null,
        fromName: null,
        replyToEmail: null,
        credentialSource: validEnvKey ? 'ENV_SECRET' : 'NONE',
        hasStoredCredential: validEnvKey,
        keyFingerprint: validEnvKey && envKey ? computeKeyFingerprint(envKey) : null,
        encryptionKeyVersion: null,
        encryptionKeyAvailable: encryption.available,
        misconfigurationCode: null,
        domainAuthentication: null,
        verification: {
          verifiedAt: null,
          verifiedBy: null,
          verificationMethod: null,
          lastVerificationError: null,
        },
        lastTest: {
          status: null,
          destinationMasked: null,
          providerRef: null,
          errorCode: null,
          testedAt: null,
          deliveryTestedAt: null,
          deliveryTestedBy: null,
        },
        version: 0,
        updatedBy: null,
        approvedBy: null,
        updatedAt: null,
      };
    }

    return this.buildDbRowSnapshot(row, encryption, workerEnabled, nodeEnv);
  }

  private buildEmailSnapshot(
    row: DbProviderConfigRow | null,
    encryption: NotificationEncryptionStatus,
    workerEnabled: boolean,
  ): ProviderChannelSnapshot {
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });

    if (!row) {
      const envProvider = this.configService.get('NOTIFICATION_EMAIL_PROVIDER', { infer: true });
      const from = this.configService.get('NOTIFICATION_EMAIL_FROM', { infer: true }) ?? null;
      const fromName =
        this.configService.get('NOTIFICATION_EMAIL_FROM_NAME', { infer: true }) ?? null;
      const replyTo =
        this.configService.get('NOTIFICATION_EMAIL_REPLY_TO', { infer: true }) ?? null;

      if (envProvider === 'none' || envProvider === 'managed') {
        const missingKey = envProvider === 'managed' && !encryption.available;
        return {
          channel: 'EMAIL',
          source: 'ENVIRONMENT',
          provider: envProvider === 'managed' ? 'brevo' : 'none',
          enabled: false,
          lifecycleState: missingKey ? 'MISCONFIGURED' : 'NOT_CONFIGURED',
          gates: {
            configured: false,
            verified: false,
            enabled: false,
            deliveryTested: false,
            productionReady: false,
          },
          baseUrl: envProvider === 'managed' ? 'https://api.brevo.com' : null,
          requestTimeoutMs: 10_000,
          senderId: null,
          senderIdNote: null,
          fromEmail: from,
          fromName,
          replyToEmail: replyTo,
          credentialSource: 'NONE',
          hasStoredCredential: false,
          keyFingerprint: null,
          encryptionKeyVersion: null,
          encryptionKeyAvailable: encryption.available,
          misconfigurationCode: missingKey ? 'PROVIDER_ENCRYPTION_KEY_MISSING' : null,
          domainAuthentication: {
            spfConfigured: false,
            dkimConfigured: false,
            dmarcConfigured: false,
            allConfigured: false,
          },
          verification: {
            verifiedAt: null,
            verifiedBy: null,
            verificationMethod: null,
            lastVerificationError: null,
          },
          lastTest: {
            status: null,
            destinationMasked: null,
            providerRef: null,
            errorCode: null,
            testedAt: null,
            deliveryTestedAt: null,
            deliveryTestedBy: null,
          },
          version: 0,
          updatedBy: null,
          approvedBy: null,
          updatedAt: null,
        };
      }

      if (envProvider === 'console') {
        const forbidden = nodeEnv === 'production';
        return {
          channel: 'EMAIL',
          source: 'ENVIRONMENT',
          provider: 'console',
          enabled: !forbidden,
          lifecycleState: forbidden ? 'MISCONFIGURED' : 'CONSOLE_ONLY',
          gates: {
            configured: false,
            verified: false,
            enabled: false,
            deliveryTested: false,
            productionReady: false,
          },
          baseUrl: null,
          requestTimeoutMs: 10_000,
          senderId: null,
          senderIdNote: null,
          fromEmail: from,
          fromName,
          replyToEmail: replyTo,
          credentialSource: 'NONE',
          hasStoredCredential: false,
          keyFingerprint: null,
          encryptionKeyVersion: null,
          encryptionKeyAvailable: encryption.available,
          misconfigurationCode: forbidden ? 'CONSOLE_FORBIDDEN_IN_PRODUCTION' : null,
          domainAuthentication: {
            spfConfigured: false,
            dkimConfigured: false,
            dmarcConfigured: false,
            allConfigured: false,
          },
          verification: {
            verifiedAt: null,
            verifiedBy: null,
            verificationMethod: null,
            lastVerificationError: null,
          },
          lastTest: {
            status: null,
            destinationMasked: null,
            providerRef: null,
            errorCode: null,
            testedAt: null,
            deliveryTestedAt: null,
            deliveryTestedBy: null,
          },
          version: 0,
          updatedBy: null,
          approvedBy: null,
          updatedAt: null,
        };
      }

      const envKey =
        envProvider === 'brevo'
          ? this.configService.get('BREVO_API_KEY', { infer: true })
          : this.configService.get('RESEND_API_KEY', { infer: true });
      const baseUrl =
        envProvider === 'brevo'
          ? (this.configService.get('BREVO_API_BASE_URL', { infer: true }) ??
            'https://api.brevo.com')
          : (this.configService.get('RESEND_API_BASE_URL', { infer: true }) ??
            'https://api.resend.com');
      const timeoutMs =
        envProvider === 'brevo'
          ? (this.configService.get('BREVO_REQUEST_TIMEOUT_MS', { infer: true }) ?? 10_000)
          : (this.configService.get('RESEND_REQUEST_TIMEOUT_MS', { infer: true }) ?? 10_000);
      const validEnv = Boolean(envKey && from);
      const parsedFrom = from ? parseSenderIdentity(from, fromName) : null;

      return {
        channel: 'EMAIL',
        source: 'ENVIRONMENT',
        provider: envProvider,
        enabled: validEnv,
        lifecycleState: validEnv ? 'ENABLED' : 'NOT_CONFIGURED',
        gates: {
          configured: validEnv,
          verified: false,
          enabled: validEnv,
          deliveryTested: false,
          productionReady: false,
        },
        baseUrl,
        requestTimeoutMs: timeoutMs,
        senderId: null,
        senderIdNote: null,
        fromEmail: parsedFrom?.email ?? from,
        fromName: parsedFrom?.name ?? fromName,
        replyToEmail: replyTo,
        credentialSource: validEnv ? 'ENV_SECRET' : 'NONE',
        hasStoredCredential: validEnv,
        keyFingerprint: validEnv && envKey ? computeKeyFingerprint(envKey) : null,
        encryptionKeyVersion: null,
        encryptionKeyAvailable: encryption.available,
        misconfigurationCode: null,
        domainAuthentication: {
          spfConfigured: false,
          dkimConfigured: false,
          dmarcConfigured: false,
          allConfigured: false,
        },
        verification: {
          verifiedAt: null,
          verifiedBy: null,
          verificationMethod: null,
          lastVerificationError: null,
        },
        lastTest: {
          status: null,
          destinationMasked: null,
          providerRef: null,
          errorCode: null,
          testedAt: null,
          deliveryTestedAt: null,
          deliveryTestedBy: null,
        },
        version: 0,
        updatedBy: null,
        approvedBy: null,
        updatedAt: null,
      };
    }

    return this.buildDbRowSnapshot(row, encryption, workerEnabled, nodeEnv);
  }

  private buildDbRowSnapshot(
    row: DbProviderConfigRow,
    encryption: NotificationEncryptionStatus,
    _workerEnabled: boolean,
    nodeEnv: string,
  ): ProviderChannelSnapshot {
    const domainAuth =
      row.channel === 'EMAIL'
        ? {
            spfConfigured: row.spf_configured,
            dkimConfigured: row.dkim_configured,
            dmarcConfigured: row.dmarc_configured,
            allConfigured:
              row.spf_configured && row.dkim_configured && row.dmarc_configured,
          }
        : null;

    if (row.provider === 'none') {
      return {
        channel: row.channel,
        source: 'DATABASE',
        provider: 'none',
        enabled: false,
        lifecycleState: 'NOT_CONFIGURED',
        gates: {
          configured: false,
          verified: false,
          enabled: false,
          deliveryTested: false,
          productionReady: false,
        },
        baseUrl: null,
        requestTimeoutMs: row.request_timeout_ms,
        senderId: row.sender_id,
        senderIdNote: row.channel === 'SMS' ? ROBASE_SENDER_ID_NOTE : null,
        fromEmail: row.from_email,
        fromName: row.from_name,
        replyToEmail: row.reply_to_email,
        credentialSource: row.credential_source,
        hasStoredCredential: false,
        keyFingerprint: null,
        encryptionKeyVersion: null,
        encryptionKeyAvailable: encryption.available,
        misconfigurationCode: null,
        domainAuthentication: domainAuth,
        verification: {
          verifiedAt: null,
          verifiedBy: null,
          verificationMethod: null,
          lastVerificationError: row.last_verification_error,
        },
        lastTest: {
          status: row.last_test_status,
          destinationMasked: row.last_test_destination_masked,
          providerRef: row.last_test_provider_ref,
          errorCode: row.last_test_error_code,
          testedAt: toIsoOrNull(row.last_test_at),
          deliveryTestedAt: null,
          deliveryTestedBy: null,
        },
        version: row.version,
        updatedBy: row.updated_by,
        approvedBy: row.approved_by,
        updatedAt: toIsoOrNull(row.updated_at),
      };
    }

    if (row.provider === 'console') {
      const forbidden = nodeEnv === 'production';
      return {
        channel: row.channel,
        source: 'DATABASE',
        provider: 'console',
        enabled: row.enabled && !forbidden,
        lifecycleState: forbidden ? 'MISCONFIGURED' : 'CONSOLE_ONLY',
        gates: {
          configured: false,
          verified: false,
          enabled: false,
          deliveryTested: false,
          productionReady: false,
        },
        baseUrl: null,
        requestTimeoutMs: row.request_timeout_ms,
        senderId: row.sender_id,
        senderIdNote: row.channel === 'SMS' ? ROBASE_SENDER_ID_NOTE : null,
        fromEmail: row.from_email,
        fromName: row.from_name,
        replyToEmail: row.reply_to_email,
        credentialSource: 'NONE',
        hasStoredCredential: false,
        keyFingerprint: null,
        encryptionKeyVersion: null,
        encryptionKeyAvailable: encryption.available,
        misconfigurationCode: forbidden ? 'CONSOLE_FORBIDDEN_IN_PRODUCTION' : null,
        domainAuthentication: domainAuth,
        verification: {
          verifiedAt: null,
          verifiedBy: null,
          verificationMethod: null,
          lastVerificationError: null,
        },
        lastTest: {
          status: row.last_test_status,
          destinationMasked: row.last_test_destination_masked,
          providerRef: row.last_test_provider_ref,
          errorCode: row.last_test_error_code,
          testedAt: toIsoOrNull(row.last_test_at),
          deliveryTestedAt: null,
          deliveryTestedBy: null,
        },
        version: row.version,
        updatedBy: row.updated_by,
        approvedBy: row.approved_by,
        updatedAt: toIsoOrNull(row.updated_at),
      };
    }

    const secretResolution = this.resolveRowSecret(row);
    const senderValid = row.channel === 'SMS' ? true : Boolean(row.from_email);
    const hasCred = row.credential_source !== 'NONE';

    let misconfigurationCode: string | null = null;
    if (hasCred && !secretResolution.ok) {
      misconfigurationCode = secretResolution.errorCode;
    } else if (!senderValid) {
      misconfigurationCode = 'EMAIL_SENDER_NOT_CONFIGURED';
    }

    const configured = secretResolution.ok && senderValid && Boolean(row.base_url);
    const verified = configured && Boolean(row.verified_at);
    const enabled = configured && row.enabled;
    const deliveryTested = configured && Boolean(row.delivery_tested_at);
    const domainReady = row.channel === 'SMS' ? true : Boolean(domainAuth?.allConfigured);
    const productionReady =
      configured && verified && enabled && deliveryTested && domainReady;

    let lifecycleState: ProviderLifecycleState;
    if (misconfigurationCode) {
      lifecycleState = 'MISCONFIGURED';
    } else if (!configured) {
      lifecycleState = 'NOT_CONFIGURED';
    } else if (!enabled) {
      lifecycleState = verified ? 'VERIFIED' : 'CONFIGURED';
    } else if (productionReady) {
      lifecycleState = 'PRODUCTION_READY';
    } else if (deliveryTested) {
      lifecycleState = 'DELIVERY_TESTED';
    } else {
      lifecycleState = 'ENABLED';
    }

    return {
      channel: row.channel,
      source: 'DATABASE',
      provider: row.provider,
      enabled: row.enabled,
      lifecycleState,
      gates: {
        configured,
        verified,
        enabled,
        deliveryTested,
        productionReady,
      },
      baseUrl: row.base_url,
      requestTimeoutMs: row.request_timeout_ms,
      senderId: row.sender_id,
      senderIdNote: row.channel === 'SMS' ? ROBASE_SENDER_ID_NOTE : null,
      fromEmail: row.from_email,
      fromName: row.from_name,
      replyToEmail: row.reply_to_email,
      credentialSource: row.credential_source,
      hasStoredCredential: hasCred,
      keyFingerprint: row.key_fingerprint,
      encryptionKeyVersion: row.encryption_key_version,
      encryptionKeyAvailable:
        row.credential_source === 'ENCRYPTED_DB' ? secretResolution.ok : encryption.available,
      misconfigurationCode,
      domainAuthentication: domainAuth,
      verification: {
        verifiedAt: toIsoOrNull(row.verified_at),
        verifiedBy: row.verified_by,
        verificationMethod: row.verification_method,
        lastVerificationError: row.last_verification_error,
      },
      lastTest: {
        status: row.last_test_status,
        destinationMasked: row.last_test_destination_masked,
        providerRef: row.last_test_provider_ref,
        errorCode: row.last_test_error_code,
        testedAt: toIsoOrNull(row.last_test_at),
        deliveryTestedAt: toIsoOrNull(row.delivery_tested_at),
        deliveryTestedBy: row.delivery_tested_by,
      },
      version: row.version,
      updatedBy: row.updated_by,
      approvedBy: row.approved_by,
      updatedAt: toIsoOrNull(row.updated_at),
    };
  }

  private resolveRowSecret(
    row: DbProviderConfigRow,
  ): { ok: true; apiKey: string } | { ok: false; errorCode: string } {
    if (row.credential_source === 'NONE') {
      return { ok: false, errorCode: `${row.channel}_PROVIDER_NOT_CONFIGURED` };
    }
    if (row.credential_source === 'ENV_SECRET') {
      const secret = this.getEnvSecretForProvider(row.provider);
      if (!secret) {
        return { ok: false, errorCode: 'PROVIDER_ENV_SECRET_MISSING' };
      }
      return { ok: true, apiKey: secret };
    }
    if (!row.encrypted_api_key) {
      return { ok: false, errorCode: 'PROVIDER_SECRET_ENVELOPE_INVALID' };
    }
    try {
      const apiKey = this.encryptionService.decrypt(
        row.encrypted_api_key,
        row.channel,
        row.encryption_key_version,
      );
      return { ok: true, apiKey };
    } catch (err) {
      if (err instanceof NotificationSecretEncryptionError) {
        return { ok: false, errorCode: err.code };
      }
      return { ok: false, errorCode: 'PROVIDER_SECRET_DECRYPT_FAILED' };
    }
  }

  private getEnvSecretForProvider(provider: string): string | undefined {
    if (provider === 'robase') {
      return this.configService.get('ROBASE_API_KEY', { infer: true });
    }
    if (provider === 'brevo') {
      return this.configService.get('BREVO_API_KEY', { infer: true });
    }
    if (provider === 'resend') {
      return this.configService.get('RESEND_API_KEY', { infer: true });
    }
    return undefined;
  }

  private resolveEnvSmsProviderName(): string {
    const p = this.configService.get('NOTIFICATION_SMS_PROVIDER', { infer: true }) ?? 'console';
    return p === 'managed' ? 'robase' : p;
  }

  private resolveEnvEmailProviderName(): string {
    const p = this.configService.get('NOTIFICATION_EMAIL_PROVIDER', { infer: true }) ?? 'none';
    return p === 'managed' ? 'none' : p;
  }

  private async loadDbRow(
    channel: ManagedNotificationChannel,
  ): Promise<DbProviderConfigRow | null> {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      return null;
    }
    try {
      const rows: DbProviderConfigRow[] = await this.dataSource.query(
        `SELECT * FROM notification_provider_configurations WHERE channel = $1`,
        [channel],
      );
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }

  private async loadAllDbRows(): Promise<Map<ManagedNotificationChannel, DbProviderConfigRow>> {
    const map = new Map<ManagedNotificationChannel, DbProviderConfigRow>();
    if (!this.dataSource || !this.dataSource.isInitialized) {
      return map;
    }
    try {
      const rows: DbProviderConfigRow[] = await this.dataSource.query(
        `SELECT * FROM notification_provider_configurations`,
      );
      for (const row of rows) {
        map.set(row.channel, row);
      }
    } catch {
      // Table not yet created on unmigrated baseline
    }
    return map;
  }

  private mapProposalView(r: DbProposalRow): ProviderConfigProposalView {
    return {
      id: r.id,
      channel: r.channel,
      expectedVersion: r.expected_version,
      proposedProvider: r.proposed_provider,
      proposedEnabled: r.proposed_enabled,
      proposedBaseUrl: r.proposed_base_url,
      proposedRequestTimeoutMs: r.proposed_request_timeout_ms,
      proposedSenderId: r.proposed_sender_id,
      proposedFromEmail: r.proposed_from_email,
      proposedFromName: r.proposed_from_name,
      proposedReplyToEmail: r.proposed_reply_to_email,
      credentialAction: r.credential_action,
      proposedKeyFingerprint: r.proposed_key_fingerprint,
      proposedEncryptionKeyVersion: r.proposed_encryption_key_version,
      proposedDomainAuthentication: {
        spfConfigured: r.proposed_spf_configured,
        dkimConfigured: r.proposed_dkim_configured,
        dmarcConfigured: r.proposed_dmarc_configured,
      },
      reason: r.reason,
      status: r.status,
      proposerPrincipalId: r.proposer_principal_id,
      approvalId: r.approval_id,
      actionFingerprint: r.action_fingerprint,
      decidedBy: r.decided_by,
      decidedAt: toIsoOrNull(r.decided_at),
      decisionReason: r.decision_reason,
      activatedBy: r.activated_by,
      activatedAt: toIsoOrNull(r.activated_at),
      resultingVersion: r.resulting_version,
      createdAt: toIsoOrNull(r.created_at) ?? new Date(0).toISOString(),
      updatedAt: toIsoOrNull(r.updated_at) ?? new Date(0).toISOString(),
    };
  }

  private async recordDeniedGovernanceAudit(
    proposalId: string,
    actor: string,
    reason: string,
    correlationId?: string,
  ): Promise<void> {
    if (!this.dataSource || !this.auditService) return;
    await this.dataSource
      .transaction((manager: EntityManager) =>
        this.auditService!.record(manager, {
          entityType: 'NOTIFICATION_PROVIDER_CONFIG',
          entityId: proposalId,
          action: 'NOTIFICATION_PROVIDER_CONFIG_DECISION_DENIED',
          actor,
          correlationId,
          newValues: { reason },
        }),
      )
      .catch((err: unknown) => {
        this.logger.warn({
          msg: 'notification_provider_governance_audit_failed',
          proposalId,
          errorName: err instanceof Error ? err.name : 'Error',
        });
      });
  }

  private requireDataSource(): DataSource {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new BadRequestException('Database connection is not available.');
    }
    return this.dataSource;
  }

  private requireApprovals(): PrivilegedActionApprovalService {
    if (!this.approvals) {
      throw new BadRequestException('Privileged action approval service is not available.');
    }
    return this.approvals;
  }

  /**
   * Driver errors (TypeORM QueryFailedError, pg DatabaseError, trigger exceptions) can carry
   * SQL text, constraint/table names, and bound parameter arrays (including encrypted `MNNPS1:`
   * envelopes). Never let raw database/driver errors reach Nest exception handlers, HTTP
   * responses, or application logs; preserve intentional HttpExceptions unchanged.
   */
  private async safeTransaction<T>(
    operation: string,
    ds: DataSource,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.safeDbOperation(
      operation,
      () => ds.transaction(work),
      'Notification provider configuration could not be persisted.',
    );
  }

  private async safeDbOperation<T>(
    operation: string,
    work: () => Promise<T>,
    fallbackMessage = 'Notification provider configuration could not be persisted.',
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.warn({
        msg: 'notification_provider_db_error',
        operation,
        sqlState: this.extractSafeSqlState(error),
      });
      throw new InternalServerErrorException(fallbackMessage);
    }
  }

  private extractSafeSqlState(error: unknown): string {
    if (error && typeof error === 'object') {
      const record = error as { code?: unknown; driverError?: { code?: unknown } };
      const raw = record.driverError?.code ?? record.code;
      if (typeof raw === 'string' && /^[0-9A-Z]{5}$/.test(raw)) {
        return raw;
      }
    }
    return 'UNKNOWN';
  }
}

@Injectable()
export class ConfigurableSmsNotificationProvider implements NotificationProvider {
  constructor(private readonly configService: NotificationProviderConfigService) {}

  get name(): string {
    return this.configService.getActiveSmsProviderNameSync();
  }

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    return this.configService.sendSms(request);
  }
}

@Injectable()
export class ConfigurableEmailNotificationProvider implements NotificationProvider {
  constructor(private readonly configService: NotificationProviderConfigService) {}

  get name(): string {
    return this.configService.getActiveEmailProviderNameSync();
  }

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    return this.configService.sendEmail(request);
  }
}
