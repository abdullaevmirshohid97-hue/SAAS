import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

import { getContextSafe } from '../context/request-context';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const c = getContextSafe();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse() as string | Record<string, unknown>;
      if (typeof resp === 'string') {
        message = resp;
      } else {
        message = (resp['message'] as string) ?? exception.message;
        code = (resp['error'] as string) ?? 'HTTP_ERROR';
        details = resp['details'];
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = 'VALIDATION_ERROR';
      message = 'Validation failed';
      details = exception.flatten();
    } else if (exception instanceof Error) {
      this.log.error(exception.stack ?? exception.message);
      message = exception.message;
    }

    res.status(status).json({
      error: { code, message, details, requestId: c?.requestId },
    });
  }
}
