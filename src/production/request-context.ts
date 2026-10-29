import { randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import { redactSensitiveText } from '../common/sensitive-data-redaction';

export interface RequestContext {
  requestId: string;
  correlationId: string;
  traceId: string;
}

export interface RequestWithContext extends FastifyRequest {
  requestContext?: RequestContext;
  requestTracked?: boolean;
  requestStartedAt?: number;
}

export function createRequestContext(
  headers: Record<string, string | string[] | undefined>,
  requestId?: string,
): RequestContext {
  const generatedRequestId =
    safeIdentifier(requestId) ?? safeIdentifier(headers['x-request-id']) ?? randomUUID();
  const correlationId = safeIdentifier(headers['x-correlation-id']) ?? generatedRequestId;
  const traceId =
    safeIdentifier(headers['x-trace-id']) ??
    traceIdFromTraceparent(headers.traceparent) ??
    randomUUID();
  return { requestId: generatedRequestId, correlationId, traceId };
}

export function getRequestContext(request: FastifyRequest): RequestContext {
  const withContext = request as RequestWithContext;
  return (
    withContext.requestContext ??
    createRequestContext(
      request.headers as Record<string, string | string[] | undefined>,
      request.id,
    )
  );
}

function safeHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    return undefined;
  }
  return /^[\x20-\x7E]+$/.test(value) ? value : undefined;
}

/**
 * Report 25 (R-04 application-level bypass): context identifiers are built from
 * client-controlled headers, and they are echoed into response headers, the
 * SERVICE_DRAINING 503 body, the onResponse request log, pino `customProps` and
 * persisted audit records. Validating shape is not enough — a header may carry a
 * valid short credential (`bearer abc`) — so every externally derived identifier
 * additionally passes through the bounded redaction boundary at creation, once,
 * for all downstream consumers. Legitimate identifiers (UUIDs, `corr-…`, W3C
 * traceparent hex) contain no credential shape and pass through unchanged;
 * internally generated `randomUUID()` values are trusted and never re-checked.
 */
function safeIdentifier(value: string | string[] | undefined): string | undefined {
  const validated = safeHeader(value);
  if (validated === undefined) {
    return undefined;
  }
  return redactSensitiveText(validated);
}

function traceIdFromTraceparent(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parts = value.split('-');
  return parts.length === 4 && /^[0-9a-f]{32}$/i.test(parts[1] ?? '') ? parts[1] : undefined;
}
