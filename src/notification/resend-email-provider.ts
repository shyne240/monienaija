import type {
  NotificationProvider,
  NotificationSendRequest,
  NotificationSendResult,
} from './notification.types';
import {
  ProviderEgressBlockedError,
  classifyResendErrorCode,
  classifyTransportErrorName,
  createPinnedProviderHttpFetch,
  formatSafeHttpStatus,
  isPinnedProviderEndpointUrl,
} from './provider-security';

/**
 * ARENA3-NOTIFICATION-EMAIL — production email provider adapter (Resend HTTP API).
 *
 * Contract basis (provider's published HTTP API as understood at implementation time;
 * mirrors the RobaseNotificationProvider discipline exactly):
 * - Base URL: https://api.resend.com (configurable via RESEND_API_BASE_URL)
 * - Auth: `Authorization: Bearer re_...` — live API keys carry the `re_` prefix
 *   (validated fail-fast by the environment schema when provider=resend).
 * - Send email: `POST /emails`
 *     request body: { from, to: [address], subject, text, html?, reply_to? }
 *     success response: { id } — the provider message id, stored as providerRef.
 * - Idempotency: `Idempotency-Key` header — the provider replays the original response
 *   for a repeated key instead of sending twice. We always send once per delivery row.
 * - Errors: non-2xx responses are reduced to a stable bounded code only
 *   (`RESEND_HTTP_<status>:<name>`); response prose/bodies are never surfaced, logged,
 *   stored or thrown (they can embed request details).
 *
 * OUTSTANDING INTEGRATION REQUIREMENT (recorded, not hidden): the live provider
 * documentation could not be re-fetched from this build sandbox (host allowlist);
 * before production enablement, operations must re-verify the endpoint path, request/
 * response field names and idempotency semantics against the provider's current docs
 * with a controlled test-send (POST /internal/notifications/test-send).
 *
 * Security properties (same guarantees as the SMS adapter):
 * - The API key only ever appears in the Authorization header; this class never logs,
 *   throws, or returns the key, headers, or full response bodies.
 * - Provider failure returns success=false; it never throws into dispatch/retry paths,
 *   and notification failure never touches financial state (existing isolation contract).
 * - `SENT` means "accepted by the provider API" — NOT confirmed recipient delivery.
 */
export interface ResendEmailProviderConfig {
  baseUrl: string;
  apiKey: string;
  /** Verified sender identity, e.g. "MonieNaija <notifications@monienaija.ng>". */
  from: string;
  replyTo?: string | null;
  requestTimeoutMs: number;
}

type FetchImplementation = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect?: 'error';
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const DEFAULT_RESEND_FETCH: FetchImplementation =
  createPinnedProviderHttpFetch() as unknown as FetchImplementation;

/** Conservative address shape: no whitespace/quotes/semicolons/commas/angle brackets, one @, dotted domain. */
const EMAIL_DESTINATION_PATTERN = /^[^@\s,;"'<>()\\]+@[^@\s,;"'<>()\\]+\.[^@\s,;"'<>()\\]{2,63}$/;

export class ResendEmailProvider implements NotificationProvider {
  readonly name = 'resend';

  constructor(
    private readonly config: ResendEmailProviderConfig,
    private readonly fetchImpl: FetchImplementation = DEFAULT_RESEND_FETCH,
  ) {}

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    if (request.channel !== 'EMAIL') {
      // Email adapter is EMAIL-only; SMS/PUSH must never route here.
      const safeChannel = request.channel === 'SMS' ? 'SMS' : 'PUSH';
      return { success: false, error: `RESEND_UNSUPPORTED_CHANNEL:${safeChannel}` };
    }

    const destination = request.destination.trim().toLowerCase();
    if (destination.length > 254 || !EMAIL_DESTINATION_PATTERN.test(destination)) {
      return { success: false, error: 'RESEND_INVALID_DESTINATION' };
    }

    const subject = sanitizeHeader(request.subject ?? '');
    if (!subject) {
      return { success: false, error: 'RESEND_MISSING_SUBJECT' };
    }
    const text = typeof request.message === 'string' ? request.message.slice(0, 4_000) : '';
    if (!text && !request.html) {
      return { success: false, error: 'RESEND_EMPTY_BODY' };
    }

    const endpointUrl = `${this.config.baseUrl.replace(/\/+$/, '')}/emails`;
    if (!isPinnedProviderEndpointUrl('resend', endpointUrl)) {
      return { success: false, error: 'RESEND_EGRESS_BLOCKED' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const body: Record<string, unknown> = {
        from: this.config.from,
        to: [destination],
        subject,
        text,
      };
      if (typeof request.html === 'string' && request.html.length > 0) {
        body.html = request.html.slice(0, 64_000);
      }
      if (this.config.replyTo) {
        body.reply_to = this.config.replyTo;
      }

      const response = await this.fetchImpl(endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          // Deterministic provider-side dedupe identical to the delivery unique identity.
          'Idempotency-Key': `${request.eventKey}:${request.recipientId}:${request.channel}`.slice(
            0,
            255,
          ),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });

      if (response.status >= 300 && response.status < 400) {
        return { success: false, error: 'RESEND_EGRESS_BLOCKED' };
      }

      if (response.ok) {
        const parsed = (await response.json()) as { id?: unknown };
        if (typeof parsed?.id === 'string' && parsed.id.length > 0 && parsed.id.length <= 255) {
          return { success: true, providerRef: parsed.id };
        }
        return { success: false, error: 'RESEND_UNRECOGNIZED_SUCCESS_RESPONSE' };
      }

      // Failure: classify error code strictly against the closed allowlist; never echo prose or bodies.
      let errorName = 'unknown';
      try {
        const errBody = (await response.json()) as { name?: unknown; code?: unknown };
        errorName = classifyResendErrorCode(errBody?.name ?? errBody?.code);
      } catch {
        // Non-JSON error body — keep the generic name.
      }
      const safeStatus = formatSafeHttpStatus(response.status);
      return { success: false, error: `RESEND_HTTP_${safeStatus}:${errorName}` };
    } catch (error) {
      if (
        error instanceof ProviderEgressBlockedError ||
        (error as { name?: unknown } | null)?.name === 'ProviderEgressBlockedError'
      ) {
        return { success: false, error: 'RESEND_EGRESS_BLOCKED' };
      }
      if (
        controller.signal.aborted ||
        (error as { name?: unknown } | null)?.name === 'AbortError'
      ) {
        return { success: false, error: 'RESEND_TIMEOUT' };
      }
      // Network-level failure — closed standard JS error name only.
      return { success: false, error: `RESEND_NETWORK:${classifyTransportErrorName(error)}` };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Header-injection protection: strip CR/LF and control characters, collapse whitespace,
 * bound the length. Applied to every subject before it reaches the provider.
 */
export function sanitizeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}
