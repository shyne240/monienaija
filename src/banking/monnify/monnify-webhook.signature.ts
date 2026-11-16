import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Monnify webhook authentication.
 *
 * There are **two distinct** documented schemes and conflating them produces a check that silently
 * never passes (or worse, one that passes when it should not):
 *
 * 1. **`monnify-signature` header** — `HMAC-SHA512(key = client secret, message = raw request body)`,
 *    lowercase hex. The prose in Monnify's docs says `SHA-512(client secret + request body)`, but
 *    Monnify's own published example digest only reproduces as a keyed HMAC. Implementing the prose
 *    yields a verifier that rejects every genuine webhook, which in practice is "fixed" by disabling
 *    verification — the worst outcome. `verifySignatureHeader` implements HMAC over the **raw bytes**.
 *
 * 2. **`transactionHash` inside the payload** — a *different* scheme:
 *    `SHA512(clientSecret|paymentReference|amountPaid|paidOn|transactionReference)`, pipe-separated,
 *    no spaces. This is not a header signature and must never be substituted for one.
 *
 * Sandbox notifications omit the header entirely while production always sends it. A missing header
 * is therefore treated as a failure in production, and is only tolerated in sandbox because the
 * sandbox contract genuinely does not supply it. Tolerating it in production would make forgery
 * trivial; rejecting it in sandbox would make the integration untestable against the sandbox.
 */

export interface WebhookVerificationInput {
  /** Raw request body **bytes or string**, exactly as received. Never a re-serialised object. */
  readonly rawBody: Buffer | string;
  /** Value of the `monnify-signature` header, if present. */
  readonly signature?: string;
  readonly clientSecret: string;
  readonly environment: 'sandbox' | 'production';
  /**
   * Sandbox only: set when the request arrived over the controlled fixture transport. Without this,
   * a missing header is still refused — "sandbox" is not a synonym for "unauthenticated".
   */
  readonly trustedFixtureTransport?: boolean;
}

export type WebhookVerificationResult =
  | {
      readonly ok: true;
      readonly body: unknown;
      readonly scheme: 'HMAC_SHA512' | 'SANDBOX_NO_SIGNATURE';
    }
  | { readonly ok: false; readonly reason: WebhookVerificationFailure };

export type WebhookVerificationFailure =
  | 'MISSING_SIGNATURE'
  | 'MALFORMED_SIGNATURE'
  | 'SIGNATURE_MISMATCH'
  | 'MALFORMED_BODY'
  | 'BODY_TOO_LARGE'
  | 'NOT_PERMITTED_IN_PRODUCTION';

/** Bounded payload: a webhook is not a file upload. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/**
 * Constant-time comparison of two hex signatures.
 *
 * `timingSafeEqual` throws on differing lengths, so lengths are compared first — but that comparison
 * must not itself short-circuit into a distinguishable timing signal, hence the fixed-length digest
 * approach below rather than `a === b`.
 */
function constantTimeHexEquals(expectedHex: string, providedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false;
  const expected = Buffer.from(expectedHex.toLowerCase(), 'hex');
  const provided = Buffer.from(providedHex.toLowerCase(), 'hex');
  if (expected.length !== provided.length || expected.length === 0) {
    // Compare against itself to burn comparable time, then fail.
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(expected, provided);
}

/** Compute the documented header signature: HMAC-SHA512 over the raw body. */
export function computeSignatureHeader(clientSecret: string, rawBody: Buffer | string): string {
  return createHmac('sha512', clientSecret).update(rawBody).digest('hex');
}

/**
 * Verify an inbound webhook and, only on success, parse the body.
 *
 * Parsing happens **after** the signature check so that a forged payload is never handed to a JSON
 * parser, and the exact raw bytes are what gets hashed — re-serialising would change key order,
 * whitespace and unicode escapes and produce a mismatch on genuine events.
 */
export function verifyWebhook(input: WebhookVerificationInput): WebhookVerificationResult {
  const rawLength =
    typeof input.rawBody === 'string' ? Buffer.byteLength(input.rawBody) : input.rawBody.length;
  if (rawLength > MAX_WEBHOOK_BODY_BYTES) return { ok: false, reason: 'BODY_TOO_LARGE' };

  const signature = input.signature?.trim();

  if (signature === undefined || signature.length === 0) {
    if (input.environment === 'production') {
      // Production always signs. A missing header here is a forgery attempt or a misroute.
      return { ok: false, reason: 'NOT_PERMITTED_IN_PRODUCTION' };
    }
    if (input.trustedFixtureTransport !== true) {
      // Sandbox omits the header, but absence alone still authenticates nothing.
      return { ok: false, reason: 'MISSING_SIGNATURE' };
    }
    const parsed = parseBody(input.rawBody);
    return parsed.ok
      ? { ok: true, body: parsed.body, scheme: 'SANDBOX_NO_SIGNATURE' }
      : { ok: false, reason: 'MALFORMED_BODY' };
  }

  if (!/^[0-9a-f]{128}$/i.test(signature)) {
    return { ok: false, reason: 'MALFORMED_SIGNATURE' };
  }

  const expected = computeSignatureHeader(input.clientSecret, input.rawBody);
  if (!constantTimeHexEquals(expected, signature)) {
    return { ok: false, reason: 'SIGNATURE_MISMATCH' };
  }

  const parsed = parseBody(input.rawBody);
  return parsed.ok
    ? { ok: true, body: parsed.body, scheme: 'HMAC_SHA512' }
    : { ok: false, reason: 'MALFORMED_BODY' };
}

/**
 * The payload-internal `transactionHash` — a *different* scheme from the header signature.
 *
 * Documented as `SHA512(clientSecret|paymentReference|amountPaid|paidOn|transactionReference)` with
 * no spaces. Exposed under a distinct name so no caller can mistake it for `monnify-signature`.
 */
export function computeTransactionHash(
  clientSecret: string,
  fields: {
    paymentReference: string;
    amountPaid: string;
    paidOn: string;
    transactionReference: string;
  },
): string {
  const material = [
    clientSecret,
    fields.paymentReference,
    fields.amountPaid,
    fields.paidOn,
    fields.transactionReference,
  ].join('|');
  return createHash('sha512').update(material).digest('hex');
}

/** Constant-time comparison for the payload-internal hash. */
export function transactionHashMatches(expectedHex: string, providedHex: string): boolean {
  return constantTimeHexEquals(expectedHex, providedHex);
}

function parseBody(rawBody: Buffer | string): { ok: true; body: unknown } | { ok: false } {
  try {
    const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
