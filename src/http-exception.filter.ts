import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
  type LoggerService,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

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
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = isHttpException ? exception.getResponse() : undefined;
    const details =
      typeof exceptionResponse === 'object' ? (exceptionResponse as ErrorResponse) : {};
    const message =
      statusCode >= 500
        ? 'Internal server error'
        : (details.message ??
          (typeof exceptionResponse === 'string' ? exceptionResponse : 'Request failed'));

    if (statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId: request.id, path: request.url },
        'Unhandled request error',
      );
    }

    void response.status(statusCode).send({
      statusCode,
      message,
      error: details.error ?? (isHttpException ? undefined : 'Internal Server Error'),
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: request.id,
    });
  }
}
