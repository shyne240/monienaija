import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Alert, AlertChannel } from './alerting.types';
import { NoneAlertChannel } from './alerting.service';

/**
 * ARENA 3D Group 38 — a real alert channel.
 *
 * ## The gap
 *
 * Group 19 built alert evaluation with a delivery seam and one implementation: `NoneAlertChannel`, which
 * reports `delivered: false` and a reason. That was the right default — an unconfigured deployment must
 * not appear to have paged anyone — but it means that until now **no alert had ever left the process**.
 * "Alerting works" was a statement about suppression and deduplication, not about delivery.
 *
 * This module adds the missing implementation: a signed HTTPS webhook, with a timeout and an honest
 * result. It does not add an escalation policy, an on-call rotation, retries or a dead-letter queue —
 * those are named as gaps below, not quietly implied by the word "delivery".
 *
 * ## Why a signature
 *
 * An alert body is an operational fact: it names outages, queues and failures. An unauthenticated
 * webhook lets anyone who learns the URL inject incidents into a paging system, and lets anyone who can
 * observe the traffic replay them. Every request therefore carries an HMAC over
 * `timestamp + '.' + body`, computed with a shared secret, and the receiver is expected to reject a
 * timestamp outside a small window. `verifyAlertSignature` is exported so a receiver — and the test in
 * this repository — checks the same bytes the sender signed rather than a re-serialisation.
 *
 * ## Why `delivered` is not a guess
 *
 * `delivered: true` means the receiver answered 2xx. Anything else — a non-2xx, a timeout, a DNS
 * failure, a TLS refusal — is `delivered: false` with the reason, and `AlertingService` records that
 * reason in `dispatched[].reason`. A channel that returned `true` on a failed POST would make the
 * alerting system lie in exactly the moment it exists to be honest.
 */

export const ALERT_WEBHOOK_URL = 'ALERT_WEBHOOK_URL';
export const ALERT_WEBHOOK_SECRET = 'ALERT_WEBHOOK_SECRET';
export const ALERT_WEBHOOK_TIMEOUT_MS = 'ALERT_WEBHOOK_TIMEOUT_MS';

export const DEFAULT_TIMEOUT_MS = 5_000;

export interface WebhookChannelConfig {
  readonly url: string;
  readonly secret: string;
  readonly timeoutMs: number;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number }>;

/** Whether a host may be reached over plain HTTP. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
  );
}

/**
 * Validates a webhook URL.
 *
 * HTTPS is required. Plain HTTP is accepted only for a loopback host outside production, which is what
 * a local receiver uses; the production refusal matters because an alert names the system's failures
 * and a cleartext alert is an intelligence feed for anyone on the path.
 */
export function validateWebhookUrl(raw: string, nodeEnv: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${ALERT_WEBHOOK_URL} is not a valid URL`);
  }
  if (parsed.protocol === 'https:') return trimmed;
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname) && nodeEnv !== 'production') {
    return trimmed;
  }
  throw new Error(
    `${ALERT_WEBHOOK_URL} must be https${nodeEnv === 'production' ? '' : ' (http is allowed only for a loopback host outside production)'}`,
  );
}

/**
 * Resolves the channel configuration from the environment.
 *
 * Half-configured is an error, not a silent fallback: a deployment that sets a URL and forgets the
 * secret would otherwise run with delivery dark while its configuration says it is on.
 */
export function resolveWebhookConfig(
  env: Record<string, string | undefined>,
): WebhookChannelConfig | null {
  const url = env[ALERT_WEBHOOK_URL]?.trim() ?? '';
  const secret = env[ALERT_WEBHOOK_SECRET]?.trim() ?? '';
  if (url === '' && secret === '') return null;
  if (url === '') throw new Error(`${ALERT_WEBHOOK_SECRET} is set but ${ALERT_WEBHOOK_URL} is not`);
  if (secret === '')
    throw new Error(`${ALERT_WEBHOOK_URL} is set but ${ALERT_WEBHOOK_SECRET} is not`);

  const timeoutRaw = env[ALERT_WEBHOOK_TIMEOUT_MS]?.trim() ?? '';
  const timeoutMs = timeoutRaw === '' ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${ALERT_WEBHOOK_TIMEOUT_MS} must be a positive number of milliseconds`);
  }

  return { url: validateWebhookUrl(url, env.NODE_ENV ?? 'development'), secret, timeoutMs };
}

/** The signed payload's digest: HMAC-SHA256 over `timestamp.body`, hex encoded. */
export function signAlertBody(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Verifies a received request. Exported so a receiver checks the same bytes the sender signed.
 *
 * `maxSkewMs` bounds replay; a receiver that ignores the timestamp has a signature that stays valid
 * forever, which is a signature in name only.
 */
export function verifyAlertSignature(options: {
  secret: string;
  timestamp: string;
  body: string;
  signature: string;
  nowMs?: number;
  maxSkewMs?: number;
}): { valid: boolean; reason?: string } {
  const expected = signAlertBody(options.secret, options.timestamp, options.body);
  const received = options.signature.replace(/^sha256=/, '');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) {
    return { valid: false, reason: 'signature length mismatch' };
  }
  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return { valid: false, reason: 'signature mismatch' };
  }

  const sentAt = Number(options.timestamp);
  if (!Number.isFinite(sentAt)) return { valid: false, reason: 'timestamp is not a number' };
  const skew = Math.abs((options.nowMs ?? Date.now()) - sentAt);
  const maxSkew = options.maxSkewMs ?? 300_000;
  if (skew > maxSkew) return { valid: false, reason: `timestamp outside the ${maxSkew}ms window` };
  return { valid: true };
}

export class WebhookAlertChannel implements AlertChannel {
  readonly name = 'webhook';
  readonly configured = true;

  constructor(
    private readonly config: WebhookChannelConfig,
    private readonly fetchImpl: FetchLike = (url, init) =>
      fetch(url, init) as unknown as Promise<{ status: number }>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async deliver(alert: Alert): Promise<{ delivered: boolean; reason?: string }> {
    const timestamp = String(this.now());
    const body = JSON.stringify(alert);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    timer.unref?.();

    try {
      const response = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-monienaija-timestamp': timestamp,
          'x-monienaija-signature': `sha256=${signAlertBody(this.config.secret, timestamp, body)}`,
        },
        body,
        signal: controller.signal,
      });
      if (response.status >= 200 && response.status < 300) {
        return { delivered: true };
      }
      return { delivered: false, reason: `receiver answered HTTP ${String(response.status)}` };
    } catch (error) {
      const aborted = controller.signal.aborted;
      return {
        delivered: false,
        reason: aborted
          ? `delivery timed out after ${String(this.config.timeoutMs)}ms`
          : `delivery failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Builds the channel a deployment asked for.
 *
 * Unconfigured means `NoneAlertChannel`: alerts are evaluated and recorded, and the report says nobody
 * was paged. A misconfigured webhook throws at startup rather than degrading silently.
 */
export function createAlertChannel(
  env: Record<string, string | undefined>,
  fetchImpl?: FetchLike,
): AlertChannel {
  const config = resolveWebhookConfig(env);
  if (config === null) return new NoneAlertChannel();
  return fetchImpl === undefined
    ? new WebhookAlertChannel(config)
    : new WebhookAlertChannel(config, fetchImpl);
}
