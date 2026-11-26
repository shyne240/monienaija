import * as dns from 'node:dns';
import * as https from 'node:https';

import { isForbiddenOutboundIp } from '../../notification/provider-security';

/**
 * Closed set of documented Monnify paths.
 *
 * A union type, not a string, so a caller cannot construct a path at runtime and so a new endpoint
 * is a reviewed change rather than a template string. Only paths confirmed from Monnify's own
 * documentation or its official SDK constants appear here; nothing is guessed.
 */
export type MonnifyPath =
  | '/api/v1/auth/login'
  | '/api/v1/banks'
  | '/api/v1/sdk/transactions/banks'
  | '/api/v1/disbursements/account/validate'
  | '/api/v2/bank-transfer/reserved-accounts'
  | '/api/v2/disbursements/single'
  | '/api/v2/disbursements/single/validate-otp'
  // Documented refund contract. Activation is a separate owner decision; the path is allowlisted
  // so an activated contract does not need a code change, but the adapter still fails closed.
  | '/api/v1/refunds/initiate-refund'
  | '/api/v1/refunds'
  // Documented merchant transaction query, with transactionReference or paymentReference as a query parameter.
  | '/api/v2/merchant/transactions/query';

export type MonnifyHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface MonnifyHttpRequest {
  readonly method: MonnifyHttpMethod;
  /** Path, optionally with a documented query string. Never a full URL. */
  readonly path: string;
  /** `Authorization` header value. A Basic credential for login, a Bearer token otherwise. */
  readonly authorization: string;
  readonly body?: string;
}

export interface MonnifyHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface MonnifyHttpClient {
  send(request: MonnifyHttpRequest, signal: AbortSignal): Promise<MonnifyHttpResponse>;
}

export const MONNIFY_MAX_RESPONSE_BYTES = 256 * 1024;
export const MONNIFY_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Path allowlist. Query strings are permitted ONLY on the endpoints documented to take them, and the
 * prefix is matched exactly so `/api/v1/disbursements/account/validateX` cannot slip through.
 */
const EXACT_PATHS = new Set<string>([
  '/api/v1/auth/login',
  '/api/v1/banks',
  '/api/v1/sdk/transactions/banks',
  '/api/v2/bank-transfer/reserved-accounts',
  '/api/v2/disbursements/single',
  '/api/v2/disbursements/single/validate-otp',
  '/api/v1/refunds/initiate-refund',
  '/api/v1/settlements',
  // Documented server-to-server transaction verification (transactionReference/paymentReference
  // are query parameters, never path parameters).
  '/api/v2/merchant/transactions/query',
]);

/**
 * Prefixes that legitimately carry a path parameter, with the query allowance noted per entry.
 *
 * Matching requires a **segment boundary** after the prefix. `startsWith('/...validate')` alone would
 * accept `/.../validateX`, which is a different undocumented endpoint -- the kind of lookalike a
 * naive allowlist lets through. `segment: true` means the next character must be `/` or the end.
 */
const EXACT_PATHS_WITH_QUERY = new Set<string>([
  '/api/v1/disbursements/account/validate',
  '/api/v2/merchant/transactions/query',
]);

const PREFIX_PATHS: ReadonlyArray<{
  prefix: string;
  allowQuery: boolean;
  queryOnExact: boolean;
}> = [
  // Documented to take its parameters as a query string, with no path parameter.
  { prefix: '/api/v1/disbursements/account/validate', allowQuery: true, queryOnExact: true },
  // Documented to carry an account reference as a path parameter, with no query.
  { prefix: '/api/v2/bank-transfer/reserved-accounts/', allowQuery: false, queryOnExact: false },
  // Documented GET /api/v1/refunds/{refundReference} — one non-empty segment, no query string.
  { prefix: '/api/v1/refunds/', allowQuery: false, queryOnExact: false },
];

export function isAllowedMonnifyPath(path: string): boolean {
  const queryIndex = path.indexOf('?');
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const hasQuery = queryIndex !== -1;

  // Reject traversal and control/whitespace characters outright, before any matching.
  if (/[\s\\]|\.\./.test(pathname)) return false;

  if (EXACT_PATHS.has(pathname)) {
    return hasQuery ? EXACT_PATHS_WITH_QUERY.has(pathname) : true;
  }

  for (const entry of PREFIX_PATHS) {
    if (!pathname.startsWith(entry.prefix)) continue;
    const rest = pathname.slice(entry.prefix.length);
    if (entry.queryOnExact) {
      // Exact path only: any trailing segment would be a different endpoint.
      if (rest === '') return entry.allowQuery ? true : !hasQuery;
      continue;
    }
    // Path-parameter form: exactly one non-empty segment may follow the prefix. The prefix already
    // ends at a segment boundary, so `rest` IS that segment (no leading slash to strip).
    if (rest.length > 0 && !rest.includes('/')) {
      return entry.allowQuery ? true : !hasQuery;
    }
    return false;
  }
  return false;
}

/**
 * Hardened HTTPS transport.
 *
 * Reuses the protections proven by the KYC mission: fixed origin, single resolve, refusal of
 * non-public addresses, IP pinning with TLS hostname verification, redirects disabled, bounded body,
 * and a hard timeout. `https.request` is used rather than `fetch` specifically because `fetch`
 * follows redirects by default and would defeat the allowlist.
 */
export function createMonnifyHttpClient(
  options: {
    environment: 'sandbox' | 'production';
    lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
    request?: typeof https.request;
    timeoutMs?: number;
    maxBytes?: number;
  } = { environment: 'sandbox' },
): MonnifyHttpClient {
  const lookup =
    options.lookup ??
    ((hostname: string) => dns.promises.lookup(hostname, { all: true, verbatim: true }));
  const requestFn = options.request ?? https.request;
  const timeoutMs = options.timeoutMs ?? MONNIFY_REQUEST_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MONNIFY_MAX_RESPONSE_BYTES;

  // Sandbox and production are different hosts. Choosing per environment prevents a sandbox
  // credential being presented to production, and vice versa.
  const hostname = options.environment === 'production' ? 'api.monnify.com' : 'sandbox.monnify.com';

  return {
    async send(req, signal) {
      if (!isAllowedMonnifyPath(req.path) || signal.aborted) {
        throw new Error('Blocked');
      }
      const addresses = await lookup(hostname);
      if (
        signal.aborted ||
        addresses.length === 0 ||
        addresses.some((a) => isForbiddenOutboundIp(a.address))
      ) {
        throw new Error('Blocked');
      }
      const pinned = addresses[0]!;

      return new Promise<MonnifyHttpResponse>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };
        const timer = setTimeout(() => {
          finish(() => reject(new Error('Timeout')));
          request.destroy();
        }, timeoutMs);

        const request = requestFn(
          {
            protocol: 'https:',
            hostname,
            port: 443,
            servername: hostname,
            path: req.path,
            method: req.method,
            agent: false,
            headers: {
              authorization: req.authorization,
              'content-type': 'application/json',
              accept: 'application/json',
              ...(req.body === undefined
                ? {}
                : { 'content-length': Buffer.byteLength(req.body).toString() }),
            },
            // Pin to the validated address while TLS still verifies `hostname`.
            lookup: (_host, _opts, callback) => {
              callback(null, pinned.address, pinned.family);
            },
          },
          (response) => {
            // Any redirect is a refusal: following one would leave the allowlisted origin.
            const status = response.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              response.destroy();
              finish(() => reject(new Error('Blocked')));
              return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            response.on('data', (chunk: Buffer) => {
              total += chunk.length;
              if (total > maxBytes) {
                response.destroy();
                finish(() => reject(new Error('Blocked')));
                return;
              }
              chunks.push(chunk);
            });
            response.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              let parsed: unknown = undefined;
              if (text.trim().length > 0) {
                try {
                  parsed = JSON.parse(text);
                } catch {
                  parsed = undefined;
                }
              }
              finish(() => resolve({ status, body: parsed }));
            });
            response.on('error', () => finish(() => reject(new Error('Transport failure'))));
          },
        );
        request.on('error', () => finish(() => reject(new Error('Transport failure'))));
        if (req.body !== undefined) request.write(req.body);
        request.end();
      });
    },
  };
}

/**
 * Documented Basic credential for `/auth/login`.
 *
 * Built per call from resolved configuration and never stored on the client, so the credential does
 * not sit in an object that might be serialised into a log line or an error report.
 */
export function basicAuthorization(apiKey: string, secretKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${secretKey}`, 'utf8').toString('base64')}`;
}
