import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
  type LoggerService,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getRequestContext } from './production/request-context';

interface ErrorResponse {
  message?: string | string[];
  error?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const requestContext = getRequestContext(request);
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
    const code = this.errorCode(statusCode, message);

    response.header('X-Request-Id', requestContext.requestId);
    response.header('X-Correlation-Id', requestContext.correlationId);
    response.header('X-Trace-Id', requestContext.traceId);
    response.header('X-API-Version', 'v1');

    if (statusCode >= 500) {
      this.logger.error(
        { err: exception, ...requestContext, path: request.url, operationName: request.method },
        'Unhandled request error',
      );
    }

    void response.status(statusCode).send({
      statusCode,
      code,
      message,
      error: details.error ?? code,
      timestamp: new Date().toISOString(),
      path: request.url,
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
