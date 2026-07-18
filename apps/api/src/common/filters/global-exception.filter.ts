import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import { getContextSafe } from '../context/request-context';
import type { SupabaseService } from '../services/supabase.service';

// E2 — shovqinsiz kuzatuv: auth/topilmadi/limit xatolari yozilmaydi.
const SKIP_STATUSES = new Set([401, 403, 404, 429]);

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Exception');

  // main.ts da `new GlobalExceptionFilter(app.get(SupabaseService))` — DI'siz.
  // Supabase berilmasa (testlar) monitoring shunchaki o'chiq bo'ladi.
  constructor(private readonly supabase?: SupabaseService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
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

    // E2 — muhim xatolarni api_error_log'ga yozamiz (fire-and-forget, javobni
    // kechiktirmaydi va xato yozish o'zi hech qachon exception bermaydi).
    if (this.supabase && !SKIP_STATUSES.has(status)) {
      try {
        void this.supabase
          .admin()
          .from('api_error_log')
          .insert({
            status,
            code,
            method: req?.method ?? null,
            path: (req?.originalUrl ?? req?.url ?? '').slice(0, 300) || null,
            message: String(message).slice(0, 500),
            clinic_id: c?.clinicId ?? null,
            request_id: c?.requestId ?? null,
          })
          .then(undefined, () => undefined);
      } catch {
        /* monitoring hech qachon asosiy oqimni buzmaydi */
      }
    }

    res.status(status).json({
      error: { code, message, details, requestId: c?.requestId },
    });
  }
}
