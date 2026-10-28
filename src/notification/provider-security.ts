import * as dns from 'node:dns';
import * as https from 'node:https';
import * as net from 'node:net';

import { BadRequestException } from '@nestjs/common';

/**
 * Closed vendor error-code allowlists and pinned vendor egress guards for notification providers.
 *
 * Security invariants (Sprint 1 Remediation F-01 & F-02):
 * 1. Upstream provider error fields (`error.type`, `code`, `name`) and runtime `Error.name`
 *    are NEVER echoed through character-class regexes. Only exact members of closed,
 *    security-reviewed sets are retained; every other value collapses to a generic fixed token.
 * 2. Outbound provider HTTP requests are pinned to exact canonical HTTPS vendor origins with
 *    no custom ports, no userinfo credentials, no query strings/fragments, no path overrides,
 *    no HTTP redirect following (`3xx` rejected before reading `Location`), and connection-time
 *    DNS/IP validation blocking loopback, private, link-local, carrier-NAT, multicast, and
 *    cloud-metadata IPv4/IPv6 ranges (including DNS-rebinding defense via single-lookup IP pinning).
 */

export type ExternalNotificationVendor = 'robase' | 'brevo' | 'resend';

export const PINNED_PROVIDER_ORIGINS: Readonly<
  Record<ExternalNotificationVendor, ReadonlySet<string>>
> = {
  robase: new Set(['https://api.robase.dev']),
  brevo: new Set(['https://api.brevo.com']),
  resend: new Set(['https://api.resend.com']),
};

export const PINNED_PROVIDER_ENDPOINTS: Readonly<
  Record<ExternalNotificationVendor, ReadonlySet<string>>
> = {
  robase: new Set(['/v1/sms/send']),
  brevo: new Set(['/v3/smtp/email', '/v3/account', '/v3/senders']),
  resend: new Set(['/emails']),
};

export const CLOSED_ROBASE_ERROR_TYPES: ReadonlySet<string> = new Set([
  'authentication_error',
  'invalid_api_key',
  'unauthorized',
  'forbidden',
  'insufficient_credits',
  'rate_limit_exceeded',
  'rate_limited',
  'validation_error',
  'invalid_request',
  'invalid_phone_number',
  'unsupported_destination',
  'idempotency_conflict',
  'server_error',
  'service_unavailable',
]);

export const CLOSED_BREVO_ERROR_CODES: ReadonlySet<string> = new Set([
  'unauthorized',
  'permission_denied',
  'account_under_validation',
  'not_enough_credits',
  'reseller_permission_denied',
  'document_not_found',
  'method_not_allowed',
  'missing_parameter',
  'invalid_parameter',
  'duplicate_parameter',
  'out_of_range',
  'too_many_requests',
  'internal_error',
  'service_unavailable',
]);

export const CLOSED_RESEND_ERROR_CODES: ReadonlySet<string> = new Set([
  'validation_error',
  'rate_limited',
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
  'invalid_from_address',
  'not_found',
  'method_not_allowed',
  'application_error',
  'internal_server_error',
  'security_error',
]);

export const CLOSED_TRANSPORT_ERROR_NAMES: ReadonlySet<string> = new Set([
  'TypeError',
  'RangeError',
  'SyntaxError',
  'URIError',
  'Error',
]);

const CLOSED_FIRST_PARTY_PROVIDER_ERROR_CODES: ReadonlySet<string> = new Set([
  'PROVIDER_FAILURE',
  'PROVIDER_NOT_CONFIGURED',
  'SMS_PROVIDER_NOT_CONFIGURED',
  'EMAIL_PROVIDER_NOT_CONFIGURED',
  'SMS_PROVIDER_DISABLED',
  'EMAIL_PROVIDER_DISABLED',
  'EMAIL_SENDER_NOT_CONFIGURED',
  'CONSOLE_FORBIDDEN_IN_PRODUCTION',
  'PROVIDER_ENV_SECRET_MISSING',
  'PROVIDER_SECRET_DECRYPT_FAILED',
  'PROVIDER_ENCRYPTION_KEY_MISSING',
  'PROVIDER_ENCRYPTION_KEY_VERSION_MISSING',
  'PROVIDER_BASE_URL_UNTRUSTED',
  'ROBASE_CONFIG_INVALID',
  'RESEND_CONFIG_INVALID',
  'VERIFY_FAILED',
  'ROBASE_TIMEOUT',
  'ROBASE_INVALID_DESTINATION',
  'ROBASE_UNRECOGNIZED_SUCCESS_RESPONSE',
  'ROBASE_UNSUPPORTED_CHANNEL:PUSH',
  'ROBASE_UNSUPPORTED_CHANNEL:EMAIL',
  'ROBASE_EGRESS_BLOCKED',
  'BREVO_TIMEOUT',
  'BREVO_SMTP_KEY_NOT_SUPPORTED',
  'BREVO_INVALID_KEY_PREFIX',
  'BREVO_INVALID_SENDER',
  'BREVO_INVALID_DESTINATION',
  'BREVO_EMPTY_SUBJECT',
  'BREVO_EMPTY_BODY',
  'BREVO_INVALID_REPLY_TO',
  'BREVO_INVALID_RESPONSE',
  'BREVO_SENDERS_INVALID_RESPONSE',
  'BREVO_SENDER_NOT_VERIFIED',
  'BREVO_EGRESS_BLOCKED',
  'RESEND_TIMEOUT',
  'RESEND_INVALID_DESTINATION',
  'RESEND_MISSING_SUBJECT',
  'RESEND_EMPTY_BODY',
  'RESEND_UNRECOGNIZED_SUCCESS_RESPONSE',
  'RESEND_UNSUPPORTED_CHANNEL:SMS',
  'RESEND_UNSUPPORTED_CHANNEL:PUSH',
  'RESEND_EGRESS_BLOCKED',
]);

const STRICT_ORIGIN_SYNTAX = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/;
const STRUCTURED_HTTP_CODE =
  /^(ROBASE|BREVO|BREVO_VERIFY|BREVO_SENDERS|RESEND)_HTTP_([1-5][0-9]{2}|000)(?::(.*))?$/;
const STRUCTURED_NETWORK_CODE = /^(ROBASE|BREVO|RESEND)_NETWORK:(.*)$/;

export function classifyRobaseErrorType(rawType: unknown): string {
  if (typeof rawType !== 'string') return 'unknown';
  const normalized = rawType.trim().toLowerCase();
  return CLOSED_ROBASE_ERROR_TYPES.has(normalized) ? normalized : 'unknown';
}

export function classifyBrevoErrorCode(rawCode: unknown): string | null {
  if (typeof rawCode !== 'string') return null;
  const normalized = rawCode.trim().toLowerCase();
  return CLOSED_BREVO_ERROR_CODES.has(normalized) ? normalized : null;
}

export function classifyResendErrorCode(rawCode: unknown): string {
  if (typeof rawCode !== 'string') return 'unknown';
  const normalized = rawCode.trim().toLowerCase();
  return CLOSED_RESEND_ERROR_CODES.has(normalized) ? normalized : 'unknown';
}

export function classifyTransportErrorName(error: unknown): string {
  const rawName = (error as { name?: unknown } | null | undefined)?.name;
  if (typeof rawName !== 'string') return 'Error';
  return CLOSED_TRANSPORT_ERROR_NAMES.has(rawName) ? rawName : 'Error';
}

export function formatSafeHttpStatus(status: unknown): string {
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    return String(status);
  }
  return '000';
}

/**
 * Defense-in-depth boundary normalizer applied before persisting, auditing, or returning any
 * provider error code (`test-send`, `recordTestSendOutcome`, `verify`, `provider-status`,
 * `provider-config`). Any unrecognized code or untrusted suffix collapses to a closed token.
 */
export function normalizeProviderErrorCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return 'PROVIDER_FAILURE';
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (CLOSED_FIRST_PARTY_PROVIDER_ERROR_CODES.has(trimmed)) {
    return trimmed;
  }

  const httpMatch = STRUCTURED_HTTP_CODE.exec(trimmed);
  if (httpMatch) {
    const prefix = httpMatch[1]!;
    const status = httpMatch[2]!;
    const suffix = httpMatch[3];

    if (prefix === 'ROBASE') {
      const safeType = suffix ? classifyRobaseErrorType(suffix) : 'unknown';
      return `ROBASE_HTTP_${status}:${safeType}`;
    }
    if (prefix === 'RESEND') {
      const safeName = suffix ? classifyResendErrorCode(suffix) : 'unknown';
      return `RESEND_HTTP_${status}:${safeName}`;
    }
    const safeBrevo = suffix ? classifyBrevoErrorCode(suffix) : null;
    return safeBrevo ? `${prefix}_HTTP_${status}:${safeBrevo}` : `${prefix}_HTTP_${status}`;
  }

  const netMatch = STRUCTURED_NETWORK_CODE.exec(trimmed);
  if (netMatch) {
    const prefix = netMatch[1]!;
    const rawErrName = netMatch[2] ?? '';
    const safeErrName = CLOSED_TRANSPORT_ERROR_NAMES.has(rawErrName) ? rawErrName : 'Error';
    return `${prefix}_NETWORK:${safeErrName}`;
  }

  return 'PROVIDER_FAILURE';
}

export function isExternalNotificationVendor(
  provider: string,
): provider is ExternalNotificationVendor {
  return provider === 'robase' || provider === 'brevo' || provider === 'resend';
}

/**
 * Validates and canonicalizes a provider base URL against the closed per-vendor HTTPS origin
 * allowlist. Rejects arbitrary public domains, lookalikes, non-HTTPS schemes, explicit ports
 * (including `:443`), userinfo credentials, paths, query strings, fragments, and IP literals.
 */
export function validatePinnedProviderBaseUrl(provider: string, rawUrl: string): string {
  if (!isExternalNotificationVendor(provider)) {
    throw new BadRequestException(`Provider "${provider}" does not accept an external baseUrl.`);
  }
  if (typeof rawUrl !== 'string') {
    throw new BadRequestException('baseUrl must be a string.');
  }
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (trimmed.length === 0 || trimmed.length > 2048) {
    throw new BadRequestException('baseUrl must be between 1 and 2048 characters.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException('baseUrl must be a valid HTTPS URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('baseUrl must use https://.');
  }
  if (parsed.username || parsed.password || trimmed.includes('@')) {
    throw new BadRequestException('baseUrl must not contain embedded credentials.');
  }
  if (parsed.search || parsed.hash || trimmed.includes('?') || trimmed.includes('#')) {
    throw new BadRequestException('baseUrl must not include query strings or URL fragments.');
  }
  if (parsed.port !== '') {
    throw new BadRequestException('baseUrl must not specify a custom or explicit port.');
  }
  if (parsed.pathname !== '/') {
    throw new BadRequestException('baseUrl must not contain a URL path suffix.');
  }

  const normalized = trimmed.toLowerCase();
  if (!STRICT_ORIGIN_SYNTAX.test(normalized) || parsed.origin !== normalized) {
    throw new BadRequestException(
      'baseUrl must be a canonical HTTPS vendor origin without ports, IP literals, or trailing dots.',
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (net.isIP(host) !== 0) {
    throw new BadRequestException('IP-literal baseUrl values are forbidden.');
  }

  const allowedOrigins = PINNED_PROVIDER_ORIGINS[provider];
  if (!allowedOrigins.has(normalized)) {
    const allowedList = Array.from(allowedOrigins).join(', ');
    throw new BadRequestException(
      `Untrusted baseUrl for provider "${provider}". Allowed vendor origin: ${allowedList}.`,
    );
  }

  return normalized;
}

export function isPinnedProviderBaseUrl(
  provider: string,
  rawUrl: string | null | undefined,
): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    validatePinnedProviderBaseUrl(provider, rawUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates the exact outbound endpoint URL immediately prior to adapter dispatch so API keys
 * never leave memory if an untrusted baseUrl or path was passed directly to an adapter.
 */
export function isPinnedProviderEndpointUrl(
  vendor: ExternalNotificationVendor,
  fullUrl: string,
): boolean {
  if (typeof fullUrl !== 'string' || fullUrl.length === 0 || fullUrl.length > 2048) {
    return false;
  }
  if (fullUrl.includes('@') || fullUrl.includes('?') || fullUrl.includes('#')) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(fullUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username || parsed.password) {
    return false;
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return false;
  }
  // Reject explicit default port `:443` in raw authority (`https://api.robase.dev:443/...`).
  const expectedPrefix = `${parsed.origin}/`;
  if (!fullUrl.startsWith(expectedPrefix)) {
    return false;
  }
  if (!PINNED_PROVIDER_ORIGINS[vendor].has(parsed.origin)) {
    return false;
  }
  return PINNED_PROVIDER_ENDPOINTS[vendor].has(parsed.pathname);
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function isForbiddenIpv4Octets([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/broadcast
  return false;
}

function expandIpv6Hextets(rawIp: string): number[] | null {
  const zoneStripped = rawIp.split('%')[0]!.toLowerCase();
  if (net.isIPv6(zoneStripped) === false) return null;

  let working = zoneStripped;
  // Convert trailing dotted-quad IPv4 (`::ffff:169.254.169.254`) into two 16-bit hextets.
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const octets = parseIpv4Octets(working.slice(lastColon + 1));
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const halves = working.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = halves.length === 2 ? 8 - (left.length + right.length) : 0;
  if (
    (halves.length === 1 && left.length !== 8) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null;
  }

  const full = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (full.length !== 8) return null;
  const values: number[] = [];
  for (const h of full) {
    const parsed = Number.parseInt(h, 16);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffff) return null;
    values.push(parsed);
  }
  return values;
}

/**
 * Returns `true` for any non-public, loopback, private, link-local, metadata, multicast,
 * documentation, NAT64/6to4-embedded-private, or malformed IPv4/IPv6 address (fail-closed).
 */
export function isForbiddenOutboundIp(rawIp: string): boolean {
  if (typeof rawIp !== 'string' || rawIp.trim().length === 0) return true;
  const trimmed = rawIp.trim().replace(/^\[|\]$/g, '');
  const version = net.isIP(trimmed);
  if (version === 4) {
    const octets = parseIpv4Octets(trimmed);
    return octets ? isForbiddenIpv4Octets(octets) : true;
  }
  if (version === 6) {
    if (trimmed.includes('%')) return true; // Scoped link-local zone index
    const hextets = expandIpv6Hextets(trimmed);
    if (!hextets) return true;

    const allZeroPrefix =
      hextets[0] === 0 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0;

    // Unspecified `::` or loopback `::1`
    if (allZeroPrefix && hextets[5] === 0 && hextets[6] === 0 && hextets[7]! <= 1) {
      return true;
    }

    // IPv4-mapped `::ffff:0:0/96` or IPv4-compatible `::/96`
    if (allZeroPrefix && (hextets[5] === 0xffff || hextets[5] === 0)) {
      const embedded: [number, number, number, number] = [
        (hextets[6]! >> 8) & 0xff,
        hextets[6]! & 0xff,
        (hextets[7]! >> 8) & 0xff,
        hextets[7]! & 0xff,
      ];
      return isForbiddenIpv4Octets(embedded);
    }

    // NAT64 well-known prefix `64:ff9b::/96`
    if (
      hextets[0] === 0x0064 &&
      hextets[1] === 0xff9b &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      hextets[5] === 0
    ) {
      const embedded: [number, number, number, number] = [
        (hextets[6]! >> 8) & 0xff,
        hextets[6]! & 0xff,
        (hextets[7]! >> 8) & 0xff,
        hextets[7]! & 0xff,
      ];
      return isForbiddenIpv4Octets(embedded);
    }

    // 6to4 `2002::/16` embedding private IPv4
    if (hextets[0] === 0x2002) {
      const embedded: [number, number, number, number] = [
        (hextets[1]! >> 8) & 0xff,
        hextets[1]! & 0xff,
        (hextets[2]! >> 8) & 0xff,
        hextets[2]! & 0xff,
      ];
      if (isForbiddenIpv4Octets(embedded)) return true;
    }

    const first = hextets[0]!;
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 Unique Local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 Link-Local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 Multicast
    if (first === 0x2001 && hextets[1] === 0x0db8) return true; // 2001:db8::/32 Documentation
    return false;
  }

  return true;
}

export interface DnsResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type PinnedDnsLookupFn = (hostname: string) => Promise<DnsResolvedAddress[]>;

export interface PinnedHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type PinnedHttpFetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    redirect?: 'error';
  },
) => Promise<PinnedHttpResponse>;

const ALL_PINNED_ORIGINS = new Set<string>([
  ...PINNED_PROVIDER_ORIGINS.robase,
  ...PINNED_PROVIDER_ORIGINS.brevo,
  ...PINNED_PROVIDER_ORIGINS.resend,
]);

const defaultDnsLookup: PinnedDnsLookupFn = async (hostname: string) => {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));
};

export class ProviderEgressBlockedError extends Error {
  constructor() {
    super('Provider egress blocked');
    this.name = 'ProviderEgressBlockedError';
  }
}

const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;

/**
 * Production outbound HTTPS transport for notification providers:
 * 1. Verifies target URL is on `ALL_PINNED_ORIGINS` (`https:`, no custom port, no userinfo).
 * 2. Resolves DNS once and rejects the request BEFORE opening any socket if ANY resolved IP
 *    falls in a private/loopback/link-local/metadata/non-public range.
 * 3. Pins the validated IP in `https.request`'s `lookup` callback while preserving TLS SNI and
 *    certificate hostname verification (`servername: hostname`), preventing DNS-rebinding TOCTOU.
 * 4. Never follows HTTP redirects (`3xx` returned directly so adapters block redirect responses
 *    without forwarding `Authorization` or `api-key` headers).
 */
export function createPinnedProviderHttpFetch(options?: {
  lookupImpl?: PinnedDnsLookupFn;
  requestImpl?: typeof https.request;
}): PinnedHttpFetchFn {
  const lookupFn = options?.lookupImpl ?? defaultDnsLookup;
  const requestFn = options?.requestImpl ?? https.request;

  return async (url, init) => {
    if (init.signal.aborted) {
      const abortErr = new Error('Aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ProviderEgressBlockedError();
    }

    if (
      parsed.protocol !== 'https:' ||
      parsed.port !== '' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      !url.startsWith(`${parsed.origin}/`) ||
      !ALL_PINNED_ORIGINS.has(parsed.origin)
    ) {
      throw new ProviderEgressBlockedError();
    }

    const hostname = parsed.hostname.toLowerCase();
    const resolved = await lookupFn(hostname);
    if (!Array.isArray(resolved) || resolved.length === 0) {
      throw new TypeError('DNS lookup returned no addresses');
    }
    for (const candidate of resolved) {
      if (isForbiddenOutboundIp(candidate.address)) {
        throw new ProviderEgressBlockedError();
      }
    }
    const pinned = resolved[0]!;

    return new Promise<PinnedHttpResponse>((resolve, reject) => {
      let settled = false;
      const finishError = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const req = requestFn(
        {
          protocol: 'https:',
          hostname,
          port: 443,
          servername: hostname,
          path: parsed.pathname,
          method: init.method,
          headers: init.headers,
          agent: false,
          lookup: (_host, _lookupOpts, callback) => {
            callback(null, pinned.address, pinned.family);
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          // Never follow redirects or buffer redirect bodies.
          if (status >= 300 && status < 400) {
            res.resume();
            if (!settled) {
              settled = true;
              resolve({
                ok: false,
                status,
                json: () => Promise.resolve(null),
              });
            }
            return;
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;
          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
              req.destroy(new RangeError('Provider response exceeded size limit'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('error', (err) => finishError(err));
          res.on('end', () => {
            if (settled) return;
            settled = true;
            const rawText = Buffer.concat(chunks).toString('utf8');
            resolve({
              ok: status >= 200 && status < 300,
              status,
              json: () => Promise.resolve(JSON.parse(rawText) as unknown),
            });
          });
        },
      );

      const onAbort = () => {
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        req.destroy(abortErr);
        finishError(abortErr);
      };

      init.signal.addEventListener('abort', onAbort, { once: true });
      req.on('error', (err) => {
        init.signal.removeEventListener('abort', onAbort);
        finishError(err);
      });
      req.on('close', () => {
        init.signal.removeEventListener('abort', onAbort);
      });

      if (init.body !== undefined) {
        req.write(init.body);
      }
      req.end();
    });
  };
}
