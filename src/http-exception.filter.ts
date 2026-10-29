import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
  type LoggerService,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  REDACTED_VALUE,
  redactDiagnosticPath,
  redactSensitiveText,
} from './common/sensitive-data-redaction';
import { getRequestContext, type RequestContext } from './production/request-context';

/**
 * Report 21 §2 boundary rule: every untrusted string copied into an HTTP error response or a
 * structured error log passes through the bounded redaction boundary (or is replaced with safe
 * canonical metadata). Request-context ids may echo client-supplied headers, so they are
 * untrusted at this boundary even though legitimate ids pass through unchanged.
 *
 * Report 21 finding 2: the exception object, its response object and every value read from
 * them are untrusted *programs*, not just untrusted data — `instanceof` walks prototype chains
 * (Proxy `getPrototypeOf` traps), property reads invoke getters, `String()` invokes
 * `toString`, and `Array.prototype.map` reads elements. Each such operation is guarded; a
 * throwing trap degrades only the affected field to safe canonical metadata and can never
 * prevent the HTTP response.
 */

/** Distinguishes "the property read threw" from "the property is absent". */
const THROWING = Symbol('throwing-access');

function safeGet(target: object, key: string): unknown {
  try {
    return (target as Record<string, unknown>)[key];
  } catch {
    return THROWING;
  }
}

function isHttpExceptionValue(value: unknown): value is HttpException {
  // `instanceof` evaluates prototype-chain traps, which can throw on hostile Proxies.
  try {
    return value instanceof HttpException;
  } catch {
    return false;
  }
}

function isErrorValue(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

// Report 19 finding C / report 25: the diagnostic-path boundary (query and fragment
// excluded, remainder redacted) lives in the shared redaction module
// (`redactDiagnosticPath`) so every URL sink — error bodies, error logs and structured
// request logs — uses one implementation.

/** A hostile exception (throwing toString/message getter) must never crash the filter. */
function safeExceptionText(exception: unknown): string {
  try {
    return isErrorValue(exception) ? exception.message : String(exception);
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
    const requestContext = this.safeRequestContext(request);
    const path = this.safeDiagnosticPath(request);
    const operationName = this.safeOperationName(request);

    const isHttpException = isHttpExceptionValue(exception);
    const statusCode = this.safeStatusCode(exception, isHttpException);
    const exceptionResponse = this.safeExceptionResponse(exception, isHttpException);

    const message =
      statusCode >= 500 ? 'Internal server error' : responseMessage(exceptionResponse);
    const safeMessage = sanitizeMessageValue(message);
    const code = this.errorCode(statusCode, safeMessage);
    const safeError = responseErrorField(exceptionResponse, code);

    response.header('X-Request-Id', requestContext.requestId);
    response.header('X-Correlation-Id', requestContext.correlationId);
    response.header('X-Trace-Id', requestContext.traceId);
    response.header('X-API-Version', 'v1');

    if (statusCode >= 500) {
      try {
        this.logger.error(
          {
            errorMessage: redactSensitiveText(safeExceptionText(exception)),
            ...requestContext,
            path,
            operationName,
          },
          'Unhandled request error',
        );
      } catch {
        // A throwing logger must never prevent the HTTP response.
      }
    }

    void response.status(statusCode).send({
      statusCode,
      code,
      message: safeMessage,
      error: safeError,
      timestamp: new Date().toISOString(),
      path,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      traceId: requestContext.traceId,
    });
  }

  private safeRequestContext(request: FastifyRequest): RequestContext {
    try {
      const context = getRequestContext(request);
      return {
        requestId: redactSensitiveText(context.requestId),
        correlationId: redactSensitiveText(context.correlationId),
        traceId: redactSensitiveText(context.traceId),
      };
    } catch {
      return {
        requestId: REDACTED_VALUE,
        correlationId: REDACTED_VALUE,
        traceId: REDACTED_VALUE,
      };
    }
  }

  private safeDiagnosticPath(request: FastifyRequest): string {
    try {
      return redactDiagnosticPath(request.url);
    } catch {
      return REDACTED_VALUE;
    }
  }

  private safeOperationName(request: FastifyRequest): string {
    try {
      const method: unknown = request.method;
      return typeof method === 'string' && method.length > 0 ? method : REDACTED_VALUE;
    } catch {
      return REDACTED_VALUE;
    }
  }

  private safeStatusCode(exception: unknown, isHttpException: boolean): number {
    if (!isHttpException) return HttpStatus.INTERNAL_SERVER_ERROR;
    try {
      const status = (exception as HttpException).getStatus();
      return Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : HttpStatus.INTERNAL_SERVER_ERROR;
    } catch {
      return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }

  private safeExceptionResponse(exception: unknown, isHttpException: boolean): unknown {
    if (!isHttpException) return undefined;
    try {
      return (exception as HttpException).getResponse();
    } catch {
      return undefined;
    }
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

/**
 * Extracts the response message from an already-fetched exception response. Every property
 * read is trap-guarded; a throwing or absent getter degrades to the canonical fallback.
 */
function responseMessage(exceptionResponse: unknown): unknown {
  if (typeof exceptionResponse === 'string') return exceptionResponse;
  if (typeof exceptionResponse !== 'object' || exceptionResponse === null) {
    return 'Request failed';
  }
  const message = safeGet(exceptionResponse, 'message');
  if (message === THROWING || message === undefined || message === null) return 'Request failed';
  return message;
}

/**
 * Sanitizes the message value. Array elements are individually sanitized; a hostile array
 * (throwing element access) fails closed to the generic redaction. Non-string values fail
 * closed inside redactSensitiveText's own type guard.
 *
 * Report 23 finding 2: `Array.isArray()` itself throws a TypeError on a revoked Proxy
 * ("Cannot perform 'IsArray' on a proxy that has been revoked"), so the array check and the
 * mapping share one guard — a revoked/hostile message value degrades to `[REDACTED]` and can
 * never abort the response.
 */
function sanitizeMessageValue(message: unknown): string | string[] {
  try {
    if (Array.isArray(message)) {
      return (message as unknown[]).map((item) => redactSensitiveText(item as string));
    }
  } catch {
    return REDACTED_VALUE;
  }
  return redactSensitiveText(message as string);
}

/**
 * Report 19 finding B + report 21 finding 2: the returned `error` field is sanitized when it
 * is a readable string and fails closed to the canonical code when it is absent, unreadable
 * (throwing getter) or not a string.
 */
function responseErrorField(exceptionResponse: unknown, code: string): string {
  if (typeof exceptionResponse !== 'object' || exceptionResponse === null) return code;
  const error = safeGet(exceptionResponse, 'error');
  return typeof error === 'string' ? redactSensitiveText(error) : code;
}
