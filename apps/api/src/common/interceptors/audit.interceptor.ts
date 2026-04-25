import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs';

import { AUDIT_KEY, type AuditConfig } from '../decorators/audit.decorator';
import { getContextSafe } from '../context/request-context';
import { SupabaseService } from '../services/supabase.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector?: Reflector,
    private readonly supabase?: SupabaseService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const cfg: AuditConfig | undefined = this.reflector?.get(AUDIT_KEY, ctx.getHandler());
    return next.handle().pipe(
      tap((result) => {
        if (!cfg) return;
        const c = getContextSafe();
        if (!c?.clinicId || !c?.userId) return;
        const client = this.supabase?.forUser(c);
        if (!client) return;
        const resourceId: string | null =
          typeof result === 'object' && result !== null && 'id' in result
            ? (result as { id: string }).id
            : null;
        void client.rpc('log_activity', {
          p_clinic_id: c.clinicId,
          p_actor_id: c.userId,
          p_actor_role: c.role,
          p_action: cfg.action,
          p_resource_type: cfg.resourceType,
          p_resource_id: resourceId,
          p_summary: { en: `${cfg.action} ${cfg.resourceType}` },
          p_metadata: { requestId: c.requestId },
        });
      }),
    );
  }
}
