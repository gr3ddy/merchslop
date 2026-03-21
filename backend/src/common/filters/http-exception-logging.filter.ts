import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionLoggingFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionLoggingFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const requestId = request.requestId ?? 'unknown-request';
    const statusCode = this.resolveStatusCode(exception);
    const errorPayload = this.resolveErrorPayload(exception, statusCode);
    const logPayload = {
      requestId,
      method: request.method,
      path: request.originalUrl || request.url,
      statusCode,
      actorId: request.actor?.userId ?? null,
      actorRole: request.actor?.role ?? null,
      exception:
        exception instanceof Error
          ? {
              name: exception.name,
              message: exception.message,
              stack: exception.stack,
            }
          : {
              message: String(exception),
            },
    };
    const logMessage = JSON.stringify(logPayload);

    if (statusCode >= 500) {
      this.logger.error(logMessage);
    } else {
      this.logger.warn(logMessage);
    }

    response.status(statusCode).json({
      statusCode,
      ...errorPayload,
      timestamp: new Date().toISOString(),
      path: request.originalUrl || request.url,
      requestId,
    });
  }

  private resolveStatusCode(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveErrorPayload(
    exception: unknown,
    statusCode: number,
  ): {
    error: string;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return {
          error: exception.name,
          message: response,
        };
      }

      if (response && typeof response === 'object') {
        const record = response as {
          error?: string;
          message?: string | string[];
        };

        return {
          error: record.error ?? exception.name,
          message: record.message ?? exception.message,
        };
      }

      return {
        error: exception.name,
        message: exception.message,
      };
    }

    return {
      error: 'InternalServerError',
      message:
        statusCode === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal server error'
          : 'Unexpected error',
    };
  }
}
