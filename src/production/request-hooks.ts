import type { FastifyInstance, FastifyRequest } from 'fastify';

import { redactRequestUrl } from '../common/sensitive-data-redaction';
import {
  createRequestContext,
  getRequestContext,
  type RequestWithContext,
} from './request-context';

/**
 * Report 25 boundary extraction: the request lifecycle hooks previously
 * inlined in `bootstrap()` (`src/main.ts`). `main.ts` executes `bootstrap()`
 * at module load, so its hooks could not be exercised from tests; extracting
 * them verbatim lets the production hook code be wired into a real Fastify
 * instance inside end-to-end tests. Behavior is unchanged: the module
 * bootstrap calls `registerRequestContextHooks` with the same tracker and API
 * version it used inline.
 */
export interface RequestHookTracker {
  start(): boolean;
  finish(): void;
}

export interface RequestHookOptions {
  /** Production readiness tracker; `start()` returning false drains requests. */
  requestTracker: RequestHookTracker;
  /** Value advertised via the `X-API-Version` response header. */
  apiVersion: string;
}

export function registerRequestContextHooks(
  http: FastifyInstance,
  options: RequestHookOptions,
): void {
  const { requestTracker, apiVersion } = options;

  http.addHook('onRequest', (request, reply, done) => {
    const context = createRequestContext(
      request.headers as Record<string, string | string[] | undefined>,
      request.id,
    );
    const requestWithContext = request as unknown as RequestWithContext;
    requestWithContext.requestStartedAt = Date.now();
    requestWithContext.requestContext = context;
    reply.header('X-Request-Id', context.requestId);
    reply.header('X-Correlation-Id', context.correlationId);
    reply.header('X-Trace-Id', context.traceId);
    reply.header('X-API-Version', apiVersion);

    if (!requestTracker.start()) {
      reply.code(503).send({
        statusCode: 503,
        code: 'SERVICE_DRAINING',
        message: 'Service is shutting down',
        requestId: context.requestId,
        correlationId: context.correlationId,
        traceId: context.traceId,
      });
      done();
      return;
    }
    requestWithContext.requestTracked = true;
    done();
  });

  http.addHook('onResponse', (request, reply, done) => {
    const requestWithContext = request as unknown as RequestWithContext;
    if (requestWithContext.requestTracked) {
      requestTracker.finish();
    }
    const context = getRequestContext(request as unknown as FastifyRequest);
    request.log.info(
      {
        // Report 25: context identifiers are sanitized at creation
        // (safeIdentifier), so this spread is safe.
        ...context,
        // Report 25: the matched route template is application-controlled and
        // safe; the raw-URL fallback carries the client-controlled query
        // string and percent-encoded path, so it passes through the shared
        // request-URL boundary (query excluded, decoded, redacted).
        operationName: request.routeOptions?.url ?? redactRequestUrl(request.url),
        method: request.method,
        statusCode: reply.statusCode,
        latencyMs: Date.now() - (requestWithContext.requestStartedAt ?? Date.now()),
      },
      'request completed',
    );
    done();
  });
}
