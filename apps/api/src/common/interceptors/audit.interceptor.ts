import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Audit yozuvi uchun resurs ID'sini topadi.
 *
 * Ilgari faqat `result.id` qaralardi. Natijada eng muhim resursda —
 * pul tranzaksiyalarida — 2544 audit yozuvidan atigi 43 tasida ID bor edi
 * (qolganlari izsiz), chunki ko'p endpoint `{ ok: true }` yoki o'ralgan
 * obyekt qaytaradi. Endi uchta manba tartib bilan qaraladi:
 *   1) javobdagi id (yaratishda)
 *   2) marshrut parametri :id (yangilash/o'chirishda)
 *   3) `<resource>_id` ko'rinishidagi maydon (masalan transaction_id)
 */
function extractResourceId(
  ctx: ExecutionContext,
  cfg: AuditConfig,
  result: unknown,
): string | null {
  const asUuid = (v: unknown): string | null =>
    typeof v === 'string' && UUID_RE.test(v) ? v : null;

  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    const direct = asUuid(r.id);
    if (direct) return direct;

    // transactions → transaction_id, pharmacy_sales → sale_id kabi holatlar
    const singular = cfg.resourceType.replace(/s$/, '');
    for (const key of [`${singular}_id`, `${cfg.resourceType}_id`]) {
      const v = asUuid(r[key]);
      if (v) return v;
    }

    // { data: { id } } ko'rinishidagi o'ralgan javob
    if (typeof r.data === 'object' && r.data !== null) {
      const nested = asUuid((r.data as Record<string, unknown>).id);
      if (nested) return nested;
    }
  }

  // Marshrut parametri — PATCH/POST /:id/action uchun ishonchli manba
  try {
    const req = ctx.switchToHttp().getRequest<{ params?: Record<string, string> }>();
    return asUuid(req?.params?.id);
  } catch {
    return null;
  }
}

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

        const resourceId = extractResourceId(ctx, cfg, result);

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
