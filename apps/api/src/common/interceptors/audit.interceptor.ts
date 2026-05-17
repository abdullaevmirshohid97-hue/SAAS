import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs';

import { AUDIT_KEY, type AuditConfig } from '../decorators/audit.decorator';
import { getContextSafe } from '../context/request-context';
import { SupabaseService } from '../services/supabase.service';

/**
 * Writes an activity_journal row for every successful request whose handler
 * carries an @Audit(...) decorator. Registered as APP_INTERCEPTOR in
 * AppModule so Nest DI injects Reflector + SupabaseService.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly log = new Logger('Audit');

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const cfg: AuditConfig | undefined = this.reflector.get(AUDIT_KEY, ctx.getHandler());
    return next.handle().pipe(
      tap((result) => {
        if (!cfg) return;
        const c = getContextSafe();
        if (!c?.clinicId || !c?.userId) return;

        const resourceId: string | null =
          typeof result === 'object' && result !== null && 'id' in result
            ? ((result as { id: unknown }).id as string)
            : null;

        // Service-role client — audit logging must not be blocked by RLS.
        // clinic_id is taken from the trusted request context, not the client.
        void this.supabase
          .admin()
          .rpc('log_activity', {
            p_clinic_id: c.clinicId,
            p_actor_id: c.userId,
            p_actor_role: c.role,
            p_action: cfg.action,
            p_resource_type: cfg.resourceType,
            p_resource_id: resourceId,
            p_summary: { en: `${cfg.action} ${cfg.resourceType}` },
            p_metadata: { requestId: c.requestId },
          })
          .then(({ error }) => {
            if (error) {
              this.log.warn(`log_activity failed for ${cfg.action}: ${error.message}`);
            }
          });
      }),
    );
  }
}
