import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCode, ERROR_MESSAGES } from './error-codes';

interface ErrorResponse {
  statusCode: number;
  code: ErrorCode;
  message: string;
  detail?: string;
  path: string;
  timestamp: number;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const path = request.url;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = ErrorCode.INTERNAL_ERROR;
    let message = ERROR_MESSAGES[ErrorCode.INTERNAL_ERROR];
    let detail: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object') {
        const res = exResponse as any;
        message = res.message || message;
        // Map HTTP status to ErrorCode
        if (status === 400) code = ErrorCode.BAD_REQUEST;
        else if (status === 401) code = ErrorCode.UNAUTHORIZED;
        else if (status === 403) code = ErrorCode.FORBIDDEN;
        else if (status === 404) code = ErrorCode.NOT_FOUND;
        else if (status === 429) code = ErrorCode.RATE_LIMITED;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      detail = exception.stack;
    }

    this.logger.error(`${request.method} ${path} -> ${status}: ${message}`, exception instanceof Error ? exception.stack : '');

    const body: ErrorResponse = {
      statusCode: status,
      code,
      message,
      path,
      timestamp: Date.now(),
    };

    if (process.env.NODE_ENV !== 'production') {
      body.detail = detail;
    }

    response.status(status).json(body);
  }
}
