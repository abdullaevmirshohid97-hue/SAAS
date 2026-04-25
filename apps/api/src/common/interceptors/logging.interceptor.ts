import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { tap } from 'rxjs';

import { getContextSafe } from '../context/request-context';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly log = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<{ method: string; url: string }>();
    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          const c = getContextSafe();
          this.log.log(
            `${req.method} ${req.url} ${Date.now() - started}ms clinic=${c?.clinicId ?? '-'} user=${c?.userId ?? '-'}`,
          );
        },
        error: (err) => {
          this.log.error(`${req.method} ${req.url} ${Date.now() - started}ms ${err.message}`);
        },
      }),
    );
  }
}
