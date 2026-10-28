import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Body,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import {
  NOTIFICATION_EMAIL_PROVIDER_TOKEN,
  NOTIFICATION_PROVIDER_TOKEN,
} from '../notification/notification.constants';
import { renderEmailLayout } from '../notification/notification-email-template.service';
import type { NotificationProvider } from '../notification/notification.types';

/**
 * ARENA3-NOTIFICATION-EMAIL — read-only provider configuration/status + controlled test-send.
 *
 * Separate controller file (not merged into admin-notification.controller.ts) to keep the
 * diagnostics endpoint byte-stable and minimize merge surface with Arena 1.
 *
 * SECURITY PROPERTIES:
 * - provider-status is READ-ONLY and NON-SECRET: it exposes provider names, base URLs,
 *   timeouts and a last-4 key FINGERPRINT only. Full API keys never appear in any response,
 *   log line, delivery payload or audit record (credential hygiene requirement).
 * - Both endpoints require an authenticated workforce principal (customer/agent/aggregator
 *   identities are rejected 401) PLUS server-side function-scope checks (fail-closed 403):
 *     GET  provider-status → notification.view_deliveries (existing catalogue function)
 *     POST test-send       → notification.test_send (new catalogue function, EXECUTE,
 *                            assigned to SUPER_ADMIN + OPERATIONS only)
 * - test-send is rate limited to 5 attempts/hour/principal (durable counter over
 *   audit_events — no new table), strictly validates the destination, sends FIXED safe
 *   content (never template-driven, never financial), and writes an audit row with a
 *   MASKED destination for every attempt that reaches the provider.
 * - test-send deliberately writes NO notification_deliveries row: recipient_id is a uuid
 *   FK-shaped identity for CUSTOMER/AGENT recipients, which workforce principals are not;
 *   inventing one would pollute delivery diagnostics. The audit trail is the evidence.
 */

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
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
  ) {}

  /**
   * GET /internal/notifications/provider-status
   * Read-only, non-secret snapshot of notification provider configuration + worker tuning.
   */
  @Get('provider-status')
  providerStatus(@Req() req: AuthenticatedRequest) {
    this.requireFunction(req, 'notification.view_deliveries');

    const smsProviderName = this.configService.get<string>('NOTIFICATION_SMS_PROVIDER') ?? 'console';
    const emailProviderName = this.configService.get<string>('NOTIFICATION_EMAIL_PROVIDER') ?? 'none';
    const robaseKey = this.configService.get<string>('ROBASE_API_KEY');
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
          emailProviderName === 'resend'
            ? (this.configService.get<string>('RESEND_API_BASE_URL') ?? null)
            : null,
        configured:
          emailProviderName === 'resend' &&
          Boolean(resendKey) &&
          Boolean(this.configService.get<string>('NOTIFICATION_EMAIL_FROM')),
        keyFingerprint: keyFingerprint(resendKey),
        from: this.configService.get<string>('NOTIFICATION_EMAIL_FROM') ?? null,
        replyTo: this.configService.get<string>('NOTIFICATION_EMAIL_REPLY_TO') ?? null,
        timeoutMs:
          emailProviderName === 'resend'
            ? (this.configService.get<number>('RESEND_REQUEST_TIMEOUT_MS') ?? null)
            : null,
      },
      worker: {
        enabled: this.configService.get<boolean>('NOTIFICATION_WORKER_ENABLED') === true,
        pollIntervalMs: this.configService.get<number>('NOTIFICATION_WORKER_POLL_INTERVAL_MS') ?? null,
        batchSize: this.configService.get<number>('NOTIFICATION_WORKER_BATCH_SIZE') ?? null,
        retryMaxAttempts: this.configService.get<number>('SMS_RETRY_MAX_ATTEMPTS') ?? null,
        retryBaseDelaySeconds: this.configService.get<number>('SMS_RETRY_BASE_DELAY_SECONDS') ?? null,
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
    const principalId = this.requireFunction(req, 'notification.test_send');

    const parsed = this.parseTestSendBody(body);
    const { channel, destination } = parsed;

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

    // FIXED safe content — never template-driven, never financial, no event data.
    const text =
      channel === 'EMAIL'
        ? `MonieNaija notification test (EMAIL).\nReference ${correlationId}.\nThis is a controlled connectivity test with no financial content. No action is required.`
        : `MonieNaija notification test (SMS). Reference ${correlationId}. This is a controlled connectivity test with no financial content. No action is required.`;
    const subject = 'MonieNaija notification test';

    // Provider call keying fields only — NO notification_deliveries row is written
    // (recipient identities are CUSTOMER/AGENT uuids; workforce principals are neither).
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
    await this.auditService.record(this.dataSource.manager, {
      entityType: 'NOTIFICATION_TEST_SEND',
      entityId: randomUUID(),
      action: success ? 'NOTIFICATION_TEST_SENT' : 'NOTIFICATION_TEST_FAILED',
      actor: principalId,
      correlationId,
      newValues: {
        channel,
        destination: maskedDestination,
        provider: provider.name,
        providerRef: typeof result.providerRef === 'string' ? result.providerRef.slice(0, 255) : null,
        // Bounded, stable error code only (adapters never return prose/bodies/credentials).
        errorCode: success ? null : String(result.error ?? 'PROVIDER_FAILURE').slice(0, 160),
      },
    });

    return {
      status: success ? 'SENT' : 'FAILED',
      channel,
      correlationId,
      destination: maskedDestination,
      provider: provider.name,
      providerRef: success ? (result.providerRef ?? null) : null,
      errorCode: success ? null : String(result.error ?? 'PROVIDER_FAILURE').slice(0, 160),
    };
  }

  private parseTestSendBody(body: unknown): { channel: 'EMAIL' | 'SMS'; destination: string } {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body must be a JSON object');
    }
    const raw = body as Record<string, unknown>;
    const channel = typeof raw.channel === 'string' ? raw.channel.trim().toUpperCase() : '';
    if (channel !== 'EMAIL' && channel !== 'SMS') {
      throw new BadRequestException("channel must be 'EMAIL' or 'SMS'");
    }
    const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
    if (channel === 'EMAIL') {
      if (destination.length === 0 || destination.length > 254 || !TEST_EMAIL_PATTERN.test(destination)) {
        throw new BadRequestException('destination must be a valid email address (max 254 characters)');
      }
    } else {
      if (!TEST_SMS_PATTERN.test(destination)) {
        throw new BadRequestException('destination must be a valid E.164 phone number');
      }
    }
    return { channel, destination };
  }

  /** Workforce authentication + fail-closed server-side function check. Returns principalId. */
  private requireFunction(req: AuthenticatedRequest, functionCode: string): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (
      principal.type === 'AGENT' ||
      principal.type === 'CUSTOMER' ||
      (principal.type as string) === 'AGGREGATOR'
    ) {
      throw new UnauthorizedException('Privileged access required');
    }
    if (!principal.scopes?.includes(functionCode)) {
      throw new ForbiddenException('FUNCTION_MISSING');
    }
    return principal.principalId;
  }
}
