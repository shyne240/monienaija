import type {
  NotificationProvider,
  NotificationSendRequest,
  NotificationSendResult,
} from './notification.types';
import {
  ProviderEgressBlockedError,
  classifyRobaseErrorType,
  classifyTransportErrorName,
  createPinnedProviderHttpFetch,
  deriveSafeVendorProviderRef,
  formatSafeHttpStatus,
  isPinnedProviderEndpointUrl,
} from './provider-security';

/**
 * SMS-V1-01 — Robase production SMS provider adapter.
 *
 * Verified official contract (docs.robase.dev / robase.dev/docs, fetched 2026-09-28):
 * - Base URL: https://api.robase.dev
 * - Auth: `Authorization: Bearer robe_<64 hex>` (live keys carry the `robe_` prefix)
 * - Send transactional SMS: `POST /v1/sms/send`
 *     request body: { "phone_number": "+2348012345678", "message": "...", "metadata": {} }
 *     200 response:   { id, phone_number, country_code, credit_cost, status: "pending",
 *                       created_at, segments, encoding, sanitized }
 * - Idempotency: `Idempotency-Key` header — replay within 24h returns the original response
 *     (`Idempotent-Replayed: true`) instead of sending twice. We always send one.
 * - Error envelope: `{ "error": { "type": "<stable code>", "message": "<prose>" } }`; only
 *     `error.type` is consumed (stable); prose is never surfaced.
 * - Delivery status: API status transitions pending → sent → delivered (or failed);
 *     `GET /v1/sms/{id}` and webhooks (sms.sent/sms.delivered/sms.failed) exist but are a
 *     documented separate enhancement — SENT here strictly means "accepted by Robase".
 * - Sender identity is workspace-level configuration on the Robase account; the verified
 *     /v1/sms/send contract carries NO sender-id request field, therefore none is sent.
 *
 * Security properties:
 * - The API key only ever appears in the Authorization header; this class never logs,
 *   throws, or returns the key, headers, or full response bodies.
 * - Provider failure returns success=false; it never throws into financial execution.
 */
export interface RobaseProviderConfig {
  baseUrl: string;
  apiKey: string;
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

const DEFAULT_ROBASE_FETCH: FetchImplementation =
  createPinnedProviderHttpFetch() as unknown as FetchImplementation;

export class RobaseNotificationProvider implements NotificationProvider {
  readonly name = 'robase';

  constructor(
    private readonly config: RobaseProviderConfig,
    private readonly fetchImpl: FetchImplementation = DEFAULT_ROBASE_FETCH,
  ) {}

  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    if (request.channel !== 'SMS') {
      // Robase adapter is SMS-only; PUSH remains a documented dependency (no device-token model).
      const safeChannel = request.channel === 'EMAIL' ? 'EMAIL' : 'PUSH';
      return { success: false, error: `ROBASE_UNSUPPORTED_CHANNEL:${safeChannel}` };
    }

    const destination = this.toE164(request.destination);
    if (!destination) {
      return { success: false, error: 'ROBASE_INVALID_DESTINATION' };
    }

    const endpointUrl = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/sms/send`;
    if (!isPinnedProviderEndpointUrl('robase', endpointUrl)) {
      return { success: false, error: 'ROBASE_EGRESS_BLOCKED' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
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
        body: JSON.stringify({
          phone_number: destination,
          message: request.message.slice(0, 1000),
          // Non-secret identifiers only; no aggregate ids, no financial internals.
          metadata: { event_type: request.eventType },
        }),
        signal: controller.signal,
        redirect: 'error',
      });

      if (response.status >= 300 && response.status < 400) {
        return { success: false, error: 'ROBASE_EGRESS_BLOCKED' };
      }

      if (response.ok) {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          return { success: false, error: 'ROBASE_UNRECOGNIZED_SUCCESS_RESPONSE' };
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return { success: false, error: 'ROBASE_UNRECOGNIZED_SUCCESS_RESPONSE' };
        }
        const safeProviderRef = deriveSafeVendorProviderRef(
          'robase',
          (body as { id?: unknown }).id,
          this.config.apiKey,
        );
        if (safeProviderRef) {
          return { success: true, providerRef: safeProviderRef };
        }
        return { success: false, error: 'ROBASE_UNRECOGNIZED_SUCCESS_RESPONSE' };
      }

      // Failure envelope: classify error.type strictly against the closed allowlist;
      // never echo unrecognized upstream tokens, prose, or bodies.
      let errorType = 'unknown';
      try {
        const errBody = (await response.json()) as { error?: { type?: unknown } };
        errorType = classifyRobaseErrorType(errBody?.error?.type);
      } catch {
        // Non-JSON error body — keep the generic type.
      }
      const safeStatus = formatSafeHttpStatus(response.status);
      return { success: false, error: `ROBASE_HTTP_${safeStatus}:${errorType}` };
    } catch (error) {
      if (
        error instanceof ProviderEgressBlockedError ||
        (error as { name?: unknown } | null)?.name === 'ProviderEgressBlockedError'
      ) {
        return { success: false, error: 'ROBASE_EGRESS_BLOCKED' };
      }
      if (
        controller.signal.aborted ||
        (error as { name?: unknown } | null)?.name === 'AbortError'
      ) {
        return { success: false, error: 'ROBASE_TIMEOUT' };
      }
      // Network-level failure — closed standard JS error name only.
      return { success: false, error: `ROBASE_NETWORK:${classifyTransportErrorName(error)}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * The repository's authoritative normalization (CustomerService.normalizeContact) strips
   * separators and guarantees `^\+?[1-9]\d{7,14}$` with no leading zero — the only missing
   * piece for the provider's E.164 requirement is the '+' prefix. No second phone source,
   * no re-normalization rules invented here.
   */
  private toE164(destination: string): string | null {
    const trimmed = destination.trim();
    if (!/^\+?[1-9]\d{7,14}$/.test(trimmed)) return null;
    return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  }
}
