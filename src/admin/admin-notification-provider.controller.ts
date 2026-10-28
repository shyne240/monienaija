import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  NOTIFICATION_EMAIL_PROVIDER_TOKEN,
  NOTIFICATION_PROVIDER_TOKEN,
} from '../notification/notification.constants';
import { renderEmailLayout } from '../notification/notification-email-template.service';
import { NotificationProviderConfigService } from '../notification/notification-provider-config.service';
import type { NotificationProvider } from '../notification/notification.types';
import { AuditService } from '../operations/audit.service';

interface AuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const TEST_SEND_HOURLY_LIMIT = 5;

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

@Controller('internal/notifications')
export class AdminNotificationProviderController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    @Inject(NOTIFICATION_PROVIDER_TOKEN) private readonly smsProvider: NotificationProvider,
    @Inject(NOTIFICATION_EMAIL_PROVIDER_TOKEN) private readonly emailProvider: NotificationProvider,
    @Optional() private readonly providerConfigService?: NotificationProviderConfigService,
  ) {}

  /**
   * GET /internal/notifications/provider-status
   * Read-only, non-secret snapshot of notification provider configuration + worker tuning.
   */
  @Get('provider-status')
  async providerStatus(@Req() req: AuthenticatedRequest) {
    this.requireAnyFunction(req, ['notification.view_deliveries', 'notification.provider.view']);

    if (this.providerConfigService) {
      const overview = await this.providerConfigService.getOverview();
      return {
        channels: ['SMS', 'PUSH', 'EMAIL'],
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
          misconfigurationCode: overview.sms.misconfigurationCode,
          lastTest: overview.sms.lastTest,
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
          misconfigurationCode: overview.email.misconfigurationCode,
          domainAuth: overview.email.domainAuthentication,
          lastTest: overview.email.lastTest,
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

    return {
      channels: ['SMS', 'PUSH', 'EMAIL'],
      sms: {
        provider: smsProviderName,
        baseUrl: this.configService.get<string>('ROBASE_API_BASE_URL') ?? null,
        configured: smsProviderName === 'robase' && Boolean(robaseKey),
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
        configured:
          (emailProviderName === 'brevo' &&
            Boolean(brevoKey) &&
            Boolean(this.configService.get<string>('NOTIFICATION_EMAIL_FROM'))) ||
          (emailProviderName === 'resend' &&
            Boolean(resendKey) &&
            Boolean(this.configService.get<string>('NOTIFICATION_EMAIL_FROM'))),
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
        enabled: this.configService.get<boolean>('NOTIFICATION_WORKER_ENABLED') === true,
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
    const principalId = this.requireAnyFunction(req, ['notification.test_send'], true);

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

    // Durable rate limit: 5 provider-reaching attempts per principal per rolling hour,
    // counted from the audit trail (every attempt below writes exactly one audit row).
    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS count FROM audit_events
        WHERE entity_type = 'NOTIFICATION_TEST_SEND'
          AND actor = $1
          AND created_at >= NOW() - INTERVAL '1 hour'`,
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

    const correlationId = randomUUID();
    const maskedDestination = channel === 'EMAIL' ? maskEmail(destination) : maskPhone(destination);
    const provider = channel === 'EMAIL' ? this.emailProvider : this.smsProvider;
    const providerName = provider.name;

    // FIXED safe content — never template-driven, never financial, no event data.
    const text =
      channel === 'EMAIL'
        ? `MonieNaija notification test (EMAIL).\nReference ${correlationId}.\nThis is a controlled connectivity test with no financial content. No action is required.`
        : `MonieNaija notification test (SMS). Reference ${correlationId}. This is a controlled connectivity test with no financial content. No action is required.`;
    const subject = 'MonieNaija notification test';

    const result = await provider.send({
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

    const success = result.success === true;
    const errorCode = success ? null : String(result.error ?? 'PROVIDER_FAILURE').slice(0, 160);

    if (this.providerConfigService) {
      await this.providerConfigService.recordTestSendOutcome({
        channel,
        actor: principalId,
        providerName,
        success,
        maskedDestination,
        providerRef: typeof result.providerRef === 'string' ? result.providerRef.slice(0, 255) : null,
        errorCode,
      });
    }

    await this.auditService.record(this.dataSource.manager, {
      entityType: 'NOTIFICATION_TEST_SEND',
      entityId: randomUUID(),
      action: success ? 'NOTIFICATION_TEST_SENT' : 'NOTIFICATION_TEST_FAILED',
      actor: principalId,
      correlationId,
      newValues: {
        channel,
        destination: maskedDestination,
        provider: providerName,
        providerRef:
          typeof result.providerRef === 'string' ? result.providerRef.slice(0, 255) : null,
        errorCode,
      },
    });

    return {
      status: success ? 'SENT' : 'FAILED',
      channel,
      correlationId,
      destination: maskedDestination,
      provider: providerName,
      providerRef: success ? (result.providerRef ?? null) : null,
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

  private requireAnyFunction(
    req: AuthenticatedRequest,
    functionCodes: string[],
    mutating = false,
  ): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (
      principal.type === 'AGENT' ||
      principal.type === 'CUSTOMER' ||
      (principal.type as string) === 'AGGREGATOR'
    ) {
      throw new UnauthorizedException('Privileged access required');
    }
    if (mutating && principal.readOnlyPrincipal) {
      throw new ForbiddenException('READ_ONLY_PRINCIPAL');
    }
    if (!functionCodes.some((code) => principal.scopes?.includes(code))) {
      throw new ForbiddenException('FUNCTION_MISSING');
    }
    return principal.principalId;
  }
}
