import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Logger,
  Optional,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type {
  AuthorizationDenialReason,
  AuthorizationPrincipal,
  AuthorizationPrincipalType,
} from '../authorization/authorization.types';
import {
  NOTIFICATION_EMAIL_PROVIDER_TOKEN,
  NOTIFICATION_PROVIDER_TOKEN,
} from '../notification/notification.constants';
import { renderEmailLayout } from '../notification/notification-email-template.service';
import { NotificationProviderConfigService } from '../notification/notification-provider-config.service';
import type {
  NotificationProvider,
  NotificationSendResult,
} from '../notification/notification.types';
import { normalizeProviderErrorCode } from '../notification/provider-security';
import { AuditService } from '../operations/audit.service';

interface AuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const TEST_SEND_HOURLY_LIMIT = 5;
const WORKFORCE_PRINCIPAL_TYPES: readonly AuthorizationPrincipalType[] = [
  'SUPPORT',
  'OPERATOR',
  'SERVICE',
  'PRIVILEGED',
];
const SQL_STATE_PATTERN = /^[0-9A-Z]{5}$/;

/** Conservative email shape: single address, no whitespace/quotes/brackets/semicolons/commas. */
const TEST_EMAIL_PATTERN = /^[^@\s,;"'<>()\\]+@[^@\s,;"'<>()\\]+\.[^@\s,;"'<>()\\]{2,63}$/;
/** E.164-ish shape matching the existing SMS provider posture. */
const TEST_SMS_PATTERN = /^\+?[1-9]\d{7,14}$/;

function maskEmail(value: string): string {
  const [local, domain] = value.split('@');
  const keep = Math.min(2, (local ?? '').length);
  return `${(local ?? '').slice(0, keep)}***@${domain ?? ''}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const keep = Math.min(3, digits.length);
  return `${value.slice(0, value.length - keep).replace(/\d/g, '*')}${digits.slice(-keep)}`;
}

function keyFingerprint(key: string | undefined): string | null {
  if (!key) return null;
  return `****${key.slice(-4)}`;
}

function extractSqlState(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; driverError?: { code?: unknown } };
    const raw = record.driverError?.code ?? record.code;
    if (typeof raw === 'string' && SQL_STATE_PATTERN.test(raw)) {
      return raw;
    }
  }
  return 'UNKNOWN';
}

@Controller('internal/notifications')
export class AdminNotificationProviderController {
  private readonly logger = new Logger(AdminNotificationProviderController.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly auth: AuthorizationService,
    @Inject(NOTIFICATION_PROVIDER_TOKEN) private readonly smsProvider: NotificationProvider,
    @Inject(NOTIFICATION_EMAIL_PROVIDER_TOKEN) private readonly emailProvider: NotificationProvider,
    @Optional() private readonly providerConfigService?: NotificationProviderConfigService,
  ) {}

  /**
   * GET /internal/notifications/provider-status
   * Read-only, non-secret snapshot of notification provider configuration + worker tuning.
   *
   * Authorization & projection tiers (enforced and audited via AuthorizationService):
   *   - `notification.provider.view` (`projectionScope: 'FULL'`): full non-secret operational
   *     configuration snapshot (masked key fingerprints, sender config, base URLs, domain auth,
   *     lastTest metadata, worker tuning).
   *   - `notification.view_deliveries` without `notification.provider.view`
   *     (`projectionScope: 'MINIMAL'`): coarse channel dispatch availability booleans ONLY;
   *     omits provider identity, enabled/configured/tested gates, lifecycle state, key
   *     fingerprints, sender configuration, lastTest details, base URLs, and worker state.
   */
  @Get('provider-status')
  async providerStatus(@Req() req: AuthenticatedRequest) {
    const { hasProviderView } = await this.authorizeProviderStatus(req);

    if (this.providerConfigService) {
      const overview = await this.providerConfigService.getOverview();
      if (!hasProviderView) {
        const smsAvailable = Boolean(
          overview.sms.enabled &&
            (overview.sms.provider === 'console' || overview.sms.gates.configured) &&
            !overview.sms.misconfigurationCode,
        );
        const emailAvailable = Boolean(
          overview.email.enabled &&
            overview.email.provider !== 'none' &&
            (overview.email.provider === 'console' || overview.email.gates.configured) &&
            !overview.email.misconfigurationCode,
        );
        return {
          channels: ['SMS', 'PUSH', 'EMAIL'],
          projectionScope: 'MINIMAL',
          sms: {
            available: smsAvailable,
          },
          push: {
            available: false,
          },
          email: {
            available: emailAvailable,
          },
        };
      }

      return {
        channels: ['SMS', 'PUSH', 'EMAIL'],
        projectionScope: 'FULL',
        sms: {
          provider: overview.sms.provider,
          source: overview.sms.source,
          enabled: overview.sms.enabled,
          baseUrl: overview.sms.baseUrl,
          configured: overview.sms.gates.configured,
          verified: overview.sms.gates.verified,
          deliveryTested: overview.sms.gates.deliveryTested,
          productionReady: overview.sms.gates.productionReady,
          lifecycleState: overview.sms.lifecycleState,
          gates: overview.sms.gates,
          senderId: overview.sms.senderId,
          keyFingerprint: overview.sms.keyFingerprint,
          timeoutMs: overview.sms.requestTimeoutMs,
          encryptionKeyAvailable: overview.sms.encryptionKeyAvailable,
          misconfigurationCode: normalizeProviderErrorCode(overview.sms.misconfigurationCode),
          lastTest: overview.sms.lastTest
            ? {
                ...overview.sms.lastTest,
                errorCode: normalizeProviderErrorCode(overview.sms.lastTest.errorCode),
              }
            : overview.sms.lastTest,
        },
        email: {
          provider: overview.email.provider,
          source: overview.email.source,
          enabled: overview.email.enabled,
          baseUrl: overview.email.baseUrl,
          configured: overview.email.gates.configured,
          verified: overview.email.gates.verified,
          deliveryTested: overview.email.gates.deliveryTested,
          productionReady: overview.email.gates.productionReady,
          lifecycleState: overview.email.lifecycleState,
          gates: overview.email.gates,
          keyFingerprint: overview.email.keyFingerprint,
          from: overview.email.fromEmail,
          fromName: overview.email.fromName,
          replyTo: overview.email.replyToEmail,
          timeoutMs: overview.email.requestTimeoutMs,
          encryptionKeyAvailable: overview.email.encryptionKeyAvailable,
          misconfigurationCode: normalizeProviderErrorCode(overview.email.misconfigurationCode),
          domainAuth: overview.email.domainAuthentication,
          lastTest: overview.email.lastTest
            ? {
                ...overview.email.lastTest,
                errorCode: normalizeProviderErrorCode(overview.email.lastTest.errorCode),
              }
            : overview.email.lastTest,
        },
        worker: {
          enabled: overview.worker.enabled,
          pollIntervalMs: overview.worker.pollIntervalMs,
          batchSize: overview.worker.batchSize,
          retryMaxAttempts: overview.worker.smsRetryMaxAttempts,
          retryBaseDelaySeconds: overview.worker.smsRetryBaseDelaySeconds,
        },
      };
    }

    const smsProviderName = this.configService.get<string>('NOTIFICATION_SMS_PROVIDER') ?? 'console';
    const emailProviderName =
      this.configService.get<string>('NOTIFICATION_EMAIL_PROVIDER') ?? 'none';
    const robaseKey = this.configService.get<string>('ROBASE_API_KEY');
    const brevoKey = this.configService.get<string>('BREVO_API_KEY');
    const resendKey = this.configService.get<string>('RESEND_API_KEY');
    const smsConfigured = smsProviderName === 'robase' && Boolean(robaseKey);
    const emailConfigured =
      (emailProviderName === 'brevo' &&
        Boolean(brevoKey) &&
        Boolean(this.configService.get<string>('NOTIFICATION_EMAIL_FROM'))) ||
      (emailProviderName === 'resend' &&
        Boolean(resendKey) &&
        Boolean(this.configService.get<string>('NOTIFICATION_EMAIL_FROM')));
    const workerEnabled = this.configService.get<boolean>('NOTIFICATION_WORKER_ENABLED') === true;

    if (!hasProviderView) {
      return {
        channels: ['SMS', 'PUSH', 'EMAIL'],
        projectionScope: 'MINIMAL',
        sms: {
          available: smsProviderName === 'console' || smsConfigured,
        },
        push: {
          available: false,
        },
        email: {
          available: emailProviderName === 'console' || emailConfigured,
        },
      };
    }

    return {
      channels: ['SMS', 'PUSH', 'EMAIL'],
      projectionScope: 'FULL',
      sms: {
        provider: smsProviderName,
        baseUrl: this.configService.get<string>('ROBASE_API_BASE_URL') ?? null,
        configured: smsConfigured,
        keyFingerprint: keyFingerprint(robaseKey),
        timeoutMs: this.configService.get<number>('ROBASE_REQUEST_TIMEOUT_MS') ?? null,
      },
      email: {
        provider: emailProviderName,
        baseUrl:
          emailProviderName === 'brevo'
            ? (this.configService.get<string>('BREVO_API_BASE_URL') ?? null)
            : emailProviderName === 'resend'
              ? (this.configService.get<string>('RESEND_API_BASE_URL') ?? null)
              : null,
        configured: emailConfigured,
        keyFingerprint:
          emailProviderName === 'brevo' ? keyFingerprint(brevoKey) : keyFingerprint(resendKey),
        from: this.configService.get<string>('NOTIFICATION_EMAIL_FROM') ?? null,
        replyTo: this.configService.get<string>('NOTIFICATION_EMAIL_REPLY_TO') ?? null,
        timeoutMs:
          emailProviderName === 'brevo'
            ? (this.configService.get<number>('BREVO_REQUEST_TIMEOUT_MS') ?? null)
            : emailProviderName === 'resend'
              ? (this.configService.get<number>('RESEND_REQUEST_TIMEOUT_MS') ?? null)
              : null,
      },
      worker: {
        enabled: workerEnabled,
        pollIntervalMs:
          this.configService.get<number>('NOTIFICATION_WORKER_POLL_INTERVAL_MS') ?? null,
        batchSize: this.configService.get<number>('NOTIFICATION_WORKER_BATCH_SIZE') ?? null,
        retryMaxAttempts: this.configService.get<number>('SMS_RETRY_MAX_ATTEMPTS') ?? null,
        retryBaseDelaySeconds:
          this.configService.get<number>('SMS_RETRY_BASE_DELAY_SECONDS') ?? null,
      },
    };
  }

  /**
   * POST /internal/notifications/test-send
   * Controlled connectivity test: { channel: 'EMAIL' | 'SMS', destination: string }.
   * Fixed safe content, rate limited, audited (masked destination), no delivery row.
   */
  @Post('test-send')
  async testSend(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const principalId = await this.authorizeTestSend(req);

    const parsed = this.parseTestSendBody(body);
    const { channel, destination } = parsed;

    // Fail closed BEFORE consuming rate-limit quota if governed DB config is disabled or misconfigured.
    if (this.providerConfigService) {
      const overview = await this.providerConfigService.getOverview();
      const snap = channel === 'EMAIL' ? overview.email : overview.sms;
      if (snap.source === 'DATABASE') {
        if (snap.provider === 'none') {
          throw new BadRequestException({
            statusCode: 400,
            message: 'PROVIDER_NOT_CONFIGURED',
            detail: 'EMAIL channel is set to none.',
          });
        }
        if (snap.misconfigurationCode) {
          throw new BadRequestException({
            statusCode: 400,
            message: snap.misconfigurationCode,
            detail: `${channel} provider configuration cannot be decrypted or lacks required settings.`,
          });
        }
        if (!snap.enabled) {
          throw new BadRequestException({
            statusCode: 400,
            message: `${channel}_PROVIDER_DISABLED`,
            detail: `${channel} provider is currently disabled; enable it via maker-checker before sending.`,
          });
        }
      }
    }

    // Provider availability — fail closed BEFORE consuming rate-limit quota or sending.
    if (channel === 'EMAIL' && this.emailProvider.name === 'none') {
      throw new BadRequestException({
        statusCode: 400,
        message: 'PROVIDER_NOT_CONFIGURED',
        detail: 'EMAIL channel is dark (NOTIFICATION_EMAIL_PROVIDER=none).',
      });
    }

    const correlationId = randomUUID();
    const maskedDestination = channel === 'EMAIL' ? maskEmail(destination) : maskPhone(destination);
    const provider = channel === 'EMAIL' ? this.emailProvider : this.smsProvider;
    const providerName = provider.name;

    // Atomic durable rate-limit reservation (Sprint 1 Remediation F-03):
    // Serialize per-principal rolling-hour quota with `pg_advisory_xact_lock` and commit an
    // immutable `NOTIFICATION_TEST_SEND_QUOTA` reservation row BEFORE any outbound provider call.
    // Concurrent bursts cannot exceed 5 provider-reaching attempts per rolling hour, failed
    // attempts are never refunded, and post-send persistence errors cannot drop the reservation.
    await this.safeDbOperation('testSend.reserveQuota', () =>
      this.dataSource.transaction(async (manager) => {
        await manager.query(
          `SELECT pg_advisory_xact_lock(hashtext('notification_test_send_quota_v1'), hashtext($1))`,
          [principalId],
        );

        const countRows = await manager.query<Array<{ count: string }>>(
          `SELECT count(*)::text AS count
             FROM audit_events
            WHERE actor = $1
              AND created_at >= NOW() - INTERVAL '1 hour'
              AND (
                entity_type = 'NOTIFICATION_TEST_SEND_QUOTA'
                OR (
                  entity_type = 'NOTIFICATION_TEST_SEND'
                  AND (
                    correlation_id IS NULL
                    OR NOT EXISTS (
                      SELECT 1
                        FROM audit_events q
                       WHERE q.entity_type = 'NOTIFICATION_TEST_SEND_QUOTA'
                         AND q.actor = $1
                         AND q.correlation_id = audit_events.correlation_id
                         AND q.created_at >= NOW() - INTERVAL '1 hour'
                    )
                  )
                )
              )`,
          [principalId],
        );

        if (Number(countRows[0]?.count ?? '0') >= TEST_SEND_HOURLY_LIMIT) {
          throw new HttpException(
            {
              statusCode: 429,
              message: 'NOTIFICATION_TEST_RATE_LIMITED',
              detail: `At most ${TEST_SEND_HOURLY_LIMIT} test sends per hour.`,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        await this.auditService.record(manager, {
          entityType: 'NOTIFICATION_TEST_SEND_QUOTA',
          entityId: randomUUID(),
          action: 'NOTIFICATION_TEST_QUOTA_RESERVED',
          actor: principalId,
          correlationId,
          newValues: {
            channel,
            destination: maskedDestination,
            provider: providerName,
          },
        });
      }),
    );

    // FIXED safe content — never template-driven, never financial, no event data.
    const text =
      channel === 'EMAIL'
        ? `MonieNaija notification test (EMAIL).\nReference ${correlationId}.\nThis is a controlled connectivity test with no financial content. No action is required.`
        : `MonieNaija notification test (SMS). Reference ${correlationId}. This is a controlled connectivity test with no financial content. No action is required.`;
    const subject = 'MonieNaija notification test';

    let result: NotificationSendResult;
    try {
      result = await provider.send({
        channel,
        destination,
        message: text,
        payload: { test: true },
        correlationId,
        eventType: 'notification.test_send',
        eventKey: `notification.test_send:${correlationId}`,
        recipientType: 'CUSTOMER',
        recipientId: principalId,
        ...(channel === 'EMAIL' ? { subject, html: renderEmailLayout(subject, text) } : {}),
      });
    } catch {
      result = { success: false, error: 'PROVIDER_FAILURE' };
    }

    const success = result.success === true;
    const errorCode = success
      ? null
      : (normalizeProviderErrorCode(result.error) ?? 'PROVIDER_FAILURE');
    const safeProviderRef =
      typeof result.providerRef === 'string' && result.providerRef.length > 0
        ? result.providerRef.slice(0, 255)
        : null;

    if (this.providerConfigService) {
      try {
        await this.providerConfigService.recordTestSendOutcome({
          channel,
          actor: principalId,
          providerName,
          success,
          maskedDestination,
          providerRef: safeProviderRef,
          errorCode,
        });
      } catch (error) {
        this.logger.warn({
          msg: 'notification_test_send_outcome_persist_failed',
          channel,
          sqlState: extractSqlState(error),
        });
      }
    }

    await this.safeDbOperation('testSend.recordAudit', () =>
      this.dataSource.transaction((manager) =>
        this.auditService.record(manager, {
          entityType: 'NOTIFICATION_TEST_SEND',
          entityId: randomUUID(),
          action: success ? 'NOTIFICATION_TEST_SENT' : 'NOTIFICATION_TEST_FAILED',
          actor: principalId,
          correlationId,
          newValues: {
            channel,
            destination: maskedDestination,
            provider: providerName,
            providerRef: safeProviderRef,
            errorCode,
          },
        }),
      ),
    );

    return {
      status: success ? 'SENT' : 'FAILED',
      channel,
      correlationId,
      destination: maskedDestination,
      provider: providerName,
      providerRef: success ? safeProviderRef : null,
      errorCode,
    };
  }

  private parseTestSendBody(body: unknown): { channel: 'EMAIL' | 'SMS'; destination: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Body must be a JSON object');
    }
    const raw = body as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
      if (key !== 'channel' && key !== 'destination') {
        throw new BadRequestException(`Unknown field: ${key}`);
      }
    }
    const channel = typeof raw.channel === 'string' ? raw.channel.trim().toUpperCase() : '';
    if (channel !== 'EMAIL' && channel !== 'SMS') {
      throw new BadRequestException("channel must be 'EMAIL' or 'SMS'");
    }
    const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
    if (channel === 'EMAIL') {
      if (
        destination.length === 0 ||
        destination.length > 254 ||
        !TEST_EMAIL_PATTERN.test(destination)
      ) {
        throw new BadRequestException(
          'destination must be a valid email address (max 254 characters)',
        );
      }
    } else {
      if (!TEST_SMS_PATTERN.test(destination)) {
        throw new BadRequestException('destination must be a valid E.164 phone number');
      }
    }
    return { channel, destination };
  }

  private async authorizeProviderStatus(
    req: AuthenticatedRequest,
  ): Promise<{ principalId: string; hasProviderView: boolean }> {
    const principal = req.authorizationPrincipal;
    const useDeliveryFallback =
      Boolean(principal) &&
      !principal!.scopes?.includes('notification.provider.view') &&
      Boolean(principal!.scopes?.includes('notification.view_deliveries'));
    const requiredFunction = useDeliveryFallback
      ? 'notification.view_deliveries'
      : 'notification.provider.view';

    const decision = await this.auth.authorize(
      principal,
      {
        resourceType: 'notification-provider-status',
        action: requiredFunction,
        allowedPrincipalTypes: WORKFORCE_PRINCIPAL_TYPES,
        requiredFunctions: [requiredFunction],
        customerAccess: 'NONE',
      },
      { type: 'notification-provider-status' },
    );

    if (!decision.allowed || !principal) {
      this.throwAuthorizationDenial(decision.reason);
    }

    return {
      principalId: principal.principalId,
      hasProviderView: !useDeliveryFallback,
    };
  }

  private async authorizeTestSend(req: AuthenticatedRequest): Promise<string> {
    const principal = req.authorizationPrincipal;
    const decision = await this.auth.authorize(
      principal,
      {
        resourceType: 'notification-test-send',
        action: 'notification.test_send',
        allowedPrincipalTypes: WORKFORCE_PRINCIPAL_TYPES,
        requiredFunctions: ['notification.test_send'],
        customerAccess: 'NONE',
      },
      { type: 'notification-test-send' },
    );

    if (!decision.allowed || !principal) {
      this.throwAuthorizationDenial(decision.reason);
    }

    if (principal.readOnlyPrincipal) {
      throw new ForbiddenException('READ_ONLY_PRINCIPAL');
    }

    return principal.principalId;
  }

  private throwAuthorizationDenial(reason?: AuthorizationDenialReason): never {
    if (reason === 'UNAUTHENTICATED' || !reason) {
      throw new UnauthorizedException('Authentication required');
    }
    if (reason === 'PRINCIPAL_TYPE_DENIED' || reason === 'INVALID_PRINCIPAL') {
      throw new UnauthorizedException('Privileged access required');
    }
    throw new ForbiddenException(reason);
  }

  private async safeDbOperation<T>(operation: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.warn({
        msg: 'notification_provider_controller_db_error',
        operation,
        sqlState: extractSqlState(error),
      });
      throw new InternalServerErrorException('Notification provider operation could not be completed');
    }
  }
}
