import type { BankingProviderError, BankingProviderErrorCategory } from '../banking-provider.types';

/**
 * Normalized Monnify errors.
 *
 * Every Monnify failure is translated into one of our own stable codes at the adapter edge. Nothing
 * downstream sees a raw provider payload: raw payloads routinely contain the merchant contract code,
 * customer email and account details, and are not safe to log or return.
 *
 * Two provider behaviours are encoded here rather than assumed:
 *
 * 1. **HTTP 200 does not mean success.** Monnify answers many rejections with `200` and
 *    `requestSuccessful:false`. Callers must read the envelope, so `fromMonnifyEnvelope` decides on
 *    `requestSuccessful` and the business `responseCode`, never on the HTTP status.
 * 2. **A timeout is not a rejection.** `TIMEOUT` is its own category, and every money-moving call
 *    treats it as `UNKNOWN` — something may have been accepted.
 */

export type MonnifyErrorCode =
  | 'MONNIFY_INVALID_INPUT'
  | 'MONNIFY_NOT_CONFIGURED'
  | 'MONNIFY_AUTHENTICATION_FAILED'
  | 'MONNIFY_ENTITLEMENT_DENIED'
  | 'MONNIFY_CAPABILITY_UNSUPPORTED'
  | 'MONNIFY_RATE_LIMITED'
  | 'MONNIFY_TRANSPORT_FAILED'
  | 'MONNIFY_TIMEOUT'
  | 'MONNIFY_MALFORMED_RESPONSE'
  | 'MONNIFY_REJECTED';

const CATEGORY_BY_CODE: Readonly<Record<MonnifyErrorCode, BankingProviderErrorCategory>> = {
  MONNIFY_INVALID_INPUT: 'VALIDATION',
  MONNIFY_NOT_CONFIGURED: 'CONFIGURATION',
  MONNIFY_AUTHENTICATION_FAILED: 'AUTHENTICATION',
  MONNIFY_ENTITLEMENT_DENIED: 'ENTITLEMENT',
  MONNIFY_CAPABILITY_UNSUPPORTED: 'CAPABILITY',
  MONNIFY_RATE_LIMITED: 'RATE_LIMITED',
  MONNIFY_TRANSPORT_FAILED: 'TRANSPORT',
  MONNIFY_TIMEOUT: 'TIMEOUT',
  MONNIFY_MALFORMED_RESPONSE: 'CONTRACT',
  MONNIFY_REJECTED: 'PROVIDER_REJECTED',
};

/**
 * Builds a normalized error. `detail` is authored by us; provider text is only included where it is
 * provably non-sensitive and always passes through `sanitizeProviderText`.
 */
export function monnifyError(
  code: MonnifyErrorCode,
  detail: string,
  providerCode?: string,
): BankingProviderError {
  return {
    category: CATEGORY_BY_CODE[code],
    code,
    detail,
    ...(providerCode === undefined ? {} : { providerCode }),
  };
}

/** Monnify's envelope. `responseBody` is `unknown` on purpose: each capability validates it. */
export interface MonnifyEnvelope {
  requestSuccessful?: unknown;
  responseMessage?: unknown;
  responseCode?: unknown;
  responseBody?: unknown;
}

const RATE_LIMIT_CODES = new Set(['429', '99']);
const ENTITLEMENT_PATTERN = /not\s+(?:enabled|entitled|authori[sz]ed|allowed)|product\s+not/i;

/**
 * Maps a Monnify envelope to either its body or a normalized error.
 *
 * Entitlement refusals are separated from generic rejection because the remedy differs completely:
 * entitlement is a commercial conversation, a rejection is a business outcome.
 */
export function fromMonnifyEnvelope(
  envelope: unknown,
): { ok: true; body: unknown } | { ok: false; error: BankingProviderError } {
  if (typeof envelope !== 'object' || envelope === null) {
    return {
      ok: false,
      error: monnifyError('MONNIFY_MALFORMED_RESPONSE', 'Response was not an object'),
    };
  }
  const e = envelope as MonnifyEnvelope;
  const responseCode = typeof e.responseCode === 'string' ? e.responseCode : undefined;
  const message = sanitizeProviderText(e.responseMessage);

  if (e.requestSuccessful === true) {
    // A non-zero code alongside `requestSuccessful:true` can mean a business state (a pending
    // transfer), so it is not an error when the request itself succeeded.
    return { ok: true, body: e.responseBody };
  }

  if (e.requestSuccessful === false) {
    if (message !== undefined && ENTITLEMENT_PATTERN.test(message)) {
      return {
        ok: false,
        error: monnifyError(
          'MONNIFY_ENTITLEMENT_DENIED',
          'Provider refused: not entitled to this product',
          responseCode,
        ),
      };
    }
    if (responseCode !== undefined && RATE_LIMIT_CODES.has(responseCode)) {
      return {
        ok: false,
        error: monnifyError('MONNIFY_RATE_LIMITED', 'Provider rate limit reached', responseCode),
      };
    }
    return {
      ok: false,
      error: monnifyError(
        'MONNIFY_REJECTED',
        message ?? 'Provider rejected the request',
        responseCode,
      ),
    };
  }

  // `requestSuccessful` absent: nothing can be concluded, so success is not concluded.
  return {
    ok: false,
    error: monnifyError(
      'MONNIFY_MALFORMED_RESPONSE',
      'Response envelope was missing requestSuccessful',
    ),
  };
}

/**
 * Matches a credential assignment and everything to the end of that token *run*.
 *
 * The naive `\S+` stops at the first space, so `authorization: Bearer abc.def` becomes
 * `[REDACTED] abc.def` — the credential survives, which is worse than not scrubbing at all because
 * it looks handled. Allow an optional scheme word and then consume the remaining non-space text.
 */
const SENSITIVE_PATTERN =
  /(api[_-]?key|secret|token|password|authorization)\s*[:=]\s*(?:bearer|basic)?\s*[^\s,;]+/gi;

/**
 * Last-resort scrub for provider-authored text.
 *
 * Provider messages are useful and worth keeping, but they occasionally echo a key or header when
 * misconfigured. Strip anything resembling a credential assignment rather than gambling that this
 * particular message is safe.
 */
export function sanitizeProviderText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const scrubbed = trimmed.replace(SENSITIVE_PATTERN, '[REDACTED]');
  return scrubbed.length > 500 ? `${scrubbed.slice(0, 497)}...` : scrubbed;
}
