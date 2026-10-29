import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
  type LoggerService,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  REDACTED_VALUE,
  redactSensitiveText,
} from './common/sensitive-data-redaction';
import { getRequestContext, type RequestContext } from './production/request-context';

interface ErrorResponse {
  message?: string | string[];
  error?: string;
}

/**
 * Report 19 §2 boundary rule: every untrusted string copied into an HTTP error response or a
 * structured error log passes through the bounded redaction boundary (or is replaced with safe
 * canonical metadata). Request-context ids may echo client-supplied headers, so they are
 * untrusted at this boundary even though legitimate ids pass through unchanged.
 */
function sanitizeRequestContext(context: RequestContext): RequestContext {
  return {
    requestId: redactSensitiveText(context.requestId),
    correlationId: redactSensitiveText(context.correlationId),
    traceId: redactSensitiveText(context.traceId),
  };
}

/**
 * Report 19 finding C: query strings routinely carry credentials (signed links, integration
 * callbacks, misconfigured clients) and have no diagnostic value in error bodies or logs, so
 * the diagnostic path excludes everything from the first '?' or '#' and the remainder still
 * passes through the redaction boundary. Pure string operations: malformed URLs cannot throw.
 */
function diagnosticPath(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) return REDACTED_VALUE;
  const cut = url.search(/[?#]/);
  const path = cut >= 0 ? url.slice(0, cut) : url;
  return redactSensitiveText(path);
}

/** A hostile exception (throwing toString/message getter) must never crash the filter. */
function safeExceptionText(exception: unknown): string {
  try {
    return exception instanceof Error ? exception.message : String(exception);
  } catch {
    return REDACTED_VALUE;
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const requestContext = sanitizeRequestContext(getRequestContext(request));
    const path = diagnosticPath(request.url);
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = isHttpException ? exception.getResponse() : undefined;
    const details =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as ErrorResponse)
        : {};
    const message =
      statusCode >= 500
        ? 'Internal server error'
        : (details.message ??
          (typeof exceptionResponse === 'string' ? exceptionResponse : 'Request failed'));
    const safeMessage = Array.isArray(message)
      ? message.map((item) => redactSensitiveText(item))
      : redactSensitiveText(message);
    const code = this.errorCode(statusCode, safeMessage);

    response.header('X-Request-Id', requestContext.requestId);
    response.header('X-Correlation-Id', requestContext.correlationId);
    response.header('X-Trace-Id', requestContext.traceId);
    response.header('X-API-Version', 'v1');

    if (statusCode >= 500) {
      this.logger.error(
        {
          errorMessage: redactSensitiveText(safeExceptionText(exception)),
          ...requestContext,
          path,
          operationName: request.method,
        },
        'Unhandled request error',
      );
    }

    void response.status(statusCode).send({
      statusCode,
      code,
      message: safeMessage,
      error: typeof details.error === 'string' ? redactSensitiveText(details.error) : code,
      timestamp: new Date().toISOString(),
      path,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      traceId: requestContext.traceId,
    });
  }

  private errorCode(statusCode: number, message: string | string[]): string {
    if (statusCode === 400) {
      return Array.isArray(message) ? 'VALIDATION_ERROR' : 'BAD_REQUEST';
    }
    if (statusCode === 404) {
      return 'NOT_FOUND';
    }
    if (statusCode === 409) {
      return 'CONFLICT';
    }
    if (statusCode === 422) {
      return 'BUSINESS_RULE_VIOLATION';
    }
    if (statusCode === 503) {
      return 'SERVICE_UNAVAILABLE';
    }
    if (statusCode >= 500) {
      return 'INTERNAL_SERVER_ERROR';
    }
    return 'REQUEST_ERROR';
  }
}
