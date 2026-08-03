import { randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

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
    safeHeader(requestId) ?? safeHeader(headers['x-request-id']) ?? randomUUID();
  const correlationId = safeHeader(headers['x-correlation-id']) ?? generatedRequestId;
  const traceId =
    safeHeader(headers['x-trace-id']) ??
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

function traceIdFromTraceparent(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parts = value.split('-');
  return parts.length === 4 && /^[0-9a-f]{32}$/i.test(parts[1] ?? '') ? parts[1] : undefined;
}
