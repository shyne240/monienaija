import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import type { Environment } from '../config/environment';

/**
 * Production HTTP hardening for the Fastify/Nest bootstrap.
 *
 * Everything here is explicitly configuration-driven and fails safe:
 *
 * - CORS is **disabled** unless `HTTP_CORS_ORIGINS_JSON` lists explicit origins. `*` is rejected:
 *   this is a financial API and a wildcard would let any web origin read authenticated responses.
 *   Origins are compared exactly (scheme + host + port) and `Vary: Origin` is always sent when an
 *   origin is echoed.
 * - Security headers are added to every response. HSTS is only emitted in `production`, because it
 *   is a browser-persisted transport policy that must not be set by a lower environment.
 * - The request body limit is explicit (`HTTP_BODY_LIMIT_BYTES`, default 1 MiB, the Fastify default)
 *   and applies to all payloads; the API has no multipart upload surface.
 * - `trustProxy` stays off unless `HTTP_TRUST_PROXY=true`, so client addresses (and therefore the
 *   authentication rate-limit buckets) are never derived from a spoofable header by accident.
 */

const CORS_ORIGIN_PATTERN = /^https?:\/\/[^\s/]+$/;
const WILDCARD_ORIGIN = '*';

export interface CorsOrigins {
  readonly origins: readonly string[];
  readonly configured: boolean;
}

/** Parses and validates the explicit CORS allowlist. Wildcards and non-origin URLs are rejected. */
export function corsOriginsFromJson(value: string | undefined | null): CorsOrigins {
  if (value === undefined || value === null || value.trim() === '') {
    return { origins: [], configured: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('HTTP_CORS_ORIGINS_JSON: malformed JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50) {
    throw new Error('HTTP_CORS_ORIGINS_JSON: expected a non-empty JSON array of origins');
  }

  const origins: string[] = [];
  for (const candidate of parsed) {
    if (typeof candidate !== 'string') {
      throw new Error('HTTP_CORS_ORIGINS_JSON: every origin must be a string');
    }
    const origin = candidate.trim();
    if (origin === WILDCARD_ORIGIN) {
      throw new Error('HTTP_CORS_ORIGINS_JSON: wildcard origin is not permitted');
    }
    if (!CORS_ORIGIN_PATTERN.test(origin)) {
      throw new Error(
        `HTTP_CORS_ORIGINS_JSON: origin must be an absolute http(s) origin without a path: ${origin}`,
      );
    }
    origins.push(origin);
  }
  if (new Set(origins).size !== origins.length) {
    throw new Error('HTTP_CORS_ORIGINS_JSON: duplicate origin');
  }
  return { origins, configured: true };
}

/** Fastify adapter options derived from validated environment configuration. */
export function fastifyAdapterOptions(environment: Environment): {
  bodyLimit: number;
  trustProxy: boolean;
} {
  return {
    bodyLimit: environment.HTTP_BODY_LIMIT_BYTES,
    trustProxy: environment.HTTP_TRUST_PROXY,
  };
}

/**
 * Headers safe for a JSON-only API: no MIME sniffing, no framing, no referrer leakage and no
 * cross-origin resource embedding. Content-Security-Policy is restrictive because no route serves
 * HTML; browsers enforce it on any accidentally rendered response.
 */
export function securityHeaders(environment: Environment): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
  if (environment.NODE_ENV === 'production') {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

/**
 * Structural reply/host types: the Nest Fastify adapter can resolve a different copy of the fastify
 * type package than the root one, so the hook is declared against the shape it actually uses
 * instead of coupling to one copy's nominal types.
 */
export interface OnSendReply {
  header(name: string, value: string): unknown;
  hasHeader(name: string): boolean;
}

export type OnSendHook = (
  request: unknown,
  reply: OnSendReply,
  payload: unknown,
  done: (error: Error | null, payload?: unknown) => void,
) => void;

export interface HttpHeaderHost {
  addHook(name: 'onSend', hook: OnSendHook): unknown;
}

/** Registers the security headers on every response. */
export function registerSecurityHeaders(instance: HttpHeaderHost, environment: Environment): void {
  const headers = securityHeaders(environment);
  instance.addHook('onSend', (_request, reply, payload, done) => {
    for (const [name, value] of Object.entries(headers)) {
      if (!reply.hasHeader(name)) {
        reply.header(name, value);
      }
    }
    done(null, payload);
  });
}

/** Methods and headers the browser clients are allowed to use on an allowed origin. */
export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] as const;
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'X-Request-Id',
  'X-Correlation-Id',
  'X-Trace-Id',
  'traceparent',
] as const;

/**
 * Applies the hardened HTTP configuration to a bootstrapped Nest Fastify application.
 *
 * `main.ts` and the HTTP hardening tests call the same function, so the tested contract is the
 * deployed contract. CORS is only enabled when an explicit origin allowlist is configured;
 * credentials stay off because the browser clients use bearer tokens, not cross-origin cookies.
 */
export function applyHttpSecurity(
  app: NestFastifyApplication,
  environment: Environment,
): { corsEnabled: boolean } {
  registerSecurityHeaders(
    app.getHttpAdapter().getInstance() as unknown as HttpHeaderHost,
    environment,
  );
  const cors = corsOriginsFromJson(environment.HTTP_CORS_ORIGINS_JSON);
  if (cors.configured) {
    app.enableCors({
      origin: [...cors.origins],
      credentials: false,
      methods: [...CORS_ALLOWED_METHODS],
      allowedHeaders: [...CORS_ALLOWED_HEADERS],
      maxAge: 600,
    });
  }
  return { corsEnabled: cors.configured };
}
