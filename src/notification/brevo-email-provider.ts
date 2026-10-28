import { Injectable, Logger } from '@nestjs/common';

import {
  NotificationProvider,
  NotificationSendRequest,
  NotificationSendResult,
} from './notification.types';
import {
  ProviderEgressBlockedError,
  classifyBrevoErrorCode,
  classifyTransportErrorName,
  createPinnedProviderHttpFetch,
  deriveSafeVendorProviderRef,
  formatSafeHttpStatus,
  isPinnedProviderEndpointUrl,
} from './provider-security';
import { sanitizeHeader } from './resend-email-provider';

const EMAIL_DESTINATION_PATTERN =
  /^[^@\s,;"'<>()\\]+@[^@\s,;"'<>()\\]+\.[^@\s,;"'<>()\\]{2,63}$/;

export function normalizeEmailDestination(raw: string): string | null {
  const cleaned = sanitizeHeader(raw).toLowerCase();
  if (!cleaned || cleaned.length > 254 || !EMAIL_DESTINATION_PATTERN.test(cleaned)) {
    return null;
  }
  return cleaned;
}

/**
 * Brevo (formerly Sendinblue) v3 Transactional Email HTTP adapter.
 *
 * Authoritative documented Brevo v3 contract:
 *   - Send endpoint: POST {baseUrl}/v3/smtp/email (default https://api.brevo.com)
 *   - Authentication header: `api-key: xkeysib-...` (v3 REST API key — NOT `xsmtpsib-` SMTP key)
 *   - Request body:
 *       {
 *         sender: { email: string, name?: string },
 *         to: [{ email: string }],
 *         replyTo?: { email: string },
 *         subject: string,
 *         textContent: string,
 *         htmlContent?: string,
 *         tags?: string[]
 *       }
 *   - Success response: HTTP 201 / 200 `{ messageId: string }` (or `{ messageIds: string[] }`)
 *   - Error response: non-2xx `{ code?: string, message?: string }`
 *   - Read-only verification endpoints:
 *       GET {baseUrl}/v3/account
 *       GET {baseUrl}/v3/senders -> `{ senders?: Array<{ email?: string; active?: boolean }> }`
 *
 * Security invariants:
 *   - `apiKey` is never logged, returned, or embedded in error strings.
 *   - Provider prose (`message`) and destination addresses are never echoed into `error`.
 */
export interface BrevoEmailProviderConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly fromName?: string | null;
  readonly replyTo?: string | null;
  readonly requestTimeoutMs: number;
}

export type BrevoFetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    redirect?: 'error';
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const DEFAULT_BREVO_FETCH: BrevoFetchFn =
  createPinnedProviderHttpFetch() as unknown as BrevoFetchFn;

interface BrevoErrorBody {
  code?: unknown;
}

interface BrevoSendersBody {
  senders?: unknown;
}

export interface BrevoConnectionVerificationResult {
  ok: boolean;
  accountReachable: boolean;
  senderVerified: boolean;
  errorCode: string | null;
}

export function parseSenderIdentity(
  rawFrom: string,
  explicitName?: string | null,
): { email: string; name: string | null } | null {
  const cleaned = sanitizeHeader(rawFrom);
  if (!cleaned) return null;

  const angleMatch = /^(.*?)<([^<>]+)>$/.exec(cleaned);
  if (angleMatch) {
    const parsedName = sanitizeHeader(angleMatch[1] ?? '').replace(/^"|"$/g, '').trim();
    const normalizedEmail = normalizeEmailDestination(angleMatch[2] ?? '');
    if (!normalizedEmail) return null;
    const finalName = sanitizeHeader(explicitName ?? '') || parsedName || null;
    return { email: normalizedEmail, name: finalName ? finalName.slice(0, 120) : null };
  }

  const normalizedEmail = normalizeEmailDestination(cleaned);
  if (!normalizedEmail) return null;
  const cleanedName = sanitizeHeader(explicitName ?? '');
  return {
    email: normalizedEmail,
    name: cleanedName ? cleanedName.slice(0, 120) : null,
  };
}

export async function verifyBrevoConnection(
  config: BrevoEmailProviderConfig,
  fetchImpl: BrevoFetchFn = DEFAULT_BREVO_FETCH,
): Promise<BrevoConnectionVerificationResult> {
  if (!config.apiKey || config.apiKey.startsWith('xsmtpsib-')) {
    return {
      ok: false,
      accountReachable: false,
      senderVerified: false,
      errorCode: 'BREVO_SMTP_KEY_NOT_SUPPORTED',
    };
  }
  if (!config.apiKey.startsWith('xkeysib-')) {
    return {
      ok: false,
      accountReachable: false,
      senderVerified: false,
      errorCode: 'BREVO_INVALID_KEY_PREFIX',
    };
  }

  const sender = parseSenderIdentity(config.fromEmail, config.fromName);
  if (!sender) {
    return {
      ok: false,
      accountReachable: false,
      senderVerified: false,
      errorCode: 'BREVO_INVALID_SENDER',
    };
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  if (
    !isPinnedProviderEndpointUrl('brevo', `${baseUrl}/v3/account`) ||
    !isPinnedProviderEndpointUrl('brevo', `${baseUrl}/v3/senders`)
  ) {
    return {
      ok: false,
      accountReachable: false,
      senderVerified: false,
      errorCode: 'BREVO_EGRESS_BLOCKED',
    };
  }

  const headers: Record<string, string> = {
    'api-key': config.apiKey,
    accept: 'application/json',
  };

  const getJson = async (
    path: string,
  ): Promise<{ ok: boolean; status: number; body: unknown; networkError: string | null }> => {
    const endpointUrl = `${baseUrl}${path}`;
    if (!isPinnedProviderEndpointUrl('brevo', endpointUrl)) {
      return {
        ok: false,
        status: 0,
        body: null,
        networkError: 'BREVO_EGRESS_BLOCKED',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const res = await fetchImpl(endpointUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: 'error',
      });
      if (res.status >= 300 && res.status < 400) {
        return {
          ok: false,
          status: res.status,
          body: null,
          networkError: 'BREVO_EGRESS_BLOCKED',
        };
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { ok: res.ok, status: res.status, body, networkError: null };
    } catch (err) {
      if (
        err instanceof ProviderEgressBlockedError ||
        (err as { name?: unknown } | null)?.name === 'ProviderEgressBlockedError'
      ) {
        return {
          ok: false,
          status: 0,
          body: null,
          networkError: 'BREVO_EGRESS_BLOCKED',
        };
      }
      const aborted =
        controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
      const name = classifyTransportErrorName(err);
      return {
        ok: false,
        status: 0,
        body: null,
        networkError: aborted ? 'BREVO_TIMEOUT' : `BREVO_NETWORK:${name}`,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const accountRes = await getJson('/v3/account');
  if (accountRes.networkError) {
    return {
      ok: false,
      accountReachable: false,
      senderVerified: false,
      errorCode: accountRes.networkError,
    };
  }
  if (!accountRes.ok) {
    const code = classifyBrevoErrorCode((accountRes.body as BrevoErrorBody | null)?.code);
    const safeStatus = formatSafeHttpStatus(accountRes.status);
    return {
      ok: false,
      accountReachable: false,
      senderVerified: false,
      errorCode: code
        ? `BREVO_VERIFY_HTTP_${safeStatus}:${code}`
        : `BREVO_VERIFY_HTTP_${safeStatus}`,
    };
  }

  const sendersRes = await getJson('/v3/senders');
  if (sendersRes.networkError) {
    return {
      ok: false,
      accountReachable: true,
      senderVerified: false,
      errorCode: sendersRes.networkError,
    };
  }
  if (!sendersRes.ok) {
    const code = classifyBrevoErrorCode((sendersRes.body as BrevoErrorBody | null)?.code);
    const safeStatus = formatSafeHttpStatus(sendersRes.status);
    return {
      ok: false,
      accountReachable: true,
      senderVerified: false,
      errorCode: code
        ? `BREVO_SENDERS_HTTP_${safeStatus}:${code}`
        : `BREVO_SENDERS_HTTP_${safeStatus}`,
    };
  }

  const rawSenders = (sendersRes.body as BrevoSendersBody | null)?.senders;
  if (!Array.isArray(rawSenders)) {
    return {
      ok: false,
      accountReachable: true,
      senderVerified: false,
      errorCode: 'BREVO_SENDERS_INVALID_RESPONSE',
    };
  }

  const senderVerified = rawSenders.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as { email?: unknown; active?: unknown };
    if (typeof record.email !== 'string') return false;
    return record.email.trim().toLowerCase() === sender.email && record.active !== false;
  });

  if (!senderVerified) {
    return {
      ok: false,
      accountReachable: true,
      senderVerified: false,
      errorCode: 'BREVO_SENDER_NOT_VERIFIED',
    };
  }

  return {
    ok: true,
    accountReachable: true,
    senderVerified: true,
    errorCode: null,
  };
}

@Injectable()
export class BrevoEmailProvider implements NotificationProvider {
  readonly name = 'brevo';
  private readonly logger = new Logger(BrevoEmailProvider.name);
  private readonly baseUrl: string;
  private readonly fetchFn: BrevoFetchFn;

  constructor(
    private readonly config: BrevoEmailProviderConfig,
    fetchImpl?: BrevoFetchFn,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetchFn = fetchImpl ?? DEFAULT_BREVO_FETCH;
  }

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    if (request.channel !== 'EMAIL') {
      const safeChannel = request.channel === 'SMS' ? 'SMS' : 'PUSH';
      return {
        success: false,
        error: `BREVO_UNSUPPORTED_CHANNEL:${safeChannel}`,
      };
    }

    if (!this.config.apiKey || this.config.apiKey.startsWith('xsmtpsib-')) {
      return { success: false, error: 'BREVO_SMTP_KEY_NOT_SUPPORTED' };
    }
    if (!this.config.apiKey.startsWith('xkeysib-')) {
      return { success: false, error: 'BREVO_INVALID_KEY_PREFIX' };
    }

    const sender = parseSenderIdentity(this.config.fromEmail, this.config.fromName);
    if (!sender) {
      return { success: false, error: 'BREVO_INVALID_SENDER' };
    }

    const destination = normalizeEmailDestination(request.destination);
    if (!destination) {
      return { success: false, error: 'BREVO_INVALID_DESTINATION' };
    }

    const subject = sanitizeHeader(request.subject ?? '');
    if (!subject) {
      return { success: false, error: 'BREVO_EMPTY_SUBJECT' };
    }

    const textContent = request.message?.trim() ?? '';
    const htmlContent = request.html?.trim() ?? '';
    if (!textContent && !htmlContent) {
      return { success: false, error: 'BREVO_EMPTY_BODY' };
    }

    let replyToEmail: string | null = null;
    if (this.config.replyTo) {
      const parsedReplyTo = parseSenderIdentity(this.config.replyTo);
      if (!parsedReplyTo) {
        return { success: false, error: 'BREVO_INVALID_REPLY_TO' };
      }
      replyToEmail = parsedReplyTo.email;
    }

    const tag = request.eventType.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64);
    const bodyPayload: Record<string, unknown> = {
      sender: sender.name ? { email: sender.email, name: sender.name } : { email: sender.email },
      to: [{ email: destination }],
      subject,
      ...(textContent ? { textContent } : {}),
      ...(htmlContent ? { htmlContent } : {}),
      ...(replyToEmail ? { replyTo: { email: replyToEmail } } : {}),
      ...(tag ? { tags: [tag] } : {}),
    };

    const endpointUrl = `${this.baseUrl}/v3/smtp/email`;
    if (!isPinnedProviderEndpointUrl('brevo', endpointUrl)) {
      this.logger.warn({
        msg: 'brevo_email_egress_blocked',
        eventType: request.eventType,
        eventKey: request.eventKey,
        correlationId: request.correlationId,
        reason: 'unpinned_origin',
      });
      return { success: false, error: 'BREVO_EGRESS_BLOCKED' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await this.fetchFn(endpointUrl, {
        method: 'POST',
        headers: {
          'api-key': this.config.apiKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
        redirect: 'error',
      });

      if (response.status >= 300 && response.status < 400) {
        this.logger.warn({
          msg: 'brevo_email_egress_blocked',
          eventType: request.eventType,
          eventKey: request.eventKey,
          correlationId: request.correlationId,
          status: formatSafeHttpStatus(response.status),
          reason: 'redirect_rejected',
        });
        return { success: false, error: 'BREVO_EGRESS_BLOCKED' };
      }

      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }

      if (response.ok) {
        let rawCandidateId: unknown = null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const rec = parsed as Record<string, unknown>;
          if ('messageId' in rec && rec['messageId'] !== undefined && rec['messageId'] !== null) {
            rawCandidateId = rec['messageId'];
          } else if (
            'messageIds' in rec &&
            rec['messageIds'] !== undefined &&
            rec['messageIds'] !== null
          ) {
            if (
              Array.isArray(rec['messageIds']) &&
              rec['messageIds'].length > 0 &&
              rec['messageIds'].length <= 50
            ) {
              rawCandidateId = rec['messageIds'][0];
            }
          }
        }

        const providerRef = deriveSafeVendorProviderRef(
          'brevo',
          rawCandidateId,
          this.config.apiKey,
        );

        if (!providerRef) {
          this.logger.warn({
            msg: 'brevo_email_missing_message_id',
            eventType: request.eventType,
            eventKey: request.eventKey,
            correlationId: request.correlationId,
            status: formatSafeHttpStatus(response.status),
          });
          return { success: false, error: 'BREVO_INVALID_RESPONSE' };
        }

        this.logger.log({
          msg: 'brevo_email_submitted',
          eventType: request.eventType,
          eventKey: request.eventKey,
          recipientType: request.recipientType,
          recipientId: request.recipientType === 'PHONE' ? '[PHONE]' : request.recipientId,
          providerRef,
          correlationId: request.correlationId,
        });
        return { success: true, providerRef };
      }

      const errorCode = classifyBrevoErrorCode((parsed as BrevoErrorBody | null)?.code);
      const safeStatus = formatSafeHttpStatus(response.status);
      const error = errorCode
        ? `BREVO_HTTP_${safeStatus}:${errorCode}`
        : `BREVO_HTTP_${safeStatus}`;

      this.logger.warn({
        msg: 'brevo_email_rejected',
        eventType: request.eventType,
        eventKey: request.eventKey,
        correlationId: request.correlationId,
        status: safeStatus,
        errorCode: errorCode ?? 'unclassified',
      });
      return { success: false, error };
    } catch (err) {
      if (
        err instanceof ProviderEgressBlockedError ||
        (err as { name?: unknown } | null)?.name === 'ProviderEgressBlockedError'
      ) {
        this.logger.warn({
          msg: 'brevo_email_egress_blocked',
          eventType: request.eventType,
          eventKey: request.eventKey,
          correlationId: request.correlationId,
          reason: 'dns_or_ip_blocked',
        });
        return { success: false, error: 'BREVO_EGRESS_BLOCKED' };
      }
      const aborted =
        controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
      const errName = classifyTransportErrorName(err);
      const error = aborted ? 'BREVO_TIMEOUT' : `BREVO_NETWORK:${errName}`;

      this.logger.warn({
        msg: 'brevo_email_transport_error',
        eventType: request.eventType,
        eventKey: request.eventKey,
        correlationId: request.correlationId,
        aborted,
        errorName: errName,
      });
      return { success: false, error };
    } finally {
      clearTimeout(timer);
    }
  }
}
